// Scale control: same 30 queries, but the 73 targets are buried in all of LibriSpeech dev-clean
// (2,703 utterances, 40 speakers, ~5.4 h). Measures hit rates with real distractors, indexing speed, index size.
import fs from "node:fs";
import path from "node:path";
import { load, decode, queryPrefix, docPrefix, truncate, dot } from "./lib.mjs";

const root = "data/LibriSpeech/dev-clean";
const docs = [];
for (const spk of fs.readdirSync(root)) for (const ch of fs.readdirSync(path.join(root, spk))) {
  const dir = path.join(root, spk, ch);
  for (const line of fs.readFileSync(path.join(dir, `${spk}-${ch}.trans.txt`), "utf8").trim().split("\n")) {
    const sp = line.indexOf(" ");
    docs.push({ id: line.slice(0, sp), text: line.slice(sp + 1).toLowerCase(), file: path.join(dir, `${line.slice(0, sp)}.flac`) });
  }
}
const queries = JSON.parse(fs.readFileSync("queries.json"));
const m = await load(process.env.DTYPE ?? "q8");
let sec = 0, t0 = Date.now();
const aud = [];
for (const [i, d] of docs.entries()) {
  const pcm = decode(d.file);
  sec += pcm.length / 16000;
  aud.push(await m.embedAudio(pcm));
  if (i % 300 === 0) console.error(i, docs.length, ((Date.now() - t0) / 1000).toFixed(0) + "s");
}
const audioWall = (Date.now() - t0) / 1000;
const txt = [];
for (const d of docs) txt.push((await m.embedText([docPrefix(d.text)]))[0]);

const rows = [];
for (const [kind, list] of Object.entries(queries)) {
  const qv = await m.embedText(list.map(([, q]) => queryPrefix(q)));
  for (const dim of [768, 256]) for (const [mode, vecs] of [["audio", aud], ["transcript-ceiling", txt]]) {
    const dv = vecs.map((v) => truncate(v, dim));
    const ranks = qv.map((q, i) => {
      const qq = truncate(q, dim);
      const order = dv.map((v, j) => [dot(qq, v), j]).sort((a, b) => b[0] - a[0]);
      return order.findIndex(([, j]) => docs[j].id === list[i][0]) + 1;
    });
    rows.push({ kind, n: list.length, dim, mode, top1: ranks.filter((r) => r === 1).length, top3: ranks.filter((r) => r <= 3).length,
      top10: ranks.filter((r) => r <= 10).length, mrr: +(ranks.reduce((s, r) => s + 1 / r, 0) / ranks.length).toFixed(3), ranks: ranks.join(" ") });
  }
}
const out = { date: new Date().toISOString(), nDocs: docs.length, hours: +(sec / 3600).toFixed(2), audioWallSec: +audioWall.toFixed(0),
  rtf: +(audioWall / sec).toFixed(4), indexMB_256_f32: +(docs.length * 256 * 4 / 1e6).toFixed(2), rows };
fs.writeFileSync("results-scale.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, rows: undefined }));
console.table(rows);
