# Cloud backup — setup guide (one time, ~10 minutes)

Everything here is free. Supabase does not ask for a card, and the free tier is far
more than this app will ever use (one small row per person).

You will end up with two values pasted into Mishkat:

- a **Project URL**, like `https://abcdefghijk.supabase.co`
- an **anon public key**, a long string starting `eyJ…`

The anon key is designed to be public: it only lets someone do what the database's
row-level security allows, and ours only allows reading and writing *your own row*.

---

## 1. Create the project

1. Go to **https://supabase.com** → *Start your project* → sign in with GitHub or email.
2. **New project**:
   - **Name:** `mishkat`
   - **Database password:** press *Generate a password* and store it somewhere — you will not need it for this app, but Supabase requires one.
   - **Region:** choose the one closest to you (for Lebanon: *Frankfurt* or *Bahrain*).
   - Plan: **Free**.
3. Wait about two minutes while the database is created.

## 2. Create the table and the lock

1. In the left sidebar open **SQL Editor** → **New query**.
2. Paste everything below and press **Run** (or Ctrl/⌘ + Enter).

```sql
-- Mishkat: one row per person, readable only by its owner
create table if not exists public.progress (
  owner       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  name        text,
  record      jsonb not null,
  updated_at  timestamptz not null default now(),
  device      text
);

alter table public.progress enable row level security;

drop policy if exists "own row read"   on public.progress;
drop policy if exists "own row write"  on public.progress;
drop policy if exists "own row update" on public.progress;

create policy "own row read"   on public.progress for select using (auth.uid() = owner);
create policy "own row write"  on public.progress for insert with check (auth.uid() = owner);
create policy "own row update" on public.progress for update using (auth.uid() = owner) with check (auth.uid() = owner);
```

You should see *Success. No rows returned*. The same script is inside the app, on
**People → Cloud backup → Copy the SQL**, so you never have to trust this file alone.

## 3. Copy the two values

1. Left sidebar → **Project Settings** (the gear) → **API**.
2. Copy **Project URL**.
3. Copy the **anon / public** key (under *Project API keys*).

Do **not** use the `service_role` key — that one bypasses the lock and must never
appear in a web page.

## 4. Sign-in settings (recommended)

Supabase's email sign-in is on by default and sends a **six-digit code**, which is why
Mishkat asks for six digits rather than a link.

- **Authentication → Sign In / Providers → Email**: keep *Enable email provider* on.
  - *Confirm email* can stay on (recommended).
  - *Secure email change* / password settings do not matter — we never use passwords.
- **Authentication → URL Configuration**: nothing to change, because no redirect is used.

### Want unlimited sign-ins?

The free project's built-in email sender is rate-limited (a few messages per hour,
and the first mail often lands in spam — check it). That is fine for setting up two
devices. If you want this to be your permanent account system:

1. **Authentication → Emails** (or *Settings → Auth → SMTP*), and plug in a free SMTP
   provider — Brevo (300 emails/day) or Resend (3,000/month) both work.
2. Send everything to yourself from your own domain or their sandbox address.

Until then: sign in on each device **once**, and the session is kept on that device
for weeks (it refreshes itself silently).

## 5. Paste into Mishkat

1. Open **Mishkat → People → Cloud backup**.
2. Paste the **Project URL** and the **anon key**, press **Save connection**.
3. Type your email → **Email me a code** → type the six digits → **Sign in**.

That is it. Your record uploads immediately, and from then on:

- every change is uploaded in the background a few seconds after you make it;
- opening the app on another device and signing in brings the record down;
- **↑ Upload my record now** / **↓ Bring my record down** are there when you want to
  force it;
- nothing breaks offline — changes wait on the device and go out on reconnection.

## If it says the connection is not healthy

Open **People → Cloud backup** while signed in and look at the line under your email:

| what it says | what to do |
|---|---|
| ✓ Connected | nothing — you are done |
| The table is missing | the SQL in step 2 has not run on **this** project (check the ref in your Project URL — a second project is a second database) |
| The key was rejected | re-copy the **anon public** key (not service_role) into the app |
| The row was refused | re-run the same SQL; it recreates the three policies |
| No connection | the Project URL is wrong, or you are offline |

## What is stored

One row per person, in `public.progress`:

| column | what it is |
|---|---|
| `owner` | your account id (filled by the database, not by the page) |
| `name` | the name in your plan |
| `record` | the entire Mishkat record as JSON — plan, log, page strengths, streak |
| `updated_at` | last upload |
| `device` | a short user-agent string, so you can tell your devices apart |

You can see, edit or delete your own row in the **Table editor** at any time. Deleting
your account in Supabase removes the row automatically (`on delete cascade`).

## What it is not

- Not end-to-end encrypted: whoever controls the Supabase project (you) could read the
  rows. That is the trade for being able to sync at all.
- Not a backup against losing the project: keep the occasional **Export my record** file.
- Not shared between people: there is no "family" view. Each account sees one row.

## If something goes wrong

| symptom | cause |
|---|---|
| *Email me a code* fails, 429 | the free email sender is rate-limited — wait an hour, or add SMTP (step 4) |
| Code "invalid or has expired" | codes last ~1 hour and are single-use; press *Email me a code* again |
| *PUSH_FAILED:401 / 403* | wrong anon key, or the SQL in step 2 was not run |
| *PUSH_FAILED:404* | the table does not exist yet — run step 2 again |
| Sign-in works but nothing arrives | the account signed in successfully but has no row yet: on the device that has your data, press **↑ Upload my record now** |
| Two devices disagree | whichever uploads last wins; use ↑/↓ to settle it deliberately |
