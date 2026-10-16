/*
 * test_human_direct_order.js — Human Direct Order Self-Recording (ZEROKITCHEN_HUMAN_DIRECT_ORDER_SELF_RECORDING_VERTICAL_SLICE_V0_1)
 *
 * "하드롤은 팍스푸드에 카톡으로 주문했어" → the 발주표 plan is found, ONE confirmation, then the existing trusted writer
 * (CONFIRM_ORDER in place on the pending plan, or CREATE_AND_CONFIRM_ORDER when there is no plan). Nothing is written before
 * [기록하기]. Order number / price / ETA stay unknown. Mismatches stop without a write.
 * REAL functions from index.html; MOCK db + MOCK writer that behaves like confirm_order_supply. DB Write 0.
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
const block = (from, to) => { const a = HTML.indexOf(from), b = HTML.indexOf(to, a); if (a < 0 || b < 0) throw new Error('block not found: ' + from); return HTML.slice(a, b); };
const SRC = [constLine('_agentNum'), constLine('_AGENT_SOURCE_LABEL'), constLine('_lpUnitNorm'), block('const _WRITER_FIELDS = {', 'function _writerFields('),
  'let _planRecon = { sid: null, map: new Map() };', constLine('_PLAN_RECON_MS'),
  ...['_writerFields', '_lpResolveItem', '_lpUnitResolve', '_loadPlanRecon', '_isReconciledPlan', '_actionablePlans', '_insertOrderIfNotDup'].map(extractFn),
  block('const _HDO_DONE_RE', '// 라우터 진입')].join('\n');

let pass = 0, fail = 0;
const ok = (id, cond, note) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${id}${note ? ' — ' + note : ''}`); };

const ITEMS = [
  { item_id: 20, store_id: 1, item_name: '하드롤', unit: '박스', vendor_id: 7 },
  { item_id: 32, store_id: 1, item_name: '파마산 치즈', unit: '봉지', vendor_id: 5 },
  { item_id: 77, store_id: 1, item_name: '스파게티니', unit: '개', vendor_id: 4 },
  { item_id: 52, store_id: 1, item_name: '휘핑크림', unit: '개', vendor_id: 5 },
];
const VENDORS = [{ vendor_id: 4, vendor_name: '쿠팡' }, { vendor_id: 5, vendor_name: '네이버' }, { vendor_id: 7, vendor_name: '팍스푸드' }];

function env(rows, opts = {}) {
  const tables = { order_requests: rows.map(r => ({ store_id: 1, unit: '박스', created_at: '2026-10-15', ...r })), order_supply: [] };
  const dbWrites = [], writer = [], said = [], cards = [], attached = [];
  let n = 0;
  const db = {
    rpc: async () => ({ data: opts.recon || [], error: null }),
    from(table) {
      const f = []; let inF = null, ins = null;
      const b = { select() { return b; }, eq(c, v) { f.push([c, v]); return b; }, in(c, a) { inF = [c, a]; return b; }, limit() { return b; }, order() { return b; },
        insert(r) { ins = r; dbWrites.push({ table, r }); return b; }, update(r) { dbWrites.push({ table, r }); return b; },
        then(res) {
          if (ins) return res({ data: [ins], error: null });
          let out = (tables[table] || []).slice();
          for (const [c, v] of f) out = out.filter(r => r[c] === v);
          if (inF) out = out.filter(r => inF[1].includes(r[inF[0]]));
          res({ data: out.map(r => ({ ...r })), error: null });
        } };
      return b;
    },
  };
  // mock server writer = confirm_order_supply / create_and_confirm_order_supply semantics (HUMAN_CONFIRMED, actor from the login)
  const _writerAct = async (action, fields) => {
    writer.push({ action, fields });
    if (action === 'CONFIRM_ORDER') {
      const o = tables.order_requests.find(x => x.id === fields.order_id);
      if (tables.order_supply.some(s => s.order_request_id === o.id)) return { code: 'ALREADY_CONFIRMED' };
      o.status = 'ordered';
      tables.order_supply.push({ order_request_id: o.id, verification: 'HUMAN_CONFIRMED', supply_source: fields.supply_source || null, external_order_ref: null, ordered_at: null, evidence: 'human-writer action x; note: ' + fields.note });
      return { code: 'CONFIRMED', order_id: o.id };
    }
    if (action === 'CREATE_AND_CONFIRM_ORDER') {
      const id = 900 + tables.order_requests.length;
      tables.order_requests.push({ id, store_id: 1, item_id: fields.item_id, qty: fields.ordered_qty, unit: fields.unit, status: 'ordered' });
      tables.order_supply.push({ order_request_id: id, verification: 'HUMAN_CONFIRMED', supply_source: fields.supply_source, external_order_ref: null, evidence: 'note: ' + fields.note });
      return { code: 'CREATED_AND_CONFIRMED', order_id: id };
    }
  };
  const ctx = { console, db, SID: 1, _items: ITEMS, _vendors: VENDORS, _writerReady: opts.ready !== false, _writerCaps: opts.caps || ['CONFIRM_ORDER_IDENTITY', 'CREATE_AND_CONFIRM_ORDER'],
    _withTimeout: p => p, _ruleMapItem: () => null, _newActionId: () => 'g' + (++n), _writerAct, _writerResultMessage: b => b.code,
    addResult: (raw, msg, type) => said.push({ raw, msg, type }), _purchaseAttach: h => attached.push(h), _lpSystemCard: m => cards.push(m) };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.f = { _hdoIntentOf, _hdoIntake, _hdoDecide, _insertOrderIfNotDup }; this.gates = _hdoGates;', ctx);
  const press = async (yes = true) => { const id = Object.keys(ctx.gates).pop(); await ctx.f._hdoDecide(id, yes, null); };
  return { f: ctx.f, tables, dbWrites, writer, said, cards, attached, press, ctx };
}
const PLAN153 = { id: 153, item_id: 20, item_name: '하드롤', qty: 3, unit: '박스', status: 'pending', vendor_id: 7 };

(async () => {
  // ── intent ──────────────────────────────────────────────────────────────
  const e0 = env([]);
  const I = s => e0.f._hdoIntentOf(s);
  const a = I('하드롤은 팍스푸드에 카톡으로 주문했어');
  ok('INTENT-A "하드롤은 팍스푸드에 카톡으로 주문했어" → 하드롤 / PAX_FOOD / 카카오톡 / qty none', a && a.name === '하드롤' && a.source === 'PAX_FOOD' && a.channel === '카카오톡' && a.qty === null, JSON.stringify(a));
  const b = I('하드롤 3박스 카톡으로 주문했어');
  ok('INTENT-B "하드롤 3박스 카톡으로 주문했어" → qty 3 박스', b && b.name === '하드롤' && b.qty === 3 && b.unit === '박스' && b.channel === '카카오톡', JSON.stringify(b));
  const c = I('하드롤은 내가 직접 주문했어');
  ok('INTENT-C "하드롤은 내가 직접 주문했어" → channel 직접', c && c.name === '하드롤' && c.channel === '직접' && !c.source, JSON.stringify(c));
  const d = I('파마산은 네이버에서 주문했어'), e = I('스파게티니 쿠팡에서 주문했어');
  ok('INTENT-D/E 네이버·쿠팡 → NAVER / COUPANG', d && d.name === '파마산' && d.source === 'NAVER' && e && e.name === '스파게티니' && e.source === 'COUPANG', JSON.stringify([d, e]));
  ok('INTENT-NOT order requests / questions / negatives are not reports', ['하드롤 3박스 주문해줘', '하드롤 주문했어?', '하드롤 아직 주문 안 했어', '하드롤 주문할게', '하드롤 3박스 남았어', '토요일 도착으로 하드롤 3박스'].every(s => I(s) === null));

  // ── H1–H6 exact pending plan ─────────────────────────────────────────────
  const h = env([PLAN153]);
  await h.f._hdoIntake('하드롤은 팍스푸드에 카톡으로 주문했어', I('하드롤은 팍스푸드에 카톡으로 주문했어'));
  ok('H1 exact pending 3박스 → one confirm question with 기록하기 / 아니요', /발주표에 하드롤 3박스가 있습니다/.test(h.said[0]?.msg) && /팍스푸드 카카오톡으로 직접 주문한 것으로 기록할까요/.test(h.said[0]?.msg) && /기록하기/.test(h.attached[0]) && /아니요/.test(h.attached[0]), h.said[0]?.msg);
  ok('H2 before confirm → writer calls 0, DB writes 0', h.writer.length === 0 && h.dbWrites.length === 0);
  await h.press(true);
  ok('H3 confirm → exactly one trusted writer call: CONFIRM_ORDER on plan #153 (in place), supply PAX_FOOD, note carries channel + statement', h.writer.length === 1 && h.writer[0].action === 'CONFIRM_ORDER' && h.writer[0].fields.order_id === 153 && h.writer[0].fields.supply_source === 'PAX_FOOD' && /대표 직접 주문 · 카카오톡 · "하드롤은 팍스푸드에 카톡으로 주문했어"/.test(h.writer[0].fields.note), JSON.stringify(h.writer[0]));
  ok('H4 plan #153 is now the actual order (same row → nothing left actionable, no second row)', h.tables.order_requests.length === 1 && h.tables.order_requests[0].status === 'ordered' && h.tables.order_supply.length === 1);
  ok('H5 history: the same row keeps its id / qty / created_at (no delete, no new plan)', h.tables.order_requests[0].id === 153 && h.tables.order_requests[0].qty === 3 && h.dbWrites.length === 0);
  ok('H6 actual order is HUMAN_CONFIRMED with a supplier → counted as open supply', h.tables.order_supply[0].verification === 'HUMAN_CONFIRMED' && h.tables.order_supply[0].supply_source === 'PAX_FOOD');
  ok('H11b success message: recorded, 발주표 처리, 입고 대기, number/ETA unknown (no internal ids)', /하드롤 3박스를 팍스푸드 카카오톡 주문으로 기록했습니다/.test(h.cards[0]) && /발주표에서는 처리했고/.test(h.cards[0]) && /입고 대기/.test(h.cards[0]) && /주문번호와 도착 예정일은 아직 확인되지 않았습니다/.test(h.cards[0]) && !/#\d|order_|supply/.test(h.cards[0]), h.cards[0]);
  ok('H12–H14 order number / price / ETA stay unknown (not sent, not invented)', !('external_order_ref' in h.writer[0].fields) && !('ordered_at' in h.writer[0].fields) && h.tables.order_supply[0].external_order_ref === null);

  // ── H7 new order request for the same item → duplicate guard sees the actual order
  const dup = await h.f._insertOrderIfNotDup({ store_id: 1, item_id: 20, item_name: '하드롤', qty: 3, unit: '박스', status: 'pending' });
  ok('H7 "하드롤 3박스 주문해줘" afterwards → dedup finds the ordered actual (no new plan)', dup.skipped && dup.existing.status === 'ordered' && dup.existing.id === 153);

  // ── H8 same statement again → no second actual
  const before = h.writer.length;
  await h.f._hdoIntake('하드롤은 팍스푸드에 카톡으로 주문했어', I('하드롤은 팍스푸드에 카톡으로 주문했어'));
  ok('H8 same statement again → "이미 주문 기록이 있어요", writer calls unchanged, actual rows still 1', /이미 주문 기록이 있어요/.test(h.said[1]?.msg) && h.writer.length === before && h.tables.order_supply.length === 1, h.said[1]?.msg);
  const g2 = env([PLAN153]);
  await g2.f._hdoIntake('하드롤 3박스 카톡으로 주문했어', I('하드롤 3박스 카톡으로 주문했어'));
  await g2.press(true); await g2.press(true);
  ok('H8b double-press on the same card → one writer call', g2.writer.length === 1);

  // ── H9 qty mismatch / H10 supplier mismatch
  const m = env([PLAN153]);
  await m.f._hdoIntake('하드롤 2박스 카톡으로 주문했어', I('하드롤 2박스 카톡으로 주문했어'));
  ok('H9 plan 3 vs report 2 → review message, no confirm button, no write', /수량이 달라 기록하지 않았어요/.test(m.said[0]?.msg) && m.attached.length === 0 && m.writer.length === 0, m.said[0]?.msg);
  const s = env([PLAN153]);
  await s.f._hdoIntake('하드롤 쿠팡에서 주문했어', I('하드롤 쿠팡에서 주문했어'));
  ok('H10 plan 팍스푸드 vs report 쿠팡 → the single question names the mismatch; no write before confirm', /발주표에는 팍스푸드로 되어 있어요\. 쿠팡에서 주문하신 걸로 기록할까요/.test(s.said[0]?.msg) && s.writer.length === 0, s.said[0]?.msg);
  await s.press(false);
  ok('H10b [아니요] → nothing written', s.writer.length === 0 && /기록하지 않았어요/.test(s.cards[0]));

  // ── H11 no pending plan
  const np = env([]);
  await np.f._hdoIntake('휘핑크림 네이버에서 12개 주문했어', I('휘핑크림 네이버에서 12개 주문했어'));
  ok('H11 no plan + qty + supplier → confirm card for a new actual order', /계획은 없어요/.test(np.said[0]?.msg) && /네이버로 직접 주문한 휘핑크림 12개를 실제 주문으로 기록할까요/.test(np.said[0]?.msg) && np.writer.length === 0, np.said[0]?.msg);
  await np.press(true);
  ok('H11c confirm → CREATE_AND_CONFIRM_ORDER (item, qty 12, 개, NAVER, confirm, note) once', np.writer.length === 1 && np.writer[0].action === 'CREATE_AND_CONFIRM_ORDER' && np.writer[0].fields.ordered_qty === 12 && np.writer[0].fields.unit === '개' && np.writer[0].fields.supply_source === 'NAVER' && np.writer[0].fields.confirm === true);
  const nq = env([]);
  await nq.f._hdoIntake('휘핑크림 네이버에서 주문했어', I('휘핑크림 네이버에서 주문했어'));
  ok('H11d no plan and no qty → asks for qty + supplier, no write', /수량과 주문처를 함께 말해 주시면/.test(nq.said[0]?.msg) && nq.writer.length === 0 && nq.attached.length === 0);

  // ── guards: two plans / not logged in / reconciled plan ignored
  const two = env([PLAN153, { ...PLAN153, id: 160, qty: 2 }]);
  await two.f._hdoIntake('하드롤 카톡으로 주문했어', I('하드롤 카톡으로 주문했어'));
  ok('GUARD two pending plans → no button, asks to tidy 발주표', /계획이 2개 있어요/.test(two.said[0]?.msg) && two.attached.length === 0 && two.writer.length === 0);
  const lo = env([PLAN153], { ready: false });
  await lo.f._hdoIntake('하드롤 카톡으로 주문했어', I('하드롤 카톡으로 주문했어'));
  ok('GUARD not logged in (writer not ready) → explains login, no write (no client-side actor)', /입고 기록 로그인이 필요해요/.test(lo.said[0]?.msg) && lo.writer.length === 0);
  const rc = env([{ ...PLAN153, id: 155, item_id: 77, item_name: '스파게티니', qty: 12, unit: '개', vendor_id: 4 }], { recon: [{ plan_order_id: 155, actual_order_id: 158 }] });
  await rc.f._hdoIntake('스파게티니 쿠팡에서 주문했어', I('스파게티니 쿠팡에서 주문했어'));
  ok('GUARD a plan already fulfilled by an actual order is not offered again', rc.attached.length === 0 && rc.writer.length === 0 && /계획이 없어요/.test(rc.said[0]?.msg || ''), rc.said[0]?.msg);
  const stale = env([PLAN153]);
  await stale.f._hdoIntake('하드롤 카톡으로 주문했어', I('하드롤 카톡으로 주문했어'));
  stale.tables.order_requests[0].qty = 4;   // 발주표 changed between the question and the press
  await stale.press(true);
  ok('GUARD 발주표 changed after the question → not recorded', stale.writer.length === 0 && /그 사이 발주표가 바뀌어/.test(stale.cards[0]));

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
