# Agent Arena Build Plan

## Product Thesis

Agent Arena turns GapGuard into a Track 2 trading-infrastructure project: autonomous agents do not get trusted by default. They compete for a passport, and only a passport graded `LICENSED` can graduate from simulation into one capped, supervised RWA perp fill.

Quorum is the flagship agent inside the Arena. It earns the license by combining GapGuard's deterministic risk governor, adversarial debate, paper-trade evidence, read-only Bitget perception, and a hash-chained record. A naive single-agent narrative bot is structurally barred from real money.

## Evidence Stack

1. Real-funds fill on a liquid RWA USDT perp after dry-run, explicit approval, and `--confirm-live`.
2. Bitget Demo Trading paper-trade log through Agent Hub's `--paper-trading` mode.
3. Playbook backtest baseline for the RWA thesis.
4. Tamper-evident simulated ledger from the existing GapGuard glass-box.
5. Live read-only RWA market perception from Bitget public and authenticated APIs.

Current default live-fill candidate: `NVDAUSDT`. The liquidity-first backup is `SOXLUSDT`. Re-check contracts/tickers immediately before any real order.

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
- Run the dry-run broker path; confirm the intended order payload before any paper/live execution.

### Phase 1 - Arena Passport

- `src/agentArena.ts` grades agents as `LICENSED`, `PAPER_ONLY`, or `REJECTED`.
- `src/quorum.ts` converts role-specialized opinions into a consensus score, veto flag, and position multiplier.
- Quorum must pass evidence checks: paper trades, live read, hash-chain verification, drawdown limits, no rule violations, and debate rounds.
- Controls must pass: risk governor, adversarial review, human live confirmation, kill-switch, isolated margin, capped notional, and low leverage.

### Phase 2 - Broker Graduation

- `src/liveStockBroker.ts` builds the Agent Hub `bgc futures futures_place_order` call.
- `dry_run` returns the intended order without execution.
- `paper` adds `--paper-trading` and requires Bitget demo credentials.
- `live` is blocked unless the passport is `LICENSED`, `confirmLive` is true, the order is under cap, and the safety constitution passes.

### Phase 3 - Judge Demo

- Show the Arena leaderboard: Quorum licensed, naive bot rejected.
- Show Quorum's debate, consensus score, dissent, veto status, and risk multiplier.
- Click verify on the hash chain.
- Run the broker dry-run payload for `NVDAUSDT`.
- Package the leaderboard, debate, broker rail, paper evidence, and hash-chain status in `public/arena.html`.
- If explicitly approved and the paper path has passed, execute one tiny supervised fill and write the resulting order ID/timestamp to `artifacts/live-trades.jsonl`.

## Must Ship

- Arena passport artifact.
- Dry-run broker artifact.
- Paper-trading order log if Demo API credentials are available.
- Existing GapGuard hash-chain dashboard and verifier.
- Static Arena cockpit.
- README/submission copy reframed as Agent Arena with GapGuard as the flagship exhibit.
