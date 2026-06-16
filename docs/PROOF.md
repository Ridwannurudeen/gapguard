# GapGuard Proof Notes

## What Is Built

GapGuard now has three executable proof surfaces:

- `npm run replay:proof` loads `data/tslax-replay.json`, runs the GapGuard pipeline, writes `glassbox-demo.jsonl`, and refreshes `public/dashboard-data.json`.
- `npm run verify-log` recomputes every `prevHash`/`hash` link in `glassbox-demo.jsonl`.
- `npm run probe:bitget` calls the Bitget Wallet API probe and writes `data/bitget-probe-report.json`.

The committed replay is intentionally marked `synthetic_sample`. It proves the engine, risk governor, proxy-confidence discount, and hash-chain audit trail. It is not live Bitget tokenized-stock performance evidence.

## Verified Bitget API Shape

Official Bitget Wallet docs checked on 2026-06-16:

- [Authentication](https://web3.bitget.com/en/docs/authentication): base URL is `https://bopenapi.bgwapi.io`; required headers are `x-api-key`, `x-api-timestamp`, and `x-api-signature`; signature is HMAC-SHA256 over sorted JSON payload, base64 encoded.
- [Market & Price](https://web3.bitget.com/en/docs/market/market-price): K-line endpoint is `POST /bgw-pro/market/v3/coin/getKline`.
- [Token](https://web3.bitget.com/en/docs/market/token): token info endpoint is `POST /bgw-pro/market/v3/coin/getBaseInfo`.
- [RWA Trading](https://web3.bitget.com/en/docs/trading/rwa): RWA trading reuses normal swap APIs; xStocks and Ondo are integrated through RWA token contracts.

Local unauthenticated probe result on 2026-06-16:

- `POST /bgw-pro/market/v3/coin/getBaseInfo` reached the production host
- Response: HTTP 400, `missing header x-api-key`
- Current proof status: `blocked_missing_credentials`

## Submission Position

Use the dashboard and hash-chain replay as the working demo today. Only upgrade claims to live Bitget tokenized-stock/off-hours proof after `data/bitget-probe-report.json` shows successful authenticated market data for the target contract.
