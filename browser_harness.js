// browser_harness.js — headless Edge/Chrome (CDP) 로 index.html 을 여는 테스트 도구 (test_chat_dock.js / test_chat_persist.js 공용)
// 네트워크: supabase-js CDN 만 허용. 채팅 RPC(zk_chat_append / zk_chat_thread_page / zk_chat_thread)와 zk_pe_scope_refs 는 메모리 mock 이 답한다. 나머지(Supabase 등)는 전부 차단 → DB Write 0.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');

const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// before/after 비교용: 홈 dock 이 들어오기 직전 버전 (없으면 null)
function oldHtml(dir) {
  try {
    const git = (...a) => execFileSync('git', a, { cwd: dir, maxBuffer: 64 << 20 });
    const intro = git('log', '--reverse', '--format=%H', '-S', 'id="homeDock"', '--', 'index.html').toString().trim().split('\n')[0];
    if (!intro) return null;
    const h = git('show', `${intro}~1:index.html`);
    return h.includes('id="homeDock"') ? null : h;
  } catch { return null; }
}

// 채팅 RPC mock: 서버(zk_chat_*)와 같은 규칙 — message_id 중복 = DUPLICATE / 다른 내용 = CONFLICT, 요청으로 thread 찾기, 매장 최근 thread
function chatMock() {
  const m = { msgs: [], calls: [], fail: false, seq: 0 };
  m.handle = (fn, a) => {
    m.calls.push({ fn, args: a });
    if (m.fail || (m.failFn && m.failFn.includes(fn))) return [503, { message: 'unavailable' }];
    if (fn === 'zk_chat_append') {
      const o = m.msgs.find(x => x.message_id === a.p_message_id);
      if (o) return [200, { code: o.body === a.p_body && o.thread_id === a.p_thread_id ? 'DUPLICATE' : 'CONFLICT' }];
      if (m.msgs.some(x => x.thread_id === a.p_thread_id && x.store_id !== a.p_store_id)) return [200, { code: 'FORBIDDEN' }];
      const row = { seq: ++m.seq, message_id: a.p_message_id, store_id: a.p_store_id, thread_id: a.p_thread_id, role: a.p_role, body: a.p_body, purchase_request_id: a.p_purchase_request_id || null, ref: a.p_ref || null, created_at: new Date(Date.now() + m.seq).toISOString() };
      m.msgs.push(row);
      return [200, { code: 'APPENDED', seq: row.seq }];
    }
    if (fn === 'zk_chat_thread_page') {   // 서버와 같은 규칙: 커서(seq) 이전의 최근 p_turns 턴 (턴 경계 = HUMAN), 최대 40건, has_more
      const mine = m.msgs.filter(x => x.store_id === a.p_store_id);
      let thread = a.p_thread_id || null;
      if (!thread) { const hit = a.p_purchase_request_id ? mine.filter(x => x.purchase_request_id === a.p_purchase_request_id).pop() : mine[mine.length - 1]; thread = hit ? hit.thread_id : null; }
      if (!thread) return [200, { code: 'OK', thread_id: null, messages: [], has_more: false, cursor: null, request_has_messages: false }];
      const before = a.p_before_seq == null ? Infinity : a.p_before_seq, turns = Math.min(Math.max(a.p_turns || 2, 1), 10);
      const th = mine.filter(x => x.thread_id === thread && x.seq < before);
      const humans = th.filter(x => x.role === 'HUMAN').map(x => x.seq).reverse();
      const from = humans.length >= turns ? humans[turns - 1] : 0;
      const page = th.filter(x => x.seq >= from).slice(-40);
      const cursor = page.length ? page[0].seq : null;
      const msgs = page.map(({ seq, message_id, role, body, purchase_request_id, ref, created_at }) => ({ seq, message_id, role, body, purchase_request_id, ref, created_at }));
      return [200, { code: 'OK', thread_id: thread, messages: msgs, cursor, has_more: cursor != null && mine.some(x => x.thread_id === thread && x.seq < cursor),
        request_has_messages: !!a.p_purchase_request_id && mine.some(x => x.thread_id === thread && x.purchase_request_id === a.p_purchase_request_id) }];
    }
    if (fn === 'zk_pe_scope_refs') return m.refs ? [200, m.refs] : [404, { message: 'unknown' }];
    if (fn === 'zk_chat_thread') {
      const mine = m.msgs.filter(x => x.store_id === a.p_store_id);
      const hit = a.p_purchase_request_id ? mine.filter(x => x.purchase_request_id === a.p_purchase_request_id).pop() : mine[mine.length - 1];
      if (!hit) return [200, { code: 'OK', thread_id: null, messages: [], request_has_messages: false }];
      const msgs = mine.filter(x => x.thread_id === hit.thread_id).map(({ message_id, role, body, purchase_request_id, ref, created_at }) => ({ message_id, role, body, purchase_request_id, ref, created_at }));
      return [200, { code: 'OK', thread_id: hit.thread_id, messages: msgs, request_has_messages: !!a.p_purchase_request_id }];
    }
    return [404, { message: 'unknown' }];
  };
  return m;
}

async function launch({ newHtml, old, mock } = {}) {
  const exe = BROWSERS.find(p => fs.existsSync(p)); if (!exe) throw new Error('no Edge/Chrome');
  const port = 9300 + Math.floor(Math.random() * 600);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-br-'));
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 100 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(100); } }
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waits = new Map(), handlers = [], blocked = new Set();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && waits.has(m.id)) { const w = waits.get(m.id); waits.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); } else handlers.forEach(h => h(m)); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waits.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const json = (rid, status, body) => send('Fetch.fulfillRequest', { requestId: rid, responseCode: status, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }).catch(() => {});
  handlers.push(m => {
    if (m.method !== 'Fetch.requestPaused') return;
    const u = m.params.request.url, rid = m.params.requestId;
    const rpc = u.match(/\/rest\/v1\/rpc\/(zk_(?:chat|pe)_[a-z_]+)/);
    if (u.startsWith('http://zk.test/')) {
      const body = (u.includes('/old') ? old : newHtml).toString('base64');
      send('Fetch.fulfillRequest', { requestId: rid, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body }).catch(() => {});
    } else if (/^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/.test(u)) send('Fetch.continueRequest', { requestId: rid }).catch(() => {});
    else if (rpc && mock && m.params.request.method === 'POST') { const [st, b] = mock.handle(rpc[1], JSON.parse(m.params.request.postData || '{}')); const d = mock.delay && mock.delay[rpc[1]]; d ? setTimeout(() => json(rid, st, b), d) : json(rid, st, b); }
    else if (rpc && mock) send('Fetch.fulfillRequest', { requestId: rid, responseCode: 204, responseHeaders: [{ name: 'access-control-allow-origin', value: '*' }, { name: 'access-control-allow-headers', value: '*' }, { name: 'access-control-allow-methods', value: 'POST' }] }).catch(() => {});
    else { blocked.add(new URL(u).host); send('Fetch.failRequest', { requestId: rid, errorReason: 'BlockedByClient' }).catch(() => {}); }
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const open = async (url, w = 390, h = 844, mobile = true) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i++) { await sleep(100); try { if (await ev(`return document.readyState === 'complete' && typeof _renderAgentHome === 'function'`)) break; } catch {} }
    await sleep(1200);   // 앱의 첫 로딩(네트워크 차단 → 실패)이 끝나게 둔다
    await ev(`document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-input')); return 1`);
  };
  const key = async (sel, k) => {
    await ev(`document.querySelector(${JSON.stringify(sel)}).focus(); return 1`);
    const code = k === ' ' ? 'Space' : k, vk = k === ' ' ? 32 : 13, text = k === ' ' ? ' ' : '\r';
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
    await sleep(50);
  };
  const shot = async file => fs.writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const close = () => { try { ws.close(); } catch {} try { proc.kill(); } catch {} setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }, 1500); };
  return { ev, open, key, shot, close, send, blocked };
}

function checker() {
  let pass = 0, fail = 0;
  const check = (name, ok, info) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(info).slice(0, 1500)}`); };
  const done = (blocked) => {
    console.log(`\nnetwork blocked (never reached): ${[...(blocked || [])].join(', ') || 'none'}`);
    console.log('DB Write: 0 (network blocked; chat RPC answered by an in-memory mock)');
    console.log(`RESULT: ${pass} PASS / ${fail} FAIL (of ${pass + fail})`);
    setTimeout(() => process.exit(fail === 0 ? 0 : 1), 300);
  };
  return { check, done, fail: () => fail };
}

module.exports = { launch, chatMock, oldHtml, checker, sleep };
