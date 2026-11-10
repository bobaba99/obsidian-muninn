import type { App, TFile } from "obsidian";
import { SAMPLE_RATE, decodeToMono16k, isAudioPath } from "./audio";
import type { Embedder } from "./embedder";
import { type AudioIndex, deserialize, emptyIndex, isCurrent, removeFile, serialize, upsertFile } from "./store";
import { planWindows } from "./windows";

export const WINDOW_SEC = 15;
export const HOP_SEC = 10;

export interface IndexProgress {
  readonly done: number;
  readonly total: number;
  readonly path: string;
}

export interface IndexRun {
  readonly index: AudioIndex;
  readonly indexed: number;
  readonly failed: readonly string[];
  readonly audioSeconds: number;
  readonly wallSeconds: number;
}

export const audioFiles = (app: App): TFile[] => app.vault.getFiles().filter((f) => isAudioPath(f.path));

export const pendingFiles = (app: App, index: AudioIndex): TFile[] =>
  audioFiles(app).filter((f) => !isCurrent(index, { path: f.path, mtime: f.stat.mtime, size: f.stat.size }));

/** Embed every new or changed audio file and drop entries whose file is gone. Saves after each file. */
export async function indexVault(
  app: App,
  embedder: Embedder,
  start: AudioIndex,
  save: (index: AudioIndex) => Promise<void>,
  onProgress: (p: IndexProgress) => void,
  shouldStop: () => boolean,
): Promise<IndexRun> {
  const present = new Set(audioFiles(app).map((f) => f.path));
  let index = start.files.reduce((acc, f) => (present.has(f.path) ? acc : removeFile(acc, f.path)), start);
  const todo = pendingFiles(app, index);
  const failed: string[] = [];
  let audioSeconds = 0;
  let indexed = 0;
  const t0 = Date.now();
  for (const [i, file] of todo.entries()) {
    if (shouldStop()) break;
    onProgress({ done: i, total: todo.length, path: file.path });
    try {
      // Taken before the read: if the file changes while we embed it, the old stamp makes the next run redo it.
      const stamp = { path: file.path, mtime: file.stat.mtime, size: file.stat.size };
      const pcm = await decodeToMono16k(await app.vault.readBinary(file));
      const windows = planWindows(pcm.length, SAMPLE_RATE, WINDOW_SEC, HOP_SEC);
      const vectors: Float32Array[] = [];
      for (const w of windows) {
        if (shouldStop()) break;
        vectors.push(await embedder.embedAudio(pcm.subarray(w.startSample, w.endSample)));
      }
      if (vectors.length !== windows.length) break; // stopped mid-file: keep the old entry
      index = upsertFile(index, stamp, windows.map((w) => w.startSec), vectors);
      audioSeconds += pcm.length / SAMPLE_RATE;
      indexed++;
      await save(index);
    } catch (error) {
      console.error(`Muninn: could not index ${file.path}`, error);
      failed.push(file.path);
    }
  }
  await save(index);
  return { index, indexed, failed, audioSeconds, wallSeconds: (Date.now() - t0) / 1000 };
}

const indexPath = (dir: string): string => `${dir}/index.bin`;

export async function loadIndex(app: App, dir: string, dim: number): Promise<AudioIndex> {
  try {
    if (!(await app.vault.adapter.exists(indexPath(dir)))) return emptyIndex(dim);
    const index = deserialize(await app.vault.adapter.readBinary(indexPath(dir)));
    return index && index.dim === dim ? index : emptyIndex(dim);
  } catch (error) {
    console.error("Muninn: could not read the index, starting empty", error);
    return emptyIndex(dim);
  }
}

export async function saveIndex(app: App, dir: string, index: AudioIndex): Promise<void> {
  await app.vault.adapter.writeBinary(indexPath(dir), serialize(index));
}
