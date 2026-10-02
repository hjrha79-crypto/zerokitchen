/*
 * test_order_need.js  — ZEROKITCHEN_WEB_HOME_ORDERNEED_PARITY_BOUNDED_BUILD_V0_1
 *
 * Contract: the Home "현재 부족" card states the current shortage (OrderNeed) from
 * items.current_qty / target_qty / unit only.
 *   need = target − current when both are known and current < target
 *   current ≥ target        -> no order needed
 *   current unknown (null)  -> UNKNOWN, never treated as 0
 * It is display only: drawing it writes nothing and creates no order. It is a different
 * meaning from the pattern notification, the recommendation bar and registered orders.
 *
 * The REAL function bodies are extracted from index.html (brace-matched). No DB, no
 * network. With `--live <items.json>` the same functions are run over a read-only export
 * of the store's items (see the simulation acceptance in the sprint report).
 */

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFn(name) {
  let start = HTML.indexOf('async function ' + name + '(');
  if (start < 0) start = HTML.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  const braceOpen = HTML.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}
const asExpr = (src, name) => '(' + src.replace(new RegExp('^(async )?function ' + name), '$1function') + ')';

const SRC_need = extractFn('_orderNeedOf');
const SRC_render = extractFn('_renderOrderNeed');

// eslint-disable-next-line no-eval
const _orderNeedOf = eval(asExpr(SRC_need, '_orderNeedOf'));

// Renders the real card into a fake element. `db` throws on any use: drawing must not touch it.
function render(_items, _orderRequests) {
  const el = { innerHTML: null };
  const document = { getElementById: id => (id === 'orderNeedCard' ? el : null) };
  const db = new Proxy({}, { get() { throw new Error('db used while rendering the need card'); } });
  // eslint-disable-next-line no-eval
  const _renderOrderNeed = eval(asExpr(SRC_render, '_renderOrderNeed'));
  _renderOrderNeed();
  return el.innerHTML;
}
// The needed rows of the rendered card: item id -> the row's text cells.
function neededRows(html) {
  const out = {};
  const re = /<tr data-need-iid="(\d+)">([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html))) out[m[1]] = m[2].replace(/<div class="need-tag">[\s\S]*?<\/div>/g, '').replace(/<[^>]+>/g, '|').split('|').map(s => s.trim()).filter(Boolean);
  return out;
}
const okIds = html => [...html.matchAll(/data-ok-iid="(\d+)"/g)].map(m => m[1]);

const item = (item_id, item_name, current_qty, target_qty, unit) => ({ item_id, item_name, current_qty, target_qty, unit, order_unit_qty: 1, order_unit_name: '' });

let pass = 0, fail = 0, total = 0;
function check(name, cond, detail) {
  const ok = !!cond; total++;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const show = n => `${n.state}${n.state === 'NEEDED' ? ' ' + n.qty + n.unit : ''}`;

// ---- live mode: read-only export of the store's items -> the three simulation items ----
if (process.argv[2] === '--live') {
  const items = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const html = render(items, []);
  const rows = neededRows(html);
  const find = id => items.find(i => i.item_id === id);
  const n174 = _orderNeedOf(find(174)), n1 = _orderNeedOf(find(1)), n10 = _orderNeedOf(find(10));
  check('LIVE 파인애플(174) 2/6 -> 발주 필요 4캔', n174.state === 'NEEDED' && n174.qty === 4 && n174.unit === '캔' && (rows['174'] || []).join(' ') === '파인애플 2캔 6캔 4캔', `${show(n174)} | card: ${(rows['174'] || []).join(' ')}`);
  check('LIVE 우유(1) 1/3 -> 발주 필요 2박스', n1.state === 'NEEDED' && n1.qty === 2 && n1.unit === '박스' && (rows['1'] || []).join(' ') === '우유 1박스 3박스 2박스', `${show(n1)} | card: ${(rows['1'] || []).join(' ')}`);
  check('LIVE 치즈(10) 8/6 -> 발주 불필요', n10.state === 'SUFFICIENT' && !rows['10'] && okIds(html).includes('10'), `${show(n10)} | in needed table: ${!!rows['10']} | in 발주 불필요 list: ${okIds(html).includes('10')}`);
  const st = {}; for (const i of items) { const s = _orderNeedOf(i).state; st[s] = (st[s] || 0) + 1; }
  console.log(`\nstore items=${items.length} states=${JSON.stringify(st)} needed rows on card=${Object.keys(rows).length}`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${total})`);
  process.exit(fail === 0 ? 0 : 1);
}

// CASE A  current 2 / target 6 / 캔 -> OrderNeed 4캔
{ const n = _orderNeedOf(item(174, '파인애플', 2, 6, '캔'));
  check('CASE A 2/6 캔 -> NEEDED 4캔', n.state === 'NEEDED' && n.qty === 4 && n.unit === '캔', show(n)); }
// CASE B  current 1 / target 3 / 박스 -> OrderNeed 2박스
{ const n = _orderNeedOf(item(1, '우유', 1, 3, '박스'));
  check('CASE B 1/3 박스 -> NEEDED 2박스', n.state === 'NEEDED' && n.qty === 2 && n.unit === '박스', show(n)); }
// CASE C  current 8 / target 6 -> no order needed
{ const n = _orderNeedOf(item(10, '치즈', 8, 6, '개'));
  check('CASE C 8/6 -> SUFFICIENT (no order)', n.state === 'SUFFICIENT' && n.qty === 0, show(n)); }
// CASE D  current null / target 6 -> UNKNOWN, no shortage invented from 0
{ const n = _orderNeedOf(item(2, '양파', null, 6, 'kg'));
  const u = _orderNeedOf(item(2, '양파', undefined, 6, 'kg')), e = _orderNeedOf(item(2, '양파', '', 6, 'kg'));
  check('CASE D null/6 -> UNKNOWN (not 6 short)', [n, u, e].every(x => x.state === 'UNKNOWN' && x.qty === 0), [n, u, e].map(show).join(',')); }
// CASE E  current 6 / target 6 -> no order needed
{ const n = _orderNeedOf(item(3, '마늘', 6, 6, '봉지'));
  check('CASE E 6/6 -> SUFFICIENT', n.state === 'SUFFICIENT' && n.qty === 0, show(n)); }
// CASE F  current > target -> no order needed, never a negative quantity
{ const n = _orderNeedOf(item(4, '핫소스', 10, 6, '개'));
  check('CASE F 10/6 -> SUFFICIENT, qty not negative', n.state === 'SUFFICIENT' && n.qty === 0, show(n)); }
// N1  no goal / invalid data is not a shortage; a known zero stock is a real shortage
{ const s = [item(5, 'a', 0, null, '개'), item(5, 'a', 0, 0, '개'), item(5, 'a', -1, 6, '개'), item(5, 'a', 2, -6, '개'), item(5, 'a', 'x', 6, '개')].map(i => _orderNeedOf(i).state);
  const z = _orderNeedOf(item(5, 'a', 0, 6, '개'));
  check('N1 no target / invalid -> not NEEDED; known 0 -> NEEDED 6', s.join(',') === 'NO_TARGET,NO_TARGET,INVALID,INVALID,INVALID' && z.state === 'NEEDED' && z.qty === 6, s.join(',') + ' | 0/6 ' + show(z)); }
// N2  decimals: exact need, classification by the exact comparison
{ const a = _orderNeedOf(item(6, 'a', 3.1, 5.3, 'kg')), b = _orderNeedOf(item(6, 'a', 2.3, 8.3, 'kg')), c = _orderNeedOf(item(6, 'a', '2', '6', 'kg'));
  check('N2 5.3-3.1 = 2.2, 8.3-2.3 = 6, numeric strings', a.qty === 2.2 && b.qty === 6 && c.state === 'NEEDED' && c.qty === 4, `${a.qty},${b.qty},${show(c)}`); }
// N3  OrderNeed is not OrderPlan: a pack size does not round the need
{ const n = _orderNeedOf({ ...item(7, '치즈', 1, 6, '봉지'), order_unit_qty: 6, order_unit_name: '박스' });
  check('N3 pack 6 does not change the need (5, in 봉지)', n.state === 'NEEDED' && n.qty === 5 && n.unit === '봉지', show(n)); }

// H1  Home card: the three simulation items are told apart, UNKNOWN is not a shortage
const SIM = [item(174, '파인애플', 2, 6, '캔'), item(1, '우유', 1, 3, '박스'), item(10, '치즈', 8, 6, '개'),
  item(2, '양파', null, 6, 'kg'), item(4, '핫소스', 10, 6, '개'), item(9, '신규품목', 0, 0, '개')];
{ const html = render(SIM, []);
  const rows = neededRows(html);
  check('H1 card needed rows = 파인애플 4캔, 우유 2박스 only',
    Object.keys(rows).sort().join(',') === '1,174' && rows['174'].join(' ') === '파인애플 2캔 6캔 4캔' && rows['1'].join(' ') === '우유 1박스 3박스 2박스',
    JSON.stringify(rows));
  check('H2 치즈·핫소스 listed as 발주 불필요 with current/target', okIds(html).sort().join(',') === '10,4' && html.includes('치즈 — 현재 8개 / 목표 6개') && html.includes('발주 불필요 2개'),
    'ok ids=' + okIds(html).join(','));
  check('H3 UNKNOWN shown as 재고 확인 필요, not as a shortage', html.includes('재고 확인 필요 1개') && html.includes('양파') && !rows['2'] && !okIds(html).includes('2'), '');
  check('H4 header counts only real shortages', html.includes('지금 발주 필요 2개 품목') && html.includes('목표 재고가 없는 1개 품목'), ''); }
// H5  nothing short -> says so; never claims a shortage
{ const html = render([item(10, '치즈', 8, 6, '개'), item(2, '양파', null, 6, 'kg')], []);
  check('H5 no shortage -> "지금 발주 필요한 품목 없음"', html.includes('지금 발주 필요한 품목 없음') && Object.keys(neededRows(html)).length === 0 && html.includes('재고 확인 필요 1개'), ''); }
// H6  a registered order is shown as a lifecycle note; the need is not reduced by it
{ const html = render(SIM, [{ id: 1, item_id: 174, status: 'pending', qty: 6, unit: '캔' }, { id: 2, item_id: 1, status: 'ordered', qty: 2, unit: '박스' }]);
  const rows = neededRows(html);
  check('H6 open order noted, need unchanged (4캔 / 2박스)', rows['174'].join(' ') === '파인애플 2캔 6캔 4캔' && rows['1'].join(' ') === '우유 1박스 3박스 2박스' &&
    html.includes('발주 등록됨 6캔') && html.includes('주문 완료 · 입고 대기 2박스'), JSON.stringify(rows)); }
// H7  display only: no DB access, no order creation, no click-to-order in the card
{ const usesDb = /\bdb\s*\./.test(SRC_render) || /\bdb\s*\./.test(SRC_need);
  const creates = /_insertOrderIfNotDup|processRequest|\.rpc\(|onclick=/.test(SRC_render + SRC_need);
  let threw = false; try { render(SIM, []); } catch (e) { threw = true; }
  check('H7 drawing the card writes nothing', !usesDb && !creates && !threw, `usesDb=${usesDb} creates=${creates} threw=${threw}`); }
// H8  the other three meanings are not labelled as the current shortage
{ const notif = extractFn('renderV3Notifications');
  const recoHeads = HTML.split('\n').filter(l => l.includes('v4-suggest-bar-header') || l.includes('<span>💡'));
  const recoAsNeed = recoHeads.some(l => /발주 필요|부족/.test(l)) || HTML.includes('오늘의 발주 추천');
  const notifAsNeed = /발주 필요|부족/.test(notif);
  const falseAllGood = HTML.includes('모든 재고가 충분합니다');
  check('H8 notification / recommendation / order table not labelled as shortage', !recoAsNeed && !notifAsNeed && !falseAllGood && HTML.includes('추천 (재고 0·소진 예측 기준)'),
    `recoAsNeed=${recoAsNeed} notifAsNeed=${notifAsNeed} falseAllGood=${falseAllGood}`); }
// H9  the card is on Home, above the notification, recommendation and order table
{ const pos = id => HTML.indexOf(`id="${id}"`);
  check('H9 card sits at the top of Home', pos('orderNeedCard') > pos('tab-input') && pos('orderNeedCard') < pos('v3NotifContainer') && pos('v3NotifContainer') < pos('suggestBar') && pos('suggestBar') < pos('homeOrderSection'), ''); }

console.log(`\nDB Write: 0 (no client, no network)`);
console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${total})`);
process.exit(fail === 0 ? 0 : 1);
