export const PROTOCOL_ACTION = "muninn";

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Markdown link that reopens `path` at `seconds` through the plugin's obsidian:// handler. */
export function timestampLink(path: string, seconds: number): string {
  const name = (path.split("/").pop() ?? path).replace(/[[\]]/g, "");
  const query = new URLSearchParams({ file: path, t: String(Math.floor(seconds)) });
  return `[▶ ${formatTime(seconds)} · ${name}](obsidian://${PROTOCOL_ACTION}?${query.toString().replace(/\+/g, "%20")})`;
}

export function parseLinkParams(params: Record<string, string | undefined>): { path: string; seconds: number } | null {
  const path = params.file;
  const seconds = Number(params.t);
  if (!path || !Number.isFinite(seconds) || seconds < 0) return null;
  return { path, seconds };
}
