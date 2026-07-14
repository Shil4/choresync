# ChoreSync

A tiny installable web app (PWA) for a 3-person house: shows whose turn it is
each week, lets people volunteer for bins, and sends reminder notifications on
days/times you choose. Everything runs on **Supabase** — no separate service,
and it's free.

## How it works (the short version)
- The **rotation is deterministic** — it's just a function of which week it is —
  so every phone can show the same assignments without anyone maintaining a list.
- **Shared state** (bin volunteers, done ✓ ticks, settings) lives in Supabase and
  syncs live between phones.
- **Reminders** are sent by a scheduled Supabase job (pg_cron → Edge Function →
  web push) at your custom days/times. Nothing runs on your computer.

The chore split (≈31 min each):
- **A — Hoover + kitchen surfaces:** hoover carpet, kitchen countertop, microwave
- **B — Living room + corridor + kitchen scrub:** LR sweep, LR trash, corridor, kitchen sink, kitchen hob
- **C — Floors & wet:** washroom sweep/mop/sink, kitchen sweep/mop

Over any 3 weeks each person does A, B and C once, so it's even long-term.

---

## Setup (about 30–40 min, one time)

You'll need free accounts at **supabase.com** and a static host (**netlify.com**
is the easiest), plus **Node.js** installed (nodejs.org) for two small commands.

### 1. Create the Supabase project + tables
1. Create a new project at supabase.com (free tier).
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, click **Run**.
3. The last line prints a **household_id** — copy it, you'll need it in step 5.

### 2. Generate your notification keys (VAPID)
In a terminal:
```
npx web-push generate-vapid-keys
```
It prints a **Public Key** and a **Private Key**. Keep both handy.

### 3. Deploy the reminder function
Install the Supabase CLI and deploy (still in a terminal, from this folder):
```
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy send-reminders --no-verify-jwt
npx supabase secrets set VAPID_PUBLIC_KEY=xxxx VAPID_PRIVATE_KEY=yyyy VAPID_SUBJECT=mailto:you@email.com
```
(`YOUR_PROJECT_REF` is the bit in your Supabase URL: `https://<ref>.supabase.co`.)

### 4. Schedule it
1. Open `supabase/schedule.sql`, replace `<PROJECT_REF>` and `<SERVICE_ROLE_KEY>`
   (Dashboard → Project Settings → API → **service_role** key).
2. Paste into **SQL Editor** and **Run**. It now checks every 5 minutes whether a
   reminder is due.

### 5. Fill in the app config
Open `public/config.js` and set:
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Dashboard → Project Settings → API → the **anon public** key)
- `HOUSEHOLD_ID` (from step 1)
- `VAPID_PUBLIC_KEY` (the **public** key from step 2)

### 6. Put the app online (needs HTTPS — required for install + notifications)
**GitHub Pages (recommended):**
1. Rename the `public` folder to **`docs`** (GitHub Pages can serve from `/docs`).
2. Create a new GitHub repo and push these files to it.
3. Repo → **Settings → Pages** → *Source:* **Deploy from a branch** →
   *Branch:* `main`, *Folder:* **`/docs`** → **Save**.
4. After ~1 minute your app is live at `https://USERNAME.github.io/REPO/`.

The app uses relative paths, so serving from that `/REPO/` sub-path just works —
no changes needed. To update later, edit files and `git push`.

*(Prefer zero setup? app.netlify.com/drop lets you drag the folder instead — but
you said GitHub, and it's the better long-term choice.)*

### 7. Install on each phone
Open the URL on each person's phone:
- **Android (Chrome):** menu → **Add to Home screen / Install app**.
- **iPhone (Safari):** Share → **Add to Home Screen**. *(Required — iOS only allows
  notifications for the home-screen version.)*
Open it from the new icon, pick **who you are** (top right), go to **Settings →
Turn on reminders for this device**, and allow notifications.

Set a **shared PIN** in Settings if you want (leave blank for none) — anyone
opening the app then enters it once per device.

That's it. Change names, days and times in **Settings**; everyone syncs.

---

## Notes & troubleshooting
- **iPhone reminders** only work after "Add to Home Screen" (iOS rule) and are a
  bit stricter than Android — if one doesn't arrive, reopen the app once.
- **Test a reminder now:** in Settings set the chore reminder to today and a time
  a couple of minutes ahead; wait for the 5-minute cron tick.
- **Change the split/times:** chore bundles live in `public/app.js` and the Edge
  Function (`BUNDLES`); days/times are all editable in the app's Settings.
- **Shared PIN:** set one in Settings to keep casual visitors out. It's a soft
  gate (fine for a private 3-person list), not bank-grade security — a determined
  technical user could bypass it. If you ever want real per-person logins, say the
  word and I'll switch it to Supabase Auth (magic-link email sign-in).
