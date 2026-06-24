import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const portArgIndex = process.argv.indexOf("--port");
const port =
  portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 4173;
const host = "127.0.0.1";
const root = resolve("public");

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jsonl", "application/x-ndjson; charset=utf-8"],
  [".pem", "application/x-pem-file; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

function publicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const requested = decoded === "/" ? "/index.html" : decoded;
  const target = normalize(join(root, requested));
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null;
  return target;
}

createServer((req, res) => {
  const target = publicPath(req.url ?? "/");
  if (!target || !existsSync(target)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": types.get(extname(target)) ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(target).pipe(res);
}).listen(port, host, () => {
  console.log(`GapGuard public demo: http://${host}:${port}/index.html`);
});
