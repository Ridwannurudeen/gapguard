import { spawn, spawnSync } from "node:child_process";

const port = Number(process.env.JUDGE_PORT ?? "4173");
const url = `http://127.0.0.1:${port}/arena.html`;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function serverReady() {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverReady()) return;
  const child = spawn(
    process.execPath,
    ["scripts/serve-public.mjs", "--port", String(port)],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (await serverReady()) return;
  }
  throw new Error(`public server did not become ready at ${url}`);
}

function openBrowser() {
  if (process.env.JUDGE_NO_OPEN === "1" || process.env.CI === "true") return;
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

run("npm", ["run", "paper:journal"]);
run("npm", ["run", "arena:cockpit"]);
run("npm", ["run", "evidence"]);
run("npm", ["run", "manifest"]);
run("npm", ["run", "verify-log", "--", "public/arena-chain.jsonl"]);
run("npm", ["run", "readiness:audit"]);
await ensureServer();
openBrowser();
console.log(`Judge cockpit: ${url}`);
