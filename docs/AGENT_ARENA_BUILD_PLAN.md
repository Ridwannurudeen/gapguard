# Agent Arena Build Plan

> Historical design record. This plan predates the default-off autonomous
> runner and the recorded live AAPLUSDT round trip; its approval-gated and
> “no live fill” statements describe the earlier build stage, not current
> behavior. See `README.md` and `deploy/DEPLOY.md` for the current safety model.

## Product Thesis

GapGuard is the Track 3 product. Agent Arena is its trust and execution-control layer: agents do not get trusted by default, and a passport only unlocks an approval-gated path beyond simulation.

Quorum is the internal five-role deterministic adversarial desk. It earns approval-gated status by combining GapGuard's deterministic risk governor, adversarial debate, paper-trade evidence, read-only Bitget perception, and an Arena-native hash-chained record. A naive single-signal momentum bot is structurally barred from real money because its own recorded decision breaches the mandate.

## Evidence Stack

1. Approval-gated future real-funds path on a liquid RWA USDT perp after dry-run, explicit approval, and `--confirm-live`; no live stock fill is claimed by current artifacts.
2. Bitget Demo Trading paper-trade log through Agent Hub's `--paper-trading` mode.
3. Playbook backtest package for the `AAPLUSDT` RWA perp managed-kline path.
4. Tamper-evident Arena ledger plus the existing GapGuard glass-box replay.
5. Live read-only RWA market perception from Bitget public and authenticated APIs.

Current default live-fill candidate: `NVDAUSDT`. The liquidity-first backup is `SOXLUSDT`. `npm run rwa:check` writes the public contract/ticker recheck and computes the suggested minimum live size; rerun it immediately before any real order.

## Safety Constitution

- Live orders require a passport with grade `LICENSED`.
- Live orders require `--confirm-live`; dry-run is the default path.
- `LIVE_MAX_NOTIONAL_USDT` is capped at or below 20.
- Margin must be isolated.
- Leverage is limited to 1-2x.
- A flatten/kill-switch path must exist before real capital is used.
- No live order or hackathon submission is executed without explicit user approval.

## Local Build Phases

### Phase 0 - Credentials And Proof Path

- Provision Bitget Demo API key with Trade permission.
- Provision Qwen key and read-data credentials.
- Keep live Trade key separate and unfunded until paper path passes.
- Run `npm run arena:demo` to generate `artifacts/agent-arena-demo.json`.
- Confirm `public/arena-chain.jsonl` verifies in the browser and catches simulated tampering.
- Run `npm run rwa:check` to generate `public/rwa-market.json` from Bitget public USDT-Futures data.
- Run the dry-run broker path; confirm the intended order payload before any paper/live execution.

### Phase 1 - Arena Passport

- `src/agentArena.ts` grades agents as `LICENSED`, `PAPER_ONLY`, or `REJECTED`.
- `src/quorum.ts` converts role-specialized opinions into a consensus score, veto flag, and position multiplier.
- `src/mandate.ts` compiles the English risk constitution into enforced caps and veto predicates.
- `src/arena-chain.ts` seals mandate rules, decisions, breaches, passports, and broker records.
- Quorum must pass evidence checks: paper trades, live read, hash-chain verification, drawdown limits, no rule violations, and debate rounds.
- Controls must pass: risk governor, adversarial review, human live confirmation, kill-switch, isolated margin, capped notional, and low leverage.

### Phase 2 - Broker Graduation

- `src/liveStockBroker.ts` builds the Agent Hub `bgc futures futures_place_order` call.
- `src/simBroker.ts` is the default Arena/test broker so the demo runs offline without Bitget credentials.
- `dry_run` returns the intended order without execution.
- `paper` adds `--paper-trading` and requires Bitget demo credentials.
- `live` is blocked unless the passport is `LICENSED`, `confirmLive` is true, the order is under cap, and the safety constitution passes.
- Dry/live defaults use a minimum-safe `NVDAUSDT` size; paper defaults stay on a tiny `BTCUSDT` crypto order.

### Phase 3 - Judge Demo

- Show the Arena leaderboard: Quorum licensed, naive bot rejected.
- Show Quorum's debate, consensus score, dissent, veto status, and risk multiplier.
- Click verify on the Arena hash chain, then simulate tampering and show the broken row.
- Run the broker dry-run payload for `NVDAUSDT`.
- Show the RWA market recheck: RWA flag, normal status, spread, volume, minimum size, and liquidity backup.
- Package the leaderboard, debate, broker rail, paper evidence, and hash-chain status in `public/arena.html`.
- If explicitly approved and the paper path has passed, execute one tiny supervised fill and write the resulting order ID/timestamp to `artifacts/live-trades.jsonl`.

## Must Ship

- Arena passport artifact.
- Arena-native chain artifact and browser verifier.
- Dry-run broker artifact.
- Offline sim broker artifact.
- Public RWA market recheck artifact.
- Paper-trading order log if Demo API credentials are available.
- Existing GapGuard hash-chain dashboard and verifier.
- Interactive Arena cockpit.
- `AAPLUSDT` RWA perp Playbook package with probe record and local validation.
- README/submission copy framed as GapGuard first; Quorum is the internal desk and Agent Arena/Passport is the trust gate.
