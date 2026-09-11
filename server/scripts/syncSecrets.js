const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
let envContent = fs.readFileSync(envPath, 'utf8');

try {
  const sarvamKey = execSync('gcloud secrets versions access latest --secret=dealforge-sarvam-api-key --project=dealforge-507515', { encoding: 'utf8' }).trim();
  if (sarvamKey) {
    if (envContent.includes('SARVAM_API_KEY=')) {
      envContent = envContent.replace(/SARVAM_API_KEY=.*/, `SARVAM_API_KEY="${sarvamKey}"`);
    } else {
      envContent += `\nSARVAM_API_KEY="${sarvamKey}"`;
    }
    console.log('✓ Successfully wrote SARVAM_API_KEY to server/.env (length: ' + sarvamKey.length + ')');
  }
} catch (e) {
  console.error('Failed to access sarvam secret:', e.message);
}

try {
  const openAiKey = execSync('gcloud secrets versions access latest --secret=dealforge-openai-api-key --project=dealforge-507515', { encoding: 'utf8' }).trim();
  if (openAiKey) {
    if (envContent.includes('OPENAI_API_KEY=')) {
      envContent = envContent.replace(/OPENAI_API_KEY=.*/, `OPENAI_API_KEY="${openAiKey}"`);
    } else {
      envContent += `\nOPENAI_API_KEY="${openAiKey}"`;
    }
    console.log('✓ Successfully wrote OPENAI_API_KEY to server/.env (length: ' + openAiKey.length + ', prefix: ' + openAiKey.slice(0, 7) + '...)');
  }
} catch (e) {
  console.error('Failed to access openai secret:', e.message);
}

// Set VOICE_PROVIDER default to openai_realtime as requested in Rule #3
if (envContent.includes('VOICE_PROVIDER=')) {
  envContent = envContent.replace(/VOICE_PROVIDER=.*/, `VOICE_PROVIDER="openai_realtime"`);
} else {
  envContent += `\nVOICE_PROVIDER="openai_realtime"`;
}

fs.writeFileSync(envPath, envContent);
console.log('✓ server/.env updated. VOICE_PROVIDER="openai_realtime"');
