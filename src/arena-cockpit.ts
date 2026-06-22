import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildArenaDemo, type ArenaDemoArtifact } from "./arena-demo";
import { attestChain, verifyAttestation, writeArenaChain } from "./arena-chain";
import {
  DEFAULT_PUBLIC_KEY_FILE,
  loadArenaSigningKey,
  readArenaPublicKey,
} from "./arenaSigning";
import type { AgentPassport } from "./agentArena";
import { extractOrderId, type BgcFuturesOrder } from "./liveStockBroker";
import type { DeskOpinion, QuorumDecision } from "./quorum";
import type { RwaMarketReport } from "./rwa-market";

type UnknownRecord = Record<string, unknown>;

export interface PaperTradeEvidence {
  ts: string;
  symbol: string;
  mode: "paper";
  side: string;
  size: number;
  referencePrice: number | null;
  orderId: string | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  balanceDelta: number | null;
  status: string;
}

export interface GapGuardProofSummary {
  ok: boolean;
  count: number;
  finalHash: string;
  proofScope: string;
}

export interface ArenaCockpitData {
  generatedAt: string;
  arena: ArenaDemoArtifact["arena"];
  status: {
    licensedAgents: number;
    paperOnlyAgents: number;
    rejectedAgents: number;
    paperEvidence: "proven" | "missing";
    liveStatus: "disabled_alpha_unproven" | "gated";
  };
  perception: ArenaDemoArtifact["perception"];
  evidence: ArenaDemoArtifact["evidence"];
  leaderboard: AgentPassport[];
  quorum: QuorumDecision;
  debate: DeskOpinion[];
  broker: {
    dryRunOrder: BgcFuturesOrder;
    dryRunNotionalUSDT: number;
    paperTrade: PaperTradeEvidence | null;
    liveGate: string[];
  };
  rwaMarket: RwaMarketReport | null;
  arenaChain: {
    path: string;
    ok: boolean;
    count: number;
    finalHash: string;
    errors: string[];
  };
  gapguardProof: GapGuardProofSummary | null;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function semanticSide(order: UnknownRecord): string {
  const side = readString(order.side);
  const tradeSide = readString(order.tradeSide);
  if (side === "buy" && tradeSide === "open") return "open_long";
  if (side === "sell" && tradeSide === "open") return "open_short";
  if (side === "buy" && tradeSide === "close") return "close_long";
  if (side === "sell" && tradeSide === "close") return "close_short";
  return side ?? "unknown";
}

export function parsePaperTradeRow(value: unknown): PaperTradeEvidence | null {
  const row = asRecord(value);
  const result = asRecord(row.result);
  const plan = asRecord(result.plan);
  const order = asRecord(plan.order);
  const symbol = readString(row.symbol) ?? readString(order.symbol);
  const mode = readString(row.mode) ?? readString(plan.mode);
  const status = readString(result.status);
  const size = readNumber(row.size) ?? readNumber(order.size);
  const notional = readNumber(plan.notionalUSDT);
  const referencePrice =
    readNumber(row.referencePrice) ??
    (size !== null && notional !== null ? notional / size : null);

  if (!symbol || mode !== "paper" || !status || size === null) return null;

  const stdout = readString(result.stdout);
  return {
    ts: readString(row.ts) ?? "",
    symbol,
    mode: "paper",
    side: readString(row.side) ?? semanticSide(order),
    size,
    referencePrice,
    orderId:
      readString(row.orderId) ?? (stdout ? extractOrderId(stdout) : null),
    balanceBefore: readNumber(row.balanceBefore),
    balanceAfter: readNumber(row.balanceAfter),
    balanceDelta: readNumber(row.balanceDelta),
    status,
  };
}

export function readLatestPaperTrade(path: string): PaperTradeEvidence | null {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parsePaperTradeRow(JSON.parse(lines[i]));
    if (parsed) return parsed;
  }
  return null;
}

export function readGapGuardProof(path: string): GapGuardProofSummary | null {
  if (!existsSync(path)) return null;
  const data = asRecord(JSON.parse(readFileSync(path, "utf8")));
  const dataset = asRecord(data.dataset);
  const summary = asRecord(data.summary);
  const verification = asRecord(summary.verification);
  const ok = verification.ok;
  const count = readNumber(verification.count);
  const finalHash = readString(verification.finalHash);
  const proofScope = readString(dataset.proofScope);

  if (typeof ok !== "boolean" || count === null || !finalHash || !proofScope) {
    return null;
  }
  return { ok, count, finalHash, proofScope };
}

export function readRwaMarketReport(path: string): RwaMarketReport | null {
  if (!existsSync(path)) return null;
  const data = asRecord(JSON.parse(readFileSync(path, "utf8")));
  const rows = data.rows;
  const defaultLiveSymbol = readString(data.defaultLiveSymbol);
  const maxNotionalUSDT = readNumber(data.maxNotionalUSDT);

  if (!Array.isArray(rows) || !defaultLiveSymbol || maxNotionalUSDT === null) {
    return null;
  }
  return data as unknown as RwaMarketReport;
}

export function buildArenaCockpitData(
  artifact: ArenaDemoArtifact,
  paperTrade: PaperTradeEvidence | null,
  gapguardProof: GapGuardProofSummary | null,
  rwaMarket: RwaMarketReport | null = null,
): ArenaCockpitData {
  return {
    generatedAt: new Date().toISOString(),
    arena: artifact.arena,
    status: {
      licensedAgents: artifact.passports.filter((p) => p.grade === "LICENSED")
        .length,
      paperOnlyAgents: artifact.passports.filter((p) => p.grade === "PAPER_ONLY")
        .length,
      rejectedAgents: artifact.passports.filter((p) => p.grade === "REJECTED")
        .length,
      paperEvidence: paperTrade ? "proven" : "missing",
      liveStatus:
        artifact.evidence.backtest.alphaStatus === "positive"
          ? "gated"
          : "disabled_alpha_unproven",
    },
    perception: artifact.perception,
    evidence: artifact.evidence,
    leaderboard: artifact.passports,
    quorum: artifact.quorumDecision,
    debate: artifact.quorumDecision.opinions,
    broker: {
      dryRunOrder: artifact.graduationDryRun.plan.order,
      dryRunNotionalUSDT: artifact.graduationDryRun.plan.notionalUSDT,
      paperTrade,
      liveGate: [
        "LICENSED passport",
        "explicit --confirm-live",
        "isolated margin",
        "1x leverage",
        "notional cap <= 20 USDT",
        "manual approval before real funds",
      ],
    },
    rwaMarket,
    arenaChain: {
      path: artifact.arenaChain.path,
      ok: artifact.arenaChain.verification.ok,
      count: artifact.arenaChain.verification.count,
      finalHash: artifact.arenaChain.verification.finalHash,
      errors: artifact.arenaChain.verification.errors,
    },
    gapguardProof,
  };
}

export async function runArenaCockpitCli(): Promise<void> {
  const paperPath = resolve(
    process.argv[2] ?? "artifacts/paper-btc-smoke.jsonl",
  );
  const proofPath = resolve(process.argv[3] ?? "public/dashboard-data.json");
  const out = resolve(process.argv[4] ?? "public/arena-data.json");
  const chainOut = resolve(process.argv[5] ?? "public/arena-chain.jsonl");
  const rwaPath = resolve(
    process.env.ARENA_RWA_MARKET_PATH ?? "public/rwa-market.json",
  );
  const attestOut = resolve(process.argv[6] ?? "public/arena-attestation.json");
  const publicKeyPath = resolve(process.argv[7] ?? DEFAULT_PUBLIC_KEY_FILE);
  const signingKey = loadArenaSigningKey();
  if (!signingKey) {
    throw new Error(
      "Arena attestation requires ARENA_SIGNING_KEY or .arena-signing-key.pem; run npm run arena:keygen first",
    );
  }
  const publicKey = readArenaPublicKey(publicKeyPath);
  const artifact = await buildArenaDemo();
  writeArenaChain(chainOut, artifact.arenaChain.records);

  const attestation = attestChain(artifact.arenaChain.records, {
    signedAt: new Date().toISOString(),
    model: "qwen3.6-plus (desk) + deterministic (gap core)",
    privateKey: signingKey,
  });
  mkdirSync(dirname(attestOut), { recursive: true });
  writeFileSync(attestOut, `${JSON.stringify(attestation, null, 2)}\n`);
  const attestationCheck = verifyAttestation(
    artifact.arenaChain.records,
    attestation,
    { publicKey },
  );
  if (!attestationCheck.ok) {
    throw new Error(
      `Arena attestation failed verification against ${publicKeyPath}`,
    );
  }
  console.log(
    `Arena attestation (Ed25519 over Merkle root ${attestation.merkleRoot.slice(0, 12)}…): ${attestOut} — self-verify ${attestationCheck.ok ? "OK" : "FAILED"}`,
  );

  const data = buildArenaCockpitData(
    artifact,
    readLatestPaperTrade(paperPath),
    readGapGuardProof(proofPath),
    readRwaMarketReport(rwaPath),
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Agent Arena cockpit data: ${out}`);
}

if (process.argv[1]?.endsWith("arena-cockpit.ts")) {
  await runArenaCockpitCli();
}
