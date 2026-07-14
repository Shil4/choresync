// ChoreSync — front-end (gamified)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CFG = window.CHORE_CONFIG || {};
const configured =
  CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("YOUR_") &&
  CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes("YOUR_") &&
  CFG.HOUSEHOLD_ID && !CFG.HOUSEHOLD_ID.includes("YOUR_");
const sb = configured ? createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
const HID = CFG.HOUSEHOLD_ID;

// --- Chore data -------------------------------------------------------------
const BUNDLES = [
  { id: "A", title: "Hoover + kitchen surfaces", items: [
    { n: "Hoover carpet (connecting areas)", m: 20 },
    { n: "Kitchen — countertop", m: 5 },
    { n: "Kitchen — microwave", m: 5 } ] },
  { id: "B", title: "Living room + corridor + kitchen scrub", items: [
    { n: "Living room — sweep", m: 8 },
    { n: "Living room — trash", m: 4 },
    { n: "Corridor (landing + LR entrance)", m: 5 },
    { n: "Kitchen — sink", m: 6 },
    { n: "Kitchen — hob", m: 8 } ] },
  { id: "C", title: "Floors & wet", items: [
    { n: "Washroom — sweep", m: 5 },
    { n: "Washroom — mop", m: 8 },
    { n: "Washroom — sink", m: 5 },
    { n: "Kitchen — sweep", m: 6 },
    { n: "Kitchen — mop", m: 8 } ] },
];
const bundleColor = { A: "var(--A)", B: "var(--B)", C: "var(--C)" };
const PCOL = ["#6366f1", "#f43f5e", "#10b981"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const mod = (n, m) => (((n % m) + m) % m);
const bundleMins = (b) => b.items.reduce((s, i) => s + i.m, 0);
const doneCount = (done, b) => b.items.filter((_, i) => done[`${b.id}:${i}`]).length;
const doneMins = (done, b) => b.items.reduce((s, it, i) => s + (done[`${b.id}:${i}`] ? it.m : 0), 0);
const bundleComplete = (done, b) => b.items.every((_, i) => done[`${b.id}:${i}`]);

// --- Dates ------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function mondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - mod(x.getDay() + 6, 7)); return x; }
function anchorMonday() { return mondayOf(new Date((state.household?.anchor_monday || "2026-07-13") + "T00:00:00")); }
function weekIndexOf(monday) { return Math.round((monday - anchorMonday()) / (7 * 864e5)); }
function assignmentsFor(wi, members) { return members.map((name, i) => ({ name, i, bundle: BUNDLES[mod(i + wi, 3)] })); }
function prettyRange(monday) {
  const sun = new Date(monday); sun.setDate(sun.getDate() + 6);
  const f = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${f(monday)} – ${f(sun)}`;
}
function initials(name) {
  const p = String(name || "?").trim().split(/\s+/);
  return ((p[0]?.[0] || "?") + (p[1]?.[0] || "")).toUpperCase();
}

// --- State ------------------------------------------------------------------
const state = {
  tab: "home", household: null,
  viewMonday: mondayOf(new Date()),
  weekState: { done: {}, bins_out: [], bins_in: [] },
  me: localStorage.getItem("choresync_me") || "",
  stats: null,
};
const weekKey = () => ymd(state.viewMonday);
const myIndex = () => Math.max(0, (state.household?.members || []).indexOf(state.me));
const myAssignment = () => BUNDLES[mod(myIndex() + weekIndexOf(state.viewMonday), 3)];

// --- Data -------------------------------------------------------------------
async function loadHousehold() {
  const { data } = await sb.from("household").select("*").eq("id", HID).single();
  state.household = data;
  const m = data?.members || [];
  if (!m.includes(state.me) && m.length) state.me = m[0];
}
async function loadWeek() {
  const { data } = await sb.from("week_state").select("*")
    .eq("household_id", HID).eq("week_key", weekKey()).maybeSingle();
  state.weekState = data
    ? { done: data.done || {}, bins_out: data.bins_out || [], bins_in: data.bins_in || [] }
    : { done: {}, bins_out: [], bins_in: [] };
}
async function persistWeek() {
  await sb.from("week_state").upsert(
    { household_id: HID, week_key: weekKey(), ...state.weekState, updated_at: new Date().toISOString() },
    { onConflict: "household_id,week_key" });
}
async function loadStats() {
  const members = state.household?.members || [];
  const { data } = await sb.from("week_state").select("week_key,done").eq("household_id", HID);
  const byIdx = {};                       // weekIndex -> done map
  for (const r of data || []) {
    const wi = weekIndexOf(mondayOf(new Date(r.week_key + "T00:00:00")));
    byIdx[wi] = r.done || {};
  }
  const xp = members.map(() => 0), weeks = members.map(() => 0), streak = members.map(() => 0);
  for (const [wiStr, done] of Object.entries(byIdx)) {
    const wi = +wiStr;
    members.forEach((_, idx) => {
      const b = BUNDLES[mod(idx + wi, 3)];
      xp[idx] += doneMins(done, b);
      if (bundleComplete(done, b)) weeks[idx] += 1;
    });
  }
  const completedAt = (wi, idx) => byIdx[wi] && bundleComplete(byIdx[wi], BUNDLES[mod(idx + wi, 3)]);
  const cur = weekIndexOf(mondayOf(new Date()));
  members.forEach((_, idx) => {
    let wi = completedAt(cur, idx) ? cur : cur - 1, s = 0;
    while (completedAt(wi, idx)) { s++; wi--; }
    streak[idx] = s;
  });
  state.stats = { xp, weeks, streak, level: xp.map((v) => Math.floor(v / 100) + 1) };
}
function subscribeRealtime() {
  sb.channel("choresync")
    .on("postgres_changes", { event: "*", schema: "public", table: "household", filter: `id=eq.${HID}` },
      (p) => { state.household = p.new; render(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "week_state", filter: `household_id=eq.${HID}` },
      async (p) => { if (p.new?.week_key === weekKey()) { state.weekState = { done: p.new.done || {}, bins_out: p.new.bins_out || [], bins_in: p.new.bins_in || [] }; } await loadStats(); render(); })
    .subscribe();
}

// --- Actions ----------------------------------------------------------------
async function toggleDone(bId, idx) {
  const key = `${bId}:${idx}`;
  const wasComplete = bundleComplete(state.weekState.done, myAssignment());
  const done = { ...state.weekState.done };
  if (done[key]) delete done[key]; else done[key] = true;
  state.weekState = { ...state.weekState, done };
  render();
  if (!wasComplete && bundleComplete(done, myAssignment())) burstConfetti();
  await persistWeek(); await loadStats(); render();
}
async function toggleVolunteer(kind, name) {
  const arr = [...(state.weekState[kind] || [])];
  const i = arr.indexOf(name);
  if (i >= 0) arr.splice(i, 1); else arr.push(name);
  state.weekState = { ...state.weekState, [kind]: arr };
  render(); await persistWeek();
}
async function saveSettings(f) {
  const patch = {
    name: f.name.value.trim() || "Our House",
    members: [f.m0.value.trim(), f.m1.value.trim(), f.m2.value.trim()],
    timezone: f.tz.value.trim() || "UTC",
    anchor_monday: f.anchor.value,
    reminder_day: +f.rday.value, reminder_time: f.rtime.value,
    bins_out_day: +f.boday.value, bins_out_time: f.botime.value,
    bins_in_day: +f.biday.value, bins_in_time: f.bitime.value,
    pin: f.pin.value.trim(), updated_at: new Date().toISOString(),
  };
  await sb.from("household").update(patch).eq("id", HID);
  state.household = { ...state.household, ...patch };
  if (patch.pin) localStorage.setItem("choresync_pin", patch.pin); else localStorage.removeItem("choresync_pin");
  await loadStats();
  const s = document.getElementById("saved"); if (s) { s.textContent = "Saved ✓"; setTimeout(() => (s.textContent = ""), 2000); }
  render();
}

// --- Web push ---------------------------------------------------------------
function urlB64ToUint8Array(b64) {
  const p = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enableNotifications() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      alert("This browser can't do push. On iPhone, add the app to your Home Screen first, then try again."); return; }
    if (await Notification.requestPermission() !== "granted") { alert("Notifications not allowed."); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(CFG.VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, household_id: HID, person: state.me, subscription: j }, { onConflict: "endpoint" });
    alert("Reminders on for this device ✓");
  } catch (e) { alert("Couldn't enable notifications: " + (e?.message || e)); }
}

// --- PIN gate ---------------------------------------------------------------
function pinPasses() { const p = state.household?.pin; return !p || localStorage.getItem("choresync_pin") === p; }
function renderPinGate() {
  document.getElementById("weekpill").innerHTML = "";
  document.getElementById("houseName").textContent = state.household?.name || "ChoreSync";
  view.innerHTML = `<form id="pinForm"><div class="card">
    <div class="section-title">Enter house PIN</div>
    <div class="field"><input type="text" inputmode="numeric" name="pin" placeholder="Shared PIN" autocomplete="off"></div>
    <button class="btn">Unlock</button><div id="pinErr" class="saved" style="color:#b91c1c"></div></div></form>`;
  document.getElementById("pinForm").onsubmit = (e) => {
    e.preventDefault();
    if (e.target.pin.value.trim() === state.household.pin) { localStorage.setItem("choresync_pin", state.household.pin); afterUnlock(); }
    else document.getElementById("pinErr").textContent = "Wrong PIN";
  };
}
async function afterUnlock() { await loadWeek(); await loadStats(); subscribeRealtime(); render(); }

// --- Rendering --------------------------------------------------------------
const view = document.getElementById("view");
const ring = (pct, color) => {
  const c = 2 * Math.PI * 24, off = c * (1 - pct);
  return `<div class="ring"><svg width="56" height="56">
    <circle cx="28" cy="28" r="24" stroke="#eef2f7" stroke-width="7" fill="none"/>
    <circle cx="28" cy="28" r="24" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg>
    <div class="pct">${Math.round(pct * 100)}%</div></div>`;
};

function renderHero() {
  document.getElementById("houseName").textContent = state.household?.name || "ChoreSync";
  const sel = document.getElementById("meSelect");
  const m = state.household?.members || [];
  sel.innerHTML = m.map((x) => `<option${x === state.me ? " selected" : ""}>${esc(x)}</option>`).join("");
  sel.onchange = () => { state.me = sel.value; localStorage.setItem("choresync_me", state.me); render(); };
  const isThis = weekKey() === ymd(mondayOf(new Date()));
  document.getElementById("weekpill").innerHTML =
    `<button id="pw">‹</button><div class="lbl">${isThis ? "This week" : "Week of"}<small>${prettyRange(state.viewMonday)}</small></div><button id="nw">›</button>`;
  document.getElementById("pw").onclick = () => shiftWeek(-7);
  document.getElementById("nw").onclick = () => shiftWeek(7);
}
async function shiftWeek(d) { const x = new Date(state.viewMonday); x.setDate(x.getDate() + d); state.viewMonday = mondayOf(x); await loadWeek(); render(); }

function missionCard(a) {
  const done = state.weekState.done, color = PCOL[a.i];
  const pct = doneCount(done, a.bundle) / a.bundle.items.length;
  const st = state.stats?.streak[a.i] || 0;
  const items = a.bundle.items.map((it, idx) => {
    const on = !!done[`${a.bundle.id}:${idx}`];
    return `<div class="task ${on ? "done" : ""}" data-b="${a.bundle.id}" data-i="${idx}">
      <div class="box">${on ? "✓" : ""}</div><div class="t">${esc(it.n)}</div><div class="xp">+${it.m}</div></div>`;
  }).join("");
  const complete = bundleComplete(done, a.bundle);
  return `<div class="card mission me" style="--accent:${color}">
    <div class="flag">YOUR MISSION</div>
    <div class="phead">
      <div class="avatar" style="background:${color}">${esc(initials(a.name))}</div>
      <div><div class="pname">${esc(a.name)}</div>
        <div class="pbundle" style="color:${color}"><span class="dot" style="background:${bundleColor[a.bundle.id]}"></span>${esc(a.bundle.title)}</div>
        ${st ? `<div class="streak">🔥 ${st}-week streak</div>` : ""}</div>
      ${ring(pct, color)}
    </div>
    <div class="tasks">${items}</div>
    ${complete ? `<div class="donebanner">🎉 All done — +${bundleMins(a.bundle)} XP earned!</div>` : ""}
  </div>`;
}
function miniCard(a) {
  const done = state.weekState.done, color = PCOL[a.i];
  const c = doneCount(done, a.bundle), tot = a.bundle.items.length, pct = Math.round((c / tot) * 100);
  return `<div class="mini">
    <div class="avatar" style="background:${color}">${esc(initials(a.name))}</div>
    <div class="info"><div class="n">${esc(a.name)}</div>
      <div class="b"><span class="dot" style="background:${bundleColor[a.bundle.id]}"></span> Bundle ${a.bundle.id} · ${a.bundle.title}</div>
      <div class="bar"><span style="width:${pct}%;background:${color}"></span></div></div>
    <div class="mp">${c}/${tot}</div></div>`;
}
function binBlock(kind, label, day, time) {
  const chosen = state.weekState[kind] || [];
  const chips = (state.household.members || []).map((m) =>
    `<button class="chip ${chosen.includes(m) ? "on" : ""}" data-kind="${kind}" data-m="${esc(m)}">${chosen.includes(m) ? "⭐ " : ""}${esc(m)}</button>`).join("");
  return `<div class="binrow"><div class="ico">🗑️</div><div class="bmeta">
    <div class="bt">${label}</div><div class="bwhen">${DAYS[day]} · ${time}</div>
    <div class="chips">${chips}</div>
    ${chosen.length ? "" : `<div class="emptyvol">No one yet — tap your name to volunteer.</div>`}
  </div></div>`;
}
function renderHome() {
  const h = state.household, wi = weekIndexOf(state.viewMonday);
  const all = assignmentsFor(wi, h.members);
  const mine = all.find((a) => a.i === myIndex()) || all[0];
  const others = all.filter((a) => a !== mine);
  view.innerHTML =
    missionCard(mine) +
    `<div class="section-title">Housemates</div><div class="card">${others.map(miniCard).join("")}</div>` +
    `<div class="section-title">Bins</div><div class="card">
      ${binBlock("bins_out", "Take the bins out", h.bins_out_day, h.bins_out_time)}
      ${binBlock("bins_in", "Bring the bins in", h.bins_in_day, h.bins_in_time)}</div>`;
  view.querySelectorAll(".task").forEach((t) => t.onclick = () => toggleDone(t.dataset.b, +t.dataset.i));
  view.querySelectorAll(".chip").forEach((c) => c.onclick = () => {
    if (c.dataset.m !== state.me) { state.me = c.dataset.m; localStorage.setItem("choresync_me", state.me); renderHero(); }
    toggleVolunteer(c.dataset.kind, c.dataset.m);
  });
}

function renderRanks() {
  const h = state.household, s = state.stats;
  const rows = (h.members || []).map((name, i) => ({
    name, i, xp: s.xp[i], lvl: s.level[i], weeks: s.weeks[i], streak: s.streak[i],
  })).sort((a, b) => b.xp - a.xp);
  const medal = ["🥇", "🥈", "🥉"];
  const body = rows.map((r, rank) => {
    const into = r.xp % 100;
    return `<div class="lb">
      <div class="rank">${medal[rank] || rank + 1}</div>
      <div class="info"><div class="n">${esc(r.name)} <span class="lvl" style="background:${PCOL[r.i]}">Lv ${r.lvl}</span></div>
        <div class="meta">${r.weeks} week${r.weeks === 1 ? "" : "s"} completed${r.streak ? ` · 🔥 ${r.streak}` : ""}</div>
        <div class="xpbar"><span style="width:${into}%"></span></div></div>
      <div class="total">${r.xp}<small>XP</small></div></div>`;
  }).join("");
  view.innerHTML = `<div class="section-title">Leaderboard — this season</div><div class="card">${body}</div>
    <div class="card" style="color:var(--muted);font-size:14px">
      Earn <b>XP</b> by ticking off your chores — 1 minute of cleaning = 1 XP.
      Finish your whole bundle to keep your 🔥 streak alive. Every 100 XP is a new level.</div>`;
}

function daySel(id, v) { return `<select class="inp" name="${id}">${DAYS.map((d, i) => `<option value="${i}"${i === v ? " selected" : ""}>${d}</option>`).join("")}</select>`; }
function renderSettings() {
  const h = state.household, m = h.members || [];
  view.innerHTML = `<form id="settings">
    <div class="section-title">House &amp; people</div>
    <div class="card">
      <div class="field"><label>House name</label><input type="text" name="name" value="${esc(h.name)}"></div>
      <div class="field"><label>Person 1</label><input type="text" name="m0" value="${esc(m[0] || "")}"></div>
      <div class="field"><label>Person 2</label><input type="text" name="m1" value="${esc(m[1] || "")}"></div>
      <div class="field"><label>Person 3</label><input type="text" name="m2" value="${esc(m[2] || "")}"></div>
      <div class="field"><label>Shared PIN (blank = off)</label><input type="text" inputmode="numeric" name="pin" value="${esc(h.pin || "")}"></div>
    </div>
    <div class="section-title">Rotation</div>
    <div class="card">
      <div class="field"><label>Week 1 starts (a Monday)</label><input type="date" name="anchor" value="${h.anchor_monday}"></div>
      <div class="field"><label>Timezone (e.g. Europe/London)</label><input type="text" name="tz" value="${esc(h.timezone)}"></div>
    </div>
    <div class="section-title">Reminders</div>
    <div class="card">
      <div class="field"><label>Chore day &amp; time</label><div class="row2">${daySel("rday", h.reminder_day)}<input type="time" name="rtime" value="${h.reminder_time}"></div></div>
      <div class="field"><label>Bins out</label><div class="row2">${daySel("boday", h.bins_out_day)}<input type="time" name="botime" value="${h.bins_out_time}"></div></div>
      <div class="field"><label>Bins in</label><div class="row2">${daySel("biday", h.bins_in_day)}<input type="time" name="bitime" value="${h.bins_in_time}"></div></div>
    </div>
    <button type="submit" class="btn">Save settings</button>
    <button type="button" id="notifyBtn" class="btn secondary">🔔 Turn on reminders for this device</button>
    <div id="saved" class="saved"></div>
  </form>`;
  const f = document.getElementById("settings");
  f.onsubmit = (e) => { e.preventDefault(); saveSettings(f); };
  document.getElementById("notifyBtn").onclick = enableNotifications;
}

function render() {
  if (!configured) { view.innerHTML = `<div class="notice">Not set up yet — fill in <b>config.js</b> (see README).</div>`; return; }
  if (!state.household) { view.innerHTML = `<div class="loading">Loading…</div>`; return; }
  renderHero();
  if (state.tab === "home") renderHome();
  else if (state.tab === "ranks") renderRanks();
  else renderSettings();
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
}
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// --- Confetti ---------------------------------------------------------------
function burstConfetti() {
  const cv = document.getElementById("confetti"), ctx = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ["#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#0ea5e9"];
  const P = Array.from({ length: 130 }, () => ({
    x: innerWidth / 2, y: innerHeight / 3, r: 4 + Math.random() * 6,
    a: Math.random() * 6.28, v: 4 + Math.random() * 7,
    vy: -6 - Math.random() * 6, c: cols[(Math.random() * cols.length) | 0], rot: Math.random() * 6.28,
  }));
  let t = 0;
  (function frame() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    P.forEach((p) => {
      p.x += Math.cos(p.a) * p.v; p.vy += 0.35; p.y += p.vy; p.rot += 0.2;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6); ctx.restore();
    });
    if (++t < 110) requestAnimationFrame(frame); else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}

// --- Boot -------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((t) => t.onclick = () => { state.tab = t.dataset.tab; render(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
(async () => {
  if (!configured) { render(); return; }
  await loadHousehold();
  if (!pinPasses()) { renderPinGate(); return; }
  await afterUnlock();
})();
