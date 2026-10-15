// The test page. Not part of the product: it exists so you can try every part of the voice layer
// (and so Oasis can see how the module is used). The "pretend frontend" card shows what a real
// frontend should do with the events.

import { IcarusVoice } from '../src/client';
import { SyntheticMic } from '../src/client/synthetic-mic';
import { DEMO_LINES_EN } from '../src/config/demo-lines';
import { extractPreview } from '../src/shared/readback';
import type { LangSetting, Mode, TradePreview, TurnMetrics, VoiceEvents } from '../src/shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  banner: $('banner'), toggle: $<HTMLButtonElement>('toggle'), ptt: $<HTMLButtonElement>('ptt'),
  mode: $<HTMLSelectElement>('mode'), lang: $<HTMLSelectElement>('lang'),
  requireTap: $<HTMLInputElement>('requireTap'), simConfirm: $<HTMLInputElement>('simConfirm'),
  synthMic: $<HTMLInputElement>('synthMic'), synthTalk: $<HTMLButtonElement>('synthTalk'),
  state: $('state'), phase: $('phase'), countdown: $('countdown'), cancelTap: $<HTMLButtonElement>('cancelTap'),
  partial: $('partial'), finals: $('finals'), events: $('events'),
  tfa: $('m-tfa'), stt: $('m-stt'), asst: $('m-asst'), tts: $('m-tts'), avg: $('m-avg'), barge: $('m-barge'),
  uStt: $('u-stt'), uTts: $('u-tts'),
  typed: $<HTMLInputElement>('typed'), sim: $<HTMLInputElement>('sim'), simConf: $<HTMLInputElement>('simConf'),
  preview: $('preview'), previewNote: $('previewNote'), snapshot: $<HTMLTextAreaElement>('snapshot'),
};

let voice: IcarusVoice;
let synth: SyntheticMic | null = null;
let running = false;
const recentFirstAudio: number[] = [];

// ---------- event log ----------
function log(text: string, kind: '' | 'bad' | 'good' = ''): void {
  const line = document.createElement('div');
  const time = new Date().toLocaleTimeString([], { hour12: false });
  line.textContent = `${time}  ${text}`;
  if (kind) line.className = kind;
  el.events.prepend(line);
  while (el.events.childElementCount > 100) el.events.lastElementChild?.remove();
}

// ---------- the voice module ----------
function createVoice(): void {
  voice?.stop();
  running = false;
  syncControls();
  synth = el.synthMic.checked ? new SyntheticMic() : null;
  el.synthTalk.hidden = !synth;
  voice = new IcarusVoice({
    ...(synth ? { mic: synth } : {}),
    serverUrl: '', // same origin as this page
    language: el.lang.value as LangSetting,
    mode: el.mode.value as Mode,
    acceptSimulatedConfirm: el.simConfirm.checked, // TESTING ONLY
    config: { confirm: { requiresTap: el.requireTap.checked } },
  });
  wire(voice);
  pushSnapshot();
  // For debugging in the browser console.
  Object.assign(window, { icarus: voice, synth });
}

function wire(v: IcarusVoice): void {
  v.on('stateChange', ({ to, reason, confirmPhase }) => {
    el.state.textContent = to;
    el.state.dataset.state = to;
    el.phase.textContent = confirmPhase ? `step: ${confirmPhase}` : '';
    log(`state -> ${to}${confirmPhase ? `:${confirmPhase}` : ''} (${reason})`);
  });
  v.on('partialTranscript', ({ text }) => { el.partial.textContent = text; });
  v.on('finalTranscript', (t) => {
    el.partial.textContent = '';
    const row = document.createElement('div');
    const conf = t.confidence === null ? 'confidence unknown' : `confidence ${t.confidence.toFixed(2)}`;
    row.innerHTML = '';
    row.append(document.createTextNode(t.text + ' '));
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `${t.language} | ${conf} | ${t.source}`;
    row.append(tag);
    el.finals.prepend(row);
  });
  v.on('transcriptIgnored', ({ text, reason, confidence }) =>
    log(`ignored "${text}" (${reason}${confidence === null ? '' : `, ${confidence.toFixed(2)}`})`));
  v.on('speakingStart', ({ text, kind }) => log(`speaking (${kind}): ${text}`));
  v.on('speakingEnd', ({ reason }) => log(`speaking ended: ${reason}`));
  v.on('command', ({ name }) => log(`local command: ${name}${name === 'back' ? ' (the UI would navigate back here)' : ''}`, 'good'));
  v.on('bargeIn', ({ source, ms }) => {
    const text = ms === null ? 'n/a' : `${ms}`;
    el.barge.textContent = `${text} (${source})`;
    el.barge.className = ms !== null && ms < 500 ? 'good' : 'bad';
    log(`barge-in by ${source}: ${text} ms`);
  });
  v.on('turnMetrics', showMetrics);
  v.on('usage', (u) => {
    el.uStt.textContent = `${u.sttSeconds.toFixed(1)} s`;
    el.uTts.textContent = `${u.ttsCharacters} characters (${u.ttsCharactersFromCache} from cache)`;
  });
  v.on('error', ({ code, message, fatal }) => {
    log(`error ${code}${fatal ? ' (fatal)' : ''}: ${message}`, 'bad');
    if (fatal || code === 'idle_timeout') { running = false; syncControls(); }
  });
  v.on('assistantReply', (r) => {
    const actions = r.reply.ui_actions.map((a) => a.type).join(', ') || 'none';
    log(`assistant (${r.assistantMs} ms): "${r.reply.text}"  ui_actions: ${actions}`);
    const preview = extractPreview(r.reply);
    if (preview) showPreview(preview);
  });
  v.on('countdown', (c) => {
    if (c.phase === 'start' || c.phase === 'tick') {
      el.countdown.hidden = false;
      el.cancelTap.hidden = false;
      el.countdown.textContent = String(c.secondsLeft);
    } else {
      el.countdown.hidden = true;
      el.cancelTap.hidden = true;
    }
    log(`countdown ${c.phase}${c.cancelledBy ? ` by ${c.cancelledBy}` : ''} (${c.secondsLeft})`);
    if (c.phase === 'cancelled') markPreview('cancelled', 'Cancelled. Nothing was sent.');
  });
  v.on('confirmIntent', (e) => {
    log(`CONFIRM INTENT for ${e.previewId} (requiresTap: ${e.requiresTap})`, 'good');
    // This is where the FRONTEND decides. The voice layer only reported an intent.
    if (e.requiresTap) {
      markPreview('armed', 'Voice said confirm. Tap "Confirm" on this card to approve.');
    } else {
      executeSimulated('voice intent (frontend chose to proceed without a tap)');
    }
  });
}

// ---------- pretend frontend: the preview card ----------
let currentPreview: TradePreview | null = null;

function showPreview(p: TradePreview): void {
  currentPreview = p;
  const money = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })} ${p.currency}`;
  el.preview.className = 'preview pending';
  el.preview.innerHTML = '';
  const title = document.createElement('div');
  title.innerHTML = `<strong>${p.side.toUpperCase()}</strong> <span class="tag">${p.preview_id}</span>`;
  const dl = document.createElement('dl');
  for (const [k, v] of [['Asset', p.asset], ['Amount', money(p.amount)], ['Fee', money(p.fee)], ['Total', money(p.total)]] as const) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  const row = document.createElement('div');
  row.className = 'row';
  const confirm = document.createElement('button');
  confirm.className = 'primary'; confirm.id = 'tapConfirm'; confirm.textContent = 'Confirm';
  confirm.onclick = () => executeSimulated('tap on the card');
  const cancel = document.createElement('button');
  cancel.className = 'danger'; cancel.textContent = 'Cancel';
  cancel.onclick = () => { voice.cancelConfirm(); markPreview('cancelled', 'Cancelled by tap.'); };
  row.append(confirm, cancel);
  const status = document.createElement('div');
  status.id = 'previewStatus'; status.className = 'hint';
  el.preview.append(title, dl, row, status);
}

function markPreview(state: 'armed' | 'cancelled' | 'done', message: string): void {
  if (!currentPreview) return;
  el.preview.className = `preview ${state === 'armed' ? 'armed' : ''}`;
  const status = document.getElementById('previewStatus');
  if (status) status.textContent = message;
  if (state !== 'armed') el.preview.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
}

/** The frontend "executes". In a real app this is where execute_trade would be called, after a TAP. */
function executeSimulated(how: string): void {
  if (!currentPreview) return;
  log(`FRONTEND executes the trade (simulated) via ${how}`, 'good');
  markPreview('done', `Executed (simulated) via ${how}.`);
  voice.confirmResolved();
  voice.speak('Confirmed. Your gold purchase is on its way.');
  currentPreview = null;
}

// ---------- metrics ----------
function showMetrics(m: TurnMetrics): void {
  const ms = (v: number | null) => (v === null ? '-' : `${v}`);
  el.stt.textContent = ms(m.sttFinalMs);
  el.asst.textContent = ms(m.assistantMs);
  el.tts.textContent = `${ms(m.ttsFirstByteMs)} (${m.ttsCache ?? '-'})`;
  el.tfa.textContent = ms(m.timeToFirstAudioMs);
  el.tfa.className = m.timeToFirstAudioMs !== null && m.timeToFirstAudioMs <= 1500 ? 'good' : 'bad';
  if (m.timeToFirstAudioMs !== null) {
    recentFirstAudio.push(m.timeToFirstAudioMs);
    if (recentFirstAudio.length > 10) recentFirstAudio.shift();
    el.avg.textContent = `${Math.round(recentFirstAudio.reduce((a, b) => a + b, 0) / recentFirstAudio.length)} (${recentFirstAudio.length} turns)`;
  }
}

// ---------- controls ----------
function syncControls(): void {
  el.toggle.textContent = running ? 'Stop mic' : 'Start mic';
  el.ptt.hidden = el.mode.value !== 'push-to-talk';
}

function pushSnapshot(): void {
  try {
    voice.setSnapshot(JSON.parse(el.snapshot.value));
    el.snapshot.style.borderColor = '';
  } catch {
    el.snapshot.style.borderColor = 'var(--bad)';
  }
}

el.toggle.onclick = async () => {
  if (running) { voice.stop(); running = false; syncControls(); return; }
  running = true;
  syncControls();
  await voice.start(); // from a click, so the browser allows the mic and audio
};
el.mode.onchange = () => { voice.setMode(el.mode.value as Mode); syncControls(); };
el.lang.onchange = () => voice.setLanguage(el.lang.value as LangSetting);
el.requireTap.onchange = createVoice;
el.simConfirm.onchange = createVoice;
el.synthMic.onchange = createVoice;
el.synthTalk.onpointerdown = () => synth?.setTalking(true);
el.synthTalk.onpointerup = () => synth?.setTalking(false);
el.synthTalk.onpointerleave = () => synth?.setTalking(false);
el.cancelTap.onclick = () => voice.cancelConfirm();
el.snapshot.oninput = pushSnapshot;

// Push to talk: button or Space bar
el.ptt.onpointerdown = () => voice.pushToTalkStart();
window.addEventListener('pointerup', () => voice.pushToTalkEnd());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && el.mode.value === 'push-to-talk' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
    e.preventDefault();
    voice.pushToTalkStart();
  }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') voice.pushToTalkEnd(); });

// Mock reply buttons (typed path: no mic needed). Unlock audio first, it needs a click.
document.querySelectorAll<HTMLButtonElement>('[data-say],[data-say-th]').forEach((b) => {
  b.onclick = async () => {
    await voice.unlock();
    const th = b.dataset.sayTh;
    if (th && el.lang.value === 'en') { el.lang.value = 'th'; voice.setLanguage('th'); }
    if (!th && el.lang.value === 'th') { el.lang.value = 'en'; voice.setLanguage('en'); }
    voice.sendText(th ?? b.dataset.say ?? '');
  };
});
el.typed.onkeydown = async (e) => { if (e.key === 'Enter') { await voice.unlock(); voice.sendText(el.typed.value); el.typed.value = ''; } };
$('sendTyped').onclick = async () => { await voice.unlock(); voice.sendText(el.typed.value); el.typed.value = ''; };

const simulate = async (text: string) => { await voice.unlock(); voice.injectTranscript(text, Number(el.simConf.value)); };
document.querySelectorAll<HTMLButtonElement>('[data-sim]').forEach((b) => { b.onclick = () => simulate(b.dataset.sim ?? ''); });
$('simGo').onclick = () => { void simulate(el.sim.value); el.sim.value = ''; };
el.sim.onkeydown = (e) => { if (e.key === 'Enter') { void simulate(el.sim.value); el.sim.value = ''; } };

// Demo lines
for (const line of DEMO_LINES_EN) {
  const b = document.createElement('button');
  b.textContent = line.id;
  b.title = line.text;
  b.onclick = async () => { await voice.unlock(); voice.speak(line.text); };
  $('demoLines').append(b);
}

// ---------- start ----------
async function showHealth(): Promise<void> {
  try {
    const h = await (await fetch('/api/health')).json();
    const notes: string[] = [];
    if (h.fakeElevenLabs) notes.push('FAKE ElevenLabs: you hear tones, not speech. If you start the mic, whatever you say is "heard" as the next scripted phrase: red number, take me to gold, put 1,000 baht in gold, confirm, what should I buy.');
    else {
      if (!h.apiKeySet) notes.push('ELEVENLABS_API_KEY is missing in .env. Text replies work, voice does not.');
      if (!h.voices.en) notes.push('VOICE_ID_EN is missing.');
      if (!h.voices.th) notes.push('VOICE_ID_TH is missing (Thai will not speak).');
    }
    notes.push(`Assistant: ${h.assistant === 'mock' ? 'MOCK (canned replies)' : 'real'}. TTS models: EN ${h.ttsModels.en.join(', ')} | TH ${h.ttsModels.th.join(', ')}.`);
    el.banner.textContent = notes.join(' ');
    el.banner.classList.toggle('warn', notes.length > 1);
  } catch {
    el.banner.textContent = 'Cannot reach the voice server. Start it with: npm run dev';
    el.banner.classList.add('warn');
  }
}

createVoice();
void showHealth();
