"""Build compact page-oriented Quran dataset for the Hifz app.
Output: data/quran.json  (604 pages, Arabic Uthmani + Sahih International)
"""
import json, re, os

HERE = os.path.dirname(os.path.abspath(__file__))
ar = json.load(open(os.path.join(HERE, 'data/raw.json')))['data']['surahs']
en = json.load(open(os.path.join(HERE, 'data/en.json')))['data']['surahs']

en_index = {}
for s in en:
    for a in s['ayahs']:
        en_index[(s['number'], a['numberInSurah'])] = a['text']

SURAH_EN_NAME = {}
for s in ar:
    SURAH_EN_NAME[s['number']] = s['englishName']

# ayah 9:1 and 27:30 keep basmala (it is part of the verse); 1:1 is basmala itself.
pages = {}
for s in ar:
    snum = s['number']
    for a in s['ayahs']:
        p = a['page']
        txt = a['text'].replace('\ufeff', '').strip()
        if snum not in (1, 9, 27):
            txt = re.sub(r'^بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\s*', '', txt).strip()
        pg = pages.setdefault(p, {'p': p, 'juz': a['juz'], 'surahs': []})
        if not pg['surahs'] or pg['surahs'][-1]['n'] != snum:
            pg['surahs'].append({'n': snum, 'ar': s['name'].replace('سُورَةُ ', ''), 'en': SURAH_EN_NAME[snum], 'ayahs': []})
        pg['surahs'][-1]['ayahs'].append([a['numberInSurah'], txt, en_index.get((snum, a['numberInSurah']), '')])

out = {'pages': [pages[k] for k in sorted(pages)]}
json.dump(out, open(os.path.join(HERE, 'data/quran.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('pages:', len(out['pages']), 'size KB:', os.path.getsize(os.path.join(HERE, 'data/quran.json')) // 1024)
# sanity
p2 = pages[2]
print(p2['juz'], [(s['n'], s['en'], len(s['ayahs'])) for s in p2['surahs']])
