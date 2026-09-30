export type UserRole = "listener" | "artist" | "admin";

export interface User {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  role: UserRole;
}

export interface Artist {
  id: string;
  userId?: string;
  name: string;
  genre: string;
  city: string;
  verified: boolean;
  followers: number;
  followersCount?: number;
  revenueCdf: number;
  walletBalanceCdf: number;
}

export interface Song {
  id: string;
  title: string;
  artistId: string;
  artist: string;
  genre: string;
  priceCdf: number;
  duration: string;
  streams: number;
  audioPath: string;
  coverPath: string;
  published?: boolean;
  isPublished?: boolean;
}

export interface Purchase {
  id: string;
  songId: string;
  userId: string;
  method: string;
  amountCdf: number;
  status: "pending" | "completed" | "failed";
}

export interface Playlist {
  id: string;
  userId: string;
  name: string;
}

export interface PlaylistSong {
  playlistId: string;
  songId: string;
  position: number;
}

export interface Favorite {
  userId: string;
  songId: string;
  createdAt?: string;
}

export interface Follower {
  followerUserId: string;
  artistId: string;
  createdAt?: string;
}

export interface Download {
  id: string;
  purchaseId: string;
  deviceId: string;
  downloadedAt: string;
}

export interface Withdrawal {
  id: string;
  artistId: string;
  amountCdf: number;
  status: "requested" | "approved" | "paid" | "rejected";
  requestedAt?: string;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  createdAt?: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  createdAt?: string;
}

export interface Claim {
  id: string;
  title: string;
  artist: string;
  priority: "Low" | "Medium" | "High";
  status: "Open" | "In Review" | "Closed";
}
