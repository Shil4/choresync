// ChoreSync — scheduled reminder sender (Supabase Edge Function, Deno)
// Runs every 5 min via pg_cron. Sends chore / bins / overdue-nudge pushes at the
// household's configured days+times, in the household's own timezone.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// --- Chore bundles (mirrored from the front-end) ----------------------------
const SWITCH_FROM = "2026-07-20";   // first Monday the new zones apply

const OLD_BUNDLES = [
  { id: "A", title: "Hoover + kitchen surfaces", items: [
    { n: "Hoover carpet (connecting areas)", m: 20 }, { n: "Kitchen — countertop", m: 5 },
    { n: "Kitchen — microwave", m: 5 } ] },
  { id: "B", title: "Living room + corridor + kitchen scrub", items: [
    { n: "Living room — sweep", m: 8 }, { n: "Living room — trash", m: 4 },
    { n: "Corridor (landing + LR entrance)", m: 5 }, { n: "Kitchen — sink", m: 6 },
    { n: "Kitchen — hob", m: 8 } ] },
  { id: "C", title: "Floors & wet", items: [
    { n: "Washroom — sweep", m: 5 }, { n: "Washroom — mop", m: 8 }, { n: "Washroom — sink", m: 5 },
    { n: "Kitchen — sweep", m: 6 }, { n: "Kitchen — mop", m: 8 } ] },
];
const NEW_BUNDLES = [
  { id: "A", title: "Hoover & living areas", items: [
    { n: "Hoover carpet (connecting areas)", m: 20 }, { n: "Living room — sweep", m: 8 },
    { n: "Living room — trash", m: 4 }, { n: "Corridor (landing + LR entrance)", m: 5 } ] },
  { id: "B", title: "Upstairs washroom", items: [
    { n: "Washroom — sweep", m: 5 }, { n: "Washroom — mop", m: 8 }, { n: "Washroom — sink", m: 5 },
    { n: "Bath / shower tub + wall tiles", m: 13 }, { n: "Toilet", m: 6 } ] },
  { id: "C", title: "Kitchen", items: [
    { n: "Kitchen — sink", m: 6 }, { n: "Kitchen — hob", m: 8 }, { n: "Kitchen — countertop", m: 5 },
    { n: "Kitchen — microwave", m: 5 }, { n: "Kitchen — sweep", m: 6 }, { n: "Kitchen — mop", m: 8 } ] },
];
const bundlesFor = (mondayKey: string) => (mondayKey >= SWITCH_FROM ? NEW_BUNDLES : OLD_BUNDLES);
const mod = (n: number, m: number) => (((n % m) + m) % m);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function assignmentsFor(weekIndex: number, members: string[], mondayKey: string) {
  const B = bundlesFor(mondayKey);
  return members.map((name, i) => ({ name, bundle: B[mod(i + weekIndex, 3)] }));
}
function localParts(tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit",
    minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const y = +get("year"), m = +get("month"), d = +get("day");
  return { dow: wd[get("weekday")], minutes: +get("hour") * 60 + +get("minute"),
    dateStr: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, y, m, d };
}
function weekInfo(y: number, m: number, d: number, anchorMonday: string) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const anchor = new Date(anchorMonday + "T00:00:00Z");
  const prev = new Date(monday); prev.setUTCDate(monday.getUTCDate() - 7);
  return { weekKey: monday.toISOString().slice(0, 10), prevKey: prev.toISOString().slice(0, 10),
    weekIndex: Math.round((monday.getTime() - anchor.getTime()) / (7 * 864e5)) };
}
const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  webpush.setVapidDetails("mailto:" + (Deno.env.get("VAPID_SUBJECT") ?? "chores@example.com"),
    Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

  const { data: households } = await supabase.from("household").select("*");
  let sentCount = 0;

  // Send to all devices, or only those belonging to `people`.
  async function pushTo(hid: string, title: string, body: string, people: string[] | null) {
    const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("household_id", hid);
    const targets = (subs ?? []).filter((s) => !people || people.includes(s.person));
    let sent = 0;
    for (const s of targets) {
      try { await webpush.sendNotification(s.subscription, JSON.stringify({ title, body })); sent++; }
      catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }
    return { sent, total: targets.length };
  }

  for (const h of households ?? []) {
    const now = localParts(h.timezone || "UTC");
    const members: string[] = h.members ?? [];
    const { weekKey, prevKey, weekIndex } = weekInfo(now.y, now.m, now.d, h.anchor_monday);

    const kinds = [
      { kind: "chore",    day: h.reminder_day, time: h.reminder_time },
      { kind: "bins_out", day: h.bins_out_day, time: h.bins_out_time },
      { kind: "bins_in",  day: h.bins_in_day,  time: h.bins_in_time },
      { kind: "nudge",    day: h.nudge_day ?? 1, time: h.nudge_time ?? "18:00" },
    ];

    for (const k of kinds) {
      if (now.dow !== k.day || now.minutes < toMinutes(k.time)) continue;

      // Dedupe includes the scheduled time, so moving a reminder later the same
      // day counts as a new slot and fires again.
      const { data: already } = await supabase.from("reminders_sent").select("kind")
        .eq("household_id", h.id).eq("sent_date", now.dateStr).eq("kind", k.kind)
        .eq("slot", k.time).maybeSingle();
      if (already) continue;

      const record = () => supabase.from("reminders_sent")
        .insert({ household_id: h.id, sent_date: now.dateStr, kind: k.kind, slot: k.time });

      let res = { sent: 0, total: 0 };

      if (k.kind === "nudge") {
        // Only ping people who actually have unfinished chores carried over.
        const { data: rows } = await supabase.from("week_state").select("week_key,done")
          .eq("household_id", h.id).in("week_key", [weekKey, prevKey]);
        const cur = rows?.find((r) => r.week_key === weekKey)?.done ?? {};
        const prev = rows?.find((r) => r.week_key === prevKey)?.done ?? null;
        if (!prev) { await record(); continue; }
        const prevB = bundlesFor(prevKey);
        for (let p = 0; p < members.length; p++) {
          const b = prevB[mod(p + weekIndex - 1, 3)];
          const open = b.items.filter((_, i) => !prev[`${b.id}:${i}`] && !cur[`co:${b.id}:${i}`]);
          if (!open.length) continue;
          const r = await pushTo(h.id, "⏰ Overdue chores",
            `You have ${open.length} chore${open.length === 1 ? "" : "s"} carried over from last week — ` +
            `clear ${open.length === 1 ? "it" : "them"} by ${DAYS[h.catchup_day ?? 3]} to keep your record clean.`,
            [members[p]]);
          res.sent += r.sent; res.total += r.total;
        }
      } else {
        let title = "🧹 " + (h.name || "Chores"), body = "";
        if (k.kind === "chore") {
          title = "🧹 Chore day";
          body = assignmentsFor(weekIndex, members, weekKey)
            .map((x) => `${x.name}: ${x.bundle.title}`).join("\n");
        } else if (k.kind === "bins_out") {
          title = "🗑️ Bins out tonight"; body = "Open the app to volunteer to take the bins out.";
        } else {
          title = "🗑️ Bring the bins back in"; body = "Open the app to volunteer to bring the bins in.";
        }
        res = await pushTo(h.id, title, body, null);
      }

      // Only mark as sent if a push actually got through (or there was nobody to
      // send to) — a failed send should retry on the next tick, not go silent.
      if (res.sent > 0 || res.total === 0) await record();
      sentCount += res.sent;
    }
  }

  return new Response(JSON.stringify({ ok: true, sent: sentCount }),
    { headers: { "Content-Type": "application/json" } });
});