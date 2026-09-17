# OC Token Meter

A web app that displays Tencent Cloud **TokenHub** token usage for external customers.

External customers use models and tokens provided via TokenHub, but they don't have Tencent Cloud CAM accounts. This app lets them view their token consumption through a standalone web interface.

## Architecture

```
External Customer ──(sk-... API Key)──→ TokenHub Data Plane API (model calls)
                                              ↓ generates token usage
This Web App Frontend ──→ Netlify Function (/api/usage)
                              ↓ signs request with CAM SecretId/SecretKey
                         DescribeUsageRankList (Dimension=apikey)
                              ↓
                         Returns per-API-Key token usage
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your Tencent Cloud CAM credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `TENCENTCLOUD_SECRET_ID` | CAM SecretId from https://console.cloud.tencent.com/cam/capi |
| `TENCENTCLOUD_SECRET_KEY` | CAM SecretKey from the same page |
| `TENCENTCLOUD_REGION` | TokenHub region (default: `ap-singapore` for international) |

### 3. Run locally

```bash
npx netlify dev
```

This starts both the React frontend (port 3000) and Netlify Functions (proxied on port 8888).

### 4. Deploy to Netlify

Push to your Git repo connected to Netlify, or run `npx netlify deploy`.

Set the same environment variables in **Netlify → Site settings → Environment variables**.

## Tech Stack

- **Frontend**: React 18 (Create React App)
- **Backend**: Netlify Functions (Node.js)
- **API**: Tencent Cloud TokenHub Control Plane API (`tokenhub.intl.tencentcloudapi.com`)
- **Auth**: TC3-HMAC-SHA256 signature (manual implementation)