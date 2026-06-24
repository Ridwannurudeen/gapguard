// Standalone entry for the bundled VPS news-refresh job. Bundled by `npm run
// news:bundle` into a single self-contained .mjs that runs on plain node (the
// VPS has node but no repo/tsx), then run by cron to refresh public/news-feed.json.
import { runFetchNewsFeedCli } from "../src/fetchNewsFeed";

runFetchNewsFeedCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
