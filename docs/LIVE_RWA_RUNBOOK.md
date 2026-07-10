# Manual RWA Stock-Perp Round-Trip — Runbook

This is the manual diagnostic path that produced GapGuard's historical live
AAPLUSDT open/close receipt. It remains useful for an operator-approved, tiny,
immediately closed RWA stock-perp round trip and seals the result into the signed
audit chain. It is not the scheduled autonomous entrypoint.

> **Boundary.** This command remains user-executed: it defaults to `dry_run`,
> takes an explicit side, and requires `--confirm-live`. GapGuard also has a
> separate default-off autonomous runner that derives direction from Quorum and
> can place live entries after VPS-side arming. That runner separately requires
> a complete spread below 25bps and uses a fill-or-kill limit at the executable
> quote; see `deploy/DEPLOY.md`.

## What "reversible round-trip" means

`src/rwaRoundTrip.ts` (`npm run broker:rwa-roundtrip`) opens a tiny position and
immediately closes it, so net exposure returns to zero within seconds. It:

1. Sizes against the live RWA market row (min size, min notional, spread).
2. Opens (`open_long`/`open_short`) and polls for the fill.
3. Refuses the close leg if the open did not fill (live mode).
4. Closes the leg (`close_long`/`close_short`).
5. Optionally seals a `LIVE_RWA_ROUND_TRIP` `broker_order` record into
   `public/arena-chain.jsonl`, re-computes the Merkle root, and re-signs the
   Ed25519 attestation — then verifies it before writing.

`clientOid`s are derived from a required `--client-oid-prefix` and are refused if
already present in the output log, so a re-run cannot double-submit.

## Hard gates (enforced server-side, verified in code)

Live mode fails closed unless **all** hold:

| Gate | Where | Value |
| --- | --- | --- |
| Passport grade is `LICENSED` | `liveStockBroker.ts` passport gate | drawdown ≤ 8%, leverage ≤ 2 |
| `--confirm-live` present | `liveStockBroker.ts` live authorization gate | explicit opt-in |
| Isolated margin | `liveStockBroker.ts` broker validation | `marginMode: "isolated"` |
| Leverage ≤ license cap | `rwaRoundTrip.ts` broker config | round-trip hardcodes leverage `1` |
| Notional ≤ min(cap, license) | `buildRwaRoundTripSpec` + broker validation | default cap `$10` (`RWA_ROUND_TRIP_MAX_NOTIONAL_USDT`) |
| Market row is `liveReady` | `buildRwaRoundTripSpec` | no contract/pricing/sizing blockers |
| Balance ≥ notional | `runRwaRoundTrip` | read via `broker:balance` before opening |
| Open filled before close | `runRwaRoundTrip` | refuses close leg otherwise |

## Off-hours acceptance: observed once, not guaranteed

Bitget's public data showed an active off-hours book, and the historical live
round trip proves that the matching path accepted one real RWA stock-perp open
and close. That single receipt is not a guarantee that every symbol or future
session will accept a new open, so the current `liveReady` and broker gates still
apply on every invocation.

**Read-only probe, 2026-07-03 07:49 UTC (~03:49 ET, US cash market closed):**

```
npm run rwa:check   # read-only public Bitget API, writes public/rwa-market.json
```

- `NVDAUSDT`: `symbolStatus: normal`, two-sided book bid 196.60 / ask 196.61
  (spread 0.51 bps), `markPrice` 196.57 tracking `indexPrice` 196.53 within ~2 bps
  (not frozen far from index), `fundingRate: 0`, `liveReady: true`, `blockers: []`,
  suggested size 0.03 → **$5.90 notional**.
- **11 of 12** tracked RWA perps were `liveReady` with the cash market closed.

**Interpretation.** At the contract level the perp quoted a live, tight,
non-frozen book off-hours, so `liveReady` is session-agnostic by design
(`rowBlockers` checks RWA flag, contract status, price, bid/ask, and min-size —
never the US session). That remains necessary but **not sufficient** for a future
order: the round-trip tests the current matching path with a tiny reversible
position. If Bitget rejects the open, the tool surfaces the rejection and
refuses the close leg because no position was filled.

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

## Historical completion criterion

The criterion was met when a real RWA-stock receipt — timestamp, asset,
direction, price, quantity, and balance change — was recorded and verified. A
future manual diagnostic run is complete only when its new receipt also exists
in `public/arena-chain.jsonl` and verifies in the browser cockpit.
