# NestJS Migration Plan

1. Install `@nestjs/core`, `@nestjs/common`, `reflect-metadata`, `rxjs`, `class-validator`, `class-transformer`, `prisma` or `typeorm`, and the PostgreSQL client.
2. Copy the existing API routes into Nest controllers and services.
3. Extend the Prisma-backed repositories and models as new features land.
4. Replace local upload storage with production object storage during deployment.
5. Keep the route contract stable so the mobile app and portals do not need another rewrite.
