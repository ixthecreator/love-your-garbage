import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
if (!destination) throw new Error('Provide an absolute output HTML path.');
const [template, css, scene, app, model] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'styles.css'), 'utf8'),
  readFile(resolve(root, 'scene-bundle.js'), 'utf8'),
  readFile(resolve(root, 'app.js'), 'utf8'),
  readFile(resolve(root, 'assets/tabletop-scan.glb'))
]);
const safeScript = text => text.replace(/<\/script/gi, '<\\/script');
const output = template
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`)
  .replace('<script src="scene-bundle.js"></script>', () => `<script>${safeScript(scene)}</script>`)
  .replace(/<script src="app\.js(?:\?[^"]*)?"><\/script>/, () => `<script type="application/json" id="model-data">${JSON.stringify({ base64: model.toString('base64') })}</script>\n  <script>${safeScript(app)}</script>`);
await writeFile(resolve(destination), output, 'utf8');
console.log(JSON.stringify({ file: resolve(destination), bytes: Buffer.byteLength(output), modelBytes: model.length }));
