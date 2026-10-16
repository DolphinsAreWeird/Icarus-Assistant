// Mock-up mode (?mock): the Icarus button never listens. Press it, wait two seconds, and the scripted request is
// "heard" and answered by the backend like a real one. For a live demo where we know what will be said.
type Proto = Record<string, any>;

export const MOCK_PHRASE = 'Hey Icarus, I want to buy 1000 baht of gold';
export const MOCK_WAIT_MS = 2000;

export function installMockVoice(proto: Proto, options: { phrase?: string; waitMs?: number } = {}) {
  const phrase = options.phrase ?? MOCK_PHRASE;
  const waitMs = options.waitMs ?? MOCK_WAIT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  proto.startRec = () => undefined; // the microphone is never opened, and no permission prompt appears

  const stop = proto.stopVoiceStuff;
  proto.stopVoiceStuff = function stopMockVoiceStuff(this: Proto, ...args: unknown[]) {
    clearTimeout(timer); // closing the voice screen cancels a request that was about to be "heard"
    return stop.apply(this, args);
  };

  proto.startVoice = function startMockVoice(this: Proto) {
    clearTimeout(timer);
    this.stopVoiceStuff();
    // Open the voice screen already in "listening": no greeting, no wait for the speech service.
    this.setState({ asst: 'voice', closing: false, fabBubble: null,
      voice: { phase: 'listening', transcript: '', you: '', line: '', said: 0, muted: false, emotion: 'happy', chips: [], sttOff: false } });
    this.log('voice_start', { lang: this.state.lang, mock: true });
    timer = setTimeout(() => {
      const v = this.state.voice;
      if (this.state.asst === 'voice' && v && v.phase === 'listening') this.simulate(phrase); // types it, then answers it
    }, waitMs);
  };
}
