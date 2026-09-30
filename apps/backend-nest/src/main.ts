import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import path from "node:path";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be configured in production");
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const storageRoot = process.env.MUZIKI_STORAGE_ROOT || path.resolve(process.cwd(), "../../storage");
  const allowedOrigins = String(process.env.MUZIKI_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: false
  });
  app.useBodyParser("json", { limit: "20mb" });
  const requests = new Map<string, { count: number; resetAt: number }>();
  app.use((request: any, response: any, next: () => void) => {
    if (!String(request.path || "").startsWith("/api/")) return next();
    const key = String(request.ip || request.headers["x-forwarded-for"] || "unknown");
    const now = Date.now();
    const entry = requests.get(key);
    const current = !entry || entry.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : entry;
    current.count += 1;
    requests.set(key, current);
    if (current.count > 120) return response.status(429).json({ message: "Too many requests. Try again shortly." });
    response.setHeader("X-RateLimit-Remaining", String(Math.max(0, 120 - current.count)));
    return next();
  });
  app.useStaticAssets(path.join(storageRoot, "covers"), { prefix: "/covers/" });
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
