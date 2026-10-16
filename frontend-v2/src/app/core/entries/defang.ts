/**
 * "Defang IoCs" (Bitácora y Reportes): vuelve inofensivos los indicadores
 * para que nadie los abra por accidente al leer la entrada o el correo.
 *
 *   https://malo.example.com/x  →  hxxps://malo[.]example[.]com/x
 *   ftp://files.malo.ru         →  fxp://files[.]malo[.]ru
 *   www.phishing-banco.cl       →  www[.]phishing-banco[.]cl
 *   atacante@evil.ru            →  atacante@evil[.]ru
 *   185.220.1.1:8080            →  185[.]220[.]1[.]1:8080
 *
 * Un dominio suelto se reconoce por su terminación (.com, .cl, .ru…), así
 * "archivo.exe", "reporte.txt" o "v2.1" quedan igual. Las terminaciones que
 * también son extensiones de archivo (.md, .py, .zip…) solo cuentan con
 * "www." delante o dentro de un enlace. Lo ya defangeado no cambia.
 */

// Genéricos comunes y los más vistos en campañas.
const GENERIC = new Set(
  ('com net org info biz edu gov mil int arpa io co me tv cc ws app dev xyz top site online club shop store tech live ' +
    'link click download stream world space website cloud host email digital network news blog page fun icu buzz work ' +
    'support help services finance bank pro mobi name asia tel travel jobs cat onion bit lol win bid loan date racing ' +
    'review party trade science men webcam cricket country kim gdn rest bar best monster cyou sbs quest vip ltd group ' +
    'company today solutions agency center systems global media zone life one')
    .split(' '),
);

// Dominios de país (ISO 3166 y los .uk/.eu/.su que se ven en la práctica).
const COUNTRY = new Set(
  ('ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cd cf cg ch ' +
    'ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gd ge gf gg gh gi gl ' +
    'gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz ' +
    'la lb lc li lk lr ls lt lu lv ly ma mc mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np ' +
    'nr nu nz om pa pe pf pg ph pk pm pn pr pt pw qa re ro ru rw sa sb sc sd se sg si sk sl sm sn sr ss st su sv sx sy sz tc ' +
    'td tf tg th tj tk tl tm tn to tr tt tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ye yt za zm zw')
    .split(' '),
);

// Terminaciones que también son extensiones de archivo: solo con "www." delante.
const AMBIGUOUS = new Set('md py sh pl rs ps so zip mov app one download'.split(' '));

const SCHEME_RE = /\b(h)(tt)(ps?:\/\/)([^\s/?#<>"'`)\]]+)|\b(f)(t)(ps?:\/\/)([^\s/?#<>"'`)\]]+)/gi;
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_RE = new RegExp(`(?<![\\d.])${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}(?![\\d]|\\.\\d)`, 'g');
// Etiquetas de dominio separadas por puntos; no sigue si viene de un [.] ya puesto.
const DOMAIN_RE = /(?<![\w.\-[\]])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+)([a-z]{2,24})(?![\w-]|\.[a-z0-9])/gi;

function isDomain(labels: string, tld: string): boolean {
  const t = tld.toLowerCase();
  if (AMBIGUOUS.has(t)) return /^www\./i.test(labels);
  return GENERIC.has(t) || COUNTRY.has(t);
}

/** Defang con la cantidad de indicadores que tocó (para avisar si no había nada). */
export function defangWithCount(text: string): { text: string; count: number } {
  let count = 0;
  const dots = (s: string) => s.replace(/\./g, '[.]');
  let out = text.replace(SCHEME_RE, (_m, h, tt, rest, host, f, t, frest, fhost) => {
    count++;
    if (h) return `${h}${tt === 'TT' ? 'XX' : 'xx'}${rest}${dots(host)}`;
    return `${f}${t === 'T' ? 'X' : 'x'}${frest}${dots(fhost)}`;
  });
  out = out.replace(IPV4_RE, (ip) => {
    count++;
    return dots(ip);
  });
  out = out.replace(DOMAIN_RE, (m, labels: string, tld: string) => {
    if (!isDomain(labels, tld)) return m;
    count++;
    return dots(labels) + tld;
  });
  return { text: out, count };
}

export function defang(text: string): string {
  return defangWithCount(text).text;
}
