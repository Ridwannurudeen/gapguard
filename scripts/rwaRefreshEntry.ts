// Standalone entry for the bundled VPS RWA-market refresh job. Bundled by `npm run
// rwa:bundle` into a single self-contained .mjs that runs on plain node (the VPS
// has node but no repo/tsx), then run by cron to refresh public/rwa-market.json.
// No API key required — Bitget's public market endpoints are unauthenticated.
import { runRwaMarketCli } from "../src/rwa-market";

runRwaMarketCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
