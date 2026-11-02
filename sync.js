/* ============================================================
   Mishkat — optional cloud sync (Supabase, no SDK)
   Talks to PostgREST + GoTrue with plain fetch so the app stays
   one file with no dependencies. Offline-first: the app never
   waits for the network, it queues and catches up.
   ============================================================ */
(function (root) {
  'use strict';

  var KEY = 'mishkat.cloud';
  var TABLE = '/rest/v1/progress';

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { }
  }

  var listeners = [];
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) { } }); }

  function cfg() {
    var c = read();
    return (c.url && c.anon) ? { url: c.url.replace(/\/+$/, ''), anon: c.anon } : null;
  }
  function setCfg(url, anon) {
    var c = read();
    c.url = String(url || '').trim().replace(/\/+$/, '');
    c.anon = String(anon || '').trim();
    write(c); emit();
  }
  function clearAll() { try { localStorage.removeItem(KEY); } catch (e) { } emit(); }

  function session() {
    var c = read();
    if (!c.access || !c.uid) return null;
    return { access: c.access, refresh: c.refresh, exp: c.exp || 0, email: c.email || '', uid: c.uid };
  }
  function saveSession(s) {
    var c = read();
    c.access = s.access_token; c.refresh = s.refresh_token;
    c.exp = Date.now() + (s.expires_in || 3600) * 1000 - 60000;
    c.email = (s.user && s.user.email) || c.email || '';
    c.uid = (s.user && s.user.id) || c.uid;
    write(c); emit();
  }
  function signOut() {
    var c = read();
    delete c.access; delete c.refresh; delete c.exp; delete c.uid; delete c.email;
    write(c); emit();
  }

  function headers(extra) {
    var c = cfg();
    var h = Object.assign({ 'apikey': c.anon, 'Content-Type': 'application/json' }, extra || {});
    var s = session();
    if (s) h.Authorization = 'Bearer ' + s.access;
    return h;
  }

  async function refreshIfNeeded() {
    var s = session();
    if (!s) return null;
    if (s.exp && Date.now() < s.exp) return s;
    var c = cfg();
    if (!c || !s.refresh) return null;
    try {
      var r = await fetch(c.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: { 'apikey': c.anon, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh })
      });
      if (!r.ok) return null;
      var j = await r.json();
      saveSession(j);
      return session();
    } catch (e) { return null; }
  }

  /* ---- auth: six-digit email code, no password, no redirect ---- */
  async function sendCode(email) {
    var c = cfg();
    if (!c) throw new Error('NO_CONFIG');
    var r = await fetch(c.url + '/auth/v1/otp', {
      method: 'POST', headers: { 'apikey': c.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, create_user: true })
    });
    if (!r.ok) throw new Error('SEND_FAILED:' + r.status + ':' + (await r.text()).slice(0, 120));
    return true;
  }

  async function verifyCode(email, token) {
    var c = cfg();
    if (!c) throw new Error('NO_CONFIG');
    var r = await fetch(c.url + '/auth/v1/verify', {
      method: 'POST', headers: { 'apikey': c.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email', email: email, token: String(token).trim() })
    });
    var body = await r.text();
    if (!r.ok) throw new Error('VERIFY_FAILED:' + r.status + ':' + body.slice(0, 160));
    var j = JSON.parse(body);
    if (!j.access_token) throw new Error('VERIFY_FAILED:no token');
    saveSession(j);
    return session();
  }

  /* ---- the record itself ---- */
  async function push(state, name) {
    var c = cfg();
    if (!c) throw new Error('NO_CONFIG');
    var s = await refreshIfNeeded();
    if (!s) throw new Error('NO_SESSION');
    var r = await fetch(c.url + TABLE + '?on_conflict=owner', {
      method: 'POST',
      headers: headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{
        owner: s.uid,
        name: name || '—',
        record: state,
        updated_at: new Date().toISOString(),
        device: (navigator.userAgent || '').slice(0, 120)
      }])
    });
    if (!r.ok) {
      var t = await r.text();
      var why = r.status === 404 ? 'TABLE_MISSING' : (r.status === 401 || r.status === 403) ? 'RLS_OR_KEY' : 'HTTP_' + r.status;
      throw new Error(why + ':' + t.slice(0, 160));
    }
    var cc = read(); cc.lastPush = Date.now(); cc.lastError = null; write(cc); emit();
    return true;
  }

  async function pull() {
    var c = cfg();
    if (!c) throw new Error('NO_CONFIG');
    var s = await refreshIfNeeded();
    if (!s) throw new Error('NO_SESSION');
    var r = await fetch(c.url + TABLE + '?select=name,record,updated_at&owner=eq.' + encodeURIComponent(s.uid), {
      method: 'GET', headers: headers()
    });
    if (!r.ok) {
      var t = await r.text();
      var why = r.status === 404 ? 'TABLE_MISSING' : (r.status === 401 || r.status === 403) ? 'RLS_OR_KEY' : 'HTTP_' + r.status;
      throw new Error(why + ':' + t.slice(0, 160));
    }
    var rows = await r.json();
    return rows && rows[0] ? rows[0] : null;
  }

  /* GET one row: tells us table-missing vs key-rejected vs fine */
  async function test() {
    var c = cfg();
    if (!c) return { ok: false, code: 'NO_CONFIG' };
    var s = await refreshIfNeeded();
    try {
      var r = await fetch(c.url + TABLE + '?select=owner&limit=1', { method: 'GET', headers: headers() });
      if (r.ok) return { ok: true, code: 'OK', signedIn: !!s };
      var body = await r.text();
      var code = r.status === 404 ? 'TABLE_MISSING'
        : (r.status === 401 || r.status === 403) ? (s ? 'RLS_OR_KEY' : 'KEY_REJECTED')
          : 'HTTP_' + r.status;
      return { ok: false, code: code, status: r.status, detail: body.slice(0, 200) };
    } catch (e) {
      return { ok: false, code: 'NETWORK', detail: String(e.message || e) };
    }
  }

  function status() {
    var c = read();
    return {
      configured: !!(c.url && c.anon),
      signedIn: !!session(),
      email: session() ? session().email : '',
      lastPush: c.lastPush || 0,
      lastError: c.lastError || null,
      url: c.url || ''
    };
  }
  function noteError(msg) {
    var c = read(); c.lastError = msg || null; write(c); emit();
  }

  root.MishkatSync = {
    cfg: cfg, setCfg: setCfg, clearAll: clearAll,
    session: session, signOut: signOut,
    sendCode: sendCode, verifyCode: verifyCode,
    push: push, pull: pull, test: test, status: status, noteError: noteError,
    onChange: function (fn) { listeners.push(fn); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
