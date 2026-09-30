import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaService } from "./prisma.service.js";

type CheckoutInput = {
  songId?: string;
  userId?: string;
  method?: string;
  amountCdf?: number;
  returnUrl?: string;
};

type WebhookBody = Record<string, unknown> & {
  reference?: string;
  providerReference?: string;
  transactionReference?: string;
  status?: string;
  paymentStatus?: string;
  method?: string;
  amountCdf?: number | string;
  signature?: string;
};

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private env(name: string, fallback = "") {
    return String(process.env[name] || fallback);
  }

  private callbackUrl() {
    return this.env("FLEXPAIE_CALLBACK_URL", "http://localhost:3000/api/payments/flexpaie/webhook");
  }

  private normalizeText(value: unknown, fallback = "") {
    const text = String(value ?? fallback).trim();
    return text || fallback;
  }

  private normalizeAmount(value: unknown, fallback = 0) {
    const amount = typeof value === "number" ? value : Number(String(value ?? fallback));
    return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : fallback;
  }

  private buildPlaceholderUrl(template: string, values: Record<string, string>) {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => encodeURIComponent(values[key] ?? ""));
  }

  private createReference() {
    return `flexpaie-${randomUUID().replace(/-/g, "")}`;
  }

  private extractStatus(value: unknown) {
    const status = this.normalizeText(value, "pending").toLowerCase();
    if (["completed", "complete", "success", "succeeded", "paid", "successfully_paid"].includes(status)) return "completed";
    if (["failed", "fail", "canceled", "cancelled", "rejected", "expired", "error"].includes(status)) return "failed";
    return "pending";
  }

  private extractReference(body: WebhookBody) {
    return this.normalizeText(body.providerReference || body.reference || body.transactionReference, "");
  }

  private verifyWebhookSignature(body: WebhookBody, signature?: string) {
    const secret = this.env("FLEXPAIE_WEBHOOK_SECRET", "");
    if (!secret) return true;
    const provided = this.normalizeText(signature || body.signature, "");
    if (!provided) return false;

    const clone = { ...body };
    delete clone.signature;
    const payload = JSON.stringify(clone);
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  }

  private async findSongAndUser(songId?: string, userId?: string) {
    const requestedSongId = this.normalizeText(songId, "");
    const song = requestedSongId
      ? await this.prisma.song.findUnique({ where: { id: requestedSongId } })
      : null;
    const fallbackSong = song ?? await this.prisma.song.findFirst();
    const requestedUserId = this.normalizeText(userId, "");
    const user = requestedUserId
      ? await this.prisma.user.findUnique({ where: { id: requestedUserId } })
      : null;
    const fallbackUser = user ?? await this.prisma.user.findFirst();
    if (!fallbackSong || !fallbackUser) {
      throw new BadRequestException("Missing song or user");
    }
    return { song: fallbackSong, user: fallbackUser };
  }

  async createFlexpaieCheckout(input: CheckoutInput) {
    const { song, user } = await this.findSongAndUser(input.songId, input.userId);
    const amountCdf = this.normalizeAmount(input.amountCdf, song.priceCdf || 0);
    const providerReference = this.createReference();
    const purchaseId = `purchase-${providerReference}`;
    const method = this.normalizeText(input.method, "Manual mobile money");
    const checkoutUrlTemplate = this.env("FLEXPAIE_CHECKOUT_URL_TEMPLATE", "");
    const checkoutUrl = checkoutUrlTemplate
      ? this.buildPlaceholderUrl(checkoutUrlTemplate, {
          merchantCode: this.env("FLEXPAIE_MERCHANT_CODE", ""),
          reference: providerReference,
          purchaseId,
          amountCdf: String(amountCdf),
          currency: "CDF",
          callbackUrl: this.callbackUrl(),
          returnUrl: this.normalizeText(input.returnUrl, ""),
          description: `${song.title} - ${song.artist}`,
          songTitle: song.title,
          artistName: song.artist,
          userName: user.fullName,
          userEmail: user.email,
          userPhone: user.phone ?? "",
          method
        })
      : "";

    const purchase = await this.prisma.purchase.create({
      data: {
        id: purchaseId,
        songId: song.id,
        userId: user.id,
        method,
        amountCdf,
        status: "pending",
        provider: "flexpaie",
        providerReference,
        checkoutUrl
      }
    });

    return {
      purchase,
      checkoutUrl,
      provider: "flexpaie",
      providerReference
    };
  }

  async getPurchaseByReference(reference: string) {
    const providerReference = this.normalizeText(reference, "");
    const purchase = await this.prisma.purchase.findFirst({
      where: {
        OR: [{ providerReference }, { id: providerReference }]
      }
    });
    if (!purchase) {
      throw new NotFoundException("Payment not found");
    }
    return purchase;
  }

  async handleFlexpaieWebhook(body: WebhookBody, signature?: string) {
    if (!this.verifyWebhookSignature(body, signature)) {
      throw new UnauthorizedException("Invalid webhook signature");
    }

    const providerReference = this.extractReference(body);
    if (!providerReference) {
      throw new BadRequestException("Missing payment reference");
    }

    const purchase = await this.prisma.purchase.findFirst({
      where: {
        OR: [{ providerReference }, { id: providerReference }]
      },
      include: { song: true }
    });

    if (!purchase) {
      throw new NotFoundException("Purchase not found");
    }

    const nextStatus = this.extractStatus(body.status || body.paymentStatus);
    const method = this.normalizeText(body.method, purchase.method);
    const updatedFields: Record<string, unknown> = { method };

    if (nextStatus === "completed") {
      updatedFields.status = "completed";
      updatedFields.paidAt = purchase.paidAt ?? new Date();
    } else if (nextStatus === "failed") {
      updatedFields.status = "failed";
    } else if (purchase.status === "pending") {
      updatedFields.status = "pending";
    }

    const updatedPurchase = await this.prisma.$transaction(async (tx) => {
      const nextPurchase = await tx.purchase.update({
        where: { id: purchase.id },
        data: updatedFields
      });

      if (nextStatus === "completed" && purchase.status !== "completed") {
        const artistEarnings = Math.floor((purchase.amountCdf * purchase.song.artistShareBps) / 10000);
        await tx.artist.update({
          where: { id: purchase.song.artistId },
          data: { walletBalanceCdf: { increment: BigInt(artistEarnings) } }
        });
      }

      return nextPurchase;
    });

    return updatedPurchase;
  }
}
