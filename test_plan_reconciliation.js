/*
 * test_plan_reconciliation.js — Store1 Plan → Actual Reconciliation P0 (ZEROKITCHEN_STORE1_PLAN_ACTUAL_RECONCILIATION_P0_V0_1)
 *
 * A 발주표 plan (pending) that a verified actual order already fulfilled (server relation, get_plan_reconciliations) is not
 * actionable: it leaves the 발주표 / dedup / draft checks, the raw row is untouched, and one history line says where it went.
 * Server without the feature (rpc error) → empty relation list → exactly the old behaviour.
 * REAL functions from index.html, MOCK db — DB Write 0.
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
const SRC = [constLine('_fmtQty'), constLine('_PLAN_RECON_MS'), 'let _planRecon = { sid: null, map: new Map() };',
  ...['_loadPlanRecon', '_isReconciledPlan', '_actionablePlans', '_planReconNoteHtml', '_insertOrderIfNotDup', '_lpInsertDraft'].map(extractFn)].join('\n');

let pass = 0, fail = 0;
const ok = (id, cond, note) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${id}${note ? ' — ' + note : ''}`); };

// Production-shaped rows: #155 plan (pending) and #158 actual (ordered, SIKBOM MPLH11726161224), same item 65 / 5개
const P155 = { id: 155, store_id: 1, item_id: 65, item_name: '다진 마늘', qty: 5, unit: '개', status: 'pending' };
const A158 = { id: 158, store_id: 1, item_id: 65, item_name: '다진 마늘', qty: 5, unit: '개', status: 'ordered' };
const P154 = { id: 154, store_id: 1, item_id: 77, item_name: '스파게티니', qty: 12, unit: '개', status: 'pending' };
const REL = { plan_order_id: 155, actual_order_id: 158, relation_type: 'FULFILLED_BY_ACTUAL_ORDER', item_id: 65, item_name: '다진 마늘', plan_qty: 5, unit: '개',
  plan_status: 'pending', actual_status: 'ordered', supply_source: 'SIKBOM', supply_label: '식봄', external_order_ref: 'MPLH11726161224', verification: 'SYSTEM_VERIFIED' };

function env(rows, rpc) {
  const writes = [];
  const db = {
    rpc: async (name, args) => rpc(name, args),
    from(table) {
      const f = []; let inF = null, ins = null;
      const b = {
        select() { return b; }, eq(c, v) { f.push([c, v]); return b; }, in(c, a) { inF = [c, a]; return b; }, limit() { return b; }, order() { return b; },
        insert(r) { ins = r; writes.push({ table, row: r }); return b; },
        then(res) {
          if (ins) return res({ data: [ins], error: null });
          let out = table === 'order_requests' ? rows.slice() : [];
          for (const [c, v] of f) out = out.filter(r => r[c] === v);
          if (inF) out = out.filter(r => inF[1].includes(r[inF[0]]));
          res({ data: out, error: null });
        },
      };
      return b;
    },
  };
  const ctx = { console, db, SID: 1, _withTimeout: p => p };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.f = { _loadPlanRecon, _isReconciledPlan, _actionablePlans, _planReconNoteHtml, _insertOrderIfNotDup, _lpInsertDraft }; this.st = () => _planRecon;', ctx);
  return { f: ctx.f, st: ctx.st, writes };
}
const withRel = async (name) => name === 'get_plan_reconciliations' ? { data: [REL], error: null } : { data: null, error: { message: 'unknown' } };
const noFeature = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });

(async () => {
  // C1 relation loaded → #155 not actionable, #158 and other plans stay
  const e = env([P155, A158, P154], withRel);
  await e.f._loadPlanRecon(1);
  const act = e.f._actionablePlans([P155, A158, P154]).map(r => r.id);
  ok('C1 reconciled plan #155 leaves the actionable list; #158 (actual) and #154 (other plan) stay', JSON.stringify(act) === '[158,154]', JSON.stringify(act));
  ok('C2 raw rows untouched (no write; #155 still pending in the source)', e.writes.length === 0 && P155.status === 'pending' && A158.status === 'ordered');
  ok('C3 only a PENDING plan with a relation is hidden (an ordered row with the same id would stay)', e.f._isReconciledPlan(P155) && !e.f._isReconciledPlan({ ...P155, status: 'ordered' }));

  // C4 history line
  const note = e.f._planReconNoteHtml([P155]);
  ok('C4 history line "다진 마늘 5개 → 식봄 주문 기록 #158로 처리됨" (internal id label), no button', note.includes('다진 마늘 5개 → 식봄 주문 기록 #158로 처리됨') && !/<button/.test(note), note.replace(/<[^>]+>/g, ' | '));

  // C5 dedup: typing 다진 마늘 again finds the ACTUAL order (P0 guard path), never the fulfilled plan
  const d1 = await e.f._insertOrderIfNotDup({ store_id: 1, item_id: 65, item_name: '다진 마늘', qty: 5, unit: '개', status: 'pending' });
  ok('C5 _insertOrderIfNotDup → existing = #158 ordered (not #155) → no insert', d1.skipped && d1.existing.id === 158 && d1.existing.status === 'ordered' && e.writes.length === 0, JSON.stringify(d1.existing));

  // C6 draft check: a fulfilled plan does not count as "already in 발주표"
  const e2 = env([P155], withRel); await e2.f._loadPlanRecon(1);
  const r6 = await e2.f._lpInsertDraft({ item_id: 65, item_name: '다진 마늘', unit: '개', vendor_id: 2 }, 3, '개');
  ok('C6 _lpInsertDraft with only the fulfilled plan → ADDED (new plan), not IN_DRAFT', r6 === 'ADDED' && e2.writes.length === 1);

  // C7 server without the feature → old behaviour everywhere
  const e3 = env([P155, A158, P154], noFeature); await e3.f._loadPlanRecon(1);
  ok('C7 rpc missing → empty relation list → #155 stays (old behaviour)', JSON.stringify(e3.f._actionablePlans([P155, A158, P154]).map(r => r.id)) === '[155,158,154]');
  const d7 = await e3.f._insertOrderIfNotDup({ store_id: 1, item_id: 65, qty: 5, unit: '개', status: 'pending' });
  ok('C7b rpc missing → dedup returns the first row exactly as before', d7.skipped && d7.existing.id === 155);
  const r7 = await env([P155], noFeature).f._lpInsertDraft({ item_id: 65, item_name: '다진 마늘', unit: '개' }, 3, '개');
  ok('C7c rpc missing → draft check IN_DRAFT exactly as before', r7 === 'IN_DRAFT');

  // C8 a failed re-read keeps the last good list of the same store; another store never inherits it
  let fails = false;
  const e4 = env([P155], async n => fails ? { data: null, error: { message: 'timeout' } } : withRel(n));
  await e4.f._loadPlanRecon(1); fails = true; await e4.f._loadPlanRecon(1);
  ok('C8 same store, read fails → last good relation kept (#155 still hidden)', e4.f._isReconciledPlan(P155));
  await e4.f._loadPlanRecon(3);
  ok('C8b other store, read fails → empty (Store1 relations never applied to Store3)', !e4.f._isReconciledPlan(P155) && e4.st().sid === 3);

  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
