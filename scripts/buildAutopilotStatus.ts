import { publishAutopilotStatus } from "../src/autopilotStatus";
import { parseAutoTraderArgs } from "../src/autoTrader";

try {
  const args = parseAutoTraderArgs(process.argv.slice(2));
  if (args.rearmPersistentKill) {
    throw new Error(
      "status-only refresh does not accept a persistent-kill re-arm",
    );
  }
  const report = publishAutopilotStatus({ mode: args.mode });
  console.log(
    `autopilot status: ${report.entryState}; mode=${report.mode}; generated=${report.generatedAt}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
