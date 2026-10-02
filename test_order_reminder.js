/*
 * test_order_reminder.js  — ZEROKITCHEN_WEB_HISTORICAL_NOTIFICATION_ACTION_SEPARATION_BOUNDED_BUILD_V0_1
 *
 * Contract: the order-cycle reminder card is a reference signal from past order
 * intervals. It is not the current shortage and must not read as a purchase instruction.
 *   - the card says what it is based on, and states the item's current need as decided
 *     by _orderNeedOf (it does not decide anything itself)
 *   - drawing it writes nothing
 *   - its button adds the PREVIOUS order quantity to the order table only after the
 *     quantity and its basis were shown and the operator confirmed
 *
 * The REAL function bodies are extracted from index.html (brace-matched) and run against
 * a MOCK Supabase client. No real DB, no network — DB Write 0.
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
const SRC = {};
for (const n of ['_orderNeedOf', '_renderOrderNeed', '_v3NeedLine', '_v3ReminderQty', 'v3AddToOrder', 'v3OrderNow', '_insertOrderIfNotDup',
  'checkOrderNotifications', 'renderV3Notifications', 'recordNotificationOnAction']) SRC[n] = extractFn(n);

// --- MOCK Supabase client: reads answer from `tables`, every write is recorded ---
function makeDb(tables) {
  const writes = [];
  function builder(table) {
    let single = false, inserted = null;
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, is() { return b; }, not() { return b; },
      gte() { return b; }, limit() { return b; }, order() { return b; },
      maybeSingle() { single = true; return b; }, single() { single = true; return b; },
      insert(p) { inserted = p; writes.push({ table, op: 'insert', payload: p }); return b; },
      update(p) { writes.push({ table, op: 'update', payload: p }); return b; },
      upsert(p) { writes.push({ table, op: 'upsert', payload: p }); return b; },
      then(resolve) {
        if (inserted !== null) { resolve({ data: single ? inserted : [inserted], error: null }); return; }
        const rows = tables[table] || [];
        resolve({ data: single ? (rows[0] || null) : rows, error: null });
      },
    };
    return b;
  }
  return { from: t => builder(t), _writes: writes };
}

const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().split('T')[0];
const item = (item_id, item_name, current_qty, target_qty, unit) => ({ item_id, item_name, current_qty, target_qty, unit, order_unit_qty: 1, order_unit_name: '' });
const pattern = (item_id, item_name, recommended_qty) => ({ store_id: 1, item_id, item_name, avg_cycle_days: 5, last_order_date: daysAgo(10), confidence_score: 'HIGH', recommended_qty });

const ITEMS = [item(4, '핫소스', 10, 6, '개'), item(174, '파인애플', 2, 6, '캔'), item(2, '양파', null, 6, 'kg'), item(9, '신규', 0, 0, '개')];

function makeEnv(patterns, opts = {}) {
  const db = makeDb({ item_usage_pattern: patterns });
  const SID = 1;
  const _items = ITEMS.map(i => ({ ...i }));
  let _orderRequests = [];
  const need = { innerHTML: null }, notif = { innerHTML: null, style: {}, querySelectorAll: () => [] };
  const document = {
    getElementById: id => (id === 'v3NotifContainer' ? notif : id === 'orderNeedCard' ? need : null),
    querySelector: () => null, querySelectorAll: () => [],
  };
  const localStorage = { getItem: () => null };
  const toasts = [], asked = [];
  const showToast = m => toasts.push(m);
  const renderOrder = async () => {};
  const confirm = opts.confirm === undefined ? undefined : (m => { asked.push(m); return opts.confirm; });
  const f = {};
  // eslint-disable-next-line no-eval
  const _orderNeedOf = eval(asExpr(SRC._orderNeedOf, '_orderNeedOf'));
  // eslint-disable-next-line no-eval
  const _renderOrderNeed = eval(asExpr(SRC._renderOrderNeed, '_renderOrderNeed'));
  // eslint-disable-next-line no-eval
  const _v3NeedLine = eval(asExpr(SRC._v3NeedLine, '_v3NeedLine'));
  // eslint-disable-next-line no-eval
  const _v3ReminderQty = eval(asExpr(SRC._v3ReminderQty, '_v3ReminderQty'));
  // eslint-disable-next-line no-eval
  const _insertOrderIfNotDup = eval(asExpr(SRC._insertOrderIfNotDup, '_insertOrderIfNotDup'));
  // eslint-disable-next-line no-eval
  const recordNotificationOnAction = eval(asExpr(SRC.recordNotificationOnAction, 'recordNotificationOnAction'));
  // eslint-disable-next-line no-eval
  const checkOrderNotifications = eval(asExpr(SRC.checkOrderNotifications, 'checkOrderNotifications'));
  // eslint-disable-next-line no-eval
  const v3OrderNow = eval(asExpr(SRC.v3OrderNow, 'v3OrderNow'));
  // eslint-disable-next-line no-eval
  const v3AddToOrder = eval(asExpr(SRC.v3AddToOrder, 'v3AddToOrder'));
  // eslint-disable-next-line no-eval
  const renderV3Notifications = eval(asExpr(SRC.renderV3Notifications, 'renderV3Notifications'));
  void f; void _orderRequests;
  return { db, notif, need, toasts, asked, _orderNeedOf, _renderOrderNeed, _v3NeedLine, _v3ReminderQty, v3AddToOrder, renderV3Notifications };
}
// one reminder card of the rendered container
const cardOf = (html, id) => html.split('<div class="v3-notif-card"').slice(1).find(s => s.startsWith(` data-item-id="${id}"`)) || '';
// this part of index.html writes Korean as \uXXXX escapes; decode before reading source text
const unesc = s => s.replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const neededIds = html => [...html.matchAll(/data-need-iid="(\d+)"/g)].map(m => m[1]);
const orders = env => env.db._writes.filter(w => w.table === 'order_requests');

let pass = 0, fail = 0, total = 0;
function check(name, cond, detail) {
  const ok = !!cond; total++;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const P = [pattern(4, '핫소스', 3), pattern(174, '파인애플', 6)];

  // CASE A  핫소스 10/6 with a reminder: not a shortage, not a purchase instruction
  {
    const env = makeEnv(P);
    await env.renderV3Notifications();
    env._renderOrderNeed();
    const html = env.notif.innerHTML, card = cardOf(html, 4);
    check('A1 need card does not list 핫소스 as needed', !neededIds(env.need.innerHTML).includes('4') && env._orderNeedOf(ITEMS[0]).state === 'SUFFICIENT', 'needed=' + neededIds(env.need.innerHTML).join(','));
    check('A2 reminder states its basis and that it is not the current shortage',
      html.includes('발주 주기 알림 — 과거 발주 간격 기준 참고 (현재 재고 부족과 별개)') && card.includes('핫소스 — 평소 발주 주기가 됐어요') && card.includes('평균 5일'), '');
    check('A3 reminder shows the current need verdict: 지금 부족하지 않음',
      card.includes('data-need-state="SUFFICIENT"') && card.includes('현재 10개 / 목표 6개 — 지금 부족하지 않음'), '');
    check('A4 no purchase-instruction wording (시키실 때예요 / 주문하기 / 발주 필요)',
      !/시키실 때예요|주문하기|발주 필요/.test(html) && card.includes('>발주표에 추가</button>'), '');
    check('A5 button is not the primary call when nothing is short', /class="v3-btn v3-btn-secondary v3-btn-add"/.test(card), '');
  }
  // CASE B  파인애플 2/6: the need stays 4캔 whether or not a reminder exists
  {
    const withP = makeEnv(P), without = makeEnv([]);
    await withP.renderV3Notifications(); await without.renderV3Notifications();
    withP._renderOrderNeed(); without._renderOrderNeed();
    const n = withP._orderNeedOf(ITEMS[1]);
    const card = cardOf(withP.notif.innerHTML, 174);
    check('B1 OrderNeed 4캔 unchanged, need card identical with / without reminders',
      n.state === 'NEEDED' && n.qty === 4 && n.unit === '캔' && withP.need.innerHTML === without.need.innerHTML && neededIds(withP.need.innerHTML).join(',') === '174', `${n.state} ${n.qty}${n.unit}`);
    check('B2 reminder repeats the need card verdict (현재 부족 4캔), primary button',
      card.includes('data-need-state="NEEDED"') && card.includes('현재 부족 4캔 (현재 2캔 / 목표 6캔)') && /class="v3-btn v3-btn-primary v3-btn-add"/.test(card), '');
  }
  // CASE C  drawing reminders writes nothing
  {
    const env = makeEnv(P);
    await env.renderV3Notifications();
    const empty = makeEnv([]);
    await empty.renderV3Notifications();
    check('C1 render (with and without reminders) -> 0 writes', env.db._writes.length === 0 && empty.db._writes.length === 0, `writes=${env.db._writes.length}/${empty.db._writes.length}`);
  }
  // CASE D  the button: quantity + basis shown, explicit confirmation, then one pending order
  {
    const no = makeEnv(P, { confirm: false });
    await no.v3AddToOrder(4, '핫소스', 3);
    check('D1 declined -> no order, no write at all', no.db._writes.length === 0 && no.asked.length === 1, `writes=${no.db._writes.length}`);
    check('D2 the question shows qty+unit, its source, and the current verdict',
      /^핫소스 3개을\(를\) 발주표에 추가할까요\?/.test(no.asked[0]) && no.asked[0].includes('알림 기준 수량입니다 (현재 부족량 기준이 아닙니다)') && no.asked[0].includes('현재 10개 / 목표 6개 — 지금 부족하지 않음'), JSON.stringify(no.asked[0]));
    const none = makeEnv(P);
    await none.v3AddToOrder(4, '핫소스', 3);
    check('D3 no confirmation available -> no order, no write', none.db._writes.length === 0, `writes=${none.db._writes.length}`);
    const yes = makeEnv(P, { confirm: true });
    await yes.v3AddToOrder(4, '핫소스', 3);
    const o = orders(yes);
    check('D4 confirmed -> exactly one pending order, previous qty, items.unit',
      o.length === 1 && o[0].op === 'insert' && o[0].payload.qty === 3 && o[0].payload.unit === '개' && o[0].payload.status === 'pending' && o[0].payload.item_id === 4,
      JSON.stringify(o.map(w => w.payload)));
    check('D5 confirmed order touches no stock and no audit', !yes.db._writes.some(w => w.table === 'items' || w.table === 'kitchen_operations'), yes.db._writes.map(w => w.table).join(','));
    check('D6 the rendered button goes through the confirming entry point', /onclick="v3AddToOrder\(4,'핫소스',3\)"/.test(cardOf((await (async () => { const e = makeEnv(P); await e.renderV3Notifications(); return e; })()).notif.innerHTML, 4)) && !/onclick="v3OrderNow\(/.test(unesc(SRC.renderV3Notifications)), '');
  }
  // ── Reminder quantity provenance (fail closed) ──
  // The stored quantity is usable only when it is a finite positive number. Anything else is
  // "no usable quantity": never replaced by 1, never ordered, never described as a past order.
  const INVALID = [['ZERO', 0], ['NULL', null], ['NEGATIVE', -1], ['NaN', NaN], ['text', 'abc'], ['empty', ''], ['blank', '  '],
    ['undefined', undefined], ['Infinity', Infinity], ['zero text', '0'], ['boolean', true],
    ['-0.5', -0.5], ['-Infinity', -Infinity], ['false', false],
    // text that is not a plain decimal number
    ['"3abc"', '3abc'], ['"3,000"', '3,000'], ['"true"', 'true'], ['"[3]"', '[3]'], ['"Infinity"', 'Infinity'], ['"NaN"', 'NaN'],
    ['"-1"', '-1'], ['"1e3"', '1e3'], ['"+3"', '+3'], ['".5"', '.5'], ['"0x10"', '0x10'],
    // structural / non-scalar input: must be refused by type, never coerced (Number([3]) === 3)
    ['[3]', [3]], ['[]', []], ['[1,2]', [1, 2]], ['["3"]', ['3']], ['[[3]]', [[3]]], ['{}', {}], ['{value:3}', { value: 3 }],
    ['new Number(3)', new Number(3)], ['new String("3")', new String('3')], ['Date', new Date(3)], ['function', () => 3],
    ['Symbol', Symbol('3')], ['BigInt', 3n], ['{valueOf}', { valueOf: () => 3 }], ['{toString}', { toString: () => '3' }]];
  // QA-QD  zero / null / negative / invalid: no usable quantity
  {
    const e0 = makeEnv(P);
    const accepted = INVALID.filter(([, v]) => e0._v3ReminderQty(v) !== null).map(([n, v]) => `${n}->${String(e0._v3ReminderQty(v))}`);
    check(`QA-QD _v3ReminderQty: all ${INVALID.length} invalid inputs -> null (scalars, text, arrays, objects, boxed)`, accepted.length === 0, accepted.length ? 'ACCEPTED: ' + accepted.join(' ') : 'accepted none');
    // ST  the array that used to pass: Number([3]) === 3
    {
      const env = makeEnv([pattern(4, '핫소스', [3])], { confirm: true });
      await env.renderV3Notifications();
      const card = cardOf(env.notif.innerHTML, 4);
      await env.v3AddToOrder(4, '핫소스', [3]);
      check('ST [3]: not a quantity, no button, direct entry asks nothing and writes nothing',
        env._v3ReminderQty([3]) === null && Number([3]) === 3 && !card.includes('v3-btn-add') && card.includes('알림 기준 수량 없음') &&
        env.asked.length === 0 && env.db._writes.length === 0 && orders(env).length === 0,
        `qty=${env._v3ReminderQty([3])} button=${card.includes('v3-btn-add')} asked=${env.asked.length} writes=${env.db._writes.length}`);
    }
    // SV  what IS accepted: a positive finite number, or a plain decimal string
    {
      const valid = [[3, 3], [3.5, 3.5], [0.5, 0.5], ['3', 3], ['3.5', 3.5], [' 3 ', 3]];
      const got = valid.map(([v]) => e0._v3ReminderQty(v));
      check('SV accepted: 3, 3.5, 0.5, "3", "3.5", " 3 " -> the number itself', valid.every(([, want], i) => got[i] === want && typeof got[i] === 'number'), JSON.stringify(got));
    }
    let cardsOk = true, writesOk = true, askedOk = true; const seen = [];
    for (const [n, v] of INVALID) {
      const env = makeEnv([pattern(4, '핫소스', v)], { confirm: true });
      await env.renderV3Notifications();
      const card = cardOf(env.notif.innerHTML, 4);
      const noBtn = !card.includes('v3-btn-add') && !card.includes('v3AddToOrder(') && !card.includes('v3OrderNow(');
      const says = card.includes('data-reminder-qty=""') && card.includes('알림 기준 수량 없음');
      cardsOk = cardsOk && noBtn && says && card.includes('넘기기');
      // even if the entry point is reached with that value, nothing is asked and nothing is written
      await env.v3AddToOrder(4, '핫소스', v);
      writesOk = writesOk && env.db._writes.length === 0;
      askedOk = askedOk && env.asked.length === 0 && env.toasts.length === 1 && env.toasts[0].includes('알림 기준 수량이 없어');
      seen.push(`${n}:${noBtn && says ? 'no-button' : 'BUTTON'}/${env.db._writes.length}w`);
    }
    check('QA-QD card: no add button, says no usable quantity, 넘기기 kept', cardsOk, seen.join(' '));
    check('QA-QD entry point: no question, no order, 0 writes even when confirm would say yes', writesOk && askedOk, '');
  }
  // QE  valid quantity 3: shown, asked, inserted — the same number everywhere
  {
    const env = makeEnv([pattern(4, '핫소스', 3)], { confirm: true });
    await env.renderV3Notifications();
    const card = cardOf(env.notif.innerHTML, 4);
    const before = env.db._writes.length;
    await env.v3AddToOrder(4, '핫소스', 3);
    const o = orders(env);
    check('QE valid 3: card 3개 = question 3개 = insert 3, described as reminder quantity',
      card.includes('data-reminder-qty="3"') && card.includes('알림 기준 수량 3개 (현재 부족량 아님)') && card.includes("v3AddToOrder(4,'핫소스',3)") &&
      before === 0 && env.asked.length === 1 && env.asked[0].startsWith('핫소스 3개을(를)') &&
      o.length === 1 && o[0].payload.qty === 3 && o[0].payload.unit === '개' && o[0].payload.status === 'pending',
      `card qty=${(/data-reminder-qty="([^"]*)"/.exec(card) || [])[1]} asked=${JSON.stringify((env.asked[0] || '').split('\n')[0])} insert=${JSON.stringify(o.map(w => w.payload.qty))}`);
    const str = makeEnv([pattern(4, '핫소스', '3')], { confirm: true });
    await str.v3AddToOrder(4, '핫소스', '3');
    check('QE numeric text "3" is the number 3 (insert qty 3, not "3")', orders(str).length === 1 && orders(str)[0].payload.qty === 3, JSON.stringify(orders(str).map(w => w.payload.qty)));
  }
  // QF  Production 핫소스: current 10 / target 6 / recommended_qty 0
  {
    const env = makeEnv([pattern(4, '핫소스', 0)], { confirm: true });
    await env.renderV3Notifications();
    env._renderOrderNeed();
    const html = env.notif.innerHTML, card = cardOf(html, 4);
    check('QF 핫소스 0: SUFFICIENT, not in the shortage list, reminder still shown',
      env._orderNeedOf(ITEMS[0]).state === 'SUFFICIENT' && !neededIds(env.need.innerHTML).includes('4') &&
      card.includes('현재 10개 / 목표 6개 — 지금 부족하지 않음') && card.includes('평소 발주 주기가 됐어요'), '');
    check('QF 핫소스 0: no invented quantity, no order path, no write',
      !/1개/.test(card) && card.includes('알림 기준 수량 없음') && !card.includes('v3-btn-add') && env.db._writes.length === 0, '');
  }
  // QG  provenance wording: nothing claims "previous order quantity", no 1 fallback in the source
  {
    const env = makeEnv([pattern(4, '핫소스', 3), pattern(174, '파인애플', 0)], { confirm: false });
    await env.renderV3Notifications();
    await env.v3AddToOrder(4, '핫소스', 3);
    const shown = env.notif.innerHTML + '\n' + env.asked.join('\n');
    const code = [SRC.renderV3Notifications, SRC.v3AddToOrder, SRC._v3ReminderQty].map(unesc).join('\n').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    check('QG no "직전 발주 수량" claim on screen or in the question; no "|| 1" fallback',
      !shown.includes('직전 발주') && !code.includes('직전 발주') && !/\|\|\s*1\b/.test(code) && !/recommended_qty\s*\|\|/.test(code), '');
  }

  // CASE E  unknown stock / no target on a reminder card
  {
    const env = makeEnv([pattern(2, '양파', 2), pattern(9, '신규', 1)]);
    await env.renderV3Notifications();
    const html = env.notif.innerHTML;
    check('E1 UNKNOWN -> 재고 확인 필요 (not a shortage), no target -> 판단 안 함',
      cardOf(html, 2).includes('현재 재고 모름 — 재고 확인 필요') && cardOf(html, 2).includes('data-need-state="UNKNOWN"') &&
      cardOf(html, 9).includes('목표 재고 없음 — 부족 여부 판단 안 함'), '');
    check('E2 an item the page does not know -> 판단 안 함', env._v3NeedLine(99999).text === '목표 재고 없음 — 부족 여부 판단 안 함', '');
  }
  // CASE F  "no reminders" is not "nothing to order"
  {
    const fresh = { ...pattern(4, '핫소스', 3), last_order_date: daysAgo(0) }; // a pattern exists, but it is not due
    const env = makeEnv([fresh]);
    await env.renderV3Notifications();
    const html = env.notif.innerHTML, src = unesc(SRC.renderV3Notifications);
    check('F1 empty state no longer says there is nothing to order today',
      html.includes('오늘 발주 주기 알림 없음') && !html.includes('시킬 게 없어요') && !src.includes('시킬 게 없어요') && env.db._writes.length === 0, JSON.stringify(html));
  }
  // CASE G  the reminder decides nothing: the verdict comes from _orderNeedOf only
  {
    const own = /target_qty|current_qty/.test(SRC._v3NeedLine) || /target_qty|current_qty/.test(SRC.renderV3Notifications) || /target_qty|current_qty/.test(SRC.checkOrderNotifications);
    check('G1 reminder code reads the verdict, never recomputes it; selection logic untouched by stock', !own && SRC._v3NeedLine.includes('_orderNeedOf('), `ownsCalc=${own}`);
  }

  console.log(`\nDB Write: 0 (mock client only, no network/supabase import)`);
  console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${total})`);
  process.exit(fail === 0 ? 0 : 1);
})();
