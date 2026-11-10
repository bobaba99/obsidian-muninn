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
