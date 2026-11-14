// CI test: DWG -> DXF with LibreDWG (wasm), then parse with the app's own DXF engine.
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import { pathToFileURL } from 'url';
const [assets, ...files] = process.argv.slice(2);
const core = fs.readFileSync(path.join(assets, 'dxf-core.js'), 'utf8');
const ctx = vm.createContext({ TextDecoder, console, Path2D: class { moveTo(){} lineTo(){} closePath(){} } });
vm.runInContext(core, ctx);
const lib = path.join(assets, 'libredwg');
const { LibreDwg, Dwg_File_Type } = await import(pathToFileURL(path.join(lib, 'loader.mjs')).href);
const dwg = await LibreDwg.create(path.join(lib, 'wasm') + path.sep);
let ok = 0, tested = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  tested++;
  const buf = new Uint8Array(fs.readFileSync(f));
  try {
    ctx.buf = buf; ctx.lib = dwg; ctx.ft = Dwg_File_Type.DWG;
    const r = vm.runInContext(`(()=>{ if(!isDWG(buf)) throw new Error('not a DWG');
      const d=readDWG(lib,ft,buf); const s=buildScene(d);
      return {ver:dwgVersionName(buf), entities:s.total, layers:Object.keys(s.counts).length,
              blocks:Object.keys(d.blocks).length, texts:s.texts.length, fills:s.fills.length, layerNames:Object.keys(s.counts).slice(0,6), strokes:s.strokes.length, unsupported:s.unsupported, bbox:s.bbox}; })()`, ctx);
    console.log('OK  ', path.basename(f), JSON.stringify(r));
    if (r.entities > 0) ok++;
  } catch (e) { console.log('FAIL', path.basename(f), e && e.stack || e); }
}
console.log(`${ok}/${tested} DWG samples converted and drawn`);
if (tested && !ok) process.exit(1);
