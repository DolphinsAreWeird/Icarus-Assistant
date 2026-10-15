// Start the voice server:  npm run dev   (or  FAKE_ELEVENLABS=1 npm run dev  for no API key)

import { createAssistant } from './assistant';
import { createElevenLabsPort, type ElevenLabsPort } from './elevenlabs';
import { loadConfig } from './env';
import { createFakeElevenLabsPort } from './fake-elevenlabs';
import { attachFakeStt } from './fake-stt';
import { createFrictionLogger } from './friction';
import { createApp } from './app';
import { TtsCache } from './tts-cache';
import { TtsService } from './tts';
import { UsageTracker } from './usage';
import { createUtopia } from './utopia';
import { startVoiceWarmup } from './warmup';

const cfg = loadConfig();

let port: ElevenLabsPort | null = null;
if (cfg.fakeElevenLabs) {
  port = createFakeElevenLabsPort();
} else if (cfg.apiKey) {
  port = createElevenLabsPort(cfg);
}

const usage = new UsageTracker();
const utopia = createUtopia(cfg);
const cache = new TtsCache([cfg.cacheDir, cfg.demoAudioDir], cfg.cacheDir);
const tts = new TtsService(cfg, port, cache, usage);
const app = createApp({
  cfg,
  assistant: createAssistant(cfg, utopia),
  utopia,
  tts,
  port,
  usage,
  friction: createFrictionLogger(cfg.logDir),
});

const server = app.listen(cfg.port, () => {
  const line = (label: string, value: string) => console.log(`  ${label.padEnd(12)} ${value}`);
  console.log('\nIcarus voice server');
  line('Test page', `http://localhost:${cfg.port}`);
  line('Assistant', cfg.assistantMode === 'mock' ? 'MOCK (canned replies)' : `HTTP ${cfg.assistantUrl}`);
  line('U-topia Q&A', cfg.utopiaMode === 'mock' ? 'MOCK glossary (U-Bot has no API yet), handoffs to ' + cfg.ubotUrl : `HTTP ${cfg.utopiaUrl}`);
  line('API key', cfg.fakeElevenLabs ? 'not needed (FAKE_ELEVENLABS=1: tones instead of speech, scripted fake transcripts)' : cfg.apiKey ? 'set (hidden)' : 'MISSING: add ELEVENLABS_API_KEY to .env');
  line('Voices', `EN ${cfg.voiceIdEn ? 'set' : 'MISSING (VOICE_ID_EN)'} | TH ${cfg.voiceIdTh ? 'set' : 'MISSING (VOICE_ID_TH)'}`);
  line('TTS models', `EN ${cfg.ttsModelsEn.join(' > ')} | TH ${cfg.ttsModelsTh.join(' > ')}`);
  line('STT', `scribe_v2_realtime, ${cfg.stt.commitStrategy}, silence ${cfg.stt.vadSilenceSecs}s`);
  if (cfg.stt.droppedKeyterms.length) console.log(`  Dropped keyterms (too long or too many): ${cfg.stt.droppedKeyterms.join(', ')}`);
  console.log('');
  // The first time a library voice speaks it is slow. Do that now, not during the first real reply.
  if (port && !cfg.fakeElevenLabs) startVoiceWarmup(port, cfg, usage);
});

// In fake mode, also serve a pretend Scribe socket so the mic path can be rehearsed with no credits.
if (cfg.fakeElevenLabs) attachFakeStt(server);
