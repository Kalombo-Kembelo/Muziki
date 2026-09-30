import { BadRequestException, Body, Controller, Post, UnauthorizedException } from "@nestjs/common";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { PrismaService } from "./prisma.service.js";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  private hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
    const derived = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${derived}`;
  }

  private passwordMatches(password: string, savedHash: string) {
    const [salt, expected] = savedHash.split(":");
    if (!salt || !expected) return false;
    const received = scryptSync(password, salt, 64).toString("hex");
    return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  }

  private createSessionToken(userId: string, role: string) {
    const secret = process.env.JWT_SECRET || "development-only-change-me";
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: userId, role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 })).toString("base64url");
    const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
    return `${header}.${payload}.${signature}`;
  }

  @Post("login")
  async login(@Body() body: { email?: string; password?: string }) {
    const email = String(body.email || "").toLowerCase();
    const user = await this.prisma.user.findFirst({ where: { email } });
    if (!user || !this.passwordMatches(String(body.password || ""), user.passwordHash)) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const token = this.createSessionToken(user.id, user.role);
    const session = await this.prisma.session.create({
      data: { userId: user.id, token }
    });
    return { user, session };
  }

  @Post("register")
  async register(@Body() body: { fullName?: string; email?: string; password?: string; phone?: string; payoutPhone?: string; role?: "listener" | "artist" }) {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email.includes("@") || password.length < 8) {
      throw new BadRequestException("A valid email and a password of at least 8 characters are required");
    }
    const role = body.role === "artist" ? "artist" : "listener";
    const user = {
      id: `user-${Date.now()}`,
      fullName: String(body.fullName || "New User"),
      email,
      phone: String(body.phone || "").trim() || null,
      role,
      passwordHash: this.hashPassword(password)
    };
    const savedUser = await this.prisma.user.create({ data: user });
    if (savedUser.role === "artist") {
      await this.prisma.artist.create({
        data: {
          userId: savedUser.id,
          name: savedUser.fullName,
          genre: "Unknown",
          city: "Kinshasa",
          payoutPhone: String(body.payoutPhone || body.phone || "").trim() || null,
          verified: false,
          followersCount: 0,
          walletBalanceCdf: 0n
        }
      });
    }
    const token = this.createSessionToken(savedUser.id, savedUser.role);
    const session = await this.prisma.session.create({ data: { userId: savedUser.id, token } });
    return { user: savedUser, session };
  }
}
