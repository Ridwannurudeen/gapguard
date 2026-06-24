import { createServer, type IncomingMessage } from "node:http";
import { buildArenaPassports } from "./arena-demo";
import {
  placeFuturesOrder,
  type BrokerConfig,
  type BrokerMode,
  type BrokerResult,
  type FuturesOrderIntent,
  type FuturesSide,
} from "./liveStockBroker";

const MODES: BrokerMode[] = ["dry_run", "paper", "live"];
const SIDES: FuturesSide[] = [
  "open_long",
  "open_short",
  "close_long",
  "close_short",
];

export interface OperatorOrderRequest {
  mode: BrokerMode;
  symbol: string;
  side: FuturesSide;
  size: number;
  referencePrice: number;
  confirmLive: boolean;
  maxNotionalUSDT: number;
}

function asPositive(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return parsed;
}

export function parseOrderRequest(value: unknown): OperatorOrderRequest {
  if (!value || typeof value !== "object") {
    throw new Error("request body must be a JSON object");
  }
  const body = value as Record<string, unknown>;
  const mode = body.mode;
  if (typeof mode !== "string" || !MODES.includes(mode as BrokerMode)) {
    throw new Error("mode must be dry_run, paper, or live");
  }
  const side = body.side;
  if (typeof side !== "string" || !SIDES.includes(side as FuturesSide)) {
    throw new Error(
      "side must be open_long, open_short, close_long, or close_short",
    );
  }
  const symbol = body.symbol;
  if (typeof symbol !== "string" || symbol.length === 0) {
    throw new Error("symbol must be a non-empty string");
  }
  return {
    mode: mode as BrokerMode,
    symbol,
    side: side as FuturesSide,
    size: asPositive(body.size, "size"),
    referencePrice: asPositive(body.referencePrice, "referencePrice"),
    confirmLive: body.confirmLive === true,
    maxNotionalUSDT: asPositive(body.maxNotionalUSDT ?? 20, "maxNotionalUSDT"),
  };
}

export function buildOperatorConfig(
  req: OperatorOrderRequest,
  env: NodeJS.ProcessEnv,
): { intent: FuturesOrderIntent; cfg: BrokerConfig } {
  // Same passport the broker CLI uses; the broker re-checks LICENSED + confirmLive
  // + notional cap server-side, so the UI can never bypass a gate.
  const passport = buildArenaPassports()[0];
  return {
    intent: {
      symbol: req.symbol,
      side: req.side,
      size: req.size,
      referencePrice: req.referencePrice,
    },
    cfg: {
      mode: req.mode,
      passport,
      maxNotionalUSDT: req.maxNotionalUSDT,
      confirmLive: req.confirmLive,
      marginMode: "isolated",
      leverage: 1,
      env,
    },
  };
}

export async function handleOperatorOrder(
  req: OperatorOrderRequest,
  env: NodeJS.ProcessEnv,
  place: typeof placeFuturesOrder = placeFuturesOrder,
): Promise<BrokerResult> {
  const { intent, cfg } = buildOperatorConfig(req, env);
  return place(intent, cfg);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 16_384) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      data += chunk.toString("utf8");
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export const OPERATOR_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>GapGuard Operator Console</title>
<style>
:root{--bg:#0c0f0b;--card:#161a15;--line:rgba(224,231,204,.14);--ink:#f4f4ec;--muted:#aab0a0;--dim:#737a6b;--mint:#2fe6a2;--amber:#efb758;--red:#ff6270;--mono:ui-monospace,Menlo,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,sans-serif;padding:28px;max-width:760px;margin:0 auto}
h1{font-size:19px;margin:0 0 4px}.sub{color:var(--dim);font-size:12px;margin:0 0 22px}
.warn{background:rgba(239,183,88,.1);border:1px solid var(--amber);color:var(--amber);border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:18px}
label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin:14px 0 5px}
input,select{width:100%;background:var(--card);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:9px 11px;font:13px var(--mono)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.confirm{margin-top:14px;display:none;align-items:center;gap:9px;color:var(--red);font-size:13px}
.confirm.show{display:flex}.confirm input{width:auto}
button{margin-top:18px;width:100%;background:var(--mint);color:#08120c;border:0;border-radius:9px;padding:12px;font-weight:700;font-size:14px;cursor:pointer}
button.live{background:var(--red);color:#fff}button:disabled{opacity:.4;cursor:not-allowed}
pre{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:14px;overflow:auto;font:12px var(--mono);color:var(--muted);margin-top:18px;white-space:pre-wrap}
.modebadge{font:11px var(--mono);padding:3px 8px;border-radius:6px;border:1px solid var(--line);color:var(--dim)}
</style></head>
<body>
<h1>GapGuard Operator Console <span id="badge" class="modebadge">dry_run</span></h1>
<p class="sub">127.0.0.1 only · keys live on the server · this page never sees them</p>
<div class="warn" id="warn">dry_run builds the plan and places nothing.</div>
<label>Operator token</label><input id="token" type="password" placeholder="OPERATOR_TOKEN (printed in the server terminal)" />
<div class="row">
  <div><label>Mode</label><select id="mode"><option>dry_run</option><option>paper</option><option>live</option></select></div>
  <div><label>Side</label><select id="side"><option>open_long</option><option>open_short</option><option>close_long</option><option>close_short</option></select></div>
</div>
<div class="row">
  <div><label>Symbol</label><input id="symbol" value="NVDAUSDT" /></div>
  <div><label>Size</label><input id="size" value="0.03" /></div>
</div>
<div class="row">
  <div><label>Reference price</label><input id="referencePrice" value="209.62" /></div>
  <div><label>Max notional (USDT)</label><input id="maxNotionalUSDT" value="20" /></div>
</div>
<label class="confirm" id="confirmWrap"><input id="confirmLive" type="checkbox" /> I authorize this REAL-MONEY live order (requires LICENSED passport + server gates).</label>
<button id="go">Preview plan (dry_run)</button>
<pre id="out">No request yet.</pre>
<script>
const $=id=>document.getElementById(id);
function sync(){
  const m=$('mode').value;$('badge').textContent=m;
  const live=m==='live';$('confirmWrap').classList.toggle('show',live);
  $('go').className=live?'live':'';
  $('go').textContent=m==='dry_run'?'Preview plan (dry_run)':live?'Execute LIVE order':'Execute paper order (Demo)';
  $('warn').textContent=m==='dry_run'?'dry_run builds the plan and places nothing.':m==='paper'?'paper routes to Bitget Demo — real order, demo funds.':'live places a REAL-MONEY order; the server enforces LICENSED + confirm + caps.';
}
$('mode').addEventListener('change',sync);sync();
$('go').addEventListener('click',async()=>{
  $('go').disabled=true;$('out').textContent='Working…';
  const payload={mode:$('mode').value,side:$('side').value,symbol:$('symbol').value.trim(),size:Number($('size').value),referencePrice:Number($('referencePrice').value),maxNotionalUSDT:Number($('maxNotionalUSDT').value),confirmLive:$('confirmLive').checked};
  try{
    const r=await fetch('/api/order',{method:'POST',headers:{'content-type':'application/json','x-operator-token':$('token').value},body:JSON.stringify(payload)});
    const j=await r.json();$('out').textContent=(r.ok?'':'ERROR '+r.status+'\\n')+JSON.stringify(j,null,2);
  }catch(e){$('out').textContent='Request failed: '+e.message}
  $('go').disabled=false;
});
</script>
</body></html>`;

export function startOperatorConsole(opts: {
  token: string;
  port?: number;
  env?: NodeJS.ProcessEnv;
  place?: typeof placeFuturesOrder;
}) {
  const env = opts.env ?? process.env;
  const place = opts.place ?? placeFuturesOrder;
  const server = createServer(async (req, res) => {
    if (
      req.method === "GET" &&
      (req.url === "/" || req.url === "/index.html")
    ) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(OPERATOR_PAGE);
      return;
    }
    if (req.method === "POST" && req.url === "/api/order") {
      if (req.headers["x-operator-token"] !== opts.token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      try {
        const body = await readBody(req);
        const parsed = parseOrderRequest(JSON.parse(body));
        const result = await handleOperatorOrder(parsed, env, place);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result, null, 2));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : "bad request",
          }),
        );
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  // Bind loopback only — this endpoint can place orders; it must never be public.
  server.listen(opts.port ?? 4178, "127.0.0.1");
  return server;
}

export function runOperatorConsoleCli(): void {
  const token = process.env.OPERATOR_TOKEN;
  if (!token || token.length < 8) {
    throw new Error(
      "OPERATOR_TOKEN env (>=8 chars) is required — it authenticates the operator to the console",
    );
  }
  const port = Number(process.env.OPERATOR_PORT ?? "4178");
  startOperatorConsole({ token, port });
  console.log(
    `GapGuard operator console: http://127.0.0.1:${port} (loopback only)\n` +
      `Enter the OPERATOR_TOKEN in the page. dry_run is safe; paper hits Bitget Demo; ` +
      `live needs a LICENSED passport + explicit confirm + BITGET_* keys in this server's env.`,
  );
}

if (process.argv[1]?.endsWith("operatorConsole.ts")) {
  runOperatorConsoleCli();
}
