# Mishkat

**A companion for carrying the Qur'an — Sabaq · Sabqi · Manzil.**

A single-page web app that turns the classical madrasa timetable into a plan anyone can actually keep: new memorisation (*sabaq*), the fragile last seven days (*sabqi*), and the long memory of everything you already carry (*manzil*), scheduled against a real calendar.

**Every visitor builds their own plan.** On first open the app asks your name, your language (English or Arabic, full RTL), *what you are memorising* — the whole Qur'an, one or more juz, one or more surahs, or an exact set of pages — how much time you can give each day, and which pages you already carry. It then generates the day-by-day calendar from exactly that, and tells you honestly when you will finish.

**The plan bends.** Miss a few days and the app notices, then offers four honest ways forward: re-plan from today (what you have recited counts as carried), pause and shift the calendar, add the minutes needed to keep your original date, or open the planner again. Nothing you memorised is ever thrown away.

---

## What's inside

| | |
|---|---|
| **Today** | The three layers for today, with minute splits and tick-off tasks |
| **Learn** | The actual mushaf page (Uthmani, Amiri Quran), with *Blur* and *Blind* recitation modes for active recall |
| **Drill** | Four-step guided drill per chunk, takrar counter, 4-grade self-assessment that schedules the next review |
| **Review** | Sabaq / Sabqi / Manzil tick lists, weak-page repair queue, session log, streak |
| **Journey** | 604-page mushaf map, month-by-month calendars, Ramadan windows, data export/import |
| **Plan** | The arithmetic behind the schedule, phases, next 14 days |
| **Catch up** | Appears only when days were missed — four ways to make the calendar honest again |
| **People** | Everyone using this device: separate records, switching, per-person files, automatic snapshots |
| **Method** | The research (retrieval practice, spacing, desirable difficulty, sleep, meaning) mapped onto the tradition |

Three visual worlds, switchable from the top bar:

- **Nature** — dawn ridges, cedar light, night sea. Rotates every 3 minutes; the palette follows the scene. Press ❚❚ to hold one.
- **Geometry** — gold mashrabiya tilework on deep teal.
- **Nur** — a single lamp in a dark arch.

## How the plan is generated

For each person, given a *goal* (whole mushaf / juz / surahs / pages), *budget* (minutes/day), *solid pages*, *shaky pages* and a *start page*:

1. The queue is built from your goal: either every page you did **not** mark, starting from your chosen page and wrapping round the mushaf — or only the unmarked pages inside the juz, surahs or page range you picked.
2. Pages you marked **shaky** are soldered first — four a day — in a single reset week with no new material.
3. Weekly new material scales with your budget (4 → 7 pages a week at 45 min) and **steps down** once the harder half begins.
4. Fridays carry no new material. Every thirteenth week is consolidation. Ramadan raises sabaq.
5. Your **manzil** — everything you carry — is recited on a cycle; the app tells you how many days that cycle takes.

Because a bigger manzil means more revision, the honest output is a *date*, not a promise: the Plan page shows what 45, 60, 75 and 90 minutes would each buy you.

## On a phone

The whole app is built for one hand: a two-row top bar (brand + language on top, a swipeable tab strip below), thumb-sized buttons, a 2×2 stat grid, the page picker on a 34-px grid, and an onboarding footer that never covers the question. Every view was checked at 390, 412 and 744 px wide in both languages — no horizontal scrolling anywhere.

## When the plan slips

The calendar is never silently rewritten. On each load the app compares the original start date with what is actually logged:

- Days with nothing logged are counted, and the same count is used every time (it is idempotent — the schedule never creeps).
- If any exist, a gold strip appears on Today and a **⚑ Catch up** tab appears in the bar. Opening it offers:
  - **I'm behind — re-plan from today.** Pages you have recited become carried, pages you graded weak become soldering work, and the queue restarts from where you actually are.
  - **I had a break — pause, don't rewrite.** Keep everything; the calendar simply moves forward by the days you missed.
  - **Keep my <date> date ↦ N min/day.** The engine searches for the smallest honest budget that still lands on the date you were promised.
  - **Change my goal or my time.** Back to the planner.
- Any day can be restored with "I studied" if you did the work and forgot to record it.

## Interface

- **Two languages**, fully written (not machine-translated): English and Arabic with full RTL typography — the Arabic display face, `bdi` isolation for names and numbers, and mirrored layout.
- **Three visual worlds**: Nature (dawn ridges, cedar light, night sea — changing on their own every three minutes, with the palette following the scene), Geometry (gold mashrabiya tilework), and Nur (a single lamp in a dark arch).

## Running it locally

It is one file with no build step and no dependencies. `mishkat.html` is the whole app.

```bash
# simplest
open mishkat.html             # or: xdg-open / start

# or serve it (needed for the offline service worker)
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying to GitHub Pages

1. Create a repo, e.g. `mishkat`.
2. Copy everything from `site/` into the repo root (that is `index.html`, `sw.js`, `manifest.webmanifest`, `assets/`, `README.md`).
3. Push:

```bash
git init
git add .
git commit -m "Mishkat"
git branch -M main
git remote add origin https://github.com/<you>/mishkat.git
git push -u origin main
```

4. Repo → **Settings → Pages → Source: Deploy from a branch → Branch: `main` / root → Save**.
5. Your site appears at `https://<you>.github.io/mishkat/` — installable as an app from Chrome or Safari ("Add to Home Screen"), and it works offline after the first load (the service worker in `sw.js` caches everything the app needs; recitation audio still needs a connection).

> **When you replace `index.html` later,** bump the cache name in `sw.js` (`mishkat-v1` → `mishkat-v2`). Browsers keep serving the old cached copy until the service worker changes.

### Choosing a goal (juz · surahs · pages, in any mix)

Onboarding step 2 is one screen with everything: **all 30 juz**, **all 114 surahs**
in mushaf order (numbered), and a grid of all 604 loose pages. Picks accumulate
across all three — Juz 29 plus Al-Kahf plus page 100 is one legitimate goal — and
the "Your goal so far" box shows the result as removable chips.

Narrowing down:

- **▸** beside a juz or a surah opens its pages, so a single page can be dropped from
  a juz, or a short surah left out of a juz;
- **▸ All pages** opens every group at once (and closes them again);
- **✕** on a chip removes that whole part without touching the rest.

What is stored is a plain page list: `profile.scope = { mode, pages }` where `mode`
is only a label (`juz` / `surah` / `pages` / `all`). The planner has always worked
from the page set, so a mixed goal needs no engine change. Empty selection means
the whole mushaf.

One honest limit: a few short surahs share a page (Al-Ikhlaas, Al-Falaq, An-Naas all
end on 604). Pages, not verses, are the unit — so picking An-Naas picks page 604,
which is why picking two or three of them reads as "1 page". The picker labels those
surahs with their page number rather than pretending otherwise.

### Phone install vs app stores

**Home screen is the intended path.** `manifest.webmanifest` + `sw.js` already make
this a proper PWA: standalone window, own icon, offline. On Android Chrome the app
shows a real `beforeinstallprompt` button; on iOS the Safari Share-sheet steps are
spelled out. It appears **twice on purpose**: once as *"Last step"* on Today right
after onboarding finishes, and permanently in **People → Put it on your home screen**.
"Not now" only dismisses the first one (key `mishkat.install.welcome`); the People card
stays until installed (`mishkat.install.done`). Share **[HOME-SCREEN.md](HOME-SCREEN.md)** with whoever installs it.

**Stores, if you ever want them:** a website cannot be uploaded to either store.
It has to be wrapped in a native shell.

| | Google Play | App Store |
|---|---|---|
| Account | $25 once | $99 / year |
| Build | PWABuilder / Bubblewrap → AAB, or Capacitor | Capacitor + **Mac with Xcode** |
| Extra gate | new personal accounts need a closed test with **12 testers for 14 days** | review, plus a privacy policy |
| Realistic time | 3–5 weeks | 1–2 weeks + a Mac |

Both stores also require a privacy policy — easy here (`PROGRESS.md`-style honesty:
no analytics, no accounts unless you enable cloud backup). Nothing else changes: the
same `index.html` runs inside the shell, so a store build is a packaging job, not a
port. Do it only if the home-screen route actually fails you.

### Owner access (for you, not for students)

Your own plan lives in its own record on the device, behind a code
(`OWNER_CODE` at the top of `app/app.js`, default `mishkat-314` — change it before
you hand the app to anyone). Three ways in:

1. **People → Owner access** (bottom of the safety card),
2. **tap the logo mark seven times** within three seconds,
3. open the site with **`#mishkat`** on the end of the URL.

Unlocking never overwrites a student's record and never creates a second copy of
yours. **"Switch to a student"** leaves owner mode but *keeps* your record on the
device; coming back later finds it again. Since the code is visible in the source
of a public page, treat it as a lock against children, not against an attacker.

### Cloud backup (optional)

People → **Cloud backup** takes a Project URL and an anon key from your own free
Supabase project, then signs you in with a six-digit email code. From then on every
change uploads in the background a few seconds later, and a new device gets the record
by signing in. Offline it simply queues. Setup instructions, the SQL, and a
troubleshooting table: **[CLOUD-SETUP.md](CLOUD-SETUP.md)**.

### More than one person, one browser

Storage is keyed per person, not per app:

```
mishkat.v2/index      → who exists, who was last active
mishkat.v2/p:<id>     → that person's whole record (profile, anchor, log, page grades, streak)
mishkat.v2/auto:<id>  → an automatic daily snapshot, kept beside the live record
mishkat.meta          → timestamps only (last snapshot, last export)
```

So a phone shared by two people keeps two complete, separate plans. **People** in the top bar lists them, lets you switch, add, export or delete one — deleting never touches the others, and opening the app tomorrow returns you to whoever used it last. The owner code creates and signs into its own record, so unlocking it never overwrites a friend's progress.

The daily snapshot makes the "keep a copy" warning a safety net rather than homework: **People → Restore today's snapshot** rebuilds from it if anything looks wrong. File export and the sync code still exist for moving between devices.

### About "my own website that stores my data"

You get the website, and it is yours — but be clear about where the data lives:

- Your profile keeps two things apart: what you *declared* (goal, pages you carry, pace) and the *anchor* the calendar is currently built from. Editing your plan never overwrites your history.
- Progress is stored in your browser's **localStorage**, on your device only, one record per person. No accounts, no server, no upload. That is a feature for privacy and a risk for durability.
- Close the tab tonight, open it tomorrow on the same phone or laptop: the day, the streak and the page strengths are all there. Nothing to log into, nothing to remember.
- It does **not** follow you to a different browser, a different device, a private window, or a cleared browser. For that there are two escape hatches, both on the Journey page: **Export my data** (a small JSON file) and a **Sync code** (one long string you can paste into the same screen on another device). Do one of them after a good week; keep it in Drive.
- **Cloud backup is built in and optional.** Mishkat talks to a free Supabase project you own — no SDK, no server, plain `fetch`, with row-level security so only your account can read your row. Step-by-step setup: **[CLOUD-SETUP.md](CLOUD-SETUP.md)**. Until you connect one, the app behaves exactly as before (local only, works offline).

## Data sources

- **Qur'an text:** [Tanzil](https://tanzil.net) Uthmani, Madani page division (604 pages)
- **Translation:** Sahih International
- **Recitations:** [everyayah.com](https://everyayah.com) — Husary, Minshawi, Abdul Basit, Alafasy, Maher, Sudais, Shatri, Hudhaify
- **Fonts:** Amiri Quran, Amiri, Scheherazade New (SIL Open Font License)

Recitation audio is streamed per ayah and needs a connection. Everything else — text, plan, artwork, fonts — is embedded in the file.

## A note on the AI recitation check

The practice room uses the browser's built-in speech recognition (`ar-SA`) to compare what you recited against the page: it strips diacritics, normalises the letters, and reports a word-match percentage. It hears *which words* you said. It cannot hear tajweed — no consumer app can. That is why the plan insists on a human teacher once a week: face to face, reciting back, which is how the Qur'an has been transmitted from the beginning.

## Owner access

There is a private door for the person who commissioned this build, so he can look at his own plan without filling in the onboarding every time.

- Open the app and **tap the logo seven times** within three seconds, or load the page with **`#mishkat`** on the end of the address.
- A small box asks for the code. The code lives in one place — `OWNER_CODE` near the top of `app/app.js` (and in the built `index.html`). Change it before you publish.
- Entering it loads the fixed owner plan and marks that browser as the owner. The Journey page then shows an *Owner mode* card with a **Switch to a student profile** button, which drops the owner profile and returns to onboarding.
- Ordinary visitors never see any of this: there is no link, no menu item, no visible button.

## Sharing it

Because progress is stored per browser, sending someone the link gives them a fresh start and their own plan — nothing of yours travels with it. That is the point: they build their own.

## Credits

Built as a companion, not a replacement, for a real teacher and a real mushaf.

> *"The one who is a master of the Qur'an is with the noble, righteous scribes, and the one who recites it while struggling, stuttering through it, has two rewards."* — Bukhari

---

*Qur'an text and translation are the word of Allah and the work of translators; the schedule, code and design are yours to change.*
