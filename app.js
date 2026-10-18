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
    // 18 lệnh đếm (mỗi lệnh tốn ít nhất 1 lượt đọc); tổng = cộng các cô, không đếm riêng nữa.
    // Mỗi cô đếm riêng, lỗi thì thử lại 2 lần; vẫn lỗi thì giữ số cũ (prev) thay vì bỏ cả lượt.
    async counts(prev = {}) {
      const col = F.collection(db, "votes");
      const named = T.filter(t => t.name);
      const one = async code => {
        for (let i = 0; i < 3; i++) {
          try { return (await F.getCountFromServer(F.query(col, F.where("teacher", "==", code)))).data().count; }
          catch (e) { await new Promise(r => setTimeout(r, 800 * (i + 1))); }
        }
        return typeof prev[code] === "number" ? prev[code] : null;
      };
      const vals = await Promise.all(named.map(t => one(t.code)));
      if (vals.every(v => v === null)) throw new Error("counts unavailable");
      const c = {}; let total = 0;
      named.forEach((t, i) => { c[t.code] = vals[i]; total += vals[i] || 0; }); // null = chưa đếm được
      const partial = vals.some(v => v === null);
      return { c, total: partial ? null : total, partial };
    },
  };
}

/* ---------------- helpers ---------------- */
// Xem thử giao diện "đã kết thúc" (pháo hoa) — CHỈ chạy trên máy (localhost) với ?xemthu=ketthuc, web thật không bị ảnh hưởng
const PREVIEW_END = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]xemthu=ketthuc/.test(location.search);
const phase = () => { if (PREVIEW_END) return "after"; const n = Date.now(); return n < START ? "before" : n > END ? "after" : "open"; };
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3200); }
function banner(html, err) { const b = $("#banner"); if (!html) { b.hidden = true; return; } b.innerHTML = html; b.className = "banner" + (err ? " err" : ""); b.hidden = false; }
const inApp = /FBAN|FBAV|FB_IAB|Instagram|Zalo|Messenger|Line\//i.test(navigator.userAgent);
const fmt = n => S.known && typeof n === "number" ? n.toLocaleString("vi-VN") : "–"; // chưa đọc được số phiếu thì hiện "–", không hiện 0

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
  const card = t => {
    const mine = S.mine.has(t.code), n = S.counts[t.code];
    return `<article class="card${mine ? " mine" : ""}${t.name ? "" : " empty"}${phase() === "after" && rk[t.code] ? " winner w" + rk[t.code] : ""}" data-code="${t.code}">
      <button class="thumb" data-open="${t.code}" aria-label="Xem bài dự thi ${esc(label(t))}">
        <img src="${photo(t.code, 1)}" alt="${esc(label(t))}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'Ảnh đang cập nhật'}))">
        <span class="badge">${t.code}</span>${mine ? '<span class="mine-tag">Bạn đã chọn</span>' : ""}${rk[t.code] ? `<span class="rank r${rk[t.code]}">Top ${rk[t.code]}</span>` : ""}
      </button>
      <div class="ci">
        <h3><button data-open="${t.code}">${esc(label(t))}</button></h3>
        <p class="sub">${t.cls ? "GVCN lớp " + esc(t.cls) : "&nbsp;"}</p>
        <div class="row"><button class="vote${mine ? " on" : ""}" data-vote="${t.code}" ${t.name && phase() === "open" ? "" : "disabled"}><b>${fmt(n)}</b> ${voteLabel(t.code)}</button></div>
      </div></article>`;
  };
  // Sau khi khóa bình chọn (và không đang tìm kiếm): Top 3 lên hàng riêng phía trên, 15 cô còn lại xếp bên dưới.
  // Máy tính: bục vinh danh 2 – 1 – 3 (Top 1 ở giữa, cao hơn). Điện thoại: Top 1 hàng đầu, Top 2 và Top 3 hàng thứ hai.
  const top = Object.keys(rk).sort((a, b) => rk[a] - rk[b]).map(c => T.find(t => t.code === c));
  if (phase() === "after" && !q && top.length === 3) {
    const rest = list.filter(t => !rk[t.code]);
    $("#grid").innerHTML = `<section class="podium" aria-label="Top 3 bình chọn nhiều nhất">${top.map((t, i) => card(t).replace('<article class="card', `<article data-place="${i + 1}" class="card`)).join("")}</section>` + rest.map(card).join("");
  } else {
    $("#grid").innerHTML = list.length ? list.map(card).join("") : `<p style="grid-column:1/-1;text-align:center;color:var(--muted)">Không tìm thấy thí sinh phù hợp.</p>`;
  }
  attachFrames();
  celebrate();
}

/* ---------------- pháo hoa sau khi khóa bình chọn ----------------
   Banner: pháo hoa nhiều màu hồng - tím - vàng phía sau chữ.
   Top 3: mỗi thẻ một màu pháo hoa riêng — vàng kim (Top 1), bạc (Top 2), đồng (Top 3). */
const FX_COLORS = {
  hero: ["#ffffff", "#c8ffd9", "#ffd27a", "#ff7ac8", "#c8a2ff", "#8ff3ff"],
  1: ["#ffd54a", "#fff2b0", "#ffc107"],
  2: ["#ffffff", "#dfe8f2", "#c7d4e2"],
  3: ["#ff9a5a", "#ffc59a", "#ff7a3d"],
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
class Fireworks {
  // Pháo hoa mô phỏng thật (như video bắn pháo hoa đêm): pháo bay lên rồi nổ, hạt có trọng lực và lực cản,
  // để lại vệt sáng; nhiều quả nổ cùng lúc; các kiểu nổ: bông cúc trắng sáng, bông màu, liễu vàng rơi lấp lánh.
  constructor(host, colors, opts = {}) {
    this.host = host; this.colors = colors;
    this.o = Object.assign({ every: 1100, salvo: [1, 3], size: 1, fade: .17 }, opts);
    this.c = document.createElement("canvas"); this.c.className = "fx"; this.c.setAttribute("aria-hidden", "true");
    host.prepend(this.c); this.x = this.c.getContext("2d");
    this.r = []; this.p = []; this.last = -1e9; this.alive = true;
    this.fit = () => { const dpr = Math.min(devicePixelRatio || 1, 2), b = host.getBoundingClientRect();
      this.w = b.width; this.h = b.height; this.c.width = b.width * dpr; this.c.height = b.height * dpr; this.x.setTransform(dpr, 0, 0, dpr, 0, 0); };
    this.fit(); this.ro = new ResizeObserver(this.fit); this.ro.observe(host);
    this.tick = this.tick.bind(this); requestAnimationFrame(this.tick);
  }
  pick() { return this.colors[(Math.random() * this.colors.length) | 0]; }
  // quầng sáng tròn vẽ sẵn cho mỗi màu
  halo(col) {
    const H = Fireworks.halos || (Fireworks.halos = {});
    if (!H[col]) { const s = document.createElement("canvas"); s.width = s.height = 32; const g = s.getContext("2d");
      const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16); rg.addColorStop(0, col); rg.addColorStop(1, col + "00");
      g.fillStyle = rg; g.fillRect(0, 0, 32, 32); H[col] = s; }
    return H[col];
  }
  salvo() {
    const k = this.o.salvo[0] + ((Math.random() * (this.o.salvo[1] - this.o.salvo[0] + 1)) | 0);
    for (let i = 0; i < k; i++) setTimeout(() => this.alive && this.launch(), i * (120 + Math.random() * 260));
  }
  launch() {
    const s = Math.max(.35, Math.min(1.4, Math.min(this.w, this.h) / 320)) * this.o.size; // độ bung tỷ lệ theo khung (thẻ nhỏ trên điện thoại bung nhỏ)
    const ty = this.h * (.12 + Math.random() * .38);
    // tốc độ bay đủ để lên tới độ cao nổ ty (trọng lực .06/khung), không phụ thuộc kích thước khung
    this.r.push({ x: this.w * (.12 + Math.random() * .76), y: this.h + 4, vx: (Math.random() - .5) * 1.2 * s,
      vy: -Math.sqrt(2 * .06 * (this.h + 4 - ty)) * 1.08, ty, s });
  }
  explode(rk) {
    const type = Math.random(), s = rk.s, col = this.pick();
    const add = (n, sp0, sp1, o) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, sp = (sp0 + Math.random() * (sp1 - sp0)) * s;
      this.p.push(Object.assign({ x: rk.x, y: rk.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, ph: Math.random() * 6.28 }, o())); } };
    if (type < .45) {            // bông cúc: lõi trắng sáng chuyển dần sang màu
      add(110, 1.2, 4.2, () => ({ col, hot: true, decay: .012 + Math.random() * .01, drag: .975, g: .045, sz: 1.5 }));
    } else if (type < .75) {     // bông màu 2 lớp
      const col2 = this.pick();
      add(80, 2.6, 4.2, () => ({ col, decay: .014 + Math.random() * .01, drag: .972, g: .045, sz: 1.6 }));
      add(45, .8, 2, () => ({ col: col2, decay: .02 + Math.random() * .01, drag: .97, g: .04, sz: 1.4 }));
    } else {                     // liễu vàng: hạt sống lâu, rơi chậm, lấp lánh
      add(90, 1, 3.4, () => ({ col: "#ffd27a", decay: .006 + Math.random() * .004, drag: .965, g: .028, sz: 1.3, glitter: true }));
    }
  }
  tick(now) {
    if (!this.alive) return;
    requestAnimationFrame(this.tick);
    if (document.hidden) { this.prev = null; return; }
    // Chuyển động tính theo thời gian thật: luôn 60 bước/giây, màn hình 90/120/144 Hz không làm pháo bay nhanh hơn
    const STEP = 1000 / 60;
    this.acc = Math.min((this.acc || 0) + (this.prev == null ? STEP : now - this.prev), STEP * 4); this.prev = now;
    const n = Math.floor(this.acc / STEP);
    if (!n) return;                        // chưa đủ 1 bước: giữ nguyên khung hình
    this.acc -= n * STEP;
    const x = this.x;
    x.globalCompositeOperation = "destination-out"; x.globalAlpha = 1; x.fillStyle = `rgba(0,0,0,${1 - Math.pow(1 - this.o.fade, n)})`; x.fillRect(0, 0, this.w, this.h); // để lại vệt sáng
    x.globalCompositeOperation = "lighter";                                                                                            // ánh sáng cộng dồn như pháo thật
    if (now - this.last > this.o.every * (.6 + Math.random() * .8)) { this.last = now; this.salvo(); }
    for (let k = 0; k < n; k++) {
      // pháo đang bay lên + tàn lửa đuôi
      for (let i = this.r.length - 1; i >= 0; i--) {
        const r = this.r[i]; r.x += r.vx; r.y += r.vy; r.vy += .06;
        if (Math.random() < .8) this.p.push({ x: r.x, y: r.y + 2, vx: (Math.random() - .5) * .6, vy: Math.random() * .8, life: .5, decay: .05, col: "#ffcf8a", drag: .95, g: .02, sz: 1 });
        if (r.y <= r.ty || r.vy >= -.5) { this.explode(r); this.r.splice(i, 1); }
      }
      for (let i = this.p.length - 1; i >= 0; i--) {
        const p = this.p[i]; p.vx *= p.drag; p.vy = p.vy * p.drag + p.g; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
        if (p.life <= 0) this.p.splice(i, 1);
      }
    }
    for (const r of this.r) { x.globalAlpha = 1; x.fillStyle = "#fff4d6"; x.beginPath(); x.arc(r.x, r.y, 1.6, 0, 6.283); x.fill(); }
    // hạt pháo
    for (const p of this.p) {
      let a = Math.min(1, p.life * 1.6);
      if (p.glitter) a *= Math.random() < .35 ? 1 : .25;                        // liễu vàng nhấp nháy
      else if (p.life < .35) a *= .5 + .5 * Math.sin(now / 45 + p.ph);           // lấp lánh khi tàn
      const col = p.hot && p.life > .7 ? "#ffffff" : p.col;                       // lõi trắng lúc mới nổ
      x.globalAlpha = a * .35; x.drawImage(this.halo(col), p.x - 6 * p.sz, p.y - 6 * p.sz, 12 * p.sz, 12 * p.sz);
      x.globalAlpha = a; x.fillStyle = col; x.beginPath(); x.arc(p.x, p.y, p.sz, 0, 6.283); x.fill();
    }
    x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
  }
  stop() { this.alive = false; this.ro.disconnect(); this.c.remove(); }
}
/* ---------------- khung vinh danh Top 3 (tùy chọn) ----------------
   Khung kim loại kiểu huy hiệu: viền đôi, vương miện có đá quý phía trên, cánh hai bên ảnh, dải "TOP n" phía dưới.
   Vàng kim (Top 1) · Bạc (Top 2) · Đồng (Top 3).
   ĐANG BẬT trên web thật (FRAME_ON = true). Xem thử trên máy: ?xemthu=ketthuc&khung=1 */
const FRAME_ON = true;
const SHOW_FRAMES = FRAME_ON || (PREVIEW_END && /[?&]khung=1/.test(location.search));
const METAL = {
  1: { s: ["#fff7cf", "#f6d365", "#c8961e", "#ffe592", "#8a5b06"], gem: "#ff5a76", glow: "rgba(255,200,60,.55)" },
  2: { s: ["#ffffff", "#e3eaf2", "#9aa8b8", "#f4f7fb", "#5d6b7c"], gem: "#7fd6ff", glow: "rgba(210,225,245,.6)" },
  3: { s: ["#ffe3c7", "#e9a06a", "#a5571f", "#f6bc8a", "#5f2d0b"], gem: "#ffb347", glow: "rgba(230,140,80,.5)" },
};
function frameHTML(rk) {
  const m = METAL[rk], g = `fm${rk}`;
  const grad = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">${m.s.map((c, i) => `<stop offset="${i / (m.s.length - 1)}" stop-color="${c}"/>`).join("")}</linearGradient>
    <linearGradient id="${g}v" x1="0" y1="0" x2="0" y2="1">${m.s.map((c, i) => `<stop offset="${i / (m.s.length - 1)}" stop-color="${c}"/>`).join("")}</linearGradient></defs>`;
  return `<div class="frame f${rk}" aria-hidden="true" style="--fglow:${m.glow}">
    <svg class="fr-border" viewBox="0 0 100 100" preserveAspectRatio="none">${grad}
      <rect x="1.2" y="1" width="97.6" height="98" rx="4" fill="none" stroke="url(#${g})" stroke-width="4" vector-effect="non-scaling-stroke"/>
      <rect x="3.2" y="2.6" width="93.6" height="94.8" rx="3" fill="none" stroke="url(#${g}v)" stroke-width="1.2" vector-effect="non-scaling-stroke" opacity=".85"/></svg>
    <img class="fr-badge" src="frames/top${rk}.webp?v=1" alt="" width="800" height="330">
  </div>`;
  /* (Mẫu trang trí tự vẽ cũ — không dùng nữa, giữ lại để tham khảo)
    <svg class="fr-top" viewBox="0 0 160 64">${grad}
      <path d="M80 4 L92 26 L114 14 L106 38 L140 30 L118 52 L80 46 L42 52 L20 30 L54 38 L46 14 L68 26 Z" fill="url(#${g})" stroke="${m.s[4]}" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M80 14 L88 30 L80 40 L72 30 Z" fill="${m.gem}" stroke="#fff" stroke-width="1.2"/>
      <circle cx="80" cy="27" r="3" fill="#fff" opacity=".85"/>
      <path d="M8 56 Q44 44 80 52 Q116 44 152 56 L150 60 Q116 50 80 58 Q44 50 10 60 Z" fill="url(#${g}v)" stroke="${m.s[4]}" stroke-width="1"/></svg>
    <svg class="fr-wing l" viewBox="0 0 40 120">${grad}
      <path d="M36 6 C14 20 6 44 10 62 C14 82 24 98 36 114 C22 110 4 92 2 64 C0 36 16 14 36 6 Z" fill="url(#${g}v)" stroke="${m.s[4]}" stroke-width="1.2"/>
      <path d="M30 26 C18 38 16 52 18 64 M30 92 C22 84 18 76 18 66" fill="none" stroke="${m.s[0]}" stroke-width="1.4" opacity=".8"/></svg>
    <svg class="fr-wing r" viewBox="0 0 40 120">${grad}
      <path d="M36 6 C14 20 6 44 10 62 C14 82 24 98 36 114 C22 110 4 92 2 64 C0 36 16 14 36 6 Z" fill="url(#${g}v)" stroke="${m.s[4]}" stroke-width="1.2"/>
      <path d="M30 26 C18 38 16 52 18 64 M30 92 C22 84 18 76 18 66" fill="none" stroke="${m.s[0]}" stroke-width="1.4" opacity=".8"/></svg>
    <svg class="fr-bottom" viewBox="0 0 200 60">${grad}
      <path d="M10 18 L56 30 L76 10 L100 22 L124 10 L144 30 L190 18 L168 44 L132 40 L100 56 L68 40 L32 44 Z" fill="url(#${g})" stroke="${m.s[4]}" stroke-width="1.5" stroke-linejoin="round"/>
      <rect x="64" y="22" width="72" height="20" rx="10" fill="${m.s[4]}" stroke="url(#${g}v)" stroke-width="2"/>
      <text x="100" y="37" text-anchor="middle" font-family="Montserrat,Arial,sans-serif" font-weight="800" font-size="13" fill="${m.s[0]}" letter-spacing="1.5">TOP ${rk}</text></svg>
  */
}
function attachFrames() {
  if (!SHOW_FRAMES || phase() !== "after") return;
  for (const card of document.querySelectorAll(".card.winner")) {
    if (card.querySelector(".frame")) continue;
    const rk = card.classList.contains("w1") ? 1 : card.classList.contains("w2") ? 2 : 3;
    card.classList.add("framed"); card.insertAdjacentHTML("beforeend", frameHTML(rk));
  }
}

let heroFx = null, cardFx = [], sortedOnce = false;
function celebrate() {
  const ended = phase() === "after" && S.known && !reduceMotion;
  for (const f of cardFx) f.stop(); cardFx = [];
  if (!ended) { if (heroFx) { heroFx.stop(); heroFx = null; $(".hero").classList.remove("night"); } return; }
  if (!sortedOnce) { sortedOnce = true; if ($("#sort").value !== "votes") { $("#sort").value = "votes"; return renderGrid(); } }
  if (!heroFx) heroFx = new Fireworks($(".hero"), FX_COLORS.hero, { every: 1300, salvo: [2, 4], size: 1 }); $(".hero").classList.add("night");
  attachFrames();
  for (const card of document.querySelectorAll(".card.winner")) {
    const rk = card.classList.contains("w1") ? 1 : card.classList.contains("w2") ? 2 : 3;
    cardFx.push(new Fireworks(card, FX_COLORS[rk], { every: rk === 1 ? 1300 : 1700, salvo: [1, 2], size: .8, fade: .2 }));
  }
}
function renderAuth() {
  const a = $("#auth");
  if (S.user) {
    a.innerHTML = `${S.user.photoURL ? `<img src="${esc(S.user.photoURL)}" alt="" referrerpolicy="no-referrer">` : ""}<span class="who">${esc(S.user.displayName || S.user.email || "Bạn")}</span><span class="mine-chip">Đã chọn <b id="sMine">${S.mine.size}/${T.filter(t => t.name).length}</b> cô</span><button class="btn-out" id="out">Đăng xuất</button>`;
    $("#out").onclick = () => api.signOut();
  } else {
    a.innerHTML = `<button class="btn-g" id="in"><svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.2-13.5-10l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>Đăng nhập Google</button>`;
    $("#in").onclick = signIn;
  }
}
function renderStats() {
  $("#sTotal").textContent = fmt(S.total);
  const nb = $("#countNote"); if (nb) nb.hidden = !S.countErr;
  $("#sCount").textContent = T.length;
  const mineEl = $("#sMine"); if (mineEl) mineEl.textContent = `${S.mine.size}/${T.filter(t => t.name).length}`;
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
  const cd = $("#cd"), ended = p === "after";
  cd.classList.toggle("ended", ended);
  cd.classList.toggle("urgent", p === "open" && ms <= 36e5); // 60 phút cuối
  for (const el of cd.querySelectorAll(".cd-seg, .cd-colon")) el.hidden = ended;
  $("#cdEnd").hidden = !ended;
  if (!ended) {
    $("#cdDaySeg").hidden = $("#cdDayColon").hidden = d === 0;
    $("#cdD").textContent = d;
    $("#cdH").textContent = pad(h);
    $("#cdM").textContent = pad(m);
    $("#cdS").textContent = pad(s);
  }
  $("#sTimeLbl").textContent = p === "before" ? "Còn lại đến khi mở bình chọn" : p === "open" ? "Thời gian bình chọn còn lại" : "Cuộc bình chọn";
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
  $("#mVotes").textContent = fmt(S.counts[t.code]);
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
/* Đếm phiếu tiết kiệm lượt đọc Firebase:
   - chỉ đếm lại khi trang đang mở trên màn hình và đã quá REFRESH_MS kể từ lần trước;
   - lưu kết quả gần nhất vào máy người xem để lần sau mở trang hiện ngay, không phải đọc lại;
   - nếu Firebase tạm từ chối (hết hạn mức), giữ số cũ, không bao giờ hiện 0. */
const REFRESH_MS = 5 * 60 * 1000;
const CACHE_KEY = "voteCounts_v1";
let lastFetch = 0, fetching = false;
try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); if (c?.c) { S.counts = c.c; S.total = c.total; S.known = true; lastFetch = c.at || 0; } } catch {}
async function refreshCounts(force) {
  if (fetching || document.hidden) return;
  if (!force && Date.now() - lastFetch < REFRESH_MS) return;
  fetching = true;
  try {
    const { c, total, partial } = await api.counts(S.known ? S.counts : {});
    S.counts = c; S.total = total; S.known = true; S.countErr = !!partial;
    lastFetch = partial ? Date.now() - REFRESH_MS + 20 * 1000 : Date.now(); // thiếu số cô nào thì 20 giây sau đếm lại
    if (!partial) try { localStorage.setItem(CACHE_KEY, JSON.stringify({ c, total, at: lastFetch })); } catch {}
  } catch (e) {
    console.error(e); S.countErr = true; lastFetch = Date.now(); // chờ hết chu kỳ rồi mới thử lại
  } finally { fetching = false; renderAll(); }
}
let pendingVote = null;
// Từ 18/10: chỉ nhận @gmail.com hoặc đuôi .edu.vn (luật Firebase cũng chặn tương tự)
function emailOk(u) {
  if (DEMO) return true;
  const e = (u?.email || "").toLowerCase();
  return /@gmail\.com$/.test(e) || /@hanoiedu\.vn$/.test(e) || /\.edu\.vn$/.test(e);
}
function showEmailBanner() {
  banner(`Tài khoản <b>${esc(S.user?.email || "")}</b> không được chấp nhận. Cuộc bình chọn chỉ nhận tài khoản <b>@gmail.com</b>, <b>@hanoiedu.vn</b> hoặc email trường học đuôi <b>.edu.vn</b>. Bấm <b>Đăng xuất</b> rồi đăng nhập lại bằng tài khoản phù hợp.`, true);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
async function vote(code) {
  const t = T.find(x => x.code === code); if (!t?.name) return;
  if (!S.user) { pendingVote = code; toast("Đăng nhập Google để bình chọn"); return signIn(); }
  if (phase() !== "open") return toast(phase() === "before" ? "Chưa đến thời gian bình chọn." : "Cuộc bình chọn đã kết thúc.");
  if (!emailOk(S.user)) { showEmailBanner(); return toast("Chỉ nhận tài khoản @gmail.com, @hanoiedu.vn hoặc email đuôi .edu.vn."); }
  if (S.mine.has(code)) return toast(`Bạn đã bình chọn cho cô ${t.name} rồi. Mỗi cô chỉ được chọn 1 lần.`);
  if (S.busy.has(code)) return; S.busy.add(code);
  try {
    await api.vote(S.user.uid, code);
    S.mine.add(code);
    if (typeof S.counts[code] === "number") S.counts[code]++; if (typeof S.total === "number") S.total++;
    const left = T.filter(x => x.name && !S.mine.has(x.code)).length;
    toast(`Cảm ơn bạn đã bình chọn cho cô ${t.name}!` + (left ? ` Bạn còn ${left} cô chưa chọn.` : " Bạn đã chọn đủ 18 cô."));
  } catch (e) {
    console.error(e);
    if (e?.code === "permission-denied") {
      // Ghi đè bị luật chặn = đã có phiếu (vd. bầu ở thiết bị khác) hoặc ngoài giờ.
      // Trong giờ bình chọn, luật chỉ chặn khi phiếu cho cô này đã tồn tại → coi như đã bầu.
      S.mine.add(code);
      toast(`Bạn đã bình chọn cho cô ${t.name} rồi. Mỗi cô chỉ được chọn 1 lần.`);
    } else toast("Lỗi kết nối, hãy thử lại.");
  } finally { S.busy.delete(code); renderAll(); }
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
  if (u && !emailOk(u)) showEmailBanner(); else if (!DEMO && !inApp) banner("");
  if (u) {
    try { S.mine = new Set(await api.myVotes(u.uid)); } catch (e) { console.error(e); }
    renderAll();
    if (pendingVote) { const c = pendingVote; pendingVote = null; vote(c); }
  }
});
refreshCounts(Date.now() - lastFetch > 60 * 1000); // mở lại trang trong vòng 1 phút thì dùng số đã lưu
setInterval(() => refreshCounts(), 30 * 1000);       // chỉ thực sự đếm khi đã quá 5 phút
document.addEventListener("visibilitychange", () => refreshCounts());
setInterval(renderClock, 1000);
const h = location.hash.slice(1).toUpperCase();
if (T.some(t => t.code === h)) openModal(h);
