// End-to-end check in a real Obsidian window: index the test vault, then type each query into the
// search modal and score the moments it lists against the known utterance offsets.
import fs from "node:fs";
import { connect } from "./cdp.mjs";

const WINDOW = 15;
const truth = JSON.parse(fs.readFileSync(process.env.TRUTH ?? "e2e/truth.json"));
const queries = JSON.parse(fs.readFileSync("spike/queries.json"));
const c = await connect(Number(process.env.PORT ?? 9333));
const sleep = `const sleep = (ms) => new Promise(r => setTimeout(r, ms));`;

if (process.env.REINDEX !== "0") {
  const r = await c.evaluate(`${sleep}
    const p = app.plugins.plugins.muninn;
    for (const f of ["index.bin"]) { const x = p.manifest.dir + "/" + f; if (await app.vault.adapter.exists(x)) await app.vault.adapter.remove(x); }
    await app.plugins.disablePlugin("muninn"); await app.plugins.enablePlugin("muninn");
    const q = app.plugins.plugins.muninn; await sleep(500);
    const t0 = performance.now(); let peak = 0;
    app.commands.executeCommandById("muninn:index");
    await sleep(300);
    while (q.indexing) { peak = Math.max(peak, process.memoryUsage().rss); await sleep(200); }
    window.__peakMB = Math.round(peak / 2**20);
    return JSON.stringify({ peakRssMB: window.__peakMB, wallSec: (performance.now() - t0) / 1000, files: q.index.files.map(f => [f.path, f.starts.length]), settings: q.settings,
      notices: [...document.querySelectorAll(".notice")].map(n => n.textContent) });`);
  console.log("index:", r);
}

const rows = [];
for (const [kind, list] of Object.entries(queries)) {
  let top1 = 0, top3 = 0;
  const misses = [];
  for (const [id, q] of list) {
    const hits = JSON.parse(await c.evaluate(`${sleep}
      app.commands.executeCommandById("muninn:search"); await sleep(100);
      const input = document.querySelector(".prompt-input");
      input.value = ${JSON.stringify(q)}; input.dispatchEvent(new Event("input", { bubbles: true }));
      for (let i = 0; i < 100 && !document.querySelector(".prompt .suggestion-item"); i++) await sleep(100);
      const hits = [...document.querySelectorAll(".prompt .suggestion-item")].map(el => ({ title: el.querySelector(".muninn-hit-title")?.textContent, sub: el.querySelector(".muninn-hit-sub")?.textContent }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })); await sleep(50);
      if (document.querySelector(".prompt")) throw new Error("search modal did not close");
      return JSON.stringify(hits);`));
    const t = truth[id];
    const rank = hits.findIndex((h) => {
      const [time] = h.title.split(" · ");
      const sec = time.split(":").reduce((s, x) => s * 60 + Number(x), 0);
      return h.sub.startsWith(t.path) && sec < t.end && sec + WINDOW > t.start;
    }) + 1;
    if (rank === 1) top1++;
    if (rank >= 1 && rank <= 3) top3++; else misses.push(`${q} -> rank ${rank || ">10"} (got ${hits[0]?.title})`);
  }
  rows.push({ kind, n: list.length, top1, top3, misses });
}
console.table(rows.map(({ misses, ...r }) => r));
for (const r of rows) for (const m of r.misses) console.log("MISS", r.kind, m);
const errs = c.logs.filter((l) => /error|exception|warn/i.test(l));
console.log("console errors/warnings:", errs.length); console.log(errs.slice(0, 12).join("\n"));
fs.writeFileSync("e2e/last-run.json", JSON.stringify({ date: new Date().toISOString(), rows }, null, 1));
c.close();
