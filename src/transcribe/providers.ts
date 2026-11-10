import { encodeMultipart } from "./multipart";

export interface Segment { readonly text: string; readonly start: number; readonly end: number }
export interface Transcript { readonly text: string; readonly segments: readonly Segment[] }
export interface ProviderRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Record<string, string>;
  readonly body: ArrayBuffer;
}

/** A cloud speech-to-text service the user can opt into with their own API key. */
export interface TranscriptionProvider {
  readonly id: string;
  readonly name: string;
  readonly keyPlaceholder: string;
  buildRequest(wav: ArrayBuffer, apiKey: string): ProviderRequest;
  parseResponse(json: unknown): Transcript;
}

const FILE = { filename: "passage.wav", type: "audio/wav" } as const;
const NO_TRANSCRIPT = "The service returned no transcript.";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isTimed = (v: unknown): v is Segment =>
  isRecord(v) && typeof v.text === "string" && typeof v.start === "number" && typeof v.end === "number";

// Request and response per https://docs.fish.audio/api-reference/endpoint/openapi-v1/speech-to-text
const fishAudio: TranscriptionProvider = {
  id: "fish-audio",
  name: "Fish Audio",
  keyPlaceholder: "Fish Audio API key",
  buildRequest(wav, apiKey) {
    const { body, contentType } = encodeMultipart([
      { name: "audio", value: wav, ...FILE },
      { name: "ignore_timestamps", value: "false" },
    ]);
    // The model must be an exact lowercase header; anything else is silently served by the retiring transcribe-1.
    return { url: "https://api.fish.audio/v1/asr", method: "POST", body,
      headers: { Authorization: `Bearer ${apiKey}`, model: "transcribe-1-pro", "Content-Type": contentType } };
  },
  parseResponse(json) {
    if (!isRecord(json) || typeof json.text !== "string") throw new Error(NO_TRANSCRIPT);
    const segments = Array.isArray(json.segments) ? json.segments.filter(isTimed).map(({ text, start, end }) => ({ text, start, end })) : [];
    return { text: json.text.trim(), segments };
  },
};

// Request and response per https://elevenlabs.io/docs/api-reference/speech-to-text/convert
const elevenLabs: TranscriptionProvider = {
  id: "elevenlabs",
  name: "ElevenLabs",
  keyPlaceholder: "ElevenLabs API key",
  buildRequest(wav, apiKey) {
    const { body, contentType } = encodeMultipart([
      { name: "model_id", value: "scribe_v2" },
      { name: "file", value: wav, ...FILE },
    ]);
    return { url: "https://api.elevenlabs.io/v1/speech-to-text", method: "POST", body,
      headers: { "xi-api-key": apiKey, "Content-Type": contentType } };
  },
  parseResponse(json) {
    if (!isRecord(json) || typeof json.text !== "string") throw new Error(NO_TRANSCRIPT);
    const words = Array.isArray(json.words) ? json.words : [];
    const segments = words.filter((w): w is Segment & { type: string } => isTimed(w) && isRecord(w) && w.type === "word")
      .map(({ text, start, end }) => ({ text, start, end }));
    return { text: json.text.trim(), segments };
  },
};

export const PROVIDERS: readonly TranscriptionProvider[] = [fishAudio, elevenLabs];
export const getProvider = (id: string): TranscriptionProvider | null => PROVIDERS.find((p) => p.id === id) ?? null;
