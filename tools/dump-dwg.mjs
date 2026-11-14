import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url';
const [lib, ...files] = process.argv.slice(2);
const m = await import(pathToFileURL(path.join(lib, 'loader.mjs')).href);
console.log('EXPORTS', Object.keys(m).join(','));
const dwg = await m.LibreDwg.create(path.join(lib, 'wasm') + path.sep);
const cut = (o, n = 1800) => { const s = JSON.stringify(o, (k, v) => typeof v === 'bigint' ? String(v) : (v instanceof Uint8Array ? `[bytes ${v.length}]` : v)); return s && s.length > n ? s.slice(0, n) + '…' : s; };
for (const f of files) {
  const buf = fs.readFileSync(f); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  console.log('=== FILE', path.basename(f));
  try {
    const ptr = dwg.dwg_read_data(ab, m.Dwg_File_Type ? m.Dwg_File_Type.DWG : 0);
    const db = dwg.convert(ptr);
    console.log('DBKEYS', Object.keys(db));
    console.log('HEADER', cut(db.header, 600));
    console.log('TABLES', Object.keys(db.tables || {}));
    for (const [k, v] of Object.entries(db.tables || {})) console.log('TABLE', k, cut(v, 900));
    console.log('OBJECTS', cut(Object.keys(db.objects || {})));
    const ents = db.entities || [];
    console.log('NENT', ents.length);
    const seen = {};
    for (const e of ents) { const t = e.type; seen[t] = (seen[t] || 0) + 1; if (seen[t] <= 2) console.log('ENT', t, cut(e)); }
    console.log('COUNTS', cut(seen));
    if (fs.existsSync('/tmp/done')) {} else {
      const br = db.tables && db.tables.BLOCK_RECORD;
      console.log('BLOCKREC', cut(br && (br.entries || br).slice ? (br.entries || br).slice(0, 3) : br, 4000));
      fs.writeFileSync('/tmp/done', '1');
    }
    dwg.dwg_free(ptr);
  } catch (e) { console.log('ERR', e && e.stack || e); }
}
