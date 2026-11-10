// Real meetings: would transcribing each 15 s window on this computer (Whisper, no upload) and searching that
// text beat searching the audio directly? Also tries adding the two scores together.
// "found" = one of the first 3 results is a window that overlaps the moment the query describes.
import fs from "node:fs";
import { pipeline } from "@huggingface/transformers";
import { load, decode, queryPrefix, docPrefix, dot } from "./lib.mjs";
const WINDOW = 15, STEP = 10;
const queries = JSON.parse(fs.readFileSync("meeting-queries.json"));
const meetings = [...new Set(queries.map((q) => q[0]))];
const whisperModel = process.env.WHISPER ?? "onnx-community/whisper-base.en";
const whisper = await pipeline("automatic-speech-recognition", whisperModel, { device: "cpu", dtype: "q8" });
const m = await load(process.env.AUDIO_PRECISION ?? "fp16");
const qv = await m.embedText(queries.map((q) => queryPrefix(q[3])));
const docs = [];
let audioSeconds = 0, whisperSeconds = 0;
for (const mtg of meetings) {
  const pcm = decode(`data/ami/${mtg}.wav`);
  for (let s = 0; s * 16000 < pcm.length; s += STEP) {
    const samples = pcm.subarray(s * 16000, (s + WINDOW) * 16000);
    const t0 = Date.now();
    const text = (await whisper(samples)).text.trim();
    whisperSeconds += (Date.now() - t0) / 1000; audioSeconds += STEP;
    docs.push({ mtg, start: s, text, audio: await m.embedAudio(samples), textVec: (await m.embedText([docPrefix(text || "silence")]))[0] });
  }
}
const score = { "audio only": (q, d) => dot(q, d.audio), "local transcript only": (q, d) => dot(q, d.textVec), "audio + local transcript": (q, d) => dot(q, d.audio) + dot(q, d.textVec) };
const rows = Object.entries(score).map(([searched, f]) => {
  const ranks = queries.map(([mtg, start, end], i) => {
    const order = docs.map((d) => [f(qv[i], d), d]).sort((a, b) => b[0] - a[0]);
    const kept = [];
    for (const [, d] of order) { if (kept.length >= 10) break; if (!kept.some((k) => k.mtg === d.mtg && Math.abs(k.start - d.start) <= 20)) kept.push(d); }
    return kept.findIndex((d) => d.mtg === mtg && d.start < end && d.start + WINDOW > start) + 1;
  });
  return { searched, queries: queries.length, first: ranks.filter((r) => r === 1).length, top3: ranks.filter((r) => r >= 1 && r <= 3).length, top10: ranks.filter((r) => r >= 1).length, positions: ranks.join(" ") };
});
const out = { whisperModel, audioPrecision: process.env.AUDIO_PRECISION ?? "fp16", transcribeSpeedTimesRealTime: +(audioSeconds / whisperSeconds).toFixed(1), rows, sample: docs.slice(40, 43).map((d) => d.text) };
fs.writeFileSync("results-meeting-transcript.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, rows: undefined })); console.table(rows);
