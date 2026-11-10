// The built app (out/) for the click tests, served like the container does it: a folder gets its index.html
import {readFile, stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname, join, normalize, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../out/', import.meta.url));
const port = Number(process.env.PORT ?? 3123);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

createServer(async (req, res) => {
  // (an absolute path normalized can't climb out of out/)
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname));
  let file = join(root, path);
  if (!(file + sep).startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {'content-type': TYPES[extname(file)] ?? 'application/octet-stream'}).end(body);
  } catch {
    res.writeHead(404, {'content-type': 'text/plain'}).end('not found');
  }
}).listen(port, () => console.log(`out/ on http://localhost:${port}`));
