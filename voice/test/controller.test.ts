import { beforeEach, describe, expect, it } from 'vitest';
import { IcarusVoice, type IcarusVoiceOptions } from '../src/client/icarus-voice';
import type { VoiceEvents } from '../src/shared/types';
import { FakeApi, FakeMic, FakeOutput, FakeStt, FakeTimers, flush } from './fakes';

type Log = { [K in keyof VoiceEvents]: Array<VoiceEvents[K]> };

function setup(options: IcarusVoiceOptions = {}) {
  const timers = new FakeTimers();
  const api = new FakeApi();
  const output = new FakeOutput();
  const mic = new FakeMic();
  const stts: FakeStt[] = [];
  /** Flip failNew to make every NEW speech-to-text connection fail. */
  const ctl = { failNew: false };
  const voice = new IcarusVoice({
    ...options,
    // These tests use plain 0..1 confidences. The real-scale defaults have their own tests below.
    config: { confidenceReference: { en: 1, th: 1 }, ...options.config },
    deps: {
      api,
      audio: { unlock: async () => undefined, output: () => output, mic },
      createStt: () => { const f = new FakeStt(); f.failConnect = ctl.failNew; stts.push(f); return f; },
      timers,
      speakFallback: null,
      ...options.deps,
    },
  });
  const log = {} as Log;
  for (const name of ['partialTranscript', 'finalTranscript', 'stateChange', 'speakingStart', 'speakingEnd', 'confirmIntent', 'countdown', 'assistantReply', 'command', 'bargeIn', 'transcriptIgnored', 'turnMetrics', 'usage', 'error'] as const) {
    (log as Record<string, unknown[]>)[name] = [];
    voice.on(name, ((p: unknown) => (log as Record<string, unknown[]>)[name]!.push(p)) as never);
  }
  const states = () => log.stateChange.map((c) => `${c.to}${c.confirmPhase ? `:${c.confirmPhase}` : ''}`);
  return { voice, timers, api, output, mic, stts, ctl, log, states, stt: () => stts[stts.length - 1]! };
}

/** Start hands-free and get to a ready state. */
async function ready(options: IcarusVoiceOptions = {}) {
  const s = setup(options);
  await s.voice.start();
  return s;
}

/**
 * The user says something, like a real mic would deliver it: a pause, speech, a partial
 * transcript, the endpointing silence, then the final. Waits for the assistant and the audio.
 */
async function userSays(s: ReturnType<typeof setup>, text: string, confidence: number | null = 0.95) {
  s.mic.feed(s.timers, 0.001, 600); // quiet first, so the last speech has ended
  s.mic.feed(s.timers, 0.2, 400); // talking
  s.stt().partial(text.split(' ').slice(0, 2).join(' '));
  s.mic.feed(s.timers, 0.001, 700); // endpointing silence
  s.stt().final(text, confidence);
  await flush();
}

describe('start and stop', () => {
  it('goes to listening and opens speech-to-text', async () => {
    const s = await ready();
    expect(s.voice.state).toBe('listening');
    expect(s.mic.started).toBe(true);
    expect(s.stt().isOpen).toBe(true);
    expect(s.api.tokenRequests).toEqual([{ language: 'en', mode: 'hands-free' }]);
  });

  it('streams mic audio to speech-to-text in hands-free mode', async () => {
    const s = await ready();
    s.mic.feed(s.timers, 0.01, 200);
    expect(s.stt().audioFrames).toBe(10);
  });

  it('stop turns everything off', async () => {
    const s = await ready();
    s.voice.stop();
    expect(s.voice.state).toBe('idle');
    expect(s.mic.started).toBe(false);
    expect(s.stt().closed).toBe(true);
  });

  it('reports a fatal error when the mic is blocked', async () => {
    const s = setup();
    s.mic.denied = true;
    await s.voice.start();
    expect(s.log.error[0]).toMatchObject({ code: 'mic_denied', fatal: true });
    expect(s.voice.state).toBe('idle');
  });

  it('reports a fatal error and stops when speech-to-text cannot connect', async () => {
    const s = setup({ deps: { createStt: () => { const f = new FakeStt(); f.failConnect = true; return f; } } });
    await s.voice.start();
    expect(s.log.error[0]).toMatchObject({ code: 'stt_unavailable', fatal: true });
    expect(s.voice.state).toBe('idle');
    expect(s.mic.started).toBe(false);
  });
});

describe('a normal turn', () => {
  it('listening -> thinking -> speaking -> listening, with every event', async () => {
    const s = await ready();
    s.voice.setSnapshot({ screen: 'asset.gold', visible: ['asset.chart'] });
    s.stt().partial('take me');
    await userSays(s, 'take me to gold');

    expect(s.log.partialTranscript.map((p) => p.text)).toContain('take me');
    expect(s.log.finalTranscript[0]).toMatchObject({ text: 'take me to gold', source: 'voice', language: 'en' });
    expect(s.api.asks[0]).toEqual({ text: 'take me to gold', language: 'en', snapshot: { screen: 'asset.gold', visible: ['asset.chart'] }, userId: 'demo-user' });
    expect(s.log.assistantReply[0]?.reply.ui_actions).toEqual([{ type: 'navigate', screen: 'asset.gold' }]);
    expect(s.api.ttsRequests[0]).toEqual({ text: 'Sure, taking you to gold.', language: 'en', speed: 1 });
    expect(s.log.speakingStart[0]).toEqual({ text: 'Sure, taking you to gold.', kind: 'reply' });

    s.output.last.finishNaturally();
    await flush();
    expect(s.log.speakingEnd).toEqual([{ reason: 'finished' }]);
    expect(s.states()).toEqual(['listening', 'thinking', 'speaking', 'listening']);
  });

  it('measures the turn and reports it', async () => {
    const s = await ready();
    s.mic.feed(s.timers, 0.2, 400);
    s.timers.advance(700); // endpointing wait
    s.stt().final('take me to gold');
    await flush();
    const m = s.log.turnMetrics[0]!;
    expect(m.sttFinalMs).toBeGreaterThanOrEqual(700);
    expect(m.assistantMs).toBe(120);
    expect(m.ttsFirstByteMs).toBe(90);
    expect(m.timeToFirstAudioMs).toBeGreaterThanOrEqual(700);
    expect(m.ttsCache).toBe('miss');
    expect(s.api.metrics).toHaveLength(1);
  });

  it('sends every final transcript to the friction log', async () => {
    const s = await ready();
    s.voice.setSnapshot({ screen: 'asset.gold' });
    await userSays(s, 'what does yield mean');
    expect(s.api.friction[0]).toMatchObject({ type: 'voice_final', text: 'what does yield mean', screen: 'asset.gold', source: 'voice', confidence: 0.95 });
  });

  it('stays silent when the assistant says not to speak', async () => {
    const s = await ready();
    s.api.askOverride = () => ({ text: 'Done.', speak: false, ui_actions: [], sources: [] });
    await userSays(s, 'do something');
    expect(s.api.ttsRequests).toHaveLength(0);
    expect(s.voice.state).toBe('listening');
  });

  it('latest question wins if the user speaks again while thinking', async () => {
    const s = await ready();
    s.api.askOverride = (text) => ({ text: `Answer to ${text}.`, speak: true, ui_actions: [], sources: [] });
    s.stt().final('first question please');
    s.stt().final('second question please');
    await flush();
    expect(s.log.assistantReply.map((r) => r.reply.text)).toEqual(['Answer to second question please.']);
  });
});

describe('noise filter', () => {
  it.each([
    ['uh', 0.9, 'too_short'],
    ['okay', 0.9, 'noise_word'],
    ['what is the fee', 0.2, 'low_confidence'],
  ])('ignores %s', async (text, confidence, reason) => {
    const s = await ready();
    await userSays(s, text, confidence);
    expect(s.log.transcriptIgnored[0]).toMatchObject({ text, reason });
    expect(s.api.asks).toHaveLength(0);
    expect(s.voice.state).toBe('listening');
  });

  it('accepts a transcript with unknown confidence', async () => {
    const s = await ready();
    await userSays(s, 'what is the fee', null);
    expect(s.api.asks).toHaveLength(1);
  });
});

describe('local voice commands', () => {
  it('"stop" silences Icarus and never calls the assistant', async () => {
    const s = await ready();
    await userSays(s, 'take me to gold');
    const asks = s.api.asks.length;
    s.stt().final('stop', 0.9);
    await flush();
    expect(s.output.last.stopped).toBe(true);
    expect(s.api.asks).toHaveLength(asks);
    expect(s.log.command[0]).toMatchObject({ name: 'stop' });
    expect(s.voice.state).toBe('listening');
  });

  it('"wait" while thinking cancels the answer', async () => {
    const s = await ready();
    s.api.askOverride = (t) => ({ text: 'Late answer.', speak: true, ui_actions: [], sources: [] });
    s.stt().final('what is the fee');
    s.stt().final('wait', 0.9); // arrives before the assistant answers
    await flush();
    expect(s.api.ttsRequests.map((r) => r.text)).not.toContain('Late answer.');
  });

  it('"repeat that" says the last line again without asking the assistant', async () => {
    const s = await ready();
    await userSays(s, 'take me to gold');
    s.output.last.finishNaturally();
    await flush();
    s.stt().final('repeat that', 0.9);
    await flush();
    expect(s.api.asks).toHaveLength(1);
    expect(s.api.ttsRequests.map((r) => r.text)).toEqual(['Sure, taking you to gold.', 'Sure, taking you to gold.']);
  });

  it('"repeat that" with nothing said yet says so', async () => {
    const s = await ready();
    s.stt().final('repeat that', 0.9);
    await flush();
    expect(s.api.ttsRequests[0]?.text).toBe("I haven't said anything yet.");
  });

  it('"go back" tells the UI to go back', async () => {
    const s = await ready();
    s.stt().final('go back', 0.9);
    await flush();
    expect(s.log.command).toEqual([{ name: 'back', text: 'go back' }]);
    expect(s.api.asks).toHaveLength(0);
  });

  it('"louder" raises the volume, "slower" slows later speech', async () => {
    const s = await ready();
    s.stt().final('louder', 0.9);
    await flush();
    expect(s.output.volume).toBe(1.4);
    s.stt().final('slower', 0.9);
    await flush();
    expect(s.api.ttsRequests.at(-1)?.speed).toBe(0.9);
    await userSays(s, 'take me to gold');
    expect(s.api.ttsRequests.at(-1)?.speed).toBe(0.9);
  });

  it('works in Thai', async () => {
    const s = await ready({ language: 'th' });
    s.stt().final('หยุดครับ', 0.9);
    await flush();
    expect(s.log.command[0]).toMatchObject({ name: 'stop' });
  });
});

describe('barge-in', () => {
  async function speaking(options: IcarusVoiceOptions = {}) {
    const s = await ready(options);
    await userSays(s, 'what is this red number');
    expect(s.voice.state).toBe('speaking');
    return s;
  }

  it('a partial transcript stops playback at once, and the time is counted from the first loud sound', async () => {
    const s = await speaking();
    s.mic.feed(s.timers, 0.001, 200); // quiet
    s.mic.feed(s.timers, 0.02, 40); // the user starts to talk (2 frames)
    s.mic.feed(s.timers, 0.5, 40); // louder (2 more frames): only 60 ms between the first and last frame
    s.stt().partial('wait I mean');
    // (the loudness check needs 120 ms of loud sound, so the transcript got there first)
    expect(s.log.bargeIn[0]).toMatchObject({ source: 'transcript' });
    expect(s.log.bargeIn[0]?.ms).toBe(60);
    expect(s.output.last.stopped).toBe(true);
    expect(s.log.speakingEnd.at(-1)).toEqual({ reason: 'interrupted' });
    expect(s.voice.state).toBe('listening');
  });

  it('loud mic stops playback within about 150 ms (hybrid mode)', async () => {
    const s = await speaking();
    s.mic.feed(s.timers, 0.001, 200); // background level
    s.mic.feed(s.timers, 0.5, 400);
    expect(s.output.last.stopped).toBe(true);
    const bargeIn = s.log.bargeIn[0]!;
    expect(bargeIn.source).toBe('energy');
    expect(bargeIn.ms).toBeLessThan(500);
    expect(bargeIn.ms).toBeLessThanOrEqual(160);
  });

  it('still barges in by loudness if the user was already mid-sentence when Icarus started', async () => {
    const s = await ready();
    s.mic.feed(s.timers, 0.2, 400); // still talking...
    s.stt().final('what is this red number', 0.95); // ...when the answer arrives and plays
    await flush();
    expect(s.voice.state).toBe('speaking');
    s.mic.feed(s.timers, 0.5, 300); // and they keep talking
    expect(s.output.last.stopped).toBe(true);
    expect(s.log.bargeIn[0]?.source).toBe('energy');
  });

  it('does not use mic loudness in transcript-only mode', async () => {
    const s = await speaking({ config: { bargeIn: { mode: 'transcript' } } });
    s.mic.feed(s.timers, 0.5, 400);
    expect(s.output.last.stopped).toBe(false);
    s.stt().partial('hold on');
    expect(s.output.last.stopped).toBe(true);
  });

  it("ignores Icarus's own voice coming back through the mic", async () => {
    const s = await speaking();
    s.stt().partial("That red number is today's change");
    expect(s.output.last.stopped).toBe(false);
    expect(s.log.bargeIn).toHaveLength(0);
  });

  it('a very short interruption like "stop" always works, even if Icarus is saying that word', async () => {
    const s = await speaking();
    s.stt().partial('stop');
    expect(s.output.last.stopped).toBe(true);
  });

  it('the final transcript after an interruption starts a normal new turn', async () => {
    const s = await speaking();
    s.stt().partial('take me');
    s.stt().final('take me to gold', 0.95);
    await flush();
    expect(s.api.asks.at(-1)?.text).toBe('take me to gold');
    expect(s.log.speakingEnd[0]).toEqual({ reason: 'interrupted' });
  });

  it('drops a final that is only an echo of what Icarus said', async () => {
    const s = await speaking();
    s.stt().final("Gold is down two point three percent since yesterday", 0.9);
    await flush();
    expect(s.log.transcriptIgnored[0]).toMatchObject({ reason: 'echo' });
    expect(s.api.asks).toHaveLength(1);
  });
});

describe('money confirmation, end to end', () => {
  /** Ask for a trade and let the read-back reach the speaker. */
  async function readbackPlaying(options: IcarusVoiceOptions = {}) {
    const s = await ready(options);
    await userSays(s, 'put 1,000 baht in gold');
    return s;
  }

  it('reads the preview back exactly and enters confirming/readback', async () => {
    const s = await readbackPlaying();
    expect(s.api.ttsRequests[0]?.text).toBe('one thousand baht into gold. Fee fifteen baht. Total one thousand fifteen baht. Say confirm or cancel.');
    expect(s.voice.state).toBe('confirming');
    expect(s.log.stateChange.at(-1)).toMatchObject({ to: 'confirming', confirmPhase: 'readback' });
    expect(s.log.speakingStart[0]).toMatchObject({ kind: 'readback' });
    // The UI still gets the card to render.
    expect(s.log.assistantReply[0]?.reply.ui_actions.some((a) => a.type === 'show_card')).toBe(true);
  });

  it('does NOT accept "confirm" while the read-back is still playing. It starts the read-back over', async () => {
    const s = await readbackPlaying();
    s.mic.feed(s.timers, 0.001, 100);
    s.stt().final('confirm', 0.99); // too early
    await flush();
    expect(s.log.countdown).toHaveLength(0);
    expect(s.log.confirmIntent).toHaveLength(0);
    expect(s.voice.state).toBe('confirming');
    expect(s.log.stateChange.at(-1)).toMatchObject({ confirmPhase: 'readback' });
    expect(s.api.asks).toHaveLength(1); // not sent to the assistant
    const readback = 'one thousand baht into gold. Fee fifteen baht. Total one thousand fifteen baht. Say confirm or cancel.';
    expect(s.api.ttsRequests.map((r) => r.text)).toEqual([readback, readback]); // read again from the start
    s.timers.advance(10_000);
    expect(s.log.confirmIntent).toHaveLength(0);
  });

  it('accepts "confirm" only after the read-back ends, then counts down and sends an intent', async () => {
    const s = await readbackPlaying();
    s.output.last.finishNaturally();
    await flush();
    expect(s.log.stateChange.at(-1)).toMatchObject({ to: 'confirming', confirmPhase: 'awaiting' });

    await userSays(s, 'confirm', 0.95);
    expect(s.log.stateChange.at(-1)).toMatchObject({ confirmPhase: 'countdown' });
    expect(s.log.countdown.map((c) => [c.phase, c.secondsLeft])).toEqual([['start', 3]]);
    expect(s.log.confirmIntent).toHaveLength(0);

    s.timers.advance(3000);
    expect(s.log.countdown.map((c) => [c.phase, c.secondsLeft])).toEqual([['start', 3], ['tick', 2], ['tick', 1], ['done', 0]]);
    expect(s.log.confirmIntent).toEqual([{ previewId: expect.stringMatching(/^mock-preview-/), source: 'voice', requiresTap: true }]);
    expect(s.voice.state).toBe('listening');
    expect(s.api.asks).toHaveLength(1); // "confirm" never went to the assistant
  });

  it('asks again when "confirm" is not clear enough', async () => {
    const s = await readbackPlaying();
    s.output.last.finishNaturally();
    await flush();
    await userSays(s, 'confirm', 0.6);
    expect(s.log.countdown).toHaveLength(0);
    expect(s.api.ttsRequests.at(-1)?.text).toBe("Sorry, I didn't catch that. Say confirm or cancel.");
    expect(s.voice.state).toBe('confirming');
  });

  it('cancel by voice before the countdown says so and drops the preview', async () => {
    const s = await readbackPlaying();
    s.output.last.finishNaturally();
    await flush();
    s.stt().final('cancel', 0.9);
    await flush();
    expect(s.log.countdown.at(-1)).toMatchObject({ phase: 'cancelled', cancelledBy: 'voice', wasCounting: false });
    expect(s.api.ttsRequests.at(-1)?.text).toBe('Okay, cancelled.');
    s.timers.advance(10_000);
    expect(s.log.confirmIntent).toHaveLength(0);
  });

  it('cancel by voice during the countdown stops the intent', async () => {
    const s = await readbackPlaying();
    s.output.last.finishNaturally();
    await flush();
    await userSays(s, 'confirm', 0.95);
    s.timers.advance(1500);
    s.stt().final('cancel', 0.9);
    await flush();
    expect(s.log.countdown.at(-1)).toMatchObject({ phase: 'cancelled', wasCounting: true });
    s.timers.advance(10_000);
    expect(s.log.confirmIntent).toHaveLength(0);
  });

  it('cancel by tap works during the countdown', async () => {
    const s = await readbackPlaying();
    s.output.last.finishNaturally();
    await flush();
    await userSays(s, 'confirm', 0.95);
    s.voice.cancelConfirm();
    expect(s.log.countdown.at(-1)).toMatchObject({ phase: 'cancelled', cancelledBy: 'tap' });
    s.timers.advance(10_000);
    expect(s.log.confirmIntent).toHaveLength(0);
  });

  it('barging in on the read-back stops it, and "confirm" still does nothing', async () => {
    const s = await readbackPlaying();
    s.stt().partial('wait');
    expect(s.output.last.stopped).toBe(true);
    await userSays(s, 'confirm', 0.99);
    expect(s.log.countdown).toHaveLength(0);
    s.timers.advance(60_000);
    expect(s.log.confirmIntent).toHaveLength(0);
  });

  it('"repeat that" reads the preview again and blocks confirm until it ends', async () => {
    const s = await readbackPlaying();
    s.output.last.finishNaturally();
    await flush();
    s.stt().final('repeat that', 0.9);
    await flush();
    expect(s.api.ttsRequests.at(-1)?.text).toBe('one thousand baht into gold. Fee fifteen baht. Total one thousand fifteen baht. Say confirm or cancel.');
    expect(s.log.stateChange.at(-1)).toMatchObject({ confirmPhase: 'readback' });
    // The second read-back finishes on its own, then confirm works.
    s.output.last.finishNaturally();
    await flush();
    expect(s.log.stateChange.at(-1)).toMatchObject({ confirmPhase: 'awaiting' });
    await userSays(s, 'confirm', 0.99);
    expect(s.log.countdown[0]).toMatchObject({ phase: 'start' });
  });

  it('another question ends the voice confirmation and is answered normally', async () => {
    const s = await readbackPlaying();
    s.output.last.finishNaturally();
    await flush();
    await userSays(s, 'what does the fee cover', 0.95);
    expect(s.api.asks.at(-1)?.text).toBe('what does the fee cover');
    await userSays(s, 'confirm', 0.99);
    expect(s.log.countdown).toHaveLength(0);
  });

  it('typed "confirm" can never start a countdown', async () => {
    const s = await readbackPlaying();
    s.output.last.finishNaturally();
    await flush();
    s.voice.sendText('confirm');
    await flush();
    expect(s.log.countdown).toHaveLength(0);
    expect(s.log.confirmIntent).toHaveLength(0);
  });

  it('simulated speech can only confirm when the test option is on', async () => {
    const off = await readbackPlaying();
    off.output.last.finishNaturally();
    await flush();
    off.voice.injectTranscript('confirm', 0.99);
    await flush();
    expect(off.log.countdown).toHaveLength(0);

    const on = await readbackPlaying({ acceptSimulatedConfirm: true });
    on.output.last.finishNaturally();
    await flush();
    on.timers.advance(100);
    on.voice.injectTranscript('confirm', 0.99);
    await flush();
    expect(on.log.countdown[0]).toMatchObject({ phase: 'start' });
  });

  it('if the read-back audio fails there is NO voice confirmation at all', async () => {
    const s = await ready();
    s.api.ttsFails = true;
    await userSays(s, 'put 1,000 baht in gold');
    expect(s.log.error.map((e) => e.code)).toEqual(expect.arrayContaining(['tts_failed', 'readback_failed']));
    await userSays(s, 'confirm', 0.99);
    expect(s.log.countdown).toHaveLength(0);
    s.timers.advance(60_000);
    expect(s.log.confirmIntent).toHaveLength(0);
    expect(s.voice.state).toBe('listening');
  });

  it('a read-back that dies halfway never unlocks confirm', async () => {
    const s = await readbackPlaying();
    s.output.last.stop(); // the audio system stops it, not a natural end
    await flush();
    await userSays(s, 'confirm', 0.99);
    expect(s.log.countdown).toHaveLength(0);
  });

  it('stop() cancels a pending confirmation', async () => {
    const s = await readbackPlaying();
    s.voice.stop();
    expect(s.log.countdown.at(-1)).toMatchObject({ phase: 'cancelled', cancelledBy: 'stopped' });
    expect(s.voice.state).toBe('idle');
  });

  it('confirmResolved() ends the voice side quietly (after a tap on the card)', async () => {
    const s = await readbackPlaying();
    s.output.last.finishNaturally();
    await flush();
    s.voice.confirmResolved();
    expect(s.voice.state).toBe('listening');
    expect(s.log.countdown).toHaveLength(0);
  });
});

describe('text and spoken lines from the UI', () => {
  it('typed text goes through the same pipeline and is spoken', async () => {
    const s = await ready();
    s.voice.sendText('take me to gold');
    await flush();
    expect(s.api.asks[0]?.text).toBe('take me to gold');
    expect(s.api.ttsRequests[0]?.text).toBe('Sure, taking you to gold.');
    expect(s.log.finalTranscript).toHaveLength(0); // the UI already has what was typed
  });

  it('works without the mic: typed text still gets an answer', async () => {
    const s = setup();
    s.voice.sendText('take me to gold');
    await flush();
    expect(s.api.asks).toHaveLength(1);
    expect(s.log.assistantReply).toHaveLength(1);
  });

  it('speak() says a line from the UI', async () => {
    const s = await ready();
    s.voice.speak('Confirmed. Your gold purchase is on its way.');
    await flush();
    expect(s.api.ttsRequests[0]?.text).toBe('Confirmed. Your gold purchase is on its way.');
    expect(s.log.speakingStart[0]).toMatchObject({ kind: 'line' });
  });
});

describe('push to talk', () => {
  it('streams only while the button is held, then commits', async () => {
    const s = setup({ mode: 'push-to-talk' });
    await s.voice.start();
    expect(s.voice.state).toBe('idle');
    await flush();
    s.mic.feed(s.timers, 0.01, 200); // not pressed: nothing is sent, only kept as a short pre-roll
    expect(s.stt().audioFrames).toBe(0);

    s.voice.pushToTalkStart();
    await flush();
    expect(s.voice.state).toBe('listening');
    s.mic.feed(s.timers, 0.3, 400);
    s.voice.pushToTalkEnd();
    expect(s.stt().commits).toBe(1);
    expect(s.stt().audioFrames).toBeGreaterThan(20);
    expect(s.voice.state).toBe('thinking');

    s.stt().final('take me to gold', 0.95);
    await flush();
    expect(s.api.asks).toHaveLength(1);
    expect(s.api.tokenRequests.every((t) => t.mode === 'push-to-talk')).toBe(true);
  });

  it('returns to idle if nothing was understood', async () => {
    const s = setup({ mode: 'push-to-talk' });
    await s.voice.start();
    await flush();
    s.voice.pushToTalkStart();
    await flush();
    s.voice.pushToTalkEnd();
    s.timers.advance(6000);
    expect(s.voice.state).toBe('idle');
  });

  it('pressing the button stops Icarus', async () => {
    const s = setup({ mode: 'push-to-talk' });
    await s.voice.start();
    await flush();
    s.voice.speak('A long line that Icarus is saying right now.');
    await flush();
    expect(s.voice.state).toBe('speaking');
    s.voice.pushToTalkStart();
    await flush();
    expect(s.output.last.stopped).toBe(true);
    expect(s.log.bargeIn[0]).toMatchObject({ source: 'push-to-talk' });
  });

  it('is ignored in hands-free mode', async () => {
    const s = await ready();
    s.voice.pushToTalkStart();
    expect(s.stt().commits).toBe(0);
  });
});

describe('switching language and mode', () => {
  it('reconnects with the new language', async () => {
    const s = await ready();
    s.voice.setLanguage('th');
    await flush();
    expect(s.stts).toHaveLength(2);
    expect(s.stts[0]!.closed).toBe(true);
    expect(s.api.tokenRequests.at(-1)).toEqual({ language: 'th', mode: 'hands-free' });
  });

  it('auto detects the language of each turn', async () => {
    const s = await ready({ language: 'auto' });
    await userSays(s, 'ตัวเลขสีแดงคืออะไร');
    expect(s.api.asks.at(-1)?.language).toBe('th');
    expect(s.api.ttsRequests.at(-1)?.language).toBe('th');
  });

  it('uses Scribe\'s detected language when it reports one', async () => {
    const s = await ready({ language: 'auto' });
    s.mic.feed(s.timers, 0.2, 400);
    s.stt().final('gold', 0.95, 'tha');
    await flush();
    expect(s.api.asks.at(-1)?.language).toBe('th');
  });

  it('reconnects when the mode changes', async () => {
    const s = await ready();
    s.voice.setMode('push-to-talk');
    await flush();
    expect(s.stts[0]!.closed).toBe(true);
    expect(s.voice.state).toBe('idle');
    s.voice.setMode('hands-free');
    await flush();
    expect(s.voice.state).toBe('listening');
    expect(s.api.tokenRequests.at(-1)).toEqual({ language: 'en', mode: 'hands-free' });
  });
});

describe('connection trouble and credits', () => {
  it('reconnects when the speech-to-text socket drops', async () => {
    const s = await ready();
    s.stt().drop();
    s.timers.advance(600);
    await flush();
    expect(s.stts).toHaveLength(2);
    expect(s.stt().isOpen).toBe(true);
    expect(s.voice.state).toBe('listening');
  });

  it('gives up after three failed reconnects, with a fatal error', async () => {
    const s = await ready();
    s.ctl.failNew = true; // the network is gone: every new connection fails
    s.stt().drop();
    s.timers.advance(500); // attempt 1
    await flush();
    s.timers.advance(1000); // attempt 2
    await flush();
    s.timers.advance(2000); // attempt 3
    await flush();
    expect(s.stts).toHaveLength(4); // the original plus three tries
    expect(s.log.error.at(-1)).toMatchObject({ code: 'stt_disconnected', fatal: true });
    expect(s.voice.state).toBe('idle');
    expect(s.mic.started).toBe(false);
  });

  it('turns the mic off after a long quiet time to save credits', async () => {
    const s = await ready({ config: { idleStopAfterSec: 30 } });
    s.mic.feed(s.timers, 0.001, 36_000); // quiet for a long time (the mic keeps sending frames)
    expect(s.log.error.find((e) => e.code === 'idle_timeout')).toBeTruthy();
    expect(s.voice.state).toBe('idle');
    expect(s.mic.started).toBe(false);
  });

  it('does not turn the mic off while someone is talking', async () => {
    const s = await ready({ config: { idleStopAfterSec: 30 } });
    for (let i = 0; i < 6; i++) {
      s.mic.feed(s.timers, 0.3, 400);
      s.mic.feed(s.timers, 0.001, 9000);
    }
    expect(s.voice.state).toBe('listening');
  });

  it('counts STT seconds and TTS characters', async () => {
    const s = await ready();
    s.mic.feed(s.timers, 0.01, 1000);
    await userSays(s, 'take me to gold');
    expect(s.voice.usageTotals.sttSeconds).toBeGreaterThan(1);
    expect(s.voice.usageTotals.ttsCharacters).toBe('Sure, taking you to gold.'.length);
    s.timers.advance(10_000);
    expect(s.api.usageReports.length).toBeGreaterThan(0);
    s.voice.stop();
    expect(s.api.usageReports.at(-1)).toBeGreaterThan(1);
  });
});

describe('assistant and voice failures', () => {
  it('survives an assistant error and keeps listening', async () => {
    const s = await ready();
    s.api.askOverride = () => { throw new Error('assistant down'); };
    await userSays(s, 'what is the fee');
    expect(s.log.error[0]).toMatchObject({ fatal: false });
    expect(s.voice.state).toBe('listening');
  });

  it('shows the reply even if the voice fails, and keeps listening', async () => {
    const s = await ready();
    s.api.ttsFails = true;
    await userSays(s, 'take me to gold');
    expect(s.log.assistantReply).toHaveLength(1);
    expect(s.log.error[0]).toMatchObject({ code: 'tts_failed', fatal: false });
    expect(s.voice.state).toBe('listening');
  });

  it('uses the browser voice as a fallback when it exists', async () => {
    const spoken: string[] = [];
    const s = await ready({
      deps: {
        speakFallback: (text, _lang, _v, _r, onStart) => {
          spoken.push(text);
          queueMicrotask(onStart);
          let settle!: (r: 'finished' | 'stopped') => void;
          const finished = new Promise<'finished' | 'stopped'>((r) => { settle = r; });
          setTimeout(() => settle('finished'), 5);
          return { finished, push: () => undefined, end: () => undefined, stop: () => settle('stopped') };
        },
      },
    });
    s.api.ttsFails = true;
    await userSays(s, 'take me to gold');
    await new Promise((r) => setTimeout(r, 30));
    expect(spoken).toEqual(['Sure, taking you to gold.']);
    expect(s.voice.state).toBe('listening');
  });

  it('a fatal speech-to-text error (quota) stops everything', async () => {
    const s = await ready();
    s.stt().fire('error', { code: 'quota_exceeded', message: 'out of credits' });
    expect(s.log.error[0]).toMatchObject({ code: 'quota_exceeded', fatal: true });
    expect(s.voice.state).toBe('idle');
  });
});

describe('state machine guard', () => {
  it('only ever uses the five states', async () => {
    const s = await ready();
    await userSays(s, 'put 1,000 baht in gold');
    s.output.last.finishNaturally();
    await flush();
    await userSays(s, 'confirm', 0.95);
    s.timers.advance(3000);
    const seen = new Set(s.log.stateChange.flatMap((c) => [c.from, c.to]));
    for (const state of seen) expect(['idle', 'listening', 'thinking', 'speaking', 'confirming']).toContain(state);
    expect(s.states()).toEqual(['listening', 'thinking', 'confirming:readback', 'confirming:awaiting', 'confirming:countdown', 'listening']);
  });
});

describe('speak() keeps numbers exact', () => {
  it('does not round a line the UI passes in (and says the numbers as words)', async () => {
    const s = await ready();
    s.voice.speak('1,000 baht into gold. Fee 15 baht. Total 1,015 baht. Say confirm or cancel.');
    await flush();
    // Digits in, words out, and exact: no "about", nothing rounded.
    expect(s.api.ttsRequests[0]?.text).toBe('one thousand baht into gold. Fee fifteen baht. Total one thousand fifteen baht. Say confirm or cancel.');
  });
  it('still cleans markdown and symbols', async () => {
    const s = await ready();
    s.voice.speak('**Done**: gold is -2.3% today');
    await flush();
    expect(s.api.ttsRequests[0]?.text).toBe('Done: gold is down two point three percent today.');
  });
});

describe('blocked audio', () => {
  it('says so once when the browser keeps audio suspended, instead of failing silently', async () => {
    const s = setup({ deps: { audio: { unlock: async () => 'suspended' as const, output: () => new FakeOutput(), mic: new FakeMic() } } });
    await s.voice.start();
    s.voice.sendText('take me to gold');
    await flush();
    s.voice.sendText('take me to gold');
    await flush();
    const blocked = s.log.error.filter((e) => e.code === 'audio_blocked');
    expect(blocked).toHaveLength(1); // once, not on every line
    expect(blocked[0]).toMatchObject({ fatal: false });
    expect(blocked[0]?.message).toMatch(/blocking sound/i);
  });

  it('stays quiet when audio is running', async () => {
    const s = setup({ deps: { audio: { unlock: async () => 'running' as const, output: () => new FakeOutput(), mic: new FakeMic() } } });
    await s.voice.start();
    s.voice.sendText('take me to gold');
    await flush();
    expect(s.log.error.filter((e) => e.code === 'audio_blocked')).toHaveLength(0);
  });
});

describe('confidence scale (measured on the live Scribe)', () => {
  // Scribe's raw score for CLEAN speech is low: about 0.49 (English) and 0.36 (Thai).
  // With the default reference values those must count as clean, and noise must not.
  const real = (extra: IcarusVoiceOptions = {}) => ready({ ...extra, config: { confidenceReference: { en: 0.47, th: 0.35 }, ...extra.config } });

  it('a clean English utterance (raw 0.49) is accepted at about 1.0', async () => {
    const s = await real();
    await userSays(s, 'what is the fee', 0.49);
    expect(s.log.finalTranscript[0]?.confidence).toBe(1);
    expect(s.log.finalTranscript[0]?.rawConfidence).toBe(0.49);
    expect(s.api.asks).toHaveLength(1);
  });

  it('a clean Thai utterance (raw 0.36) is accepted too', async () => {
    const s = await real({ language: 'th' });
    await userSays(s, 'ทองคืออะไร', 0.36);
    expect(s.log.finalTranscript[0]?.confidence).toBe(1);
    expect(s.api.asks).toHaveLength(1);
  });

  it('heavy noise (raw 0.18) is dropped as low confidence', async () => {
    const s = await real();
    await userSays(s, 'what is the fee', 0.18);
    expect(s.log.transcriptIgnored[0]).toMatchObject({ reason: 'low_confidence' });
    expect(s.api.asks).toHaveLength(0);
  });

  it('a clean "confirm" starts the countdown, a noisy one (5 dB, raw 0.35) does not', async () => {
    const clean = await real();
    await userSays(clean, 'put 1,000 baht in gold', 0.49);
    clean.output.last.finishNaturally();
    await flush();
    await userSays(clean, 'confirm', 0.49);
    expect(clean.log.countdown[0]).toMatchObject({ phase: 'start' });

    const noisy = await real();
    await userSays(noisy, 'put 1,000 baht in gold', 0.49);
    noisy.output.last.finishNaturally();
    await flush();
    await userSays(noisy, 'confirm', 0.35);
    expect(noisy.log.countdown).toHaveLength(0);
    expect(noisy.api.ttsRequests.at(-1)?.text).toBe("Sorry, I didn't catch that. Say confirm or cancel.");
  });

  it('unknown confidence still fails the confirm', async () => {
    const s = await real();
    await userSays(s, 'put 1,000 baht in gold', 0.49);
    s.output.last.finishNaturally();
    await flush();
    await userSays(s, 'confirm', null);
    expect(s.log.countdown).toHaveLength(0);
  });
});

describe('speak() returns a promise (for hooks like Icarus.setTTS in the prototype)', () => {
  it('resolves "finished" when the line ends by itself', async () => {
    const s = await ready();
    const done = s.voice.speak('Confirmed. Your gold purchase is on its way.');
    await flush();
    s.output.last.finishNaturally();
    await expect(done).resolves.toBe('finished');
  });

  it('resolves "interrupted" when the user talks over it', async () => {
    const s = await ready();
    const done = s.voice.speak('A fairly long line that Icarus is saying right now.');
    await flush();
    s.stt().partial('hold on a second');
    await expect(done).resolves.toBe('interrupted');
  });

  it('stopSpeaking() resolves "stopped" and silences the line', async () => {
    const s = await ready();
    const done = s.voice.speak('A fairly long line that Icarus is saying right now.');
    await flush();
    s.voice.stopSpeaking();
    await expect(done).resolves.toBe('stopped');
    expect(s.output.last.stopped).toBe(true);
    expect(s.voice.state).toBe('listening');
  });

  it('resolves "error" when there is no sound at all, instead of hanging', async () => {
    const s = await ready();
    s.api.ttsFails = true;
    await expect(s.voice.speak('This will fail.')).resolves.toBe('error');
  });

  it('a newer line replaces the older one, and the older one resolves "stopped"', async () => {
    const s = await ready();
    const first = s.voice.speak('The first line is long enough to still be playing.');
    await flush();
    void s.voice.speak('The second line.');
    await expect(first).resolves.toBe('stopped');
  });

  it('resolves at once for empty text', async () => {
    const s = await ready();
    await expect(s.voice.speak('   ')).resolves.toBe('stopped');
  });
});


describe("assistant: 'external' (voice in and out only, the host does the thinking)", () => {
  it('emits the transcript but never calls our assistant or speaks by itself', async () => {
    const s = await ready({ assistant: 'external' });
    s.stt().partial('take me');
    await userSays(s, 'take me to gold');
    expect(s.log.finalTranscript[0]).toMatchObject({ text: 'take me to gold', source: 'voice' });
    expect(s.api.asks).toHaveLength(0);
    expect(s.api.ttsRequests).toHaveLength(0);
    expect(s.voice.state).toBe('listening');
    expect(s.api.friction).toHaveLength(1); // the friction log still gets every transcript
  });

  it('the host can answer with speak(), and barge-in still works', async () => {
    const s = await ready({ assistant: 'external' });
    await userSays(s, 'take me to gold');
    const done = s.voice.speak('Sure, taking you to gold.');
    await flush();
    expect(s.voice.state).toBe('speaking');
    s.stt().partial('actually wait');
    await expect(done).resolves.toBe('interrupted');
    expect(s.voice.state).toBe('listening');
  });

  it('local commands still run, and never reach the host assistant', async () => {
    const s = await ready({ assistant: 'external' });
    const done = s.voice.speak('A fairly long line that is being said right now.');
    await flush();
    s.stt().final('stop', 0.9);
    await expect(done).resolves.toBe('interrupted');
    expect(s.log.command.map((c) => c.name)).toContain('stop');
  });

  it('push to talk returns to idle after the transcript', async () => {
    const s = setup({ mode: 'push-to-talk', assistant: 'external' });
    await s.voice.start();
    await flush();
    s.voice.pushToTalkStart();
    await flush();
    s.mic.feed(s.timers, 0.3, 400);
    s.voice.pushToTalkEnd();
    s.stt().final('take me to gold', 0.95);
    await flush();
    expect(s.log.finalTranscript).toHaveLength(1);
    expect(s.voice.state).toBe('idle');
  });
});
