const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/usage');

// All upstream calls are mocked; no real credentials or network requests.
test('usage request windows and complete key lists', async (t) => {
  const originalFetch = global.fetch;
  const originalId = process.env.TENCENTCLOUD_SECRET_ID;
  const originalKey = process.env.TENCENTCLOUD_SECRET_KEY;
  process.env.TENCENTCLOUD_SECRET_ID = 'test-id';
  process.env.TENCENTCLOUD_SECRET_KEY = 'test-secret';
  let request;
  let calls = 0;
  let response = {
    Total: 12,
    TopList: Array.from({ length: 12 }, (_, i) => ({
      Name: i === 11 ? 'GLM-5-sg-key' : `test-${i}`,
      Stats: { TotalToken: 10, InputTotalToken: 6, OutputTotalToken: 4, CacheTotalToken: 0 },
    })),
    TotalStats: { TotalToken: 120 },
  };
  global.fetch = async (url, options) => {
    calls++;
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ Response: response }) };
  };
  const query = (parameters = {}) => handler({ httpMethod: 'GET', queryStringParameters: parameters });
  try {
    await t.test('fixed end includes all 12 keys and exactly 7 days', async () => {
      const result = await query({ days: '7', end_time: '2026-01-10T18:30:00+08:00' });
      assert.equal(result.statusCode, 200);
      assert.equal(request.Dimension, 'apikey');
      assert.equal(request.ShowAll, true);
      assert.equal(request.MetricType, 'tokens');
      assert.equal(request.Period, 86400);
      assert.equal(request.EndTime, '2026-01-10T18:30:00.000+08:00');
      assert.equal(request.StartTime, '2026-01-03T18:30:00.000+08:00');
      assert.equal(JSON.parse(result.body).raw.TopList.length, 12);
      assert.equal(result.headers['Cache-Control'], 'no-store');
    });
    await t.test('default end is now rather than midnight', async () => {
      const before = Date.now();
      const result = await query({ days: '1' });
      assert.equal(result.statusCode, 200);
      const end = Date.parse(request.EndTime);
      assert.ok(end >= before && end <= Date.now());
      assert.equal(end - Date.parse(request.StartTime), 86400000);
    });
    await t.test('day bounds never exceed 90 days', async () => {
      for (const [value, expected] of [['90', 90], ['999', 90], ['-1', 1], ['bad', 7]]) {
        await query({ days: value });
        assert.equal(Date.parse(request.EndTime) - Date.parse(request.StartTime), expected * 86400000);
      }
    });
    await t.test('invalid and future end times do not call upstream', async () => {
      const before = calls;
      for (const end_time of ['bad', '2026-01-10', '2999-01-01T00:00:00Z']) {
        assert.equal((await query({ end_time })).statusCode, 400);
      }
      assert.equal(calls, before);
    });
    await t.test('customer filtering includes a key beyond default first page', async () => {
      const result = await query({ customer: 'sub-account-test' });
      const data = JSON.parse(result.body);
      assert.equal(result.statusCode, 200);
      assert.equal(data.raw.Total, 1);
      assert.equal(data.raw.TotalStats.TotalToken, 10);
      assert.equal(data.raw.TopList[0].Name, 'GLM-5-sg-key');
    });
    await t.test('empty list is valid, incomplete or malformed list fails', async () => {
      response = { Total: 0, TopList: [], TotalStats: {} };
      assert.equal((await query()).statusCode, 200);
      response = { Total: 12, TopList: [] };
      assert.equal((await query()).statusCode, 502);
      response = {};
      assert.equal((await query()).statusCode, 502);
      response = { Error: { Code: 'InvalidParameter', Message: 'Invalid query' } };
      assert.equal((await query()).statusCode, 502);
    });
  } finally {
    global.fetch = originalFetch;
    if (originalId === undefined) delete process.env.TENCENTCLOUD_SECRET_ID;
    else process.env.TENCENTCLOUD_SECRET_ID = originalId;
    if (originalKey === undefined) delete process.env.TENCENTCLOUD_SECRET_KEY;
    else process.env.TENCENTCLOUD_SECRET_KEY = originalKey;
  }
});
