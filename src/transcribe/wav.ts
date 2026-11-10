/** Encode mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, s: string): void => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  ascii(0, "RIFF"); view.setUint32(4, 36 + dataBytes, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, dataBytes, true);
  pcm.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
  });
  return buffer;
}
