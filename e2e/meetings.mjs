// Real meetings in a real Obsidian window: index the two AMI recordings in the test vault, type each
// query into the search box, and count how often one of the first 3 results overlaps the right moment.
import fs from "node:fs";
import { connect } from "./cdp.mjs";
const WINDOW_SECONDS = 15;
const queries = JSON.parse(fs.readFileSync("spike/meeting-queries.json"));
const c = await connect(9333);
const sleep = `const sleep = (ms) => new Promise(r => setTimeout(r, ms));`;
console.log("index:", await c.evaluate(`${sleep}
  const p = app.plugins.plugins.muninn; const bin = p.manifest.dir + "/index.bin";
  if (await app.vault.adapter.exists(bin)) await app.vault.adapter.remove(bin);
  await app.plugins.disablePlugin("muninn"); await app.plugins.enablePlugin("muninn"); await sleep(800);
  const q = app.plugins.plugins.muninn; const t0 = performance.now(); let peak = 0;
  app.commands.executeCommandById("muninn:index"); await sleep(300);
  while (q.indexing) { peak = Math.max(peak, process.memoryUsage().rss); await sleep(200); }
  return JSON.stringify({ seconds: +((performance.now() - t0) / 1000).toFixed(1), peakMemoryMB: Math.round(peak / 2**20), files: q.index.files.map(f => [f.path, f.starts.length]), notices: [...document.querySelectorAll(".notice")].map(n => n.textContent) });`));
let first = 0, top3 = 0, top10 = 0;
for (const [meeting, start, end, query] of queries) {
  const hits = JSON.parse(await c.evaluate(`${sleep}
    app.commands.executeCommandById("muninn:search"); await sleep(100);
    const input = document.querySelector(".prompt-input");
    input.value = ${JSON.stringify(query)}; input.dispatchEvent(new Event("input", { bubbles: true }));
    for (let i = 0; i < 100 && !document.querySelector(".prompt .suggestion-item"); i++) await sleep(100);
    const hits = [...document.querySelectorAll(".prompt .suggestion-item .muninn-hit-title")].map(el => el.textContent);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })); await sleep(50);
    return JSON.stringify(hits);`));
  const rank = hits.findIndex((title) => {
    const [time, file] = title.split(" · ");
    const at = time.split(":").reduce((s, x) => s * 60 + Number(x), 0);
    return file.startsWith(meeting) && at < end && at + WINDOW_SECONDS > start;
  }) + 1;
  if (rank === 1) first++;
  if (rank >= 1 && rank <= 3) top3++;
  if (rank >= 1) top10++; 
  if (!(rank >= 1 && rank <= 3)) console.log(`MISS "${query}" -> position ${rank || "not in 10"} (first result ${hits[0]})`);
}
console.log(JSON.stringify({ queries: queries.length, rightMomentFirst: first, rightMomentInTop3: top3, rightMomentInTop10: top10 }));
c.close();
