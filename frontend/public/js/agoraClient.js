/**
 * Agora Client
 *
 * Wrapper for Agora RTC Web SDK.
 * Handles channel joining, publishing mic, and subscribing to the agent's audio.
 */

let rtcClient = null;
let localAudioTrack = null;

/**
 * Join an Agora channel and publish microphone audio.
 */
async function joinCall(appId, channel, token, uid) {
  if (!window.AgoraRTC) {
    throw new Error('Agora RTC SDK not loaded');
  }

  rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

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
  localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
  await rtcClient.publish([localAudioTrack]);
  console.log('🎤 Published local audio track');

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
  return !isMuted; // Return new mute state (true = muted)
}

window.addEventListener('beforeunload', () => { if (localAudioTrack) { localAudioTrack.stop(); localAudioTrack.close(); } });
