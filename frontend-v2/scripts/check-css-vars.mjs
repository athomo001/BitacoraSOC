// Falla si algún estilo usa var(--x) sin que --x esté definida en algún lado.
// stylelint no lo detecta y el navegador lo ignora en silencio: así pasó
// --accent-cyan (Fases 10-13), que dejó botones sin fondo y con texto casi
// invisible. Revisa .css/.scss, los `styles` inline de los componentes .ts y
// los .html (ahí se definen variables con [style.--x]). Se excluye el login:
// sus 6 temas legacy traen paletas propias (spec/06 §8.3).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(css|scss|ts|html)$/.test(name) && !name.endsWith('.spec.ts') && !path.includes(join('features', 'login'))) files.push(path);
  }
})(root);

const defined = new Set();
const used = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  // setProperty('--x', …) y [style.--x] también definen variables en tiempo de ejecución.
  for (const m of text.matchAll(/(?:setProperty\(\s*['"]|\[style\.)(--[\w-]+)/g)) defined.add(m[1]);
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    // var(--x, fallback) tiene respaldo explícito: no es un error.
    if (m[2] === ')') used.push({ name: m[1], file });
  }
}

// Variables que inyecta Angular Material (mat.theme en material-theme.scss).
const isMaterial = (name) => name.startsWith('--mat-') || name.startsWith('--mdc-');
const missing = used.filter((u) => !defined.has(u.name) && !isMaterial(u.name));

// Cada tema de tokens.css debe definir la misma paleta: si al claro o al rosa
// les falta un color, heredan el del oscuro sin que nadie lo note (pasó con
// el semáforo en las Fases 10-13).
const tokens = readFileSync(join(root, 'styles', 'tokens.css'), 'utf8');
const themes = new Map();
for (const block of tokens.matchAll(/\[data-theme="(\w+)"\]\s*\{([^}]*)\}/g)) {
  themes.set(block[1], new Set([...block[2].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])));
}
const palette = new Set([...themes.values()].flatMap((vars) => [...vars]));
const incomplete = [...themes].flatMap(([theme, vars]) =>
  [...palette].filter((name) => !vars.has(name)).map((name) => `${name} falta en el tema "${theme}"`),
);

if (missing.length > 0 || incomplete.length > 0) {
  if (missing.length > 0) console.error('Variables CSS usadas pero nunca definidas:');
  for (const { name, file } of missing) console.error(`  ${name}  (${relative(root, file)})`);
  if (incomplete.length > 0) console.error('Temas con la paleta incompleta (styles/tokens.css):');
  for (const line of incomplete) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`OK: ${used.length} usos de var(--…) definidos; ${themes.size} temas con paleta completa (${palette.size} colores).`);
