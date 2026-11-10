// Why does retrieval drop inside one long recording? Sweep window/hop and dimension on the 2-hour test file.
// Hit = a top-k moment whose window overlaps the target utterance (same rule as e2e/run.mjs).
import fs from "node:fs";
import { load, decode, queryPrefix, truncate, dot } from "./lib.mjs";
const truth = JSON.parse(fs.readFileSync("../e2e/truth-long.json"));
const queries = JSON.parse(fs.readFileSync("queries.json"));
const pcm = decode("../test-vault/Recordings/long-meeting.m4a");
const m = await load("q8");
const qv = {};
for (const [k, list] of Object.entries(queries)) qv[k] = await m.embedText(list.map(([, q]) => queryPrefix(q)));
const rows = [];
for (const [win, hop] of [[15, 10], [10, 5], [6, 3]]) {
  const starts = [], vecs = [];
  for (let s = 0; s * 16000 < pcm.length; s += hop) { starts.push(s); vecs.push(await m.embedAudio(pcm.subarray(s * 16000, (s + win) * 16000))); }
  for (const dim of [768, 256]) {
    const dv = vecs.map((v) => truncate(v, dim));
    for (const [k, list] of Object.entries(queries)) {
      const ranks = list.map(([id], i) => {
        const q = truncate(qv[k][i], dim);
        const order = dv.map((v, j) => [dot(q, v), starts[j]]).sort((a, b) => b[0] - a[0]);
        const kept = []; // collapse neighbours within 20 s, as the plugin does
        for (const [, s] of order) { if (kept.length >= 10) break; if (!kept.some((x) => Math.abs(x - s) <= 20)) kept.push(s); }
        return kept.findIndex((s) => s < truth[id].end && s + win > truth[id].start) + 1;
      });
      rows.push({ win, hop, dim, kind: k, n: list.length, top1: ranks.filter((r) => r === 1).length, top3: ranks.filter((r) => r >= 1 && r <= 3).length, top10: ranks.filter((r) => r >= 1).length, windows: starts.length });
    }
  }
  fs.writeFileSync("results-window-sweep.json", JSON.stringify(rows, null, 1));
}
console.table(rows);
