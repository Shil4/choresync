// ChoreSync — scheduled reminder sender (Supabase Edge Function, Deno)
// Called every 5 minutes by pg_cron. Figures out, per household and in the
// household's own timezone, whether a chore/bins reminder is due right now and
// (once per day per kind) pushes a web notification to every subscribed device.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// --- Chore bundles (kept in sync with the front-end) ------------------------
const BUNDLES = [
  { id: "A", title: "Hoover + kitchen surfaces" },
  { id: "B", title: "Living room + corridor + kitchen scrub" },
  { id: "C", title: "Floors & wet" },
];

// person i (0-based) does bundle (i + weekIndex) mod 3
function assignmentsFor(weekIndex: number, members: string[]) {
  return members.map((name, i) => ({
    name,
    bundle: BUNDLES[(((i + weekIndex) % 3) + 3) % 3],
  }));
}

// Local date/time parts for a timezone.
function localParts(tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const y = +get("year"), m = +get("month"), d = +get("day");
  const hour = +get("hour"), minute = +get("minute");
  return {
    dow: wdMap[get("weekday")],
    minutes: hour * 60 + minute,
    dateStr: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    y, m, d,
  };
}

// Monday (YYYY-MM-DD) of the week containing y-m-d, plus the week index.
function weekInfo(y: number, m: number, d: number, anchorMonday: string) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0 Sun..6 Sat
  const backToMon = (dow + 6) % 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - backToMon);
  const anchor = new Date(anchorMonday + "T00:00:00Z");
  const weekIndex = Math.floor((monday.getTime() - anchor.getTime()) / (7 * 864e5));
  const key = monday.toISOString().slice(0, 10);
  return { weekKey: key, weekIndex };
}

function toMinutes(hhmm: string) {
  const [h, mm] = hhmm.split(":").map(Number);
  return h * 60 + mm;
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  webpush.setVapidDetails(
    "mailto:" + (Deno.env.get("VAPID_SUBJECT") ?? "chores@example.com"),
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  const { data: households } = await supabase.from("household").select("*");
  let sentCount = 0;

  for (const h of households ?? []) {
    const tz = h.timezone || "UTC";
    const now = localParts(tz);
    const members: string[] = h.members ?? [];

    const kinds = [
      { kind: "chore",    day: h.reminder_day, time: h.reminder_time },
      { kind: "bins_out", day: h.bins_out_day, time: h.bins_out_time },
      { kind: "bins_in",  day: h.bins_in_day,  time: h.bins_in_time },
    ];

    for (const k of kinds) {
      // Due if today matches the configured weekday and its time has arrived.
      if (now.dow !== k.day) continue;
      if (now.minutes < toMinutes(k.time)) continue;

      // Only once per day per kind.
      const { error: dupeErr } = await supabase
        .from("reminders_sent")
        .insert({ household_id: h.id, sent_date: now.dateStr, kind: k.kind });
      if (dupeErr) continue; // already sent today (primary-key clash) -> skip

      // Build the message.
      let title = "🧹 " + (h.name || "Chores");
      let body = "";
      if (k.kind === "chore") {
        const { weekIndex } = weekInfo(now.y, now.m, now.d, h.anchor_monday);
        const a = assignmentsFor(weekIndex, members);
        title = "🧹 Chore day";
        body = a.map((x) => `${x.name}: ${x.bundle.title}`).join("\n");
      } else if (k.kind === "bins_out") {
        title = "🗑️ Bins out tonight";
        body = "Open the app to volunteer to take the bins out.";
      } else {
        title = "🗑️ Bring the bins back in";
        body = "Open the app to volunteer to bring the bins in.";
      }

      // Push to every device.
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("*")
        .eq("household_id", h.id);

      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification(
            s.subscription,
            JSON.stringify({ title, body }),
          );
          sentCount++;
        } catch (e) {
          // 404/410 => subscription is dead, clean it up.
          const code = (e as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent: sentCount }), {
    headers: { "Content-Type": "application/json" },
  });
});
