'use strict';
/* 브롤스타즈 온라인 서버: 경기마다 화면 없는 게임(index.html의 전투 코드)을 돌리고, WebSocket으로 플레이어와 주고받음.
   외부 패키지 없이 Node.js 기본 기능만 사용. */
const http = require('http');
const crypto = require('crypto');
const { createGame } = require('./headless.js');

const PORT = +process.env.PORT || 8080;
const MAX_MATCHES = +process.env.MAX_MATCHES || 6;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBWaAux4CAp2vmRpObC7sVrF5j6ZDoPNis';
const FIREBASE_DB_URL = (process.env.FIREBASE_DB_URL || 'https://brawl090417-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/$/, '');
const USAGE_ON = process.env.USAGE !== 'off';

const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------- WebSocket (RFC 6455, 텍스트 메시지만) ---------- */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const ws = { socket, open: true, onmessage: null, onclose: null, buf: Buffer.alloc(0), frag: [] };
  ws.send = text => {
    if (!ws.open) return;
    const payload = Buffer.from(text, 'utf8'), n = payload.length;
    let head;
    if (n < 126) head = Buffer.from([0x81, n]);
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    try { socket.write(Buffer.concat([head, payload])); } catch (e) { close(); }
  };
  const close = () => { if (!ws.open) return; ws.open = false; try { socket.end(Buffer.from([0x88, 0])); } catch (e) {} try { socket.destroy(); } catch (e) {} if (ws.onclose) ws.onclose(); };
  ws.close = close;
  socket.on('data', chunk => {
    ws.buf = Buffer.concat([ws.buf, chunk]);
    if (ws.buf.length > 4 * 1024 * 1024) { close(); return; }
    for (;;) {
      const b = ws.buf; if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > 1024 * 1024) { close(); return; }
      const mOff = off; if (masked) off += 4;
      if (b.length < off + len) return;
      let data = b.subarray(off, off + len);
      if (masked) { const mk = b.subarray(mOff, mOff + 4); data = Buffer.from(data); for (let i = 0; i < data.length; i++) data[i] ^= mk[i & 3]; }
      ws.buf = b.subarray(off + len);
      if (op === 0x8) { close(); return; }
      if (op === 0x9) { try { socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); } catch (e) {} continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x0) {
        ws.frag.push(data);
        if (fin) { const text = Buffer.concat(ws.frag).toString('utf8'); ws.frag = []; if (ws.onmessage) { try { ws.onmessage(text); } catch (e) { log('message error', e); } } }
      }
    }
  });
  socket.on('close', close); socket.on('error', close); socket.on('end', close);
  return ws;
}

/* ---------- 경기 ---------- */
const matches = new Map();
const newId = () => Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[crypto.randomInt(31)]).join('');
function createMatch(cfg) {
  if (matches.size >= MAX_MATCHES) throw new Error('서버가 가득 찼어요');
  const id = newId();
  const M = { id, cfg: null, socks: new Map(), handlers: {}, game: null, created: Date.now(), lastPeople: Date.now(), endAt: 0 };
  const B = {
    uid: 'server', online: true, presence: {}, room: null, ready: Promise.resolve(),
    on(ev, fn) { (M.handlers[ev] = M.handlers[ev] || []).push(fn); },
    send(data, to) { const s = JSON.stringify(data); for (const [uid, ws] of M.socks) if (!to || uid === to) ws.send(s); },
    setLive() {}, setReady: async () => {}, setHero: async () => {}, setNick() {}, setState() {},
  };
  M.fire = (ev, d) => { for (const fn of M.handlers[ev] || []) { try { fn(d); } catch (e) { log('handler error', e); } } };
  M.game = createGame({ setup: ctx => { ctx.BSO = B; ctx.__SERVER_URL = ''; }, onError: e => log('game error', id, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e) });
  M.cfg = Object.assign({}, cfg, { online: 1, server: 1, host: 'server', match: id });
  M.game.__serverStart(M.cfg);
  matches.set(id, M);
  log('match created', id, 'map', M.cfg.map, 'players', (M.cfg.roster || []).length, 'matches', matches.size);
  return M;
}
function endMatch(M, why) {
  if (!matches.has(M.id)) return;
  matches.delete(M.id);
  try { M.game.__dispose(); } catch (e) {}
  for (const ws of M.socks.values()) { try { ws.close(); } catch (e) {} }
  log('match ended', M.id, why, 'matches', matches.size);
}
setInterval(() => {
  const now = Date.now();
  for (const M of matches.values()) {
    let st = null; try { st = M.game.__serverState(); } catch (e) {}
    if (M.socks.size) M.lastPeople = now;
    if (st && (st.state === 'over' || st.state === 'replay')) { if (!M.endAt) M.endAt = now; }
    if (M.endAt && now - M.endAt > 8000) endMatch(M, 'finished');
    else if (now - M.lastPeople > 90 * 1000) endMatch(M, 'nobody');
    else if (now - M.created > 20 * 60 * 1000) endMatch(M, 'too long');
  }
}, 1000);

/* ---------- 사용량 기록 (Firebase): 경기가 돌아가는 동안의 시간 ---------- */
let fbToken = null, fbRefresh = null, fbExp = 0, pendingSec = 0;
async function fbAuth() {
  if (fbToken && Date.now() < fbExp - 60000) return fbToken;
  let r;
  if (fbRefresh) r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + FIREBASE_API_KEY, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(fbRefresh) });
  else r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FIREBASE_API_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const j = await r.json();
  if (!r.ok) throw new Error('auth ' + r.status + ' ' + JSON.stringify(j).slice(0, 120));
  fbToken = j.idToken || j.id_token; fbRefresh = j.refreshToken || j.refresh_token; fbExp = Date.now() + (+(j.expiresIn || j.expires_in) || 3600) * 1000;
  return fbToken;
}
async function flushUsage() {
  if (!USAGE_ON || pendingSec < 1) return;
  const add = Math.round(pendingSec); pendingSec -= add;
  try {
    const tok = await fbAuth(), month = new Date().toISOString().slice(0, 7);
    const r = await fetch(FIREBASE_DB_URL + '/usage/' + month + '.json?auth=' + encodeURIComponent(tok), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ '.sv': { increment: add } }) });
    if (!r.ok) throw new Error('usage ' + r.status + ' ' + (await r.text()).slice(0, 120));
  } catch (e) { pendingSec += add; log('usage write failed:', e.message); }
}
let lastTick = Date.now();
setInterval(() => { const now = Date.now(); if (matches.size) pendingSec += (now - lastTick) / 1000; lastTick = now; }, 1000);
setInterval(flushUsage, 60 * 1000);
async function shutdown() { log('shutting down'); await flushUsage(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

/* ---------- HTTP · WebSocket ---------- */
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (url.pathname === '/health' || url.pathname === '/') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(JSON.stringify({ ok: true, matches: matches.size, max: MAX_MATCHES })); return; }
  const m = url.pathname.match(/^\/match\/([a-z0-9]{4,12})$/);
  if (m) { const M = matches.get(m[1]); res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(JSON.stringify({ live: !!M && !M.endAt })); return; }
  res.writeHead(404, cors); res.end('not found');
});
server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  const ws = wsAccept(req, socket); if (!ws) return;
  let M = null, uid = null;
  ws.onmessage = text => {
    let msg; try { msg = JSON.parse(text); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'create') {
      const c = msg.cfg || {};
      if (!Array.isArray(c.roster) || !c.roster.length || typeof c.map !== 'number') { ws.send(JSON.stringify({ t: 'error', msg: 'bad cfg' })); return; }
      try { const NM = createMatch({ map: c.map, roster: c.roster.slice(0, 3).map(x => ({ uid: String(x.uid).slice(0, 64), nick: String(x.nick || '?').slice(0, 12), hero: String(x.hero || '') })), bots0: (c.bots0 || []).slice(0, 3).map(String), bots1: (c.bots1 || []).slice(0, 3).map(String), n: +c.n || Date.now() });
        ws.send(JSON.stringify({ t: 'created', match: NM.id })); }
      catch (e) { ws.send(JSON.stringify({ t: 'error', msg: e.message })); }
      return;
    }
    if (msg.t === 'join') {
      const J = matches.get(String(msg.match || ''));
      const id = String(msg.uid || '').slice(0, 64);
      if (!J || J.endAt || !(J.cfg.roster || []).some(x => x.uid === id)) { ws.send(JSON.stringify({ t: 'nomatch' })); return; }
      M = J; uid = id;
      const old = M.socks.get(uid); if (old && old !== ws) { M.socks.delete(uid); try { old.close(); } catch (e) {} }
      M.socks.set(uid, ws);
      try { M.game.__serverJoin(uid); } catch (e) {}
      ws.send(JSON.stringify({ t: 'joined', match: M.id }));
      log('join', M.id, uid.slice(0, 6), 'socks', M.socks.size);
      return;
    }
    if (M && uid && (msg.t === 'in' || msg.t === 'leave')) M.fire('data', { from: uid, data: msg });
  };
  ws.onclose = () => {
    if (M && uid && M.socks.get(uid) === ws) { M.socks.delete(uid); try { M.game.__serverLeave(uid); } catch (e) {} log('leave', M.id, uid.slice(0, 6), 'socks', M.socks.size); }
  };
});
server.listen(PORT, () => log('server listening on', PORT));
