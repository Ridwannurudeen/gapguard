import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  BITGET_WALLET_BASE_URL,
  authFromEnv,
  postBitget,
  type BitgetAuth,
} from "./bitgetWalletApi";
import { classifySession } from "./marketClock";

const BASE_INFO_PATH = "/bgw-pro/market/v3/coin/getBaseInfo";
const KLINE_PATH = "/bgw-pro/market/v3/coin/getKline";
const TX_INFO_PATH = "/bgw-pro/market/v3/coin/getTxInfo";
const QUOTE_PATH = "/bgw-pro/swapx/pro/quote";

export interface ProbeTarget {
  productSymbol: string;
  underlyingSymbol: string;
  venue: string;
  chain: string;
  chainId: number;
  contract: string;
  contractStatus: "candidate" | "user_supplied";
}

export interface ProbeEndpointResult {
  name: string;
  path?: string;
  ok: boolean;
  skipped?: boolean;
  statusCode?: number;
  message: string;
  metrics?: Record<string, string | number | boolean>;
}

export interface ProbeReport {
  generatedAt: string;
  baseUrl: string;
  credentialsPresent: boolean;
  target: ProbeTarget;
  endpoints: ProbeEndpointResult[];
  proofStatus:
    | "live_bitget_verified"
    | "blocked_missing_credentials"
    | "blocked_target_or_api"
    | "partial";
  conclusion: string;
  nextAction: string;
}

function targetFromEnv(env: NodeJS.ProcessEnv): ProbeTarget {
  const userContract = env.GAPGUARD_TARGET_CONTRACT;
  return {
    productSymbol: env.GAPGUARD_PRODUCT_SYMBOL ?? "TSLAx",
    underlyingSymbol: env.GAPGUARD_UNDERLYING_SYMBOL ?? "TSLA",
    venue: env.GAPGUARD_TARGET_VENUE ?? "Bitget Wallet RWA / xStocks",
    chain: env.GAPGUARD_TARGET_CHAIN ?? "sol",
    chainId: Number(env.GAPGUARD_TARGET_CHAIN_ID ?? "100278"),
    contract: userContract ?? "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    contractStatus: userContract ? "user_supplied" : "candidate",
  };
}

function messageFromResponse(statusCode: number, bodyText: string): string {
  if (!bodyText) return `HTTP ${statusCode}`;
  return bodyText.length > 180
    ? `${bodyText.slice(0, 177).trim()}...`
    : bodyText.trim();
}

function getDataList(json: unknown): unknown[] {
  if (!json || typeof json !== "object") return [];
  const data = (json as { data?: unknown }).data;
  if (!data || typeof data !== "object") return [];
  const list = (data as { list?: unknown }).list;
  return Array.isArray(list) ? list : [];
}

function klineMetrics(
  list: unknown[],
): Record<string, string | number | boolean> {
  let closedMarketBars = 0;
  let regularBars = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const ts = (item as { ts?: unknown }).ts;
    if (typeof ts !== "number") continue;
    const session = classifySession(new Date(ts * 1000));
    if (session.underlyingOpen) regularBars += 1;
    else closedMarketBars += 1;
  }
  return {
    bars: list.length,
    regularBars,
    closedMarketBars,
    hasClosedMarketBars: closedMarketBars > 0,
  };
}

async function runEndpoint<TBody extends object>(
  name: string,
  path: string,
  body: TBody,
  auth: BitgetAuth | undefined,
  baseUrl: string,
): Promise<ProbeEndpointResult> {
  try {
    const res = await postBitget(path, body, { auth, baseUrl });
    const ok =
      res.statusCode === 200 &&
      typeof res.json === "object" &&
      res.json !== null &&
      ((res.json as { status?: unknown }).status === 0 ||
        (res.json as { code?: unknown }).code === 0);
    const list = path === KLINE_PATH ? getDataList(res.json) : [];
    return {
      name,
      path,
      ok,
      statusCode: res.statusCode,
      message: ok
        ? "success"
        : messageFromResponse(res.statusCode, res.bodyText),
      ...(list.length > 0 ? { metrics: klineMetrics(list) } : {}),
    };
  } catch (err) {
    return {
      name,
      path,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function quoteBodyFromEnv(env: NodeJS.ProcessEnv, target: ProbeTarget) {
  const fromChain = env.GAPGUARD_QUOTE_FROM_CHAIN;
  const fromContract = env.GAPGUARD_QUOTE_FROM_CONTRACT;
  const fromAmount = env.GAPGUARD_QUOTE_FROM_AMOUNT;
  if (!fromChain || !fromContract || !fromAmount) return undefined;
  return {
    fromAmount,
    fromChain,
    fromContract,
    fromSymbol: env.GAPGUARD_QUOTE_FROM_SYMBOL ?? "USDC",
    toChain: target.chain,
    toContract: target.contract,
    toSymbol: target.productSymbol,
  };
}

export async function buildProbeReport(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProbeReport> {
  const auth = authFromEnv(env);
  const target = targetFromEnv(env);
  const baseUrl = env.BITGET_WALLET_API_BASE_URL ?? BITGET_WALLET_BASE_URL;

  const endpoints: ProbeEndpointResult[] = [];
  endpoints.push(
    await runEndpoint(
      "token-base-info",
      BASE_INFO_PATH,
      { chain: target.chain, contract: target.contract },
      auth,
      baseUrl,
    ),
  );
  endpoints.push(
    await runEndpoint(
      "token-kline-1m",
      KLINE_PATH,
      {
        chain: target.chain,
        contract: target.contract,
        period: "1m",
        size: 240,
      },
      auth,
      baseUrl,
    ),
  );
  endpoints.push(
    await runEndpoint(
      "token-tx-info",
      TX_INFO_PATH,
      { chain: target.chain, contract: target.contract },
      auth,
      baseUrl,
    ),
  );

  const quoteBody = quoteBodyFromEnv(env, target);
  if (quoteBody) {
    endpoints.push(
      await runEndpoint("rwa-quote", QUOTE_PATH, quoteBody, auth, baseUrl),
    );
  } else {
    endpoints.push({
      name: "rwa-quote",
      path: QUOTE_PATH,
      ok: false,
      skipped: true,
      message:
        "set GAPGUARD_QUOTE_FROM_CHAIN, GAPGUARD_QUOTE_FROM_CONTRACT, and GAPGUARD_QUOTE_FROM_AMOUNT to probe executable routing",
    });
  }

  const readChecks = endpoints.filter((e) => e.name !== "rwa-quote");
  const liveReadOk = readChecks.every((e) => e.ok);
  const proofStatus = liveReadOk
    ? "live_bitget_verified"
    : auth
      ? "blocked_target_or_api"
      : "blocked_missing_credentials";

  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    credentialsPresent: Boolean(auth),
    target,
    endpoints,
    proofStatus,
    conclusion: liveReadOk
      ? "Bitget Wallet market data returned successfully for the target token."
      : "Live Bitget tokenized-stock proof is not available from this run.",
    nextAction: liveReadOk
      ? "Use the returned K-line/session metrics as the source for a real replay."
      : auth
        ? "Check the target contract/chain or API entitlement, then rerun the probe."
        : "Set BITGET_WALLET_API_KEY and BITGET_WALLET_API_SECRET, verify the target contract, then rerun npm run probe:bitget.",
  };
}

export async function runProbeCli(): Promise<void> {
  const out = resolve(process.argv[2] ?? "data/bitget-probe-report.json");
  const report = await buildProbeReport();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Bitget proof status: ${report.proofStatus}`);
  console.log(`Report written: ${out}`);
}

if (process.argv[1]?.endsWith("bitgetProbe.ts")) {
  await runProbeCli();
}
