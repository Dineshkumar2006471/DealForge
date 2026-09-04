// Public runtime configuration. This contains endpoints only; secrets remain server-side.
// Override before this script to point another environment at its own HTTPS Cloud Run service.
window.DEALFORGE_API_URL = window.DEALFORGE_API_URL || 'https://dealforge-core-6li7mfkrtq-uc.a.run.app/api';
