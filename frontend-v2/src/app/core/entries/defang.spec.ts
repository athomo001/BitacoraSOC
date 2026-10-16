import { defang, defangWithCount } from './defang';

describe('defang', () => {
  it('neutraliza enlaces, dominios sueltos, correos e IPs', () => {
    const cases: [string, string][] = [
      ['Conexión a https://malo.example.com/login desde 185.220.1.1', 'Conexión a hxxps://malo[.]example[.]com/login desde 185[.]220[.]1[.]1'],
      ['http://10.0.0.5:8080/x', 'hxxp://10[.]0[.]0[.]5:8080/x'],
      ['HTTPS://Evil.COM', 'HXXPS://Evil[.]COM'],
      ['ftp://files.malo.ru/a', 'fxp://files[.]malo[.]ru/a'],
      // Lo que reportó el dueño: sin http no hacía nada.
      ['www.algo.com', 'www[.]algo[.]com'],
      ['entrar a www.phishing-banco.cl ahora', 'entrar a www[.]phishing-banco[.]cl ahora'],
      ['dominio malo.com y sub.dominio.co.uk', 'dominio malo[.]com y sub[.]dominio[.]co[.]uk'],
      ['correo de atacante@evil.ru', 'correo de atacante@evil[.]ru'],
      ['192.168.1.10:8080', '192[.]168[.]1[.]10:8080'],
      ['www.descargas.zip', 'www[.]descargas[.]zip'],
      ['[clic](https://x.com/a)', '[clic](hxxps://x[.]com/a)'],
      ['<https://x.com>', '<hxxps://x[.]com>'],
      ['Fin de frase en evil.com.', 'Fin de frase en evil[.]com.'],
    ];
    for (const [input, want] of cases) expect(defang(input)).toBe(want);
  });

  it('no toca archivos, versiones ni números', () => {
    for (const text of ['versión v2.1 del archivo reporte.txt, 3.5 GB', 'malware.exe y payload.dll', 'README.md y app.py', 'adjunto hola.zip y video.mov', 'Setup.app y notas.one', '999.1.1.1 no es una IP', 'OID 1.2.3.4.5']) {
      expect(defang(text)).toBe(text);
    }
  });

  it('es idempotente y cuenta lo que neutralizó', () => {
    const once = defang('https://a.b.com 8.8.8.8 www.x.cl a@b.ru');
    expect(defang(once)).toBe(once);
    expect(defangWithCount('https://a.b.com 8.8.8.8 www.x.cl a@b.ru').count).toBe(4);
    expect(defangWithCount(once).count).toBe(0);
    expect(defangWithCount('nada por aquí').count).toBe(0);
  });
});
