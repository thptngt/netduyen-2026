const CFG = window.FIREBASE_CONFIG || {};
const CONTEST = window.CONTEST;
const START = new Date(CONTEST.start), END = new Date(CONTEST.end);
const DEMO = !CFG.apiKey || CFG.apiKey.startsWith("YOUR_");
const T = window.TEACHERS;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const IMG_VER = 2; // tăng số này khi thay ảnh để trình duyệt tải ảnh mới
const photo = (code, i) => `images/${code}-${i}.jpg?v=${IMG_VER}`;
const label = t => t.name || "Đang cập nhật";

const S = { user: null, mine: new Set(), counts: {}, total: 0, busy: new Set(), open: null, idx: 0 };

/* ---------------- backend: Firebase or local demo ---------------- */
let api;
if (DEMO) {
  const read = () => { try { return JSON.parse(localStorage.getItem("demoVotes") || "{}"); } catch { return {}; } };
  const write = v => { try { localStorage.setItem("demoVotes", JSON.stringify(v)); } catch {} };
  let user = null; try { user = JSON.parse(localStorage.getItem("demoUser")); } catch {}
  let onUser = () => {};
  api = {
    onAuth(fn) { onUser = fn; fn(user); },
    async signIn() { user = { uid: "demo-" + Math.random().toString(36).slice(2, 8), displayName: "Người dùng thử", photoURL: "" }; try { localStorage.setItem("demoUser", JSON.stringify(user)); } catch {} onUser(user); },
    async signOut() { user = null; try { localStorage.removeItem("demoUser"); } catch {} onUser(null); },
    async myVotes(uid) { return Object.keys(read()).filter(k => k.startsWith(uid + "_")).map(k => read()[k]); },
    async vote(uid, code) { const v = read(); const k = uid + "_" + code; if (v[k]) throw { code: "permission-denied" }; v[k] = code; write(v); },
    async counts() { const c = {}; let total = 0; for (const code of Object.values(read())) { c[code] = (c[code] || 0) + 1; total++; } return { c, total }; },
  };
} else {
  const V = "10.12.2", base = `https://www.gstatic.com/firebasejs/${V}/`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(base + "firebase-app.js"), import(base + "firebase-auth.js"), import(base + "firebase-firestore.js"),
  ]);
  const app = initializeApp(CFG);
  const auth = A.getAuth(app); auth.languageCode = "vi";
  const db = F.getFirestore(app);
  const provider = new A.GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
  A.getRedirectResult(auth).catch(() => {});
  api = {
    onAuth(fn) { A.onAuthStateChanged(auth, fn); },
    async signIn() {
      try { await A.signInWithPopup(auth, provider); }
      catch (e) {
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) await A.signInWithRedirect(auth, provider);
        else if (e.code !== "auth/popup-closed-by-user") throw e;
      }
    },
    signOut: () => A.signOut(auth),
    async myVotes(uid) {
      const s = await F.getDocs(F.query(F.collection(db, "votes"), F.where("uid", "==", uid)));
      return s.docs.map(d => d.data().teacher);
    },
    // Mỗi phiếu là 1 tài liệu votes/<uid>_<mã>; luật Firestore cấm ghi đè nên mỗi cô chỉ được 1 phiếu.
    vote: (uid, code) => F.setDoc(F.doc(db, "votes", uid + "_" + code), { uid, teacher: code, at: F.serverTimestamp() }),
    async counts() {
      const col = F.collection(db, "votes");
      const named = T.filter(t => t.name);
      const res = await Promise.all([
        F.getCountFromServer(col),
        ...named.map(t => F.getCountFromServer(F.query(col, F.where("teacher", "==", t.code)))),
      ]);
      const c = {}; named.forEach((t, i) => c[t.code] = res[i + 1].data().count);
      return { c, total: res[0].data().count };
    },
  };
}

/* ---------------- helpers ---------------- */
const phase = () => { const n = Date.now(); return n < START ? "before" : n > END ? "after" : "open"; };
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3200); }
function banner(html, err) { const b = $("#banner"); if (!html) { b.hidden = true; return; } b.innerHTML = html; b.className = "banner" + (err ? " err" : ""); b.hidden = false; }
const inApp = /FBAN|FBAV|FB_IAB|Instagram|Zalo|Messenger|Line\//i.test(navigator.userAgent);
const fmt = n => n.toLocaleString("vi-VN");

const voteLabel = code => S.mine.has(code) ? "✓ Đã bình chọn" : "Bình chọn";

/* ---------------- render ---------------- */
function rankMap() {
  const r = {}; T.filter(t => t.name).map(t => [t.code, S.counts[t.code] || 0]).filter(x => x[1] > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([c], i) => r[c] = i + 1);
  return r;
}
function renderGrid() {
  const q = $("#q").value.trim().toLowerCase();
  let list = T.filter(t => !q || [t.code, t.name, t.cls].join(" ").toLowerCase().includes(q));
  if ($("#sort").value === "votes") list = [...list].sort((a, b) => (S.counts[b.code] || 0) - (S.counts[a.code] || 0));
  const rk = rankMap();
  $("#grid").innerHTML = list.length ? list.map(t => {
    const mine = S.mine.has(t.code), n = S.counts[t.code] || 0;
    return `<article class="card${mine ? " mine" : ""}${t.name ? "" : " empty"}">
      <button class="thumb" data-open="${t.code}" aria-label="Xem bài dự thi ${esc(label(t))}">
        <img src="${photo(t.code, 1)}" alt="${esc(label(t))}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'Ảnh đang cập nhật'}))">
        <span class="badge">${t.code}</span>${mine ? '<span class="mine-tag">Bạn đã chọn</span>' : ""}${rk[t.code] ? `<span class="rank">Top ${rk[t.code]}</span>` : ""}
      </button>
      <div class="ci">
        <h3><button data-open="${t.code}">${esc(label(t))}</button></h3>
        <p class="sub">${t.cls ? "GVCN lớp " + esc(t.cls) : "&nbsp;"}</p>
        <div class="row"><button class="vote${mine ? " on" : ""}" data-vote="${t.code}" ${t.name && phase() === "open" ? "" : "disabled"}><b>${fmt(n)}</b> ${voteLabel(t.code)}</button></div>
      </div></article>`;
  }).join("") : `<p style="grid-column:1/-1;text-align:center;color:var(--muted)">Không tìm thấy thí sinh phù hợp.</p>`;
}
function renderAuth() {
  const a = $("#auth");
  if (S.user) {
    a.innerHTML = `${S.user.photoURL ? `<img src="${esc(S.user.photoURL)}" alt="" referrerpolicy="no-referrer">` : ""}<span class="who">${esc(S.user.displayName || S.user.email || "Bạn")}</span><button class="btn-out" id="out">Đăng xuất</button>`;
    $("#out").onclick = () => api.signOut();
  } else {
    a.innerHTML = `<button class="btn-g" id="in"><svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-10l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>Đăng nhập Google</button>`;
    $("#in").onclick = signIn;
  }
}
function renderStats() {
  $("#sTotal").textContent = fmt(S.total);
  $("#sCount").textContent = T.length;
  $("#sMineBox").hidden = !S.user;
  $("#sMine").textContent = `${S.mine.size}/${T.filter(t => t.name).length}`;
  renderClock();
}
let lastPhase = phase();
function renderClock() {
  const p = phase(), now = Date.now();
  // Hết giờ (hoặc vừa mở) thì vẽ lại toàn trang để khóa/mở nút bình chọn
  if (p !== lastPhase) { lastPhase = p; return renderAll(); }
  const ms = Math.max(0, p === "before" ? START - now : p === "open" ? END - now : 0);
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  const pad = n => String(n).padStart(2, "0");
  const hms = `${pad(h)}:${pad(m)}:${pad(s)}`;
  $("#sTime").textContent = p === "after" ? "Đã kết thúc" : d > 0 ? `${d} ngày ${hms}` : hms;
  $("#sTimeLbl").textContent = p === "before" ? "đến khi mở bình chọn (giờ : phút : giây)" : p === "open" ? "thời gian còn lại (giờ : phút : giây)" : "cuộc bình chọn";
}
function renderModal() {
  const t = T.find(x => x.code === S.open); if (!t) return;
  const imgs = [1, 2, 3].map(i => photo(t.code, i));
  const main = $("#mImg"); main.src = imgs[S.idx]; main.alt = label(t);
  main.onerror = () => { main.removeAttribute("src"); main.alt = "Ảnh đang cập nhật"; };
  $("#mThumbs").innerHTML = imgs.map((src, i) => `<button data-idx="${i}" aria-current="${i === S.idx}" aria-label="Ảnh ${i + 1}"><img src="${src}" alt="" onerror="this.style.visibility='hidden'"></button>`).join("");
  $("#mCode").textContent = "MÃ THÍ SINH: " + t.code;
  $("#mName").textContent = label(t);
  $("#mCls").textContent = t.cls ? "Giáo viên chủ nhiệm lớp " + t.cls : "";
  $("#mTitle").textContent = t.title || "";
  $("#mMsg").innerHTML = t.message ? t.message.split("\n").filter(Boolean).map(p => `<p>${esc(p)}</p>`).join("") : "<p>Bài dự thi đang được cập nhật.</p>";
  $("#mVotes").textContent = fmt(S.counts[t.code] || 0);
  const b = $("#mVote"); const mine = S.mine.has(t.code);
  b.className = "vote big" + (mine ? " on" : "");
  b.dataset.vote = t.code;
  b.disabled = !t.name || phase() !== "open";
  b.textContent = mine ? "✓ Bạn đã bình chọn cô" : "Bình chọn cho cô";
}
function renderAll() { renderAuth(); renderStats(); renderGrid(); if (S.open) renderModal(); }

/* ---------------- actions ---------------- */
async function signIn() {
  if (inApp) { banner("Facebook/Zalo không cho đăng nhập Google trong ứng dụng. Bấm <b>⋯</b> rồi chọn <b>Mở bằng trình duyệt</b> (Chrome/Safari) để bình chọn.", true); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  try { await api.signIn(); } catch (e) { toast("Không đăng nhập được. Hãy thử lại."); console.error(e); }
}
async function refreshCounts() {
  try { const { c, total } = await api.counts(); S.counts = c; S.total = total; renderAll(); }
  catch (e) { console.error(e); }
}
let pendingVote = null;
async function vote(code) {
  const t = T.find(x => x.code === code); if (!t?.name) return;
  if (!S.user) { pendingVote = code; toast("Đăng nhập Google để bình chọn"); return signIn(); }
  if (phase() !== "open") return toast(phase() === "before" ? "Chưa đến thời gian bình chọn." : "Cuộc bình chọn đã kết thúc.");
  if (S.mine.has(code)) return toast(`Bạn đã bình chọn cho cô ${t.name} rồi. Mỗi cô chỉ được chọn 1 lần.`);
  if (S.busy.has(code)) return; S.busy.add(code);
  try {
    await api.vote(S.user.uid, code);
    S.mine.add(code);
    S.counts[code] = (S.counts[code] || 0) + 1; S.total++;
    const left = T.filter(x => x.name && !S.mine.has(x.code)).length;
    toast(`Cảm ơn bạn đã bình chọn cho cô ${t.name}!` + (left ? ` Bạn còn ${left} cô chưa chọn.` : " Bạn đã chọn đủ 18 cô."));
  } catch (e) {
    console.error(e);
    if (e?.code === "permission-denied") {
      // Ghi đè bị luật chặn = đã có phiếu (vd. bầu ở thiết bị khác) hoặc ngoài giờ.
      const again = await api.myVotes(S.user.uid).catch(() => []);
      if (again.includes(code)) { S.mine.add(code); toast(`Bạn đã bình chọn cho cô ${t.name} rồi.`); }
      else toast("Không ghi nhận được: ngoài thời gian bình chọn hoặc tài khoản không hợp lệ.");
    } else toast("Lỗi kết nối, hãy thử lại.");
  } finally { S.busy.delete(code); renderAll(); setTimeout(refreshCounts, 1500); }
}
function openModal(code) {
  S.open = code; S.idx = 0; renderModal(); $("#modal").hidden = false; document.body.style.overflow = "hidden";
  if (location.hash !== "#" + code) history.replaceState(null, "", "#" + code);
}
function closeModal() {
  S.open = null; $("#modal").hidden = true; document.body.style.overflow = "";
  history.replaceState(null, "", location.pathname + location.search);
}

/* ---------------- events ---------------- */
document.addEventListener("click", e => {
  const el = e.target.closest("[data-open],[data-vote],[data-idx],[data-close]");
  if (e.target.id === "modal") return closeModal();
  if (!el) return;
  if (el.dataset.open) openModal(el.dataset.open);
  else if (el.dataset.vote) vote(el.dataset.vote);
  else if (el.dataset.idx) { S.idx = +el.dataset.idx; renderModal(); }
  else if (el.hasAttribute("data-close")) closeModal();
});
document.addEventListener("keydown", e => {
  if (!S.open) return;
  if (e.key === "Escape") closeModal();
  if (e.key === "ArrowRight") { S.idx = (S.idx + 1) % 3; renderModal(); }
  if (e.key === "ArrowLeft") { S.idx = (S.idx + 2) % 3; renderModal(); }
});
$("#mShare").onclick = async () => {
  const url = location.origin + location.pathname + "#" + S.open;
  try { await navigator.clipboard.writeText(url); toast("Đã sao chép link thí sinh."); } catch { prompt("Sao chép link:", url); }
};
$("#q").addEventListener("input", renderGrid);
$("#sort").addEventListener("change", renderGrid);

/* ---------------- boot ---------------- */
if (DEMO) banner("<b>Chế độ thử:</b> chưa kết nối Firebase nên phiếu chỉ lưu trên máy này. Xem file HUONG-DAN.md để đưa lên mạng.");
else if (inApp) banner("Bạn đang mở trong Facebook/Zalo. Để đăng nhập Google và bình chọn, bấm <b>⋯</b> → <b>Mở bằng trình duyệt</b>.", true);
renderAll();
api.onAuth(async u => {
  S.user = u; S.mine = new Set(); renderAll();
  if (u) {
    try { S.mine = new Set(await api.myVotes(u.uid)); } catch (e) { console.error(e); }
    renderAll();
    if (pendingVote) { const c = pendingVote; pendingVote = null; vote(c); }
  }
});
refreshCounts();
setInterval(refreshCounts, 60000);
setInterval(renderClock, 1000);
const h = location.hash.slice(1).toUpperCase();
if (T.some(t => t.code === h)) openModal(h);
