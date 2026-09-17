const crypto = require('crypto');

// ================================================================
// TC3-HMAC-SHA256 Signature (Tencent Cloud API 3.0)
// Manual implementation — the TokenHub product (1300 / 2026-03-22)
// is too new for the SDK to have built-in support.
// ================================================================

function sha256Hex(msg) {
  return crypto.createHash('sha256').update(msg).digest('hex');
}

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg).digest(); // Buffer
}

function buildAuth(secretId, secretKey, action, payload, timestamp, host) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const service = 'tokenhub';

  // 1. Canonical Request
  const canonicalHeaders =
    'content-type:application/json\n' +
    'host:' + host + '\n' +
    'x-tc-action:' + action.toLowerCase() + '\n';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST', '/', '', canonicalHeaders, signedHeaders, sha256Hex(payload)
  ].join('\n');

  // 2. String to Sign
  const credentialScope = date + '/' + service + '/tc3_request';
  const stringToSign = [
    'TC3-HMAC-SHA256', timestamp, credentialScope, sha256Hex(canonicalRequest)
  ].join('\n');

  // 3. Signature (chained HMAC)
  const secretDate = hmac('TC3' + secretKey, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign).toString('hex');

  // 4. Authorization header
  return 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders +
    ', Signature=' + signature;
}

// ================================================================
// Helpers
// ================================================================

function toRFC3339(date) {
  // TokenHub expects RFC3339 with +08:00 offset
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return local.toISOString().replace('Z', '+08:00');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

const TOKENHUB_HOST = 'tokenhub.intl.tencentcloudapi.com';
const TOKENHUB_VERSION = '2026-03-22';

// ================================================================
// TokenHub API Client — generic call wrapper
// ================================================================

async function callTokenHubApi(secretId, secretKey, region, action, payload) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = buildAuth(secretId, secretKey, action, body, timestamp, TOKENHUB_HOST);

  const res = await fetch('https://' + TOKENHUB_HOST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-TC-Action': action,
      'X-TC-Version': TOKENHUB_VERSION,
      'X-TC-Timestamp': timestamp.toString(),
      'X-TC-Region': region,
      'Authorization': authorization,
    },
    body: body,
  });

  const json = await res.json();

  if (json.Response && json.Response.Error) {
    const e = json.Response.Error;
    const err = new Error(e.Message || 'TokenHub API error');
    err.code = e.Code;
    err.requestId = json.Response.RequestId;
    throw err;
  }

  return json.Response;
}

// ================================================================
// Customer Config
// ================================================================

function getCustomerConfig() {
  const raw = process.env.CUSTOMER_CONFIG;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse CUSTOMER_CONFIG:', e.message);
    return {};
  }
}

// In-memory cache for ApiKeyId resolution (survives across invocations)
const apiKeyIdCache = {};

// ================================================================
// Response Helpers
// ================================================================

function jsonResponse(obj, status) {
  return { statusCode: status || 200, headers: CORS, body: JSON.stringify(obj) };
}

function errorResponse(status, message, extra) {
  return {
    statusCode: status,
    headers: CORS,
    body: JSON.stringify(Object.assign({ error: message }, extra || {})),
  };
}

// ================================================================
// Netlify Function Handler
// ================================================================

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // --- Read env vars ---
  const secretId = process.env.TENCENTCLOUD_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
  const region = process.env.TENCENTCLOUD_REGION || 'ap-singapore';

  if (!secretId || !secretKey) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: 'Server missing TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY env vars. Set them in .env (local) or Netlify site settings (production).',
      }),
    };
  }

  // --- Parse query params ---
  const qp = event.queryStringParameters || {};
  const days = Math.min(parseInt(qp.days || '7', 10) || 7, 90);
  const dimension = qp.dimension || 'apikey';

  // --- Build time range (last N days, midnight-to-midnight) ---
  const now = new Date();
  const endTime = new Date(now);
  endTime.setHours(0, 0, 0, 0);
  const startTime = new Date(endTime);
  startTime.setDate(startTime.getDate() - days);

  // --- Build API request ---
  const action = 'DescribeUsageRankList';
  const version = '2026-03-22';
  const host = 'tokenhub.intl.tencentcloudapi.com';

  const body = JSON.stringify({
    Dimension: dimension,
    StartTime: toRFC3339(startTime),
    EndTime: toRFC3339(endTime),
    Period: 86400,       // daily aggregation
    MetricType: 'tokens',
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = buildAuth(secretId, secretKey, action, body, timestamp, host);

  // --- Call TokenHub Control Plane API ---
  try {
    const res = await fetch('https://' + host, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': timestamp.toString(),
        'X-TC-Region': region,
        'Authorization': authorization,
      },
      body: body,
    });

    const json = await res.json();

    // --- Handle API error ---
    if (json.Response && json.Response.Error) {
      const e = json.Response.Error;
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          error: e.Message,
          code: e.Code,
          requestId: json.Response.RequestId,
        }),
      };
    }

    // --- Success ---
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        period: {
          start: toRFC3339(startTime),
          end: toRFC3339(endTime),
          days: days,
          dimension: dimension,
        },
        raw: json.Response,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Fetch failed: ' + err.message }),
    };
  }
};