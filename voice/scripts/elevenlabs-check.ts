// Check the ElevenLabs setup against the LIVE API:   npm run check
//   npm run check -- --speak     also makes one short test line per language (uses a few credits)
//
// It answers: does the key work? Do the models we picked exist and support Thai? Are the voice
// IDs real? Can the server mint a short-lived Scribe token? It never prints the key or a token.

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createElevenLabsPort } from '../src/server/elevenlabs';
import { loadConfig, makeRedactor } from '../src/server/env';

const cfg = loadConfig();
const redact = makeRedactor(cfg.apiKey);
const ok = (msg: string) => console.log(`  OK    ${msg}`);
const bad = (msg: string) => { console.log(`  FAIL  ${msg}`); failures += 1; };
const warn = (msg: string) => console.log(`  WARN  ${msg}`);
let failures = 0;

if (!cfg.apiKey) {
  console.error('ELEVENLABS_API_KEY is not set. Copy .env.example to .env and add it.');
  process.exit(1);
}
const client = new ElevenLabsClient({ apiKey: cfg.apiKey, ...(cfg.restBaseUrl ? { baseUrl: cfg.restBaseUrl } : {}) });

console.log('\n1. API key and models');
let models: Awaited<ReturnType<typeof client.models.list>> = [];
let modelsListed = false;
try {
  models = await client.models.list();
  modelsListed = true;
  ok(`key works, ${models.length} models listed`);
} catch (err) {
  bad(`could not list models (is the key right?): ${redact((err as Error).message).split('\n')[0]}`);
}

const supports = (modelId: string, lang: string) => {
  const m = models.find((x) => x.modelId === modelId);
  if (!m) return 'missing' as const;
  if (m.canDoTextToSpeech === false) return 'no-tts' as const;
  const ids = (m.languages ?? []).map((l) => l.languageId.toLowerCase());
  return ids.length === 0 ? ('unknown' as const) : ids.includes(lang) ? ('yes' as const) : ('no' as const);
};

for (const [lang, list] of modelsListed ? ([['en', cfg.ttsModelsEn], ['th', cfg.ttsModelsTh]] as const) : []) {
  let anyOk = false;
  for (const id of list) {
    const s = supports(id, lang);
    if (s === 'yes') { ok(`${id} supports ${lang}`); anyOk = true; }
    else if (s === 'unknown') { warn(`${id}: the API lists no languages, cannot confirm ${lang}`); anyOk = true; }
    else if (s === 'missing') warn(`${id} is not in your model list (the fallback chain will skip it)`);
    else if (s === 'no-tts') warn(`${id} cannot do text-to-speech`);
    else warn(`${id} does NOT list ${lang}`);
  }
  if (!anyOk) bad(`no configured ${lang} model supports ${lang}. Change TTS_MODEL_${lang.toUpperCase()} in .env`);
}

console.log('\n2. Voices');
for (const [lang, id] of [['en', cfg.voiceIdEn], ['th', cfg.voiceIdTh]] as const) {
  if (!id) { bad(`VOICE_ID_${lang.toUpperCase()} is not set`); continue; }
  try {
    const v = await client.voices.get(id);
    const verified = (v.verifiedLanguages ?? []).map((l) => l.language).join(', ');
    ok(`${lang}: "${v.name}" (${v.category ?? 'unknown category'})${verified ? `, verified for: ${verified}` : ''}`);
    if (lang === 'th' && verified && !/th|thai/i.test(verified)) warn('this voice is not verified for Thai. Have the Thai teammate listen before the demo.');
  } catch (err) {
    bad(`${lang}: voice ${id} was not found or not allowed: ${redact((err as Error).message).split('\n')[0]}`);
  }
}

console.log('\n3. Short-lived Scribe token (needed for browser speech-to-text)');
try {
  const token = await createElevenLabsPort(cfg).createRealtimeToken();
  ok(`token minted (${token.length} characters, not shown). The browser never needs the API key.`);
} catch (err) {
  bad(`could not mint a token: ${redact((err as Error).message).split('\n')[0]}`);
}

if (process.argv.includes('--speak')) {
  console.log('\n4. One short line per language (uses a few credits)');
  const port = createElevenLabsPort(cfg);
  for (const [lang, voice, modelList, text] of [
    ['en', cfg.voiceIdEn, cfg.ttsModelsEn, 'Hi, I am Icarus.'],
    ['th', cfg.voiceIdTh, cfg.ttsModelsTh, 'สวัสดี ฉันคืออิคารัส'],
  ] as const) {
    if (!voice) continue;
    for (const model of modelList) {
      const t0 = performance.now();
      try {
        const body = await port.streamSpeech({ voiceId: voice, text, modelId: model, outputFormat: cfg.ttsOutputFormat, ...(lang === 'th' ? { languageCode: 'th' } : {}) });
        const reader = body.getReader();
        const first = await reader.read();
        const ms = Math.round(performance.now() - t0);
        await reader.cancel();
        ok(`${lang} ${model}: first audio in ${ms} ms (${first.value?.byteLength ?? 0} bytes)`);
        break; // the first model that works is the one the server will use
      } catch (err) {
        warn(`${lang} ${model}: ${redact((err as Error).message)} (statusCode ${(err as { statusCode?: number }).statusCode ?? 'n/a'})`);
      }
    }
  }
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
