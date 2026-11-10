import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import { type AudioWindow, Resampler, WindowCutter } from "./windowStream";

export const SAMPLE_RATE = 16000;
export const AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "webm", "ogg", "oga", "flac", "aac", "opus"] as const;

export const isAudioPath = (path: string): boolean =>
  (AUDIO_EXTENSIONS as readonly string[]).includes(path.split(".").pop()?.toLowerCase() ?? "");

/** Decode a whole audio file to mono 16 kHz samples, the input the model expects. */
export async function decodeToMono16k(data: ArrayBuffer): Promise<Float32Array> {
  // An offline context at 16 kHz makes the decoder resample for us.
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(data);
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / buffer.numberOfChannels;
  }
  return mono;
}

/**
 * Yields the recording as overlapping mono 16 kHz windows while decoding it piece by piece,
 * so memory stays near the size of the file however long the recording is.
 * Falls back to decoding the whole file when the streaming decoder cannot read it.
 */
export async function* audioWindows(data: ArrayBuffer, windowSec: number, stepSec: number): AsyncGenerator<AudioWindow> {
  const cutter = new WindowCutter(SAMPLE_RATE, windowSec, stepSec);
  const input = new Input({ source: new BlobSource(new Blob([data])), formats: ALL_FORMATS });
  let streamed = false;
  try {
    const track = await input.getPrimaryAudioTrack().catch(() => null);
    if (track && (await track.canDecode())) {
      let resampler: Resampler | null = null;
      for await (const sample of new AudioSampleSink(track).samples()) {
        streamed = true;
        resampler ??= new Resampler(sample.sampleRate, SAMPLE_RATE);
        const mono = new Float32Array(sample.numberOfFrames);
        const plane = new Float32Array(sample.numberOfFrames);
        for (let c = 0; c < sample.numberOfChannels; c++) {
          sample.copyTo(plane, { planeIndex: c, format: "f32-planar" });
          for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (plane[i] ?? 0) / sample.numberOfChannels;
        }
        sample.close();
        yield* cutter.push(resampler.push(mono));
      }
    }
  } catch (error) {
    if (streamed) throw error; // part of the file is already indexed from the stream; do not mix two decoders
    console.warn("Muninn: streaming decode unavailable for this file, decoding it whole", error);
  } finally {
    input.dispose();
  }
  if (!streamed) yield* cutter.push(await decodeToMono16k(data));
  yield* cutter.finish();
}
