# Agent Arena - Submission Pack

**Bitget AI Base Camp Hackathon S1 - Track 2: Trading Infra**

Submission window: **Jun 15 - Jun 25, 2026 (UTC+8)**. Submit a demo link or GitHub repo plus the project description below. Do not submit without explicit approval.

---

## Project Description

Agent Arena is a licensing layer for autonomous trading agents. Instead of trusting a single LLM narrative, it makes agents earn a passport before any real capital is unlocked. Each candidate is scored on paper-trade evidence, live Bitget perception, drawdown, rule violations, adversarial debate, hash-chain verification, and hard execution controls.

Quorum is the flagship licensed agent inside the Arena: a five-role desk where Narrative, Positioning, Market Intel, Bear, and Risk opinions debate an RWA stock-perp trade. Consensus becomes the position multiplier; a Bear or Risk veto forces flat. The rejected baseline is a naive momentum bot that decides the same scenario, over-sizes, ignores conflicting evidence, and records a mandate breach.

Verification today: `npm run arena:demo` emits a passport artifact, Quorum decision, Naive breach record, simulated broker fill, and `public/arena-chain.jsonl`; `npm run rwa:check` writes public Bitget contract/ticker evidence for RWA status, spread, volume, and minimum order sizing. The Bitget Demo paper path is proven on `BTCUSDT`; the RWA graduation remains a separate, explicitly approved, capped live fill.
The judge cockpit at `public/arena.html` packages the leaderboard, five-agent debate, RWA market recheck, paper-order evidence, live gates, in-browser Arena-chain verification, and tamper simulation in one screen.

---

## Demo-Video Script

| Time      | Visual                                    | Narration                                                                                                                                     |
| --------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00-0:20 | `public/arena.html` leaderboard           | "The Arena does not trust trading agents by default. It makes them earn a license before any capital is unlocked."                            |
| 0:20-0:55 | Quorum five-agent decision                | "Narrative, Positioning, Market Intel, Bear, and Risk argue independently. Disagreement becomes the position multiplier; a veto forces flat." |
| 0:55-1:25 | Naive bot rejected                        | "The naive momentum bot sees the same path, over-sizes, ignores conflict, breaches the mandate, and is rejected from capital."                |
| 1:25-1:55 | `npm run arena:demo` + RWA market recheck | "Quorum earns a passport, but the Arena demo runs offline through a deterministic sim broker while live execution stays gated."              |
| 1:55-2:25 | Arena chain verify + tamper toggle        | "The cockpit recomputes the Arena chain in the browser. Toggle tampering and the exact broken row turns red."                                |
| 2:25-2:55 | Paper/live graduation                     | "Demo Trading proves the broker on BTCUSDT; with explicit approval only, one tiny capped RWA fill becomes the graduation artifact."           |
| 2:55-3:00 | Agent Arena tagline                       | "Agent Arena. Trading agents earn trust before they earn capital."                                                                            |

---

## Rubric Coverage

| Criterion                  | How Agent Arena meets it                                                                                                         | Status                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Real trading-infra problem | Agents need a licensing, monitoring, and capital-allocation layer before live execution.                                         | built                    |
| Verifiable usage record    | `artifacts/agent-arena-demo.json`, `public/arena-chain.jsonl`, browser verifier, `glassbox-demo.jsonl`, and dry-run broker path. | built                    |
| Uses Bitget data/tools     | Agent Hub order shape, proven Demo Trading path, public RWA contract/ticker recheck, Bitget Wallet probe, AAPLUSDT Playbook.    | paper proven; live gated |
| Runnability                | Offline Arena sim, local tests, dry-run broker, paper-trading path, and live path gated by license plus explicit confirmation.   | paper path proven        |
| Novelty/potential          | Debate-to-consensus passporting infrastructure with GapGuard as the first strategy exhibit and a rejected naive bot as contrast. | core implemented         |

---

## Executable Proof Commands

```bash
npm run arena:demo
npm run rwa:check
npm run arena:cockpit
npm run broker:order -- --mode dry_run
npm run replay:proof
npm run verify-log
npm run probe:bitget
```

Current generated artifacts:

- `artifacts/agent-arena-demo.json` - Arena passport, Quorum decision, rejected bot, and dry-run order
- `public/arena-chain.jsonl` - Arena-native chain for mandate rules, decisions, breaches, passports, and sim broker record
- `artifacts/order-dry-run.jsonl` - non-executed broker order record
- `artifacts/paper-btc-smoke.jsonl` - local ignored Bitget Demo BTCUSDT paper-order record with balance-before/after delta
- `public/rwa-market.json` - public Bitget RWA contract/ticker recheck and suggested minimum live size
- `public/arena-data.json` - sanitized Arena cockpit data
- `public/arena.html` - Arena cockpit with browser verification and tamper simulation
- `glassbox-demo.jsonl` - local ignored JSONL audit trail
- `public/dashboard-data.json` - dashboard data generated from the replay
- `public/dashboard.html` - static proof cockpit
- `data/bitget-probe-report.json` - live Bitget Wallet API probe result
- `docs/PROOF.md` - API source notes and proof scope

---

## Pre-Submission Checklist

- [x] Build proof replay, hash-chain verifier, dashboard, and Bitget API probe
- [x] Build Agent Arena passport, Quorum consensus, rejected naive bot, and dry-run broker artifact
- [x] Build Arena-native hash chain, browser verifier, and tamper simulation
- [x] Prove the Bitget Demo Trading paper path on BTCUSDT
- [x] Build the judge-facing Arena cockpit
- [ ] Obtain Bitget Wallet API credentials and rerun `npm run probe:bitget`
- [x] Capture a fresh paper BTCUSDT artifact with balance-before/after delta
- [x] Build public RWA liquidity/contract recheck (`NVDAUSDT` default, `SOXLUSDT` backup)
- [ ] Re-run `npm run rwa:check` immediately before any approved live fill
- [ ] If explicitly approved, execute one tiny capped live RWA fill and write `artifacts/live-trades.jsonl`
- [x] Repoint Playbook package to deterministic `AAPLUSDT` RWA perp managed-kline path and record the local public-kline probe
- [ ] Record demo video
- [ ] Publish dissemination thread and keep the link
- [ ] Decide submission artifact: GitHub repo link or demo URL
- [ ] Submit only after explicit approval
