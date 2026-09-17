const crypto = require('crypto');

// ================================================================
// TC3-HMAC-SHA256 Signature (Tencent Cloud API 3.0)
// ================================================================

function sha256Hex(msg) {
  return crypto.createHash('sha256').update(msg).digest('hex');
}

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg).digest();
}

function buildAuth(secretId, secretKey, action, payload, timestamp, host) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const service = 'tokenhub';

  const canonicalHeaders =
    'content-type:application/json\n' +
    'host:' + host + '\n' +
    'x-tc-action:' + action.toLowerCase() + '\n';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST', '/', '', canonicalHeaders, signedHeaders, sha256Hex(payload)
  ].join('\n');

  const credentialScope = date + '/' + service + '/tc3_request';
  const stringToSign = [
    'TC3-HMAC-SHA256', timestamp, credentialScope, sha256Hex(canonicalRequest)
  ].join('\n');

  const secretDate = hmac('TC3' + secretKey, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign).toString('hex');

  return 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders +
    ', Signature=' + signature;
}

// ================================================================
// Helpers
// ================================================================

function toRFC3339(date) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return local.toISOString().replace('Z', '+08:00');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const TOKENHUB_HOST = 'tokenhub.intl.tencentcloudapi.com';
const TOKENHUB_VERSION = '2026-03-22';

// ================================================================
// Customer -> API Key mapping
// ================================================================

const CUSTOMERS = {
  'sub-account-test': {
    name: 'Sub-Account Test',
    keys: ['GLM-5-sg-key', 'aninglu-GLM-5-key'],
  },
};

// ================================================================
// Filter TopList by customer keys & recalculate stats
// ================================================================

function filterByCustomer(response, customerConfig) {
  const keySet = new Set(customerConfig.keys);
  const filtered = (response.TopList || []).filter(item => keySet.has(item.Name));

  const totalStats = { TotalToken: 0, InputTotalToken: 0, OutputTotalToken: 0, CacheTotalToken: 0 };
  for (const item of filtered) {
    const s = item.Stats || {};
    totalStats.TotalToken += s.TotalToken || 0;
    totalStats.InputTotalToken += s.InputTotalToken || 0;
    totalStats.OutputTotalToken += s.OutputTotalToken || 0;
    totalStats.CacheTotalToken += s.CacheTotalToken || 0;
  }

  return {
    ...response,
    TopList: filtered,
    Total: filtered.length,
    TotalStats: totalStats,
    PageStats: totalStats,
  };
}

// ================================================================
// Netlify Function Handler
// ================================================================

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const secretId = process.env.TENCENTCLOUD_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
  const region = process.env.TENCENTCLOUD_REGION || 'ap-singapore';

  if (!secretId || !secretKey) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: 'Server missing TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY env vars.',
      }),
    };
  }

  const qp = event.queryStringParameters || {};
  const days = Math.max(1, Math.min(parseInt(qp.days || '7', 10) || 7, 90));
  const dimension = qp.dimension || 'apikey';
  const customerId = qp.customer || null;

  if (customerId && !CUSTOMERS[customerId]) {
    return {
      statusCode: 404,
      headers: CORS,
      body: JSON.stringify({ error: 'Unknown customer: ' + customerId }),
    };
  }

  // Rolling window ending now, independent of the function server's timezone.
  // An explicit RFC3339 end_time allows repeatable reconciliation queries.
  const now = new Date();
  const endTime = qp.end_time ? new Date(qp.end_time) : now;
  if (qp.end_time && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(qp.end_time) ||
      !Number.isFinite(endTime.getTime()) || endTime > now)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'end_time must be an RFC3339 timestamp with timezone, not in the future.' }),
    };
  }
  const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

  const action = 'DescribeUsageRankList';
  const host = TOKENHUB_HOST;

  const body = JSON.stringify({
    Dimension: dimension,
    StartTime: toRFC3339(startTime),
    EndTime: toRFC3339(endTime),
    // The default response is only 10 objects. ShowAll returns all usage rows.
    ShowAll: true,
    // The API rejects requests without Period ("Period is required") even
    // though ShowAll=true makes the value unused (daily granularity).
    Period: 86400,
    MetricType: 'tokens',
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = buildAuth(secretId, secretKey, action, body, timestamp, host);

  try {
    const res = await fetch('https://' + host, {
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
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: e.Message, code: e.Code, requestId: json.Response.RequestId }),
      };
    }

    let responseData = json.Response;
    if (!res.ok || !responseData || !Array.isArray(responseData.TopList)) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: 'Invalid TokenHub usage response.' }),
      };
    }
    if (responseData.Total !== responseData.TopList.length) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: 'TokenHub returned an incomplete key list despite ShowAll=true.', requestId: responseData.RequestId }),
      };
    }
    let customerInfo = null;
    if (customerId) {
      const cfg = CUSTOMERS[customerId];
      customerInfo = { id: customerId, name: cfg.name, keys: cfg.keys };
      responseData = filterByCustomer(responseData, cfg);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        period: { start: toRFC3339(startTime), end: toRFC3339(endTime), days, dimension },
        customer: customerInfo,
        raw: responseData,
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
