// Tunable numbers for the browser module. Every one can be overridden in the
// `IcarusVoice` constructor. Server-side tuning (STT silence time, TTS models) is in .env.
//
// NONE of the audio thresholds below have been tuned on a real microphone yet.
// Expect to adjust them at the venue. The test page shows what each one is doing.

export const DEFAULTS = {
  // ---- Noise filter for final transcripts ----
  filter: {
    /** Drop a final transcript when Scribe's confidence is below this (0 to 1). */
    minConfidence: 0.5,
    /** Drop English fragments shorter than this many letters (unless they are a command). */
    minCharsEn: 4,
    /** Same for Thai (Thai has no spaces, so we count characters). */
    minCharsTh: 3,
  },

  // ---- Money confirmation ----
  confirm: {
    /** A spoken "confirm" is only accepted at or above this confidence. Unknown confidence fails. */
    minConfidence: 0.85,
    /** Visible countdown before the confirm intent is sent. Cancel works the whole time. */
    countdownMs: 3000,
    /** How long we wait for confirm or cancel after the read-back before giving up. */
    awaitTimeoutMs: 30_000,
    /** Hard rule 4 in context.md: voice is never approval. The UI should still ask for a tap. */
    requiresTap: true,
  },

  // ---- Barge-in (user talks while Icarus is talking) ----
  bargeIn: {
    /**
     * 'transcript': stop when Scribe returns a partial that is not an echo of Icarus.
     * 'hybrid': also stop when the mic is clearly loud for a short time (faster, but a loud
     *           speaker echo can trigger it. Use headphones or lower the volume if it does).
     */
    mode: 'hybrid' as 'transcript' | 'hybrid',
    /** Mic must be this many times louder than the background level to count as speech... */
    energyRatio: 3,
    /** ...and this much louder while Icarus is speaking (echo protection). */
    energyRatioWhileSpeaking: 6,
    /** Smallest mic level (0 to 1) that can ever count as speech. */
    minRms: 0.015,
    /** How long the mic must stay loud before we call it speech. */
    onsetMs: 120,
    /** Partials shorter than this are ignored for barge-in. */
    minPartialChars: 2,
    /** Partials at least this long that match what Icarus is saying are treated as echo. */
    echoMinChars: 8,
  },

  // ---- Local voice activity detection (energy based) ----
  vad: {
    /** Silence after speech before we say the user stopped. Used for timing and idle checks. */
    hangoverMs: 400,
  },

  // ---- Credits protection ----
  /** In hands-free mode the mic streams to Scribe all the time, which uses credits. Stop after this much silence. 0 turns it off. */
  idleStopAfterSec: 120,

  // ---- TTS playback ----
  tts: {
    /** Start playing this long after the first audio arrives. A tiny lead avoids clicks. */
    startLeadMs: 40,
    /** Volume steps for "louder". 1 is normal. Above 1 can distort on some speakers. */
    volumeSteps: [1, 1.4, 1.8],
    /** Speed steps for "slower". ElevenLabs supports about 0.7 to 1.2. */
    speedSteps: [1, 0.9, 0.8],
  },
};

export type VoiceDefaults = typeof DEFAULTS;
