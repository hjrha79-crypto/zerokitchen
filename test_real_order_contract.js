/*
 * test_real_order_contract.js — Real Order canonical contract on the Web (WEB-RO-01..08 + the three writer entry points)
 *
 * "쿠팡에서 우유 2박스를 주문했습니다 · 10월 5일 14:32 주문 · 배송 중, 도착 예정 … · 배송 완료지만 아직 입고 확인 전" —
 * each part only when the server has evidence for it; nothing invented when it does not.
 * REAL from index.html: deriveAgentActions, _agentOrderSupplier, _fmtKst, _agentDeliveryLine, _safeOrderUrl, _agentCardHtml,
 * _confirmActualOrder, _agentRegisterExternalOrder, _agentDeliveryUpdate, _writerFields, _supplierOptions.
 * MOCK: _zkForm (the person's answers), _writerAct (records the envelope), db (supplier list), DOM. No network.
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
function extractConstBlock(name) {
  const start = HTML.indexOf(`const ${name} = {`);
  let depth = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { const c = HTML[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break; } } }
  return HTML.slice(start, i) + ';';
}
const constLine = n => { const m = new RegExp(`const ${n} = [^\\n]+`).exec(HTML); if (!m) throw new Error('const not found: ' + n); return m[0]; };

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + String(detail).slice(0, 500) : ''}`); };
const J = x => JSON.stringify(x);

const FNS = ['_asideProposalLine', '_orderNeedOf', '_admittedNeedOf', '_draftAge', '_agentOrderSupplier', '_fmtKst', '_agentDeliveryLine', '_safeOrderUrl', 'deriveAgentActions', '_agentCardHtml',
  '_confirmActualOrder', '_agentConfirmOrder', '_agentRegisterExternalOrder', '_agentDeliveryUpdate', '_writerFields', '_supplierOptions'];
const CODE = ['AGENT_PRIORITY', 'AGENT_MAX_CHECKS', '_AGENT_SOURCE_LABEL', '_DELIVERY_LABEL', '_agentEsc', '_agentNum'].map(constLine).join('\n') + '\n'
  + extractConstBlock('_WRITER_FIELDS') + '\n' + FNS.map(extractFn).join('\n');

function makeEnv(o = {}) {
  const acts = [], toasts = [], confirms = [], forms = [];
  const env = {
    db: { from: () => { const b = { select: () => b, eq: () => b, order: () => b, then: r => Promise.resolve(o.codesFail ? { data: null, error: { message: 'x' } } : { data: [{ code: 'COUPANG', label_ko: '쿠팡' }, { code: 'SIKBOM', label_ko: '식봄' }, { code: 'NEW_MART', label_ko: '새마트' }], error: null }).then(r) }; return b; } },
    showToast: t => toasts.push(t), confirm: m => { confirms.push(m); return o.confirmAnswer !== false; },
    _zkForm: async (title, fields, ok) => { forms.push({ title, fields, ok }); return o.form === undefined ? null : o.form; },
    _writerAct: async (action, fields) => { acts.push({ action, fields }); },
    console: { log() {}, warn() {} },
  };
  const names = Object.keys(env);
  const body = `let SID = 1, _items = __o.items || [], _itemTrust = __o.trust || new Map(), _orderRequests = __o.orders || [], _orderSupply = __o.supply || new Map(),
      _openSupply = new Map(), _supplyAvailable = true, _writerReady = __o.ready !== false, _writerCaps = __o.caps || ['CONFIRM_ORDER_IDENTITY', 'CREATE_AND_CONFIRM_ORDER', 'UPDATE_ORDER_DELIVERY'],
      _vendors = [{ vendor_id: 7, vendor_name: '쿠팡' }];
    ${CODE}
    return { ${FNS.join(', ')} };`;
  const f = new Function(...names, '__o', body)(...names.map(n => env[n]), o);
  return { f, acts, toasts, confirms, forms };
}

const MILK = { item_id: 1, item_name: '우유', current_qty: 1, target_qty: 3, unit: '박스' };
const ORD = (id, extra = {}) => ({ id, store_id: 1, item_id: 1, item_name: '우유', qty: 2, unit: '박스', status: 'ordered', vendor_id: 7, created_at: '2026-04-14T02:00:00Z', ...extra });
const SUP = (extra = {}) => ({ order_state: 'OPEN', verified: true, ordered_qty: 2, accepted_qty: 0, remaining_qty: 2, health: 'HEALTHY', supply_source: null, ordered_at: null, external_order_ref: null, ...extra });
function card({ sup = SUP(), delivery = null, ready = false, caps } = {}) {
  const e = makeEnv({ ready, caps });
  const ctx = { storeId: 1, items: [MILK], needOf: e.f._admittedNeedOf, orderRequests: [ORD(11)], orderSupply: new Map([[11, sup]]),
    openSupply: new Map([[1, { open_supply_state: 'VERIFIED_OPEN' }]]), supplyAvailable: true, writerReady: ready, cycle: new Map(), vendors: [{ vendor_id: 7, vendor_name: '쿠팡' }],
    delivery: new Map(delivery ? [[11, delivery]] : []), writerCaps: caps || (ready ? ['CONFIRM_ORDER_IDENTITY', 'CREATE_AND_CONFIRM_ORDER', 'UPDATE_ORDER_DELIVERY'] : []) };
  // _admittedNeedOf reads _itemTrust: the 우유 count is trusted
  const a = e.f.deriveAgentActions({ ...ctx, needOf: it => ({ state: 'NEEDED', qty: 2, current: 1, target: 3, unit: '박스' }) }).primary.concat(
    e.f.deriveAgentActions({ ...ctx, needOf: it => ({ state: 'NEEDED', qty: 2, current: 1, target: 3, unit: '박스' }) }).waiting).find(x => x.item_id === 1);
  const html = e.f._agentCardHtml(a, false);
  return { a, html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
}

(async () => {
  // WEB-RO-01 canonical supplier
  {
    const { a, text } = card({ sup: SUP({ supply_source: 'COUPANG', ordered_at: '2026-10-05T05:32:00Z', external_order_ref: 'CP-7781' }) });
    check('WEB-RO-01 canonical supplier + real order time + external number → "쿠팡 · 2박스 주문 확인됨 · 10월 5일 14:32 주문 · 주문번호 CP-7781"',
      a.orders[0].line === '쿠팡 · 2박스 주문 확인됨 · 10월 5일 14:32 주문 · 주문번호 CP-7781' && a.reason.startsWith('쿠팡에서 2박스 주문 중이라'), text);
  }
  // WEB-RO-02 supplier absent (even though the order row and the vendor list say 쿠팡)
  {
    const { a, text } = card({ sup: SUP() });
    check('WEB-RO-02 no canonical supplier → "주문처 미확인" — the order row vendor_id 7 (쿠팡) is never used', a.orders[0].line.startsWith('주문처 미확인 · ') && a.supplier === '' && !text.includes('쿠팡'), text);
    const unknownCode = card({ sup: SUP({ supply_source: 'SOMEWHERE' }) });
    check('WEB-RO-02b an unknown code is not shown as a supplier', unknownCode.a.orders[0].line.startsWith('주문처 미확인') && !/SOMEWHERE/.test(unknownCode.text), unknownCode.text);
  }
  // WEB-RO-03 / 04 AT_RISK is not a delay; is_delayed is
  {
    const risk = card({ sup: SUP({ health: 'AT_RISK', supply_source: 'COUPANG' }) });
    check('WEB-RO-03 health AT_RISK only → "이 주문은 확인이 필요해요"; no delay / late wording', risk.text.includes('이 주문은 확인이 필요해요') && !/지연|늦어/.test(risk.text), risk.text);
    const late = card({ sup: SUP({ supply_source: 'COUPANG' }), delivery: { delivery_status: 'IN_TRANSIT', is_delayed: true } });
    check('WEB-RO-04 delivery is_delayed=true → "배송이 지연되고 있어요" (and only then)', late.text.includes('배송이 지연되고 있어요') && late.a.critical === true && late.html.includes('agent-delivery-line delayed'), late.text);
  }
  // WEB-RO-05 DELIVERED ≠ RECEIVED
  {
    const d = card({ sup: SUP({ supply_source: 'COUPANG' }), delivery: { delivery_status: 'DELIVERED' }, ready: true });
    check('WEB-RO-05 DELIVERED → "배송 완료 · 실제 받았는지 확인해 주세요"; title asks to check; still not received (remaining 2, [받았어요] offered)',
      d.text.includes('배송 완료 · 실제 받았는지 확인해 주세요') && d.a.title === '우유 배송 완료 — 받았는지 확인해 주세요' && d.a.reason.includes('배송 완료 표시는 입고가 아니에요')
      && d.a.open_supply_remaining === 2 && d.a.primary_action.call === '_writerFullReceipt(11)', d.text);
  }
  // WEB-RO-06 / 07 nothing invented
  {
    const { a, text } = card({ sup: SUP({ supply_source: 'COUPANG' }) });
    check('WEB-RO-06 ordered_at NULL → no order time (the record / draft time 4월 14일 is never shown as an order time)', !/\d+월 \d+일|\d\d:\d\d|주문 시각/.test(text) && !/4월 14일/.test(text), text);
    check('WEB-RO-07 no delivery evidence → no ETA, no delivery status, no seller link', !/도착|배송|예정|판매처에서 보기/.test(text) && a.orders[0].delivery_line === '', text);
    const eta = card({ sup: SUP({ supply_source: 'COUPANG' }), delivery: { delivery_status: 'IN_TRANSIT', expected_arrival_at: '2026-10-06T21:00:00Z', external_order_url: 'https://mc.coupang.com/ssr/order/1' } });
    check('WEB-RO-07b with evidence → "배송 중 · 도착 예정 10월 7일 06:00" + [판매처에서 보기] (https, opener-safe)', eta.text.includes('배송 중 · 도착 예정 10월 7일 06:00')
      && eta.html.includes('href="https://mc.coupang.com/ssr/order/1" target="_blank" rel="noopener noreferrer"'), eta.text);
    const bad = card({ sup: SUP({ supply_source: 'COUPANG' }), delivery: { delivery_status: 'IN_TRANSIT', external_order_url: 'javascript:alert(1)' } });
    check('WEB-RO-07c an unsafe URL is never rendered as a link', !bad.html.includes('javascript:') && !bad.html.includes('판매처에서 보기'), bad.html);
  }
  // WEB-RO-08 internal id label
  {
    const e = makeEnv({});
    const ctx = { storeId: 1, items: [{ ...MILK, target_qty: 6 }], orderRequests: [ORD(11), ORD(12, { qty: 3 })], orderSupply: new Map([[11, SUP({ supply_source: 'COUPANG', external_order_ref: '11-A' })], [12, SUP({ ordered_qty: 3, remaining_qty: 3 })]]),
      openSupply: new Map([[1, { open_supply_state: 'VERIFIED_OPEN' }]]), supplyAvailable: true, writerReady: false, cycle: new Map(), vendors: [], delivery: new Map(), writerCaps: [],
      needOf: () => ({ state: 'NEEDED', qty: 5, current: 1, target: 6, unit: '박스' }) };
    const r = e.f.deriveAgentActions(ctx); const a = [...r.primary, ...r.waiting].find(x => x.item_id === 1);
    check('WEB-RO-08 internal id → "주문 기록 #11" (never "주문 #"), kept apart from the seller number "주문번호 11-A"', a.orders.map(o => o.line).join('|') === '쿠팡 · 2박스 주문 확인됨 · 주문번호 11-A · 주문 기록 #11|주문처 미확인 · 3박스 주문 확인됨 · 주문 기록 #12'
      && !/주문 #\d/.test(HTML.replace(/주문 기록 #/g, '')), a.orders.map(o => o.line).join('|'));
  }

  // WEB-RISK-01..07: the existing order's state is never hidden, whichever branch decides the card
  {
    const e = makeEnv({});
    const ONION = { item_id: 5, item_name: '양파', current_qty: 0, target_qty: 6, unit: '개' };
    const ctxOf = ({ health = 'HEALTHY', delivery = null, need = { state: 'NEEDED', qty: 6, current: 0, target: 6, unit: '개' }, remaining = 1, ready = false } = {}) => ({
      storeId: 1, items: [ONION], needOf: () => need, orderRequests: [{ id: 51, store_id: 1, item_id: 5, item_name: '양파', qty: remaining, unit: '개', status: 'ordered', created_at: '2026-10-01T00:00:00Z' }],
      orderSupply: new Map([[51, SUP({ ordered_qty: remaining, remaining_qty: remaining, health, supply_source: 'COUPANG' })]]),
      openSupply: new Map([[5, { open_supply_state: health === 'AT_RISK' ? 'AT_RISK' : 'VERIFIED_OPEN' }]]), supplyAvailable: true, writerReady: ready, cycle: new Map(), vendors: [],
      delivery: new Map(delivery ? [[51, delivery]] : []), writerCaps: [] });
    const cardOf = ctx => { const r = e.f.deriveAgentActions(ctx); const all = [...r.primary, ...r.moreChecks, ...r.waiting].filter(a => a.item_id === 5); return { all, a: all[0], text: all[0] ? `${all[0].title} | ${all[0].reason}` : '' }; };
    const h = cardOf(ctxOf());
    check('WEB-RISK-01 partial cover, healthy → "양파 5개 더 주문하세요" (6 − 1), no risk / delay wording', h.all.length === 1 && h.a.type === 'ORDER_NOW' && h.a.required_qty === 5 && h.a.title === '양파 5개 더 주문하세요'
      && !/확인이 필요|지연|늦어/.test(h.text) && h.a.critical === false, h.text);
    const r2 = cardOf(ctxOf({ health: 'AT_RISK' }));
    check('WEB-RISK-02 partial cover + AT_RISK → still 5개 더 주문 + "기존 주문(1개)은 확인이 필요해요"; no delay wording; one card', r2.all.length === 1 && r2.a.required_qty === 5
      && r2.a.title === '양파 5개 더 주문하세요' && r2.a.reason.includes('기존 주문(1개)은 확인이 필요해요') && !/지연|늦어/.test(r2.text) && r2.a.critical === true, r2.text);
    const r3 = cardOf(ctxOf({ delivery: { delivery_status: 'IN_TRANSIT', is_delayed: true } }));
    check('WEB-RISK-03 partial cover + delayed delivery → "기존 주문 배송이 지연되고 있어요"; no "확인이 필요" claim', r3.all.length === 1 && r3.a.required_qty === 5
      && r3.a.reason.includes('기존 주문 배송이 지연되고 있어요') && !/확인이 필요/.test(r3.a.reason) && r3.a.orders[0].delivery_line.includes('배송이 지연되고 있어요'), r3.text);
    const r4 = cardOf(ctxOf({ health: 'AT_RISK', delivery: { delivery_status: 'IN_TRANSIT', is_delayed: true } }));
    check('WEB-RISK-04 partial cover + AT_RISK + delayed → one combined line "기존 주문(1개)은 배송이 지연되고 있어 확인이 필요해요" (no duplicate sentences)', r4.all.length === 1
      && r4.a.reason.includes('기존 주문(1개)은 배송이 지연되고 있어 확인이 필요해요') && (r4.a.reason.match(/지연/g) || []).length === 1 && (r4.a.reason.match(/확인이 필요/g) || []).length === 1, r4.text);
    const full = { state: 'NEEDED', qty: 1, current: 2, target: 3, unit: '개' };
    const r5 = cardOf(ctxOf({ health: 'AT_RISK', need: full }));
    check('WEB-RISK-05 full cover + AT_RISK → unchanged: "양파 추가 주문하지 마세요" + "이 주문은 확인이 필요해요", no delay wording', r5.a.title === '양파 추가 주문하지 마세요'
      && r5.a.reason.includes('이 주문은 확인이 필요해요') && !/지연|늦어/.test(r5.text) && r5.a.type !== 'ORDER_NOW', r5.text);
    const r6 = cardOf(ctxOf({ need: full, delivery: { delivery_status: 'IN_TRANSIT', is_delayed: true } }));
    check('WEB-RISK-06 full cover + delayed → unchanged: "배송이 지연되고 있어요"', r6.a.title === '양파 추가 주문하지 마세요' && r6.a.reason.includes('배송이 지연되고 있어요') && r6.a.type !== 'ORDER_NOW', r6.text);
    const r7 = cardOf(ctxOf({ need: { state: 'NEEDS_VERIFICATION', qty: 0, current: 0, recorded: 0, target: 6, unit: '개' }, delivery: { delivery_status: 'IN_TRANSIT', is_delayed: true }, health: 'AT_RISK' }));
    check('WEB-RISK-07 untrusted count + a delayed / at-risk order → no ORDER_NOW and no order quantity; "현재 수량을 확인하면 더 주문할지 알려 드릴게요" + the delay / check wording',
      r7.all.length === 1 && r7.a.type !== 'ORDER_NOW' && r7.a.required_qty === null && r7.a.reason.includes('현재 수량을 확인하면 더 주문할지 알려 드릴게요') && r7.a.reason.includes('배송이 지연되고 있어요'), r7.text);
  }

  // CONFIRM dialog: only what the person knows
  {
    const e = makeEnv({ orders: [ORD(11)], form: { supply_source: 'COUPANG', ordered_at: null, external_order_ref: '' } });
    await e.f._agentConfirmOrder(11);
    check('CONFIRM-UI fields are optional, unknown ones are not sent (only supplier given → {order_id, supply_source}); dialog says a draft is not an order',
      e.acts.length === 1 && e.acts[0].action === 'CONFIRM_ORDER' && J(e.acts[0].fields) === J({ order_id: 11, supply_source: 'COUPANG' }) && e.forms[0].fields.every(f => !f.required)
      && e.forms[0].title.includes('주문 기록 #11 · 우유 2박스') && e.forms[0].title.includes('발주표에 담기만 한 것은 주문이 아니에요') && e.forms[0].fields[0].options[0].label === '모름', J({ acts: e.acts, form: e.forms[0] }));
    const none = makeEnv({ orders: [ORD(11)], form: { supply_source: null, ordered_at: null, external_order_ref: null } });
    await none.f._agentConfirmOrder(11);
    check('CONFIRM-UI nothing known → {order_id} only (no confirmation time sent as an order time)', J(none.acts[0]?.fields) === J({ order_id: 11 }), J(none.acts));
    const cancel = makeEnv({ orders: [ORD(11)] });
    await cancel.f._agentConfirmOrder(11);
    check('CONFIRM-UI cancel → nothing sent', cancel.acts.length === 0);
    const old = makeEnv({ orders: [ORD(11)], caps: [] });
    await old.f._agentConfirmOrder(11);
    check('CONFIRM-UI server without the capability → v1 confirm (order_id only), no identity fields', old.forms.length === 0 && old.confirms.length === 1 && J(old.acts[0]?.fields) === J({ order_id: 11 }), J(old.acts));
    const sup = await makeEnv({}).f._supplierOptions();
    const fb = await makeEnv({ codesFail: true }).f._supplierOptions();
    check('CONFIRM-UI supplier choices come from the server code list (new codes appear); the app list is only the fallback', J(sup.map(x => x.value)) === J(['COUPANG', 'SIKBOM', 'NEW_MART']) && fb.length === 8 && fb[0].value === 'COUPANG', J({ sup, fb }));
  }
  // External order registration
  {
    const items = [MILK, { item_id: 2, item_name: '치즈', unit: '개' }];
    const e = makeEnv({ items, form: { item_id: '2', ordered_qty: 4, supply_source: 'SIKBOM', ordered_at: '2026-10-05T03:00:00.000Z', external_order_ref: 'SB-55', confirm: true } });
    await e.f._agentRegisterExternalOrder();
    check('EXT-UI → CREATE_AND_CONFIRM_ORDER {item_id, ordered_qty, unit = the item inventory unit, supply_source, confirm, ordered_at, external_order_ref}; item chosen from the list',
      e.acts.length === 1 && e.acts[0].action === 'CREATE_AND_CONFIRM_ORDER' && J(e.acts[0].fields) === J({ item_id: 2, ordered_qty: 4, unit: '개', supply_source: 'SIKBOM', confirm: true, ordered_at: '2026-10-05T03:00:00.000Z', external_order_ref: 'SB-55' })
      && e.forms[0].fields[0].type === 'select' && e.forms[0].fields.find(f => f.key === 'confirm').required === true, J(e.acts));
    const noConfirm = makeEnv({ items, form: { item_id: '2', ordered_qty: 4, supply_source: 'SIKBOM', confirm: false } });
    await noConfirm.f._agentRegisterExternalOrder();
    const noReady = makeEnv({ items, ready: false, form: { item_id: '2', ordered_qty: 4, supply_source: 'SIKBOM', confirm: true } });
    await noReady.f._agentRegisterExternalOrder();
    check('EXT-UI without the explicit "실제로 주문했어요" or without a ready writer → nothing sent', noConfirm.acts.length === 0 && noReady.acts.length === 0 && noReady.forms.length === 0, J({ a: noConfirm.acts, b: noReady.acts }));
  }
  // Delivery update
  {
    const supply = new Map([[11, SUP()]]);
    const e = makeEnv({ supply, form: { delivery_status: 'IN_TRANSIT', is_delayed: null, expected_arrival_at: '2026-10-06T21:00:00.000Z', external_order_url: null } });
    const t0 = Date.now(); await e.f._agentDeliveryUpdate(11);
    const fl = e.acts[0]?.fields || {};
    check('DEL-UI → UPDATE_ORDER_DELIVERY with only the observed claims + observed_at (now); unknown delay not sent', e.acts[0]?.action === 'UPDATE_ORDER_DELIVERY' && fl.order_id === 11 && fl.delivery_status === 'IN_TRANSIT'
      && fl.expected_arrival_at === '2026-10-06T21:00:00.000Z' && !('is_delayed' in fl) && !('external_order_url' in fl) && Math.abs(Date.parse(fl.observed_at) - t0) < 5000, J(e.acts));
    const empty = makeEnv({ supply, form: { delivery_status: null, is_delayed: null, expected_arrival_at: null, external_order_url: null } });
    await empty.f._agentDeliveryUpdate(11);
    const unsafe = makeEnv({ supply, form: { delivery_status: 'IN_TRANSIT', is_delayed: null, expected_arrival_at: null, external_order_url: 'https://coupang.com/a?session=1' } });
    await unsafe.f._agentDeliveryUpdate(11);
    const draft = makeEnv({ supply: new Map(), form: { delivery_status: 'IN_TRANSIT' } });
    await draft.f._agentDeliveryUpdate(11);
    check('DEL-UI nothing observed / unsafe URL / not a confirmed open order → nothing sent', empty.acts.length === 0 && unsafe.acts.length === 0 && draft.acts.length === 0 && draft.forms.length === 0, J({ empty: empty.toasts, unsafe: unsafe.toasts, draft: draft.toasts }));
    const f2 =makeEnv({}).f._writerFields('UPDATE_ORDER_DELIVERY', { order_id: 1, observed_at: 'x', delivery_status: 'DELIVERED', evidence_source: 'PROVIDER_API', actor: 'me', store_id: 1 });
    check('DEL-UI the Web never sends authority / actor / store / evidence source (allowlist drops them)', J(f2) === J({ order_id: 1, observed_at: 'x', delivery_status: 'DELIVERED' }), J(f2));
  }
  // STATIC: no vendor fallback, AT_RISK not a delay
  {
    const sup = extractFn('_agentOrderSupplier'), derive = extractFn('deriveAgentActions');
    check('STATIC supplier = canonical supply_source only (no vendor_id / vendors lookup)', !/vendor/.test(sup.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')) && /_agentOrderSupplier\(x\.sup\)/.test(derive), sup);
    check('STATIC AT_RISK maps to "이 주문은 확인이 필요해요"; the delay sentence comes only from delivery is_delayed', /if \(atRisk\) why\.push\('이 주문은 확인이 필요해요'\)/.test(derive) && /if \(delayed\) why\.push\('배송이 지연되고 있어요'\)/.test(derive)
      && !/예상보다 늦어지고/.test(HTML), '');
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL harness ' + e.stack); process.exit(1); });
