export type AutosaveState = "idle" | "pending" | "saving" | "saved" | "error";

export function autosaveIsBusy(state: AutosaveState, writable: boolean): boolean {
  return state === "saving" || (state === "pending" && writable);
}

export class DebouncedAutosave<T> {
  private pending: T | null = null;
  private active: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private writable = true;

  constructor(
    private readonly write: (value: T) => Promise<void>,
    private readonly onState: (state: AutosaveState) => void,
    private readonly onError: (reason: unknown) => void,
    private readonly delay = 600,
  ) {}

  get hasUnsavedChanges(): boolean {
    return this.pending !== null || this.active !== null;
  }

  queue(value: T): void {
    this.pending = value;
    this.clearTimer();
    this.onState(this.active ? "saving" : "pending");
    if (!this.paused && this.writable) this.timer = setTimeout(() => { void this.flush(); }, this.delay);
  }

  setWritable(value: boolean): void {
    this.writable = value;
    this.clearTimer();
    if (value && this.pending !== null) this.queue(this.pending);
  }

  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    this.paused = false;
    if (this.pending !== null) this.queue(this.pending);
  }

  flush(): Promise<void> {
    this.clearTimer();
    if (this.active) return this.active;
    if (this.paused || !this.writable || this.pending === null) return Promise.resolve();
    this.active = this.drain().finally(() => { this.active = null; });
    return this.active;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async drain(): Promise<void> {
    while (this.pending !== null && !this.paused && this.writable) {
      const value = this.pending;
      this.pending = null;
      this.onState("saving");
      try {
        await this.write(value);
      } catch (reason) {
        if (this.pending === null) this.pending = value;
        this.clearTimer();
        this.onState("error");
        this.onError(reason);
        return;
      }
    }
    this.clearTimer();
    this.onState(this.pending === null ? "saved" : "pending");
  }
}
