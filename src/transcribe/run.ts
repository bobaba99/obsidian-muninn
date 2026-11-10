import { type App, type TFile, requestUrl } from "obsidian";
import { SAMPLE_RATE, decodeToMono16k } from "../audio";
import type { Transcript, TranscriptionProvider } from "./providers";
import { encodeWav } from "./wav";

export const PASSAGE_SEC = 30;

/** Send `PASSAGE_SEC` of `file` starting at `seconds` to the chosen provider. This uploads that audio. */
export async function transcribePassage(app: App, file: TFile, seconds: number, provider: TranscriptionProvider, apiKey: string): Promise<Transcript> {
  if (!apiKey.trim()) throw new Error(`Add your ${provider.name} API key in Muninn's settings first.`);
  const pcm = await decodeToMono16k(await app.vault.readBinary(file));
  const start = Math.min(Math.floor(seconds * SAMPLE_RATE), pcm.length);
  const passage = pcm.subarray(start, start + PASSAGE_SEC * SAMPLE_RATE);
  if (passage.length === 0) throw new Error("There is no audio at that position.");
  const request = provider.buildRequest(encodeWav(passage, SAMPLE_RATE), apiKey.trim());
  const response = await requestUrl({ ...request, contentType: request.headers["Content-Type"], throw: false });
  if (response.status === 401 || response.status === 403) throw new Error(`${provider.name} rejected the API key.`);
  if (response.status === 402) throw new Error(`${provider.name} reports no remaining credit.`);
  if (response.status < 200 || response.status >= 300) throw new Error(`${provider.name} returned an error (${response.status}).`);
  return provider.parseResponse(response.json as unknown);
}
