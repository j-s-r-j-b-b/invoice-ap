// Local dev server: serves static files and routes /api/<name> to api/<name>.js (same as Vercel).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
for (const f of ['.env.local', '.env']) {
  try { fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/).forEach((l) => { const m = l.match(/^\s*([\w]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch {}
}
const PORT = Number(process.env.PORT) || 5180;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^\w-]/g, '');
      const mod = await import(pathToFileURL(path.join(root, 'api', name + '.js')).href + '?t=' + Date.now());
      return await mod.default(req, res);
    }
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || url.pathname.startsWith('/api') || url.pathname.startsWith('/node_modules')) { res.statusCode = 403; return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e); res.statusCode = 500; res.end(String(e.message));
  }
}).listen(PORT, () => console.log(`Invoice AP running on http://localhost:${PORT}`));
