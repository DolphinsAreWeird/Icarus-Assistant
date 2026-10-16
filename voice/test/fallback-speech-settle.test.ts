import { afterEach, describe, expect, it, vi } from 'vitest';
import { IcarusVoice, type IcarusVoiceOptions } from '../src/client/icarus-voice';
import { browserSpeechFallback } from '../src/client/fallback-voice';
import type { PlaybackHandle } from '../src/client/player';
import { FakeApi, FakeMic, FakeOutput, FakeStt, FakeTimers, flush } from './fakes';

type End = 'finished' | 'stopped';

/** A fallback speaker whose outcome the test controls. 'hang' starts speaking and waits for end(). */
function fakeFallback(outcome: 'error' | 'hang') {
  const calls: string[] = [];
  const settles: Array<(r: End) => void> = [];
  let stops = 0;
  const speaker = (text: string, _l: unknown, _v: number, _r: number, onStart: () => void): PlaybackHandle => {
    calls.push(text);
    let settle!: (r: End) => void;
    const finished = new Promise<End>((r) => { settle = r; });
    settles.push(settle);
    if (outcome === 'error') queueMicrotask(() => settle('stopped')); // browser synthesis error
    else queueMicrotask(onStart);
    return { finished, push: () => undefined, end: () => undefined, stop: () => { stops++; settle('stopped'); } };
  };
  /** Browser synthesis reaches its end (onend) or fails (onerror) for the latest utterance. */
  const end = (r: End) => settles[settles.length - 1]!(r);
  return { speaker: speaker as never, calls, stops: () => stops, end };
}

/** Provider TTS sends one chunk (audio starts), then the connection drops mid-stream. */
function failMidStream(api: FakeApi) {
  const original = api.tts.bind(api);
  api.tts = async (req, signal) => {
    const res = await original(req, signal);
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulls++ === 0) c.enqueue(new Uint8Array(4800));
        else c.error(new Error('connection reset'));
      },
    });
    return { ...res, body };
  };
}

async function ready(options: IcarusVoiceOptions = {}) {
  const timers = new FakeTimers();
  const api = new FakeApi();
  const output = new FakeOutput();
  const mic = new FakeMic();
  const stts: FakeStt[] = [];
  const voice = new IcarusVoice({
    ...options,
    config: { confidenceReference: { en: 1, th: 1 }, ...options.config },
    deps: {
      api,
      audio: { unlock: async () => undefined, output: () => output, mic },
      createStt: () => { const f = new FakeStt(); stts.push(f); return f; },
      timers,
      speakFallback: null,
      ...options.deps,
    },
  });
  const confirmIntents: unknown[] = [];
  const errors: string[] = [];
  const ends: string[] = [];
  voice.on('confirmIntent', ((p: unknown) => confirmIntents.push(p)) as never);
  voice.on('error', ((p: { code: string }) => errors.push(p.code)) as never);
  voice.on('speakingEnd', ((p: { reason: string }) => ends.push(p.reason)) as never);
  await voice.start();
  return { voice, api, timers, mic, output, stt: () => stts[stts.length - 1]!, confirmIntents, errors, ends };
}

async function userSays(s: Awaited<ReturnType<typeof ready>>, text: string) {
  s.mic.feed(s.timers, 0.001, 600);
  s.mic.feed(s.timers, 0.2, 400);
  s.stt().partial(text.split(' ').slice(0, 2).join(' '));
  s.mic.feed(s.timers, 0.001, 700);
  s.stt().final(text, 0.95);
  await flush();
}

describe('failed fallback speech settles', () => {
  it('provider TTS fails and browser synthesis errors: speak() settles once, state returns to listening', async () => {
    const fb = fakeFallback('error');
    const s = await ready({ deps: { speakFallback: fb.speaker } });
    s.api.ttsFails = true;
    const p = s.voice.speak('Confirmed. Your gold purchase is on its way.');
    const result = await Promise.race([p, new Promise((r) => setTimeout(() => r('STUCK'), 200))]);
    expect(result).toBe('error');
    expect(fb.calls).toHaveLength(1);
    expect(s.voice.state).toBe('listening');
    // Pacing continues: the next line plays instead of waiting behind a stuck one.
    s.api.ttsFails = false;
    const next = s.voice.speak('Next line.');
    await flush();
    s.output.last.finishNaturally();
    expect(await next).toBe('finished');
  });

  it('a normal reply whose fallback errors does not leave the controller stuck', async () => {
    const fb = fakeFallback('error');
    const s = await ready({ deps: { speakFallback: fb.speaker } });
    s.api.ttsFails = true;
    await userSays(s, 'take me to gold');
    await flush();
    expect(s.voice.state).toBe('listening');
  });

  it('interrupting a fallback line settles exactly once as interrupted/stopped (no double settle)', async () => {
    const fb = fakeFallback('hang');
    const s = await ready({ deps: { speakFallback: fb.speaker } });
    s.api.ttsFails = true;
    const results: string[] = [];
    const p = s.voice.speak('A long line.').then((r) => results.push(r));
    await flush();
    s.voice.stopSpeaking();
    await p;
    await flush();
    expect(results).toEqual(['stopped']);
    expect(s.ends.filter((r) => r === 'stopped')).toHaveLength(1);
    expect(s.voice.state).toBe('listening');
  });
});

describe('failed or interrupted read-back is never approved', () => {
  it('fallback error during the money read-back: no voice confirmation, no confirm intent', async () => {
    const fb = fakeFallback('error');
    const s = await ready({ deps: { speakFallback: fb.speaker } });
    s.api.ttsFails = true;
    await userSays(s, 'put 1,000 baht in gold');
    await flush();
    expect(s.errors).toEqual(expect.arrayContaining(['tts_failed', 'readback_failed']));
    await userSays(s, 'confirm');
    s.timers.advance(60_000);
    expect(s.confirmIntents).toHaveLength(0);
    expect(s.voice.state).toBe('listening');
  });

  it('a read-back stopped by the output (not finished) does not unlock confirm', async () => {
    const s = await ready();
    await userSays(s, 'put 1,000 baht in gold');
    s.output.last.stop(); // output died before the natural end
    await flush();
    await userSays(s, 'confirm');
    s.timers.advance(60_000);
    expect(s.confirmIntents).toHaveLength(0);
  });
});

describe('provider stream drops mid-line and the browser voice takes over', () => {
  it('the cut-off provider handle does not end the fallback; the fallback finishing completes the line', async () => {
    const fb = fakeFallback('hang');
    const s = await ready({ deps: { speakFallback: fb.speaker } });
    failMidStream(s.api);
    const results: string[] = [];
    const p = s.voice.speak('A line that survives a dropped connection.').then((r) => results.push(r));
    await flush();
    expect(s.output.last.stopped).toBe(true); // the half-played provider audio was cut
    expect(fb.calls).toHaveLength(1);
    expect(results).toEqual([]); // still speaking through the browser voice
    expect(s.voice.state).toBe('speaking');
    fb.end('finished');
    await p;
    expect(results).toEqual(['finished']);
    expect(s.ends).toEqual(['finished']);
    expect(s.voice.state).toBe('listening');
  });

  it('a read-back finished by the fallback after a mid-stream drop still unlocks confirm', async () => {
    const fb = fakeFallback('hang');
    const s = await ready({ deps: { speakFallback: fb.speaker } });
    failMidStream(s.api);
    await userSays(s, 'put 1,000 baht in gold');
    await flush();
    expect(s.errors).toEqual(['tts_failed']);
    expect(s.errors).not.toContain('readback_failed');
    fb.end('finished');
    await flush();
    await userSays(s, 'confirm');
    s.timers.advance(3000);
    expect(s.confirmIntents).toHaveLength(1);
  });

  it('a read-back whose fallback errors after a mid-stream drop stays unapproved and ends once', async () => {
    const fb = fakeFallback('hang');
    const s = await ready({ deps: { speakFallback: fb.speaker } });
    failMidStream(s.api);
    await userSays(s, 'put 1,000 baht in gold');
    await flush();
    fb.end('stopped'); // browser synthesis onerror after it had started speaking
    await flush();
    expect(s.errors).toEqual(['tts_failed', 'readback_failed']);
    expect(s.ends).toEqual(['error']); // speakingStart was sent, so exactly one speakingEnd follows
    expect(s.voice.state).toBe('listening');
    await userSays(s, 'confirm');
    s.timers.advance(60_000);
    expect(s.confirmIntents).toHaveLength(0);
  });
});

describe('browserSpeechFallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('onerror resolves stopped; a later onend/stop cannot flip the outcome', async () => {
    let utter: { onerror?: () => void; onend?: () => void } = {};
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) { utter = this as never; } });
    vi.stubGlobal('speechSynthesis', { speak: () => undefined, cancel: () => undefined });
    const h = browserSpeechFallback('hi', 'en', 1, 1, () => undefined)!;
    utter.onerror!();
    utter.onend!();
    h.stop();
    expect(await h.finished).toBe('stopped');
  });
});
