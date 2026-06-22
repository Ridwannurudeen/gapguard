// Managed GetAgent Playbook backtest runner — control-plane API only.
//
// Reads the Bitget OpenAPI Playbook ACCESS-KEY from the environment; it is never
// hardcoded, printed, or written to disk. Run it in YOUR own shell:
//
//   PowerShell:
//     $env:BITGET_PLAYBOOK_ACCESS_KEY = Read-Host "Playbook ACCESS-KEY"
//     npm run playbook:run
//
// The ACCESS-KEY is the API Key of your GetAgent "Create Agent" sub-account
// (a ~32-char hex string) — NOT a "bg_..." playbook_key and NOT the demo trading
// key. It tars ./playbook, uploads a draft, dispatches a sandbox backtest, polls,
// prints metrics, and saves the run to playbook/aaplusdt-backtest-result.json.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BASE = "https://api.bitget.com";
const PKG_DIR = resolve(process.argv[2] ?? "playbook");
const RESULT_OUT = resolve("playbook/aaplusdt-backtest-result.json");

async function main() {
  const key = process.env.BITGET_PLAYBOOK_ACCESS_KEY || process.env.ACCESS_KEY;
  if (!key) {
    console.error(
      'Set BITGET_PLAYBOOK_ACCESS_KEY in your env (the GetAgent Agent sub-account API Key, a ~32-char hex string — not a bg_ key, not the demo trading key). PowerShell: $env:BITGET_PLAYBOOK_ACCESS_KEY = Read-Host "ACCESS-KEY"',
    );
    return 1;
  }
  const masked = `${key.slice(0, 4)}***`;
  console.log(`preflight: upload+run ${PKG_DIR} -> GetAgent prod ${BASE} with ACCESS-KEY=${masked}`);

  const tmp = mkdtempSync(join(tmpdir(), "pbk-"));
  const tgz = join(tmp, "package.tar.gz");
  execFileSync("tar", ["-czf", tgz, "-C", PKG_DIR, "."]);
  const bytes = readFileSync(tgz);
  console.log(`packaged ${PKG_DIR} -> ${(bytes.length / 1024).toFixed(1)} KB`);

  const headers = { "ACCESS-KEY": key };

  const form = new FormData();
  form.append("package", new Blob([bytes], { type: "application/gzip" }), "package.tar.gz");
  let res = await fetch(`${BASE}/api/v1/playbook/upload`, { method: "POST", headers, body: form });
  let body = await res.json().catch(() => ({}));
  const versionId = body.draft_id || body.version_id;
  if (!res.ok || !versionId) {
    console.error(`upload failed (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
    return 1;
  }
  console.log(`uploaded: strategy=${body.strategy_id ?? "?"} version=${versionId} status=${body.status ?? "?"}`);

  res = await fetch(`${BASE}/api/v1/playbook/run`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ version_id: versionId }),
  });
  body = await res.json().catch(() => ({}));
  if (!res.ok || !body.run_id) {
    console.error(`run dispatch failed (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
    return 1;
  }
  const runId = body.run_id;
  console.log(`run dispatched: ${runId} status=${body.status ?? "pending"}`);

  const deadline = Date.now() + 5 * 60 * 1000;
  let last = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    res = await fetch(`${BASE}/api/v1/playbook/run?run_id=${encodeURIComponent(runId)}`, { headers });
    body = await res.json().catch(() => ({}));
    if (body.status && body.status !== last) {
      console.log(`  status: ${body.status}`);
      last = body.status;
    }
    if (body.status === "completed" || body.status === "failed") break;
  }

  if (body.status === "completed") {
    console.log("\n=== metrics_output ===");
    console.log(JSON.stringify(body.metrics_output ?? {}, null, 2));
    writeFileSync(RESULT_OUT, `${JSON.stringify(body, null, 2)}\n`);
    console.log(`\nsaved: ${RESULT_OUT}`);
    return 0;
  }

  console.error(
    `\nrun did not complete: status=${body.status ?? "timeout"}${body.failure_reason ? ` - ${body.failure_reason}` : ""}`,
  );
  console.error("If the managed kline path returned no rows for this symbol, set backtest_support: none in playbook/manifest.yaml and rely on the simulated/paper evidence.");
  return 1;
}

process.exitCode = await main();
