/*
 * test_dup_unknown.js — duplicate cleanup (더하기 / 바꾸기): UNKNOWN stock is not 0 (v0.5)
 *
 * The duplicate cleanup card used to coerce current_qty with Number(): an UNKNOWN (null) count showed as "0", the
 * total added it as 0, and 바꾸기 showed "null개". It now reuses _isKnownQty and the existing "재고 모름" wording:
 * unknown → "재고 모름", a known 0 → "0", and any unknown makes the total "재고 모름". The truth guard stays on the
 * server (merge_duplicate_items refuses with STOCK_UNKNOWN); the app changes nothing locally until MERGED.
 * REAL functions from index.html, fake DOM, MOCK db — DB Write 0.
 */
const fs = require('fs');
const path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extractFn(name) {
  let start = HTML.indexOf('async function ' + name + '(');
  if (start < 0) start = HTML.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { const c = HTML[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  return HTML.slice(start, i);
}
const asExpr = (src, name) => '(' + src.replace(new RegExp('^(async )?function ' + name), '$1function') + ')';
const constLine = name => (new RegExp(`const ${name} = [^\\n]+`).exec(HTML) || [''])[0];

let pass = 0, fail = 0;
function check(name, ok, detail = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`); }

function makeEnv(items, rpcAnswer) {
  const calls = [], toasts = [];
  const db = {
    async rpc(name, args) { calls.push({ rpc: name, args: JSON.parse(JSON.stringify(args)) }); return rpcAnswer ? rpcAnswer(name, args) : { data: null, error: { message: 'no' } }; },
    from(table) { const b = { select: () => b, eq: () => b, delete: () => { calls.push({ write: table }); return b; }, update: () => { calls.push({ write: table }); return b; },
      insert: () => { calls.push({ write: table }); return b; }, then: r => r({ data: [], error: null }) }; return b; },
  };
  const SID = 1; const showToast = t => toasts.push(t);
  let _items = items.map(i => ({ ...i }));
  const wrap = { innerHTML: '', querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  const panel = { style: {}, querySelector: () => wrap, scrollIntoView() {} };
  const document = { getElementById: id => (id === 'reviewPanel' ? panel : null), querySelector: () => null };
  const console = { log() {}, warn() {}, error() {} };
  let _dupOrigHTML = ''; const _dismissedDupFingerprints = new Set();
  const _dupCleanupClickHandler = () => {}, renderInventory = () => {}, _saveAlias = () => {};
  for (const c of ['_DELETE_HISTORY_MSG', '_DELETE_UNAVAILABLE_MSG']) eval(constLine(c).replace('const ', 'var '));
  const f = {};
  for (let k = 0; k < 2; k++) {
    for (const n of ['_isKnownQty', '_dupQtyText', '_dupFingerprint', '_dupKeyOf', '_showDupCleanup', '_mergeItemsOnServer', '_replaceDup', '_mergeDup']) f[n] = eval(asExpr(extractFn(n), n));
    // eslint-disable-next-line no-unused-vars
    var _isKnownQty = f._isKnownQty, _dupQtyText = f._dupQtyText, _dupFingerprint = f._dupFingerprint, _dupKeyOf = f._dupKeyOf,
      _showDupCleanup = f._showDupCleanup, _mergeItemsOnServer = f._mergeItemsOnServer;
  }
  void SID; void showToast; void document; void console; void _dupOrigHTML; void _dismissedDupFingerprints; void _dupCleanupClickHandler; void renderInventory; void _saveAlias;
  return { f, calls, toasts, wrap, items: () => _items };
}
const card = async items => { const e = makeEnv(items); await e.f._showDupCleanup(); return e.wrap.innerHTML.replace(/\s+/g, ' '); };
const it = (id, qty, unit = '개', name = '양파') => ({ item_id: id, item_name: name, unit, current_qty: qty });

(async () => {
  // A. unknown is never "0"
  const a = await card([it(10, 2), it(11, null)]);
  check('A UNKNOWN source → "2개 + 재고 모름", never 0 / null / NaN', a.includes('2개 + 재고 모름') && !/\b0개|null|NaN/.test(a), a.slice(0, 400));
  check('A any unknown → total "= 재고 모름" and 더하기 (재고 모름) (not 2개)', a.includes('= 재고 모름') && a.includes('더하기 (재고 모름)') && !a.includes('= 2개'), a.slice(0, 400));
  check('A latest (chosen for 바꾸기) unknown → "바꾸기 (재고 모름)", not "null개"', a.includes('바꾸기 (재고 모름)') && !a.includes('null개'), a.slice(0, 400));
  // B. a known 0 is 0
  const b = await card([it(10, 0), it(11, 3)]);
  check('B known 0 → "0개 + 3개 = 3개", 더하기 (3개), 바꾸기 (3개)', b.includes('0개 + 3개 = 3개') && b.includes('더하기 (3개)') && b.includes('바꾸기 (3개)'), b.slice(0, 400));
  const b2 = await card([it(10, 2), it(11, 0)]);
  check('B known 0 as the latest → "바꾸기 (0개)" (a real 0 stays 0)', b2.includes('바꾸기 (0개)') && b2.includes('2개 + 0개 = 2개'), b2.slice(0, 400));
  const u = await card([it(10, null), it(11, 3, 'kg')]);
  check('unit-mismatch card also shows "재고 모름 + 3kg" (no 0)', u.includes('재고 모름 + 3kg') && !u.includes('0개'), u.slice(0, 400));
  check('helper: _dupQtyText(null|undefined|"") = 재고 모름, (0) = 0개, ("2.5") = 2.5개',
    ['재고 모름', '재고 모름', '재고 모름', '0개', '2.5개'].join() === [null, undefined, '', 0, '2.5'].map(v => makeEnv([]).f._dupQtyText(v, '개')).join());

  // C. REPLACE with an UNKNOWN source: the server refuses → nothing changes locally
  const c = makeEnv([it(10, 2), it(11, 3), it(12, null)], () => ({ data: { code: 'STOCK_UNKNOWN', item_id: 12 }, error: null }));
  const before = JSON.stringify(c.items());
  await c.f._replaceDup('양파');
  const call = c.calls.find(x => x.rpc === 'merge_duplicate_items');
  check('C REPLACE with an UNKNOWN source → one merge_duplicate_items(REPLACE, sources [11,12]); STOCK_UNKNOWN → "모름은 0이 아닙니다" toast, local items unchanged, no client write',
    call && call.args.p_mode === 'REPLACE' && JSON.stringify(call.args.p_source_item_ids) === '[11,12]' &&
    c.toasts.some(t => t.includes('재고를 모르는 품목이 있어 합치지 않았습니다 (모름은 0이 아닙니다)')) && JSON.stringify(c.items()) === before && !c.calls.some(x => x.write),
    JSON.stringify({ toasts: c.toasts, items: c.items() }));
  // D. known sources only → normal REPLACE
  const d = makeEnv([it(10, 2), it(11, 3), it(12, 4)], () => ({ data: { code: 'MERGED', target_item_id: 10, current_qty: 4, removed: [11, 12] }, error: null }));
  await d.f._replaceDup('양파');
  check('D known sources → MERGED: target takes the server qty (4), sources removed locally, no client write',
    JSON.stringify(d.items()) === JSON.stringify([it(10, 4)]) && !d.calls.some(x => x.write), JSON.stringify(d.items()));

  console.log('\nDB Write: 0 (mock client only, no network/supabase import)');
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL harness ' + e.stack); process.exit(1); });
