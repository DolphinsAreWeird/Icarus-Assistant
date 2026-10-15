// Audio cache. The key is a hash of everything that changes the sound:
// voice, model, speed, output format and the exact text.
// Same line again means no API call and no credits.
//
// Two folders are read:
//   demo-audio/    committed to git, made by `npm run pregenerate`. Safe for the stage.
//   .audio-cache/  scratch folder filled while the app runs. Ignored by git.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface CacheKeyParts {
  voiceId: string;
  model: string;
  speed: number;
  outputFormat: string;
  text: string;
}

export interface CacheMeta extends CacheKeyParts {
  sampleRate: number;
  bytes: number;
  createdAt: string;
}

export function cacheKey(parts: CacheKeyParts): string {
  const payload = JSON.stringify([parts.voiceId, parts.model, parts.speed, parts.outputFormat, parts.text]);
  return createHash('sha256').update(payload).digest('hex');
}

export interface CacheHit {
  key: string;
  meta: CacheMeta;
  /** Raw 16-bit PCM audio, in chunks. */
  chunks(): AsyncGenerator<Uint8Array>;
}

export class TtsCache {
  /** @param readDirs searched in order. @param writeDir where new audio is saved. */
  constructor(
    private readonly readDirs: string[],
    private readonly writeDir: string,
  ) {}

  async get(key: string): Promise<CacheHit | null> {
    for (const dir of this.readDirs) {
      const audioPath = path.join(dir, `${key}.pcm`);
      try {
        const [meta, info] = await Promise.all([
          readFile(path.join(dir, `${key}.json`), 'utf8').then((s) => JSON.parse(s) as CacheMeta),
          stat(audioPath),
        ]);
        if (info.size === 0) continue;
        return {
          key,
          meta,
          async *chunks() {
            for await (const chunk of createReadStream(audioPath, { highWaterMark: 16 * 1024 })) {
              yield chunk as Uint8Array;
            }
          },
        };
      } catch {
        // Not in this folder. Try the next one.
      }
    }
    return null;
  }

  /** Save finished audio. Writes to a temp name first so a half-written file is never read. */
  async put(key: string, meta: CacheMeta, audio: Uint8Array): Promise<void> {
    if (audio.byteLength === 0) return;
    await mkdir(this.writeDir, { recursive: true });
    const audioPath = path.join(this.writeDir, `${key}.pcm`);
    const tmp = `${audioPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, audio);
    await rename(tmp, audioPath);
    await writeFile(path.join(this.writeDir, `${key}.json`), JSON.stringify(meta, null, 2));
  }
}
