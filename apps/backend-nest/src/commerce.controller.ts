import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { IdentityService } from "./identity.service.js";
import { PrismaService } from "./prisma.service.js";

@Controller("api")
export class CommerceController {
  constructor(private readonly prisma: PrismaService, private readonly identity: IdentityService) {}

  private merchantPhoneFor(operator?: string) {
    const key = String(operator || "").toLowerCase();
    if (key.includes("vodacom")) return process.env.DRC_VODACOM_MERCHANT_PHONE || "";
    if (key.includes("airtel")) return process.env.DRC_AIRTEL_MERCHANT_PHONE || "";
    if (key.includes("orange")) return process.env.DRC_ORANGE_MERCHANT_PHONE || "";
    if (key.includes("africell")) return process.env.DRC_AFRICELL_MERCHANT_PHONE || "";
    return "";
  }

  private mapWithdrawal(withdrawal: {
    id: string;
    artistId: string;
    payoutPhone: string | null;
    amountCdf: bigint;
    status: string;
    requestedAt: Date;
  }) {
    return {
      id: withdrawal.id,
      artistId: withdrawal.artistId,
      payoutPhone: withdrawal.payoutPhone ?? "",
      amountCdf: Number(withdrawal.amountCdf),
      status: withdrawal.status,
      requestedAt: withdrawal.requestedAt
    };
  }

  @Get("purchases")
  purchases() {
    return this.prisma.purchase.findMany();
  }

  @Post("purchases")
  async createPurchase(@Headers("authorization") authorization: string | undefined, @Body() body: { songId?: string; method?: string; operator?: string; payerPhone?: string; merchantPhone?: string; amountCdf?: number; transferReference?: string }) {
    const identity = await this.identity.require(authorization, ["listener"]);
    const songId = String(body.songId || "");
    const song = await this.prisma.song.findUnique({ where: { id: songId }, include: { artistRecord: true } });
    const user = await this.prisma.user.findUnique({ where: { id: identity.id } });
    if (!song || !user || user.role !== "listener") throw new BadRequestException("A listener and a published song are required");
    if (!song.isPublished || !song.artistRecord.verified) throw new BadRequestException("This song is not available for purchase");
    const amountCdf = song.priceCdf;
    const operator = String(body.operator || body.method || "Mobile Money");
    const merchantPhone = this.merchantPhoneFor(operator);
    if (!merchantPhone) throw new BadRequestException(`No receiving number is configured for ${operator}`);
    if (!String(body.payerPhone || "").trim()) throw new BadRequestException("Payer Mobile Money number is required");
    const purchase = await this.prisma.purchase.create({
      data: {
        songId: song.id,
        userId: user.id,
        method: String(body.method || "Mobile Money"),
        operator,
        payerPhone: String(body.payerPhone || ""),
        merchantPhone,
        transferReference: String(body.transferReference || ""),
        amountCdf,
        status: body.transferReference ? "pending_review" : "pending",
        provider: "manual-mobile-money",
        providerReference: `manual-${Date.now()}`,
        checkoutUrl: "",
        paidAt: null
      }
    });
    const admins = await this.prisma.user.findMany({ where: { role: "admin" } });
    if (admins.length > 0) {
      await this.prisma.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          title: "New payment request",
          message: `${purchase.method} for ${song.title} is waiting for review.`
        }))
      });
    }
    return purchase;
  }

  @Post("purchases/:id/proof")
  async submitPurchaseProof(@Body() body: { transferReference?: string; payerPhone?: string }, @Param("id") id: string) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id } });
    if (!purchase) return { ok: false };
    if (!String(body.transferReference || purchase.transferReference || "").trim()) {
      throw new BadRequestException("A transfer reference is required before review");
    }
    return this.prisma.purchase.update({
      where: { id },
      data: {
        transferReference: String(body.transferReference || purchase.transferReference || ""),
        payerPhone: String(body.payerPhone || purchase.payerPhone || ""),
        status: "pending_review"
      }
    });
  }

  @Post("purchases/:id/approve")
  async approvePurchase(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    await this.identity.require(authorization, ["admin"]);
    const purchase = await this.prisma.purchase.findUnique({ where: { id }, include: { song: true } });
    if (!purchase) return { ok: false };
    if (purchase.status === "completed") return purchase;
    if (purchase.status !== "pending_review") throw new BadRequestException("Payment proof must be submitted before approval");
    const artistEarnings = Math.floor((purchase.amountCdf * purchase.song.artistShareBps) / 10000);
    const [updated] = await this.prisma.$transaction([
      this.prisma.purchase.update({
        where: { id },
        data: {
          status: "completed",
          paidAt: new Date()
        }
      }),
      this.prisma.artist.update({
        where: { id: purchase.song.artistId },
        data: { walletBalanceCdf: { increment: BigInt(artistEarnings) } }
      })
    ]);
    return updated;
  }

  @Post("purchases/:id/reject")
  async rejectPurchase(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    await this.identity.require(authorization, ["admin"]);
    const purchase = await this.prisma.purchase.findUnique({ where: { id } });
    if (!purchase) return { ok: false };
    return this.prisma.purchase.update({
      where: { id },
      data: { status: "failed" }
    });
  }

  @Get("withdrawals")
  async withdrawals() {
    const withdrawals = await this.prisma.withdrawal.findMany();
    return withdrawals.map((withdrawal) => this.mapWithdrawal(withdrawal));
  }

  @Post("withdrawals")
  async createWithdrawal(@Headers("authorization") authorization: string | undefined, @Body() body: { amountCdf?: number; payoutPhone?: string }) {
    const identity = await this.identity.require(authorization, ["artist"]);
    const artist = await this.prisma.artist.findUnique({ where: { userId: identity.id } });
    if (!artist) return { ok: false, error: "Artist not found" };
    const requestedAmount = Number(body.amountCdf || 0);
    const availableAmount = Number(artist.walletBalanceCdf || 0n);
    const minimumWithdrawal = Number(process.env.MUZIKI_MINIMUM_WITHDRAWAL_CDF || 20000);
    const amountCdf = Math.max(0, Math.min(requestedAmount, availableAmount));
    const payoutPhone = String(body.payoutPhone || artist.payoutPhone || "").trim();
    if (!payoutPhone) return { ok: false, error: "Receiving Mobile Money number required" };
    if (amountCdf < minimumWithdrawal) return { ok: false, error: `Minimum withdrawal is ${minimumWithdrawal} CDF` };
    const [withdrawal] = await this.prisma.$transaction([
      this.prisma.withdrawal.create({
        data: {
          artistId: artist.id,
          payoutPhone,
          amountCdf: BigInt(amountCdf),
          status: "requested"
        }
      }),
      this.prisma.artist.update({
        where: { id: artist.id },
        data: { walletBalanceCdf: { decrement: BigInt(amountCdf) } }
      })
    ]);
    return this.mapWithdrawal(withdrawal);
  }

  @Post("withdrawals/:id/paid")
  async markWithdrawalPaid(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    await this.identity.require(authorization, ["admin"]);
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!withdrawal) return { ok: false };
    const settledWithdrawal = await this.prisma.withdrawal.update({
      where: { id },
      data: { status: "paid", paidAt: new Date() }
    });
    return this.mapWithdrawal(settledWithdrawal);
  }

  @Post("downloads")
  async createDownload(@Headers("authorization") authorization: string | undefined, @Body() body: { purchaseId?: string; deviceId?: string }) {
    const identity = await this.identity.require(authorization, ["listener"]);
    const purchase = await this.prisma.purchase.findUnique({ where: { id: String(body.purchaseId || "") } });
    if (!purchase || purchase.userId !== identity.id || purchase.status !== "completed") throw new BadRequestException("Your completed purchase is required for download");
    const deviceId = String(body.deviceId || "").trim();
    if (!deviceId) throw new BadRequestException("Device ID is required");
    return this.prisma.download.create({
      data: {
        purchaseId: purchase.id,
        deviceId
      }
    });
  }

  @Get("downloads")
  downloads() {
    return this.prisma.download.findMany();
  }

  @Get("favorites")
  favorites() {
    return this.prisma.favorite.findMany();
  }

  @Post("favorites")
  async favorite(@Body() body: { userId?: string; songId?: string }) {
    const user = await this.prisma.user.findFirst();
    const song = await this.prisma.song.findFirst();
    if (!user || !song) return { ok: false };
    return this.prisma.favorite.upsert({
      where: {
        userId_songId: {
          userId: String(body.userId || user.id),
          songId: String(body.songId || song.id)
        }
      },
      update: {},
      create: {
        userId: String(body.userId || user.id),
        songId: String(body.songId || song.id)
      }
    });
  }

  @Delete("favorites")
  async unfavorite(@Query("userId") userId: string, @Query("songId") songId: string) {
    await this.prisma.favorite.deleteMany({ where: { userId, songId } });
    return { ok: true };
  }

  @Get("followers")
  followers() {
    return this.prisma.follower.findMany();
  }

  @Post("followers")
  async follow(@Body() body: { followerUserId?: string; artistId?: string }) {
    const followerUserId = String(body.followerUserId || "listener-001");
    const artistId = String(body.artistId || "");
    const artist = await this.prisma.artist.findUnique({ where: { id: artistId } });
    if (!artist) return { ok: false };
    const existing = await this.prisma.follower.findUnique({
      where: {
        followerUserId_artistId: {
          followerUserId,
          artistId
        }
      }
    });
    if (existing) return existing;
    const [follower] = await this.prisma.$transaction([
      this.prisma.follower.create({ data: { followerUserId, artistId } }),
      this.prisma.artist.update({ where: { id: artistId }, data: { followersCount: { increment: 1 } } })
    ]);
    return follower;
  }

  @Post("followers/toggle")
  async toggleFollower(@Body() body: { followerUserId?: string; artistId?: string }) {
    const followerUserId = String(body.followerUserId || "listener-001");
    const artistId = String(body.artistId || "");
    const artist = await this.prisma.artist.findUnique({ where: { id: artistId } });
    if (!artist) return { following: false };
    const existing = await this.prisma.follower.findUnique({
      where: {
        followerUserId_artistId: {
          followerUserId,
          artistId
        }
      }
    });
    const following = !existing;
    if (following) {
      await this.prisma.$transaction([
        this.prisma.follower.create({ data: { followerUserId, artistId } }),
        this.prisma.artist.update({ where: { id: artistId }, data: { followersCount: { increment: 1 } } })
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.follower.delete({
          where: {
            followerUserId_artistId: {
              followerUserId,
              artistId
            }
          }
        }),
        this.prisma.artist.updateMany({ where: { id: artistId, followersCount: { gt: 0 } }, data: { followersCount: { decrement: 1 } } })
      ]);
    }
    return { following };
  }

  @Delete("followers")
  async unfollow(@Query("followerUserId") followerUserId: string, @Query("artistId") artistId: string) {
    const artist = await this.prisma.artist.findUnique({ where: { id: artistId } });
    const result = await this.prisma.follower.deleteMany({ where: { followerUserId, artistId } });
    if (result.count > 0 && artist) {
      await this.prisma.artist.updateMany({ where: { id: artistId, followersCount: { gt: 0 } }, data: { followersCount: { decrement: 1 } } });
    }
    return { ok: true };
  }

  @Get("claims")
  claims() {
    return this.prisma.claim.findMany();
  }

  @Post("claims")
  createClaim(@Body() body: { title?: string; artist?: string; priority?: "Low" | "Medium" | "High" }) {
    return this.prisma.claim.create({
      data: {
        title: String(body.title || "New claim"),
        artist: String(body.artist || "Unknown"),
        priority: body.priority || "Medium",
        status: "Open"
      }
    });
  }

  @Get("playlists")
  playlists() {
    return this.prisma.playlist.findMany();
  }

  @Post("playlists")
  async createPlaylist(@Body() body: { userId?: string; name?: string }) {
    const user = await this.prisma.user.findFirst();
    if (!user) return { ok: false };
    return this.prisma.playlist.create({
      data: {
        userId: String(body.userId || user.id),
        name: String(body.name || "Untitled playlist")
      }
    });
  }

  @Get("playlist-songs")
  playlistSongs() {
    return this.prisma.playlistSong.findMany();
  }

  @Post("playlist-songs")
  async addPlaylistSong(@Body() body: { playlistId?: string; songId?: string; position?: number }) {
    const playlistId = String(body.playlistId || "");
    const songId = String(body.songId || "");
    const playlist = await this.prisma.playlist.findUnique({ where: { id: playlistId } });
    const fallbackPlaylist = playlist ?? await this.prisma.playlist.findFirst();
    const song = await this.prisma.song.findUnique({ where: { id: songId } });
    const fallbackSong = song ?? await this.prisma.song.findFirst();
    if (!fallbackPlaylist || !fallbackSong) return { ok: false };
    return this.prisma.playlistSong.upsert({
      where: {
        playlistId_songId: {
          playlistId: fallbackPlaylist.id,
          songId: fallbackSong.id
        }
      },
      update: {
        position: Number(body.position || 1)
      },
      create: {
        playlistId: fallbackPlaylist.id,
        songId: fallbackSong.id,
        position: Number(body.position || 1)
      }
    });
  }

  @Delete("playlist-songs")
  async removePlaylistSong(@Query("playlistId") playlistId: string, @Query("songId") songId: string) {
    await this.prisma.playlistSong.deleteMany({ where: { playlistId, songId } });
    return { ok: true };
  }
}
