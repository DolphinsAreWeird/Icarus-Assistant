// FAKE Scribe Realtime socket, for FAKE_ELEVENLABS=1 and for tests.
// Speaks the same JSON messages as the real API (session_started, partial_transcript,
// committed_transcript, committed_transcript_with_timestamps) but does no real recognition:
// when it hears loud audio followed by silence, it "hears" the NEXT PHRASE in a script.
// So you can rehearse the whole flow (explain, navigate, trade, confirm) with no credits.

import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

export const FAKE_SCRIPT_EN = [
  "what's this red number",
  'take me to gold',
  'put 1,000 baht in gold',
  'confirm',
  'what should I buy',
];
export const FAKE_SCRIPT_TH = ['ตัวเลขสีแดงคืออะไร', 'พาไปที่ทอง', 'ซื้อทอง 1,000 บาท', 'ยืนยัน', 'ควรซื้ออะไรดี'];

export interface FakeSttOptions {
  /** Loudness (0 to 1) that counts as speech. */
  speechRms?: number;
  /** Fixed per-word log probability reported in the timestamped message. -0.05 is about 95% confidence. */
  logprob?: number;
  scriptEn?: string[];
  scriptTh?: string[];
}

export function attachFakeStt(server: Server, opts: FakeSttOptions = {}): WebSocketServer {
  const speechRms = opts.speechRms ?? 0.02;
  const logprob = opts.logprob ?? -0.05;
  const scripts = { en: opts.scriptEn ?? FAKE_SCRIPT_EN, th: opts.scriptTh ?? FAKE_SCRIPT_TH };
  const cursor = { en: 0, th: 0 };

  const wss = new WebSocketServer({ server, path: '/v1/speech-to-text/realtime' });
  wss.on('connection', (ws: WebSocket, req) => {
    const q = new URL(req.url ?? '', 'http://x').searchParams;
    const lang = q.get('language_code') === 'th' ? 'th' : 'en';
    const manual = q.get('commit_strategy') === 'manual';
    const silenceNeeded = Number(q.get('vad_silence_threshold_secs') ?? 0.7);

    let speech = false; // heard speech since the last commit
    let silence = 0; // seconds of quiet after speech
    let phrase = '';
    let lastPartialAt = 0;
    let elapsed = 0;
    const send = (obj: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));

    const nextPhrase = () => {
      const list = scripts[lang];
      const text = list[cursor[lang] % list.length] ?? '';
      return text;
    };
    const commit = () => {
      if (!speech) return;
      const text = phrase || nextPhrase();
      cursor[lang] += 1;
      send({ message_type: 'committed_transcript', text });
      const words = text.split(' ').flatMap((w, i, all) => [
        { text: w, type: 'word', logprob, start: 0, end: 0 },
        ...(i < all.length - 1 ? [{ text: ' ', type: 'spacing' }] : []),
      ]);
      send({ message_type: 'committed_transcript_with_timestamps', text, language_code: lang === 'th' ? 'tha' : 'eng', words });
      speech = false;
      silence = 0;
      phrase = '';
    };

    send({ message_type: 'session_started', session_id: `fake-${Date.now()}`, config: { commit_strategy: manual ? 'manual' : 'vad' } });

    ws.on('message', (data) => {
      let msg: { message_type?: string; audio_base_64?: string; commit?: boolean };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.message_type !== 'input_audio_chunk') return;

      const bytes = Buffer.from(msg.audio_base_64 ?? '', 'base64');
      const samples = Math.floor(bytes.length / 2);
      if (samples > 0) {
        let sum = 0;
        for (let i = 0; i < samples; i++) {
          const v = bytes.readInt16LE(i * 2) / 32768;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / samples);
        const seconds = samples / 16000;
        elapsed += seconds;
        if (rms > speechRms) {
          if (!speech) phrase = nextPhrase();
          speech = true;
          silence = 0;
          // A growing partial, like the real thing.
          if (elapsed - lastPartialAt >= 0.2) {
            lastPartialAt = elapsed;
            const words = phrase.split(' ');
            const shown = Math.max(1, Math.min(words.length, Math.ceil(words.length * Math.min(1, elapsed % 1 + 0.4))));
            send({ message_type: 'partial_transcript', text: words.slice(0, shown).join(' ') });
          }
        } else if (speech) {
          silence += seconds;
          if (!manual && silence >= silenceNeeded) commit();
        }
      }
      if (msg.commit) commit();
    });
  });
  return wss;
}
