// Gate test: does EmbeddingGemma 2 retrieve speech by WHAT WAS SAID?
// Corpus: 73 real utterances, ONE speaker (so voice cannot discriminate).
// Ceiling control: the same queries against the ground-truth transcripts (text->text).
import fs from "node:fs";
import { load, decode, queryPrefix, docPrefix, truncate, dot } from "./lib.mjs";

const meta = JSON.parse(fs.readFileSync("data/libri/meta.json"));
const queries = JSON.parse(fs.readFileSync("queries.json"));
const pcm = Object.fromEntries(meta.map((m) => [m.id, decode(`data/libri/${m.id}.flac`)]));
const totalSec = Object.values(pcm).reduce((s, p) => s + p.length, 0) / 16000;

// Windows: consecutive utterances of one chapter, concatenated up to targetSec.
function windows(targetSec) {
  if (!targetSec) return meta.map((m) => ({ ids: [m.id], pcm: pcm[m.id], text: m.text }));
  const out = [];
  let cur = null;
  for (const m of meta) {
    const len = pcm[m.id].length / 16000;
    if (!cur || cur.chapter !== m.chapter || cur.sec + len > targetSec) {
      cur = { chapter: m.chapter, ids: [], parts: [], texts: [], sec: 0 };
      out.push(cur);
    }
    cur.ids.push(m.id); cur.parts.push(pcm[m.id]); cur.texts.push(m.text); cur.sec += len;
  }
  return out.map((w) => {
    const buf = new Float32Array(w.parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of w.parts) { buf.set(p, o); o += p.length; }
    return { ids: w.ids, pcm: buf, text: w.texts.join(" ") };
  });
}

function score(qVecs, qTargets, docVecs, docs, dim) {
  const d = docVecs.map((v) => truncate(v, dim));
  const ranks = qVecs.map((qv, i) => {
    const q = truncate(qv, dim);
    const order = d.map((v, j) => [dot(q, v), j]).sort((a, b) => b[0] - a[0]);
    return order.findIndex(([, j]) => docs[j].ids.includes(qTargets[i])) + 1;
  });
  return {
    top1: ranks.filter((r) => r === 1).length,
    top3: ranks.filter((r) => r <= 3).length,
    mrr: +(ranks.reduce((s, r) => s + 1 / r, 0) / ranks.length).toFixed(3),
    ranks,
  };
}

const rows = [];
for (const audioDtype of (process.env.DTYPES ?? "q8,q4").split(",")) {
  const m = await load(audioDtype);
  const qv = {};
  for (const [kind, list] of Object.entries(queries)) qv[kind] = await m.embedText(list.map(([, q]) => queryPrefix(q)));
  for (const win of [0, 15, 30]) {
    const docs = windows(win);
    const t0 = Date.now();
    const aud = [];
    for (const d of docs) aud.push(await m.embedAudio(d.pcm));
    const audioMs = Date.now() - t0;
    const txt = [];
    for (const d of docs) txt.push((await m.embedText([docPrefix(d.text)]))[0]);
    for (const [kind, list] of Object.entries(queries)) {
      const targets = list.map(([id]) => id);
      for (const dim of [768, 256]) {
        for (const [mode, vecs] of [["audio", aud], ["transcript-ceiling", txt]]) {
          if (mode !== "audio" && audioDtype !== "q8") continue; // text path is identical across audio dtypes
          const s = score(qv[kind], targets, vecs, docs, dim);
          rows.push({ audioDtype, window: win || "utterance", nDocs: docs.length, kind, n: list.length, dim, mode,
            top1: s.top1, top3: s.top3, mrr: s.mrr, chanceTop3: +(3 / docs.length * list.length).toFixed(1),
            rtf: mode === "audio" ? +(audioMs / 1000 / totalSec).toFixed(4) : null, ranks: s.ranks.join(" ") });
        }
      }
    }
  }
}
fs.writeFileSync("results.json", JSON.stringify({ date: new Date().toISOString(), totalSec, rows }, null, 1));
console.log("corpus seconds", totalSec.toFixed(1));
console.table(rows.map(({ ranks, ...r }) => r));
