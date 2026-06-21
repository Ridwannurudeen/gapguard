import {
  bitgetCredentialsPresent,
  defaultBgcInvocation,
  runCommand,
  type CommandRunner,
} from "./liveStockBroker";

// Read-only futures balance check. Bitget's `get_account_assets` requires
// `productType` (and `coin`) for the futures account, which is easy to mistype —
// this wraps the exact, verified query. It NEVER places an order and NEVER
// prints credentials (the CLI reads them from the environment).

export type BalanceMode = "paper" | "live";

export interface BalanceCliArgs {
  mode: BalanceMode;
  coin: string;
  productType: string;
}

function valueAfter(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseBalanceArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): BalanceCliArgs {
  let mode: BalanceMode = "paper";
  let coin = env.ARENA_BALANCE_COIN ?? "USDT";
  let productType = env.ARENA_BALANCE_PRODUCT_TYPE ?? "USDT-FUTURES";

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--mode") {
      const value = valueAfter(argv, i, flag);
      if (value !== "paper" && value !== "live") {
        throw new Error("--mode must be paper or live");
      }
      mode = value;
      i += 1;
    } else if (flag === "--coin") {
      coin = valueAfter(argv, i, flag);
      i += 1;
    } else if (flag === "--product-type") {
      productType = valueAfter(argv, i, flag);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }

  return { mode, coin, productType };
}

export function buildBalanceArgs(
  args: BalanceCliArgs,
  argsPrefix: string[],
): string[] {
  return [
    ...argsPrefix,
    ...(args.mode === "paper" ? ["--paper-trading"] : []),
    "account",
    "get_account_assets",
    "--accountType",
    "futures",
    "--productType",
    args.productType,
    "--coin",
    args.coin,
    "--pretty",
  ];
}

/** First top-level `available` value in a balance response, or null. */
export function parseAvailable(stdout: string): number | null {
  const match = stdout.match(/"available"\s*:\s*"?([0-9.]+)"?/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Read the available USDT-Futures balance as a number (best-effort, read-only).
 * Returns null if the query fails so callers can record evidence without
 * breaking the order flow.
 */
export async function readFuturesAvailable(
  mode: BalanceMode,
  runner: CommandRunner = runCommand,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number | null> {
  const invocation = defaultBgcInvocation();
  const args = buildBalanceArgs(
    {
      mode,
      coin: env.ARENA_BALANCE_COIN ?? "USDT",
      productType: env.ARENA_BALANCE_PRODUCT_TYPE ?? "USDT-FUTURES",
    },
    invocation.argsPrefix,
  );
  const result = await runner(invocation.command, args);
  if (result.exitCode !== 0) return null;
  return parseAvailable(result.stdout);
}

export async function runBalanceCli(
  runner: CommandRunner = runCommand,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const args = parseBalanceArgs(process.argv.slice(2), env);
  if (!bitgetCredentialsPresent(env)) {
    throw new Error(
      "BITGET_API_KEY, BITGET_SECRET_KEY, and BITGET_PASSPHRASE are required (export them in this shell; never hardcode keys)",
    );
  }
  const invocation = defaultBgcInvocation();
  const cmdArgs = buildBalanceArgs(args, invocation.argsPrefix);
  const result = await runner(invocation.command, cmdArgs);
  if (result.exitCode !== 0) {
    throw new Error(
      `balance query failed (${result.exitCode}): ${result.stderr.slice(0, 240)}`,
    );
  }
  process.stdout.write(
    result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`,
  );
}

if (process.argv[1]?.endsWith("broker-balance.ts")) {
  await runBalanceCli();
}
