// Public runtime configuration. This contains endpoints only; secrets remain server-side.
// Override before this script to point another environment at its own HTTPS Cloud Run service.
window.DEALFORGE_API_URL = window.DEALFORGE_API_URL || 'https://dealforge-core-442569512705.us-central1.run.app/api';
