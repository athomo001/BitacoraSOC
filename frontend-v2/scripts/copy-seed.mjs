// Copia el seed territorial de Chile (../seed, fuente única del repo) a
// public/seed/ antes de compilar — Angular 22 rechaza assets fuera del
// workspace ("asset path must be within the workspace root"), así que no
// se puede referenciar ../seed directo desde angular.json. public/seed/
// está en .gitignore: el archivo versionado es solo el de ../seed.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '..', 'seed', 'territorial_units_chile.json');
const targetDir = join(root, 'public', 'seed');

if (!existsSync(source)) {
  console.warn(`copy-seed: no existe ${source} — el build sigue sin el seed de Chile.`);
  process.exit(0);
}
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, join(targetDir, 'territorial_units_chile.json'));
console.log('copy-seed: seed de Chile copiado a public/seed/');
