const GENESIS = "0".repeat(64);
let original = null; // pristine records for the tamper toggle to restore from

// Must byte-match src/glassbox.ts canonicalPayload: JSON.stringify of payload fields in this order.
function canonicalPayload(r) {
  const base = {
    ts: r.ts,
    symbol: r.symbol,
    session: r.session,
    dislocation: r.dislocation,
    risk: r.risk,
  };
  if (r.gate) base.gate = r.gate;
  return JSON.stringify(base);
}
async function sha256hex(str) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function verifyChain(records) {
  let prev = GENESIS,
    allOk = true;
  const perRecord = [];
  for (const r of records) {
    const expected = await sha256hex(canonicalPayload(r) + prev);
    const ok = r.prevHash === prev && r.recordHash === expected;
    perRecord.push(ok);
    allOk = allOk && ok;
    prev = r.recordHash; // continue on the stored hash so a single break is localized
  }
  return { allOk, perRecord };
}

function parseJsonl(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const meta = lines.length && lines[0]._meta ? lines.shift()._meta : null;
  return { meta, records: lines };
}

const fmt = (n) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2);
const esc = (s) =>
  String(s).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
const ARROW = { rich: "▲", cheap: "▼", fair: "–" };

function actionClass(a) {
  if (a === "flatten") return "realize";
  if (a === "hold") return "muted";
  return "";
}

async function render(meta, records) {
  const { allOk, perRecord } = await verifyChain(records);

  const status = document.getElementById("status");
  status.className = "status" + (allOk ? "" : " bad");
  document.getElementById("statusText").textContent = allOk
    ? "Chain verified"
    : "Chain tampered";

  const entries = records.filter((r) =>
    r.risk.action.startsWith("enter"),
  ).length;
  document.getElementById("stRecords").textContent = records.length;
  document.getElementById("stEntries").textContent = entries;
  document.getElementById("stCommit").textContent = meta ? meta.commit : "—";
  document.getElementById("stTime").textContent = meta
    ? new Date(meta.generatedAt).toISOString().replace("T", " ").slice(0, 16) +
      "Z"
    : "—";
  document.getElementById("ledgerCount").textContent =
    `${records.length} decisions`;

  document.getElementById("rows").innerHTML = records
    .map((r, i) => {
      const d = r.dislocation,
        rk = r.risk,
        se = r.session;
      const token = d.fairValue * (1 + d.dislocationPct);
      const gate = r.gate ? `×${r.gate.multiplier.toFixed(2)}` : "—";
      const ok = perRecord[i];
      return `<tr class="${ok ? "" : "broken"}">
      <td class="mono">${esc(se.etTime.replace(" ET", ""))}</td>
      <td><span class="session ${se.underlyingOpen ? "open" : ""}"><span class="live"></span>${esc(se.session)}</span></td>
      <td class="num">${token.toFixed(2)}</td>
      <td class="num">${d.fairValue.toFixed(2)}</td>
      <td class="num">${(d.zScore >= 0 ? "+" : "−") + Math.abs(d.zScore).toFixed(2)}σ</td>
      <td><span class="signal"><span class="arrow">${ARROW[d.direction] || ""}</span><span class="strong">${esc(d.direction)}</span><span class="conf">${(d.confidence * 100).toFixed(0)}%</span></span></td>
      <td class="mono" style="color:var(--ink-3)">${esc(gate)}</td>
      <td><span class="act ${actionClass(rk.action)}">${esc(rk.action)}</span></td>
      <td class="num">${fmt(rk.targetNotional)}</td>
      <td><span class="integ"><span class="tick">${ok ? "✓" : "⚠"}</span>${esc(r.recordHash.slice(0, 10))}…</span></td>
    </tr>`;
    })
    .join("");

  document.getElementById("report").hidden = false;
  document.getElementById("drop").hidden = true;
}

async function load(text) {
  try {
    const { meta, records } = parseJsonl(text);
    if (!records.length) throw new Error("no decision records found");
    original = JSON.parse(JSON.stringify(records));
    window._meta = meta;
    await render(meta, records);
    document.getElementById("tamper").checked = false;
  } catch (e) {
    const drop = document.getElementById("drop");
    drop.hidden = false;
    drop.classList.add("err-state");
    document.getElementById("dropTitle").textContent = "Couldn’t read that log";
    document.getElementById("dropMsg").innerHTML =
      `<span class="err">${esc(e.message)}</span> — pick a valid glassbox-demo.jsonl.`;
  }
}

document.getElementById("tamper").addEventListener("change", (e) => {
  if (!original) return;
  const records = JSON.parse(JSON.stringify(original));
  if (e.target.checked) records[0].risk.targetNotional += 1; // alter a sealed payload field
  render(window._meta, records);
});

// File-drop + picker fallback (works from file://)
const drop = document.getElementById("drop"),
  fileInput = document.getElementById("file");
document
  .getElementById("pick")
  .addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) =>
  e.target.files[0]?.text().then(load),
);
["dragover", "dragenter"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("hot");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("hot");
  }),
);
drop.addEventListener("drop", (e) =>
  e.dataTransfer.files[0]?.text().then(load),
);

// Auto-load when served over http (sibling, then repo root)
(async () => {
  for (const url of ["glassbox-demo.jsonl", "../glassbox-demo.jsonl"]) {
    try {
      const res = await fetch(url);
      if (res.ok) return load(await res.text());
    } catch {}
  }
})();
