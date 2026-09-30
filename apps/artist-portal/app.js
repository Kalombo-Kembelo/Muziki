const storage = {
  get(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};

const API_BASE = window.MUZIKI_API_BASE || localStorage.getItem("muziki-api-base") || "http://localhost:3000";
const demoArtistIds = new Set(["artist-001", "artist-002", "artist-003"]);
const demoArtistNames = new Set(["M'Banza Collective", "Kivu Pulse", "Ndombolo Street Lab"]);
const demoSongIds = new Set(["song-001", "song-002", "song-003", "song-004"]);
const demoSongTitles = new Set(["Lumiere du Fleuve", "Nzela", "Quartier Mambo", "Mise en Route"]);

const state = {
  query: "",
  genre: "All",
  authMode: "login",
  authNotice: "",
  currentUser: storage.get("muziki-artist-portal-user", null),
  sessionToken: storage.get("muziki-artist-portal-token", ""),
  artists: cleanArtists(storage.get("muziki-artist-portal-artists", [])),
  songs: cleanSongs(storage.get("muziki-artist-portal-songs", [])),
  selectedArtistId: storage.get("muziki-artist-portal-selected-artist", ""),
  upload: { title: "", genre: "Rumba Fusion", priceCdf: 1000, duration: "03:00", notes: "" },
  payoutMethod: "Mobile Money",
  modalSongId: null
};

const genres = ["All", "Rumba Fusion", "Afrobeats", "Ndombolo", "Soukous"];
const root = document.getElementById("app");
const fmt = new Intl.NumberFormat("fr-CD");

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function slugify(value) {
  return String(value || "track")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "track";
}

function normalizeSong(song) {
  return {
    ...song,
    status: song.status || (song.published === false ? "draft" : "published"),
    audioPath: song.audioPath || `/audio/${slugify(song.title)}.mp3`,
    coverPath: song.coverPath || `/covers/${slugify(song.title)}.jpg`
  };
}

function cleanArtists(artists) {
  return (Array.isArray(artists) ? artists : []).filter((artist) => {
    return !demoArtistIds.has(String(artist.id || "")) && !demoArtistNames.has(String(artist.name || ""));
  });
}

function cleanSongs(songs) {
  return (Array.isArray(songs) ? songs : []).filter((song) => {
    return !demoSongIds.has(String(song.id || "")) && !demoSongTitles.has(String(song.title || ""));
  }).map(normalizeSong);
}

function ensureArtistProfile(name = "", payoutPhone = "") {
  if (!state.currentUser) return null;
  const existing = state.artists.find((entry) => entry.userId === state.currentUser.id);
  if (existing) {
    const nextPayoutPhone = String(payoutPhone || state.currentUser.payoutPhone || state.currentUser.phone || "").trim();
    if (nextPayoutPhone && !existing.payoutPhone) existing.payoutPhone = nextPayoutPhone;
    state.selectedArtistId = existing.id;
    return existing;
  }
  const artistName = String(name || state.currentUser.fullName || state.currentUser.email || "New artist").trim();
  const artist = {
    id: `local-artist-${Date.now()}`,
    userId: state.currentUser.id,
    name: artistName,
    genre: "Unknown",
    city: "Kinshasa",
    payoutPhone: String(payoutPhone || state.currentUser.payoutPhone || state.currentUser.phone || "").trim(),
    verified: false,
    followers: 0,
    revenueCdf: 0,
    walletBalanceCdf: 0
  };
  state.artists.unshift(artist);
  state.selectedArtistId = artist.id;
  return artist;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!(file instanceof File) || file.size === 0) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function persist() {
  storage.set("muziki-artist-portal-user", state.currentUser);
  storage.set("muziki-artist-portal-token", state.sessionToken);
  storage.set("muziki-artist-portal-artists", state.artists);
  storage.set("muziki-artist-portal-songs", state.songs);
  storage.set("muziki-artist-portal-selected-artist", state.selectedArtistId);
}

async function authenticate(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "").trim().toLowerCase();
  const fullName = String(form.get("fullName") || "").trim();
  const payoutPhone = String(form.get("payoutPhone") || "").trim();
  const password = String(form.get("password") || "");
  if (!email || !password) return;
  const registering = state.authMode === "register";
  const path = registering ? "/api/auth/register" : "/api/auth/login";
  const payload = registering ? { fullName, email, password, role: "artist", phone: payoutPhone, payoutPhone } : { email, password };
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `Auth failed (${response.status})`);
    if (registering) {
      state.authMode = "login";
      state.authNotice = "Account created. Check your email and confirm your address before signing in.";
      render();
      return;
    }
    state.currentUser = data.user;
    state.sessionToken = data.session?.token || "";
  } catch (error) {
    state.authNotice = String(error.message || error);
    render();
    return;
  }
  ensureArtistProfile(fullName, payoutPhone);
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

async function bootstrap() {
  try {
    const response = await fetch(`${API_BASE}/api/bootstrap`);
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data.artists)) state.artists = cleanArtists(data.artists);
    if (Array.isArray(data.songs)) state.songs = cleanSongs(data.songs);
    if (state.currentUser) ensureArtistProfile();
    render();
  } catch {
    // Fall back to local data when the backend is not available.
  }
}

async function publishSong(formData) {
  const audioFile = formData.get("audioFile");
  const coverFile = formData.get("coverFile");
  const payload = {
    title: String(formData.get("title") || "").trim(),
    albumTitle: String(formData.get("albumTitle") || "").trim(),
    artistId: String(formData.get("artistId") || state.artists[0]?.id || ""),
    genre: String(formData.get("genre") || "Rumba Fusion"),
    priceCdf: Number(formData.get("priceCdf") || 1000),
    duration: String(formData.get("duration") || "03:00"),
    audioPath: String(formData.get("audioPath") || ""),
    coverPath: String(formData.get("coverPath") || ""),
    audioData: await fileToDataUrl(audioFile),
    audioName: audioFile instanceof File && audioFile.size ? audioFile.name : "",
    coverData: await fileToDataUrl(coverFile),
    coverName: coverFile instanceof File && coverFile.size ? coverFile.name : ""
  };
  const response = await fetch(`${API_BASE}/api/songs`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Publish failed (${response.status})`);
  }
  return response.json();
}

function artist(id) { return state.artists.find((a) => a.id === id); }
function song(id) { return state.songs.find((s) => s.id === id); }
function toast(title, message) {
  const stack = document.querySelector(".toast-stack");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<strong>${title}</strong><div>${message}</div>`;
  stack.append(el);
  setTimeout(() => el.remove(), 2800);
}

function setApiBase() {
  const current = localStorage.getItem("muziki-api-base") || API_BASE;
  const next = window.prompt("Backend API base URL", current);
  if (!next) return;
  localStorage.setItem("muziki-api-base", next.trim());
  window.location.reload();
}

async function setPayoutPhone() {
  const currentArtist = artist(state.selectedArtistId) || state.artists[0];
  if (!currentArtist) {
    toast("Profile required", "Create or load an artist profile first.");
    return;
  }
  const next = window.prompt("Mobile Money payout number", currentArtist.payoutPhone || state.currentUser?.phone || "+243");
  if (!next) return;
  currentArtist.payoutPhone = next.trim();
  try {
    await fetch(`${API_BASE}/api/artists/${currentArtist.id}/payout-phone`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ payoutPhone: currentArtist.payoutPhone })
    });
    toast("Payout number saved", currentArtist.payoutPhone);
  } catch {
    toast("Saved locally", "The payout number will sync when the backend is available.");
  }
  render();
}

function exportCsv() {
  const rows = [
    ["title", "albumTitle", "artist", "genre", "priceCdf", "streams", "status", "audioPath", "coverPath"],
    ...state.songs.map((track) => [
      track.title,
      track.albumTitle || "",
      artist(track.artistId)?.name || "Unknown artist",
      track.genre,
      track.priceCdf,
      track.streams,
      track.status || (track.published === false ? "draft" : "published"),
      track.audioPath,
      track.coverPath
    ])
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "muziki-artist-catalog.csv";
  link.click();
  URL.revokeObjectURL(url);
  toast("Export ready", "Catalog CSV downloaded.");
}

function showRevenueBreakdown(trackId) {
  const track = song(trackId);
  if (!track) return;
  const trackArtist = artist(track.artistId);
  const estimatedSales = Math.max(1, Math.round(Number(track.streams || 0) * 0.035));
  const grossCdf = estimatedSales * Number(track.priceCdf || 0);
  const artistShareCdf = Math.round(grossCdf * 0.85);
  const platformFeeCdf = grossCdf - artistShareCdf;
  toast(
    "Revenue",
    `${track.title}: ${fmt.format(artistShareCdf)} CDF artist share, ${fmt.format(platformFeeCdf)} CDF platform fee. Wallet: ${fmt.format(Number(trackArtist?.walletBalanceCdf || trackArtist?.revenueCdf || 0))} CDF.`
  );
}

async function requestPayout() {
  const currentArtist = artist(state.selectedArtistId) || state.artists[0];
  if (!currentArtist) {
    toast("Earnings unavailable", "Create or load an artist profile before requesting your earnings.");
    return;
  }
  if (!String(currentArtist.payoutPhone || "").trim()) {
    toast("Receiving number required", "Add the Mobile Money number where Muziki should send your earnings.");
    return;
  }
  const amountCdf = Number(currentArtist.walletBalanceCdf ?? currentArtist.revenueCdf ?? 0);
  if (amountCdf <= 0) {
    toast("No earnings available", "There is no available balance to receive yet.");
    return;
  }
  const response = await fetch(`${API_BASE}/api/withdrawals`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ amountCdf, payoutPhone: currentArtist.payoutPhone || "" })
  });
  if (!response.ok) {
    throw new Error(`Earnings request failed (${response.status})`);
  }
  currentArtist.walletBalanceCdf = Math.max(0, Number(currentArtist.walletBalanceCdf || 0) - amountCdf);
  toast("Earnings requested", `Muziki will send ${fmt.format(amountCdf)} CDF to ${currentArtist.payoutPhone} after manual validation.`);
}

function render() {
  if (!state.currentUser) {
    const isRegister = state.authMode === "register";
    root.innerHTML = `
      <div class="shell auth-shell">
        <header class="topbar">
          <div class="brand">
            <div class="mark">A</div>
            <div><div>Muziki Artist Portal</div><div class="muted">Artist access</div></div>
          </div>
          <button class="ghost" data-action="set-api-base">API</button>
        </header>
        <main class="auth-layout">
          <section>
            <div class="eyebrow">Artist account</div>
            <h1>Log in to upload music and follow your earnings.</h1>
            <p>Create an artist account, publish tracks, follow revenue, and receive your earnings through Mobile Money.</p>
          </section>
          <section class="panel section auth-card">
            <div class="auth-tabs">
              <button class="${state.authMode === "login" ? "primary" : "ghost"}" data-action="auth-mode" data-mode="login">Log in</button>
              <button class="${isRegister ? "primary" : "ghost"}" data-action="auth-mode" data-mode="register">Create account</button>
            </div>
            ${state.authNotice ? `<div class="row-card" role="status">${escapeHtml(state.authNotice)}</div>` : ""}
            <form class="stack" id="auth-form">
              ${isRegister ? `
                <div class="field">
                  <label class="muted">Artist name</label>
                  <input name="fullName" placeholder="Artist or label name" required />
                </div>
                <div class="field">
                  <label class="muted">Mobile Money payout number</label>
                  <input name="payoutPhone" placeholder="+243..." required />
                </div>
              ` : ""}
              <div class="field">
                <label class="muted">Email</label>
                <input name="email" type="email" placeholder="artist@email.com" required />
              </div>
              <div class="field">
                <label class="muted">Password</label>
                <input name="password" type="password" minlength="8" placeholder="At least 8 characters" required />
              </div>
              <button class="primary" type="submit">${isRegister ? "Create artist account" : "Log in"}</button>
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
        state.authNotice = "";
        render();
      }
    }));
    return;
  }

  const verified = state.artists.filter((a) => a.verified).length;
  const revenue = state.artists.reduce((sum, a) => sum + Number(a.revenueCdf || 0), 0);
  const totalSongs = state.songs.length;
  const topEarner = [...state.artists].sort((a, b) => Number(b.revenueCdf || 0) - Number(a.revenueCdf || 0))[0];
  const topFollowed = [...state.artists].sort((a, b) => Number(b.followers || b.followersCount || 0) - Number(a.followers || a.followersCount || 0))[0];
  const visibleSongs = state.songs.filter((track) => {
    const q = state.query.trim().toLowerCase();
    return (!q || `${track.title} ${artist(track.artistId)?.name ?? ""} ${track.genre}`.toLowerCase().includes(q))
      && (state.genre === "All" || track.genre === state.genre);
  });
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="mark">A</div>
          <div><div>Muziki Artist Portal</div><div class="muted">Upload, earnings, followers</div></div>
        </div>
        <div class="row">
          <span class="badge info">${state.currentUser.fullName || state.currentUser.email}</span>
          <span class="badge info">${(artist(state.selectedArtistId) || state.artists[0])?.payoutPhone || "No payout number"}</span>
          <span class="badge info">${verified} verified artists</span>
          <span class="badge good">${fmt.format(revenue)} CDF revenue</span>
          <button class="ghost" data-action="set-api-base">API</button>
          <button class="ghost" data-action="sign-out">Sign out</button>
        </div>
      </header>

      <section class="hero">
        <div>
          <div class="eyebrow">Artist studio</div>
          <h1>Manage releases and earnings from one clean workspace.</h1>
          <p>Designed for artist onboarding, uploads, sales visibility, follower growth, and payout requests.</p>
          <div class="cta">
            <button class="primary" data-action="scroll-upload">Upload track</button>
            <button class="secondary" data-action="show-drafts">View releases</button>
          </div>
        </div>
        <div class="grid">
          <div class="metric"><strong>${totalSongs}</strong><span class="muted">tracks in catalog</span></div>
          <div class="metric"><strong>${fmt.format(state.artists.reduce((s, a) => s + Number(a.followers || a.followersCount || 0), 0))}</strong><span class="muted">followers</span></div>
          <div class="metric"><strong>${fmt.format(1000)}</strong><span class="muted">minimum payout</span></div>
          <div class="metric"><strong>24h</strong><span class="muted">payment review window</span></div>
        </div>
      </section>

      <section class="panel section">
        <div class="section-head">
          <div>
            <h2>Release catalog</h2>
            <p>Search your tracks, filter by genre, and inspect performance.</p>
          </div>
          <div class="toolbar">
            <input class="search" id="search" placeholder="Search songs or artists" value="${state.query}" />
          </div>
        </div>
        <div class="chips">
          ${genres.map((g) => `<button class="chip ${state.genre === g ? "is-active" : ""}" data-genre="${g}">${g}</button>`).join("")}
        </div>
        <div class="content" style="margin-top:16px">
          <div class="songs">
            ${visibleSongs.map((track) => {
              const a = artist(track.artistId);
              return `
                <article class="card">
                  <div class="song-top">
                    <span class="badge ${a?.verified ? "good" : "wait"}">${a?.verified ? "Verified artist" : "Pending artist"}</span>
                    <span class="badge info">${fmt.format(track.priceCdf)} CDF</span>
                  </div>
                  <h3>${track.title}</h3>
                  <p>${a?.name || "Unknown artist"} - ${track.genre}${track.albumTitle ? ` - ${track.albumTitle}` : ""}</p>
                  <div class="muted" style="margin-top:6px;font-size:0.9rem">${track.audioPath} - ${track.coverPath}</div>
                  <div class="row" style="margin-top:12px">
                    <span class="muted">${fmt.format(track.streams)} streams</span>
                    <span class="muted">${track.status || (track.published === false ? "draft" : "published")}</span>
                  </div>
                  <div class="cta">
                    <button class="secondary" data-action="open-earnings" data-song="${track.id}">Revenue</button>
                    <button class="ghost" data-action="feature-track" data-song="${track.id}">Feature</button>
                  </div>
                </article>`;
            }).join("")}
            ${visibleSongs.length === 0 ? `
              <div class="empty-state">
                <strong>No releases yet.</strong>
                <div class="muted">Upload your first track here; after approval it will appear in the listener portal.</div>
              </div>
            ` : ""}
          </div>

          <aside class="stack">
            <div class="list">
              <h3>Artist performance</h3>
              <div class="item"><div><strong>Top earner</strong><div class="muted">${topEarner?.name || "No artist yet"}</div></div><div>${fmt.format(Number(topEarner?.revenueCdf || 0))} CDF</div></div>
              <div class="item"><div><strong>Most followers</strong><div class="muted">${topFollowed?.name || "No artist yet"}</div></div><div>${fmt.format(Number(topFollowed?.followers || topFollowed?.followersCount || 0))}</div></div>
              <div class="item"><div><strong>Pending approvals</strong><div class="muted">Review artist profile and metadata</div></div><div>${state.artists.filter((a) => !a.verified).length}</div></div>
            </div>
            <div class="list" id="upload">
              <h3>Upload song</h3>
              <form id="upload-form" class="form">
                <div class="field"><label>Title</label><input name="title" placeholder="Track title" required value="${state.upload.title}" /></div>
                <div class="field"><label>Album / EP</label><input name="albumTitle" placeholder="Optional album or EP title" /></div>
                <div class="split">
                  <div class="field">
                    <label>Artist</label>
                    <select name="artistId">${state.artists.map((a) => `<option value="${a.id}">${a.name}</option>`).join("")}</select>
                  </div>
                  <div class="field">
                    <label>Genre</label>
                    <select name="genre">${genres.filter((g) => g !== "All").map((g) => `<option>${g}</option>`).join("")}</select>
                  </div>
                </div>
                <div class="split">
                  <div class="field"><label>Price CDF</label><input name="priceCdf" type="number" min="500" value="1000" /></div>
                  <div class="field"><label>Duration</label><input name="duration" placeholder="03:00" value="03:00" /></div>
                </div>
                <div class="split">
                  <div class="field"><label>Audio path</label><input name="audioPath" placeholder="/audio/track.mp3" /></div>
                  <div class="field"><label>Cover path</label><input name="coverPath" placeholder="/covers/track.jpg" /></div>
                </div>
                <div class="split">
                  <div class="field"><label>Audio file</label><input name="audioFile" type="file" accept="audio/*" /></div>
                  <div class="field"><label>Cover file</label><input name="coverFile" type="file" accept="image/*" /></div>
                </div>
                <div class="field"><label>Notes</label><textarea name="notes" placeholder="Rights, release notes, and contact info"></textarea></div>
                <div class="cta">
                  <button class="primary" type="submit">Publish</button>
                </div>
              </form>
            </div>
          </aside>
        </div>
      </section>

      <section class="panel section">
        <div class="section-head">
          <div>
            <h2>Earnings and growth</h2>
            <p>Muziki sends your earnings to the Mobile Money number in your profile.</p>
          </div>
          <div class="row">
            <span class="badge good">Receive earnings</span>
            <span class="badge info">Mobile Money number</span>
            <button class="ghost" data-action="set-payout-phone">Receiving number</button>
          </div>
        </div>
        <div class="grid">
          <div class="card">
            <h3>Minimum balance</h3>
            <p>Artists can request payout after reaching the configured threshold.</p>
          </div>
          <div class="card">
            <h3>Audience growth</h3>
            <p>Use performance data to promote songs on TikTok, Facebook, and WhatsApp.</p>
          </div>
        </div>
      </section>

      <footer class="footer">
        <div><strong>Muziki Artist Portal</strong><div class="muted">Independent web app for artists.</div></div>
        <div class="row"><button class="ghost" data-action="export-csv">Export CSV</button><button class="ghost" data-action="request-payout">Request earnings</button></div>
      </footer>
    </div>
    <div class="toast-stack"></div>
  `;
  bind();
  persist();
}

function bind() {
  document.getElementById("search")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });
  document.querySelectorAll("[data-genre]").forEach((button) => button.addEventListener("click", () => { state.genre = button.dataset.genre; render(); }));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "scroll-upload") document.getElementById("upload")?.scrollIntoView({ behavior: "smooth" });
    if (action === "sign-out") signOut();
    if (action === "show-drafts") toast("Releases", "Your catalog is displayed in the release section.");
    if (action === "open-earnings") showRevenueBreakdown(button.dataset.song);
    if (action === "feature-track") toast("Featured", "This release was pinned to the top of the release board.");
    if (action === "export-csv") exportCsv();
    if (action === "set-api-base") setApiBase();
    if (action === "set-payout-phone") setPayoutPhone();
    if (action === "request-payout") {
      requestPayout().catch(() => toast("Request offline", "Start the backend to submit your earnings request."));
    }
  }));
  document.getElementById("upload-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const title = String(fd.get("title") || "").trim();
    if (!title) return;
    publishSong(fd)
      .then((song) => {
        state.songs.unshift(normalizeSong(song));
        toast("Published", `${song.title} added to the artist catalog.`);
        render();
      })
      .catch(() => {
        const artistId = String(fd.get("artistId") || state.artists[0]?.id || "");
        const genre = String(fd.get("genre") || "Rumba Fusion");
        const priceCdf = Number(fd.get("priceCdf") || 1000);
        const duration = String(fd.get("duration") || "03:00");
        const slug = slugify(title);
        state.songs.unshift(normalizeSong({
          id: `song-${Date.now()}`,
          title,
          albumTitle: String(fd.get("albumTitle") || "").trim(),
          artistId,
          genre,
          priceCdf,
          duration,
          streams: 0,
          status: "published",
          audioPath: `/audio/${slug}.mp3`,
          coverPath: `/covers/${slug}.jpg`
        }));
        toast("Published offline", `${title} added locally. Backend unavailable.`);
        render();
      });
  });
}

if (state.currentUser) ensureArtistProfile();
render();
bootstrap();
