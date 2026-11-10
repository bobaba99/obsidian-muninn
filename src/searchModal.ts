import { type App, type Instruction, SuggestModal } from "obsidian";
import { formatTime } from "./links";
import type { Hit } from "./search";

const DEBOUNCE_MS = 200;

export class AudioSearchModal extends SuggestModal<Hit> {
  private timer: number | null = null;
  private settlePending: ((hits: Hit[]) => void) | null = null;
  private latest = 0;

  constructor(
    app: App,
    private readonly search: (query: string) => Promise<Hit[]>,
    private readonly onPlay: (hit: Hit) => void,
    private readonly onInsert: (hit: Hit) => void,
  ) {
    super(app);
    this.setPlaceholder("Describe what was said…");
    this.emptyStateText = "Type what you remember from a recording.";
    const instructions: Instruction[] = [
      { command: "↵", purpose: "play from that moment" },
      { command: "shift ↵", purpose: "insert a link into the note" },
    ];
    this.setInstructions(instructions);
    this.scope.register(["Shift"], "Enter", (evt) => {
      (this as unknown as { chooser: { useSelectedItem(e: KeyboardEvent): void } }).chooser.useSelectedItem(evt);
      return false;
    });
  }

  /** Cancel the waiting search, if any, so its promise settles instead of hanging. */
  private cancelPending(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.settlePending?.([]);
    this.settlePending = null;
  }

  getSuggestions(query: string): Promise<Hit[]> {
    this.cancelPending();
    const request = ++this.latest;
    const trimmed = query.trim();
    if (trimmed.length < 2) return Promise.resolve([]);
    return new Promise((resolve) => {
      this.settlePending = resolve;
      this.timer = window.setTimeout(() => {
        this.timer = null;
        this.settlePending = null;
        // An answer that arrives after a newer keystroke is dropped.
        this.search(trimmed).then((hits) => resolve(request === this.latest ? hits : []), (error) => {
          console.error("Earmark: search failed", error);
          resolve([]);
        });
      }, DEBOUNCE_MS);
    });
  }

  onClose(): void {
    this.latest++;
    this.cancelPending();
    super.onClose();
  }

  renderSuggestion(hit: Hit, el: HTMLElement): void {
    el.addClass("earmark-hit");
    el.createDiv({ cls: "earmark-hit-title", text: `${formatTime(hit.seconds)} · ${hit.path.split("/").pop() ?? hit.path}` });
    el.createDiv({ cls: "earmark-hit-sub", text: `${hit.path} · match ${hit.score.toFixed(2)}` });
  }

  onChooseSuggestion(hit: Hit, evt: MouseEvent | KeyboardEvent): void {
    if (evt.shiftKey) this.onInsert(hit);
    else this.onPlay(hit);
  }
}
