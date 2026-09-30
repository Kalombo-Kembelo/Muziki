import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { artists, users, songs, purchases, claims, withdrawals, notifications, playlists, playlistSongs, favorites, followers, downloads, sessions } from "./data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageRoot = path.resolve(__dirname, "../../../storage");

const json = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload, null, 2));
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
};

const slugify = (value) =>
  String(value || "track")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "track";

const safeAssetName = (name, fallbackName) =>
  String(name || fallbackName)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallbackName;

const decodeBase64Asset = (data) => {
  const value = String(data || "");
  if (!value) return null;
  const comma = value.indexOf(",");
  const base64 = comma >= 0 ? value.slice(comma + 1) : value;
  return base64 ? Buffer.from(base64, "base64") : null;
};

const saveAsset = async (folder, data, name, fallbackName) => {
  const bytes = decodeBase64Asset(data);
  if (!bytes) return "";
  const fileName = safeAssetName(name, fallbackName);
  const dir = path.join(storageRoot, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), bytes);
  return `/${folder}/${fileName}`;
};

const contentTypeFor = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg") return "audio/ogg";
  return "application/octet-stream";
};

const normalizeText = (value, fallback = "") => {
  const text = String(value ?? fallback).trim();
  return text || fallback;
};

const normalizeAmount = (value, fallback = 0) => {
  const amount = typeof value === "number" ? value : Number(String(value ?? fallback));
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : fallback;
};

const buildPlaceholderUrl = (template, values) =>
  template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => encodeURIComponent(values[key] || ""));

const callbackUrl = () => process.env.FLEXPAIE_CALLBACK_URL || "http://localhost:3000/api/payments/flexpaie/webhook";

const merchantPhoneFor = (operator) => {
  const key = String(operator || "").toLowerCase();
  if (key.includes("vodacom")) return process.env.DRC_VODACOM_MERCHANT_PHONE || "";
  if (key.includes("airtel")) return process.env.DRC_AIRTEL_MERCHANT_PHONE || "+243992313395";
  if (key.includes("orange")) return process.env.DRC_ORANGE_MERCHANT_PHONE || "";
  if (key.includes("africell")) return process.env.DRC_AFRICELL_MERCHANT_PHONE || "";
  return "";
};

const createReference = () => `flexpaie-${randomUUID().replace(/-/g, "")}`;

const extractStatus = (value) => {
  const status = normalizeText(value, "pending").toLowerCase();
  if (["completed", "complete", "success", "succeeded", "paid", "successfully_paid"].includes(status)) return "completed";
  if (["failed", "fail", "canceled", "cancelled", "rejected", "expired", "error"].includes(status)) return "failed";
  return "pending";
};

const verifyWebhookSignature = (body, signature) => {
  const secret = process.env.FLEXPAIE_WEBHOOK_SECRET || "";
  if (!secret) return true;
  const provided = normalizeText(signature || body.signature, "");
  if (!provided) return false;
  const clone = { ...body };
  delete clone.signature;
  const expected = createHmac("sha256", secret).update(JSON.stringify(clone)).digest("hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
};

const findPurchaseByReference = (reference) =>
  purchases.find((entry) => entry.id === reference || entry.providerReference === reference);

const findSongByPurchase = (purchase) => songs.find((song) => song.id === purchase?.songId);

const creditArtistForPurchase = (purchase) => {
  const song = findSongByPurchase(purchase);
  const artist = artists.find((entry) => entry.id === song?.artistId);
  if (artist) {
    artist.revenueCdf = Number(artist.revenueCdf || 0) + Number(purchase.amountCdf || 0);
    artist.walletBalanceCdf = Number(artist.walletBalanceCdf || 0) + Number(purchase.amountCdf || 0);
  }
};

const buildFlexpaieCheckout = (body) => {
  const song = songs.find((entry) => entry.id === String(body.songId || "")) || songs[0];
  const amountCdf = normalizeAmount(body.amountCdf, song?.priceCdf || 0);
  const providerReference = createReference();
  const purchase = {
    id: `purchase-${providerReference}`,
    songId: String(song?.id || body.songId || ""),
    userId: String(body.userId || "listener-001"),
    method: normalizeText(body.method, "Manual mobile money"),
    amountCdf,
    status: "pending",
    provider: "flexpaie",
    providerReference,
    checkoutUrl: "",
    paidAt: ""
  };
  const template = process.env.FLEXPAIE_CHECKOUT_URL_TEMPLATE || "";
  if (template) {
    const user = users.find((entry) => entry.id === purchase.userId) || users[0];
    purchase.checkoutUrl = buildPlaceholderUrl(template, {
      merchantCode: process.env.FLEXPAIE_MERCHANT_CODE || "",
      reference: providerReference,
      purchaseId: purchase.id,
      amountCdf: String(amountCdf),
      currency: "CDF",
      callbackUrl: callbackUrl(),
      returnUrl: String(body.returnUrl || ""),
      description: `${song?.title || "Track"} - ${song?.artist || ""}`,
      songTitle: song?.title || "",
      artistName: song?.artist || "",
      userName: user?.fullName || "",
      userEmail: user?.email || "",
      userPhone: user?.phone || "",
      method: purchase.method
    });
  }
  purchases.unshift(purchase);
  return { purchase, checkoutUrl: purchase.checkoutUrl, provider: "flexpaie", providerReference };
};

const buildManualPurchase = (body) => {
  const song = songs.find((entry) => entry.id === String(body.songId || "")) || songs[0];
  const amountCdf = normalizeAmount(body.amountCdf, song?.priceCdf || 0);
  const operator = String(body.operator || body.method || "Mobile Money");
  const merchantPhone = String(body.merchantPhone || merchantPhoneFor(operator));
  const purchase = {
    id: `purchase-${String(Date.now()).slice(-8)}`,
    songId: String(song?.id || body.songId || ""),
    userId: String(body.userId || "listener-001"),
    method: String(body.method || "Mobile Money"),
    operator,
    payerPhone: String(body.payerPhone || ""),
    merchantPhone,
    transferReference: String(body.transferReference || ""),
    amountCdf,
    status: body.transferReference ? "pending_review" : "pending",
    provider: "manual-mobile-money",
    providerReference: `manual-${String(Date.now()).slice(-8)}`,
    checkoutUrl: "",
    paidAt: ""
  };
  purchases.unshift(purchase);
  const adminUsers = users.filter((user) => String(user.role || "").toLowerCase() === "admin");
  adminUsers.forEach((user) => {
    notifications.unshift({
      id: `notif-${String(Date.now()).slice(-8)}-${user.id}`,
      userId: user.id,
      title: "New payment request",
      message: `${purchase.method} for ${song?.title || "a song"} is waiting for review.`
    });
  });
  return purchase;
};

const findPurchaseIndex = (id) => purchases.findIndex((entry) => entry.id === id);

const serveAsset = async (res, urlPath) => {
  const folder = urlPath.startsWith("/audio/") ? "audio" : "covers";
  const fileName = path.basename(decodeURIComponent(urlPath));
  const fullPath = path.resolve(storageRoot, folder, fileName);
  const allowedRoot = path.resolve(storageRoot, folder);
  if (!fullPath.startsWith(`${allowedRoot}${path.sep}`)) {
    json(res, 400, { error: "Invalid asset path" });
    return;
  }
  try {
    const bytes = await readFile(fullPath);
    res.writeHead(200, {
      "Content-Type": contentTypeFor(fullPath),
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600"
    });
    res.end(bytes);
  } catch {
    json(res, 404, { error: "Asset not found" });
  }
};

const routes = {
  "/health": () => ({ status: "ok", service: "muziki-backend", timestamp: new Date().toISOString() }),
  "/api/manifest": () => ({
    name: "Muziki",
    vision: "Digital music marketplace for the DRC",
    systems: {
      mobile: "Flutter listener app",
      artistPortal: "Web artist portal",
      adminApp: "Flutter mobile admin app",
      backend: "Node API"
    }
  }),
  "/api/artists": () => artists,
  "/api/songs": () => songs,
  "/api/purchases": () => purchases,
  "/api/claims": () => claims,
  "/api/withdrawals": () => withdrawals,
  "/api/notifications": () => notifications,
  "/api/playlists": () => playlists,
  "/api/playlist-songs": () => playlistSongs,
  "/api/favorites": () => favorites,
  "/api/followers": () => followers,
  "/api/downloads": () => downloads,
  "/api/search": (url) => {
    const q = String(url.searchParams.get("q") || "").toLowerCase();
    return {
      artists: artists.filter((artist) => `${artist.name} ${artist.genre} ${artist.city}`.toLowerCase().includes(q)),
      songs: songs.filter((song) => `${song.title} ${song.artist} ${song.genre}`.toLowerCase().includes(q))
    };
  },
  "/api/bootstrap": () => ({
    artists,
    users,
    songs,
    purchases,
    claims,
    withdrawals,
    notifications,
    playlists,
    playlistSongs,
    favorites,
    followers,
    downloads,
    sessions
  })
};

const server = http.createServer(async (req, res) => {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", "http://localhost");

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (method === "GET" && routes[url.pathname]) return json(res, 200, routes[url.pathname](url));

  if (method === "GET" && (url.pathname.startsWith("/audio/") || url.pathname.startsWith("/covers/"))) {
    await serveAsset(res, url.pathname);
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/api/payments/")) {
    const reference = decodeURIComponent(url.pathname.split("/").pop() || "");
    const purchase = findPurchaseByReference(reference);
    if (!purchase) return json(res, 404, { error: "Payment not found" });
    return json(res, 200, purchase);
  }

  if (method === "POST" && url.pathname === "/api/artists") {
    const body = await readBody(req);
    const artist = {
      id: `artist-${String(Date.now()).slice(-8)}`,
      name: String(body.name || "New Artist"),
      genre: String(body.genre || "Unknown"),
      city: String(body.city || "Kinshasa"),
      payoutPhone: String(body.payoutPhone || body.phone || "").trim(),
      verified: false,
      followers: 0,
      revenueCdf: 0,
      walletBalanceCdf: 0
    };
    artists.unshift(artist);
    return json(res, 201, artist);
  }

  if (method === "POST" && /^\/api\/artists\/[^/]+\/verify$/.test(url.pathname)) {
    const artistId = url.pathname.split("/")[3];
    const artist = artists.find((entry) => entry.id === artistId);
    if (!artist) return json(res, 404, { error: "Artist not found" });
    artist.verified = true;
    return json(res, 200, artist);
  }

  if (method === "POST" && /^\/api\/artists\/[^/]+\/payout-phone$/.test(url.pathname)) {
    const body = await readBody(req);
    const artistId = url.pathname.split("/")[3];
    const artist = artists.find((entry) => entry.id === artistId);
    if (!artist) return json(res, 404, { error: "Artist not found" });
    artist.payoutPhone = String(body.payoutPhone || body.phone || "").trim();
    return json(res, 200, artist);
  }

  if (method === "POST" && /^\/api\/artists\/[^/]+\/reject$/.test(url.pathname)) {
    const artistId = url.pathname.split("/")[3];
    const index = artists.findIndex((entry) => entry.id === artistId);
    if (index < 0) return json(res, 404, { error: "Artist not found" });
    const [removed] = artists.splice(index, 1);
    return json(res, 200, removed);
  }

  if (method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const email = String(body.email || "").toLowerCase();
    const user = users.find((entry) => String(entry.email || "").toLowerCase() === email);
    if (!user) return json(res, 401, { error: "Invalid credentials" });
    const session = {
      id: `session-${String(Date.now()).slice(-8)}`,
      userId: user.id,
      token: `token-${String(Date.now()).slice(-12)}`
    };
    sessions.unshift(session);
    return json(res, 200, { user, session });
  }

  if (method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readBody(req);
    const user = {
      id: `user-${String(Date.now()).slice(-8)}`,
      fullName: String(body.fullName || "New User"),
      email: String(body.email || ""),
      phone: String(body.phone || ""),
      role: String(body.role || "listener")
    };
    users.unshift(user);
    if (user.role === "artist") {
      artists.unshift({
        id: `artist-${String(Date.now()).slice(-8)}`,
        userId: user.id,
        name: user.fullName,
        genre: "Unknown",
        city: "Kinshasa",
        payoutPhone: String(body.payoutPhone || body.phone || "").trim(),
        verified: false,
        followers: 0,
        revenueCdf: 0,
        walletBalanceCdf: 0
      });
    }
    const session = {
      id: `session-${String(Date.now()).slice(-8)}`,
      userId: user.id,
      token: `token-${String(Date.now()).slice(-12)}`
    };
    sessions.unshift(session);
    return json(res, 201, { user, session });
  }

  if (method === "POST" && url.pathname === "/api/songs") {
    const body = await readBody(req);
    const slug = slugify(body.title);
    const requestedArtistId = String(body.artistId || "");
    const selectedArtist = artists.find((entry) => entry.id === requestedArtistId) || artists[0];
    if (!selectedArtist) return json(res, 400, { error: "Artist profile required before publishing a song." });
    const storedAudioPath = await saveAsset("audio", body.audioData, body.audioName, `${slug}.mp3`);
    const storedCoverPath = await saveAsset("covers", body.coverData, body.coverName, `${slug}.jpg`);
    const song = {
      id: `song-${String(Date.now()).slice(-8)}`,
      title: String(body.title || "Untitled"),
      albumTitle: String(body.albumTitle || body.album || "").trim(),
      artistId: String(selectedArtist?.id || requestedArtistId),
      artist: String(body.artist || selectedArtist?.name || "Unknown artist"),
      genre: String(body.genre || "Rumba Fusion"),
      priceCdf: Number(body.priceCdf || 1000),
      duration: String(body.duration || "03:00"),
      streams: 0,
      published: true,
      audioPath: storedAudioPath || String(body.audioPath || `/audio/${slug}.mp3`),
      coverPath: storedCoverPath || String(body.coverPath || `/covers/${slug}.jpg`)
    };
    songs.unshift(song);
    return json(res, 201, song);
  }

  if (method === "POST" && url.pathname === "/api/purchases") {
    const body = await readBody(req);
    const purchase = buildManualPurchase(body);
    return json(res, 201, purchase);
  }

  if (method === "POST" && /^\/api\/purchases\/[^/]+\/proof$/.test(url.pathname)) {
    const body = await readBody(req);
    const id = url.pathname.split("/")[3];
    const index = findPurchaseIndex(id);
    if (index < 0) return json(res, 404, { error: "Payment not found" });
    purchases[index] = {
      ...purchases[index],
      payerPhone: String(body.payerPhone || purchases[index].payerPhone || ""),
      transferReference: String(body.transferReference || purchases[index].transferReference || ""),
      status: "pending_review"
    };
    return json(res, 200, purchases[index]);
  }

  if (method === "POST" && /^\/api\/purchases\/[^/]+\/approve$/.test(url.pathname)) {
    const id = url.pathname.split("/")[3];
    const index = findPurchaseIndex(id);
    if (index < 0) return json(res, 404, { error: "Payment not found" });
    const purchase = purchases[index];
    if (purchase.status !== "completed") {
      const song = songs.find((entry) => entry.id === purchase.songId);
      const artist = artists.find((entry) => entry.id === song?.artistId);
      if (artist) {
        artist.revenueCdf = Number(artist.revenueCdf || 0) + Number(purchase.amountCdf || 0);
        artist.walletBalanceCdf = Number(artist.walletBalanceCdf || 0) + Number(purchase.amountCdf || 0);
      }
      purchase.status = "completed";
      purchase.paidAt = new Date().toISOString();
    }
    return json(res, 200, purchase);
  }

  if (method === "POST" && /^\/api\/purchases\/[^/]+\/reject$/.test(url.pathname)) {
    const id = url.pathname.split("/")[3];
    const index = findPurchaseIndex(id);
    if (index < 0) return json(res, 404, { error: "Payment not found" });
    purchases[index].status = "failed";
    return json(res, 200, purchases[index]);
  }

  if (method === "POST" && url.pathname === "/api/payments/flexpaie/checkout") {
    const body = await readBody(req);
    const result = buildFlexpaieCheckout(body);
    return json(res, 201, result);
  }

  if (method === "POST" && url.pathname === "/api/payments/flexpaie/webhook") {
    const body = await readBody(req);
    if (!verifyWebhookSignature(body, req.headers["x-flexpaie-signature"] || req.headers["x-signature"])) {
      return json(res, 401, { error: "Invalid webhook signature" });
    }
    const reference = normalizeText(body.providerReference || body.reference || body.transactionReference, "");
    if (!reference) return json(res, 400, { error: "Missing payment reference" });
    const purchase = findPurchaseByReference(reference);
    if (!purchase) return json(res, 404, { error: "Payment not found" });
    const nextStatus = extractStatus(body.status || body.paymentStatus);
    if (nextStatus === "completed" && purchase.status !== "completed") {
      purchase.status = "completed";
      purchase.paidAt = new Date().toISOString();
      if (body.method) purchase.method = String(body.method);
      creditArtistForPurchase(purchase);
    } else if (nextStatus === "failed") {
      purchase.status = "failed";
      if (body.method) purchase.method = String(body.method);
    } else {
      purchase.status = purchase.status || "pending";
    }
    return json(res, 200, purchase);
  }

  if (method === "POST" && url.pathname === "/api/favorites") {
    const body = await readBody(req);
    const favorite = {
      userId: String(body.userId || "listener-001"),
      songId: String(body.songId || "")
    };
    const exists = favorites.some((entry) => entry.userId === favorite.userId && entry.songId === favorite.songId);
    if (!exists) favorites.unshift(favorite);
    return json(res, 201, favorite);
  }

  if (method === "DELETE" && url.pathname === "/api/favorites") {
    const userId = String(url.searchParams.get("userId") || "");
    const songId = String(url.searchParams.get("songId") || "");
    const index = favorites.findIndex((entry) => entry.userId === userId && entry.songId === songId);
    if (index >= 0) favorites.splice(index, 1);
    return json(res, 200, { ok: true });
  }

  if (method === "POST" && url.pathname === "/api/followers") {
    const body = await readBody(req);
    const follower = {
      followerUserId: String(body.followerUserId || "listener-001"),
      artistId: String(body.artistId || "")
    };
    const exists = followers.some((entry) => entry.followerUserId === follower.followerUserId && entry.artistId === follower.artistId);
    if (!exists) {
      followers.unshift(follower);
      const artist = artists.find((entry) => entry.id === follower.artistId);
      if (artist) artist.followers = Number(artist.followers || 0) + 1;
    }
    return json(res, 201, follower);
  }

  if (method === "POST" && url.pathname === "/api/followers/toggle") {
    const body = await readBody(req);
    const followerUserId = String(body.followerUserId || "listener-001");
    const artistId = String(body.artistId || "");
    const index = followers.findIndex((entry) => entry.followerUserId === followerUserId && entry.artistId === artistId);
    const following = index < 0;
    if (following) {
      followers.unshift({ followerUserId, artistId });
      const artist = artists.find((entry) => entry.id === artistId);
      if (artist) artist.followers = Number(artist.followers || 0) + 1;
    } else {
      followers.splice(index, 1);
      const artist = artists.find((entry) => entry.id === artistId);
      if (artist) artist.followers = Math.max(0, Number(artist.followers || 0) - 1);
    }
    return json(res, 200, { following });
  }

  if (method === "DELETE" && url.pathname === "/api/followers") {
    const followerUserId = String(url.searchParams.get("followerUserId") || "");
    const artistId = String(url.searchParams.get("artistId") || "");
    const index = followers.findIndex((entry) => entry.followerUserId === followerUserId && entry.artistId === artistId);
    if (index >= 0) {
      followers.splice(index, 1);
      const artist = artists.find((entry) => entry.id === artistId);
      if (artist) artist.followers = Math.max(0, Number(artist.followers || 0) - 1);
    }
    return json(res, 200, { ok: true });
  }

  if (method === "POST" && url.pathname === "/api/downloads") {
    const body = await readBody(req);
    const download = {
      id: `download-${String(Date.now()).slice(-8)}`,
      purchaseId: String(body.purchaseId || ""),
      deviceId: String(body.deviceId || "device-001"),
      downloadedAt: new Date().toISOString()
    };
    downloads.unshift(download);
    return json(res, 201, download);
  }

  if (method === "POST" && url.pathname === "/api/claims") {
    const body = await readBody(req);
    const claim = {
      id: `claim-${String(Date.now()).slice(-8)}`,
      title: String(body.title || "New claim"),
      artist: String(body.artist || "Unknown"),
      priority: String(body.priority || "Medium"),
      status: "Open"
    };
    claims.unshift(claim);
    return json(res, 201, claim);
  }

  if (method === "POST" && url.pathname === "/api/withdrawals") {
    const body = await readBody(req);
    const artist = artists.find((entry) => entry.id === String(body.artistId || ""));
    if (!artist) return json(res, 404, { ok: false, error: "Artist not found" });
    const requestedAmount = Number(body.amountCdf || 0);
    const availableAmount = Number(artist.walletBalanceCdf || artist.revenueCdf || 0);
    const amountCdf = Math.max(0, Math.min(requestedAmount, availableAmount));
    const payoutPhone = String(body.payoutPhone || artist.payoutPhone || "").trim();
    if (!payoutPhone) return json(res, 400, { ok: false, error: "Receiving Mobile Money number required" });
    if (amountCdf <= 0) return json(res, 400, { ok: false, error: "No earnings available" });
    const withdrawal = {
      id: `withdrawal-${String(Date.now()).slice(-8)}`,
      artistId: String(body.artistId || ""),
      payoutPhone,
      amountCdf,
      status: "requested"
    };
    artist.walletBalanceCdf = Math.max(0, Number(artist.walletBalanceCdf || 0) - amountCdf);
    withdrawals.unshift(withdrawal);
    return json(res, 201, withdrawal);
  }

  const paidWithdrawalMatch = url.pathname.match(/^\/api\/withdrawals\/([^/]+)\/paid$/);
  if (method === "POST" && paidWithdrawalMatch) {
    const withdrawal = withdrawals.find((entry) => entry.id === paidWithdrawalMatch[1]);
    if (!withdrawal) return json(res, 404, { ok: false, error: "Withdrawal not found" });
    withdrawal.status = "paid";
    withdrawal.paidAt = new Date().toISOString();
    return json(res, 200, withdrawal);
  }

  if (method === "POST" && url.pathname === "/api/playlists") {
    const body = await readBody(req);
    const playlist = {
      id: `playlist-${String(Date.now()).slice(-8)}`,
      userId: String(body.userId || "listener-001"),
      name: String(body.name || "Untitled playlist")
    };
    playlists.unshift(playlist);
    return json(res, 201, playlist);
  }

  if (method === "POST" && url.pathname === "/api/playlist-songs") {
    const body = await readBody(req);
    const relation = {
      playlistId: String(body.playlistId || ""),
      songId: String(body.songId || ""),
      position: Number(body.position || playlistSongs.length + 1)
    };
    const exists = playlistSongs.some((entry) => entry.playlistId === relation.playlistId && entry.songId === relation.songId);
    if (!exists) playlistSongs.unshift(relation);
    return json(res, 201, relation);
  }

  if (method === "DELETE" && url.pathname === "/api/playlist-songs") {
    const playlistId = String(url.searchParams.get("playlistId") || "");
    const songId = String(url.searchParams.get("songId") || "");
    const index = playlistSongs.findIndex((entry) => entry.playlistId === playlistId && entry.songId === songId);
    if (index >= 0) playlistSongs.splice(index, 1);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found", path: url.pathname });
});

server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => {
  console.log("Muziki backend listening");
});
