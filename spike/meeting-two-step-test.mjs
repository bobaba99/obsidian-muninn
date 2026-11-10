// Idea under test: use audio search to pick N candidate windows, transcribe only those, then re-order them by transcript.
// Real meetings (55 minutes in total, 332 windows of 15 s), 20 typed queries.
// Reported per N: how often the right moment survives step 1, and where it ends up after step 2.
import fs from "node:fs";
import { pipeline } from "@huggingface/transformers";
import { load, decode, queryPrefix, docPrefix, dot } from "./lib.mjs";
const WINDOW = 15, STEP = 10;
const queries = JSON.parse(fs.readFileSync("meeting-queries.json"));
const meetings = [...new Set(queries.map((q) => q[0]))];
const whisper = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base.en", { device: "cpu", dtype: "q8" });
const m = await load("fp16");
const qv = await m.embedText(queries.map((q) => queryPrefix(q[3])));
const docs = [];
for (const mtg of meetings) {
  const pcm = decode(`data/ami/${mtg}.wav`);
  for (let s = 0; s * 16000 < pcm.length; s += STEP) {
    const samples = pcm.subarray(s * 16000, (s + WINDOW) * 16000);
    const text = (await whisper(samples)).text.trim();
    docs.push({ mtg, start: s, audio: await m.embedAudio(samples), textVec: (await m.embedText([docPrefix(text || "silence")]))[0] });
  }
}
const isRight = (d, [mtg, start, end]) => d.mtg === mtg && d.start < end && d.start + WINDOW > start;
const rows = [];
for (const candidates of [5, 10, 20, 30, 50, docs.length]) {
  let survived = 0, first = 0, top3 = 0;
  queries.forEach((q, i) => {
    const step1 = docs.map((d) => [dot(qv[i], d.audio), d]).sort((a, b) => b[0] - a[0]).slice(0, candidates).map(([, d]) => d);
    if (step1.some((d) => isRight(d, q))) survived++;
    const step2 = step1.map((d) => [dot(qv[i], d.textVec), d]).sort((a, b) => b[0] - a[0]);
    const kept = [];
    for (const [, d] of step2) { if (kept.length >= 10) break; if (!kept.some((k) => k.mtg === d.mtg && Math.abs(k.start - d.start) <= 20)) kept.push(d); }
    const position = kept.findIndex((d) => isRight(d, q)) + 1;
    if (position === 1) first++;
    if (position >= 1 && position <= 3) top3++;
  });
  rows.push({ windowsTranscribedPerSearch: candidates, audioSecondsTranscribedPerSearch: candidates * WINDOW, rightMomentAmongCandidates: survived, afterReorderFirst: first, afterReorderTop3: top3, queries: queries.length });
}
fs.writeFileSync("results-meeting-two-step.json", JSON.stringify({ totalWindows: docs.length, rows }, null, 1));
console.table(rows);
