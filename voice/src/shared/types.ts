// Shared types. These are the contracts between the voice layer, the assistant
// (Luka and First) and the frontend (Oasis). See context.md section 8.
// Used by both the Node server and the browser module, so no Node or DOM imports here.

/** Languages we speak. */
export type Lang = 'en' | 'th';
/** What the user picked in the UI. 'auto' lets Scribe detect the language. */
export type LangSetting = Lang | 'auto';

/** Hands-free: mic stays on after one toggle. Push-to-talk: user holds a button. */
export type Mode = 'hands-free' | 'push-to-talk';

/** The five states the UI can show. */
export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'confirming';

/** Inside 'confirming' we are in one of these steps. */
export type ConfirmPhase = 'readback' | 'awaiting' | 'countdown';

/** Latest screen snapshot from the frontend. We never read it, we only pass it on. */
export type Snapshot = Record<string, unknown>;

// ---------- Assistant contract (context.md section 8) ----------

/**
 * Things the frontend should do. The contract names highlight and card instructions.
 * `navigate` is NOT in the contract yet. We added it for "take me to gold".
 * Ask Luka, First and Oasis to agree on it.
 */
export type UiAction =
  | { type: 'highlight'; element_id: string; message?: string }
  | { type: 'show_card'; card_type: string; data: Record<string, unknown> }
  | { type: 'navigate'; screen: string }
  /**
   * NOT in the contract yet. Icarus cannot do this one, so it hands the user to U-Bot.
   * The frontend shows a card with a link. See shared/types.ts Handoff and docs in voice/README.md.
   */
  | { type: 'handoff'; target: 'u-bot'; reason: HandoffReason; label: string; url: string; question: string };

/** Why we hand off. */
export type HandoffReason =
  | 'utopia_question' // a question about U-topia that our glossary cannot answer
  | 'commerce' // travel, rides, grocery orders: U-Bot prepares them, the user reviews and pays in U-topia Pay
  | 'general'; // something else Icarus is not built for (drawing, writing, building apps, anything unclear)

export interface Handoff {
  target: 'u-bot';
  reason: HandoffReason;
  /** Button text. */
  label: string;
  /** What Icarus says. Always shown on screen. */
  message: string;
  /** Where the button goes. U-Bot has no public deep link, so this is its front door. */
  url: string;
  /** The user's own words, so they can paste them into U-Bot. */
  question: string;
  /** true when the button opens our U-Bot MOCK (UBOT_MODE=mock), not the real U-Bot. */
  mock?: boolean;
  /** A prompt for U-Bot written from the user's request and where they are in the app (shared/ubot-prompt.ts). */
  prompt?: string;
}

/** What the U-topia router decided for a request. */
export type UtopiaRoute =
  | { kind: 'answer'; answer: string; language: Lang; source: 'mock' | 'u-bot'; verified: boolean; topic: string }
  | { kind: 'handoff'; handoff: Handoff; language: Lang }
  | { kind: 'none' };

export interface AssistantRequest {
  text: string;
  language: LangSetting;
  snapshot?: Snapshot;
  userId: string;
  /** One conversation (the backend keeps the history per user and session). */
  sessionId?: string;
}

export interface AssistantReply {
  /** What Icarus says (short). Always shown on screen. */
  text: string;
  /**
   * OPTIONAL. A separate script written for the voice: short sentences, rounded numbers,
   * "baht" instead of the symbol. If present we speak this instead of `text`.
   * (Oasis's prototype already defines this field. It is not in the context.md contract.)
   */
  speech?: string;
  /** Backend-generated numerical script: preserve exact values and sentence scope. */
  speech_exact?: boolean;
  status?: string;
  limitations?: string[];
  numerical_summaries?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  /** OPTIONAL. Mascot mood for the UI (happy, excited, curious, thinking). The voice layer passes it on. */
  emotion?: string;
  /** Whether to read it aloud. */
  speak: boolean;
  ui_actions: UiAction[];
  /** Which tool calls the numbers came from. For debugging and honesty. */
  sources: Array<string | Record<string, unknown>>;
}

/** One function. The mock and the real brain both implement it. */
export interface Assistant {
  ask(req: AssistantRequest): Promise<AssistantReply>;
}

// ---------- Money preview ----------

/**
 * What we need from a trade or deposit preview to read it back.
 * ASSUMPTION: the real `prepare_trade` output will be mapped to this shape.
 * `extractPreview` in readback.ts accepts a few field-name variants.
 */
export interface TradePreview {
  preview_id: string;
  side: 'buy' | 'sell' | 'deposit';
  /** Spoken asset name, e.g. "gold". */
  asset: string;
  amount: number;
  fee: number;
  total: number;
  /** ISO-like code, e.g. "THB". */
  currency: string;
}

// ---------- Server API shapes ----------

export interface AskResponse {
  reply: AssistantReply;
  /** What to say out loud, already cleaned up. null when nothing should be spoken. */
  speech: { text: string; language: Lang; kind: 'reply' | 'readback' } | null;
  /** Set when the reply contains a trade or deposit preview we can read back. */
  preview: TradePreview | null;
  assistantMs: number;
}

export interface ScribeTokenResponse {
  /** Full wss URL, including the single-use token. Never contains the API key. */
  url: string;
  /** 'manual' for push-to-talk, 'vad' for hands-free. */
  commitStrategy: 'manual' | 'vad';
  expiresInSec: number;
}

// ---------- Transcripts ----------

export interface PartialTranscript {
  text: string;
}

export interface FinalTranscript {
  text: string;
  /** 0 to 1, where about 1 is a clean utterance (see confidenceReference). null means unknown, which is treated as NOT high. */
  confidence: number | null;
  /** Scribe's own number (exp of the mean word log probability), before normalising. For tuning. */
  rawConfidence?: number | null;
  /** The language we will use for the assistant and the reply voice. */
  language: Lang;
  /** Where the text came from. Only 'voice' may ever start a confirm countdown. */
  source: 'voice' | 'text' | 'simulated';
  /** When the user started speaking this utterance, on the performance.now() clock. null if unknown. */
  speechStartedAt: number | null;
}

// ---------- Events the browser module emits ----------

export interface TurnMetrics {
  turnId: number;
  /** Last mic voice activity to the final transcript. This is the endpointing delay plus STT. */
  sttFinalMs: number | null;
  /** Time the assistant took (as measured by the server). */
  assistantMs: number | null;
  /** Request sent to first audio byte from the TTS endpoint. */
  ttsFirstByteMs: number | null;
  /** Last mic voice activity to the first audio playing. The number that matters. */
  timeToFirstAudioMs: number | null;
  ttsCache: 'hit' | 'miss' | null;
}

export interface UsageTotals {
  sttSeconds: number;
  ttsCharacters: number;
  ttsCharactersFromCache: number;
}

export interface CountdownEvent {
  phase: 'start' | 'tick' | 'cancelled' | 'done';
  previewId: string;
  totalMs: number;
  remainingMs: number;
  /** Whole seconds left, for display: 3, 2, 1. */
  secondsLeft: number;
  /** Set when phase is 'cancelled'. 'stopped' means the voice session was stopped. */
  cancelledBy?: 'voice' | 'tap' | 'stopped';
  /**
   * Set when phase is 'cancelled'. True if the countdown was already running.
   * A cancel can also come before the countdown starts (the user says "cancel" after the
   * read-back). The UI should drop the preview card in both cases.
   */
  wasCounting?: boolean;
}

export interface ConfirmIntentEvent {
  previewId: string;
  source: 'voice';
  /**
   * Always true by default. Hard rule 4 in context.md: voice is never approval,
   * confirmation is a tap. The frontend decides what to do with this intent.
   */
  requiresTap: boolean;
}

export type LocalCommand = 'stop' | 'repeat' | 'back' | 'louder' | 'slower';

export interface VoiceEvents {
  partialTranscript: PartialTranscript;
  finalTranscript: FinalTranscript;
  stateChange: { from: VoiceState; to: VoiceState; reason: string; confirmPhase: ConfirmPhase | null };
  speakingStart: { text: string; kind: 'reply' | 'readback' | 'line' };
  speakingEnd: { reason: 'finished' | 'interrupted' | 'stopped' | 'error' };
  confirmIntent: ConfirmIntentEvent;
  countdown: CountdownEvent;
  assistantReply: AskResponse;
  /** A local command was handled without calling the assistant. `back` needs the UI to act. */
  command: { name: LocalCommand; text: string };
  /**
   * The user talked over Icarus and playback stopped. `ms` is from the start of their speech.
   * Speech only stops Icarus when it is loud, sustained AND has real words (client/barge-in.ts). `source` says which
   * of those arrived last: 'energy' (the loudness), 'transcript' (a partial) or 'final'. Or the push-to-talk button.
   */
  bargeIn: { source: 'energy' | 'transcript' | 'final' | 'push-to-talk'; ms: number | null };
  /** A final transcript was dropped as noise, echo or low confidence. For the test page. */
  transcriptIgnored: { text: string; reason: string; confidence: number | null };
  turnMetrics: TurnMetrics;
  usage: UsageTotals;
  error: { code: string; message: string; fatal: boolean };
}
