/* ===================================================================
   کلمه‌بازی — منطق مینی‌اپ (بدون وابستگی خارجی)
   =================================================================== */

const tg = window.Telegram?.WebApp;
const IS_TELEGRAM = Boolean(tg?.initData);

// ------------------------------------------------------------------ ابزار
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const fa = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);

function haptic(type = "light") {
  try {
    const h = tg?.HapticFeedback;
    if (!h) return;
    if (type === "error") h.notificationOccurred("error");
    else if (type === "success") h.notificationOccurred("success");
    else h.impactOccurred(type);
  } catch {
    /* ignore */
  }
}

let toastTimer = null;
function toast(message, kind = "") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast toast--show ${kind ? `toast--${kind}` : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "toast";
  }, 1900);
}

// ------------------------------------------------------------------ API
// در مرورگر (خارج از تلگرام) یک کاربر آزمایشی می‌سازیم؛ سرور این هدر را
// فقط وقتی DEV_AUTH=1 باشد می‌پذیرد، پس در نسخهٔ اصلی بی‌اثر است.
const devUser = (() => {
  try {
    const saved = localStorage.getItem("devUser");
    if (saved) return saved;
    const name = `مهمان ${Math.floor(Math.random() * 900 + 100)}`;
    const payload = encodeURIComponent(
      JSON.stringify({ id: 900000 + Math.floor(Math.random() * 99999), first_name: name }),
    );
    localStorage.setItem("devUser", payload);
    return payload;
  } catch {
    return encodeURIComponent(JSON.stringify({ id: 900001, first_name: "مهمان" }));
  }
})();

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (IS_TELEGRAM) headers["x-init-data"] = tg.initData;
  else headers["x-dev-user"] = devUser;
  if (options.body) headers["content-type"] = "application/json";

  const res = await fetch(path, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error("پاسخ سرور نامعتبر بود");
  }
  if (!res.ok || data?.ok === false) {
    const err = new Error(data?.message ?? "خطای ارتباط با سرور");
    err.code = data?.error;
    err.payload = data;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------------ وضعیت
const state = {
  me: null,
  level: null,
  slots: [],
  daily: null,
  boardPeriod: "today",
  botUsername: "",
  busy: false,
};

// ------------------------------------------------------------------ ناوبری
let currentScreen = "screen-loading";
const history = [];

function showScreen(id, { push = true } = {}) {
  if (id === currentScreen) return;
  if (push && currentScreen !== "screen-loading") history.push(currentScreen);
  $$(".screen").forEach((el) => el.classList.toggle("screen--active", el.id === id));
  currentScreen = id;
  if (tg?.BackButton) {
    if (history.length) tg.BackButton.show();
    else tg.BackButton.hide();
  }
  window.scrollTo(0, 0);
}

function goBack() {
  const prev = history.pop() ?? "screen-home";
  showScreen(prev, { push: false });
  if (prev === "screen-home") refreshHome();
  if (prev === "screen-board") loadBoard();
}

// ------------------------------------------------------------------ قالب‌ها
function setCoins(value) {
  ["#home-coins", "#game-coins"].forEach((sel) => {
    const el = $(sel);
    if (el) el.querySelector("b").textContent = fa(value);
  });
}

function renderSlots(animateRows = false) {
  const wrap = $("#slots");
  wrap.innerHTML = "";
  const sorted = [...state.slots].sort((a, b) => a.length - b.length || a.index - b.index);
  for (const slot of sorted) {
    const row = document.createElement("div");
    row.className = "slot";
    if (!animateRows) row.style.animation = "none";
    row.dataset.index = slot.index;
    for (let pos = 0; pos < slot.length; pos++) {
      const box = document.createElement("div");
      box.className = "box";
      if (slot.word) {
        box.classList.add(slot.bonus ? "box--bonus" : "box--filled");
        box.textContent = slot.word[pos];
      } else if (slot.revealed?.[pos]) {
        box.classList.add("box--hint");
        box.textContent = slot.revealed[pos];
      }
      row.appendChild(box);
    }
    wrap.appendChild(row);
  }
}

function buildSlots(level) {
  const slots = level.slots.map((s) => ({
    index: s.index,
    length: s.length,
    word: null,
    bonus: false,
    revealed: {},
  }));
  for (const hint of level.hints ?? []) {
    const slot = slots.find((s) => s.index === hint.index);
    if (slot) slot.revealed[hint.position] = hint.letter;
  }
  for (const item of level.solved ?? []) {
    const slot = slots.find((s) => s.index === item.index);
    if (slot) slot.word = item.word;
  }
  return slots;
}

function fillSlot(slotIndex, word, animate = true) {
  const slot = state.slots.find((s) => s.index === slotIndex);
  if (!slot) return;
  slot.word = word;
  slot.revealed = {};
  renderSlots();
  if (animate) {
    const el = $(`.slot[data-index="${slotIndex}"]`);
    if (el) el.animate?.(
      [{ transform: "scale(0.9)" }, { transform: "scale(1)" }],
      { duration: 220, easing: "ease-out" },
    );
  }
}

function renderBonus() {
  const line = $("#bonus-line");
  const words = state.level?.bonusFound ?? [];
  line.innerHTML = "";
  line.hidden = words.length === 0;
  if (!words.length) return;
  const label = document.createElement("span");
  label.textContent = "✨ کلمه‌های اضافه:";
  line.appendChild(label);
  for (const word of words) {
    const chip = document.createElement("span");
    chip.className = "bonus-chip";
    chip.textContent = word;
    line.appendChild(chip);
  }
}

function updateHintLabel() {
  const me = state.me;
  const label = $("#hint-label");
  if (!label) return;
  label.textContent = me?.hints > 0 ? `راهنما (${fa(me.hints)})` : "راهنما · ۴۰";
}

// ------------------------------------------------------------------ گردونه
class Wheel {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.letters = [];
    this.order = [];
    this.positions = [];
    this.targets = [];
    this.selection = [];
    this.dragging = false;
    this.pointer = null;
    this.anim = null;
    this.cssSize = 320;

    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("pointercancel", (e) => this.onUp(e));
    window.addEventListener("resize", () => this.resize());
  }

  setLetters(letters, { shuffle = true } = {}) {
    this.letters = [...letters];
    this.order = this.letters.map((_, i) => i);
    if (shuffle) this.order = shuffleArray(this.order);
    this.selection = [];
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(220, Math.min(rect.width || 320, 340));
    this.cssSize = size;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
    // پس از تغییر اندازه، حروف باید روی حلقهٔ جدید بنشینند (نه مختصات قبلی)
    if (!this.anim) this.positions = this.targets.map((t) => ({ ...t }));
    this.draw();
  }

  layout() {
    const n = this.letters.length || 1;
    const size = this.cssSize;
    const cx = size / 2;
    const cy = size / 2;
    const tile = Math.max(38, Math.min(54, size * (n > 6 ? 0.155 : 0.165)));
    const radius = size / 2 - tile / 2 - 4;
    this.cx = cx;
    this.cy = cy;
    this.tile = tile;
    this.radius = radius;
    this.targets = this.order.map((_, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    });
    if (!this.anim && (this.positions.length !== n || this.positions.length === 0)) {
      this.positions = this.targets.map((t) => ({ ...t }));
    }
  }

  shuffle() {
    const previous = this.positions.map((p) => ({ ...p }));
    this.order = shuffleArray(this.order);
    this.layout();
    this.anim = {
      from: previous,
      to: this.targets.map((t) => ({ ...t })),
      start: performance.now(),
      duration: 380,
    };
    this.selection = [];
    this.emitSelection();
    this.animate();
  }

  animate() {
    if (!this.anim) return;
    const { from, to, start, duration } = this.anim;
    const t = Math.min(1, (performance.now() - start) / duration);
    const ease = 1 - Math.pow(1 - t, 3);
    this.positions = to.map((target, i) => ({
      x: from[i].x + (target.x - from[i].x) * ease,
      y: from[i].y + (target.y - from[i].y) * ease,
    }));
    this.draw();
    if (t < 1) requestAnimationFrame(() => this.animate());
    else {
      this.positions = to.map((p) => ({ ...p }));
      this.anim = null;
      this.draw();
    }
  }

  draw() {
    const ctx = this.ctx;
    const { cx, cy, radius, tile } = this;
    ctx.clearRect(0, 0, this.cssSize, this.cssSize);

    // حلقهٔ محو پشت گردونه
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(139,92,246,0.16)";
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 9]);
    ctx.stroke();
    ctx.restore();

    // خطوط انتخاب
    if (this.selection.length) {
      const points = this.selection.map((idx) => this.positions[idx]);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(139,92,246,0.35)";
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
      if (this.dragging && this.pointer) ctx.lineTo(this.pointer.x, this.pointer.y);
      ctx.stroke();
      ctx.strokeStyle = "#a78bfa";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.restore();
    }

    // حروف
    this.order.forEach((letterIdx, slotIdx) => {
      const pos = this.positions[slotIdx] ?? this.targets[slotIdx];
      const letter = this.letters[letterIdx];
      const selected = this.selection.includes(slotIdx);
      const r = tile / 2;

      ctx.save();
      ctx.translate(pos.x, pos.y);

      if (selected) {
        ctx.shadowColor = "rgba(139,92,246,0.85)";
        ctx.shadowBlur = 18;
      } else {
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
      }

      const grad = ctx.createLinearGradient(-r, -r, r, r);
      if (selected) {
        grad.addColorStop(0, "#a78bfa");
        grad.addColorStop(1, "#6d3ef0");
      } else {
        grad.addColorStop(0, "rgba(255,255,255,0.16)");
        grad.addColorStop(1, "rgba(255,255,255,0.06)");
      }
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.shadowColor = "transparent";
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = selected ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.14)";
      ctx.stroke();

      ctx.fillStyle = selected ? "#fff" : "#efe9ff";
      ctx.font = `700 ${Math.round(tile * 0.44)}px Vazirmatn, Tahoma, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, 0, 1);
      ctx.restore();
    });
  }

  localPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  hitTest(point) {
    const threshold = this.tile * 0.62;
    let best = -1;
    let bestDist = Infinity;
    this.positions.forEach((pos, idx) => {
      const dist = Math.hypot(pos.x - point.x, pos.y - point.y);
      if (dist < threshold && dist < bestDist) {
        best = idx;
        bestDist = dist;
      }
    });
    return best;
  }

  onDown(event) {
    if (state.busy) return;
    event.preventDefault();
    this.canvas.setPointerCapture?.(event.pointerId);
    const point = this.localPoint(event);
    const hit = this.hitTest(point);
    this.dragging = true;
    this.selection = hit >= 0 ? [hit] : [];
    this.pointer = point;
    this.startPoint = point;
    haptic("light");
    this.emitSelection();
    this.draw();
  }

  onMove(event) {
    if (!this.dragging) return;
    event.preventDefault();
    const point = this.localPoint(event);
    this.pointer = point;
    const hit = this.hitTest(point);
    if (hit >= 0 && hit !== this.selection[this.selection.length - 1]) {
      const existingIdx = this.selection.indexOf(hit);
      if (existingIdx === -1) {
        this.selection.push(hit);
        haptic("light");
      } else if (existingIdx === this.selection.length - 2) {
        this.selection.pop();
        haptic("light");
      }
      this.emitSelection();
    }
    this.draw();
  }

  onUp(event) {
    if (!this.dragging) return;
    this.dragging = false;
    this.pointer = null;
    const word = this.selection.map((i) => this.letters[this.order[i]]).join("");
    this.selection = [];
    this.draw();
    this.emitSelection();
    if (word.length >= 2) onWordAttempt(word);
  }

  emitSelection() {
    const tray = $("#word-tray");
    const word = this.selection.map((i) => this.letters[this.order[i]]);
    tray.innerHTML = "";
    if (!word.length) {
      tray.classList.remove("word-tray--active");
      return;
    }
    tray.classList.add("word-tray--active");
    for (const letter of word) {
      const el = document.createElement("span");
      el.className = "tray-letter";
      el.textContent = letter;
      tray.appendChild(el);
    }
  }

  reset() {
    this.selection = [];
    this.dragging = false;
    this.emitSelection();
    this.draw();
  }
}

function shuffleArray(array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

let wheel = null;

// ------------------------------------------------------------------ بازی
async function openLevel(n) {
  try {
    state.busy = true;
    const data = await api(`/api/level?n=${n}`);
    state.level = data.level;
    state.me = data.player;
    state.slots = buildSlots(data.level);

    $("#game-level").textContent = fa(data.level.id);
    setCoins(data.player.coins);
    updateHintLabel();
    renderSlots(true);
    renderBonus();

    wheel.setLetters(data.level.letters);
    $("#word-tray").innerHTML = "";
    showScreen("screen-game");
    requestAnimationFrame(() => wheel.resize());
  } catch (err) {
    toast(err.message, "err");
  } finally {
    state.busy = false;
  }
}

async function onWordAttempt(rawWord) {
  if (state.busy || !state.level) return;
  const word = rawWord;

  if (word.length < 3) {
    toast("کلمه باید حداقل ۳ حرف باشد", "err");
    haptic("error");
    return;
  }

  state.busy = true;
  try {
    const data = await api("/api/guess", {
      method: "POST",
      body: JSON.stringify({ level: state.level.id, word }),
    });

    state.me = data.player;
    setCoins(data.player.coins);
    updateHintLabel();

    if (data.isBonus) {
      if (state.level) {
        state.level.bonusFound = [...(state.level.bonusFound ?? []), data.word];
      }
      renderBonus();
      toast(`کلمهٔ اضافه! ${data.word} +${fa(data.points)}`, "ok");
      haptic("success");
      flashWord(data.word);
    } else {
      fillSlot(data.slotIndex, data.word);
      haptic("success");
      toast(`${data.word} +${fa(data.points)} امتیاز`, "ok");
    }

    if (data.levelComplete) {
      setTimeout(() => showWin(data), 420);
    }
  } catch (err) {
    haptic("error");
    toast(err.message ?? "پذیرفته نشد", "err");
    shakeWheel();
  } finally {
    state.busy = false;
  }
}

function flashWord(word) {
  // نمایش کوتاه کلمهٔ اضافه بالای گردونه
  const tray = $("#word-tray");
  tray.innerHTML = "";
  tray.classList.add("word-tray--active");
  for (const letter of word) {
    const el = document.createElement("span");
    el.className = "tray-letter";
    el.textContent = letter;
    tray.appendChild(el);
  }
  setTimeout(() => {
    tray.classList.remove("word-tray--active");
    tray.innerHTML = "";
  }, 1100);
}

function shakeWheel() {
  const el = $("#wheel");
  el.animate?.(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-6px)" },
      { transform: "translateX(6px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 260, easing: "ease-in-out" },
  );
}

async function useHint() {
  if (state.busy || !state.level) return;
  state.busy = true;
  try {
    const data = await api("/api/hint", {
      method: "POST",
      body: JSON.stringify({ level: state.level.id }),
    });
    const slot = state.slots.find((s) => s.index === data.hint.index);
    if (slot) {
      slot.revealed[data.hint.position] = data.hint.letter;
      renderSlots();
    }
    state.me = data.player;
    setCoins(data.player.coins);
    updateHintLabel();
    haptic("success");
    toast(data.paid ? `یک حرف لو رفت (−${fa(data.paid)} سکه)` : "یک حرف لو رفت (راهنمای رایگان)", "ok");
  } catch (err) {
    toast(err.message, "err");
    haptic("error");
  } finally {
    state.busy = false;
  }
}

// ------------------------------------------------------------------ پایان مرحله
function showWin(data) {
  $("#win-points").textContent = `+${fa(data.completeBonus + data.points)}`;
  $("#win-coins").textContent = `+${fa(data.coins + data.completeCoins)}`;
  $("#win-sub").textContent = `مرحلهٔ ${fa(state.level.id)} کامل شد — کلمه‌ها و جایزه‌ات ثبت شد`;
  const sheet = $("#win-sheet");
  sheet.classList.add("sheet--open");
  sheet.setAttribute("aria-hidden", "false");
  burstConfetti();
  haptic("success");
  if (tg?.MainButton) {
    tg.MainButton.setText("مرحلهٔ بعد");
    tg.MainButton.show();
  }
}

function hideWin() {
  const sheet = $("#win-sheet");
  sheet.classList.remove("sheet--open");
  sheet.setAttribute("aria-hidden", "true");
  if (tg?.MainButton) tg.MainButton.hide();
}

function burstConfetti() {
  const wrap = $("#confetti");
  wrap.innerHTML = "";
  const colors = ["#8b5cf6", "#fbbf24", "#34d399", "#fb7185", "#60a5fa"];
  for (let i = 0; i < 26; i++) {
    const piece = document.createElement("i");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${1.1 + Math.random() * 1.1}s`;
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    wrap.appendChild(piece);
  }
}

// ------------------------------------------------------------------ خانه
async function refreshHome() {
  try {
    const data = await api("/api/me");
    state.me = data.player;
    state.daily = data.daily;
    state.botUsername = data.botUsername || "";
    setCoins(data.player.coins);
    $("#home-streak").querySelector("b").textContent = fa(data.player.streak);
    $("#stat-today").textContent = fa(data.today.points);
    $("#stat-rank").textContent = data.today.rank ? fa(data.today.rank) : "—";
    $("#stat-total").textContent = fa(data.player.points);
    $("#home-level").textContent = fa(data.player.level);
    $("#home-title").textContent = `مرحلهٔ ${fa(data.player.level)}`;

    const level = await api(`/api/level?n=${data.player.level}`);
    const solved = level.level.solved.length;
    const total = level.level.slots.length;
    const pct = total ? solved / total : 0;
    const ring = $("#home-ring");
    const circumference = 2 * Math.PI * 52;
    ring.style.strokeDasharray = String(circumference);
    ring.style.strokeDashoffset = String(circumference * (1 - pct));
    ring.style.stroke = "var(--brand)";
    $("#home-sub").textContent = total
      ? solved
        ? `${fa(solved)} از ${fa(total)} کلمه پیدا شده`
        : "آماده‌ای؟ روی دکمه بزن"
      : "مرحلهٔ تازه";
    return true;
  } catch (err) {
    toast(err.message, "err");
    return false;
  }
}

// ------------------------------------------------------------------ جدول
async function loadBoard(period = state.boardPeriod) {
  state.boardPeriod = period;
  $$("#board-tabs .tab").forEach((tab) => tab.classList.toggle("tab--active", tab.dataset.period === period));
  const list = $("#board-list");
  list.innerHTML = `<div class="board-empty">در حال بارگذاری…</div>`;
  try {
    const data = await api(`/api/leaderboard?period=${period}`);
    if (!data.rows.length) {
      list.innerHTML = `<div class="board-empty">هنوز کسی در این بازه بازی نکرده.<br>اولین نفر باش! 🥇</div>`;
      return;
    }
    const medals = ["🥇", "🥈", "🥉"];
    list.innerHTML = "";
    for (const row of data.rows) {
      const el = document.createElement("div");
      el.className = `row${row.me ? " row--me" : ""}`;
      const medal = medals[row.rank - 1] ?? fa(row.rank);
      el.innerHTML = `
        <span class="row__rank">${medal}</span>
        <span class="row__avatar">${escapeHtml(row.name.slice(0, 1))}</span>
        <span class="row__name">${escapeHtml(row.name)}${row.me ? " (شما)" : ""}</span>
        <span class="row__points">${fa(row.points)}<span>امتیاز</span></span>
      `;
      list.appendChild(el);
    }
  } catch (err) {
    list.innerHTML = `<div class="board-empty">${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

// ------------------------------------------------------------------ شروع
function applyTelegramTheme() {
  if (!tg) return;
  const scheme = tg.colorScheme;
  document.documentElement.dataset.theme = scheme === "light" ? "light" : "dark";
  try {
    tg.setHeaderColor("#120a26");
    tg.setBackgroundColor("#120a26");
    tg.expand?.();
    tg.enableClosingConfirmation?.();
  } catch {
    /* ignore */
  }
}

function bindEvents() {
  $("#btn-play").addEventListener("click", () => openLevel(state.me?.level ?? 1));
  $("#btn-back").addEventListener("click", () => goBack());
  $("#board-back").addEventListener("click", () => goBack());
  $("#rules-back").addEventListener("click", () => goBack());
  $("#btn-shuffle").addEventListener("click", () => {
    wheel?.shuffle();
    haptic("light");
  });
  $("#btn-hint").addEventListener("click", useHint);
  $("#btn-next").addEventListener("click", () => {
    hideWin();
    openLevel((state.level?.id ?? 1) + 1);
  });
  $("#btn-win-board").addEventListener("click", () => {
    hideWin();
    showScreen("screen-board");
    loadBoard("today");
  });

  $$("[data-go]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.go;
      if (target === "board") {
        showScreen("screen-board");
        loadBoard("today");
      } else if (target === "rules") {
        showScreen("screen-rules");
      } else if (target === "daily") {
        const n = state.daily ?? 1;
        toast(`مرحلهٔ امروز: ${fa(n)}`);
        openLevel(n);
      }
    });
  });

  $("#btn-invite").addEventListener("click", () => {
    const bot = state.botUsername || "hydrogameofficialbot";
    const url = `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${bot}`)}&text=${encodeURIComponent("بیا «کلمه‌بازی» بازی کنیم! 🎮")}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank");
  });

  $$("#board-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => loadBoard(tab.dataset.period));
  });

  if (tg?.BackButton) tg.BackButton.onClick(() => goBack());
  if (tg?.MainButton) tg.MainButton.onClick(() => {
    hideWin();
    openLevel((state.level?.id ?? 1) + 1);
  });
}

async function boot() {
  applyTelegramTheme();
  tg?.ready?.();
  wheel = new Wheel($("#wheel"));
  bindEvents();

  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }

  const ready = await refreshHome();
  if (!ready && !IS_TELEGRAM) {
    $("#screen-loading .loader__text").textContent = "بازی را از داخل تلگرام باز کنید";
    return;
  }
  showScreen("screen-home", { push: false });

  // لینک «مرحلهٔ امروز» از ربات: ?daily=1
  if (new URLSearchParams(location.search).get("daily") === "1" && state.daily) {
    openLevel(state.daily);
  }
}

boot();
