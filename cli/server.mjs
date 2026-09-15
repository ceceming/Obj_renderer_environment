import http from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.tga': 'image/x-tga', '.tif': 'image/tiff',
  '.obj': 'text/plain', '.mtl': 'text/plain', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.fbx': 'application/octet-stream',
  '.stl': 'application/octet-stream', '.ply': 'application/octet-stream',
  '.dae': 'model/vnd.collada+xml', '.3mf': 'application/octet-stream',
  '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr',
  '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2', '.svg': 'image/svg+xml'
};

/**
 * A minimal static server with two roots: the built app, and the directory the
 * user's model lives in. Serving the model over http (rather than file://)
 * keeps the browser's module and CORS rules happy, and means relative texture
 * paths inside an MTL resolve exactly as they would on a website.
 */
export function startServer({ appRoot, assetRoots = {}, port = 0 }) {
  // Resolve the roots up front: the containment checks below compare absolute
  // paths, so a relative root would reject every request as out-of-bounds.
  appRoot = resolve(appRoot);
  assetRoots = Object.fromEntries(Object.entries(assetRoots).map(([k, v]) => [k, resolve(v)]));

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let filePath = null;

      const assetMatch = url.pathname.match(/^\/assets-([^/]+)\/(.*)$/);
      if (assetMatch) {
        const [, key, rest] = assetMatch;
        const root = assetRoots[key];
        if (root) {
          const candidate = resolve(root, decodeURIComponent(rest));
          // Never serve outside the declared root.
          if (candidate === root || candidate.startsWith(root + sep)) filePath = candidate;
        }
      } else {
        const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const candidate = resolve(join(appRoot, rel));
        if (candidate.startsWith(appRoot)) filePath = candidate;
      }

      if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }

      res.writeHead(200, {
        'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store'
      });
      createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(err.message));
    }
  });

  return new Promise((resolvePromise) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolvePromise({
        server,
        port: address.port,
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}
