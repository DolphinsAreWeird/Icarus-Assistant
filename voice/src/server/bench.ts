// Measures the speed of the voice pipeline with NO microphone: used by `npm run bench`.
//
//   1. makes a spoken sentence with TTS (this is "the user")
//   2. streams it to Scribe in real time, then silence, like a live mic would
//   3. measures how long after the user stops Scribe returns the final transcript
//   4. asks the assistant, then measures how long TTS takes to send the first audio
//
// time to first audio (server side) = final transcript delay + assistant + TTS first byte.
// The browser adds a small amount on top (about 40 ms start lead plus the audio device).

import { MockAssistant } from './assistant/mock';
import type { ElevenLabsPort } from './elevenlabs';
import type { ServerConfig } from './env';
import { planSpeech } from './speech-plan';
import { buildSttUrl, parseSttMessage, STT_SAMPLE_RATE } from '../shared/stt-protocol';
import { confidenceFromWords } from '../shared/transcript';
import type { Lang } from '../shared/types';

export interface BenchRun {
  lang: Lang;
  text: string;
  tokenMs: number;
  connectMs: number;
  firstPartialMs: number | null;
  /** From the last speech sample sent to the final transcript. */
  sttFinalMs: number | null;
  transcript: string | null;
  confidence: number | null;
  assistantMs: number;
  /** null when TTS was unavailable (for example a blocked account). */
  ttsFirstByteMs: number | null;
  ttsError: string | null;
  ttsModel: string;
  totalToFirstAudioMs: number | null;
}

export interface BenchOptions {
  cfg: ServerConfig;
  port: ElevenLabsPort;
  langs: Lang[];
  runs: number;
  /** What the pretend user says. */
  utterances?: Record<Lang, string>;
  /** Pre-made 16 kHz mono 16-bit PCM of the user's sentence. Skips the TTS step for the user's voice. */
  utteranceAudio?: Partial<Record<Lang, Buffer>>;
  /** Silence sent before speech, to look like a mic that has been open for a while. Scribe starts after about 2 s of audio. */
  preRollSec?: number;
  log?: (line: string) => void;
  /** Replace the WebSocket (tests). */
  createSocket?: (url: string) => WebSocket;
}

const DEFAULT_UTTERANCES: Record<Lang, string> = {
  en: 'Take me to gold.',
  th: 'พาไปที่ทอง',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/** Synthesise the user's sentence at 16 kHz, which is what Scribe wants. */
async function makeUtterance(port: ElevenLabsPort, cfg: ServerConfig, lang: Lang, text: string): Promise<Buffer> {
  const voiceId = lang === 'th' ? cfg.voiceIdTh : cfg.voiceIdEn;
  const modelId = (lang === 'th' ? cfg.ttsModelsTh : cfg.ttsModelsEn)[0];
  if (!voiceId || !modelId) throw new Error(`No voice or model for ${lang}`);
  return collect(await port.streamSpeech({ voiceId, text, modelId, outputFormat: 'pcm_16000', ...(lang === 'th' ? { languageCode: 'th' } : {}) }));
}

function frame(pcm: Uint8Array, commit = false): string {
  return JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.from(pcm).toString('base64'), commit, sample_rate: STT_SAMPLE_RATE });
}

export async function runBench(opts: BenchOptions): Promise<BenchRun[]> {
  const { cfg, port } = opts;
  const log = opts.log ?? ((l: string) => console.log(l));
  const utterances = opts.utterances ?? DEFAULT_UTTERANCES;
  const preRoll = opts.preRollSec ?? 2.5;
  const assistant = new MockAssistant(cfg.mockDelayMs);
  const results: BenchRun[] = [];

  for (const lang of opts.langs) {
    const text = utterances[lang];
    const premade = opts.utteranceAudio?.[lang];
    log(`\n[${lang}] pretend user says: "${text}" (${premade ? 'audio supplied' : 'made with TTS'})`);
    const speech = premade ?? (await makeUtterance(port, cfg, lang, text));

    for (let run = 1; run <= opts.runs; run++) {
      // ---- token and socket ----
      const t0 = performance.now();
      const token = await port.createRealtimeToken();
      const tokenMs = Math.round(performance.now() - t0);
      const url = buildSttUrl({
        baseUrl: cfg.sttWsBaseUrl,
        token,
        languageCode: lang,
        commitStrategy: cfg.stt.commitStrategy,
        vadSilenceSecs: cfg.stt.vadSilenceSecs,
        vadThreshold: cfg.stt.vadThreshold,
        minSpeechMs: cfg.stt.minSpeechMs,
        minSilenceMs: cfg.stt.minSilenceMs,
        keyterms: cfg.stt.keyterms,
        noVerbatim: cfg.stt.noVerbatim,
        detectLanguage: false,
      });

      const t1 = performance.now();
      const ws = opts.createSocket ? opts.createSocket(url) : new WebSocket(url);
      // Assigned inside the socket callback below, so declare the full types up front.
      let speechEndAt = null as number | null;
      let firstPartialAt = null as number | null;
      let finalAt = null as number | null;
      let transcript = null as string | null;
      let confidence = null as number | null;
      let plainFinalAt = null as number | null;
      let plainText = null as string | null;

      const opened = new Promise<void>((resolve, reject) => {
        ws.onmessage = (ev) => {
          const msg = parseSttMessage(String(ev.data));
          if (!msg) return;
          const now = performance.now();
          if (msg.kind === 'session_started') resolve();
          else if (msg.kind === 'error') reject(new Error(`${msg.code}: ${msg.message}`));
          else if (msg.kind === 'partial' && msg.text.trim() && speechEndAt !== null && firstPartialAt === null) firstPartialAt = now;
          else if (msg.kind === 'partial' && msg.text.trim() && firstPartialAt === null) firstPartialAt = now;
          else if (msg.kind === 'committed' && msg.text.trim() && plainFinalAt === null) { plainFinalAt = now; plainText = msg.text; }
          else if (msg.kind === 'committed_with_timestamps' && msg.text.trim() && finalAt === null) {
            finalAt = now;
            transcript = msg.text;
            confidence = confidenceFromWords(msg.words);
          }
        };
        ws.onerror = () => reject(new Error('socket error'));
        setTimeout(() => reject(new Error('Scribe did not start within 10 s')), 10_000);
      });
      await opened;
      const connectMs = Math.round(performance.now() - t1);

      // ---- stream like a live mic: 100 ms chunks, in real time ----
      // A real mic cannot hand over audio before it has been captured, so each chunk is sent at
      // the END of its 100 ms slot. (Sending at the start would make every number about 100 ms too good.)
      const chunkBytes = (STT_SAMPLE_RATE / 10) * 2;
      const silence = Buffer.alloc(chunkBytes);
      const start = performance.now();
      let slots = 0;
      const nextSlot = async () => {
        slots += 1;
        const wait = start + slots * 100 - performance.now();
        if (wait > 0) await sleep(wait);
      };
      for (let i = 0; i < Math.round(preRoll * 10); i++) { await nextSlot(); ws.send(frame(silence)); }
      const speechChunks = Math.ceil(speech.length / chunkBytes);
      for (let i = 0; i < speechChunks; i++) {
        const chunk = speech.subarray(i * chunkBytes, (i + 1) * chunkBytes);
        await nextSlot();
        ws.send(frame(chunk.length === chunkBytes ? chunk : Buffer.concat([chunk, Buffer.alloc(chunkBytes - chunk.length)])));
      }
      speechEndAt = performance.now(); // the last speech chunk has just arrived
      const firstSpeechAt = speechEndAt - speechChunks * 100;
      // keep sending silence until the final arrives (or 4 s pass)
      for (let i = 0; i < 40 && finalAt === null && plainFinalAt === null; i++) { await nextSlot(); ws.send(frame(silence)); }
      // wait a moment for the timestamped version after a plain commit
      if (finalAt === null && plainFinalAt !== null) await sleep(600);
      ws.close();

      const effectiveFinalAt = finalAt ?? plainFinalAt;
      const sttFinalMs = effectiveFinalAt === null ? null : Math.round(effectiveFinalAt - speechEndAt);
      const heard: string | null = transcript ?? plainText;

      // ---- assistant ----
      const a0 = performance.now();
      const reply = await assistant.ask({ text: heard ?? text, language: lang, userId: 'bench' });
      const assistantMs = Math.round(performance.now() - a0);
      const plan = planSpeech(reply, lang, heard ?? text);

      // ---- TTS first byte for the reply (no cache). A failure here must not hide the STT numbers ----
      const speechText = plan.speech?.text ?? reply.text;
      const speechLang = plan.speech?.language ?? lang;
      const voiceId = speechLang === 'th' ? cfg.voiceIdTh : cfg.voiceIdEn;
      const model = (speechLang === 'th' ? cfg.ttsModelsTh : cfg.ttsModelsEn)[0] ?? '';
      let ttsFirstByteMs: number | null = null;
      let ttsError: string | null = null;
      try {
        if (!voiceId) throw new Error(`no voice set for ${speechLang}`);
        const s0 = performance.now();
        const body = await port.streamSpeech({ voiceId, text: speechText, modelId: model, outputFormat: cfg.ttsOutputFormat, ...(speechLang === 'th' ? { languageCode: 'th' } : {}) });
        const reader = body.getReader();
        await reader.read();
        ttsFirstByteMs = Math.round(performance.now() - s0);
        await reader.cancel();
      } catch (err) {
        ttsError = (err as Error).message.split('\n')[0]?.slice(0, 160) ?? 'failed';
      }

      const totalToFirstAudioMs = sttFinalMs !== null && ttsFirstByteMs !== null ? sttFinalMs + assistantMs + ttsFirstByteMs : null;
      const result: BenchRun = {
        lang, text, tokenMs, connectMs,
        firstPartialMs: firstPartialAt === null ? null : Math.round(firstPartialAt - firstSpeechAt),
        sttFinalMs, transcript: heard, confidence, assistantMs, ttsFirstByteMs, ttsError, ttsModel: model, totalToFirstAudioMs,
      };
      results.push(result);
      log(`[${lang}] run ${run}: heard "${heard ?? '(nothing)'}" | first partial ${result.firstPartialMs ?? 'n/a'} ms | stt-final ${sttFinalMs ?? 'n/a'} ms | assistant ${assistantMs} ms | tts-first-byte ${ttsFirstByteMs === null ? `n/a (${ttsError})` : `${ttsFirstByteMs} ms (${model})`} | total ${totalToFirstAudioMs ?? 'n/a'} ms | confidence ${confidence === null ? 'n/a' : confidence.toFixed(3)}`);
    }
  }
  return results;
}

export function summarize(runs: BenchRun[]): string {
  const lines: string[] = [];
  const med = (xs: number[]) => (xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]);
  for (const lang of ['en', 'th'] as const) {
    const rs = runs.filter((r) => r.lang === lang);
    if (rs.length === 0) continue;
    const totals = rs.map((r) => r.totalToFirstAudioMs).filter((x): x is number => x !== null);
    const stt = rs.map((r) => r.sttFinalMs).filter((x): x is number => x !== null);
    const partial = rs.map((r) => r.firstPartialMs).filter((x): x is number => x !== null);
    const tts = rs.map((r) => r.ttsFirstByteMs).filter((x): x is number => x !== null);
    const conf = rs.map((r) => r.confidence).filter((x): x is number => x !== null);
    const head = `${lang.toUpperCase()}: ${rs.length} run(s). stt-final median ${med(stt) ?? 'n/a'} ms (min ${stt.length ? Math.min(...stt) : 'n/a'}, max ${stt.length ? Math.max(...stt) : 'n/a'}), first partial median ${med(partial) ?? 'n/a'} ms`;
    const confText = conf.length ? `, confidence ${Math.min(...conf).toFixed(3)} to ${Math.max(...conf).toFixed(3)}` : '';
    if (totals.length === 0) {
      lines.push(`${head}${confText}. TTS was unavailable, so there is no time to first audio. ${rs.find((r) => r.ttsError)?.ttsError ?? ''}`.trim());
    } else {
      lines.push(`${head}, tts-first-byte median ${med(tts) ?? 'n/a'} ms${confText}. Median to first audio ${med(totals)} ms (min ${Math.min(...totals)}, max ${Math.max(...totals)}). Target 1500 ms: ${(med(totals) ?? Infinity) <= 1500 ? 'MET' : 'NOT MET'}.`);
    }
  }
  return lines.join('\n');
}
