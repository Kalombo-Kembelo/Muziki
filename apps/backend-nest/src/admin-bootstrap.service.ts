import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const email = String(process.env.MUZIKI_ADMIN_EMAIL || "").trim().toLowerCase();
    const password = String(process.env.MUZIKI_ADMIN_PASSWORD || "");
    if (!email || password.length < 8) {
      this.logger.warn("No deployment admin account configured. Set MUZIKI_ADMIN_EMAIL and MUZIKI_ADMIN_PASSWORD.");
      return;
    }
    if (await this.prisma.user.findUnique({ where: { email } })) return;
    const salt = randomBytes(16).toString("hex");
    const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    await this.prisma.user.create({
      data: { id: `admin-${Date.now()}`, fullName: "Muziki Administrator", email, role: "admin", passwordHash }
    });
    this.logger.log(`Created deployment administrator ${email}`);
  }
}
