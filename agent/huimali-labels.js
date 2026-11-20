// 繪馬梨入庫工具「🏷 列印籃子標籤」的本機送印入口（給 D:\AI Design Project\shipment\server.js 用）
//
// 網頁（https://jay77jay.github.io/huimali-tools/）POST http://localhost:3096/agent/labels
//   標頭：Content-Type: application/json、X-Agent: 1
//   內容：{ path:'繪馬梨1117入/繪馬梨1117入-籃子標籤-0M5FV311.pdf', labels:[['1001','王小明'],…], printer:'MPC5502_厚紙', settings:'noscale,portrait' }
// 處理：用 Chrome／Edge 無頭模式把標籤排成 A4 PDF（3×10＝每頁 30 張，跟網頁 body.lbl #lblArea 同版面）
//       → 存到資料根目錄（E:\USER_不能刪\Downloads）下的 path（同名已存在就加 -2、-3…）
//       → 呼叫 server.js 原本 /agent/print 用的送印函式（SumatraPDF）
// 回應：{ ok:true, path:'繪馬梨1117入\\繪馬梨1117入-籃子標籤-0M5FV311.pdf', count:58, pages:2 }
//
// 安全：只接受 jay77jay.github.io 和 localhost 來源、一定要 X-Agent 標頭；只收標籤文字（不收 HTML）；
//       印表機只能是 ALLOWED_PRINTERS；路徑不能跑出資料根目錄。
//
// 接到 server.js（在處理請求的最前面加，假設 server.js 已有 ROOT 與送印函式）：
//   const huimaliLabels = require('./huimali-labels.js');   // 把這個檔案複製到 server.js 同一個資料夾
//   …在 http.createServer((req,res)=>{ 裡面最前面：
//   if (req.url.split('?')[0] === '/agent/labels')
//     return huimaliLabels.handle(req, res, { root: ROOT, print: (absPdf, printer, settings) => 原本送印函式(absPdf, printer, settings) });
//   print 回傳 Promise 即可（失敗就 throw）。

const fs = require('fs'), path = require('path'), os = require('os');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const ALLOWED_ORIGINS = ['https://jay77jay.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080', 'http://localhost:3096', 'http://127.0.0.1:3096'];
const ALLOWED_PRINTERS = ['MPC5502_厚紙'];
const BROWSERS = [
  process.env.HM_BROWSER,   // 測試或特殊安裝位置用
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const CSS = `@page{size:A4;margin:0}html,body{margin:0}
#a{display:grid;grid-template-columns:repeat(3,70mm);grid-auto-rows:29.7mm}
.lb{box-sizing:border-box;padding:2mm 4mm;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:0;overflow:hidden;font-family:Arial,"Microsoft JhengHei","Segoe UI Emoji",sans-serif;color:#000}
.lb .i{font-size:32pt;font-weight:800;line-height:1.05;white-space:nowrap}.lb .n{font-size:13pt;line-height:1.2;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cors(req, res) {
  const o = req.headers.origin;
  if (o && ALLOWED_ORIGINS.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Agent');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');   // Chrome 從 https 網頁連 localhost 要這個
  }
  return !o || ALLOWED_ORIGINS.includes(o);
}
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function readBody(req, max = 2e6) {
  return new Promise((ok, bad) => { let n = 0; const ch = [];
    req.on('data', c => { n += c.length; if (n > max) { bad(new Error('內容太大')); req.destroy(); } else ch.push(c); });
    req.on('end', () => ok(Buffer.concat(ch).toString('utf8'))); req.on('error', bad); });
}
function freeName(abs) {
  if (!fs.existsSync(abs)) return abs;
  const { dir, name, ext } = path.parse(abs);
  for (let i = 2; ; i++) { const p = path.join(dir, `${name}-${i}${ext}`); if (!fs.existsSync(p)) return p; }
}
function toPdf(html, outPdf) {
  const exe = BROWSERS.find(p => p && fs.existsSync(p));
  if (!exe) return Promise.reject(new Error('找不到 Chrome 或 Edge'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-lbl-')), src = path.join(tmp, 'lbl.html');
  fs.writeFileSync(src, html, 'utf8');
  return new Promise((ok, bad) => execFile(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-pdf-header-footer',
    `--user-data-dir=${path.join(tmp, 'p')}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--print-to-pdf=${outPdf}`, pathToFileURL(src).href], { timeout: 45000 },
    err => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
      if (err && !fs.existsSync(outPdf)) return bad(new Error('產生 PDF 失敗：' + err.message));
      fs.existsSync(outPdf) ? ok() : bad(new Error('產生 PDF 失敗')); }));
}

async function handle(req, res, { root, print }) {
  if (!cors(req, res)) return send(res, 403, { ok: false, error: '不允許的來源' });
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: '只接受 POST' });
  if (req.headers['x-agent'] !== '1') return send(res, 403, { ok: false, error: '缺少 X-Agent 標頭' });
  try {
    const b = JSON.parse(await readBody(req));
    const labels = Array.isArray(b.labels) ? b.labels.filter(x => Array.isArray(x) && x[0]).map(x => [String(x[0]).slice(0, 20), String(x[1] || '').slice(0, 60)]) : [];
    if (!labels.length || labels.length > 600) return send(res, 400, { ok: false, error: '標籤張數不對' });
    if (!ALLOWED_PRINTERS.includes(b.printer)) return send(res, 400, { ok: false, error: '不允許的印表機：' + b.printer });
    const rel = String(b.path || '').replace(/\//g, path.sep);
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(path.resolve(root) + path.sep) || !/\.pdf$/i.test(abs)) return send(res, 400, { ok: false, error: '路徑不對' });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const out = freeName(abs);
    const html = `<!doctype html><meta charset=utf-8><style>${CSS}</style><div id=a>${labels.map(([u, n]) => `<div class="lb"><span class="i">${esc(u)}</span><span class="n">${esc(n)}</span></div>`).join('')}</div>`;
    await toPdf(html, out);
    await print(out, b.printer, String(b.settings || 'noscale,portrait'));
    send(res, 200, { ok: true, path: path.relative(root, out), count: labels.length, pages: Math.ceil(labels.length / 30) });
  } catch (e) { send(res, 500, { ok: false, error: e.message }); }
}
module.exports = { handle };
