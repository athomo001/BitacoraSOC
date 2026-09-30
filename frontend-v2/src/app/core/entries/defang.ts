/**
 * "Defang IoCs" del composer de Bitácora (artboard "Shell principal"):
 * vuelve inofensivos los indicadores antes de guardarlos, para que nadie los
 * abra por accidente al leer la entrada o el correo que sale de ella.
 *
 *   https://malo.example.com/x  →  hxxps://malo[.]example[.]com/x
 *   185.220.1.1                 →  185[.]220[.]1[.]1
 *
 * Solo toca URLs e IPv4 (no cualquier palabra con punto: "v2.1" o
 * "archivo.txt" quedan igual). Es idempotente: lo ya defangeado no cambia.
 */
const URL_RE = /\b(h)(tt)(ps?:\/\/)([^\s/?#<>"'`]+)/gi;
const OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
const IPV4_RE = new RegExp(`\\b${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}\\b`, 'g');

export function defang(text: string): string {
  return (
    text
      // "tt" → "xx" respetando mayúsculas (HTTPS → HXXPS); los puntos del host → [.]
      .replace(URL_RE, (_m, h: string, tt: string, rest: string, host: string) => `${h}${tt === 'TT' ? 'XX' : 'xx'}${rest}${host.replace(/\./g, '[.]')}`)
      .replace(IPV4_RE, (ip) => ip.replace(/\./g, '[.]'))
  );
}
