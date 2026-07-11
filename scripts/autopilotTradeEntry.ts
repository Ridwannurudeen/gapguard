import { runAutoTraderWithStatus } from "../src/autopilotStatus";
import { parseAutoTraderArgs } from "../src/autoTrader";

try {
  const args = parseAutoTraderArgs(process.argv.slice(2));
  const result = await runAutoTraderWithStatus(args);
  console.log(
    `auto-trader ${result.mode}: ${result.status} - ${result.reason}${result.symbol ? ` (${result.symbol})` : ""}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
