import { defang } from './defang';

describe('defang', () => {
  it('neutraliza URLs e IPv4', () => {
    expect(defang('Conexión a https://malo.example.com/login desde 185.220.1.1')).toBe('Conexión a hxxps://malo[.]example[.]com/login desde 185[.]220[.]1[.]1');
    expect(defang('http://10.0.0.5:8080/x')).toBe('hxxp://10[.]0[.]0[.]5:8080/x');
    expect(defang('HTTPS://Evil.COM')).toBe('HXXPS://Evil[.]COM');
  });

  it('no toca lo que no es un indicador', () => {
    expect(defang('versión v2.1 del archivo reporte.txt, 3.5 GB')).toBe('versión v2.1 del archivo reporte.txt, 3.5 GB');
    expect(defang('999.1.1.1 no es una IP')).toBe('999.1.1.1 no es una IP');
  });

  it('es idempotente', () => {
    const once = defang('https://a.b.c 8.8.8.8');
    expect(defang(once)).toBe(once);
  });
});
