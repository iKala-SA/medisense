# Medisense

Enterprise AI portal for hospitals: a React front end on Firebase Hosting and the TCVGH Agent Platform back end
(FastAPI on Cloud Run, Firestore, LiteLLM, Firebase Auth) in Google Cloud project `cloud-sa-sandbox-1`.

```
frontend/   React 19 + Vite portal (Qwen-style UI, Medisense jellyfish). Deploys to Firebase Hosting site `medisense-portal`.
backend/    TCVGH Agent Platform: FastAPI API + agent runtime, LiteLLM gateway config, gcloud infra scripts, design docs.
```

`frontend/` calls the platform at `/api/**`; Firebase Hosting rewrites that path to the Cloud Run service `tcvgh-platform-api`
(see `frontend/firebase.json`). The API contract the front end codes against is `backend/mvp/INTEGRATION-API.md`.

## Front end (`frontend/`)

```sh
cd frontend
npm ci
npm run dev           # mock mode: self-contained prototype, no backend or sign-in
npm run dev:preview   # live pages with seeded in-memory data, no sign-in (design review)
npm run dev:live      # real platform: needs frontend/.env.live (see .env.example) and a Google Workspace sign-in
npm run build         # + npm run test:sites
npm run build:live && firebase deploy --only hosting:medisense-portal --project cloud-sa-sandbox-1
```

Mock mode is the default. Real mode needs `VITE_MOCK_API=0` and the `VITE_FIREBASE_*` values. Notes for contributors are in
`frontend/AGENTS.md`.

## Back end (`backend/`)

Layout, provisioning and deploy steps are in `backend/mvp/README.md`. Quick local check (offline, no cloud access needed):

```sh
cd backend/mvp/backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt pytest httpx
pytest
```

Deploying uses `backend/mvp/infra/*.sh` (`source infra/env.sh` first). The legacy builder UI under `backend/mvp/frontend` and its
workflow `backend/.github/workflows/firebase-hosting.yml` are the platform team's original front end; they are kept for reference and
do not run from this repository.

## Do not commit

Secrets, `.env*` files (except `.env.example`), `node_modules`, `dist`.
