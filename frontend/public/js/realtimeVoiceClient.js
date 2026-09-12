/**
 * OpenAI Realtime WebRTC Voice Client
 *
 * Establishes an ephemeral WebRTC connection directly to OpenAI Realtime API.
 * Uses Server VAD for turn detection and Whisper-1 for speech transcription.
 * The primary OpenAI API key is NEVER present in the browser.
 */

class RealtimeVoiceClient {
  constructor({ clientSecret, model }) {
    if (!model) throw new Error('RealtimeVoiceClient requires a model from the server credential response');
    this.clientSecret = clientSecret;
    this.model = model;
    this.peerConnection = null;
    this.dataChannel = null;
    this.localStream = null;
    this.audioTrack = null;
    this.connected = false;
    this.muted = false;
    this.activeTranscript = '';
  }

  async connect(existingTrack = null) {
    if (this.connected) return;

    // 1. Acquire microphone if not already provided
    if (existingTrack) {
      this.audioTrack = existingTrack;
    } else {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      this.audioTrack = this.localStream.getAudioTracks()[0];
    }

    if (!this.audioTrack) {
      throw new Error('No microphone audio track available');
    }

    // 2. Initialize RTCPeerConnection
    this.peerConnection = new RTCPeerConnection();

    // Add local microphone audio track to WebRTC connection
    this.peerConnection.addTrack(this.audioTrack);

    // 3. Create data channel for Realtime events
    this.dataChannel = this.peerConnection.createDataChannel('oai-events');
    this.setupDataChannelEvents();

    // 4. Create SDP offer
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    // 5. Send offer to OpenAI Realtime GA calls endpoint using ephemeral clientSecret
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.clientSecret}`,
        'Content-Type': 'application/sdp'
      },
      body: offer.sdp
    });

    if (!response.ok) {
      let errorDetails = '';
      try {
        const errJson = await response.json();
        errorDetails = errJson.error?.message || errJson.error?.code || JSON.stringify(errJson);
      } catch (_) {
        try {
          errorDetails = await response.text();
        } catch (__) {
          errorDetails = response.statusText;
        }
      }
      console.error('[RealtimeVoiceClient] WebRTC SDP negotiation failed:', {
        endpoint: '/v1/realtime/calls',
        status: response.status,
        model: this.model,
        error: errorDetails
      });
      throw new Error(`OpenAI Realtime WebRTC connection failed (${response.status}): ${errorDetails || response.statusText}`);
    }

    const answerSdp = await response.text();

    // 6. Set remote description with OpenAI SDP answer
    await this.peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp
    });

    this.connected = true;
    window.dispatchEvent(new CustomEvent('voice:connected', { detail: { provider: 'openai_realtime' } }));
  }

  setupDataChannelEvents() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('[RealtimeVoiceClient] WebRTC DataChannel opened');
      // Send GA-compliant session.update to ensure Server VAD and Whisper transcription are active
      this.sendClientEvent({
        type: 'session.update',
        session: {
          type: 'realtime',
          audio: {
            input: {
              transcription: {
                model: 'whisper-1'
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
                create_response: false
              }
            }
          }
        }
      });
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleServerEvent(message);
      } catch (err) {
        console.warn('[RealtimeVoiceClient] Unparseable message:', event.data);
      }
    };

    this.dataChannel.onerror = (err) => {
      console.error('[RealtimeVoiceClient] DataChannel error:', err);
      window.dispatchEvent(new CustomEvent('voice:error', { detail: { error: err } }));
    };

    this.dataChannel.onclose = () => {
      console.log('[RealtimeVoiceClient] DataChannel closed');
    };
  }

  handleServerEvent(event) {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        console.log('[RealtimeVoiceClient] Speech started');
        this.activeTranscript = '';
        window.dispatchEvent(new CustomEvent('voice:speech-started'));
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[RealtimeVoiceClient] Speech stopped');
        window.dispatchEvent(new CustomEvent('voice:speech-stopped'));
        break;

      case 'conversation.item.input_audio_transcription.delta':
        if (event.delta) {
          this.activeTranscript += event.delta;
          window.dispatchEvent(new CustomEvent('voice:transcript-delta', { detail: { delta: event.delta, text: this.activeTranscript } }));
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        console.log('[RealtimeVoiceClient] Transcription completed:', event.transcript);
        const finalTranscript = (event.transcript || this.activeTranscript || '').trim();
        if (finalTranscript) {
          window.dispatchEvent(new CustomEvent('voice:turn-completed', { detail: { transcript: finalTranscript } }));
        }
        this.activeTranscript = '';
        break;

      case 'error':
        console.error('[RealtimeVoiceClient] Server error event:', event.error);
        window.dispatchEvent(new CustomEvent('voice:error', { detail: { error: event.error } }));
        break;

      default:
        break;
    }
  }

  sendClientEvent(event) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(event));
    } else {
      console.warn('[RealtimeVoiceClient] Cannot send event, dataChannel not ready');
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.audioTrack) {
      this.audioTrack.enabled = !this.muted;
    }
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  disconnect() {
    this.connected = false;
    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch (_) {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch (_) {}
      this.peerConnection = null;
    }
    if (this.localStream) {
      try { this.localStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      this.localStream = null;
    }
    if (this.audioTrack) {
      try { this.audioTrack.stop(); } catch (_) {}
      this.audioTrack = null;
    }
  }
}

window.RealtimeVoiceClient = RealtimeVoiceClient;
