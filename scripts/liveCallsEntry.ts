// Standalone entry for the bundled VPS live-calls job. Bundled by `npm run
// live:bundle` into a single self-contained .mjs that runs on plain node, then
// run by cron to refresh public/live-calls.json. Reads the Qwen key from env or
// a chmod-600 .qwenkey file; without it, emits real gaps with no AI verdicts.
import { buildLiveCalls } from "../src/buildLiveCalls";

buildLiveCalls().catch((error) => {
  console.error(error);
  process.exit(1);
});
