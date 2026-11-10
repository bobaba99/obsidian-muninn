import { type Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { type AudioDtype, type Device, type Embedder, loadEmbedder } from "./embedder";
import { audioFiles, indexVault, loadIndex, pendingFiles, saveIndex } from "./indexer";
import { PROTOCOL_ACTION, parseLinkParams, timestampLink } from "./links";
import { PLAYER_VIEW, PlayerView } from "./player";
import { type Hit, searchIndex } from "./search";
import { AudioSearchModal } from "./searchModal";
import { type AudioIndex, emptyIndex } from "./store";
import { PROVIDERS, getProvider } from "./transcribe/providers";
import { PASSAGE_SEC, transcribePassage } from "./transcribe/run";

const DIM = 256;
const RESULT_LIMIT = 10;
const MERGE_SEC = 20;

interface Settings {
  device: Device;
  audioDtype: AudioDtype;
  /** "none" keeps everything on this computer. */
  transcriptionProvider: string;
  apiKeys: Record<string, string>;
}
const DEFAULTS: Settings = { device: "webgpu", audioDtype: "fp16", transcriptionProvider: "none", apiKeys: {} };

export default class EarmarkPlugin extends Plugin {
  settings: Settings = DEFAULTS;
  private index: AudioIndex = emptyIndex(DIM);
  private embedder: Promise<Embedder> | null = null;
  private indexing = false;
  private stopRequested = false;
  private status: HTMLElement | null = null;
  private lastEditor: Editor | null = null;
  private indexLoaded: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...((await this.loadData()) as Partial<Settings> | null) };
    this.status = this.addStatusBarItem();
    this.registerView(PLAYER_VIEW, (leaf) => new PlayerView(leaf,
      (path, s) => this.insertLink({ path, seconds: s, score: 0 }),
      (path, s) => void this.transcribeAt(path, s)));
    this.addRibbonIcon("audio-lines", "Search audio", () => this.openSearch());
    this.addCommand({ id: "search", name: "Search audio", callback: () => this.openSearch() });
    this.addCommand({ id: "index", name: "Index audio files", callback: () => void this.runIndexing() });
    this.addCommand({ id: "stop-index", name: "Stop indexing", callback: () => { this.stopRequested = true; } });
    this.addSettingTab(new EarmarkSettingTab(this));
    this.registerObsidianProtocolHandler(PROTOCOL_ACTION, (params) => {
      const target = parseLinkParams(params);
      if (target) void this.playAt(target.path, target.seconds);
      else new Notice("Earmark: that link is not valid.");
    });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) this.lastEditor = view.editor;
    }));
    this.indexLoaded = new Promise((resolve) => this.app.workspace.onLayoutReady(async () => {
      this.index = await loadIndex(this.app, this.dir(), DIM);
      this.showStatus();
      resolve();
    }));
  }

  onunload(): void {
    this.stopRequested = true;
    this.resetEmbedder();
  }

  private dir(): string {
    return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }

  private showStatus(text?: string): void {
    const windows = this.index.files.reduce((n, f) => n + f.starts.length, 0);
    this.status?.setText(text ?? `Earmark: ${this.index.files.length} recordings, ${windows} moments`);
  }

  private getEmbedder(): Promise<Embedder> {
    if (this.embedder) return this.embedder;
    const loading: Promise<Embedder> = loadEmbedder({ device: this.settings.device, audioDtype: this.settings.audioDtype, dim: DIM,
      onProgress: (m) => this.showStatus(`Earmark: ${m}`) }).catch((error) => {
      if (this.embedder === loading) this.embedder = null; // never clear a newer load
      throw error;
    });
    this.embedder = loading;
    return loading;
  }

  /** Drop the loaded model and free its memory; the next use loads it again. */
  resetEmbedder(): void {
    const old = this.embedder;
    this.embedder = null;
    void old?.then((e) => e.dispose()).catch((error) => console.error("Earmark: could not release the model", error));
  }

  private openSearch(): void {
    if (this.index.files.length === 0) {
      new Notice(audioFiles(this.app).length === 0
        ? "Earmark: no audio files in this vault yet."
        : "Earmark: nothing is indexed yet. Run “Index audio files” first; the first run downloads the search model.");
      return;
    }
    const pending = pendingFiles(this.app, this.index).length;
    if (pending > 0) new Notice(`Earmark: ${pending} recording(s) are not indexed yet.`);
    void this.getEmbedder().catch((error: Error) => new Notice(`Earmark: ${error.message}`));
    new AudioSearchModal(
      this.app,
      async (query): Promise<Hit[]> => searchIndex(this.index, await (await this.getEmbedder()).embedQuery(query), RESULT_LIMIT, MERGE_SEC),
      (hit) => void this.playAt(hit.path, hit.seconds),
      (hit) => this.insertLink(hit),
    ).open();
  }

  async runIndexing(): Promise<void> {
    if (this.indexing) { new Notice("Earmark: indexing is already running."); return; }
    this.indexing = true;
    this.stopRequested = false;
    try {
      await this.indexLoaded;
      this.showStatus("Earmark: loading model…");
      const embedder = await this.getEmbedder();
      const run = await indexVault(
        this.app, embedder, this.index,
        async (index) => { this.index = index; await saveIndex(this.app, this.dir(), index); },
        (p) => this.showStatus(`Earmark: indexing ${p.done + 1}/${p.total} · ${p.path.split("/").pop()}`),
        () => this.stopRequested,
      );
      this.index = run.index;
      const speed = run.wallSeconds > 0 ? ` (${(run.audioSeconds / run.wallSeconds).toFixed(0)}× real time)` : "";
      new Notice(`Earmark: indexed ${run.indexed} recording(s)${speed}.` + (run.failed.length ? ` ${run.failed.length} could not be read.` : ""));
    } catch (error) {
      console.error("Earmark: indexing failed", error);
      new Notice(`Earmark: ${error instanceof Error ? error.message : "indexing failed"}`);
    } finally {
      this.indexing = false;
      this.showStatus();
    }
  }

  private async playAt(path: string, seconds: number): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice(`Earmark: ${path} is no longer in the vault.`); return; }
    try {
      let leaf = this.app.workspace.getLeavesOfType(PLAYER_VIEW)[0];
      if (!leaf) {
        leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
        await leaf.setViewState({ type: PLAYER_VIEW, active: true });
      }
      await this.app.workspace.revealLeaf(leaf);
      if (leaf.view instanceof PlayerView) await leaf.view.play(file, seconds);
    } catch (error) {
      console.error("Earmark: playback failed", error);
      new Notice(`Earmark: could not play ${path}.`);
    }
  }

  private editor(): Editor | null {
    const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? this.lastEditor;
    if (!editor) new Notice("Earmark: open a note to insert into.");
    return editor;
  }

  private insertLink(hit: Hit): void {
    this.editor()?.replaceSelection(timestampLink(hit.path, hit.seconds));
  }

  /** Opt-in: uploads a short passage to the provider the user configured, then inserts the text. */
  private async transcribeAt(path: string, seconds: number): Promise<void> {
    const provider = getProvider(this.settings.transcriptionProvider);
    if (!provider) { new Notice("Earmark: choose a transcription service in settings first. Nothing is uploaded until you do."); return; }
    const file = this.app.vault.getAbstractFileByPath(path);
    const editor = this.editor();
    if (!(file instanceof TFile) || !editor) return;
    const notice = new Notice(`Earmark: sending ${PASSAGE_SEC} s to ${provider.name}…`, 0);
    try {
      const transcript = await transcribePassage(this.app, file, seconds, provider, this.settings.apiKeys[provider.id] ?? "");
      editor.replaceSelection(`${timestampLink(path, seconds)}\n> ${transcript.text || "(no speech detected)"}\n`);
    } catch (error) {
      console.error("Earmark: transcription failed", error);
      new Notice(`Earmark: ${error instanceof Error ? error.message : "transcription failed"}`);
    } finally {
      notice.hide();
    }
  }

  isIndexing(): boolean { return this.indexing; }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}

class EarmarkSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: EarmarkPlugin) { super(plugin.app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", {
      text: "Earmark runs the search model on this computer. Your recordings and queries never leave it. The model files are downloaded once from Hugging Face.",
    });
    new Setting(containerEl).setName("Run the model on").setDesc("GPU is much faster. Use CPU if the GPU option fails to load.")
      .addDropdown((d) => d.addOptions({ webgpu: "GPU (WebGPU)", wasm: "CPU" }).setValue(this.plugin.settings.device).onChange(async (v) => {
        if (this.plugin.isIndexing()) { new Notice("Earmark: stop indexing before changing this."); this.display(); return; }
        this.plugin.settings = { ...this.plugin.settings, device: v as Device, audioDtype: v === "webgpu" ? "fp16" : "q8" };
        this.plugin.resetEmbedder();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("Index audio files").setDesc("Indexes new and changed recordings. The first run downloads the model.")
      .addButton((b) => b.setButtonText("Index now").setCta().onClick(() => void this.plugin.runIndexing()));

    new Setting(containerEl).setName("Transcription (optional)").setHeading();
    containerEl.createEl("p", {
      text: `Search never needs this. If you choose a service, the player's Transcribe button uploads ${PASSAGE_SEC} seconds of audio to it, using your own API key, and that service bills you. Keys are stored unencrypted in this plugin's data file.`,
    });
    new Setting(containerEl).setName("Service")
      .addDropdown((d) => d.addOptions({ none: "None (nothing is uploaded)", ...Object.fromEntries(PROVIDERS.map((p) => [p.id, p.name])) })
        .setValue(this.plugin.settings.transcriptionProvider).onChange(async (v) => {
          this.plugin.settings = { ...this.plugin.settings, transcriptionProvider: v };
          await this.plugin.saveSettings();
        }));
    for (const provider of PROVIDERS) {
      new Setting(containerEl).setName(`${provider.name} API key`)
        .addText((t) => {
          t.inputEl.type = "password";
          t.setPlaceholder(provider.keyPlaceholder).setValue(this.plugin.settings.apiKeys[provider.id] ?? "").onChange(async (v) => {
            this.plugin.settings = { ...this.plugin.settings, apiKeys: { ...this.plugin.settings.apiKeys, [provider.id]: v } };
            await this.plugin.saveSettings();
          });
        });
    }
  }
}
