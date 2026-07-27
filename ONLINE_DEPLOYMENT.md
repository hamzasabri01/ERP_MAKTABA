# ProERP Online Deployment

This setup keeps the main database local and publishes only the React frontend online.

## Architecture

- Frontend: Firebase Hosting.
- Public variables: Firestore document `app_config/public`.
- Backend API: FastAPI running locally on your server/PC.
- Main database: local SQLite file `backend/proerp.db` or another local DB configured by `DATABASE_URL`.

## Firebase public variables

Create this Firestore document:

`app_config/public`

Recommended fields:

```text
api_base_url: "https://your-backend-domain.example.com/api"
maintenance_mode: false
app_version: "1.0.0"
```

Only `api_base_url` is required for the hosted frontend to talk to your local backend.

## Frontend env

The project is already configured for:

```text
Project name: App ERP
Project id: app-erp-622bc
Project number: 223793044005
Messaging sender id: 223793044005
```

`frontend/.env` is already created. If you create a Firebase Web App later, paste its Web API key into:

```env
VITE_FIREBASE_API_KEY=your-web-api-key
VITE_FIREBASE_CONFIG_COLLECTION=app_config
VITE_FIREBASE_CONFIG_DOC=public
```

`VITE_FIREBASE_API_KEY` is a public web key. Firestore writes are blocked by `firestore.rules`.

## Backend env

`backend/.env` is already created for local DB + Firebase Hosting CORS:

```env
SECRET_KEY=change-this-long-random-secret
DATABASE_URL=sqlite:///./proerp.db
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://app-erp-622bc.web.app,https://app-erp-622bc.firebaseapp.com
```

Keep secrets only in `backend/.env`.

## Publish frontend

```bash
cd frontend
npm run build
cd ..
firebase deploy --only hosting,firestore:rules
```

Or run:

```powershell
.\scripts\deploy-firebase.ps1
```

## Expose local backend

Use one HTTPS endpoint for the local backend, for example:

- Cloudflare Tunnel
- a reverse proxy on a fixed domain
- a VPN/private network if this is internal only

Point the public URL to FastAPI on port `8000`, then put:

```text
https://your-backend-domain.example.com/api
```

in Firestore field `api_base_url`.

A starter document is available at:

```text
firebase-app-config.public.json
```

## Important

- Do not put database credentials, JWT secrets, SMTP passwords, or admin passwords in Firebase.
- Back up `backend/proerp.db` regularly.
- Keep the backend machine online for users to access the app.
