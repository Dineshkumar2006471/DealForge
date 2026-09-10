/**
 * Agora Client
 *
 * Wrapper for Agora RTC Web SDK.
 * Handles channel joining, publishing mic, and subscribing to the agent's audio.
 */

let rtcClient = null;
let localAudioTrack = null;
let micActivityLogged = false;

/**
 * Join an Agora channel and publish microphone audio.
 */
async function acquireLocalTrack() {
  if (!window.AgoraRTC) return null;
  if (!localAudioTrack) {
    try {
      localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: 'speech_standard',
        AEC: true,
        ANS: false,
        AGC: true
      });
      console.log('[MIC_PERMISSION_GRANTED] Browser microphone permission granted.');
      console.log('[MIC_TRACK_CREATED] Local microphone track created (speech_standard).');
      if (localAudioTrack && typeof localAudioTrack.setVolume === 'function') {
        localAudioTrack.setVolume(200);
      }
      console.log('[MIC_TRACK_ENABLED]', localAudioTrack.enabled);
    } catch (err) {
      console.error('[MIC_PERMISSION_DENIED] Microphone access failed:', err.name || err.code || err.message);
      throw err;
    }
  }
  return localAudioTrack;
}

function getLocalVolume() {
  return localAudioTrack ? localAudioTrack.getVolumeLevel() : 0;
}

async function joinCall(appId, channel, token, uid, preAcquiredTrack = null) {
  if (!window.AgoraRTC) {
    throw new Error('Agora RTC SDK not loaded');
  }

  rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
  micActivityLogged = false;

  // Set up event listeners before joining
  rtcClient.on('user-published', async (user, mediaType) => {
    try {
      console.log('User published:', user.uid);
      await rtcClient.subscribe(user, mediaType);
      if (mediaType === 'audio') {
        await Promise.resolve(user.audioTrack.play());
        // These browser events are evidence of track publication/playback, not a
        // claim that the listener heard every syllable.
        window.dispatchEvent(new CustomEvent('agora:agent-audio-playing', { detail: { uid: user.uid } }));
        window.dispatchEvent(new CustomEvent('agora:agent-speaking', { detail: { uid: user.uid } }));
      }
    } catch (error) {
      console.error('Agent audio playback failed:', error);
      window.dispatchEvent(new CustomEvent('agora:agent-audio-failed', { detail: { message: error.message || 'Audio playback failed' } }));
    }
  });

  rtcClient.on('user-unpublished', (user, mediaType) => {
    console.log('User unpublished:', user.uid);
    if (mediaType === 'audio') {
      window.dispatchEvent(new CustomEvent('agora:agent-stopped-speaking', { detail: { uid: user.uid } }));
    }
  });

  // Join the channel
  await rtcClient.join(appId, channel, token, uid);
  console.log(`✅ Joined Agora channel: ${channel}`);

  // Create and publish local audio track (microphone)
  // Use pre-acquired track if available (critical for mobile Safari user-activation)
  if (preAcquiredTrack) {
    localAudioTrack = preAcquiredTrack;
  } else if (!localAudioTrack) {
    try {
      localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: 'speech_standard',
        AEC: true,
        ANS: false,
        AGC: true
      });
      console.log('[MIC_PERMISSION_GRANTED] Browser microphone permission granted during join.');
      console.log('[MIC_TRACK_CREATED] Local microphone track created (speech_standard).');
    } catch (err) {
      console.error('[MIC_PERMISSION_DENIED] Microphone track creation failed during join:', err);
      throw new Error('Microphone access is unavailable. Please grant microphone permission in your browser.');
    }
  }
  if (!localAudioTrack) {
    throw new Error('Microphone access is unavailable. Please grant microphone permission in your browser.');
  }
  if (localAudioTrack && typeof localAudioTrack.setVolume === 'function') {
    localAudioTrack.setVolume(200);
  }
  console.log('[MIC_TRACK_ENABLED]', localAudioTrack.enabled);

  await rtcClient.publish([localAudioTrack]);
  console.log('[MIC_TRACK_PUBLISHED] Local audio track published to channel:', channel, { enabled: localAudioTrack.enabled, muted: localAudioTrack.muted });

  try {
    rtcClient.enableAudioVolumeIndicator();
    rtcClient.on('volume-indicator', volumes => {
      volumes.forEach(v => {
        if (v.uid === 0 || v.uid === uid) {
          if (v.level > 10 && !micActivityLogged) {
            micActivityLogged = true;
            console.log('[MIC_AUDIO_ACTIVITY_DETECTED] Local microphone activity detected:', v.level);
          }
          window.dispatchEvent(new CustomEvent('agora:local-volume', { detail: { level: v.level } }));
        }
      });
    });
  } catch (volErr) {
    console.warn('Volume indicator setup note:', volErr);
  }

  return { client: rtcClient, localAudioTrack };
}

async function renewToken(token) {
  if (!rtcClient) throw new Error('No active Agora call');
  await rtcClient.renewToken(token);
}

/**
 * Leave the channel and clean up.
 */
async function leaveCall() {
  if (localAudioTrack) {
    localAudioTrack.stop();
    localAudioTrack.close();
    localAudioTrack = null;
  }

  if (rtcClient) {
    await rtcClient.leave();
    rtcClient = null;
    console.log('👋 Left Agora channel');
  }
}

/**
 * Toggle local microphone mute state.
 */
function toggleMute() {
  if (!localAudioTrack) return false;

  const isMuted = !localAudioTrack.enabled;
  localAudioTrack.setEnabled(isMuted);
  console.log('[MIC_TRACK_ENABLED]', localAudioTrack.enabled);
  return !isMuted; // Return new mute state (true = muted)
}

window.addEventListener('beforeunload', () => { if (localAudioTrack) { localAudioTrack.stop(); localAudioTrack.close(); } });
