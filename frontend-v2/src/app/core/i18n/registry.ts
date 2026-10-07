/**
 * Textos de cada pantalla (packs/): cada pack se registra solo al cargarse
 * el código que lo importa, así los ~80 kB de textos de Administración,
 * Ticketera, etc. no viajan en el bundle inicial. El núcleo (shell y lo
 * compartido) sigue en messages.ts.
 */
const PACK_ES: Record<string, string> = {};
const PACK_EN: Record<string, string> = {};

export function registerTexts(es: Record<string, string>, en: Record<string, string>): void {
  Object.assign(PACK_ES, es);
  Object.assign(PACK_EN, en);
}

export function packText(language: 'es' | 'en', key: string): string | undefined {
  return (language === 'en' ? PACK_EN[key] : undefined) ?? PACK_ES[key];
}
