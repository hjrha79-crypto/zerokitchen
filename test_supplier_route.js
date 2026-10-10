/*
 * test_supplier_route.js — 거래처 발주 LINE (supplier-route-line-001), the REAL block of index.html against the REAL SQL:
 * fetch(supplier-route) runs the REAL Edge handler (handler.mjs), whose rpc() calls the package SQL on a local PGlite (Production-shaped) as service_role + the verified user.
 * WSR-01..14: register a 문자 거래처 by talking → detail → 발주 준비 (현재 필요 수량) → 문자 복사 → 보냈어요 → 답장 붙여넣기 →
 * 해석 (CONFIRM / 수량 / 가격 / 배송일 / 불가 / 애매) → 사장님 결정 → 주문 확인 · 전화로 · 확인용 문구 · 로그인 없음 · 개발 도우미 없음.
 */
const fs = require('fs');
const path = require('path');
const H = require(path.join(__dirname, '..', 'migration-packages', 'supplier-route-line-001', 'tests', 'harness.js'));
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const A = HTML.indexOf('/* ══ 거래처 발주 LINE (supplier-route-line-001)'), B = HTML.indexOf('/* ══ 거래처 발주 LINE 끝 ══ */');
const C = HTML.indexOf('function renderVendorList() {'), D = HTML.indexOf('async function saveVendorMethod(');
if (A < 0 || B < A || C < 0 || D < C) throw new Error('supplier route block not found');
const BLOCK = HTML.slice(A, B), VLIST = HTML.slice(C, D);

let pass = 0, fail = 0;
const ok = (id, c, d) => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${id}${c ? '' : '  :: ' + JSON.stringify(d).slice(0, 700)}`); };

async function makeEnv({ signedIn = true } = {}) {
  const e = await H.env();
  const S = { toasts: [], clip: [], rpcs: [], fetches: [] };
  const els = {};
  const el = id => (els[id] = els[id] || { id, value: '', innerHTML: '', textContent: '', checked: false, classList: { on: false, add() { this.on = true; }, remove() { this.on = false; } } });
  const document = { getElementById: el };
  // the REAL Edge handler; its rpc() = the package SQL on PGlite as service_role with the verified user (the production path, minus the network)
  const { createHandler } = await import('file://' + path.join(__dirname, '..', 'migration-packages', 'supplier-route-line-001', 'supabase', 'functions', 'supplier-route', 'handler.mjs').split(path.sep).join('/'));
  const handle = createHandler({
    verifyUser: async tok => (tok === 'tok-owner' ? { id: H.OWNER } : null),
    rpc: async (fn, args) => { S.rpcs.push([fn, args]); try { return { data: await e.rpc(fn, fn === 'zk_sr_view' ? args.p_store : args.p, args.p_user_id), error: null }; } catch { return { data: null, error: true }; } },
  });
  const fetch = async (url, init) => { S.fetches.push(url); const res = await handle(new Request(url, init)); return { status: res.status, json: async () => res.json() }; };
  const _writerToken = async () => (signedIn ? 'tok-owner' : null);
  const items = (await e.db.query(`select item_id, item_name, unit, vendor_id from public.items where store_id = 1 order by item_id`)).rows.map(r => ({ ...r, item_id: Number(r.item_id), vendor_id: r.vendor_id == null ? null : Number(r.vendor_id) }));
  const vendors = (await e.db.query(`select vendor_id, vendor_name, order_method from public.vendors where store_id = 1 order by vendor_id`)).rows.map(r => ({ ...r, vendor_id: Number(r.vendor_id) }));
  const db = { from: () => ({ select: () => ({ eq: async () => ({ data: (await e.db.query(`select vendor_id, vendor_name, order_method from public.vendors where store_id = 1 order by vendor_id`)).rows.map(r => ({ ...r, vendor_id: Number(r.vendor_id) })) }) }) }) };
  const env = { document, fetch, _writerToken, SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_KEY: 'pk', db, SID: 1, _stores: [{ store_id: 1, store_name: '경기광주점' }], _items: items, _vendors: vendors,
    showToast: t => S.toasts.push(t), navigator: { clipboard: { writeText: async t => { S.clip.push(t); } } }, crypto: require('crypto'), console };
  const names = Object.keys(env);
  const f = new Function(...names, `${BLOCK}\n${VLIST}\nreturn { _srOpenAdd, _srOpenDetail, _srShow, _srAct, _srDecide, _srLoad, _SR: () => _SR, renderVendorList, _srContract };`)(...names.map(k => env[k]));
  const html = () => el('srApp').innerHTML;
  const set = (id, v) => { el(id).value = v; };
  const fetchRaw = async body => fetch('https://proj.supabase.co/functions/v1/supplier-route/web', { method: 'POST', headers: { authorization: 'Bearer tok-owner', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { e, S, f, html, set, el, items, fetchRaw };
}

(async () => {
  // WSR-01..05: registration by talking (A안 only, no A/B), with the owner's choices only
  const t = await makeEnv();
  await t.f._srOpenAdd();
  ok('WSR-01 + 거래처 추가 opens the conversational start (no 선택형 A/B in the product)', /이 거래처에 대해 편하게 말씀해주세요/.test(t.html()) && !/선택형|A 대화형/.test(t.html()) && t.el('srOverlay').classList.on, t.html().slice(0, 200));
  t.set('srText', '루꼴라 재배하시는 분인데 전화나 문자로 주문하면 배송해준대.');
  await t.f._srAct('understand');
  ok('WSR-02 understood: 루꼴라 농가 · 경기광주점 · 품목 루꼴라(store item) · 문자 / 전화 · 직접 배송; unknowns listed calmly',
    /value="루꼴라 농가"/.test(t.html()) && /경기광주점/.test(t.html()) && /루꼴라/.test(t.html()) && /문자 \/ 전화/.test(t.html()) && /직접 배송 가능/.test(t.html()) && /지금 몰라도 괜찮아요/.test(t.html()), t.html());
  t.set('srName', '루꼴라 농가'); await t.f._srAct('toRoute'); await t.f._srAct('def', 'SMS');
  ok('WSR-03 문자 = 추천 + 기본; 급할 때 is ASKED (nothing pre-selected), continue blocked until answered',
    /추천/.test(t.html()) && /급할 때 다른 방법도 사용할까요/.test(t.html()) && /disabled>급할 때 방법을 골라주세요/.test(t.html()) && t.f._SR().d.backup === undefined, t.html().slice(-600));
  await t.f._srAct('backup', 'PHONE'); await t.f._srAct('toContact');
  ok('  number asked once; "전화 번호도 같은 번호인가요?" asked (never assumed)', /문자 보낼 번호를 알려주세요/.test(t.html()) && /전화 번호도 같은 번호인가요/.test(t.html()), t.html());
  t.set('srNo', '010-1234-5678'); await t.f._srAct('phoneSame', true); t.set('srNo', '010-1234-5678'); await t.f._srAct('toPay');
  await t.f._srAct('pay', 'BANK_TRANSFER'); await t.f._srAct('payWhen', 'MONTH_END_SETTLEMENT'); t.f._srShow('ful');
  await t.f._srAct('ful', 'SUPPLIER_DELIVERY'); await t.f._srAct('lead', 'NEXT_BUSINESS_DAY');
  ok('  lead time offers 평일 기준 다음날 (distinct from 다음날)', /평일 기준 다음날/.test(t.html()) && />다음날</.test(t.html()), '');
  await t.f._srAct('toItemDefault');
  ok('WSR-04 루꼴라 is bought at 네이버 today → ONE question: 기본 거래처를 바꿀까요? (nothing chosen yet)', /기본 거래처를 바꿀까요/.test(t.html()) && /네이버/.test(t.html()) && /disabled>계속/.test(t.html()), t.html());
  await t.f._srAct('makeDefault', false); t.f._srShow('preview');
  ok('  preview: 예시 수량 2 + "저장하지 않아요" + message "로사안젤라 경기광주점 … 루꼴라 2kg 부탁드립니다"',
    /예시 수량/.test(t.html()) && /저장하지 않아요/.test(t.html()) && /로사안젤라 경기광주점입니다/.test(t.html()) && /루꼴라 2kg 부탁드립니다/.test(t.html()), t.html());
  t.f._srShow('confirm');
  const conf = t.html();
  ok('  summary = only what was chosen: 문자 / 긴급 전화 / 계좌이체 · 월말에 모아서 / 거래처가 배송 · 평일 기준 다음날 / 사용 매장 경기광주점',
    /기본 발주<\/span><span class="v">문자/.test(conf) && /긴급 발주<\/span><span class="v">전화/.test(conf) && /계좌이체 · 월말에 모아서/.test(conf) && /거래처가 배송 · 평일 기준 다음날/.test(conf) && /사용 매장<\/span><span class="v">경기광주점/.test(conf), conf);
  await t.f._srAct('register');
  const db1 = await t.e.one(`select (select count(*) from public.supplier_contracts) c, (select string_agg(route_kind || ':' || route_role || ':' || destination, ',' order by route_role) from public.supplier_routes) r,
    (select vendor_id from public.items where item_id = 1) iv, (select string_agg(vendor_id || ':' || is_default, ',') from public.item_vendor_map where item_id = 1) ivm,
    (select payment_method || '/' || payment_timing || '/' || fulfillment || '/' || lead_time from public.supplier_contracts) pol, (select order_method from public.vendors where vendor_name = '루꼴라 농가') om`);
  ok('WSR-05 registered in the DB: contract + SMS DEFAULT / PHONE SECONDARY (owner number), policy BANK_TRANSFER/MONTH_END/SUPPLIER_DELIVERY/NEXT_BUSINESS_DAY; 루꼴라 still defaults to 네이버 (owner said 그대로); no quantity',
    /거래처를 추가했어요/.test(t.html()) && Number(db1.c) === 1 && db1.r === 'SMS:DEFAULT:010-1234-5678,PHONE:SECONDARY:010-1234-5678' && Number(db1.iv) === 5
      && /6:false/.test(db1.ivm) && db1.pol === 'BANK_TRANSFER/MONTH_END_SETTLEMENT/SUPPLIER_DELIVERY/NEXT_BUSINESS_DAY' && db1.om === 'sms', db1);
  const vid = t.f._SR().vendorId;
  // WSR-06: detail + 발주 준비 (quantity = what is needed now; never a stored default)
  await t.f._srOpenDetail(vid);
  ok('WSR-06 detail: 기본 문자 · 급할 때 전화 · 계좌이체 · 월말 · 직접배송 · 평일 기준 다음날 · 루꼴라 · kg · 최근 주문 없음 · [발주 준비]',
    /기본 주문/.test(t.html()) && /급할 때/.test(t.html()) && /평일 기준 다음날/.test(t.html()) && /루꼴라 · kg/.test(t.html()) && /없음/.test(t.html()) && /발주 준비/.test(t.html()), t.html());
  t.f._srAct('prepare');
  ok('  발주 준비 asks 지금 필요한 수량 (empty — nothing remembered)', /지금 필요한 수량/.test(t.html()) && /value=""/.test(t.html()), t.html());
  await t.f._srAct('draft');
  ok('  no quantity → asked, nothing drafted', /지금 필요한 수량을 넣어주세요/.test(t.html()) && !t.S.rpcs.some(r => r[0] === 'zk_sr_order_draft'), '');
  const order = async (qty, opt = {}) => { await t.f._srOpenDetail(vid); t.f._srAct('prepare'); t.f._srAct('oQty', String(qty)); if (opt.draftOnly) t.f._srAct('draftOnly', true); await t.f._srAct('draft'); };
  const sendIt = async () => { await t.f._srAct('copy'); await t.f._srAct('sent'); };
  const reply = async txt => { t.set('srReply', txt); await t.f._srAct('reply'); };
  await order(2);
  ok('WSR-07 draft: 보낼 내용 + [문자 복사] primary + [이번엔 전화로]; no [보냈어요] before copying; default route not asked again',
    /루꼴라 2kg 부탁드립니다/.test(t.html()) && /문자 복사/.test(t.html()) && /이번엔 전화로/.test(t.html()) && !/보냈어요/.test(t.html()) && /기본 발주 방식은 문자입니다/.test(t.html()), t.html());
  await t.f._srAct('copy');
  ok('  [문자 복사] → the exact server text on the clipboard → [보냈어요] appears', t.S.clip[0] === '안녕하세요.\n로사안젤라 경기광주점입니다.\n\n루꼴라 2kg 부탁드립니다.\n배송 부탁드립니다.' && /보냈어요/.test(t.html()), t.S.clip);
  await t.f._srAct('sent');
  ok('  [보냈어요] → 답장을 기다리고 있어요 + 답장 붙여넣기 (Human-confirmed sent)', /답장을 기다리고 있어요/.test(t.html()) && /답장 확인/.test(t.html()), t.html());
  await reply('오늘은 1kg밖에 없어요.');
  ok('WSR-08 수량 변경: 요청 2kg / 가능 1kg → [1kg로 주문] [이번 주문 취소] [전화해서 확인]; not confirmed',
    /수량을 바꿔 제안했어요/.test(t.html()) && /1kg로 주문/.test(t.html()) && /이번 주문 취소/.test(t.html()) && /전화해서 확인/.test(t.html()) && !/주문이 확인됐어요/.test(t.html()), t.html());
  await t.f._srDecide('ACCEPT_QTY');
  ok('  [1kg로 주문] → 주문이 확인됐어요 1kg · 보낸 문자 + 거래처 답장 · 결제 월말 (아직 안 함) · 재고 안 바뀜',
    /주문이 확인됐어요/.test(t.html()) && /루꼴라 1kg/.test(t.html()) && /보낸 문자 \+ 거래처 답장/.test(t.html()) && /월말에 모아서 \(아직 안 함\)/.test(t.html()) && /재고는 지금 바뀌지 않았어요/.test(t.html()), t.html());
  await order(2); await sendIt(); await reply('확인해볼게요');
  ok('WSR-09 애매한 답장: "아직 주문 확정 답변은 아닙니다", still asking for the reply; no 확인 button', /아직 주문 확정 답변은 아닙니다/.test(t.html()) && /답장 확인/.test(t.html()) && !/onclick="_srDecide\('ACCEPT'\)"/.test(t.html()), t.html());
  await reply('네 내일 보내드릴게요.');
  ok('WSR-10 정상 답장 → 주문이 확인됐어요 (2kg · 내일) + [확인] (one tap, the owner)', /주문이 확인됐어요/.test(t.html()) && /내일/.test(t.html()) && /_srDecide\('ACCEPT'\)">확인/.test(t.html()), t.html());
  await t.f._srDecide('ACCEPT');
  const st10 = await t.e.one(`select state, final_qty::text q from public.supplier_orders order by created_at desc limit 1`);
  ok('  → CONFIRMED 2 in the DB', st10.state === 'CONFIRMED' && st10.q === '2', st10);
  await order(2); await sendIt(); await reply('이번에는 kg당 18,000원입니다.');
  ok('WSR-11 가격 변경: kg당 18,000원 · 예상 합계 36,000원 · 이전 가격 아직 모름 → [이 가격으로 주문] [취소] [전화해서 확인]',
    /가격 확인이 필요해요/.test(t.html()) && /18,000원/.test(t.html()) && /36,000원/.test(t.html()) && /이전 가격/.test(t.html()) && /이 가격으로 주문/.test(t.html()), t.html());
  await t.f._srDecide('CANCEL');
  await order(2); await sendIt(); await reply('내일은 안 되고 모레 가능합니다.');
  ok('WSR-12 배송일 변경: 기존 기대 평일 기준 다음날 vs 거래처 제안 모레 → [모레 받아요]', /배송일이 달라졌어요/.test(t.html()) && /평일 기준 다음날/.test(t.html()) && /모레 받아요/.test(t.html()), t.html());
  await t.f._srDecide('ACCEPT_DELIVERY');
  await order(2); await sendIt(); await reply('이번 주는 물량이 없습니다.');
  ok('WSR-13 주문 불가 → [다른 거래처 찾기] → honest "아직 연결되지 않았어요" (ACTION_REQUIRED), then 취소',
    /이번에는 주문하기 어려워요/.test(t.html()) && (await t.f._srDecide('FIND_OTHER'), /아직 연결되지 않았어요/.test(t.html())) && (await t.f._srDecide('CANCEL'), /취소했어요/.test(t.html())), t.html());
  await order(2); await t.f._srDecide('CALL');
  ok('WSR-14 [이번엔 전화로] → 통화할 때 + number shown as text (no dialing) → 주문됐나요? 3 answers', /통화할 때/.test(t.html()) && /010-1234-5678/.test(t.html()) && /주문됐나요/.test(t.html()) && /주문 실패/.test(t.html()) && !/tel:/.test(t.html()), t.html());
  await t.f._srAct('phoneDiff'); t.set('srPhNote', '1kg만 된대요'); t.set('srPhQty', '1'); t.set('srPhWhen', ''); await t.f._srAct('phoneChanged');
  ok('  내용이 달라졌어요 → note + 1kg → 주문이 확인됐어요 (통화 후 사장님 확인)', /주문이 확인됐어요/.test(t.html()) && /루꼴라 1kg/.test(t.html()) && /통화 후 사장님 확인/.test(t.html()), t.html());
  await order(2, { draftOnly: true });
  ok('WSR-15 보내지 않고 문구만 확인: 연결 확인용 — not an order; closes with 취소', /연결 확인용 문구예요/.test(t.html()) && !/보냈어요/.test(t.html()) && (await t.f._srDecide('CANCEL'), true), t.html());
  const ev = await t.e.one(`select (select count(*) from public.supplier_order_events where kind = 'SENT_HUMAN_CONFIRMED') sent, (select count(*) from public.supplier_order_events where kind = 'CONFIRMED') conf,
    (select coalesce(sum(current_qty), 0)::text from public.items where store_id = 1) qty, (select string_agg(distinct payment_status, ',') from public.supplier_orders) pay`);
  ok('WSR-16 evidence + safety: 5 Human-confirmed sends, 4 confirmations, store stock unchanged (2), all UNSETTLED', Number(ev.sent) === 5 && Number(ev.conf) === 4 && ev.qty === '2' && ev.pay === 'UNSETTLED', ev);
  // vendor list: [자세히 ›] only for vendors with a recorded way of ordering
  const listEl = t.el('vendorList'); t.f.renderVendorList();
  ok('WSR-17 거래처 관리 list: [자세히 ›] on 루꼴라 농가 only', (listEl.innerHTML.match(/자세히 ›/g) || []).length === 1 && new RegExp(`_srOpenDetail\\(${vid}\\)`).test(listEl.innerHTML), listEl.innerHTML.slice(0, 300));
  // not signed in → told honestly, nothing happens
  const u = await makeEnv({ signedIn: false });
  await u.f._srOpenDetail(6);
  ok('WSR-18 not signed in → "로그인한 매장 운영자만" (toast), no screen opened, nothing sent', u.S.toasts.some(x => /로그인한 매장 운영자만/.test(x)) && !u.el('srOverlay').classList.on && u.S.fetches.length === 0, u.S.toasts);
  ok('WSR-19 no dev helpers / no automatic sending: no 목업 도우미 / FIELD / tel: / sms:; the ONLY network call is the supplier-route gateway; never _authClient().rpc / .from',
    !/목업|FIELD|다른 답장 시나리오|tel:|sms:/.test(BLOCK) && (BLOCK.match(/fetch\(/g) || []).length === 1 && /fetch\(_SR_URL,/.test(BLOCK) && !/_authClient\(\)\.(rpc|from)\(/.test(BLOCK)
      && t.S.fetches.length > 0 && t.S.fetches.every(x => x === 'https://proj.supabase.co/functions/v1/supplier-route/web'), (BLOCK.match(/목업|FIELD|다른 답장 시나리오|tel:|sms:|fetch\(|_authClient\(\)\.\w+/g) || []));
  ok('WSR-20 gateway envelope: an unknown action / an extra field / a bad order id are refused (400) before the database',
    (await (async () => { const r1 = await t.fetchRaw({ action: 'SEND_SMS' }), r2 = await t.fetchRaw({ action: 'VIEW', store_id: 1, sql: 'x' }), r3 = await t.fetchRaw({ action: 'SENT', order_id: 'x', message_hash: 'y' });
      return r1.status === 400 && r2.status === 400 && r3.status === 400; })()), '');
  console.log(`\n${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})();
