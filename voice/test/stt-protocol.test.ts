import { describe, expect, it } from 'vitest';
import { audioFrame, buildSttUrl, commitFrame, parseSttMessage, redactUrl } from '../src/shared/stt-protocol';

const base = {
  baseUrl: 'wss://api.elevenlabs.io',
  token: 'sutkn_abc123',
  commitStrategy: 'vad' as const,
  vadSilenceSecs: 0.7,
  vadThreshold: 0.4,
  minSpeechMs: 100,
  minSilenceMs: 100,
  keyterms: ['gold', 'U-topia', 'ทอง'],
  noVerbatim: true,
  detectLanguage: false,
};

describe('buildSttUrl', () => {
  it('builds the realtime URL with repeated keyterms and the token', () => {
    const url = new URL(buildSttUrl({ ...base, languageCode: 'th' }));
    expect(url.origin).toBe('wss://api.elevenlabs.io');
    expect(url.pathname).toBe('/v1/speech-to-text/realtime');
    const q = url.searchParams;
    expect(q.get('model_id')).toBe('scribe_v2_realtime');
    expect(q.get('audio_format')).toBe('pcm_16000');
    expect(q.get('commit_strategy')).toBe('vad');
    expect(q.get('vad_silence_threshold_secs')).toBe('0.7');
    expect(q.get('language_code')).toBe('th');
    expect(q.get('include_timestamps')).toBe('true');
    expect(q.getAll('keyterms')).toEqual(['gold', 'U-topia', 'ทอง']);
    expect(q.get('token')).toBe('sutkn_abc123');
  });

  it('omits the language and asks for detection in auto mode', () => {
    const q = new URL(buildSttUrl({ ...base, detectLanguage: true })).searchParams;
    expect(q.has('language_code')).toBe(false);
    expect(q.get('include_language_detection')).toBe('true');
  });

  it('leaves VAD tuning out of manual (push-to-talk) sessions', () => {
    const q = new URL(buildSttUrl({ ...base, commitStrategy: 'manual' })).searchParams;
    expect(q.get('commit_strategy')).toBe('manual');
    expect(q.has('vad_silence_threshold_secs')).toBe(false);
  });

  it('never sends filter_background_audio (the API refuses it together with include_timestamps)', () => {
    const q = new URL(buildSttUrl(base)).searchParams;
    expect(q.get('include_timestamps')).toBe('true');
    expect(q.has('filter_background_audio')).toBe(false);
  });

  it('can hide the token for logs', () => {
    expect(redactUrl(buildSttUrl(base))).not.toContain('sutkn_abc123');
    expect(redactUrl(buildSttUrl(base))).toContain('token=[redacted]');
  });
});

describe('parseSttMessage', () => {
  it('parses the normal events', () => {
    expect(parseSttMessage('{"message_type":"session_started","session_id":"s1"}')).toEqual({ kind: 'session_started', sessionId: 's1' });
    expect(parseSttMessage('{"message_type":"partial_transcript","text":"hel"}')).toEqual({ kind: 'partial', text: 'hel' });
    expect(parseSttMessage('{"message_type":"committed_transcript","text":"hello"}')).toEqual({ kind: 'committed', text: 'hello' });
  });
  it('parses timestamps with word confidence', () => {
    const msg = parseSttMessage(JSON.stringify({
      message_type: 'committed_transcript_with_timestamps',
      text: 'confirm',
      language_code: 'eng',
      words: [{ text: 'confirm', type: 'word', logprob: -0.05, start: 0, end: 0.5 }],
    }));
    expect(msg).toMatchObject({ kind: 'committed_with_timestamps', text: 'confirm', languageCode: 'eng' });
    expect(msg && msg.kind === 'committed_with_timestamps' && msg.words[0]?.logprob).toBe(-0.05);
  });
  it('turns every error type into an error', () => {
    for (const type of ['auth_error', 'quota_exceeded', 'rate_limited', 'input_error', 'session_time_limit_exceeded']) {
      expect(parseSttMessage(JSON.stringify({ message_type: type, error: 'nope' }))).toEqual({ kind: 'error', code: type, message: 'nope' });
    }
  });
  it('survives junk', () => {
    expect(parseSttMessage('not json')).toBeNull();
    expect(parseSttMessage('{"message_type":"mystery"}')).toEqual({ kind: 'other', messageType: 'mystery' });
  });
});

describe('frames', () => {
  it('encodes audio exactly as the API expects', () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const frame = JSON.parse(audioFrame(pcm));
    expect(frame).toEqual({ message_type: 'input_audio_chunk', audio_base_64: 'AQIDBA==', commit: false, sample_rate: 16000 });
  });
  it('encodes a commit with no audio', () => {
    expect(JSON.parse(commitFrame())).toEqual({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: 16000 });
  });
  it('handles big chunks without blowing the stack', () => {
    const big = new Uint8Array(200_000).fill(7);
    expect(JSON.parse(audioFrame(big)).audio_base_64.length).toBeGreaterThan(200_000);
  });
});
