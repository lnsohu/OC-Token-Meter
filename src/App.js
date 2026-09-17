import React, { useState, useEffect, useCallback } from 'react';

// ================================================================
// Hash-based routing:  #/c/:customerId  -> customer view
// ================================================================

function parseHash() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/');
  if (parts[0] === 'c' && parts[1]) {
    return { view: 'customer', customerId: parts[1] };
  }
  return { view: 'admin', customerId: null };
}

const S = {
  page: { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', maxWidth: 960, margin: '0 auto', padding: 24, color: '#1a1a1a' },
  h1: { fontSize: 28, margin: '0 0 4px 0' },
  sub: { fontSize: 14, color: '#888', margin: '0 0 24px 0' },
  badge: { display: 'inline-block', padding: '2px 10px', background: '#e6f4ff', color: '#1677ff', borderRadius: 12, fontSize: 12, marginLeft: 12, verticalAlign: 'middle' },
  ctrl: { display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' },
  btn: { padding: '6px 16px', border: '1px solid #d9d9d9', background: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  btnOn: { padding: '6px 16px', border: '1px solid #1677ff', background: '#1677ff', borderRadius: 6, cursor: 'pointer', fontSize: 14, color: '#fff' },
  cards: { display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' },
  card: { flex: '1 1 180px', padding: 20, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' },
  cardL: { fontSize: 13, color: '#888', marginBottom: 8 },
  cardV: { fontSize: 26, fontWeight: 600 },
  tbl: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '10px 16px', background: '#fafafa', borderBottom: '2px solid #f0f0f0', color: '#666' },
  td: { padding: '10px 16px', borderBottom: '1px solid #f0f0f0' },
  mono: { fontFamily: 'monospace', fontSize: 13 },
  loading: { textAlign: 'center', padding: 48, color: '#999' },
  err: { padding: 16, background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 8, color: '#cf1322', fontSize: 14 },
  raw: { background: '#f6f8fa', padding: 16, borderRadius: 8, fontSize: 12, fontFamily: 'monospace', overflow: 'auto', maxHeight: 400 },
};

function formatCn(value) {
  if (!value) return '---';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '---';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date);
}

function App() {
  const [route, setRoute] = useState(parseHash);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(7);

  // Listen for hash changes
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const customerId = route.customerId;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      let url = '/api/usage?days=' + days;
      if (customerId) url += '&customer=' + encodeURIComponent(customerId);
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [days, customerId]);

  useEffect(() => { fetchData(); }, [fetchData]); // eslint-disable-line

  const fmt = (n) => (n != null && !isNaN(n) ? Number(n).toLocaleString() : '---');
  const raw = data?.raw;
  const ts = raw?.TotalStats || {};
  const topList = raw?.TopList || [];
  const customerInfo = data?.customer;

  return (
    <div style={S.page}>
      <h1 style={S.h1}>
        OC Token Meter
        {customerInfo && <span style={S.badge}>{customerInfo.name}</span>}
      </h1>
      <p style={S.sub}>
        {customerInfo
          ? 'Token usage for assigned API Keys'
          : 'TokenHub Token Usage Dashboard (Admin)'}
      </p>
      {raw && !loading && (
        <p style={{ ...S.sub, margin: '0 0 16px 0' }}>
          Showing {topList.length} / {raw.Total} API Keys returned for {formatCn(data?.period?.start)} to {formatCn(data?.period?.end)} (UTC+08:00, start inclusive, end exclusive).
          {' '}Rolling time window ending at query time; refresh to include newer usage. TokenHub reporting may lag. Keys without usage may not be returned.
        </p>
      )}


      <div style={S.ctrl}>
        {[1, 7, 30, 90].map(d => (
          <button key={d} style={days === d ? S.btnOn : S.btn} onClick={() => setDays(d)}>
            {d === 1 ? 'Last 24 hours' : `Last ${d} days`}
          </button>
        ))}
        <button style={S.btn} onClick={fetchData} disabled={loading}>Refresh</button>
      </div>

      {loading && <div style={S.loading}>Loading usage data...</div>}
      {error && (
        <div style={S.err}>
          <b>Error</b>
          <br />
          {error}
        </div>
      )}

      {raw && !loading && (
        <>
          <div style={S.cards}>
            <div style={S.card}><div style={S.cardL}>Total Tokens</div><div style={S.cardV}>{fmt(ts.TotalToken)}</div></div>
            <div style={S.card}><div style={S.cardL}>Input Tokens</div><div style={S.cardV}>{fmt(ts.InputTotalToken)}</div></div>
            <div style={S.card}><div style={S.cardL}>Output Tokens</div><div style={S.cardV}>{fmt(ts.OutputTotalToken)}</div></div>
            <div style={S.card}><div style={S.cardL}>Cache Tokens</div><div style={S.cardV}>{fmt(ts.CacheTotalToken)}</div></div>
          </div>

          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Usage by API Key</h2>
          {topList.length === 0 ? (
            <p style={{ color: '#999' }}>No usage data found for the selected period.</p>
          ) : (
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.th}>#</th>
                  <th style={S.th}>API Key Name</th>
                  <th style={S.th}>Total</th>
                  <th style={S.th}>Input</th>
                  <th style={S.th}>Output</th>
                  <th style={S.th}>Cache</th>
                </tr>
              </thead>
              <tbody>
                {topList.map((item, i) => {
                  const st = item.Stats || item;
                  return (
                    <tr key={i}>
                      <td style={S.td}>{i + 1}</td>
                      <td style={{ ...S.td, ...S.mono }}>{item.Name || item.Key || '---'}</td>
                      <td style={S.td}>{fmt(st.TotalToken)}</td>
                      <td style={S.td}>{fmt(st.InputTotalToken)}</td>
                      <td style={S.td}>{fmt(st.OutputTotalToken)}</td>
                      <td style={S.td}>{fmt(st.CacheTotalToken)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <details>
            <summary style={{ cursor: 'pointer', marginTop: 16, color: '#666', fontSize: 14 }}>
              Raw API Response
            </summary>
            <pre style={S.raw}>{JSON.stringify(raw, null, 2)}</pre>
          </details>
        </>
      )}
    </div>
  );
}

export default App;
