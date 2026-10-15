// Counts what we spend. STT seconds come from the browser (it talks to Scribe directly).
// TTS characters are counted here, because every TTS call goes through our server.
// Prints a running total so nobody is surprised by the credit bill.

import type { UsageTotals } from '../shared/types';

export class UsageTracker {
  private sessions = new Map<string, UsageTotals>();
  private lastPrint = 0;

  constructor(private readonly print: (line: string) => void = (l) => console.log(l)) {}

  private row(sessionId: string): UsageTotals {
    let row = this.sessions.get(sessionId);
    if (!row) {
      row = { sttSeconds: 0, ttsCharacters: 0, ttsCharactersFromCache: 0 };
      this.sessions.set(sessionId, row);
    }
    return row;
  }

  addTts(sessionId: string, characters: number, fromCache: boolean): UsageTotals {
    const row = this.row(sessionId);
    if (fromCache) row.ttsCharactersFromCache += characters;
    else row.ttsCharacters += characters;
    this.report(sessionId, true);
    return { ...row };
  }

  /** The browser reports the running total of seconds it has streamed to Scribe. */
  setStt(sessionId: string, totalSeconds: number): UsageTotals {
    const row = this.row(sessionId);
    row.sttSeconds = Math.max(row.sttSeconds, totalSeconds);
    this.report(sessionId, false);
    return { ...row };
  }

  get(sessionId: string): UsageTotals {
    return { ...this.row(sessionId) };
  }

  all(): UsageTotals {
    const total: UsageTotals = { sttSeconds: 0, ttsCharacters: 0, ttsCharactersFromCache: 0 };
    for (const row of this.sessions.values()) {
      total.sttSeconds += row.sttSeconds;
      total.ttsCharacters += row.ttsCharacters;
      total.ttsCharactersFromCache += row.ttsCharactersFromCache;
    }
    return total;
  }

  private report(sessionId: string, force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastPrint < 5000) return;
    this.lastPrint = now;
    const s = this.row(sessionId);
    const a = this.all();
    this.print(
      `[usage] session ${sessionId.slice(0, 8)}: STT ${s.sttSeconds.toFixed(1)}s, TTS ${s.ttsCharacters} chars ` +
        `(+${s.ttsCharactersFromCache} from cache) | all sessions: STT ${a.sttSeconds.toFixed(1)}s, TTS ${a.ttsCharacters} chars`,
    );
  }
}
