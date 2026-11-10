import { describe, expect, it } from "vitest";
import { encodeWav } from "../src/transcribe/wav";
import { encodeMultipart } from "../src/transcribe/multipart";
import { PROVIDERS, getProvider } from "../src/transcribe/providers";

const text = (buf: ArrayBuffer) => new TextDecoder("latin1").decode(buf);

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM header and clamps samples", () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 2]), 16000);
    const v = new DataView(wav);
    expect(text(wav.slice(0, 4))).toBe("RIFF");
    expect(text(wav.slice(8, 12))).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1); // channels
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(8); // data bytes
    expect(wav.byteLength).toBe(44 + 8);
    expect([44, 46, 48, 50].map((o) => v.getInt16(o, true))).toEqual([0, 32767, -32768, 32767]);
  });
});

describe("encodeMultipart", () => {
  it("encodes text fields and a file part under one boundary", () => {
    const { body, contentType } = encodeMultipart(
      [{ name: "a", value: "1" }, { name: "f", value: new Uint8Array([1, 2, 3]).buffer, filename: "x.wav", type: "audio/wav" }], "BOUND");
    expect(contentType).toBe("multipart/form-data; boundary=BOUND");
    const s = text(body);
    expect(s).toContain('--BOUND\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n');
    expect(s).toContain('Content-Disposition: form-data; name="f"; filename="x.wav"\r\nContent-Type: audio/wav\r\n\r\n\x01\x02\x03\r\n');
    expect(s.endsWith("--BOUND--\r\n")).toBe(true);
  });
});

describe("providers", () => {
  const wav = new Uint8Array([9]).buffer;
  it("lists Fish Audio and ElevenLabs and resolves by id", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["fish-audio", "elevenlabs"]);
    expect(getProvider("none")).toBeNull();
  });
  it("builds the Fish Audio request the API reference describes", () => {
    const req = getProvider("fish-audio")!.buildRequest(wav, "KEY");
    expect(req.url).toBe("https://api.fish.audio/v1/asr");
    expect(req.method).toBe("POST");
    expect(req.headers.Authorization).toBe("Bearer KEY");
    expect(req.headers.model).toBe("transcribe-1-pro");
    const s = text(req.body);
    expect(s).toContain('name="audio"; filename="passage.wav"');
    expect(s).toContain('name="ignore_timestamps"\r\n\r\nfalse');
  });
  it("builds the ElevenLabs request", () => {
    const req = getProvider("elevenlabs")!.buildRequest(wav, "KEY");
    expect(req.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(req.headers["xi-api-key"]).toBe("KEY");
    expect(text(req.body)).toContain('name="model_id"\r\n\r\nscribe_v2');
    expect(text(req.body)).toContain('name="file"; filename="passage.wav"');
  });
  it("parses both response shapes into text plus timed segments", () => {
    expect(getProvider("fish-audio")!.parseResponse({ text: " hello there ", duration: 2, segments: [{ text: "hello", start: 0, end: 1 }] }))
      .toEqual({ text: "hello there", segments: [{ text: "hello", start: 0, end: 1 }] });
    expect(getProvider("elevenlabs")!.parseResponse({ text: "hi you", words: [
      { text: "hi", type: "word", start: 0, end: 0.4 }, { text: " ", type: "spacing", start: 0.4, end: 0.5 }, { text: "you", type: "word", start: null, end: null } ] }))
      .toEqual({ text: "hi you", segments: [{ text: "hi", start: 0, end: 0.4 }] });
  });
  it("rejects a response with no text", () => {
    expect(() => getProvider("fish-audio")!.parseResponse({ detail: "nope" })).toThrow(/transcript/i);
    expect(() => getProvider("elevenlabs")!.parseResponse(null)).toThrow(/transcript/i);
  });
});

describe("wire format", () => {
  it("is parsed by an independent multipart parser with the fields each API expects", async () => {
    const wav = encodeWav(new Float32Array(1600), 16000);
    for (const [id, fileField, extra] of [["fish-audio", "audio", ["ignore_timestamps", "false"]], ["elevenlabs", "file", ["model_id", "scribe_v2"]]] as const) {
      const req = getProvider(id)!.buildRequest(wav, "KEY");
      const form = await new Request(req.url, { method: req.method, headers: req.headers, body: req.body }).formData();
      const file = form.get(fileField) as File;
      expect(file.size).toBe(wav.byteLength);
      expect(file.type).toBe("audio/wav");
      expect(form.get(extra[0])).toBe(extra[1]);
    }
  });
});
