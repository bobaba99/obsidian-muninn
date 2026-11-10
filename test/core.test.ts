import { describe, expect, it } from "vitest";
import { Resampler, WindowCutter } from "../src/windowStream";
import { formatTime, timestampLink, parseLinkParams } from "../src/links";
import { searchIndex, truncateNormalize } from "../src/search";
import { emptyIndex, upsertFile, removeFile, serialize, deserialize } from "../src/store";

describe("WindowCutter", () => {
  const cutAll = (seconds: number, windowSec: number, stepSec: number, chunk = 16000 * 7) => {
    const cutter = new WindowCutter(16000, windowSec, stepSec);
    const total = Math.round(seconds * 16000);
    const out = [];
    for (let at = 0; at < total; at += chunk) out.push(...cutter.push(new Float32Array(Math.min(chunk, total - at)).fill(at)));
    return [...out, ...cutter.finish()];
  };
  it("covers the whole recording with overlapping windows, however the audio arrives", () => {
    for (const chunk of [16000 * 7, 1000, 16000 * 60]) {
      const w = cutAll(35, 15, 10, chunk);
      expect(w.map((x) => x.startSec)).toEqual([0, 10, 20]);
      expect(w.map((x) => x.samples.length / 16000)).toEqual([15, 15, 15]);
    }
  });
  it("keeps a final shorter window when it holds new audio", () => {
    const w = cutAll(42, 15, 10);
    expect(w.map((x) => x.startSec)).toEqual([0, 10, 20, 30]);
    expect(w.at(-1)!.samples.length / 16000).toBe(12);
  });
  it("returns one window for audio shorter than a window, and nothing for silence of zero length", () => {
    expect(cutAll(4, 15, 10).map((x) => [x.startSec, x.samples.length])).toEqual([[0, 64000]]);
    expect(cutAll(0, 15, 10)).toEqual([]);
  });
  it("drops a trailing sliver under one second of new audio", () => {
    expect(cutAll(30.5, 10, 10).map((x) => x.startSec)).toEqual([0, 10, 20]);
  });
});

describe("Resampler", () => {
  it("produces the right number of samples and keeps a slow tone intact, whatever the chunk size", () => {
    const tone = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 100 * i) / 48000));
    for (const chunk of [48000, 4096, 1001]) {
      const r = new Resampler(48000, 16000);
      const parts: number[] = [];
      for (let at = 0; at < tone.length; at += chunk) parts.push(...r.push(tone.subarray(at, at + chunk)));
      expect(parts.length).toBe(16000);
      const worst = Math.max(...parts.map((v, i) => Math.abs(v - Math.sin((2 * Math.PI * 100 * (i + 1 / 3)) / 16000))));
      expect(worst).toBeLessThan(0.01);
    }
  });
  it("handles a non-integer ratio (44.1 kHz) and passes 16 kHz through unchanged", () => {
    const r = new Resampler(44100, 16000);
    expect(r.push(new Float32Array(44100)).length + r.push(new Float32Array(44100)).length).toBe(32000);
    expect(Array.from(new Resampler(16000, 16000).push(Float32Array.from([1, 2, 3])))).toEqual([1, 2, 3]);
  });
  it("removes a tone above the new rate's limit instead of folding it into the speech range", () => {
    const high = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 16000 * i) / 48000));
    const out = new Resampler(48000, 16000).push(high);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(0.01);
  });
});

describe("links", () => {
  it("formats times", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(83)).toBe("1:23");
    expect(formatTime(3723)).toBe("1:02:03");
  });
  it("round-trips a timestamp link, including awkward file names", () => {
    const path = "Recordings/Interview #2 (final) & notes.m4a";
    const link = timestampLink(path, 83);
    expect(link).toMatch(/^\[.*1:23.*\]\(obsidian:\/\/muninn\?/);
    const url = new URL(link.slice(link.lastIndexOf("](") + 2, -1));
    expect(parseLinkParams(Object.fromEntries(url.searchParams))).toEqual({ path, seconds: 83 });
  });
  it("rejects malformed params", () => {
    expect(parseLinkParams({ file: "a.mp3", t: "abc" })).toBeNull();
    expect(parseLinkParams({ t: "3" })).toBeNull();
    expect(parseLinkParams({ file: "a.mp3", t: "-5" })).toBeNull();
  });
});

const unit = (...v: number[]) => truncateNormalize(Float32Array.from(v), v.length);

describe("store + search", () => {
  const dim = 2;
  it("upserts, replaces and removes files immutably", () => {
    const a = upsertFile(emptyIndex(dim), { path: "a.mp3", mtime: 1, size: 10 }, [0, 10], [unit(1, 0), unit(0, 1)]);
    const b = upsertFile(a, { path: "b.mp3", mtime: 1, size: 10 }, [0], [unit(1, 1)]);
    expect(a.files).toHaveLength(1);
    expect(b.files).toHaveLength(2);
    const c = upsertFile(b, { path: "a.mp3", mtime: 2, size: 11 }, [0], [unit(0, 1)]);
    expect(c.files.find((f) => f.path === "a.mp3")!.starts).toEqual([0]);
    expect(removeFile(c, "a.mp3").files.map((f) => f.path)).toEqual(["b.mp3"]);
  });
  it("round-trips through serialization", () => {
    const a = upsertFile(emptyIndex(dim), { path: "a.mp3", mtime: 1, size: 10 }, [0, 10], [unit(1, 0), unit(0, 1)]);
    const data = serialize(a);
    expect(deserialize(data)).toEqual(a);
    expect(deserialize(new ArrayBuffer(3))).toBeNull();
    expect(deserialize(data.slice(0, data.byteLength - 4))).toBeNull(); // truncated write
    expect(deserialize(new ArrayBuffer(64))).toBeNull(); // wrong magic
  });
  it("ranks by cosine and collapses adjacent windows of one file", () => {
    let idx = upsertFile(emptyIndex(dim), { path: "a.mp3", mtime: 1, size: 1 }, [0, 10, 20, 300],
      [unit(1, 0.1), unit(1, 0), unit(1, 0.2), unit(1, 0.05)]);
    idx = upsertFile(idx, { path: "b.mp3", mtime: 1, size: 1 }, [0], [unit(0, 1)]);
    const hits = searchIndex(idx, unit(1, 0), 5, 15);
    expect(hits.map((h) => [h.path, h.seconds])).toEqual([["a.mp3", 10], ["a.mp3", 300], ["b.mp3", 0]]);
    expect(hits[0]!.score).toBeCloseTo(1);
  });
  it("returns nothing for an empty index", () => {
    expect(searchIndex(emptyIndex(dim), unit(1, 0), 5, 15)).toEqual([]);
  });
});
