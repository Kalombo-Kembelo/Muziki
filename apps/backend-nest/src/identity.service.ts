import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PrismaService } from "./prisma.service.js";

type Identity = { id: string; role: string };

@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  private verifyToken(token: string): Identity {
    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) throw new UnauthorizedException("Invalid access token");
    const secret = process.env.JWT_SECRET || "development-only-change-me";
    const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
    if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
      throw new UnauthorizedException("Invalid access token");
    }
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; role?: string; exp?: number };
    if (!claims.sub || !claims.role || !claims.exp || claims.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException("Expired access token");
    }
    return { id: claims.sub, role: claims.role };
  }

  async require(authorization?: string, roles?: string[]) {
    const token = String(authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new UnauthorizedException("Sign in is required");
    const identity = this.verifyToken(token);
    const session = await this.prisma.session.findFirst({ where: { userId: identity.id, token } });
    if (!session) throw new UnauthorizedException("Session is not active");
    if (roles && !roles.includes(identity.role)) throw new ForbiddenException("This action is not allowed for this account");
    return identity;
  }
}
