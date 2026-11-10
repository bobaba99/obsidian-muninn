export interface FileStamp {
  readonly path: string;
  readonly mtime: number;
  readonly size: number;
}

export interface IndexedFile extends FileStamp {
  /** Start time in seconds of each window; vectors are stored in the same order. */
  readonly starts: readonly number[];
  readonly vectors: Float32Array;
}

export interface AudioIndex {
  readonly version: 1;
  readonly dim: number;
  readonly files: readonly IndexedFile[];
}

export const emptyIndex = (dim: number): AudioIndex => ({ version: 1, dim, files: [] });

export function removeFile(index: AudioIndex, path: string): AudioIndex {
  return { ...index, files: index.files.filter((f) => f.path !== path) };
}

export function upsertFile(index: AudioIndex, stamp: FileStamp, starts: readonly number[], vectors: readonly Float32Array[]): AudioIndex {
  if (starts.length !== vectors.length) throw new Error("starts and vectors differ in length");
  const flat = new Float32Array(vectors.length * index.dim);
  vectors.forEach((v, i) => flat.set(v.subarray(0, index.dim), i * index.dim));
  const file: IndexedFile = { path: stamp.path, mtime: stamp.mtime, size: stamp.size, starts: [...starts], vectors: flat };
  return { ...index, files: [...index.files.filter((f) => f.path !== stamp.path), file] };
}

export function isCurrent(index: AudioIndex, stamp: FileStamp): boolean {
  return index.files.some((f) => f.path === stamp.path && f.mtime === stamp.mtime && f.size === stamp.size);
}

const MAGIC = 0x4541524d; // "EARM"

/** One buffer: magic, JSON length, JSON metadata (padded to 4 bytes), then every vector. */
export function serialize(index: AudioIndex): ArrayBuffer {
  const files = index.files.map((f) => ({ path: f.path, mtime: f.mtime, size: f.size, starts: f.starts }));
  const floats = index.files.reduce((n, f) => n + f.vectors.length, 0);
  const json = new TextEncoder().encode(JSON.stringify({ version: index.version, dim: index.dim, floats, files }));
  const jsonBytes = Math.ceil(json.length / 4) * 4;
  const out = new ArrayBuffer(8 + jsonBytes + floats * 4);
  const view = new DataView(out);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, json.length, true);
  new Uint8Array(out, 8, json.length).set(json);
  const all = new Float32Array(out, 8 + jsonBytes, floats);
  let offset = 0;
  for (const f of index.files) { all.set(f.vectors, offset); offset += f.vectors.length; }
  return out;
}

/** Returns null when the stored data is unreadable, truncated or inconsistent, so the caller can rebuild. */
export function deserialize(data: ArrayBuffer): AudioIndex | null {
  try {
    const view = new DataView(data);
    if (view.getUint32(0, true) !== MAGIC) return null;
    const jsonLength = view.getUint32(4, true);
    const m = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 8, jsonLength))) as
      { version: number; dim: number; floats: number; files: (FileStamp & { starts: number[] })[] };
    const vectorsAt = 8 + Math.ceil(jsonLength / 4) * 4;
    if (m.version !== 1 || !Number.isInteger(m.dim) || data.byteLength !== vectorsAt + m.floats * 4) return null;
    const all = new Float32Array(data, vectorsAt, m.floats);
    let offset = 0;
    const files = m.files.map((f) => {
      const len = f.starts.length * m.dim;
      const file: IndexedFile = { path: f.path, mtime: f.mtime, size: f.size, starts: f.starts, vectors: all.slice(offset, offset + len) };
      offset += len;
      return file;
    });
    return offset === m.floats ? { version: 1, dim: m.dim, files } : null;
  } catch {
    return null;
  }
}
