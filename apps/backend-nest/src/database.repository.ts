import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class DatabaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  bootstrap() {
    return this.prisma.$transaction([
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
    ]).then(([artists, users, songs, purchases, claims, withdrawals, playlists, playlistSongs, favorites, followers, downloads, sessions, notifications]) => ({
      artists,
      users,
      songs,
      purchases,
      claims,
      withdrawals: withdrawals.map((withdrawal) => ({
        id: withdrawal.id,
        artistId: withdrawal.artistId,
        amountCdf: Number(withdrawal.amountCdf),
        status: withdrawal.status,
        requestedAt: withdrawal.requestedAt
      })),
      playlists,
      playlistSongs,
      favorites,
      followers,
      downloads,
      sessions,
      notifications
    }));
  }
}
