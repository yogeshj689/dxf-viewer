// Writes assets/libredwg/loader.mjs that re-exports the package's browser ES-module entry.
import fs from 'fs'; import path from 'path';
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const pick = (e) => typeof e === 'string' ? e : e && (pick(e.browser) || pick(e.import) || pick(e.module) || pick(e.default));
let entry = pick(pkg.exports && (pkg.exports['.'] ?? pkg.exports)) || pkg.module || pkg.browser || pkg.main;
if (typeof entry !== 'string') throw new Error('cannot find entry in package.json');
entry = entry.replace(/^\.\//, '');
if (!fs.existsSync(path.join(dir, entry))) throw new Error('entry not found: ' + entry);
fs.writeFileSync(path.join(dir, 'loader.mjs'), `export * from './${entry}';\n`);
console.log('libredwg entry:', entry, '| version', pkg.version, '| license', pkg.license, '| deps', JSON.stringify(pkg.dependencies || {}));
