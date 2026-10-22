'use strict';
/* 화면 없이 게임 코드(index.html의 <script>)를 Node.js에서 돌리기 위한 가짜 브라우저 환경 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const noop = () => {};
/* 무엇을 읽든 부르든 다시 자기 자신을 돌려주는 객체 (오디오 등) */
function makeStub() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, k) { if (k === Symbol.toPrimitive) return () => 0; if (k === 'then') return undefined; if (k in t) return t[k]; return proxy; },
    set(t, k, v) { t[k] = v; return true; },
    apply() { return proxy; }, construct() { return proxy; },
  });
  return proxy;
}
function makeCtx(canvas) {
  const store = { canvas, lineWidth: 1, globalAlpha: 1, font: '10px sans-serif' };
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return s => ({ width: String(s || '').length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === 'createRadialGradient' || k === 'createLinearGradient' || k === 'createConicGradient' || k === 'createPattern') return () => ({ addColorStop: noop });
      if (k === 'getImageData' || k === 'createImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 });
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (k === 'isPointInPath' || k === 'isPointInStroke') return () => false;
      if (typeof k === 'string') return noop;
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
class ClassList {
  constructor() { this._s = new Set(); }
  add(...a) { a.forEach(x => this._s.add(x)); }
  remove(...a) { a.forEach(x => this._s.delete(x)); }
  toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; if (on) this._s.add(c); else this._s.delete(c); return on; }
  contains(c) { return this._s.has(c); }
  replace(a, b) { this._s.delete(a); this._s.add(b); }
}
let elSeq = 0;
function makeEl(tag, id) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), nodeName: String(tag || 'div').toUpperCase(), id: id || '', _n: ++elSeq,
    hidden: false, textContent: '', innerHTML: '', innerText: '', value: '', checked: false, disabled: false, width: 300, height: 150,
    className: '', dataset: {}, attributes: {}, children: [], childNodes: [],
    firstChild: null, lastChild: null, firstElementChild: null, nextElementSibling: null, previousElementSibling: null,
    offsetLeft: 0, offsetTop: 0, offsetWidth: 1000, offsetHeight: 560, clientWidth: 1000, clientHeight: 560, scrollLeft: 0, scrollTop: 0, scrollWidth: 1000, scrollHeight: 560,
    style: new Proxy({}, { get: (t, k) => k === 'setProperty' ? ((a, b) => { t[a] = b; }) : k === 'getPropertyValue' ? (a => t[a] || '') : k === 'removeProperty' ? (a => { delete t[a]; }) : (t[k] ?? ''), set: (t, k, v) => { t[k] = v; return true; } }),
    classList: new ClassList(),
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
    getContext() { return this._ctx || (this._ctx = makeCtx(this)); },
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 560, right: 1000, bottom: 560 }),
    getClientRects: () => [],
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; }, removeAttribute(k) { delete this.attributes[k]; }, hasAttribute(k) { return k in this.attributes; },
    append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); return c; }, prepend(...c) { this.children.unshift(...c); },
    removeChild(c) { return c; }, remove: noop, replaceChildren(...c) { this.children = c; }, replaceWith: noop, insertBefore(c) { return c; }, insertAdjacentElement: noop, insertAdjacentHTML: noop, after: noop, before: noop, cloneNode() { return makeEl(tag); },
    querySelector: () => makeEl('div'), querySelectorAll: () => [], getElementsByTagName: () => [], getElementsByClassName: () => [], closest: () => null, contains: () => false, matches: () => false,
    focus: noop, blur: noop, click: noop, select: noop, scrollTo: noop, scrollBy: noop, scrollIntoView: noop, animate: () => ({ finished: Promise.resolve(), cancel: noop }),
    toDataURL: () => 'data:,', toBlob: noop, setPointerCapture: noop, releasePointerCapture: noop, hasPointerCapture: () => false, showModal: noop, close: noop,
  };
  let par = null;
  Object.defineProperty(el, 'parentElement', { get() { return par || (par = makeEl('div')); }, set(v) { par = v; } });
  Object.defineProperty(el, 'parentNode', { get() { return el.parentElement; }, set(v) { par = v; } });
  return el;
}

/* 한 경기 = 게임 코드 한 벌 (서로 영향 없음) */
function createGame(opts) {
  const htmlPath = opts.htmlPath || path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!scripts.length) throw new Error('게임 스크립트를 찾지 못했어요');
  const els = new Map();
  const document = {
    getElementById(id) { if (!els.has(id)) els.set(id, makeEl('div', id)); return els.get(id); },
    createElement: tag => makeEl(tag), createElementNS: (ns, tag) => makeEl(tag), createTextNode: t => ({ textContent: t }),
    createDocumentFragment: () => makeEl('fragment'),
    querySelector: () => makeEl('div'), querySelectorAll: () => [], getElementsByTagName: () => [], getElementsByClassName: () => [],
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
    body: makeEl('body'), documentElement: makeEl('html'), head: makeEl('head'), activeElement: null,
    hidden: false, visibilityState: 'visible', fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]), check: () => true, add: noop },
    hasFocus: () => true, title: '', cookie: '',
  };
  const store = new Map();
  const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(), key: i => [...store.keys()][i] ?? null, get length() { return store.size; } };
  const timers = new Set();
  const ctx = {
    console: opts.console || console, document, localStorage: storage, sessionStorage: storage,
    navigator: { vibrate: noop, clipboard: { writeText: async () => {} }, userAgent: 'node-headless', language: 'ko', maxTouchPoints: 0 },
    location: { search: '', origin: 'http://server', pathname: '/', href: 'http://server/', hash: '' },
    innerWidth: 1000, innerHeight: 560, devicePixelRatio: 1, screen: { width: 1000, height: 560 },
    performance: { now: () => performance.now() },
    setTimeout: (f, t, ...a) => { const h = setTimeout(() => { timers.delete(h); try { f(...a); } catch (e) { ctx.__onError(e); } }, t); timers.add(h); return h; },
    clearTimeout: h => { clearTimeout(h); timers.delete(h); },
    setInterval: (f, t, ...a) => { const h = setInterval(() => { try { f(...a); } catch (e) { ctx.__onError(e); } }, t); timers.add(h); return h; },
    clearInterval: h => { clearInterval(h); timers.delete(h); },
    queueMicrotask, structuredClone, URLSearchParams, URL, TextEncoder, TextDecoder,
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    getComputedStyle: () => new Proxy({}, { get: (t, k) => (k === 'getPropertyValue' ? () => '' : '') }),
    Event: class { constructor(t) { this.type = t; } }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    Image: class { constructor() { this.width = 0; this.height = 0; } set src(v) { this._src = v; } },
    AudioContext: function () { return makeStub(); }, webkitAudioContext: function () { return makeStub(); },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    CanvasRenderingContext2D: function CanvasRenderingContext2D() {}, HTMLCanvasElement: function HTMLCanvasElement() {}, HTMLElement: function HTMLElement() {}, Path2D: function Path2D() { return makeStub(); }, DOMMatrix: function DOMMatrix() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    requestAnimationFrame: f => ctx.setTimeout(() => f(performance.now()), 1000 / 30),
    cancelAnimationFrame: h => ctx.clearTimeout(h),
    alert: noop, confirm: () => false, prompt: () => null, open: noop, focus: noop, scrollTo: noop,
    __headless: true, __onError: e => (opts.onError || console.error)(e),
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  if (opts.setup) opts.setup(ctx);
  vm.createContext(ctx);
  for (const code of scripts) vm.runInContext(code, ctx, { filename: 'index.html', timeout: 20000 });
  ctx.__dispose = () => { for (const h of timers) { clearTimeout(h); clearInterval(h); } timers.clear(); };
  return ctx;
}
module.exports = { createGame };
