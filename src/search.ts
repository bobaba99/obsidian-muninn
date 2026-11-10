import type { AudioIndex } from "./store";

export interface Hit {
  readonly path: string;
  readonly seconds: number;
  readonly score: number;
}

/** Keep the leading `dim` values and re-normalize (required after Matryoshka truncation). */
export function truncateNormalize(v: Float32Array, dim: number): Float32Array {
  const out = v.slice(0, dim);
  let norm = 0;
  for (const x of out) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return out.map((x) => x / norm);
}

/**
 * Rank every window by cosine similarity, then keep the best window of each run of
 * neighbours: a hit within `mergeSec` of a better hit in the same file is the same moment.
 */
export function searchIndex(index: AudioIndex, query: Float32Array, limit: number, mergeSec: number): Hit[] {
  const all: Hit[] = [];
  for (const file of index.files) {
    file.starts.forEach((seconds, i) => {
      let score = 0;
      const base = i * index.dim;
      for (let d = 0; d < index.dim; d++) score += (query[d] ?? 0) * (file.vectors[base + d] ?? 0);
      all.push({ path: file.path, seconds, score });
    });
  }
  all.sort((a, b) => b.score - a.score);
  const kept: Hit[] = [];
  for (const hit of all) {
    if (kept.length >= limit) break;
    const duplicate = kept.some((k) => k.path === hit.path && Math.abs(k.seconds - hit.seconds) <= mergeSec);
    if (!duplicate) kept.push(hit);
  }
  return kept;
}
