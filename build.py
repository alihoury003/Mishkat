"""Assemble the single-file deliverable: hifz-atlas.html

Inlines everything (artwork, fonts, geometry tile, 604-page mushaf, calendar plan)
so the file works offline and inside a sandboxed preview with no network.
"""
import base64, gzip, json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'mishkat.html')

# ---------------------------------------------------------------- artwork
SHOTS = {
    'N1': ('img/nature-1.jpg', (1400, 1750), 66),
    'N2': ('img/nature-2.jpg', (1400, 1750), 64),
    'N3': ('img/nature-3.jpg', (1800, 1200), 66),
    'NUR': ('img/nur-1.jpg', (1700, 1100), 66),
}


def shot(src, size, q):
    im = Image.open(os.path.join(HERE, src)).convert('RGB')
    w, h = im.size
    nw, nh = size
    s = max(nw / w, nh / h)
    im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    w2, h2 = im.size
    im = im.crop(((w2 - nw) // 2, (h2 - nh) // 2, (w2 - nw) // 2 + nw, (h2 - nh) // 2 + nh))
    tmp = os.path.join(HERE, 'shots', os.path.basename(src))
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    im.save(tmp, quality=q, optimize=True, progressive=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(open(tmp, 'rb').read()).decode()


IMGS = {k: shot(*v) for k, v in SHOTS.items()}
LOGO = 'data:image/png;base64,' + base64.b64encode(open(os.path.join(HERE, 'assets/logo-192.png'), 'rb').read()).decode()

# ---------------------------------------------------------------- fonts
def font(name):
    return 'data:font/woff2;base64,' + base64.b64encode(
        open(os.path.join(HERE, 'fonts', name), 'rb').read()).decode()


# ---------------------------------------------------------------- geometry tile
TILE = (
    "<svg xmlns='http://www.w3.org/2000/svg' width='168' height='168' viewBox='0 0 168 168'>"
    "<g fill='none' stroke='#d4a94f' stroke-width='1' stroke-opacity='.9'>"
    "<rect x='34' y='34' width='100' height='100'/>"
    "<rect x='34' y='34' width='100' height='100' transform='rotate(45 84 84)'/>"
    "<circle cx='84' cy='84' r='50'/><circle cx='84' cy='84' r='24'/>"
    "<path d='M0 84H34M134 84H168M84 0V34M84 134V168'/>"
    "<path d='M0 0l34 34M168 0l-34 34M0 168l34-34M168 168l-34-34'/>"
    "<circle cx='0' cy='0' r='22'/><circle cx='168' cy='0' r='22'/>"
    "<circle cx='0' cy='168' r='22'/><circle cx='168' cy='168' r='22'/>"
    "</g></svg>"
).replace('#', '%23') if False else (
    "<svg xmlns='http://www.w3.org/2000/svg' width='168' height='168' viewBox='0 0 168 168'>"
    "<g fill='none' stroke='#d4a94f' stroke-width='1' stroke-opacity='.85'>"
    "<rect x='34' y='34' width='100' height='100'/>"
    "<rect x='34' y='34' width='100' height='100' transform='rotate(45 84 84)'/>"
    "<circle cx='84' cy='84' r='50'/><circle cx='84' cy='84' r='24'/>"
    "<path d='M0 84H34M134 84H168M84 0V34M84 134V168'/>"
    "<path d='M0 0l34 34M168 0l-34 34M0 168l34-34M168 168l-34-34'/>"
    "<circle cx='0' cy='0' r='22'/><circle cx='168' cy='0' r='22'/>"
    "<circle cx='0' cy='168' r='22'/><circle cx='168' cy='168' r='22'/>"
    "</g></svg>")

# ---------------------------------------------------------------- data
quran = json.load(open(os.path.join(HERE, 'data/quran.json')))
qjson = json.dumps(quran, ensure_ascii=False, separators=(',', ':'))
q_b64 = base64.b64encode(gzip.compress(qjson.encode('utf-8'), 9)).decode()
plan = json.load(open(os.path.join(HERE, 'data/plan.json')))
plan_json = json.dumps(plan, ensure_ascii=False, separators=(',', ':'))

# ---------------------------------------------------------------- assemble
css = open(os.path.join(HERE, 'app/style.css'), encoding='utf-8').read()
i18n = open(os.path.join(HERE, 'app/i18n.js'), encoding='utf-8').read()
planjs = open(os.path.join(HERE, 'app/plan.js'), encoding='utf-8').read()
syncjs = open(os.path.join(HERE, 'app/sync.js'), encoding='utf-8').read()
js = open(os.path.join(HERE, 'app/app.js'), encoding='utf-8').read()

css = (css
       .replace('__FONT_QURAN__', font('amiri-quran.woff2'))
       .replace('__FONT_AMIRI__', font('amiri-ar.woff2'))
       .replace('__FONT_AMIRI_LAT__', font('amiri-lat.woff2'))
       .replace('__FONT_SCH__', font('scheherazade-ar.woff2'))
       .replace('__IMG_N1__', IMGS['N1'])
       .replace('__IMG_N2__', IMGS['N2'])
       .replace('__IMG_N3__', IMGS['N3'])
       .replace('__IMG_NUR__', IMGS['NUR'])
       .replace('__TILE__', 'url("data:image/svg+xml;base64,' + base64.b64encode(TILE.encode()).decode() + '")'))

js = (js
      .replace('__QURAN_B64__', "'" + q_b64 + "'")
      .replace('__LOGO__', LOGO)
      .replace('__FAVICON_DATA__', 'data:image/png;base64,' + base64.b64encode(open(os.path.join(HERE, 'assets/favicon-32.png'), 'rb').read()).decode())
      .replace('__TILE__', TILE))

html = f"""<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>Mishkat — a companion for carrying the Qur'an</title>
<meta name="description" content="A day-by-day Sabaq / Sabqi / Manzil plan to memorise the Qur'an, with a page drill room, recitation audio, active-recall mushaf and streak tracking.">
<link rel="icon" href="assets/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="__FAVICON_DATA__">
<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="assets/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="assets/apple-touch-icon.png">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#08150f">
<meta property="og:type" content="website">
<meta property="og:title" content="Mishkat — a companion for carrying the Qur'an">
<meta property="og:description" content="Sabaq · Sabqi · Manzil. A day-by-day hifz plan with a practice room, recitation audio, active recall and streak tracking.">
<meta property="og:image" content="assets/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<style>
{css}
</style>
</head>
<body class="w-nature">
<noscript><div style="padding:40px;font-family:system-ui">This app needs JavaScript — it decompresses the embedded mushaf in your browser.</div></noscript>
<div class="bg"><div class="layer l1"></div><div class="layer l2"></div><div class="layer l3"></div><div class="veil"></div></div>
<main class="wrap" id="app"></main>
<script>
{i18n}
</script>
<script>
{planjs}
</script>
<script>
{syncjs}
</script>
<script>
{js}
</script>
<script>
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {{
  window.addEventListener('load', function () {{
    navigator.serviceWorker.register('sw.js').catch(function () {{ /* offline caching is optional */ }});
  }});
}}
</script>
</body>
</html>
"""
open(OUT, 'w', encoding='utf-8').write(html)
print('wrote', OUT, round(os.path.getsize(OUT) / 1048576, 2), 'MB')
