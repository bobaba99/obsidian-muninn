import { AutoModel, AutoProcessor, AutoConfig } from "@huggingface/transformers";
import { execFileSync } from "node:child_process";

export const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";

/** Decode any audio file to mono 16 kHz Float32Array via ffmpeg. */
export function decode(path, startSec = null, durSec = null) {
  const args = ["-v", "error"];
  if (startSec !== null) args.push("-ss", String(startSec));
  if (durSec !== null) args.push("-t", String(durSec));
  args.push("-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-");
  const buf = execFileSync("ffmpeg", args, { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
}

export async function load(audioDtype = "q8", textDtype = "q4") {
  const config = await AutoConfig.from_pretrained(MODEL_ID);
  config.vision_config = null; // text + audio only
  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  const model = await AutoModel.from_pretrained(MODEL_ID, {
    config,
    device: "cpu",
    dtype: { model: textDtype, audio_encoder: audioDtype },
  });
  const run = async (inputs) => {
    const out = await model(inputs);
    return Array.from({ length: out.sentence_embedding.dims[0] }, (_, i) =>
      Float32Array.from(out.sentence_embedding.data.subarray(i * 768, (i + 1) * 768)));
  };
  return {
    embedText: async (texts) => run(await processor(texts)),
    embedAudio: async (pcm) => (await run(await processor(null, null, pcm)))[0],
  };
}

export const queryPrefix = (q) => `task: search result | query: ${q}`;
export const docPrefix = (t) => `title: none | text: ${t}`;

export function truncate(v, dim) {
  const s = v.subarray(0, dim);
  let n = 0;
  for (const x of s) n += x * x;
  n = Math.sqrt(n);
  return Float32Array.from(s, (x) => x / n);
}
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
