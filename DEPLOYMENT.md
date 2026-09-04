# Staging deployment

Deploy only to a new Firebase/GCP staging project before using production.

1. Create a Firebase project with Firestore and Authentication enabled, then set it as the active Firebase CLI project.
2. Create Secret Manager values for `AGORA_APP_CERTIFICATE`, `AGORA_CUSTOMER_SECRET`, `AGORA_LLM_WEBHOOK_SECRET`, and `CALL_SESSION_WEBHOOK_SIGNING_SECRET`. Use distinct high-entropy values for the last two secrets.
3. Build and deploy Cloud Run from `server`, supplying non-secret configuration (`GCP_PROJECT_ID`, `GCP_REGION`, `AGORA_APP_ID`, `AGORA_CUSTOMER_ID`, `GEMINI_MODEL`, `ALLOWED_ORIGIN`, `PUBLIC_APP_URL`) and mounting the secrets. Set `CLOUD_RUN_URL` to the deployed service URL.
4. Firebase Hosting injects the active project's public web configuration through `/__/firebase/init.js`; deploy Hosting, Firestore rules, and indexes. For local static development only, copy `firebaseConfig.local.example.js` to a gitignored local file and load it before `firebaseConfig.js`.
5. Provision the first manager only after their Firebase Auth account exists:
   `node server/scripts/bootstrap-manager.js manager@example.com YOUR_ORGANIZATION_ID`

Commands:

```powershell
cd server
npm ci
npm test
firebase emulators:exec --only firestore "node --test test/firestore-emulator.test.js"
gcloud builds submit .. --config cloudbuild.yaml
gcloud run deploy dealforge-core --image gcr.io/YOUR_STAGING_PROJECT/dealforge-core:COMMIT_SHA --region us-central1 --allow-unauthenticated
firebase use YOUR_STAGING_PROJECT
firebase deploy --only firestore:rules,firestore:indexes,hosting
```

Agora requires a publicly reachable HTTPS webhook URL. Cloud Run is therefore reachable at the network layer, but every non-health route is application-authenticated: manager routes require Firebase ID tokens, public calls require a high-entropy link token, and Agora requires both the per-session opaque webhook path and the webhook Authorization secret. Add Cloud Armor/rate limiting before broad public launch. Run the real three-window Agora/Gemini staging test before any release claim.
