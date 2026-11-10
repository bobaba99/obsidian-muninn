export interface Window {
  readonly startSec: number;
  readonly startSample: number;
  readonly endSample: number;
}

const MIN_TAIL_SEC = 1;

/** Split `totalSamples` of audio into overlapping windows of `windowSec`, advancing by `hopSec`. */
export function planWindows(totalSamples: number, sampleRate: number, windowSec: number, hopSec: number): Window[] {
  const windows: Window[] = [];
  const win = Math.round(windowSec * sampleRate);
  const hop = Math.round(hopSec * sampleRate);
  for (let start = 0; start < totalSamples; start += hop) {
    const end = Math.min(start + win, totalSamples);
    const isSliver = start > 0 && end - start < MIN_TAIL_SEC * sampleRate;
    if (!isSliver) windows.push({ startSec: start / sampleRate, startSample: start, endSample: end });
    if (end === totalSamples) break;
  }
  return windows;
}
