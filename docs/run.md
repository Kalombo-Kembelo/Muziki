# Running The Separate Apps

## Node Compatibility Backend

- `cd apps/backend`
- `node src/main.js`
- Use this only for the lightweight compatibility backend.

## NestJS Scaffold

- `cd apps/backend-nest`
- Copy `.env.example` to `.env`
- Set the merchant phone variables for the operators you own:
  - `DRC_VODACOM_MERCHANT_PHONE`
  - `DRC_AIRTEL_MERCHANT_PHONE`
  - `DRC_ORANGE_MERCHANT_PHONE`
  - `DRC_AFRICELL_MERCHANT_PHONE`
- Run `docker compose up -d`
- Install dependencies with `npm install`
- Run `npm run prisma:generate`
- Run `npm run prisma:migrate`
- Run `npm run prisma:seed`
- Start the app with `npm run start:dev`
- Use this as the target backend layout for the PostgreSQL implementation and primary backend path

## Artist Portal

- Run `npm run serve:artist-portal`
- Open `http://127.0.0.1:4173`
- If the backend is running at `http://localhost:3000`, the portal will load live bootstrap data

## Listener Portal

- Run `npm run serve:listener-portal`
- Open `http://127.0.0.1:4175`
- If the backend is running, the portal will load live bootstrap data

## Mobile App

- Open `apps/mobile` in Flutter
- Run `flutter pub get`
- Run `flutter run`
- For Windows desktop, the app uses `http://localhost:3000` by default
- For Android emulator, run with `flutter run --dart-define=MUZIKI_API_BASE=http://10.0.2.2:3000`

## Optional Backend Base

- The portals remember a backend base URL in local storage
- Use the `API` button in the top bar to point the portals at another backend
- You can still set `window.MUZIKI_API_BASE = "http://localhost:3000"` before loading the portals if you deploy them under another origin

## Manual Payments

- The listener web portal creates a pending purchase request with operator and payer phone
- The mobile admin app shows the request, the item, the amount, and the merchant number
- When you verify the transfer, approve it from the mobile app to unlock the track for that account
- If you want to keep the purchase visible without approving immediately, leave it in `pending` or `pending_review`

## Render

- Use the `render.yaml` blueprint at the repo root to create the backend, listener portal, artist portal, and Postgres database in one pass
- The backend service needs the persistent disk because uploaded audio and cover files are stored locally
- After deploy, copy the backend Render URL into the portals with the `API` button the first time you open them
- The listener portal and artist portal are static sites, so they do not need a separate server process

## Database Stack

- Run `docker compose up -d` to start PostgreSQL and Redis

## Local Storage

- Use `storage/audio` for uploaded audio during local development
- Use `storage/covers` for cover images during local development
- The artist portal can send selected files to `POST /api/songs` as base64 JSON fields
- Saved files are served by the backend as `/audio/<file>` and `/covers/<file>`
- Set `MUZIKI_STORAGE_ROOT` to override the storage directory for the NestJS backend
