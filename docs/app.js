// ChoreSync — front-end logic
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CFG = window.CHORE_CONFIG || {};
const configured =
  CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("YOUR_") &&
  CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes("YOUR_") &&
  CFG.HOUSEHOLD_ID && !CFG.HOUSEHOLD_ID.includes("YOUR_");

const sb = configured ? createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
const HID = CFG.HOUSEHOLD_ID;

// --- Chore data (mirrored in the Edge Function) -----------------------------
const BUNDLES = [
  { id: "A", title: "Hoover + kitchen surfaces", items: [
    { n: "Hoover carpet (connecting areas)", m: 20 },
    { n: "Kitchen — countertop", m: 5 },
    { n: "Kitchen — microwave", m: 5 },
  ]},
  { id: "B", title: "Living room + corridor + kitchen scrub", items: [
    { n: "Living room — sweep", m: 8 },
    { n: "Living room — trash", m: 4 },
    { n: "Corridor (landing + LR entrance)", m: 5 },
    { n: "Kitchen — sink", m: 6 },
    { n: "Kitchen — hob", m: 8 },
  ]},
  { id: "C", title: "Floors & wet", items: [
    { n: "Washroom — sweep", m: 5 },
    { n: "Washroom — mop", m: 8 },
    { n: "Washroom — sink", m: 5 },
    { n: "Kitchen — sweep", m: 6 },
    { n: "Kitchen — mop", m: 8 },
  ]},
];
const bundleMins = (b) => b.items.reduce((s, i) => s + i.m, 0);
const mod = (n, m) => (((n % m) + m) % m);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// --- Date helpers -----------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function mondayOf(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - mod(x.getDay() + 6, 7));
  return x;
}
function weekIndexOf(monday, anchorStr) {
  const anchor = mondayOf(new Date(anchorStr + "T00:00:00"));
  return Math.round((monday - anchor) / (7 * 864e5));
}
function assignmentsFor(weekIndex, members) {
  return members.map((name, i) => ({ name, bundle: BUNDLES[mod(i + weekIndex, 3)] }));
}
function prettyRange(monday) {
  const sun = new Date(monday); sun.setDate(sun.getDate() + 6);
  const f = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${f(monday)} – ${f(sun)}`;
}

// --- State ------------------------------------------------------------------
const state = {
  tab: "week",
  household: null,
  viewMonday: mondayOf(new Date()),
  weekState: null,          // { done, bins_out, bins_in }
  me: localStorage.getItem("choresync_me") || "",
  pinOk: false,
};
const weekKey = () => ymd(state.viewMonday);
const emptyWeek = () => ({ done: {}, bins_out: [], bins_in: [] });

// --- Data loading + realtime ------------------------------------------------
async function loadHousehold() {
  const { data } = await sb.from("household").select("*").eq("id", HID).single();
  state.household = data;
  if (!state.me && data?.members?.length) state.me = data.members[0];
}
async function loadWeek() {
  const { data } = await sb.from("week_state").select("*")
    .eq("household_id", HID).eq("week_key", weekKey()).maybeSingle();
  state.weekState = data
    ? { done: data.done || {}, bins_out: data.bins_out || [], bins_in: data.bins_in || [] }
    : emptyWeek();
}
async function saveWeek(patch) {
  state.weekState = { ...state.weekState, ...patch };
  render();
  await sb.from("week_state").upsert(
    { household_id: HID, week_key: weekKey(), ...state.weekState, updated_at: new Date().toISOString() },
    { onConflict: "household_id,week_key" },
  );
}
function subscribeRealtime() {
  sb.channel("choresync")
    .on("postgres_changes", { event: "*", schema: "public", table: "household", filter: `id=eq.${HID}` },
      (p) => { state.household = p.new; render(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "week_state", filter: `household_id=eq.${HID}` },
      (p) => { if (p.new?.week_key === weekKey()) { state.weekState = { done: p.new.done || {}, bins_out: p.new.bins_out || [], bins_in: p.new.bins_in || [] }; render(); } })
    .subscribe();
}

// --- Actions ----------------------------------------------------------------
function toggleDone(bId, idx) {
  const key = `${bId}:${idx}`;
  const done = { ...state.weekState.done };
  if (done[key]) delete done[key]; else done[key] = true;
  saveWeek({ done });
}
function toggleVolunteer(kind) {
  if (!state.me) { alert("Pick who you are (top right) first."); return; }
  const arr = [...(state.weekState[kind] || [])];
  const i = arr.indexOf(state.me);
  if (i >= 0) arr.splice(i, 1); else arr.push(state.me);
  saveWeek({ [kind]: arr });
}
async function saveSettings(form) {
  const patch = {
    name: form.name.value.trim() || "Our House",
    members: [form.m0.value.trim(), form.m1.value.trim(), form.m2.value.trim()],
    timezone: form.tz.value.trim() || "UTC",
    anchor_monday: form.anchor.value,
    reminder_day: +form.rday.value, reminder_time: form.rtime.value,
    bins_out_day: +form.boday.value, bins_out_time: form.botime.value,
    bins_in_day: +form.biday.value, bins_in_time: form.bitime.value,
    pin: form.pin.value.trim(),
    updated_at: new Date().toISOString(),
  };
  await sb.from("household").update(patch).eq("id", HID);
  state.household = { ...state.household, ...patch };
  if (patch.pin) localStorage.setItem("choresync_pin", patch.pin); else localStorage.removeItem("choresync_pin");
  const msg = document.getElementById("saved");
  if (msg) { msg.textContent = "Saved ✓"; setTimeout(() => (msg.textContent = ""), 2000); }
  render();
}

// --- Web push ---------------------------------------------------------------
function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enableNotifications() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      alert("This browser can't do push notifications. On iPhone, add the app to your Home Screen first, then try again.");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { alert("Notifications not allowed."); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(CFG.VAPID_PUBLIC_KEY),
    });
    const json = sub.toJSON();
    await sb.from("push_subscriptions").upsert({
      endpoint: json.endpoint, household_id: HID, person: state.me,
      subscription: json,
    }, { onConflict: "endpoint" });
    alert("Reminders on for this device ✓");
  } catch (e) {
    alert("Couldn't enable notifications: " + (e?.message || e));
  }
}

// --- Rendering --------------------------------------------------------------
const view = document.getElementById("view");

function renderTopbar() {
  document.getElementById("houseName").textContent = state.household?.name || "ChoreSync";
  const sel = document.getElementById("meSelect");
  const members = state.household?.members || [];
  sel.innerHTML = members.map((m) => `<option${m === state.me ? " selected" : ""}>${esc(m)}</option>`).join("");
  sel.onchange = () => { state.me = sel.value; localStorage.setItem("choresync_me", state.me); render(); };
}

function renderWeek() {
  const h = state.household;
  const wi = weekIndexOf(state.viewMonday, h.anchor_monday);
  const isThis = ymd(state.viewMonday) === ymd(mondayOf(new Date()));
  const assign = assignmentsFor(wi, h.members);
  const ws = state.weekState;

  const nav = `<div class="weeknav">
    <button id="prevW">‹</button>
    <div style="text-align:center"><div class="label">${isThis ? "This week" : "Week of"}</div>
      <div class="sub">${prettyRange(state.viewMonday)}</div></div>
    <button id="nextW">›</button></div>`;

  const cards = assign.map((a) => {
    const mine = a.name === state.me;
    const items = a.bundle.items.map((it, idx) => {
      const key = `${a.bundle.id}:${idx}`;
      const done = !!ws.done[key];
      return `<label class="check ${done ? "done" : ""}">
        <input type="checkbox" data-b="${a.bundle.id}" data-i="${idx}" ${done ? "checked" : ""}>
        <span class="txt">${esc(it.n)}</span><span class="m">${it.m}m</span></label>`;
    }).join("");
    return `<div class="card">
      <div class="person">
        <span class="badge ${a.bundle.id}">${a.bundle.id}</span>
        <span><span class="name">${esc(a.name)}</span>${mine ? '<span class="mine">you</span>' : ""}
          <div class="bundle">${esc(a.bundle.title)}</div></span>
        <span class="mins">${bundleMins(a.bundle)} min</span>
      </div>${items}</div>`;
  }).join("");

  view.innerHTML = nav + cards;
  document.getElementById("prevW").onclick = () => shiftWeek(-7);
  document.getElementById("nextW").onclick = () => shiftWeek(7);
  view.querySelectorAll('input[type=checkbox]').forEach((c) =>
    c.addEventListener("change", () => toggleDone(c.dataset.b, +c.dataset.i)));
}

async function shiftWeek(days) {
  const d = new Date(state.viewMonday); d.setDate(d.getDate() + days);
  state.viewMonday = mondayOf(d);
  await loadWeek(); render();
}

function volRow(kind) {
  const chosen = state.weekState[kind] || [];
  return (state.household.members || []).map((m) =>
    `<button class="vol-btn ${chosen.includes(m) ? "on" : ""}" data-kind="${kind}" data-m="${esc(m)}">${esc(m)}${chosen.includes(m) ? " ✓" : ""}</button>`
  ).join("");
}
function renderBins() {
  const h = state.household;
  view.innerHTML = `
    <div class="card">
      <h2>Take bins out — ${DAYS[h.bins_out_day]} ${h.bins_out_time}</h2>
      <div class="vol">${volRow("bins_out")}</div>
      <div class="hint">Tap your name to volunteer. One or more people can help.</div>
    </div>
    <div class="card">
      <h2>Bring bins in — ${DAYS[h.bins_in_day]} ${h.bins_in_time}</h2>
      <div class="vol">${volRow("bins_in")}</div>
      <div class="hint">Same idea — tap to claim it.</div>
    </div>`;
  view.querySelectorAll(".vol-btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.m !== state.me) { state.me = b.dataset.m; localStorage.setItem("choresync_me", state.me); renderTopbar(); }
      toggleVolunteer(b.dataset.kind);
    }));
}

function daySelect(id, val) {
  return `<select name="${id}">${DAYS.map((d, i) => `<option value="${i}"${i === val ? " selected" : ""}>${d}</option>`).join("")}</select>`;
}
function renderSettings() {
  const h = state.household;
  const m = h.members || [];
  view.innerHTML = `<form id="settings">
    <div class="card">
      <h2>House</h2>
      <div class="field"><label>House name</label><input type="text" name="name" value="${esc(h.name)}"></div>
      <div class="field"><label>Person 1</label><input type="text" name="m0" value="${esc(m[0] || "")}"></div>
      <div class="field"><label>Person 2</label><input type="text" name="m1" value="${esc(m[1] || "")}"></div>
      <div class="field"><label>Person 3</label><input type="text" name="m2" value="${esc(m[2] || "")}"></div>
      <div class="field"><label>Shared PIN (leave blank for none)</label><input type="text" inputmode="numeric" name="pin" value="${esc(h.pin || "")}"></div>
    </div>
    <div class="card">
      <h2>Rotation</h2>
      <div class="field"><label>Week 1 starts (a Monday)</label><input type="date" name="anchor" value="${h.anchor_monday}"></div>
      <div class="field"><label>Timezone (e.g. Europe/London)</label><input type="text" name="tz" value="${esc(h.timezone)}"></div>
    </div>
    <div class="card">
      <h2>Reminder days &amp; times</h2>
      <div class="field"><label>Chores</label><div class="row2">${daySelect("rday", h.reminder_day)}<input type="time" name="rtime" value="${h.reminder_time}"></div></div>
      <div class="field"><label>Bins out</label><div class="row2">${daySelect("boday", h.bins_out_day)}<input type="time" name="botime" value="${h.bins_out_time}"></div></div>
      <div class="field"><label>Bins in</label><div class="row2">${daySelect("biday", h.bins_in_day)}<input type="time" name="bitime" value="${h.bins_in_time}"></div></div>
    </div>
    <button type="submit" class="btn">Save settings</button>
    <button type="button" id="notifyBtn" class="btn secondary">Turn on reminders for this device</button>
    <div id="saved" class="saved"></div>
  </form>`;
  const form = document.getElementById("settings");
  form.addEventListener("submit", (e) => { e.preventDefault(); saveSettings(form); });
  document.getElementById("notifyBtn").addEventListener("click", enableNotifications);
}


// --- PIN gate (soft) --------------------------------------------------------
function pinPasses() {
  const pin = state.household?.pin;
  if (!pin) return true;                       // no PIN set -> open
  return localStorage.getItem("choresync_pin") === pin;
}
function renderPinGate() {
  renderTopbar();
  view.innerHTML = `<form id="pinForm">
    <div class="card">
      <h2>Enter house PIN</h2>
      <div class="field"><label>Ask a housemate for the shared PIN</label>
        <input type="text" inputmode="numeric" name="pin" autocomplete="off" placeholder="PIN"></div>
      <button type="submit" class="btn">Unlock</button>
      <div id="pinErr" class="saved" style="color:#fca5a5"></div>
    </div></form>`;
  document.getElementById("pinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const val = e.target.pin.value.trim();
    if (val === state.household.pin) {
      localStorage.setItem("choresync_pin", val);
      afterUnlock();
    } else {
      document.getElementById("pinErr").textContent = "Wrong PIN";
    }
  });
}
async function afterUnlock() {
  state.pinOk = true;
  await loadWeek();
  subscribeRealtime();
  render();
}

function render() {
  if (!configured) {
    view.innerHTML = `<div class="notice">Not configured yet. Open <b>public/config.js</b> and fill in your Supabase URL, anon key, household id and VAPID public key. See the README.</div>`;
    return;
  }
  if (!state.household) { view.innerHTML = `<div class="loading">Loading…</div>`; return; }
  renderTopbar();
  if (state.tab === "week") renderWeek();
  else if (state.tab === "bins") renderBins();
  else renderSettings();
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
}

function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// --- Boot -------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => { state.tab = t.dataset.tab; render(); }));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

(async () => {
  if (!configured) { render(); return; }
  await loadHousehold();
  if (!pinPasses()) { renderPinGate(); return; }
  await afterUnlock();
})();
