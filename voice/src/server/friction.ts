// Friction log stub.
//
// ASSISTANT TEAM (Luka and First): replace the body of logFriction() with your real
// friction log or the `log_friction` tool call (context.md section 8). The voice layer
// calls it once for every final transcript. Nothing else in the voice code needs to change.

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface FrictionEvent {
  /** Event type. The voice layer sends 'voice_final'. */
  type: string;
  /** Screen the user was on, taken from snapshot.screen if the frontend provides it. */
  screen: string | null;
  text: string;
  language: string;
  confidence: number | null;
  userId: string;
  sessionId: string;
  /** 'voice' for real speech, 'simulated' for the test page buttons. */
  source: string;
  ts: string;
}

export type FrictionSink = (event: FrictionEvent) => Promise<void> | void;

/** Default stub: prints a short line and appends the event to logs/friction.jsonl. */
export function createFrictionLogger(logDir: string, print: (line: string) => void = (l) => console.log(l)): FrictionSink {
  return async function logFriction(event: FrictionEvent) {
    print(`[friction] ${event.type} (${event.language}${event.confidence === null ? '' : `, ${event.confidence.toFixed(2)}`}): ${event.text}`);
    await mkdir(logDir, { recursive: true });
    await appendFile(path.join(logDir, 'friction.jsonl'), JSON.stringify(event) + '\n');
  };
}
