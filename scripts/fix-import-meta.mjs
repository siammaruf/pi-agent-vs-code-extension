import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const outfile = process.argv[2] || join(process.cwd(), 'out', 'extension.js');

let code = readFileSync(outfile, 'utf-8');

// Fix esbuild's broken import.meta polyfill in CJS output.
// esbuild generates `var import_meta = {};` which makes `import_meta.url` undefined.
// This causes `fileURLToPath(undefined)` to throw:
//   "The 'path' argument must be of type string or an instance of URL. Received undefined"
// We replace all instances with a proper URL derived from __filename.
const original = code;
code = code.replace(
  /var import_meta(\d*) = \{\};/g,
  'var import_meta$1 = { url: require("url").pathToFileURL(__filename).href };'
);

if (code === original) {
  console.log('[fix-import-meta] No import_meta placeholders found, skipping.');
} else {
  writeFileSync(outfile, code, 'utf-8');
  console.log('[fix-import-meta] Patched import_meta placeholders in', outfile);
}
