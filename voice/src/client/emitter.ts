// A tiny typed event emitter. A crashing UI handler must never break the voice pipeline,
// so handler errors are caught and logged.

export class Emitter<Events extends { [K in keyof Events]: unknown }> {
  private handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  /** Subscribe. Returns a function that unsubscribes. */
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => this.off(event, handler);
  }

  off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
    this.handlers.get(event)?.delete(handler as (payload: never) => void);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      try {
        (handler as (p: Events[K]) => void)(payload);
      } catch (err) {
        console.error(`[icarus-voice] a "${String(event)}" handler threw:`, err);
      }
    }
  }
}
