import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaService } from "./prisma.service.js";
import { IdentityService } from "./identity.service.js";

@Controller("api")
export class CatalogController {
  constructor(private readonly prisma: PrismaService, private readonly identity: IdentityService) {}

  private mapArtist(artist: {
    id: string;
    name: string;
    genre: string | null;
    city: string | null;
    payoutPhone: string | null;
    verified: boolean;
    followersCount: number;
    walletBalanceCdf: bigint;
  }) {
    return {
      id: artist.id,
      name: artist.name,
      genre: artist.genre ?? "",
      city: artist.city ?? "",
      payoutPhone: artist.payoutPhone ?? "",
      verified: artist.verified,
      followers: artist.followersCount,
      revenueCdf: Number(artist.walletBalanceCdf),
      walletBalanceCdf: Number(artist.walletBalanceCdf)
    };
  }

  private mapSong(song: {
    id: string;
    artistId: string;
    artist: string;
    title: string;
    albumTitle: string | null;
    genre: string | null;
    durationSeconds: number;
    priceCdf: number;
    streams: number;
    isPublished: boolean;
    audioPath: string;
    coverPath: string | null;
  }) {
    const minutes = Math.floor(song.durationSeconds / 60);
    const seconds = String(song.durationSeconds % 60).padStart(2, "0");
    return {
      id: song.id,
      artistId: song.artistId,
      artist: song.artist,
      title: song.title,
      albumTitle: song.albumTitle ?? "",
      genre: song.genre ?? "",
      priceCdf: song.priceCdf,
      duration: `${String(minutes).padStart(2, "0")}:${seconds}`,
      streams: song.streams,
      published: song.isPublished,
      audioPath: song.audioPath,
      coverPath: song.coverPath ?? ""
    };
  }

  private parseDurationSeconds(duration?: string) {
    const value = String(duration || "03:00");
    const [minutesText, secondsText = "0"] = value.split(":");
    const minutes = Number.parseInt(minutesText, 10);
    const seconds = Number.parseInt(secondsText, 10);
    if (Number.isNaN(minutes)) return 180;
    const safeSeconds = Number.isNaN(seconds) ? 0 : seconds;
    return Math.max(1, minutes * 60 + safeSeconds);
  }

  private safeAssetName(name: string | undefined, fallbackName: string) {
    return String(name || fallbackName)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallbackName;
  }

  private decodeBase64Asset(data?: string) {
    const value = String(data || "");
    if (!value) return null;
    const comma = value.indexOf(",");
    const base64 = comma >= 0 ? value.slice(comma + 1) : value;
    return base64 ? Buffer.from(base64, "base64") : null;
  }

  private storageRoot() {
    return process.env.MUZIKI_STORAGE_ROOT || path.resolve(process.cwd(), "../../storage");
  }

  private async saveAsset(folder: "audio" | "covers", data: string | undefined, name: string | undefined, fallbackName: string) {
    const bytes = this.decodeBase64Asset(data);
    if (!bytes) return "";
    const fileName = this.safeAssetName(name, fallbackName);
    const dir = path.join(this.storageRoot(), folder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fileName), bytes);
    return `/${folder}/${fileName}`;
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

  @Get("bootstrap")
  async bootstrap() {
    const [
      artists,
      users,
      songs,
      purchases,
      claims,
      withdrawals,
      playlists,
      playlistSongs,
      favorites,
      followers,
      downloads,
      sessions,
      notifications
    ] = await this.prisma.$transaction([
      this.prisma.artist.findMany(),
      this.prisma.user.findMany(),
      this.prisma.song.findMany(),
      this.prisma.purchase.findMany(),
      this.prisma.claim.findMany(),
      this.prisma.withdrawal.findMany(),
      this.prisma.playlist.findMany(),
      this.prisma.playlistSong.findMany(),
      this.prisma.favorite.findMany(),
      this.prisma.follower.findMany(),
      this.prisma.download.findMany(),
      this.prisma.session.findMany(),
      this.prisma.notification.findMany()
    ]);
    return {
      artists: artists.map((artist) => this.mapArtist(artist)),
      users,
      songs: songs.map((song) => this.mapSong(song)),
      purchases,
      claims,
      withdrawals: withdrawals.map((withdrawal) => this.mapWithdrawal(withdrawal)),
      playlists,
      playlistSongs,
      favorites,
      followers,
      downloads,
      sessions,
      notifications
    };
  }

  @Get("manifest")
  manifest() {
    return {
      name: "Muziki",
      vision: "Digital music marketplace for the DRC",
      systems: {
        mobile: "Flutter listener app",
        artistPortal: "Web artist portal",
        adminApp: "Flutter mobile admin app",
        backend: "NestJS + PostgreSQL"
      }
    };
  }

  @Get("artists")
  artists() {
    return this.prisma.artist.findMany().then((artists) => artists.map((artist) => this.mapArtist(artist)));
  }

  @Post("artists")
  createArtist(@Body() body: { name?: string; genre?: string; city?: string; payoutPhone?: string }) {
    return this.prisma.artist.create({
      data: {
        name: String(body.name || "New Artist"),
        genre: String(body.genre || "Unknown"),
        city: String(body.city || "Kinshasa"),
        payoutPhone: String(body.payoutPhone || "").trim() || null
      }
    }).then((artist) => this.mapArtist(artist));
  }

  @Post("artists/:id/verify")
  async verifyArtist(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    await this.identity.require(authorization, ["admin"]);
    const artist = await this.prisma.artist.update({ where: { id }, data: { verified: true } });
    return this.mapArtist(artist);
  }

  @Post("artists/:id/payout-phone")
  async updatePayoutPhone(@Headers("authorization") authorization: string | undefined, @Param("id") id: string, @Body() body: { payoutPhone?: string; phone?: string }) {
    const identity = await this.identity.require(authorization, ["artist"]);
    const owner = await this.prisma.artist.findUnique({ where: { id } });
    if (!owner || owner.userId !== identity.id) throw new BadRequestException("You can only update your own receiving number");
    const artist = await this.prisma.artist.update({
      where: { id },
      data: { payoutPhone: String(body.payoutPhone || body.phone || "").trim() || null }
    });
    return this.mapArtist(artist);
  }

  @Post("artists/:id/reject")
  async rejectArtist(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    await this.identity.require(authorization, ["admin"]);
    const artist = await this.prisma.artist.delete({ where: { id } });
    return this.mapArtist(artist);
  }

  @Get("songs")
  songs() {
    return this.prisma.song.findMany().then((songs) => songs.map((song) => this.mapSong(song)));
  }

  @Post("songs")
  async createSong(@Headers("authorization") authorization: string | undefined, @Body() body: { title?: string; albumTitle?: string; album?: string; artist?: string; genre?: string; priceCdf?: number; duration?: string; audioPath?: string; coverPath?: string; audioData?: string; audioName?: string; coverData?: string; coverName?: string }) {
    const identity = await this.identity.require(authorization, ["artist"]);
    const fallbackArtist = await this.prisma.artist.findUnique({ where: { userId: identity.id } });
    if (!fallbackArtist) {
      throw new BadRequestException("Artist profile required before publishing a song.");
    }
    const artist = fallbackArtist;
    if (!artist.verified) {
      throw new BadRequestException("Your artist profile must be verified by an admin before music can be published.");
    }
    const artistId = artist.id;
    const artistName = String(body.artist || artist.name || "Unknown artist");
    const slug = String(body.title || "track")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "track";
    const storedAudioPath = await this.saveAsset("audio", body.audioData, body.audioName, `${slug}.mp3`);
    const storedCoverPath = await this.saveAsset("covers", body.coverData, body.coverName, `${slug}.jpg`);
    const song = await this.prisma.song.create({
      data: {
        title: String(body.title || "Untitled"),
        albumTitle: String(body.albumTitle || body.album || "").trim() || null,
        artistId,
        artist: artistName,
        genre: String(body.genre || "Rumba Fusion"),
        priceCdf: Number(body.priceCdf || 1000),
        durationSeconds: this.parseDurationSeconds(body.duration),
        audioPath: storedAudioPath || String(body.audioPath || `/audio/${slug}.mp3`),
        coverPath: storedCoverPath || String(body.coverPath || `/covers/${slug}.jpg`),
        isPublished: true,
        streams: 0
      }
    });
    return this.mapSong(song);
  }

  @Get("search")
  async search(@Query("q") q = "") {
    const normalized = q.toLowerCase();
    const [artists, songs] = await this.prisma.$transaction([
      this.prisma.artist.findMany(),
      this.prisma.song.findMany()
    ]);
    return {
      artists: artists.filter((artist) => `${artist.name} ${artist.genre ?? ""} ${artist.city ?? ""}`.toLowerCase().includes(normalized)).map((artist) => this.mapArtist(artist)),
      songs: songs.filter((song) => `${song.title} ${song.artist} ${song.genre ?? ""}`.toLowerCase().includes(normalized)).map((song) => this.mapSong(song))
    };
  }
}
