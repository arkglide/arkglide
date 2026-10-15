import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function serveStatic(root, port = 8080) {
  root = path.resolve(root);
  const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.png':'image/png','.wav':'audio/wav','.txt':'text/plain; charset=utf-8'};
  const server = createServer(async (req,res) => {
    try {
      let url = new URL(req.url, 'http://localhost'), pathname = decodeURIComponent(url.pathname);
      const file = path.resolve(root, '.' + pathname);
      if (file !== root && !file.startsWith(root + path.sep)) {res.writeHead(403); res.end('Forbidden');return;}
      const info = await stat(file);
      if (info.isDirectory() && !pathname.endsWith('/')) {res.writeHead(301,{Location:url.pathname+'/'+url.search});res.end();return;}
      const target = info.isDirectory() ? path.join(file,'index.html') : file;
      const raw = await readFile(target);
      res.writeHead(200, {'Content-Type':mime[path.extname(target)] || 'application/octet-stream','Content-Length':raw.length,'Cache-Control':'no-cache'});res.end(raw);
    } catch {res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
  });
  return new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{
      server.removeListener('error',reject);
      resolve(server);
    });
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || '.'; const port = Number(process.argv[3] || 8080);
  await serveStatic(root,port);console.log(`Static server: http://127.0.0.1:${port}/`);
}
