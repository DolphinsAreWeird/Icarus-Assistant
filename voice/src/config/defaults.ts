// Tunable numbers for the browser module. Every one can be overridden in the
// `IcarusVoice` constructor. Server-side tuning (STT silence time, TTS models) is in .env.
//
// NONE of the audio thresholds below have been tuned on a real microphone yet.
// Expect to adjust them at the venue. The test page shows what each one is doing.

export const DEFAULTS = {
  // ---- What a CLEAN utterance scores from Scribe, per language ----
  // Scribe reports a per-word log probability. Measured on the live API (15 Oct 2026, macOS voices):
  //   English "confirm": clean 0.49, 15 dB noise 0.42, 5 dB 0.35, 0 dB 0.20 (as exp of the mean).
  //   Thai "ยืนยัน":     clean 0.36, 15 dB 0.30, 5 dB 0.04.
  // So raw scores are low even for perfect speech. We divide by these numbers (capped at 1) so that
  // "clean speech" is about 1.0, and the thresholds below mean what they say.
  // CALIBRATED WITH SYNTHETIC VOICES ONLY. Re-measure with real human voices: the test page shows
  // both numbers for every sentence ("confidence 0.93 (raw 0.44)").
  confidenceReference: { en: 0.47, th: 0.35 } as Record<'en' | 'th', number>,

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

  // ---- Barge-in: the user talks while Icarus is talking (client/barge-in.ts) ----
  // Icarus stops talking ONLY when ALL three hold. Strangers try the demo in noisy places, so a cough, a door,
  // a laugh or people chatting nearby must never cut it off:
  //   (a) LOUD:  the mic level is above max(noise floor x levelRatio, minLevel). The noise floor is learned all
  //              the time, while listening AND while Icarus talks: a low percentile of recent mic levels
  //              (client/noise-floor.ts). A noisy room raises it by itself; a quiet room lowers it again.
  //   (b) LONG:  that loudness lasts sustainMs. Short dips are bridged, but most of the stretch must be loud.
  //   (c) WORDS: Scribe heard real words with it (minWords words, one word of minLetters letters, or a stop word),
  //              and they are not Icarus's own voice coming back through the mic (echo).
  // Mic levels are RMS, 0 to 1 (0.02 is about -34 dBFS). Frames are 20 ms.
  // Tapping the mascot (stopSpeaking) and the push-to-talk button skip all of this: they always stop Icarus at once.
  bargeIn: {
    // (a) The noise floor: this percentile of the mic level over the last floorWindowMs...
    floorPercentile: 0.2,
    floorWindowMs: 5000,
    /** ...or this level, until floorWarmupMs of audio has been heard (just after the mic starts). */
    floorInitial: 0.005,
    floorWarmupMs: 500,
    /** Loud means at least this many times the noise floor... */
    levelRatio: 3,
    /** ...and never below this level, so in a very quiet room a breath or a rustle is still not "loud". */
    minLevel: 0.02,

    // (b) Sustained: loud for at least this long, so a single spike (a clap, a door slam, a dropped phone) is not enough...
    sustainMs: 300,
    /** ...where quiet gaps up to this long do not break it (the pause in "wait, stop", the silent part of a "t")... */
    maxGapMs: 150,
    /** ...but at least this share of the stretch must be loud. Typing and footsteps are spikes with gaps: they fail this. */
    minLoudShare: 0.6,

    // (c) Words: Scribe's transcripts lag the sound by about 1 to 2 seconds, so the words may arrive after the
    // loud stretch has ended. They count if they arrive within this long of its last loud frame (and not before it began).
    wordsWithinMs: 2000,
    /** At least this many words... */
    minWords: 2,
    /** ...or one word with at least this many letters (Thai: base letters, without vowel and tone marks)... */
    minLetters: 4,
    /**
     * ...or one of these stop words, however short. Matched anywhere in the transcript (Thai: inside the text).
     * Fillers ("uh", "mm", "okay", "ครับ": NOISE_FRAGMENTS in config/voice-commands.ts) and sound tags like
     * "(coughs)" never count as words. THAI REVIEW: check the Thai list.
     */
    stopWords: {
      en: ['stop', 'wait', 'hold on', 'hang on', 'cancel'],
      th: ['หยุด', 'เดี๋ยว', 'รอก่อน', 'รอแป๊บ', 'พอแล้ว', 'ยกเลิก', 'เงียบ'],
    },
    /** Transcripts at least this long that match what Icarus is saying are echo (English. Thai matches loosely). */
    echoMinChars: 8,
  },

  // ---- Local voice activity detection (client/vad.ts) ----
  // For TIMING only: when the user started and stopped speaking (latency numbers, the echo check, the confirm rule).
  // It never stops Icarus. It measures against the same noise floor as barge-in.
  vad: {
    /** Silence after speech before we say the user stopped. Used for timing and idle checks. */
    hangoverMs: 400,
    /** How long the mic must stay loud before we call it speech. */
    onsetMs: 120,
    /** Smallest mic level (0 to 1) that can ever count as speech. */
    minRms: 0.015,
    /** Mic must be this many times louder than the noise floor to count as speech... */
    energyRatio: 3,
    /** ...and this much louder while Icarus is speaking (echo protection). */
    energyRatioWhileSpeaking: 6,
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
