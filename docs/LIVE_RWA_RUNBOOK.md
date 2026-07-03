# Live RWA Stock-Perp Round-Trip — Runbook

The highest-credibility gap in GapGuard's Track-3 evidence is that every
tokenized-stock trade to date is simulated or paper: the only real on-exchange
fill is a BTCUSDT Bitget Demo smoke test (crypto proxy). This runbook is the
safe, tested path to close that gap with **one real, tiny, reversible fill** on
an RWA stock perp, sealed into the signed audit chain as genuine Track-3
execution evidence.

> **Boundary.** The engine builds, gates, and records the round-trip. The actual
> live fill is **user-executed and approval-gated** — no live real-money order is
> ever placed autonomously. Everything below defaults to `dry_run`; live requires
> explicit flags and a funded key.

## What "reversible round-trip" means

`src/rwaRoundTrip.ts` (`npm run broker:rwa-roundtrip`) opens a tiny position and
immediately closes it, so net exposure returns to zero within seconds. It:

1. Sizes against the live RWA market row (min size, min notional, spread).
2. Opens (`open_long`/`open_short`) and polls for the fill.
3. Refuses the close leg if the open did not fill (live mode).
4. Closes the leg (`close_long`/`close_short`).
5. Optionally seals an `LIVE_RWA_ROUND_TRIP` `broker_order` record into
   `public/arena-chain.jsonl`, re-computes the Merkle root, and re-signs the
   Ed25519 attestation — then verifies it before writing.

`clientOid`s are derived from a required `--client-oid-prefix` and are refused if
already present in the output log, so a re-run cannot double-submit.

## Hard gates (enforced server-side, verified in code)

Live mode fails closed unless **all** hold:

| Gate | Where | Value |
| --- | --- | --- |
| Passport grade is `LICENSED` | `liveStockBroker.ts:184` | drawdown ≤ 8%, leverage ≤ 2 (`agentArena.ts:62-63`) |
| `--confirm-live` present | `liveStockBroker.ts:187` | explicit opt-in |
| Isolated margin | `liveStockBroker.ts:190` | `marginMode: "isolated"` |
| Leverage ≤ license cap | `liveStockBroker.ts:193` | round-trip hardcodes leverage `1` |
| Notional ≤ min(cap, license) | `liveStockBroker.ts:198-206` | default cap `$10` (`RWA_ROUND_TRIP_MAX_NOTIONAL_USDT`) |
| Market row is `liveReady` | `rwaRoundTrip.ts:249` | no contract/pricing/sizing blockers |
| Balance ≥ notional | `rwaRoundTrip.ts:367` | read via `broker:balance` before opening |
| Open filled before close | `rwaRoundTrip.ts:381` | refuses close leg otherwise |

## Open question, answered honestly: can you open while the US market is closed?

Bitget's docs conflict on whether an RWA stock perp accepts a **new** open while
the underlying cash market is closed (mark can freeze toward an EMA during
closures). The read-only probe below is what we can confirm without placing an
order; the fill itself is the only definitive proof.

**Read-only probe, 2026-07-03 07:49 UTC (~03:49 ET, US cash market closed):**

```
npm run rwa:check   # read-only public Bitget API, writes public/rwa-market.json
```

- `NVDAUSDT`: `symbolStatus: normal`, two-sided book bid 196.60 / ask 196.61
  (spread 0.51 bps), `markPrice` 196.57 tracking `indexPrice` 196.53 within ~2 bps
  (not frozen far from index), `fundingRate: 0`, `liveReady: true`, `blockers: []`,
  suggested size 0.03 → **$5.90 notional**.
- **11 of 12** tracked RWA perps were `liveReady` with the cash market closed.

**Interpretation.** At the contract level the perp quotes a live, tight,
non-frozen book off-hours, so `liveReady` is session-agnostic by design
(`rowBlockers` checks RWA flag, contract status, price, bid/ask, and min-size —
never the US session). That is necessary but **not sufficient**: only a real
place-order proves the matching engine accepts an open during closure. The
round-trip is built to test exactly that, safely, with a ~$6 reversible position.
If Bitget rejects the open during closure, the tool surfaces the rejection code
and places nothing (`liveStockBroker.ts:527`).

## Procedure

Prerequisites: `BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_PASSPHRASE` in the
environment (never in `public/*`, never committed), a funded USDT-M futures
balance, and `ARENA_SIGNING_KEY` (or `.arena-signing-key.pem`) for the chain seal.

```bash
# 1. Refresh the live market row (read-only) and confirm liveReady + sizing.
npm run rwa:check

# 2. Confirm a readable, sufficient futures balance (read-only, never orders).
npm run broker:balance -- --mode live

# 3. Dry run: build and size the exact round-trip, place nothing.
npm run broker:rwa-roundtrip -- --symbol NVDAUSDT --side long \
  --max-notional 10 --client-oid-prefix ggr-$(date +%s)

# 4. LIVE round-trip (user-executed, approval-gated): open tiny -> poll fill ->
#    close -> seal + re-attest the signed chain. Requires --confirm-live.
npm run broker:rwa-roundtrip -- --mode live --confirm-live \
  --symbol NVDAUSDT --side long --max-notional 10 \
  --client-oid-prefix ggr-$(date +%s) --append-chain

# 5. Verify the new receipt in the chain (and in the browser at /arena.html).
npm run verify-log -- public/arena-chain.jsonl
```

## Done when

A real RWA-stock fill receipt — timestamp, asset, direction, price, quantity,
balance change — exists in `public/arena-chain.jsonl` and verifies in the
browser cockpit. At that point the Track-3 evidence is no longer 100% simulated:
the exchange path is proven on the actual asset class, under hard caps, with a
tamper-evident receipt anyone can re-verify.
