# Publishing

The site is plain static files. `index.html` is a **built** file — everything
(CSS, JS, fonts, mushaf data) is inlined so it works from a USB stick, offline,
with no build step at runtime.

## GitHub Pages

1. Push this repository (files at the root — `index.html` must be in the root).
2. **Settings → Pages → Build and deployment**: *Deploy from a branch*,
   branch `main`, folder `/ (root)`, **Save**.
3. Wait a minute; the site appears at `https://<user>.github.io/Mishkat/`.
   `.nojekyll` is already here so the folder is served as-is.

Adding a custom domain later: **Settings → Pages → Custom domain**, then tick
*Enforce HTTPS*.

## Cache busting

`sw.js` caches the app under a version name. **Whenever you deploy a new
`index.html`, bump it** (`mishkat-v6` → `mishkat-v7`), or phones that already
have the app will keep the old copy:

```js
const CACHE = 'mishkat-v7';
```

## Rebuilding index.html

Only needed if you edit anything in `app/`:

```bash
python3 build.py            # writes ../mishkat.html
cp ../mishkat.html site/index.html
```

`build.py` reads `app/*.js`, `app/style.css`, `data/`, `fonts/`, `img/` and
inlines them. `build_data.py` and `build_plan.py` regenerate the bundle data and
the plan tables if those change.

## Cloud backup

Optional, documented in **[CLOUD-SETUP.md](CLOUD-SETUP.md)**. It needs no server
code: the page talks to a Supabase project you own using only its URL and public
anon key, protected by row-level security.
