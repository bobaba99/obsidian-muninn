// Real meetings (AMI corpus, 4 speakers each, 21 and 34 minutes): does a typed description find the moment?
// "found" = one of the first 3 results is a window that overlaps the moment the query describes.
// Comparison: the same queries searched against the human transcript, one entry per utterance.
import fs from "node:fs";
import { load, decode, queryPrefix, docPrefix, truncate, dot } from "./lib.mjs";
const queries = JSON.parse(fs.readFileSync("meeting-queries.json"));
const utterances = JSON.parse(fs.readFileSync("data/ami/utterances.json"));
const meetings = [...new Set(queries.map((q) => q[0]))];
const m = await load(process.env.AUDIO_PRECISION ?? "q8");
const qv = await m.embedText(queries.map((q) => queryPrefix(q[3])));
const count = (ranks) => ({ first: ranks.filter((r) => r === 1).length, top3: ranks.filter((r) => r >= 1 && r <= 3).length, top10: ranks.filter((r) => r >= 1).length });
const rank = (docs, vecs, dim, lengthOf) => queries.map(([mtg, start, end], i) => {
  const q = truncate(qv[i], dim);
  const order = docs.map((d, j) => [dot(q, truncate(vecs[j], dim)), d]).sort((a, b) => b[0] - a[0]);
  const kept = [];
  for (const [, d] of order) { if (kept.length >= 10) break; if (!kept.some((k) => k.mtg === d.mtg && Math.abs(k.start - d.start) <= 20)) kept.push(d); }
  return kept.findIndex((d) => d.mtg === mtg && d.start < end && d.start + lengthOf(d) > start) + 1;
});
const rows = [];
const text = meetings.flatMap((mtg) => utterances[mtg].filter((u) => u.text.split(" ").length >= 4).map((u) => ({ mtg, start: u.start, end: u.end, text: u.text })));
const tv = []; for (const u of text) tv.push((await m.embedText([docPrefix(u.text)]))[0]);
for (const dim of [768, 256]) rows.push({ searched: "human transcript", windowSeconds: "-", stepSeconds: "-", vectorSize: dim, queries: queries.length, ...count(rank(text, tv, dim, (d) => d.end - d.start)) });
const pcm = Object.fromEntries(meetings.map((mtg) => [mtg, decode(`data/ami/${mtg}.wav`)]));
for (const [win, hop] of [[15, 10], [10, 5]]) {
  const docs = [], vecs = [];
  for (const mtg of meetings) for (let s = 0; s * 16000 < pcm[mtg].length; s += hop) { docs.push({ mtg, start: s }); vecs.push(await m.embedAudio(pcm[mtg].subarray(s * 16000, (s + win) * 16000))); }
  for (const dim of [768, 256]) rows.push({ searched: "audio", windowSeconds: win, stepSeconds: hop, vectorSize: dim, queries: queries.length, ...count(rank(docs, vecs, dim, () => win)) });
  fs.writeFileSync("results-meetings.json", JSON.stringify(rows, null, 1));
}
console.table(rows);
