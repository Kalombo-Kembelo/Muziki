# DRC Music Platform

Separate app scaffold based on the provided roadmap.

## Target Architecture

- Listener mobile app: Flutter
- Backend API: Node compatibility backend plus NestJS/PostgreSQL target backend
- Database: PostgreSQL
- Cache: Redis
- Storage: object storage for audio, covers, and images
- Web portals: Listener, artist, and administrator

## Initial Product Scope

- Artist verification
- Music upload and storage
- Search and streaming
- Mobile Money payments
- Manual mobile-money approval flow
- Purchase tracking
- Download entitlement
- Artist earnings and withdrawals
- Admin moderation and copyright claims

## Repo Layout

- `apps/backend` - Backend API service
- `apps/backend-nest` - NestJS target scaffold
- `apps/artist-portal` - Separate web portal for artists
- `apps/listener-portal` - Separate web portal for listeners
- `apps/mobile` - Flutter listener mobile app
- `apps/admin-portal` - Web administrator portal
- `packages/shared` - Shared types and utilities
- `docs` - Product and implementation notes
- `docker-compose.yml` - PostgreSQL and Redis stack

## Next Steps

1. Verify the Nest/PostgreSQL backend on a local install.
2. Replace any remaining compatibility assumptions with database-backed flows.
3. Replace local upload storage with production object storage when deploying.
4. Connect deployment for the separate apps.

## Running

See [docs/run.md](C:/Users/Kalombo%20Kembelo/Documents/Muziki/docs/run.md) for local run instructions.

For the PostgreSQL backend scaffold, the sequence is:

1. `npm install`
2. `npm run prisma:generate`
3. `npm run prisma:migrate`
4. `npm run seed:backend-nest`
5. `npm run dev:backend-nest`
6. `npm run serve:artist-portal`
7. `npm run serve:listener-portal`
