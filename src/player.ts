import { ItemView, TFile, type WorkspaceLeaf } from "obsidian";
import { formatTime } from "./links";

export const PLAYER_VIEW = "muninn-player";

export class PlayerView extends ItemView {
  private audio: HTMLAudioElement | null = null;
  private titleEl2: HTMLElement | null = null;
  private objectUrl: string | null = null;
  private path = "";
  private playRequest = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly onInsertLink: (path: string, seconds: number) => void,
    private readonly onTranscribe: (path: string, seconds: number) => void,
  ) {
    super(leaf);
  }

  getViewType(): string { return PLAYER_VIEW; }
  getDisplayText(): string { return "Muninn player"; }
  getIcon(): string { return "audio-lines"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("muninn-player");
    this.titleEl2 = root.createDiv({ cls: "muninn-player-title", text: "Nothing playing" });
    this.audio = root.createEl("audio", { attr: { controls: "true", preload: "auto" } });
    const row = root.createDiv({ cls: "muninn-player-row" });
    for (const delta of [-15, 15]) {
      row.createEl("button", { text: `${delta > 0 ? "+" : "−"}${Math.abs(delta)}s` }).addEventListener("click", () => {
        if (this.audio) this.audio.currentTime = Math.max(0, this.audio.currentTime + delta);
      });
    }
    row.createEl("button", { text: "Insert link to this moment", cls: "mod-cta" }).addEventListener("click", () => {
      if (this.audio && this.path) this.onInsertLink(this.path, this.audio.currentTime);
    });
    row.createEl("button", { text: "Transcribe from here" }).addEventListener("click", () => {
      if (this.audio && this.path) this.onTranscribe(this.path, this.audio.currentTime);
    });
  }

  async onClose(): Promise<void> {
    this.audio?.pause();
    this.releaseUrl();
  }

  private releaseUrl(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  /** Load `file` if it is not the current one, then seek to `seconds` and play. */
  async play(file: TFile, seconds: number): Promise<void> {
    const audio = this.audio;
    if (!audio) return;
    const request = ++this.playRequest;
    if (this.path !== file.path) {
      // A fully buffered blob can be seeked even when the container has no seek table,
      // which is the case for recordings made by Obsidian's own recorder.
      const url = URL.createObjectURL(new Blob([await this.app.vault.readBinary(file)]));
      if (request !== this.playRequest) { URL.revokeObjectURL(url); return; }
      this.path = "";
      this.releaseUrl();
      this.objectUrl = url;
      audio.src = url;
      await new Promise<void>((resolve, reject) => {
        const done = (error?: Error): void => {
          audio.removeEventListener("loadedmetadata", onLoad);
          audio.removeEventListener("error", onError);
          if (error) reject(error); else resolve();
        };
        const onLoad = (): void => done();
        const onError = (): void => done(new Error(`Cannot play ${file.path}`));
        audio.addEventListener("loadedmetadata", onLoad);
        audio.addEventListener("error", onError);
      });
      if (request !== this.playRequest) return;
      this.path = file.path;
    }
    audio.currentTime = seconds;
    this.titleEl2?.setText(`${file.basename} · from ${formatTime(seconds)}`);
    await audio.play();
  }
}
