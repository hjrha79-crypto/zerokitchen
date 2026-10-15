/*
 * test_purchase_unit_display.js — Store1 Purchase Unit Display P1 (ZEROKITCHEN_STORE1_PURCHASE_UNIT_DISPLAY_P1_FIX_V0_1)
 *
 * Display only: an item whose purchase unit (items.order_unit_name) differs from its inventory unit with a 1:1 pack
 * (order_unit_qty = 1) shows "치즈 8개 (8봉)" on the 발주표 and in the copied order text. Stored qty / unit and every
 * calculation stay the same; packs (order_unit_qty ≥ 2), no purchase unit and same-unit items keep their old display.
 * REAL functions from index.html, MOCK DOM/clipboard — DB Write 0.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function extractFn(name) {
  let start = HTML.indexOf('async function ' + name + '(');
  if (start < 0) start = HTML.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { const c = HTML[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  return HTML.slice(start, i);
}
const constLine = name => { const m = new RegExp(`const ${name} = [^\\n]+`).exec(HTML); if (!m) throw new Error('const not found: ' + name); return m[0]; };
const SRC = [constLine('_fmtQty'), constLine('_lpUnitNorm'),
  ...['_purchaseUnitNote', '_renderTableRow', '_draftAge', '_copyVendorOrder', '_copyVendorMerged', '_copyVendorGroup', '_copyAllGroups', '_copyAllMerged'].map(extractFn)].join('\n');

let pass = 0, fail = 0;
const ok = (id, cond, note) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${id}${note ? ' — ' + note : ''}`); };

const ITEMS = [
  { item_id: 10, item_name: '치즈', unit: '개', order_unit_name: '봉', order_unit_qty: 1 },          // D1: 1:1 purchase unit 봉
  { item_id: 77, item_name: '스파게티니', unit: '개', order_unit_name: '개', order_unit_qty: 1 },    // D2: same unit
  { item_id: 30, item_name: '양파', unit: '개', order_unit_name: '망', order_unit_qty: 10 },        // D3: pack (10개 = 1망)
  { item_id: 20, item_name: '하드롤', unit: '박스', order_unit_name: '', order_unit_qty: 1 },       // D4: no purchase unit
];
function env(cache) {
  const clip = [], inputs = {}, sheet = { innerHTML: '' };
  const document = {
    getElementById: id => id === 'copySheetBody' ? sheet : inputs[id] || (/^(orec|pqty)_/.test(id) ? null : { classList: { add() {}, remove() {} } }),
    querySelectorAll: () => [], querySelector: () => null,
  };
  const ctx = { console, document, _items: ITEMS.map(x => ({ ...x })), showToast: () => {}, requestAnimationFrame: f => f(), setTimeout: f => f(),
    navigator: { clipboard: { writeText: async t => { clip.push(t); } } }, window: { _textOrderCache: cache || [] },
    _markRowOrdered: async () => {}, _closeCopySheet: () => {}, _updateTextOrderCache: () => {} };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.f = { _purchaseUnitNote, _renderTableRow, _copyVendorOrder, _copyVendorMerged, _copyVendorGroup, _copyAllGroups, _copyAllMerged };', ctx);
  return { f: ctx.f, clip, inputs, sheet };
}

(async () => {
  const e = env();
  ok('D1 치즈 개/봉/1 qty 8 → " (8봉)"', e.f._purchaseUnitNote(10, 8, '개') === ' (8봉)');
  ok('D2 purchase unit = inventory unit → no duplicate unit', e.f._purchaseUnitNote(77, 12, '개') === '');
  ok('D3 pack item (order_unit_qty ≥ 2) → helper adds nothing (existing pack rules unchanged)', e.f._purchaseUnitNote(30, 20, '개') === '');
  ok('D4 no order_unit_name → unchanged', e.f._purchaseUnitNote(20, 3, '박스') === '' && e.f._purchaseUnitNote(999, 3, '개') === '');

  const row = r => e.f._renderTableRow({ status: 'pending', order_id: 156, stockQty: 8, checked: true, created_at: null, ...r });
  const cheeseRow = row({ item_id: 10, name: '치즈', orderQty: 8, unit: '개' });
  const plainRows = [row({ item_id: 77, name: '스파게티니', orderQty: 12, unit: '개' }), row({ item_id: 30, name: '양파', orderQty: 20, unit: '개' }), row({ item_id: 20, name: '하드롤', orderQty: 3, unit: '박스' })];
  ok('D5 발주표 row: 치즈 8개 (8봉), stored qty cell still 8', /data-col="order"[^>]*>8<span[^>]*>개 \(8봉\)<\/span>/.test(cheeseRow));
  ok('D5b 발주표 rows without a 1:1 purchase unit keep the old cell (no parentheses)', plainRows.every(h => !/\(/.test((h.match(/data-col="order".*?<span[^>]*>([^<]*)<\/span><\/td>/) || [])[1] ?? '(')));

  // [발주] 거래처 추천 복사 (orec_ inputs)
  const c1 = env();
  for (const [id, qty, unit, name] of [[10, 8, '개', '치즈'], [30, 20, '개', '양파'], [77, 12, '개', '스파게티니']])
    c1.inputs['orec_' + id] = { value: String(qty), dataset: { name, unit, itemId: String(id) } };
  await c1.f._copyVendorOrder('식봄', [10, 30, 77]);
  ok('D6 [발주] copy: 치즈 8개 (8봉) / 양파 20개 (2망) pack rule unchanged / 스파게티니 12개', c1.clip[0] === '[발주]\n치즈 8개 (8봉)\n양파 20개 (2망)\n스파게티니 12개', JSON.stringify(c1.clip[0]));

  // 발주표 거래처별/그룹/전체 복사 (_textOrderCache)
  const cache = [{ item_id: 10, name: '치즈', qty: 8, unit: '개', vendor: '식봄' }, { item_id: 20, name: '하드롤', qty: 3, unit: '박스', vendor: '식봄' }];
  const c2 = env(cache); await c2.f._copyVendorMerged('식봄');
  const c3 = env(cache); await c3.f._copyVendorGroup('식봄', [10, 20]);
  const c4 = env(cache); await c4.f._copyAllGroups();
  const c5 = env(cache); c5.f._copyAllMerged();
  ok('D6b 발주표 copies keep 봉 (거래처별 / 그룹 / 전체 / 전체 시트), other items unchanged',
    c2.clip[0] === '치즈 8개 (8봉)\n하드롤 3박스' && c3.clip[0] === '치즈 8개 (8봉)\n하드롤 3박스' && /\[식봄\]\n치즈 8개 \(8봉\)\n하드롤 3박스/.test(c4.clip[0] || '') && /치즈 8개 \(8봉\)<\/div>/.test(c5.sheet.innerHTML) && /하드롤 3박스<\/div>/.test(c5.sheet.innerHTML),
    JSON.stringify([c2.clip[0], c3.clip[0], c4.clip[0]]));

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
