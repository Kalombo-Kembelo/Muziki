import { BadRequestException, Body, Controller, Post, UnauthorizedException } from "@nestjs/common";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { PrismaService } from "./prisma.service.js";
import { EmailService } from "./email.service.js";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly prisma: PrismaService, private readonly email: EmailService) {}

  private tokenHash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private listenerUrl() {
    return String(process.env.MUZIKI_LISTENER_URL || "http://localhost:4175").replace(/\/$/, "");
  }

  private async issueEmailToken(userId: string, purpose: "verify" | "reset") {
    const raw = randomBytes(32).toString("base64url");
    await this.prisma.emailToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.emailToken.create({
      data: { userId, tokenHash: this.tokenHash(raw), purpose, expiresAt: new Date(Date.now() + (purpose === "verify" ? 24 : 1) * 60 * 60 * 1000) }
    });
    return raw;
  }

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
    if (!user.emailVerifiedAt) throw new UnauthorizedException("Verify your email before signing in. Check your inbox for the confirmation link.");
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
    this.email.assertConfigured();
    const role = body.role === "artist" ? "artist" : "listener";
    const user = {
      id: `user-${Date.now()}`,
      fullName: String(body.fullName || "New User"),
      email,
      phone: String(body.phone || "").trim() || null,
      role,
      passwordHash: this.hashPassword(password)
    };
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException("An account with this email already exists");
    const savedUser = await this.prisma.user.create({ data: { ...user, emailVerifiedAt: null } });
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
    const verificationToken = await this.issueEmailToken(savedUser.id, "verify");
    const link = `${this.listenerUrl()}/?verify=${encodeURIComponent(verificationToken)}`;
    const safeName = savedUser.fullName.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
    try {
      await this.email.send(email, "Confirme ton adresse e-mail - Muziki", `<p>Bonjour ${safeName},</p><p>Confirme ton adresse e-mail pour activer ton compte Muziki.</p><p><a href="${link}">Confirmer mon adresse e-mail</a></p><p>Ce lien expire dans 24 heures.</p>`);
    } catch (error) {
      await this.prisma.user.delete({ where: { id: savedUser.id } });
      throw error;
    }
    return { message: "Account created. Check your email to verify your address before signing in.", requiresEmailVerification: true };
  }

  @Post("verify-email")
  async verifyEmail(@Body() body: { token?: string }) {
    const token = String(body.token || "");
    if (!token) throw new BadRequestException("Verification token is required");
    const record = await this.prisma.emailToken.findFirst({ where: { tokenHash: this.tokenHash(token), purpose: "verify", usedAt: null } });
    if (!record || record.expiresAt < new Date()) throw new BadRequestException("This verification link is invalid or expired");
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
      this.prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })
    ]);
    return { message: "Email verified. You can now sign in." };
  }

  @Post("forgot-password")
  async forgotPassword(@Body() body: { email?: string }) {
    const email = String(body.email || "").trim().toLowerCase();
    if (!email.includes("@")) throw new BadRequestException("Enter a valid email address");
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.emailVerifiedAt) {
      const token = await this.issueEmailToken(user.id, "reset");
      const link = `${this.listenerUrl()}/?reset=${encodeURIComponent(token)}`;
      await this.email.send(email, "Réinitialise ton mot de passe Muziki", `<p>Bonjour ${user.fullName},</p><p>Utilise le lien ci-dessous pour choisir un nouveau mot de passe. Il expire dans une heure.</p><p><a href="${link}">Réinitialiser mon mot de passe</a></p><p>Si tu n'as pas demandé cette réinitialisation, ignore cet e-mail.</p>`);
    }
    return { message: "If an account exists for this email, a password reset link has been sent." };
  }

  @Post("reset-password")
  async resetPassword(@Body() body: { token?: string; password?: string }) {
    const token = String(body.token || "");
    const password = String(body.password || "");
    if (password.length < 8) throw new BadRequestException("Password must be at least 8 characters");
    const record = await this.prisma.emailToken.findFirst({ where: { tokenHash: this.tokenHash(token), purpose: "reset", usedAt: null } });
    if (!record || record.expiresAt < new Date()) throw new BadRequestException("This reset link is invalid or expired");
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.emailToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() }
      });
      if (!claimed.count) throw new BadRequestException("This reset link has already been used or expired");
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash: this.hashPassword(password) } });
      await tx.session.deleteMany({ where: { userId: record.userId } });
    });
    return { message: "Password updated. You can now sign in." };
  }
}
