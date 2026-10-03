/*
 * test_inventory_unknown_render.js — ZEROKITCHEN_WEB_COUNT_MODE_UNKNOWN_ZERO_CLOSURE_V0_1
 *
 * UNKNOWN ≠ ZERO on the REAL render path, in a REAL DOM (headless Chrome):
 *   renderInventory → _renderInvCard → <input class="inv-qty"> → input.value / input.defaultValue,
 * then the person's actions on that DOM (focus, type, blur; the [그대로 맞음] / [재고 점검 시작] buttons)
 * run the real inline handlers (_saveInvQty / _countModeSave …). No fixture builds the input by hand.
 *
 *   current_qty null → empty field, placeholder "재고 모름", not styled/counted as 재고 없음
 *   current_qty 0    → "0"
 *   count mode: null → typed 0 → trusted observation qty_before null → qty_after 0 (trusted zero, need = target)
 *   count mode: null → 4; known 0 → [그대로 맞음] → 0→0 observation
 *   general edit: null → 0 → inv_card_edit (qty_before null), not trusted
 *   untouched unknown rows → nothing; partial failure null → 0 → nothing claimed, retry works
 *
 * The page is about:blank with the functions taken from index.html and a MOCK Supabase client — no network,
 * DB Write 0. Needs Chrome (CHROME env or the default install path).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extractFn(name) {
  let start = HTML.indexOf('async function ' + name + '(');
  if (start < 0) start = HTML.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { const c = HTML[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  return HTML.slice(start, i);
}
const FNS = ['_isKnownQty', '_renderInvCard', 'renderInventory', '_renderCountBar', '_countCtl', '_startCountMode', '_endCountMode',
  '_countModeSave', '_saveInvQty', '_invAuditRetryBtn', '_retryInvAudit', '_invEditFocus', '_invEditBlur', '_dupFingerprint', '_dupKeyOf',
  '_loadInventoryTrust', '_inventoryTrustOf', '_orderNeedOf', '_admittedNeedOf'];
const MARKER = (/const TRUSTED_STOCK_CHECK = '([^']+)';/.exec(HTML) || [])[1];
const COUNT_RAW = (/const COUNT_MODE_RAW_TEXT = '([^']+)';/.exec(HTML) || [])[1];

// The page: the inventory tab's DOM, the app globals these functions read, a mock db, then the real functions.
const HARNESS = `
document.body.innerHTML = \`
  <div id="invAlertBar" style="display:none"><span id="invAlertText"></span></div>
  <div id="invDupBar" style="display:none"><span id="invDupText"></span></div>
  <div id="invCountBar"></div>
  <input id="invSearch" value=""><select id="invFilter"><option value="all">전체</option><option value="low_stock">재고 없음만</option></select>
  <select id="invSort"><option value="name">이름순</option></select><span id="invCount"></span>
  <div class="inv-grid" id="invGrid"></div>\`;
document.getElementById('invSort').value = 'name';
var SID = 1, _vendors = [], _items = [], _itemTrust = new Map(), _invEditActive = null, _dismissedDupFingerprints = new Set();
var TRUSTED_STOCK_CHECK = ${JSON.stringify(MARKER)}, COUNT_MODE_RAW_TEXT = ${JSON.stringify(COUNT_RAW)};
var _countMode = false, _countedIds = new Set();
var _countSaving = new Set(), _invQtySaving = new Set(), _invAuditPending = new Map(), _invAuditRetrying = new Set();
var toasts = []; function showToast(t) { toasts.push(t); }
function _invalidateDepletionCache() {}
// mock Supabase: items + kitchen_operations on a "server"; writes answer per mode list ('ok'|'error'|'reject')
var server = [], ops = [], modes = {}, writes = [], clock = 0;
var db = { from(table) {
  let op = null, payload = null, m = 'ok'; const eqs = {}; let inF = null, gteF = null;
  const next = k => (modes[k] && modes[k].length ? modes[k].shift() : 'ok');
  const b = {
    select() { if (!op) op = 'select'; return b; }, order() { return b; }, limit() { return b; }, maybeSingle() { return b; },
    eq(c, v) { eqs[c] = v; return b; }, in(c, v) { inF = [c, v]; return b; }, gte(c, v) { gteF = [c, v]; return b; },
    update(p) { op = 'update'; payload = p; writes.push({ table, op, payload: p }); m = next('update'); return b; },
    insert(p) { op = 'insert'; payload = p; writes.push({ table, op, payload: p }); m = next('insert'); return b; },
    then(resolve, reject) {
      if (op === 'select') {
        if (table === 'kitchen_operations') {
          let rows = ops.filter(o => Object.entries(eqs).every(([c, v]) => o[c] === v));
          if (inF) rows = rows.filter(o => inF[1].includes(o[inF[0]]));
          if (gteF) rows = rows.filter(o => o[gteF[0]] >= gteF[1]);
          return resolve({ data: rows.map(o => ({ ...o })), error: null });
        }
        const row = server.find(r => r.item_id === eqs.item_id);
        return resolve({ data: row ? { current_qty: row.current_qty } : null, error: null });
      }
      if (m === 'reject') return reject(new Error('request rejected'));
      if (m === 'error') return resolve({ data: null, error: { message: op + ' failed' } });
      if (op === 'update' && table === 'items') { const r = server.find(x => x.item_id === eqs.item_id); if (r) Object.assign(r, payload); }
      if (op === 'insert' && table === 'kitchen_operations') ops.push({ operation_id: 7000 + ops.length, created_at: '2026-10-04T12:' + String(clock++).padStart(2, '0') + ':00Z', ...payload });
      resolve({ data: null, error: null });
    },
  };
  return b;
} };
${FNS.map(extractFn).join('\n')}
// test helpers (page side)
function reset(items, m) {
  _items = items.map(i => ({ ...i })); server = items.map(i => ({ ...i })); ops = []; writes = []; toasts = []; modes = m || {};
  _countMode = false; _countedIds = new Set(); _itemTrust = new Map(); _invAuditPending.clear();
  document.getElementById('invFilter').value = 'all';
  renderInventory();
}
function qtyInput(id) { return document.querySelector('#ic_' + id + ' .inv-qty'); }
function view(id) { const el = qtyInput(id); const card = document.getElementById('ic_' + id);
  return { value: el.value, defaultValue: el.defaultValue, attr: el.getAttribute('value'), placeholder: el.placeholder,
    zeroCls: card.classList.contains('zero'), counted: !!card.querySelector('.inv-count-ctl') && card.querySelector('.inv-count-ctl').innerText.includes('✓ 점검'),
    same: !!Array.from(card.querySelectorAll('button')).find(b => b.innerText === '그대로 맞음') }; }
async function settle() { for (let i = 0; i < 50 && (_countSaving.size || _invQtySaving.size); i++) await new Promise(r => setTimeout(r, 10)); await new Promise(r => setTimeout(r, 20)); }
async function typeAndBlur(id, v) { const el = qtyInput(id); el.focus(); el.value = v; el.blur(); await settle(); }
async function clickSame(id) { Array.from(document.getElementById('ic_' + id).querySelectorAll('button')).find(b => b.innerText === '그대로 맞음').click(); await settle(); }
function clickBar(label) { Array.from(document.querySelectorAll('#invCountBar button')).find(b => b.innerText.includes(label)).click(); }
async function trustOf(id) { await _loadInventoryTrust(); return _itemTrust.get(id) || null; }
'harness ready';
`;

const ITEMS = [
  { item_id: 77, item_name: '스파게티니', unit: '개', current_qty: null, target_qty: 9 },
  { item_id: 78, item_name: '바질', unit: '팩', current_qty: null, target_qty: 2 },
  { item_id: 30, item_name: '피클', unit: '통', current_qty: 0, target_qty: 2 },
  { item_id: 21, item_name: '마늘빵', unit: '박스', current_qty: 2, target_qty: 2 },
];

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
  if (!CHROME) { console.log('RESULT: 0 PASS / 1 FAIL (of 1) — Chrome not found (set CHROME)'); process.exit(1); }
  const PORT = 9400 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-render-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill(); } catch { } setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { } }, 500); };
  try {
    let targets = null;
    for (let i = 0; i < 60 && !targets; i++) { await sleep(250); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { } }
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    let seq = 0; const waiting = new Map(); const exceptions = []; let network = 0;
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] || m.params.exceptionDetails.text);
      else if (m.method === 'Network.requestWillBeSent') network++; });
    const send = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
    await send('Runtime.enable'); await send('Network.enable');
    // headless pages are not focused: without this, el.focus()/el.blur() fire no events and the real onblur never runs
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await ev(HARNESS);
    await ev(`(() => { const i = document.createElement('input'); document.body.appendChild(i); let n = 0; i.onblur = () => n++; i.focus(); i.blur(); i.remove(); if (n !== 1) throw new Error('blur events are not delivered'); return n; })()`);
    const reset = (m = {}) => ev(`reset(${JSON.stringify(ITEMS)}, ${JSON.stringify(m)})`);

    // A / B. render
    await reset();
    const u = await ev('view(77)'), z = await ev('view(30)'), k = await ev('view(21)');
    check('A null renders empty (value "", defaultValue "", no value="0"), placeholder "재고 모름", not styled as 재고 없음',
      u.value === '' && u.defaultValue === '' && u.attr === '' && u.placeholder === '재고 모름' && !u.zeroCls, JSON.stringify(u));
    check('B zero renders "0" (value and defaultValue), styled as 재고 없음', z.value === '0' && z.defaultValue === '0' && z.attr === '0' && z.placeholder === '' && z.zeroCls, JSON.stringify(z));
    check('B known 2 renders "2"', k.value === '2' && k.defaultValue === '2', JSON.stringify(k));
    check('A 재고 없음 count is the known zero only (unknown is not 재고 없음)', await ev(`document.getElementById('invAlertText').textContent`) === '⚠️ 재고 없음 1개');
    await ev(`document.getElementById('invFilter').value = 'low_stock'; renderInventory()`);
    check('A "재고 없음만" filter lists the known zero only', JSON.stringify(await ev(`Array.from(document.querySelectorAll('#invGrid .inv-card')).map(c => c.id)`)) === '["ic_30"]');

    // C. count mode, unknown → typed 0
    await reset();
    await ev(`clickBar('재고 점검 시작')`);
    const c0 = await ev('view(77)');
    check('C count mode: unknown row has no [그대로 맞음] (no recorded number), field still empty', !c0.same && c0.value === '' && c0.defaultValue === '');
    await ev('typeAndBlur(77, "0")');
    const cRows = await ev('ops.filter(o => o.item_id === 77)');
    const cT = await ev('trustOf(77)');
    const cAfter = await ev('view(77)');
    const cNeed = await ev('_admittedNeedOf(_items.find(i => i.item_id === 77))');
    check('C unknown → counted 0: one trusted row (qty_before null, qty_after 0, quantity 0, stock_check, count raw_text), current 0',
      cRows.length === 1 && cRows[0].qty_before === null && cRows[0].qty_after === 0 && cRows[0].quantity === 0 && cRows[0].action_type === 'stock_check' &&
      cRows[0].input_method === 'trusted_stock_check' && cRows[0].raw_text === '재고 점검: 직접 센 수량' && (await ev('server.find(s => s.item_id === 77).current_qty')) === 0, JSON.stringify(cRows));
    check('C trusted zero: trust lastQty 0, need NEEDED 9 (zero is a valid current, not UNKNOWN)', cT && cT.trusted && cT.lastQty === 0 && cNeed.state === 'NEEDED' && cNeed.qty === 9, JSON.stringify({ cT, cNeed }));
    check('C card after the count: "0", ✓ 점검, now offers [그대로 맞음]', cAfter.value === '0' && cAfter.defaultValue === '0' && cAfter.counted && cAfter.same, JSON.stringify(cAfter));
    await ev('renderInventory()');
    const cRe = await ev('view(77)');
    check('C re-render: known zero "0", not "재고 모름"', cRe.value === '0' && cRe.placeholder === '', JSON.stringify(cRe));

    // D. count mode, unknown → 4
    await ev('typeAndBlur(78, "4")');
    const d = await ev('ops.filter(o => o.item_id === 78)');
    check('D unknown → counted 4: trusted row null → 4, trusted at 4', d.length === 1 && d[0].qty_before === null && d[0].qty_after === 4 && d[0].input_method === 'trusted_stock_check' &&
      (await ev('trustOf(78)'))?.lastQty === 4);

    // E. known zero recounted as zero
    await ev(`clickSame(30)`);
    const e = await ev('ops.filter(o => o.item_id === 30)');
    check('E known 0 → [그대로 맞음]: one trusted row 0 → 0, trusted zero', e.length === 1 && e[0].qty_before === 0 && e[0].qty_after === 0 && e[0].input_method === 'trusted_stock_check' && (await ev('trustOf(30)'))?.lastQty === 0, JSON.stringify(e));
    await ev(`clickSame(30)`);
    check('E recounting 0 again -> a second observation', (await ev('ops.filter(o => o.item_id === 30).length')) === 2);

    // F. general edit (not counting): unknown → 0 is a correction
    await reset();
    await ev('typeAndBlur(77, "0")');
    const f = await ev('ops.filter(o => o.item_id === 77)');
    check('F general edit unknown → 0: saved (not a no-op), inv_card_edit, qty_before null, raw "재고 확인 불가→0", not trusted',
      f.length === 1 && f[0].input_method === 'inv_card_edit' && f[0].qty_before === null && f[0].qty_after === 0 && f[0].raw_text === '재고 확인 불가→0' &&
      (await ev('server.find(s => s.item_id === 77).current_qty')) === 0 && (await ev('trustOf(77)')) === null, JSON.stringify(f));
    check('F toast says 재고 모름 → 0, not "0→0"', (await ev('toasts')).includes('스파게티니: 재고 모름→0개'), JSON.stringify(await ev('toasts')));

    // G. untouched unknown rows during a count
    await reset();
    await ev(`clickBar('재고 점검 시작')`);
    await ev(`(async () => { for (const id of [77, 78, 30, 21]) { const el = qtyInput(id); el.focus(); el.blur(); } await settle(); })()`);
    await ev(`clickBar('재고 점검 완료')`);
    check('G count mode on/off with untouched rows (unknown included) -> write 0, no trust', (await ev('writes.length')) === 0 && (await ev('trustOf(77)')) === null && (await ev('view(77)')).value === '');

    // H. partial failure on unknown → 0
    await reset({ update: ['error'] });
    await ev(`clickBar('재고 점검 시작')`);
    await ev('typeAndBlur(77, "0")');
    const h1 = await ev('view(77)');
    check('H update error on unknown → 0: no row, stays unknown (field back to empty), not counted, not trusted',
      (await ev('ops.length')) === 0 && (await ev('server.find(s => s.item_id === 77).current_qty')) === null && h1.value === '' && h1.defaultValue === '' && !h1.counted &&
      (await ev('trustOf(77)')) === null && (await ev(`toasts.some(t => t.includes('점검 수량을 저장하지 못했습니다'))`)), JSON.stringify(h1));
    await ev('typeAndBlur(77, "0")');
    check('H retry by typing 0 again -> trusted zero', (await ev('trustOf(77)'))?.lastQty === 0 && (await ev('view(77)')).counted);
    await reset({ insert: ['reject'] });
    await ev(`clickBar('재고 점검 시작')`);
    await ev('typeAndBlur(77, "0")');
    const h2 = await ev('view(77)');
    check('H audit rejected on unknown → 0: stock 0 saved but no trusted row, not counted, partial message',
      (await ev('ops.length')) === 0 && (await ev('server.find(s => s.item_id === 77).current_qty')) === 0 && !h2.counted && (await ev('trustOf(77)')) === null &&
      (await ev(`toasts.some(t => t.includes('점검 기록을 남기지 못했습니다'))`)), JSON.stringify(h2));
    check('H after the audit failure the row shows the saved 0 and offers [그대로 맞음]', h2.value === '0' && h2.same);
    await ev('clickSame(77)');
    const h3 = await ev('ops.filter(o => o.item_id === 77)');
    check('H retry with [그대로 맞음] -> trusted zero (0 → 0)', h3.length === 1 && h3[0].qty_before === 0 && h3[0].qty_after === 0 && (await ev('trustOf(77)'))?.lastQty === 0 && (await ev('view(77)')).counted);

    check('page: no exceptions, no network request', exceptions.length === 0 && network === 0, `${exceptions.join(' | ')} network=${network}`);
    try { ws.close(); } catch { }
  } catch (e) {
    fail++; console.log('FAIL  harness error  — ' + e.message);
  } finally { cleanup(); }
  console.log(`\nDB Write: 0 (mock client in about:blank, no network)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  setTimeout(() => process.exit(fail ? 1 : 0), 700);
})();
