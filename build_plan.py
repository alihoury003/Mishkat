"""Generate the day-by-day Hifz plan (Sabaq / Sabqi / Manzil) for one student.

Intake answers baked in:
  - firm (locked): Juz 30 pp.582-604, Al-Kahf pp.293-304, Al-Mulk p.562  -> 36 pages
  - warm (familiar, needs soldering): Maryam pp.305-311, Taha 1-2 pp.312-313,
    Yusuf pp.235-248                                                     -> 23 pages
  - Baqarah pp.2-15: deliberately NOT repeated (restart = same trap). They are
    absorbed into Sabaq later, permanently, with the system behind them.
  - budget: 45 focused min/day, split sessions
  - target: full Quran in 2-3 years

Pacing philosophy (front-loading):
  early on the Manzil corpus is tiny, so new material can run fast; as the corpus
  grows the quota steps down, because revision is what decides the timeline.
"""
import json, os
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
TOTAL_PAGES = 604
START = date(2026, 11, 2)      # a Monday
BUDGET = 45                    # minutes/day
SEC_PER_PAGE = 150             # ~2.5 min to recite one page from memory

firm = sorted(set(list(range(582, 605)) + list(range(293, 305)) + [562]))
warm = sorted(set(list(range(305, 312)) + list(range(312, 314)) + list(range(235, 249))))

# New-page order: continue from where he stopped (Taha p.314), finish the juz-ish run,
# then the Baqarah block, then the remaining surahs, Fatiha last (it is already known).
new_order = list(range(314, 582)) + list(range(2, 235)) + list(range(249, 293)) + [1]
new_order = [p for p in new_order if p not in firm and p not in warm]

RAMADAN = [
    (date(2027, 2, 8), date(2027, 3, 9)),
    (date(2028, 1, 28), date(2028, 2, 26)),
    (date(2028, 12, 16), date(2029, 1, 14)),
]


def is_ram(d):
    return any(a <= d <= b for a, b in RAMADAN)


SPEED = 1.0


def weekly_quota(week, ram, stage2):
    """Pages of new material per week, scaled by how much time the student has."""
    if week == 0:
        return 0                     # week 1: reset & soldering, no new pages
    if ram:
        base = 12
    elif stage2:
        base = 5
    elif week <= 3:
        base = 4
    elif week <= 8:
        base = 6
    else:
        base = 7
    return max(1, round(base * SPEED))


def generate(BUDGET):
  global SPEED
  SPEED = (BUDGET - 12) / 33.0
  days = []
  corpus = firm[:]                     # the Manzil corpus, grows with every page learned
  ptr = 0
  qi = 0
  stage = 1
  week = 0
  d = START
  day_i = 0
  khatm = None
  FRIDAY = 4                           # Mon=0

  while True:
      if khatm is None:
          # ---- week setup: which days carry new material, and how much
          week_days = [d + timedelta(days=k) for k in range(7)]
          ram = is_ram(d)
          quarter_break = (week > 13 and week % 13 == 0 and not ram)
          if quarter_break:
              alloc = {k: 0 for k in range(7)}
          else:
              q = weekly_quota(week, ram, stage == 2)
              slots = [k for k in range(7) if k != FRIDAY]
              full, rem = divmod(q, len(slots)) if q else (0, 0)
              alloc = {k: full for k in slots}
              for k in slots[:rem]:
                  alloc[k] += 1
          week_kind = 'reset' if week == 0 else ('consolidation' if quarter_break else 'normal')

          for k in range(7):
              cd = week_days[k]
              dow = cd.weekday()
              n_new = alloc.get(k, 0)
              if qi + n_new > len(new_order):
                  n_new = len(new_order) - qi
              new_pages = new_order[qi:qi + n_new]
              qi += n_new

              # stage 2 begins once the first 268 pages (pp.314-581) are behind us
              if stage == 1 and qi >= 268:
                  stage = 2

              solidify = []
              if week == 0:
                  kind = 'reset'
                  solidify = warm[day_i * 4: day_i * 4 + 4]
                  solidify = solidify or warm[:2]
              elif n_new and week_kind == 'normal':
                  kind = 'new'
              elif dow == FRIDAY:
                  kind = 'weekly'
              else:
                  kind = 'review'

              # ---- minute budget
              sabaq = 18 * len(new_pages) if new_pages else (25 if kind == 'reset' else 0)
              if kind == 'reset':
                  sabaq, sabqi = 25, 10
              elif kind == 'new':
                  sabqi = 8
              elif kind == 'weekly':
                  sabqi = 15
              else:
                  sabqi = 12
              manzil = max(8, BUDGET - sabaq - sabqi)
              if kind == 'reset':
                  manzil = BUDGET - sabaq - sabqi

              # ---- Manzil slice: circular rotation over everything already banked
              k_pages = max(1, round(manzil * 60 / SEC_PER_PAGE))
              k_pages = min(k_pages, len(corpus))
              slice_pages = [corpus[(ptr + j) % len(corpus)] for j in range(k_pages)]
              ptr = (ptr + k_pages) % len(corpus)
              rot = round(len(corpus) / k_pages) if k_pages else 1

              # ---- Sabqi: the last 7 days of fresh pages, recited without looking
              recent = []
              for prev in days[-7:]:
                  recent += prev['new']
              recent = [p for p in recent if p not in new_pages][:10]

              days.append({
                  'i': day_i, 'date': cd.isoformat(), 'type': kind, 'ramadan': ram,
                  'new': new_pages, 'solidify': solidify, 'sabqi': recent,
                  'manzil': slice_pages, 'rot': rot,
                  'min': {'sabaq': sabaq, 'sabqi': sabqi, 'manzil': manzil},
                  'corpus': len(corpus), 'stage': stage,
              })
              corpus = sorted(set(corpus) | set(new_pages))
              day_i += 1

          week += 1
          d += timedelta(days=7)

          if qi >= len(new_order):
              khatm = d - timedelta(days=1)
              # 90-day final consolidation pass, then the plan ends
              for extra in range(90):
                  dd = khatm + timedelta(days=1 + extra)
                  days.append({
                      'i': day_i, 'date': dd.isoformat(), 'type': 'khatm', 'ramadan': is_ram(dd),
                      'new': [], 'solidify': [], 'sabqi': [],
                      'manzil': [corpus[(ptr + j) % len(corpus)] for j in range(8)],
                      'rot': round(len(corpus) / 8), 'min': {'sabaq': 0, 'sabqi': 10, 'manzil': 30},
                      'corpus': TOTAL_PAGES, 'stage': 3,
                  })
                  ptr = (ptr + 8) % len(corpus)
                  day_i += 1
              break

  return {
    'budget': BUDGET, 'start': START.isoformat(), 'totalDays': len(days),
    'khatmDate': khatm.isoformat() if khatm else None,
    'endDate': days[-1]['date'],
    'firmBaseline': firm, 'warmBaseline': warm,
    'ramadan': [[a.isoformat(), b.isoformat()] for a, b in RAMADAN],
    'days': days,
  }

VARIANTS = {str(b): generate(b) for b in (45, 60, 75, 90)}
TOTAL_PAGES = 604
capacity = []
for b, v in VARIANTS.items():
    manz_min = max(1, int(b) - 26)
    pages_per_day = manz_min * 60 / SEC_PER_PAGE
    capacity.append({
        'budget': int(b),
        'khatm': v['khatmDate'],
        'months': round((date.fromisoformat(v['khatmDate']) - START).days / 30.44, 1),
        'rotation': round(TOTAL_PAGES / pages_per_day),
    })

base = VARIANTS['45']
plan = {k: base[k] for k in ('start', 'totalDays', 'khatmDate', 'endDate',
                             'firmBaseline', 'warmBaseline', 'ramadan', 'days')}
plan['budget'] = 45
plan['variants'] = {b: {'khatmDate': v['khatmDate'], 'totalDays': v['totalDays']}
                    for b, v in VARIANTS.items()}
plan['capacity'] = capacity
json.dump(plan, open(os.path.join(HERE, 'data/plan.json'), 'w'), separators=(',', ':'))
print('capacity:', json.dumps(capacity))
print('khatm 45min:', plan['khatmDate'], '| end:', plan['endDate'], '| days:', plan['totalDays'])
print('size KB:', os.path.getsize(os.path.join(HERE, 'data/plan.json')) // 1024)
