/* ============================================================
   Mishkat — plan engine
   Builds a day-by-day Sabaq / Sabqi / Manzil schedule from a profile:
     { budget, startPage, solid: [pages], shaky: [pages], start: 'YYYY-MM-DD' }
   Runs in the browser and in node (for tests).
   ============================================================ */
(function (root) {
  'use strict';

  var TOTAL_PAGES = 604;
  var SEC_PER_PAGE = 150;      // ~2.5 min to recite a page from memory
  var FRIDAY = 4;              // Mon = 0

  var RAMADAN = [
    ['2027-02-08', '2027-03-09'],
    ['2028-01-28', '2028-02-26'],
    ['2028-12-16', '2029-01-14'],
    ['2029-12-05', '2030-01-03'],
    ['2030-11-25', '2030-12-24']
  ];

  function iso(d) { return d.toISOString().slice(0, 10); }
  function parse(s) { return new Date(s + 'T12:00:00Z'); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }
  function isRam(s) {
    for (var i = 0; i < RAMADAN.length; i++) if (s >= RAMADAN[i][0] && s <= RAMADAN[i][1]) return true;
    return false;
  }

  function weeklyBase(week, ram, stage2) {
    if (week === 0) return 0;               // reset week: no new pages
    if (ram) return 12;
    if (stage2) return 5;
    if (week <= 3) return 4;
    if (week <= 8) return 6;
    return 7;
  }

  function build(profile) {
    var budget = Math.max(15, Math.min(180, profile.budget || 45));
    var SPEED = (budget - 12) / 33;         // 45 min -> 1.0
    var startIso = profile.start || '2026-11-02';
    var solid = {}, shaky = {};
    (profile.solid || []).forEach(function (p) { solid[p] = 1; });
    (profile.shaky || []).forEach(function (p) { shaky[p] = 1; });

    // ---- what the person is aiming at: the whole mushaf, or a chosen set of pages
    var scope = profile.scope || { mode: 'all' };
    var pageSet = null;
    if (scope.mode === 'pages' || scope.mode === 'juz' || scope.mode === 'surah') {
      var seen = {};
      pageSet = (scope.pages || []).filter(function (p) {
        if (p < 1 || p > TOTAL_PAGES || seen[p]) return false;
        seen[p] = 1; return true;
      }).sort(function (a, b) { return a - b; });
      if (!pageSet.length) pageSet = null;   // nothing chosen → fall back to the whole mushaf
    }
    var wholeMushaf = !pageSet;
    var targetSize = pageSet ? pageSet.length : TOTAL_PAGES;

    // ---- the queue of pages still to be memorised, in the chosen direction
    var startPage = Math.max(1, Math.min(TOTAL_PAGES, profile.startPage || 1));
    var order = [];
    if (pageSet) {
      pageSet.forEach(function (p) { if (!solid[p] && !shaky[p]) order.push(p); });
    } else {
      for (var i = 0; i < TOTAL_PAGES; i++) {
        var p = ((startPage - 1 + i) % TOTAL_PAGES) + 1;
        if (!solid[p] && !shaky[p]) order.push(p);
      }
    }

    // shaky pages get soldered first, four a day, during the reset week.
    // With a scoped goal, only the shaky pages *inside* the goal are soldered now;
    // the rest still belong to the manzil you carry.
    var warmAll = (profile.shaky || []).slice().sort(function (a, b) { return a - b; });
    var warm = pageSet ? warmAll.filter(function (p) { return pageSet.indexOf(p) >= 0; }) : warmAll;

    if (!order.length) {
      var only = parse(startIso);
      var sl0 = [];
      var corp0 = Object.keys(solid).map(Number).sort(function (a, b) { return a - b; });
      for (var m0 = 0; m0 < 8 && corp0.length; m0++) sl0.push(corp0[m0 % corp0.length]);
      var one = [{
        i: 0, date: iso(only), type: 'khatm', ramadan: isRam(iso(only)), new: [], solidify: [], sabqi: [],
        manzil: sl0, rot: corp0.length ? Math.max(1, Math.round(corp0.length / 8)) : 0,
        min: { sabaq: 0, sabqi: 10, manzil: Math.max(20, budget - 15) },
        corpus: corp0.length, stage: 3
      }];
      return {
        budget: budget, start: startIso, days: one, khatmDate: iso(only),
        endDate: iso(only), totalDays: 1, months: 0, queueLength: 0,
        targetSize: targetSize, wholeMushaf: wholeMushaf, scope: scope, startPage: startPage,
        rotationAtKhatm: one[0].rot, solidCount: Object.keys(solid).length, shakyCount: warmAll.length, solderCount: warm.length,
        alreadyDone: true
      };
    }

    var days = [];
    var corpus = Object.keys(solid).map(Number).concat(pageSet ? warmAll : warm).sort(function (a, b) { return a - b; });
    var ptr = 0, qi = 0, week = 0, dayI = 0, stage = 1, khatm = null;
    var d = parse(startIso);
    var stageBoundary = Math.round(order.length * (268 / 545));   // matches the validated schedule

    while (true) {
      var weekStart = d;
      var ram = isRam(iso(weekStart));
      var resetWeek = week === 0 && warm.length > 0;
      var quarterBreak = (week > 13 && week % 13 === 0 && !ram);
      var alloc = {};
      var k;
      if (quarterBreak || resetWeek) {
        for (k = 0; k < 7; k++) alloc[k] = 0;
      } else {
        var q = Math.max(1, Math.round(weeklyBase(week, ram, stage === 2) * SPEED));
        var slots = [];
        for (k = 0; k < 7; k++) if (k !== FRIDAY) slots.push(k);
        var full = Math.floor(q / slots.length), rem = q % slots.length;
        slots.forEach(function (s) { alloc[s] = full; });
        slots.slice(0, rem).forEach(function (s) { alloc[s] += 1; });
      }

      for (var kk = 0; kk < 7; kk++) {
        var cd = addDays(weekStart, kk);
        var cdIso = iso(cd);
        var dow = cd.getUTCDay() === 0 ? 6 : cd.getUTCDay() - 1;   // Mon=0 .. Sun=6
        var nNew = alloc[kk] || 0;
        if (qi + nNew > order.length) nNew = order.length - qi;
        var newPages = order.slice(qi, qi + nNew);
        qi += nNew;
        if (stage === 1 && qi >= stageBoundary) stage = 2;

        var solidify = [];
        if (resetWeek) {
          solidify = warm.slice(dayI * 4, dayI * 4 + 4);
          if (!solidify.length) solidify = warm.slice(0, 2);
        }

        var kind;
        if (resetWeek) kind = 'reset';
        else if (nNew && !quarterBreak) kind = 'new';
        else if (dow === FRIDAY) kind = 'weekly';
        else kind = 'review';

        var sabaq, sabqi;
        if (kind === 'reset') { sabaq = 25; sabqi = 10; }
        else if (kind === 'new') { sabaq = 18 * newPages.length; sabqi = 8; }
        else if (kind === 'weekly') { sabaq = 0; sabqi = 15; }
        else { sabaq = 0; sabqi = 12; }
        var manzil = Math.max(8, budget - sabaq - sabqi);
        if (kind === 'reset') manzil = Math.max(0, budget - sabaq - sabqi);

        var kPages = Math.max(1, Math.round(manzil * 60 / SEC_PER_PAGE));
        kPages = Math.min(kPages, Math.max(1, corpus.length));
        var slice = [];
        for (var j = 0; j < kPages; j++) slice.push(corpus[(ptr + j) % corpus.length]);
        ptr = (ptr + kPages) % Math.max(1, corpus.length);
        var rot = kPages ? Math.round(corpus.length / kPages) : 0;

        var recent = [];
        for (var b = Math.max(0, days.length - 7); b < days.length; b++) recent = recent.concat(days[b].new);
        recent = recent.filter(function (x) { return newPages.indexOf(x) === -1; }).slice(0, 10);

        days.push({
          i: dayI, date: cdIso, type: kind, ramadan: ram,
          new: newPages, solidify: solidify, sabqi: recent,
          manzil: slice.slice(0, 10), rot: rot,
          min: { sabaq: sabaq, sabqi: sabqi, manzil: manzil },
          corpus: corpus.length, stage: stage
        });

        newPages.forEach(function (pg) { if (corpus.indexOf(pg) === -1) corpus.push(pg); });
        corpus.sort(function (a, b2) { return a - b2; });
        dayI++;
      }

      week++;
      d = addDays(d, 7);

      if (qi >= order.length) {
        khatm = iso(addDays(d, -1));
        for (var e = 0; e < 90; e++) {
          var dd = addDays(d, e);
          var sl = [];
          for (var m = 0; m < 8; m++) sl.push(corpus[(ptr + m) % corpus.length]);
          ptr = (ptr + 8) % corpus.length;
          days.push({
            i: dayI, date: iso(dd), type: 'khatm', ramadan: isRam(iso(dd)),
            new: [], solidify: [], sabqi: [], manzil: sl,
            rot: Math.round(corpus.length / 8), min: { sabaq: 0, sabqi: 10, manzil: Math.max(20, budget - 15) },
            corpus: TOTAL_PAGES, stage: 3
          });
          dayI++;
        }
        break;
      }
    }

    var months = Math.round((parse(khatm) - parse(startIso)) / (30.44 * 86400000) * 10) / 10;
    var toKhatm = 0;
    for (var tk = 0; tk < days.length; tk++) { if (days[tk].date <= khatm) toKhatm++; else break; }

    return {
      budget: budget, start: startIso, days: days, khatmDate: khatm,
      endDate: days[days.length - 1].date, totalDays: toKhatm || days.length, tailDays: days.length - (toKhatm || days.length),
      calendarDays: days.length,
      months: months, queueLength: order.length, targetSize: targetSize,
      wholeMushaf: wholeMushaf, scope: scope, startPage: startPage,
      rotationAtKhatm: days[days.length - 1].rot,
      solidCount: Object.keys(solid).length, shakyCount: warmAll.length, solderCount: warm.length
    };
  }

  function capacity(profile, budget) {
    var out = [];
    var base = budget || (profile && profile.budget) || 45;
    var list = [];
    [base, base + 15, base + 30, base + 45].forEach(function (b) {
      if (list.indexOf(b) === -1) list.push(b);
    });
    list.forEach(function (b) {
      var p = Object.assign({}, profile, { budget: b });
      var r = build(p);
      var manz = Math.max(1, b - 26);
      out.push({
        budget: b, khatm: r.khatmDate, months: r.months,
        rotation: Math.round(TOTAL_PAGES / (manz * 60 / SEC_PER_PAGE))
      });
    });
    return out;
  }

  var api = { build: build, capacity: capacity, TOTAL_PAGES: TOTAL_PAGES, RAMADAN: RAMADAN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MishkatPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
