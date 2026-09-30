# API Contracts

## Health

- `GET /health`

## Bootstrap

- `GET /api/bootstrap`

## Manifest

- `GET /api/manifest`

## Auth

- `POST /api/auth/login`
- `POST /api/auth/register`

## Catalog

- `GET /api/artists`
- `POST /api/artists`
- `POST /api/artists/:id/verify`
- `POST /api/artists/:id/reject`
- `GET /api/songs`
- `POST /api/songs`
- `GET /api/search?q=...`

`POST /api/songs` accepts these fields:

- `title`
- `artistId`
- `artist`
- `genre`
- `priceCdf`
- `duration`
- `audioPath`
- `coverPath`
- `audioData` as a base64 data URL or raw base64 string
- `audioName`
- `coverData` as a base64 data URL or raw base64 string
- `coverName`

When `audioData` or `coverData` is present, local development backends write files to `storage/audio` or `storage/covers` and return `/audio/...` or `/covers/...` paths.

## Commerce

- `GET /api/purchases`
- `POST /api/purchases`
- `POST /api/purchases/:id/proof`
- `POST /api/purchases/:id/approve`
- `POST /api/purchases/:id/reject`
- `GET /api/withdrawals`
- `POST /api/withdrawals`
- `POST /api/downloads`

`POST /api/purchases` creates a pending mobile-money purchase request and stores the operator, payer phone, merchant phone, and optional transfer reference.

`POST /api/purchases/:id/proof` updates an existing request with transfer proof and marks it `pending_review`.

`POST /api/purchases/:id/approve` marks the request as `completed` and credits the artist wallet.

`POST /api/purchases/:id/reject` marks the request as `failed`.

`POST /api/withdrawals` creates a requested withdrawal and reserves the amount from the artist wallet.

## Manual Payments

The current app flow does not depend on payment-provider APIs.

The buyer selects an operator, enters the payer phone number, and the backend records a pending purchase request. The mobile admin app then approves or rejects it after checking the transfer.

A legacy checkout adapter still exists in the backend compatibility code, but the active product flow uses manual mobile-money approval.

## Operations

- `GET /api/notifications`
- `GET /api/claims`
- `POST /api/claims`
- `GET /api/playlists`
- `POST /api/playlists`
- `GET /api/playlist-songs`
- `POST /api/playlist-songs`
- `DELETE /api/playlist-songs`
- `GET /api/favorites`
- `POST /api/favorites`
- `DELETE /api/favorites?userId=...&songId=...`
- `GET /api/followers`
- `POST /api/followers`
- `POST /api/followers/toggle`
- `DELETE /api/followers?followerUserId=...&artistId=...`
- `GET /api/downloads`

Follower create, toggle, and delete routes keep artist follower counts in sync.
