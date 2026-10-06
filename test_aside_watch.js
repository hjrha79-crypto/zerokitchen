/*
 * test_aside_watch.js — 자동 배송 확인 (Aside 배송 확인 임무) on the Web: WEB-AW-01..08
 *
 * The Home shows what Aside saw as a PROPOSAL on the order's own card; one tap [반영] sends exactly the changed claims through
 * the existing Trusted Writer (UPDATE_ORDER_DELIVERY + ASIDE_APPROVED + the proposal ref). Nothing is typed again.
 * DELIVERED asks "스파게티니 6개가 배송완료로 표시됐어요. 실제로 받았나요?" — a receipt is still only [받았어요].
 * REAL from index.html: deriveAgentActions, _agentCardHtml, _asideProposalLine, _asideApply, _asideOrderOf, _writerFields, _fmtKst, …
 * MOCK: _writerAct (records the envelope), _zkForm (must never be called by [반영]), DOM. No network.
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
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + String(detail).slice(0, 600) : ''}`); };
const J = x => JSON.stringify(x);

const FNS = ['_asideProposalLine', '_asideOrderOf', '_asideApply', '_orderNeedOf', '_admittedNeedOf', '_draftAge', '_agentOrderSupplier', '_fmtKst',
  '_agentDeliveryLine', '_safeOrderUrl', 'deriveAgentActions', '_agentCardHtml', '_writerFields'];
const CODE = ['AGENT_PRIORITY', 'AGENT_MAX_CHECKS', '_AGENT_SOURCE_LABEL', '_DELIVERY_LABEL', '_agentEsc', '_agentNum'].map(constLine).join('\n') + '\n'
  + extractConstBlock('_WRITER_FIELDS') + '\n' + FNS.map(extractFn).join('\n');

function makeEnv(o = {}) {
  const acts = [], toasts = [], forms = [];
  const env = { showToast: t => toasts.push(t), _zkForm: async (...a) => { forms.push(a); return null; }, _writerAct: async (action, fields) => { acts.push({ action, fields }); }, console: { log() {}, warn() {} } };
  const names = Object.keys(env);
  const body = `let SID = 1, _writerReady = __o.ready !== false, _writerCaps = __o.caps || ['CONFIRM_ORDER_IDENTITY', 'CREATE_AND_CONFIRM_ORDER', 'UPDATE_ORDER_DELIVERY'],
      _asideWatch = __o.watch || new Map();
    ${CODE}
    return { ${FNS.join(', ')} };`;
  const f = new Function(...names, '__o', body)(...names.map(n => env[n]), o);
  return { f, acts, toasts, forms };
}

const REF = '1103431282926';
const SPAG = { item_id: 77, item_name: '스파게티니', current_qty: 5, target_qty: 9, unit: '개' };
const ORD = (id, extra = {}) => ({ id, store_id: 1, item_id: 77, item_name: '스파게티니', qty: 6, unit: '개', status: 'ordered', vendor_id: null, created_at: '2026-10-06T13:32:28Z', ...extra });
const SUP = (extra = {}) => ({ order_state: 'OPEN', verified: true, ordered_qty: 6, accepted_qty: 0, remaining_qty: 6, health: 'HEALTHY', supply_source: 'COUPANG', ordered_at: null, external_order_ref: REF, ...extra });
const CANON = { delivery_status: 'IN_TRANSIT', is_delayed: false, expected_arrival_at: '2026-10-06T23:00:00+00:00', external_order_url: null };
const PROPOSAL = { order_id: 129, supplier: 'COUPANG', external_order_ref: REF, observed_at: '2026-10-06T13:40:00+00:00', proposal_ref: 'zk-aside:8a3c5d2e-0000-4000-8000-000000000001',
  observed: { delivery_status: 'IN_TRANSIT', is_delayed: false, expected_arrival_at: '2026-10-06T22:00:00+00:00', eta_kind: 'BY', external_order_url: `https://mc.coupang.com/ssr/desktop/order/${REF}` },
  changes: { expected_arrival_at: { from: '2026-10-06T23:00:00+00:00', to: '2026-10-06T22:00:00+00:00', eta_kind: 'BY' }, external_order_url: { from: null, to: `https://mc.coupang.com/ssr/desktop/order/${REF}` } },
  flags: { auto_approval: false, auto_approval_blocked_by: ['V0_1_HUMAN_APPROVAL_ONLY'] } };
const WATCH = (extra = {}) => ({ mission_id: 'm1', order_id: 129, state: 'AWAITING_APPROVAL', approval_state: 'PENDING', run_id: '8a3c5d2e-0000-4000-8000-000000000001', proposal: PROPOSAL, proposal_applied: false, ...extra });

function card({ ready = true, delivery = CANON, watch = new Map([[129, WATCH()]]), enabled = true, orders = [ORD(129)], supply = new Map([[129, SUP()]]), need, item = SPAG } = {}) {
  const e = makeEnv({ ready, watch });
  const ctx = { storeId: 1, items: [item], orderRequests: orders, orderSupply: supply, openSupply: new Map([[77, { open_supply_state: 'UNKNOWN' }]]), supplyAvailable: true,
    writerReady: ready, cycle: new Map(), vendors: [], delivery: new Map(delivery ? [[129, delivery]] : []), writerCaps: ready ? ['CONFIRM_ORDER_IDENTITY', 'CREATE_AND_CONFIRM_ORDER', 'UPDATE_ORDER_DELIVERY'] : [],
    asideWatch: watch, asideEnabled: enabled, needOf: need || (() => ({ state: 'NEEDED', qty: 4, current: 5, target: 9, unit: '개' })) };
  const r = e.f.deriveAgentActions(ctx);
  const a = r.primary.concat(r.waiting).find(x => x.item_id === 77);
  const html = e.f._agentCardHtml(a, false);
  return { e, a, html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), all: r };
}

(async () => {
  {
    const { a, html, text } = card();
    const line = `쿠팡 주문 ${REF} · 배송 중 · 10월 7일 07:00 이전 도착 예정 · 22:40 확인 — 반영할까요?`;
    check('WEB-AW-01 a pending Aside proposal renders on the order\'s own card (no extra card): "쿠팡 주문 1103431282926 · 배송 중 · 10월 7일 07:00 이전 도착 예정 · 22:40 확인 — 반영할까요?" + [반영] [아니요]',
      text.includes(line) && /onclick="_asideApply\(129\)">반영</.test(html) && /onclick="_asideReject\(129\)">아니요</.test(html)
      && a.title === '스파게티니 추가 주문하지 마세요' && card().all.primary.concat(card().all.waiting).filter(x => x.item_id === 77).length === 1, text);
    check('WEB-AW-01b the canonical delivery line stays what the server recorded (배송 중 · 도착 예정 10월 7일 08:00) until a person applies the proposal',
      text.includes('배송 중 · 도착 예정 10월 7일 08:00'), text);
  }
  {
    const e = makeEnv({ watch: new Map([[129, WATCH()]]) });
    await e.f._asideApply(129);
    const f = e.acts[0]?.fields || {};
    check('WEB-AW-02 [반영] → ONE Writer action UPDATE_ORDER_DELIVERY with exactly the changed claims + Aside\'s observed time + ASIDE_APPROVED + the proposal ref; no form, nothing typed',
      e.acts.length === 1 && e.acts[0].action === 'UPDATE_ORDER_DELIVERY' && J(Object.keys(f).sort()) === J(['evidence_ref', 'evidence_source', 'expected_arrival_at', 'external_order_url', 'observed_at', 'order_id'])
      && f.order_id === 129 && f.evidence_source === 'ASIDE_APPROVED' && f.evidence_ref === PROPOSAL.proposal_ref && f.expected_arrival_at === '2026-10-06T22:00:00.000Z'
      && f.observed_at === '2026-10-06T13:40:00.000Z' && e.forms.length === 0, J(e.acts));
    const e2 = makeEnv({ ready: false, watch: new Map([[129, WATCH()]]) });
    await e2.f._asideApply(129);
    const e3 = makeEnv({ watch: new Map([[129, WATCH({ proposal: null })]]) });
    await e3.f._asideApply(129);
    check('WEB-AW-03 [반영] without a ready writer, or with no pending proposal → nothing sent', e2.acts.length === 0 && e3.acts.length === 0, J([e2.toasts, e3.toasts]));
  }
  {
    const applied = card({ watch: new Map([[129, WATCH({ proposal_applied: true })]]) });
    const none = card({ watch: new Map([[129, WATCH({ state: 'NO_CHANGE', approval_state: 'APPROVED', proposal: null })]]) });
    const off = card({ watch: new Map(), enabled: false });
    const signedOut = card({ ready: false });
    check('WEB-AW-04 an applied proposal disappears; with no proposal a signed-in operator gets [지금 배송 확인] (COUPANG + order number + store enabled); disabled store → no link; signed out → the proposal shows but no [반영]',
      !/반영할까요/.test(applied.text) && /_asideCheckNow\(129\)/.test(none.html) && !/_asideCheckNow/.test(off.html) && /반영할까요/.test(signedOut.text) && !/_asideApply/.test(signedOut.html),
      J([applied.text, none.text, off.text, signedOut.text]));
  }
  {
    const login = card({ watch: new Map([[129, WATCH({ state: 'EXTERNAL_ACCESS_REQUIRED', approval_state: 'NONE', proposal: null })]]) });
    const failed = card({ watch: new Map([[129, WATCH({ state: 'FAILED', approval_state: 'NONE', proposal: null })]]) });
    check('WEB-AW-05 login expired → "자동 배송 확인: 판매처에 다시 로그인해야 확인할 수 있어요"; human review → "…판매처에서 직접 확인해 주세요"; no claim invented',
      login.text.includes('자동 배송 확인: 판매처에 다시 로그인해야 확인할 수 있어요') && failed.text.includes('판매처에서 직접 확인해 주세요') && !/주문이 없|배송 완료/.test(login.text + failed.text), J([login.text, failed.text]));
  }
  {
    const d = card({ delivery: { ...CANON, delivery_status: 'DELIVERED' }, watch: new Map() });
    check('WEB-AW-06 canonical DELIVERED, one order, nothing received → "스파게티니 6개가 배송완료로 표시됐어요. 실제로 받았나요?" + [받았어요] (FULL_RECEIPT path); title "배송 완료 — 받았는지 확인해 주세요"',
      d.text.includes('스파게티니 6개가 배송완료로 표시됐어요. 실제로 받았나요?') && /_writerFullReceipt\(129\)/.test(d.html) && /받았어요/.test(d.html) && d.a.title === '스파게티니 배송 완료 — 받았는지 확인해 주세요', d.text);
    const two = card({ delivery: { ...CANON, delivery_status: 'DELIVERED' }, watch: new Map(), orders: [ORD(129), ORD(130, { qty: 2 })],
      supply: new Map([[129, SUP()], [130, SUP({ ordered_qty: 2, remaining_qty: 2, external_order_ref: 'X2' })]]) });
    const part = card({ delivery: { ...CANON, delivery_status: 'DELIVERED' }, watch: new Map(), supply: new Map([[129, SUP({ accepted_qty: 2, remaining_qty: 4, order_state: 'PARTIAL' })]]) });
    check('WEB-AW-07 several orders / a partial receipt → "배송완료로 표시된 주문이 있어요. 실제로 받은 수량을 확인해 주세요" (no single-quantity claim)',
      two.text.includes('실제로 받은 수량을 확인해 주세요') && !/6개가 배송완료/.test(two.text) && part.text.includes('실제로 받은 수량을 확인해 주세요'), J([two.text, part.text]));
  }
  {
    const q = (qty, unit) => card({ delivery: { ...CANON, delivery_status: 'DELIVERED' }, watch: new Map(), orders: [ORD(129, { qty, unit })],
      supply: new Map([[129, SUP({ ordered_qty: qty, remaining_qty: qty, unit })]]), item: { ...SPAG, unit }, need: () => ({ state: 'NEEDED', qty, current: 5, target: 5 + qty, unit }) }).text;
    const t6 = q(6, '개'), t1 = q(1, '봉'), t3 = q(3, '박스');
    check('WEB-AW-08 the particle 이/가 follows the last sound in the receipt question (6개가 · 1봉이 · 3박스가)',
      t6.includes('스파게티니 6개가 배송완료로') && t1.includes('스파게티니 1봉이 배송완료로') && t3.includes('스파게티니 3박스가 배송완료로'), J([t6, t1, t3]));
  }
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL harness ' + (e.stack || e)); process.exit(1); });
