const root = document.getElementById("app");
const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

const API_BASE = window.MUZIKI_API_BASE || localStorage.getItem("muziki-api-base") || "http://localhost:3000";

const demoSongIds = new Set(["song-001", "song-002", "song-003", "song-004"]);
const demoSongTitles = new Set(["Lumiere du Fleuve", "Nzela", "Quartier Mambo", "Mise en Route"]);
const demoArtistIds = new Set(["artist-001", "artist-002", "artist-003"]);
const demoArtistNames = new Set(["M'Banza Collective", "Kivu Pulse", "Ndombolo Street Lab"]);
const demoNotificationIds = new Set(["notif-001"]);

const operators = ["Vodacom", "Airtel", "Orange", "Africell"];

const state = {
  query: "",
  genre: "All",
  authMode: "login",
  currentUser: storage.get("muziki-listener-user", null),
  sessionToken: storage.get("muziki-listener-token", ""),
  loading: true,
  artists: cleanArtists(storage.get("muziki-listener-artists", [])),
  albums: cleanAlbums(storage.get("muziki-listener-albums", [])),
  songs: cleanSongs(storage.get("muziki-listener-songs", [])),
  purchases: cleanPurchases(storage.get("muziki-listener-purchases", [])),
  notifications: cleanNotifications(storage.get("muziki-listener-notifications", [])),
  selectedSong: null
};

const fmt = new Intl.NumberFormat("fr-CD");

function songArtist(song) {
  return song.artist || song.artistName || "Unknown artist";
}

function cleanArtists(artists) {
  return (Array.isArray(artists) ? artists : []).filter((artist) => {
    return !demoArtistIds.has(String(artist.id || "")) && !demoArtistNames.has(String(artist.name || ""));
  });
}

function cleanAlbums(albums) {
  return (Array.isArray(albums) ? albums : []).filter((album) => {
    return !demoSongIds.has(String(album.id || "")) && !demoSongTitles.has(String(album.title || ""));
  });
}

function cleanSongs(songs) {
  return (Array.isArray(songs) ? songs : []).filter((song) => {
    return !demoSongIds.has(String(song.id || "")) && !demoSongTitles.has(String(song.title || ""));
  });
}

function cleanPurchases(purchases) {
  return (Array.isArray(purchases) ? purchases : []).filter((purchase) => {
    return !demoSongIds.has(String(purchase.songId || "")) && !String(purchase.id || "").startsWith("purchase-001");
  });
}

function cleanNotifications(notifications) {
  return (Array.isArray(notifications) ? notifications : []).filter((notification) => {
    return !demoNotificationIds.has(String(notification.id || ""));
  });
}

function toast(title, message) {
  const stack = document.querySelector(".toast-stack");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<strong>${title}</strong><div>${message}</div>`;
  stack.append(el);
  setTimeout(() => el.remove(), 3000);
}

function setApiBase() {
  const current = localStorage.getItem("muziki-api-base") || API_BASE;
  const next = window.prompt("Backend API base URL", current);
  if (!next) return;
  localStorage.setItem("muziki-api-base", next.trim());
  window.location.reload();
}

async function bootstrap() {
  try {
    const response = await fetch(`${API_BASE}/api/bootstrap`);
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data.artists)) state.artists = cleanArtists(data.artists);
    if (Array.isArray(data.albums)) state.albums = cleanAlbums(data.albums);
    if (Array.isArray(data.songs)) state.songs = cleanSongs(data.songs);
    if (Array.isArray(data.purchases)) state.purchases = cleanPurchases(data.purchases);
    if (Array.isArray(data.notifications)) state.notifications = cleanNotifications(data.notifications);
  } catch {
    // offline fallback
  } finally {
    state.loading = false;
    render();
    persist();
  }
}

function persist() {
  storage.set("muziki-listener-user", state.currentUser);
  storage.set("muziki-listener-token", state.sessionToken);
  storage.set("muziki-listener-artists", state.artists);
  storage.set("muziki-listener-albums", state.albums);
  storage.set("muziki-listener-songs", state.songs);
  storage.set("muziki-listener-purchases", state.purchases);
  storage.set("muziki-listener-notifications", state.notifications);
}

async function authenticate(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "").trim().toLowerCase();
  const fullName = String(form.get("fullName") || "").trim();
  const password = String(form.get("password") || "");
  if (!email || !password) return;
  const path = state.authMode === "login" ? "/api/auth/login" : "/api/auth/register";
  const payload = state.authMode === "login" ? { email, password } : { fullName, email, password, role: "listener", phone: "" };
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Auth failed (${response.status})`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    state.currentUser = data.user;
    state.sessionToken = data.session?.token || "";
  } catch (error) {
    toast("Sign in failed", String(error.message || error));
    return;
  }
  persist();
  render();
}

function signOut() {
  state.currentUser = null;
  state.sessionToken = "";
  persist();
  render();
}

function authHeaders() {
  return { "Content-Type": "application/json", ...(state.sessionToken ? { Authorization: `Bearer ${state.sessionToken}` } : {}) };
}

function normalizePurchase(purchase) {
  return {
    id: purchase.id,
    songId: purchase.songId,
    method: purchase.method || "Mobile Money",
    operator: purchase.operator || purchase.method || "Mobile Money",
    payerPhone: purchase.payerPhone || "",
    merchantPhone: purchase.merchantPhone || "",
    transferReference: purchase.transferReference || "",
    amountCdf: Number(purchase.amountCdf || 0),
    status: purchase.status || "pending",
    createdAt: purchase.createdAt || "",
  };
}

function releaseDateValue(item) {
  const raw = item.createdAt || item.publishedAt || item.releaseDate || item.updatedAt || "";
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  const idNumber = Number(String(item.id || "").replace(/\D/g, ""));
  return Number.isFinite(idNumber) ? idNumber : 0;
}

function trendScore(item) {
  return Number(item.trendingScore || 0)
    + Number(item.streams || item.plays || 0)
    + Number(item.followers || item.followersCount || 0) * 3
    + Number(item.sales || item.purchases || 0) * 12;
}

function compareTrending(a, b) {
  return trendScore(b) - trendScore(a) || releaseDateValue(b) - releaseDateValue(a);
}

function compareNewest(a, b) {
  return releaseDateValue(b) - releaseDateValue(a);
}

function songAlbumTitle(song) {
  return String(song.albumTitle || song.album || "").trim();
}

function buildAlbums() {
  const backendAlbums = cleanAlbums(state.albums);
  if (backendAlbums.length) return backendAlbums;
  const grouped = new Map();
  state.songs.forEach((song) => {
    const title = songAlbumTitle(song);
    if (!title) return;
    const key = title.toLowerCase();
    const current = grouped.get(key) || {
      id: `album-${key.replace(/[^a-z0-9]+/g, "-")}`,
      title,
      artist: songArtist(song),
      genre: song.genre || "",
      priceCdf: 0,
      streams: 0,
      trackCount: 0,
      releaseDate: song.releaseDate || song.publishedAt || song.createdAt || ""
    };
    current.priceCdf += Number(song.priceCdf || 0);
    current.streams += Number(song.streams || 0);
    current.trackCount += 1;
    current.releaseDate = releaseDateValue(song) > releaseDateValue(current) ? (song.releaseDate || song.publishedAt || song.createdAt || current.releaseDate) : current.releaseDate;
    grouped.set(key, current);
  });
  return [...grouped.values()];
}

function renderEmptyState(title, message) {
  return `
    <div class="empty-state">
      <strong>${title}</strong>
      <div class="muted">${message}</div>
    </div>
  `;
}

function renderSongCard(song, featured = false) {
  return `
    <article class="card release-card ${featured ? "release-card-featured" : ""}">
      <div class="cover-art">${String(song.title || "M").slice(0, 1).toUpperCase()}</div>
      <div class="release-body">
        <div class="row" style="justify-content:space-between">
          <span class="badge info">${song.genre || "Music"}</span>
          <strong>${fmt.format(Number(song.priceCdf || 0))} CDF</strong>
        </div>
        <h3>${song.title}</h3>
        <div class="muted">${songArtist(song)}</div>
        <div class="muted">${song.duration || "03:00"} · ${fmt.format(Number(song.streams || 0))} plays</div>
        <div class="actions">
          <button class="primary" data-action="buy-song" data-id="${song.id}">Buy request</button>
        </div>
      </div>
    </article>
  `;
}

function renderAlbumCard(album) {
  return `
    <article class="card album-card">
      <div class="album-cover">${String(album.title || "A").slice(0, 1).toUpperCase()}</div>
      <div>
        <div class="row" style="justify-content:space-between">
          <span class="badge info">${album.genre || "Album"}</span>
          <span class="muted">${fmt.format(Number(album.trackCount || album.songsCount || 0))} tracks</span>
        </div>
        <h3>${album.title}</h3>
        <div class="muted">${album.artist || album.artistName || "Unknown artist"}</div>
        <div class="album-meta">
          <strong>${fmt.format(Number(album.priceCdf || 0))} CDF</strong>
          <button class="secondary" data-action="view-album" data-album="${album.title}">View album</button>
        </div>
      </div>
    </article>
  `;
}

function renderArtistCard(artist) {
  const followers = Number(artist.followers || artist.followersCount || 0);
  return `
    <article class="artist-tile">
      <div class="artist-avatar">${String(artist.name || "A").slice(0, 1).toUpperCase()}</div>
      <div>
        <strong>${artist.name || "Unknown artist"}</strong>
        <div class="muted">${artist.genre || "Music"} · ${artist.city || "DRC"}</div>
        <div class="muted">${fmt.format(followers)} followers</div>
      </div>
      <span class="badge ${artist.verified ? "good" : "wait"}">${artist.verified ? "Verified" : "New"}</span>
    </article>
  `;
}

function openPurchase(song) {
  state.selectedSong = song;
  render();
}

async function submitRequest(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const songId = String(form.get("songId") || "");
  const operator = String(form.get("operator") || "");
  const payerPhone = String(form.get("payerPhone") || "").trim();
  const transferReference = String(form.get("transferReference") || "").trim();
  const song = state.songs.find((entry) => entry.id === songId);
  if (!song) return;

  try {
    const response = await fetch(`${API_BASE}/api/purchases`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        songId,
        method: "Mobile Money",
        operator,
        payerPhone,
        transferReference,
        amountCdf: song.priceCdf
      })
    });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const purchase = normalizePurchase(await response.json());
    state.purchases = [purchase, ...state.purchases];
    state.selectedSong = null;
    toast("Request sent", "Wait for admin approval after transfer verification.");
    render();
    persist();
  } catch (error) {
    const purchase = normalizePurchase({
      id: `offline-${Date.now()}`,
      songId,
      method: "Mobile Money",
      operator,
      payerPhone,
      transferReference,
      amountCdf: song.priceCdf,
      status: "pending_review",
      createdAt: new Date().toISOString()
    });
    state.purchases = [purchase, ...state.purchases];
    state.selectedSong = null;
    toast("Offline request saved", String(error.message || error));
    render();
    persist();
  }
}

function renderPurchaseModal() {
  if (!state.selectedSong) return "";
  const song = state.selectedSong;
  return `
    <div class="modal-backdrop" id="purchase-modal">
      <div class="modal">
        <div class="row" style="justify-content:space-between; align-items:flex-start">
          <div>
            <div class="eyebrow">Manual payment request</div>
            <h2 style="margin:12px 0 6px">${song.title}</h2>
            <div class="muted">${songArtist(song)} - ${song.genre}</div>
          </div>
          <button class="ghost" data-action="close-modal">Close</button>
        </div>
        <form class="stack" id="purchase-form" style="margin-top:18px">
          <input type="hidden" name="songId" value="${song.id}" />
          <div class="field">
            <label class="muted">Choose operator</label>
            <select name="operator" required>
              ${operators.map((operator) => `<option value="${operator}">${operator}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label class="muted">Your phone number</label>
            <input name="payerPhone" placeholder="+243..." required />
          </div>
          <div class="field">
            <label class="muted">Transfer reference</label>
            <input name="transferReference" placeholder="Optional, helps admin verify faster" />
          </div>
          <div class="row" style="justify-content:space-between; align-items:center">
            <strong>${fmt.format(song.priceCdf)} CDF</strong>
            <button class="primary" type="submit">Send request</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function render() {
  if (state.loading) {
    root.innerHTML = `<div class="shell"><div class="panel section">Loading...</div></div>`;
    return;
  }

  if (!state.currentUser) {
    const isRegister = state.authMode === "register";
    root.innerHTML = `
      <div class="shell auth-shell">
        <header class="topbar">
          <div class="brand">
            <div class="mark">L</div>
            <div>
              <div>Muziki Listener Portal</div>
              <div class="muted">Client access</div>
            </div>
          </div>
          <button class="ghost" data-action="set-api-base">API</button>
        </header>
        <main class="auth-layout">
          <section>
            <div class="eyebrow">Listener account</div>
            <h1>Enter the catalog with your listener account.</h1>
            <p>Use one email for your purchases so approved songs and albums can be unlocked for the right account.</p>
          </section>
          <section class="panel section auth-card">
            <div class="auth-tabs">
              <button class="${state.authMode === "login" ? "primary" : "ghost"}" data-action="auth-mode" data-mode="login">Log in</button>
              <button class="${isRegister ? "primary" : "ghost"}" data-action="auth-mode" data-mode="register">Create account</button>
            </div>
            <form class="stack" id="auth-form">
              ${isRegister ? `
                <div class="field">
                  <label class="muted">Full name</label>
                  <input name="fullName" placeholder="Your name" required />
                </div>
              ` : ""}
              <div class="field">
                <label class="muted">Email</label>
                <input name="email" type="email" placeholder="your@email.com" required />
              </div>
              <div class="field">
                <label class="muted">Password</label>
                <input name="password" type="password" minlength="8" placeholder="At least 8 characters" required />
              </div>
              <button class="primary" type="submit">${isRegister ? "Create account" : "Log in"}</button>
            </form>
          </section>
        </main>
      </div>
      <div class="toast-stack"></div>
    `;
    document.getElementById("auth-form")?.addEventListener("submit", authenticate);
    document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.action === "set-api-base") setApiBase();
      if (button.dataset.action === "auth-mode") {
        state.authMode = button.dataset.mode || "login";
        render();
      }
    }));
    return;
  }

  const q = state.query.trim().toLowerCase();
  const filteredSongs = state.songs.filter((song) => {
    const haystack = `${song.title} ${songArtist(song)} ${song.genre}`.toLowerCase();
    const matchesQuery = !q || haystack.includes(q);
    const matchesGenre = state.genre === "All" || song.genre === state.genre;
    return matchesQuery && matchesGenre;
  });
  const completed = state.purchases.filter((purchase) => purchase.status === "completed");
  const pending = state.purchases.filter((purchase) => purchase.status !== "completed");
  const albums = buildAlbums();
  const trendingSongs = [...state.songs].sort(compareTrending).slice(0, 6);
  const newSongs = [...state.songs].sort(compareNewest).slice(0, 6);
  const trendingAlbums = [...albums].sort(compareTrending).slice(0, 4);
  const newAlbums = [...albums].sort(compareNewest).slice(0, 4);
  const trendingArtists = [...state.artists].sort(compareTrending).slice(0, 6);

  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="mark">L</div>
          <div>
            <div>Muziki Listener Portal</div>
            <div class="muted">Browse, request, and wait for admin approval</div>
          </div>
        </div>
          <div class="row">
          <span class="badge info">${state.currentUser.fullName || state.currentUser.email}</span>
          <span class="badge good">${completed.length} unlocked</span>
          <span class="badge wait">${pending.length} pending</span>
          <button class="ghost" data-action="set-api-base">API</button>
          <button class="ghost" data-action="sign-out">Sign out</button>
        </div>
      </header>

      <section class="hero">
        <div>
          <div class="eyebrow">Listener desk</div>
          <h1>Buy music in the browser with a simple operator-based payment request.</h1>
          <p>Discover trending songs, rising artists, new albums, and fresh releases before sending a mobile-money payment request for the music you want.</p>
          <div class="cta">
            <button class="primary" data-action="scroll-discovery">Explore home</button>
            <button class="secondary" data-action="scroll-catalog">Browse catalog</button>
            <button class="secondary" data-action="scroll-requests">Open requests</button>
          </div>
        </div>
        <div class="grid">
          <div class="metric"><strong>${fmt.format(state.songs.reduce((sum, song) => sum + Number(song.priceCdf || 0), 0))} CDF</strong><span class="muted">catalog value</span></div>
          <div class="metric"><strong>${completed.length}</strong><span class="muted">approved buys</span></div>
          <div class="metric"><strong>${state.songs.length}</strong><span class="muted">songs available</span></div>
          <div class="metric"><strong>${albums.length}</strong><span class="muted">albums available</span></div>
        </div>
      </section>

      <section class="discovery" id="discovery">
        <div class="section-title">
          <div>
            <div class="eyebrow">Home</div>
            <h2>What listeners should notice first</h2>
          </div>
          <button class="ghost" data-action="refresh">Refresh</button>
        </div>

        <div class="feature-grid">
          <section class="panel section feature-panel">
            <div class="section-head">
              <div><h2>Trending songs</h2><p>Ranked from streams, purchases, and recent activity.</p></div>
            </div>
            <div class="release-list">
              ${trendingSongs.map((song, index) => `
                <div class="ranked-row">
                  <span class="rank">${index + 1}</span>
                  <div>
                    <strong>${song.title}</strong>
                    <div class="muted">${songArtist(song)} · ${song.genre || "Music"}</div>
                  </div>
                  <div class="rank-action">
                    <span>${fmt.format(Number(song.priceCdf || 0))} CDF</span>
                    <button class="primary" data-action="buy-song" data-id="${song.id}">Buy</button>
                  </div>
                </div>
              `).join("")}
              ${trendingSongs.length === 0 ? renderEmptyState("No trending songs yet.", "Once artists publish music and listeners interact with it, the ranking will appear here.") : ""}
            </div>
          </section>

          <section class="panel section feature-panel">
            <div class="section-head">
              <div><h2>Trending albums</h2><p>Albums grouped from real releases.</p></div>
            </div>
            <div class="album-grid">
              ${trendingAlbums.map((album) => renderAlbumCard(album)).join("")}
              ${trendingAlbums.length === 0 ? renderEmptyState("No trending albums yet.", "Albums will appear after artists upload album metadata or grouped album releases.") : ""}
            </div>
          </section>
        </div>

        <section class="panel section">
          <div class="section-head">
            <div><h2>Trending artists</h2><p>Artists gaining followers, streams, or verified catalog activity.</p></div>
          </div>
          <div class="artist-strip">
            ${trendingArtists.map((artist) => renderArtistCard(artist)).join("")}
            ${trendingArtists.length === 0 ? renderEmptyState("No trending artists yet.", "Registered artists will appear here after they create profiles and publish music.") : ""}
          </div>
        </section>

        <div class="feature-grid">
          <section class="panel section feature-panel">
            <div class="section-head">
              <div><h2>New songs</h2><p>The freshest tracks in the catalog.</p></div>
            </div>
            <div class="cards compact-cards">
              ${newSongs.map((song) => renderSongCard(song)).join("")}
              ${newSongs.length === 0 ? renderEmptyState("No new songs yet.", "New uploads will land here as soon as artists publish them.") : ""}
            </div>
          </section>

          <section class="panel section feature-panel">
            <div class="section-head">
              <div><h2>New albums</h2><p>Latest album releases and collections.</p></div>
            </div>
            <div class="album-grid">
              ${newAlbums.map((album) => renderAlbumCard(album)).join("")}
              ${newAlbums.length === 0 ? renderEmptyState("No new albums yet.", "Album releases will appear here once album data exists.") : ""}
            </div>
          </section>
        </div>
      </section>

      <section class="panel section" id="catalog">
        <div class="section-head">
          <div>
            <h2>Catalog</h2>
            <p>Pick a track to start a payment request.</p>
          </div>
          <div style="min-width:min(360px, 100%)">
            <input class="search" id="search" placeholder="Search songs, artists, genres" value="${state.query}" />
            <div class="chips">
              ${["All", "Rumba Fusion", "Afrobeats", "Ndombolo", "Soukous"].map((genre) => `
                <button class="ghost ${state.genre === genre ? "primary" : ""}" data-action="genre" data-genre="${genre}">${genre}</button>
              `).join("")}
            </div>
          </div>
        </div>
        <div class="cards">
          ${filteredSongs.map((song) => renderSongCard(song)).join("")}
          ${filteredSongs.length === 0 ? renderEmptyState("No songs published yet.", "When artists upload approved releases, they will appear here for listeners to buy.") : ""}
        </div>
      </section>

      <div class="content">
        <section class="panel section" id="requests">
          <div class="section-head">
            <div>
              <h2>Your requests</h2>
              <p>Track what is waiting, approved, or rejected.</p>
            </div>
          </div>
          <div class="stack">
            ${state.purchases.slice(0, 8).map((purchase) => {
              const song = state.songs.find((entry) => entry.id === purchase.songId);
              return `
                <div class="row-card">
                  <div class="row" style="justify-content:space-between; align-items:flex-start">
                    <div>
                      <strong>${song?.title || purchase.songId}</strong>
                      <div class="muted">${songArtist(song || {})} · ${purchase.operator || purchase.method}</div>
                      <div class="muted">${purchase.payerPhone || "No phone"}${purchase.transferReference ? ` · Ref ${purchase.transferReference}` : ""}</div>
                    </div>
                    <div style="text-align:right">
                      <div>${fmt.format(Number(purchase.amountCdf || 0))} CDF</div>
                      <div class="badge ${purchase.status === "completed" ? "good" : purchase.status === "failed" ? "warn" : "wait"}">${purchase.status}</div>
                    </div>
                  </div>
                </div>
              `;
            }).join("")}
            ${state.purchases.length === 0 ? `<div class="muted">No requests yet.</div>` : ""}
          </div>
        </section>

        <aside class="stack">
          <section class="panel section">
            <div class="section-head"><div><h2>How it works</h2><p>Simple manual approval flow.</p></div></div>
            <div class="stack">
              <div class="row-card"><strong>1. Choose a song</strong><div class="muted">Pick the item you want to buy.</div></div>
              <div class="row-card"><strong>2. Pick operator</strong><div class="muted">Vodacom, Airtel, Orange, or Africell.</div></div>
              <div class="row-card"><strong>3. Enter phone</strong><div class="muted">Use the number that will pay.</div></div>
              <div class="row-card"><strong>4. Wait for approval</strong><div class="muted">Admin confirms the transfer and unlocks the item.</div></div>
            </div>
          </section>

          <section class="panel section">
            <div class="section-head"><div><h2>Alerts</h2><p>Latest backend notifications.</p></div></div>
            <div class="stack">
              ${state.notifications.slice(0, 4).map((notification) => `
                <div class="row-card">
                  <strong>${notification.title}</strong>
                  <div class="muted">${notification.message}</div>
                </div>
              `).join("")}
              ${state.notifications.length === 0 ? `<div class="muted">No alerts yet.</div>` : ""}
            </div>
          </section>
        </aside>
      </div>

      <footer class="footer">
        <div><strong>Muziki Listener Portal</strong><div class="muted">Browser-based buying flow for DRC listeners.</div></div>
        <div class="row"><button class="ghost" data-action="refresh">Refresh</button></div>
      </footer>
    </div>
    <div class="toast-stack"></div>
    ${renderPurchaseModal()}
  `;

  document.getElementById("search")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });
  document.getElementById("purchase-form")?.addEventListener("submit", submitRequest);

  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "set-api-base") setApiBase();
    if (action === "sign-out") signOut();
    if (action === "refresh") bootstrap();
    if (action === "scroll-discovery") document.getElementById("discovery")?.scrollIntoView({ behavior: "smooth" });
    if (action === "scroll-catalog") document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" });
    if (action === "scroll-requests") document.getElementById("requests")?.scrollIntoView({ behavior: "smooth" });
    if (action === "view-album") {
      state.query = button.dataset.album || "";
      render();
      window.setTimeout(() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" }), 0);
    }
    if (action === "genre") {
      state.genre = button.dataset.genre || "All";
      render();
    }
    if (action === "buy-song") {
      state.selectedSong = state.songs.find((song) => song.id === button.dataset.id) || null;
      render();
    }
    if (action === "close-modal") {
      state.selectedSong = null;
      render();
    }
  }));
}

bootstrap();
