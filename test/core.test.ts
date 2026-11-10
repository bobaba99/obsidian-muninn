import { describe, expect, it } from "vitest";
import { planWindows } from "../src/windows";
import { formatTime, timestampLink, parseLinkParams } from "../src/links";
import { searchIndex, truncateNormalize } from "../src/search";
import { emptyIndex, upsertFile, removeFile, serialize, deserialize } from "../src/store";

describe("planWindows", () => {
  it("covers the whole recording with overlapping windows", () => {
    const w = planWindows(16000 * 35, 16000, 15, 10);
    expect(w.map((x) => x.startSec)).toEqual([0, 10, 20]);
    expect(w.at(-1)!.endSample).toBe(16000 * 35);
  });
  it("returns one window for audio shorter than a window", () => {
    expect(planWindows(16000 * 4, 16000, 15, 10)).toEqual([{ startSec: 0, startSample: 0, endSample: 64000 }]);
  });
  it("drops a trailing sliver shorter than the minimum and returns nothing for empty audio", () => {
    expect(planWindows(16000 * 30.5, 16000, 10, 10).map((x) => x.startSec)).toEqual([0, 10, 20]);
    expect(planWindows(0, 16000, 15, 10)).toEqual([]);
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
