const root = document.getElementById("app");
const storage = {
  get(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};

const API_BASE = window.MUZIKI_API_BASE || localStorage.getItem("muziki-api-base") || "http://localhost:3000";
const demoArtistIds = new Set(["artist-001", "artist-002", "artist-003", "artist-004"]);
const demoArtistNames = new Set(["M'Banza Collective", "Kivu Pulse", "Ndombolo Street Lab", "Kasai Echo"]);
const demoPaymentIds = new Set(["pay-001", "pay-002"]);
const demoClaimIds = new Set(["claim-001", "claim-002"]);
const demoNotificationIds = new Set(["notif-001"]);

const state = {
  query: "",
  section: "verification",
  currentUser: storage.get("muziki-admin-user", null),
  sessionToken: storage.get("muziki-admin-token", ""),
  artists: cleanArtists(storage.get("muziki-admin-artists", [])),
  claims: cleanClaims(storage.get("muziki-admin-claims", [])),
  notifications: cleanNotifications(storage.get("muziki-admin-notifications", [])),
  payments: cleanPayments(storage.get("muziki-admin-payments", []))
};

const fmt = new Intl.NumberFormat("fr-CD");

function cleanArtists(artists) {
  return (Array.isArray(artists) ? artists : []).filter((artist) => {
    return !demoArtistIds.has(String(artist.id || "")) && !demoArtistNames.has(String(artist.name || ""));
  });
}

function cleanPayments(payments) {
  return (Array.isArray(payments) ? payments : []).filter((payment) => {
    return !demoPaymentIds.has(String(payment.id || "")) && !String(payment.account || "").includes("Sample");
  });
}

function cleanClaims(claims) {
  return (Array.isArray(claims) ? claims : []).filter((claim) => !demoClaimIds.has(String(claim.id || "")));
}

function cleanNotifications(notifications) {
  return (Array.isArray(notifications) ? notifications : []).filter((notification) => !demoNotificationIds.has(String(notification.id || "")));
}

function persist() {
  storage.set("muziki-admin-user", state.currentUser);
  storage.set("muziki-admin-token", state.sessionToken);
  storage.set("muziki-admin-artists", state.artists);
  storage.set("muziki-admin-claims", state.claims);
  storage.set("muziki-admin-notifications", state.notifications);
  storage.set("muziki-admin-payments", state.payments);
}

function authHeaders() {
  return { "Content-Type": "application/json", ...(state.sessionToken ? { Authorization: `Bearer ${state.sessionToken}` } : {}) };
}

async function authenticate(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: String(form.get("email") || "").trim().toLowerCase(), password: String(form.get("password") || "") })
  });
  if (!response.ok) throw new Error("Email or password is invalid");
  const data = await response.json();
  if (data.user?.role !== "admin") throw new Error("This account is not an administrator account");
  state.currentUser = data.user;
  state.sessionToken = data.session?.token || "";
  persist();
  await bootstrap();
}

function signOut() {
  state.currentUser = null;
  state.sessionToken = "";
  persist();
  render();
}

async function bootstrap() {
  try {
    const response = await fetch(`${API_BASE}/api/bootstrap`);
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data.artists)) state.artists = cleanArtists(data.artists);
    if (Array.isArray(data.claims)) state.claims = cleanClaims(data.claims);
    if (Array.isArray(data.notifications)) state.notifications = cleanNotifications(data.notifications);
    const users = Array.isArray(data.users) ? data.users : [];
    const songs = Array.isArray(data.songs) ? data.songs : [];
    const livePurchases = Array.isArray(data.purchases) ? data.purchases.map((purchase, index) => ({
        id: purchase.id || `payment-${index}`,
        type: "Purchase",
        account: users.find((user) => user.id === (purchase.userId || ""))?.fullName
          || users.find((user) => user.id === (purchase.userId || ""))?.email
          || purchase.userId
          || "Unknown account",
        phone: purchase.payerPhone || users.find((user) => user.id === (purchase.userId || ""))?.phone || "",
        operator: purchase.operator || purchase.method || "Mobile Money",
        item: songs.find((song) => song.id === (purchase.songId || ""))?.title
          || songs.find((song) => song.id === (purchase.songId || ""))?.artist
          || purchase.songId
          || "Unknown item",
        amount: Number(purchase.amountCdf || 0),
        status: purchase.status === "completed" ? "Completed" : purchase.status === "failed" ? "Rejected" : purchase.status === "pending_review" ? "Pending review" : "Pending",
        transferReference: purchase.transferReference || "",
        merchantPhone: purchase.merchantPhone || "",
        payerPhone: purchase.payerPhone || "",
        purchaseId: purchase.id || "",
        songId: purchase.songId || "",
        userId: purchase.userId || ""
      })) : [];
    const liveWithdrawals = Array.isArray(data.withdrawals) ? data.withdrawals.map((withdrawal, index) => ({
      id: withdrawal.id || `withdrawal-${index}`,
      type: "Withdrawal",
      artist: state.artists.find((artist) => artist.id === (withdrawal.artistId || ""))?.name || "Unknown artist",
      payoutPhone: withdrawal.payoutPhone || state.artists.find((artist) => artist.id === (withdrawal.artistId || ""))?.payoutPhone || "",
      amount: Number(withdrawal.amountCdf || 0),
      status: withdrawal.status === "paid" || withdrawal.status === "approved" ? "Completed" : "Pending"
    })) : [];
    if (livePurchases.length || liveWithdrawals.length) state.payments = [...livePurchases, ...liveWithdrawals];
    render();
  } catch {
    // Keep the portal empty when backend is unavailable.
  }
}

async function approvePurchase(purchaseId) {
  const response = await fetch(`${API_BASE}/api/purchases/${purchaseId}/approve`, {
    method: "POST", headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error(`Approve failed (${response.status})`);
  }
  return response.json();
}

async function rejectPurchase(purchaseId) {
  const response = await fetch(`${API_BASE}/api/purchases/${purchaseId}/reject`, {
    method: "POST", headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error(`Reject failed (${response.status})`);
  }
  return response.json();
}

async function markWithdrawalPaid(withdrawalId) {
  const response = await fetch(`${API_BASE}/api/withdrawals/${withdrawalId}/paid`, {
    method: "POST", headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error(`Settlement failed (${response.status})`);
  }
  return response.json();
}

async function verifyArtist(artistId) {
  const response = await fetch(`${API_BASE}/api/artists/${artistId}/verify`, {
    method: "POST", headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error(`Verify failed (${response.status})`);
  }
  return response.json();
}

async function rejectArtist(artistId) {
  const response = await fetch(`${API_BASE}/api/artists/${artistId}/reject`, {
    method: "POST", headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error(`Reject failed (${response.status})`);
  }
  return response.json();
}

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

function render() {
  if (!state.currentUser) {
    root.innerHTML = `<main class="shell"><section class="panel section" style="max-width:480px;margin:12vh auto"><div class="eyebrow">Restricted access</div><h1>Muziki Admin</h1><p>Only the platform administrator can approve artists, purchases and withdrawals.</p><form id="login-form" class="form"><label class="field">Email<input name="email" type="email" required></label><label class="field">Password<input name="password" type="password" minlength="8" required></label><button class="primary" type="submit">Sign in securely</button></form></section></main>`;
    document.getElementById("login-form")?.addEventListener("submit", (event) => authenticate(event).catch((error) => alert(error.message || error)));
    return;
  }
  const verified = state.artists.filter((a) => a.verified).length;
  const pending = state.artists.filter((a) => !a.verified).length;
  const pendingRequests = state.payments.filter((payment) => payment.type === "Purchase" && payment.status !== "Completed" && payment.status !== "Rejected");
  const completedPayments = state.payments.filter((payment) => payment.status === "Completed");
  const pendingWithdrawals = state.payments.filter((payment) => payment.type === "Withdrawal" && payment.status !== "Completed");
  const totalPayments = completedPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const visibleArtists = state.artists.filter((artist) => `${artist.name} ${artist.genre} ${artist.city}`.toLowerCase().includes(state.query.toLowerCase()));
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="mark">D</div>
          <div><div>Muziki Admin Portal</div><div class="muted">Verification, claims, payouts</div></div>
        </div>
        <div class="row">
          <span class="badge good">${verified} verified</span>
          <span class="badge wait">${pending} pending</span>
          <span class="badge warn">${state.notifications.length} alerts</span>
          <button class="ghost" data-action="set-api-base">API</button>
          <button class="ghost" data-action="sign-out">Sign out</button>
        </div>
      </header>

      <section class="hero">
        <div>
          <div class="eyebrow">Control room</div>
          <h1>Approve buyer requests, verify artists, and settle payments from one place.</h1>
          <p>Designed for manual mobile-money workflows: listen to requests, verify transfers, and unlock content only after approval.</p>
          <div class="cta">
            <button class="primary" data-action="go-verification">Review artists</button>
            <button class="secondary" data-action="go-payments">Open payment queue</button>
          </div>
        </div>
        <div class="grid">
          <div class="metric"><strong>${verified}</strong><span class="muted">verified artists</span></div>
          <div class="metric"><strong>${pendingRequests.length}</strong><span class="muted">pending payments</span></div>
          <div class="metric"><strong>${fmt.format(totalPayments)} CDF</strong><span class="muted">approved volume</span></div>
          <div class="metric"><strong>24h</strong><span class="muted">audit window</span></div>
        </div>
      </section>

      <section class="panel section" id="verification">
        <div class="section-head">
          <div>
            <h2>Artist verification</h2>
            <p>Approve artists before they publish tracks.</p>
          </div>
          <input class="search" id="search" placeholder="Search artists" value="${state.query}" />
        </div>
        <div class="cards">
          ${visibleArtists.map((artist) => `
            <article class="card">
              <div class="row">
                <span class="badge ${artist.verified ? "good" : "wait"}">${artist.verified ? "Verified" : "Pending"}</span>
                <span class="badge warn">${artist.priority}</span>
              </div>
              <h3>${artist.name}</h3>
              <p>${artist.genre} - ${artist.city}</p>
              <div class="actions">
                <button class="primary" data-action="verify-artist" data-id="${artist.id}">Verify</button>
                <button class="secondary" data-action="reject-artist" data-id="${artist.id}">Reject</button>
              </div>
            </article>
          `).join("")}
        </div>
      </section>

      <div class="content">
        <section class="panel section" id="payments">
          <div class="section-head">
            <div>
              <h2>Payment queue</h2>
              <p>Review who is paying, what they want to buy, and approve the unlock.</p>
            </div>
          </div>
          <div class="stack">
            ${pendingRequests.map((payment) => `
              <div class="row-card">
                <div class="stack" style="gap:6px">
                  <div class="row">
                    <strong>${payment.account}</strong>
                    <span class="badge warn">${payment.operator}</span>
                  </div>
                  <div class="muted">Phone: ${payment.phone || payment.payerPhone || "-"}</div>
                  <div class="muted">Buy: ${payment.item}</div>
                  <div class="muted">Merchant: ${payment.merchantPhone || "-"}</div>
                  <div class="muted">Ref: ${payment.transferReference || "-"}</div>
                </div>
                <div class="stack" style="text-align:right; gap:10px">
                  <div>${fmt.format(payment.amount)} CDF</div>
                  <div class="badge wait">${payment.status}</div>
                  <div class="row" style="justify-content:flex-end">
                    <button class="primary" data-action="approve-purchase" data-id="${payment.purchaseId}">Approve</button>
                    <button class="secondary" data-action="reject-purchase" data-id="${payment.purchaseId}">Reject</button>
                  </div>
                </div>
              </div>
            `).join("")}
            ${pendingRequests.length === 0 ? `<div class="muted">No pending payment requests.</div>` : ""}
          </div>
        </section>

        <aside class="stack">
          <section class="panel section">
            <div class="section-head"><div><h2>Claims queue</h2><p>Handle copyright and disputes.</p></div></div>
            <div class="stack">
              ${state.claims.map((claim) => `
                <div class="row-card">
                  <div>
                    <strong>${claim.title}</strong>
                    <div class="muted">${claim.artist}</div>
                  </div>
                  <div class="row">
                    <span class="badge warn">${claim.priority}</span>
                    <span class="badge wait">${claim.status}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          </section>

          <section class="panel section">
            <div class="section-head"><div><h2>Approved history</h2><p>Completed purchases and settled actions.</p></div></div>
            <div class="stack">
              ${completedPayments.slice(0, 3).map((payment) => `
                <div class="row-card">
                  <div>
                    <strong>${payment.item || payment.artist || payment.account}</strong>
                    <div class="muted">${payment.account} - ${payment.operator}</div>
                  </div>
                  <span class="badge good">Completed</span>
                </div>
              `).join("")}
              ${completedPayments.length === 0 ? `<div class="muted">No approved purchases yet.</div>` : ""}
            </div>
          </section>

          <section class="panel section">
            <div class="section-head"><div><h2>Withdrawals</h2><p>Artist payout requests and settlement state.</p></div></div>
            <div class="stack">
              ${pendingWithdrawals.length > 0 ? pendingWithdrawals.slice(0, 3).map((withdrawal) => `
                <div class="row-card">
                  <div>
                    <strong>${withdrawal.artist || "Unknown artist"}</strong>
                    <div class="muted">${fmt.format(withdrawal.amount)} CDF</div>
                    <div class="muted">Payout number: ${withdrawal.payoutPhone || "-"}</div>
                  </div>
                  <div class="row">
                    <span class="badge wait">${withdrawal.status}</span>
                    <button class="small primary" data-action="mark-withdrawal-paid" data-id="${withdrawal.id}">Mark sent</button>
                  </div>
                </div>
              `).join("") : `<div class="muted">No pending withdrawals.</div>`}
            </div>
          </section>

          <section class="panel section">
            <div class="section-head"><div><h2>Notifications</h2><p>Backend alerts for new requests.</p></div></div>
            <div class="stack">
              ${state.notifications.slice(0, 3).map((notification) => `
                <div class="row-card">
                  <div>
                    <strong>${notification.title}</strong>
                    <div class="muted">${notification.message}</div>
                  </div>
                </div>
              `).join("")}
              ${state.notifications.length === 0 ? `<div class="muted">No alerts yet.</div>` : ""}
            </div>
          </section>
        </aside>
      </div>

      <footer class="footer">
        <div><strong>Muziki Admin Portal</strong><div class="muted">Independent web app for platform operations.</div></div>
        <div class="row"><button class="ghost">Export report</button><button class="ghost">Review queue</button></div>
      </footer>
    </div>
    <div class="toast-stack"></div>
  `;
  bind();
  persist();
}

function bind() {
  document.getElementById("search")?.addEventListener("input", (event) => { state.query = event.target.value; render(); });
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === "go-verification") document.getElementById("verification")?.scrollIntoView({ behavior: "smooth" });
    if (action === "go-payments") document.getElementById("payments")?.scrollIntoView({ behavior: "smooth" });
    if (action === "set-api-base") setApiBase();
    if (action === "sign-out") signOut();
    if (action === "verify-artist" && id) {
      verifyArtist(id)
        .then((artist) => {
          const current = state.artists.find((a) => a.id === id);
          if (current) current.verified = true;
          toast("Verified", artist.name);
          bootstrap();
        })
        .catch(() => toast("Verification failed", "The backend must confirm artist verification."));
    }
    if (action === "reject-artist" && id) {
      rejectArtist(id)
        .then(() => {
          state.artists = state.artists.filter((a) => a.id !== id);
          toast("Rejected", "Artist removed from the queue.");
          bootstrap();
        })
        .catch(() => toast("Rejection failed", "The backend must record the decision."));
    }
    if (action === "approve-purchase" && id) {
      approvePurchase(id)
        .then(() => {
          const payment = state.payments.find((entry) => entry.purchaseId === id || entry.id === id);
          if (payment) payment.status = "Completed";
          toast("Approved", "Purchase unlocked for the buyer account.");
          bootstrap();
        })
        .catch(() => toast("Approval failed", "The purchase remains locked until the backend confirms it."));
    }
    if (action === "reject-purchase" && id) {
      rejectPurchase(id)
        .then(() => {
          state.payments = state.payments.filter((entry) => entry.purchaseId !== id && entry.id !== id);
          toast("Rejected", "Purchase denied.");
          bootstrap();
        })
        .catch(() => toast("Rejection failed", "The backend must record the decision."));
    }
    if (action === "mark-withdrawal-paid" && id) {
      markWithdrawalPaid(id)
        .then(() => {
          const withdrawal = state.payments.find((entry) => entry.id === id);
          if (withdrawal) withdrawal.status = "Completed";
          toast("Marked sent", "The artist payment was recorded as sent.");
          bootstrap();
        })
        .catch(() => toast("Settlement failed", "Confirm the manual Mobile Money transfer, then try again."));
    }
  }));
}

render();
bootstrap();
