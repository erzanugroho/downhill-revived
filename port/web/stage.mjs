// The browser build as one folder of static files for hosting: port/web/www's files (_headers
// included) and build/web's modules under build/, the layout serve.mjs serves.
//   node port/web/stage.mjs [--out build/pages]
// Then Cloudflare (static assets of a Worker; www/_headers applies): npx wrangler deploy -c port/web/wrangler.jsonc
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), at = args.indexOf('--out');
const out = path.resolve(root, at < 0 ? 'build/pages' : args[at + 1]);
// build.py's modules: the threaded build's core, reactors and VU worker, the settings crate, the Rust renderer
const modules = ['dhd_core.wasm', 'graphics.wasm', 'gqueue.wasm', 'vu.wasm', 'dhd_settings.wasm', 'imports.json',
  'renderer/dhd_render.js', 'renderer/dhd_render_bg.wasm'];
const missing = modules.filter(m => !fs.existsSync(path.join(root, 'build/web', m)));
if (missing.length) { console.error(`stage: build/web lacks ${missing.join(', ')} (python port/web/build.py)`); process.exit(1); }
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'build/renderer'), { recursive: true });
const www = path.join(root, 'port/web/www');
for (const f of fs.readdirSync(www)) fs.copyFileSync(path.join(www, f), path.join(out, f));
for (const m of modules) fs.copyFileSync(path.join(root, 'build/web', m), path.join(out, 'build', m));
console.log(`stage: ${path.relative(root, out)}: ${fs.readdirSync(www).length} page files, ${modules.length} modules`);
