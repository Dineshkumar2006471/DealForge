/**
 * Browser Speech Recognition Voice Client
 *
 * Uses native browser Web Speech API (webkitSpeechRecognition) as a zero-credential
 * client-side voice input provider. Emits identical voice events as RealtimeVoiceClient.
 */

class BrowserSpeechClient {
  constructor() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      throw new Error('Web Speech API is not supported in this browser. Please use Chrome.');
    }
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.connected = false;
    this.muted = false;
    this.activeTranscript = '';
    this.speechTimeout = null;

    this.setupListeners();
  }

  setupListeners() {
    this.recognition.onstart = () => {
      console.log('[BrowserSpeechClient] Speech recognition started');
      this.connected = true;
      window.dispatchEvent(new CustomEvent('voice:connected', { detail: { provider: 'browser_speech' } }));
    };

    this.recognition.onspeechstart = () => {
      console.log('[BrowserSpeechClient] Speech detected');
      window.dispatchEvent(new CustomEvent('voice:speech-started'));
    };

    this.recognition.onspeechend = () => {
      console.log('[BrowserSpeechClient] Speech ended');
      window.dispatchEvent(new CustomEvent('voice:speech-stopped'));
    };

    this.recognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      if (interim) {
        window.dispatchEvent(new CustomEvent('voice:transcript-delta', { detail: { delta: interim, text: interim } }));
      }

      if (final.trim()) {
        const cleaned = final.trim();
        console.log('[BrowserSpeechClient] Final transcript:', cleaned);
        window.dispatchEvent(new CustomEvent('voice:turn-completed', { detail: { transcript: cleaned } }));
      }
    };

    this.recognition.onerror = (event) => {
      if (event.error === 'no-speech') return; // Harmless silence
      console.warn('[BrowserSpeechClient] Error:', event.error);
      if (event.error === 'not-allowed') {
        window.dispatchEvent(new CustomEvent('voice:error', { detail: { error: new Error('Microphone access was denied.') } }));
      }
    };

    this.recognition.onend = () => {
      // Auto-restart if still connected and not muted
      if (this.connected && !this.muted) {
        try {
          this.recognition.start();
        } catch (_) {}
      }
    };
  }

  async connect() {
    if (this.connected) return;
    this.connected = true;
    try {
      this.recognition.start();
    } catch (e) {
      if (!e.message.includes('already started')) throw e;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) {
      try { this.recognition.stop(); } catch (_) {}
    } else if (this.connected) {
      try { this.recognition.start(); } catch (_) {}
    }
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  disconnect() {
    this.connected = false;
    try {
      this.recognition.stop();
    } catch (_) {}
  }
}

window.BrowserSpeechClient = BrowserSpeechClient;
