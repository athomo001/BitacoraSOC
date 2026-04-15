const {
  parseContactsCsv,
  formatContactsCsv,
  isValidEmail,
  normalizeContactType
} = require('../src/utils/contactDirectory');

describe('contactDirectory utils', () => {
  test('parseContactsCsv procesa filas válidas e inválidas sin abortar toda la importación', () => {
    const csv = [
      'name,email,organization,phone,favorite,doNotSend',
      'Ana,ana@example.com,Acme,+56911111111,true,false',
      'SinCorreo,,Acme,+56911111112,false,false',
      'FueraEnvio,bloqueado@example.com,Globex,,false,true'
    ].join('\n');

    const result = parseContactsCsv(csv, { defaultType: 'preventive' });

    expect(result.validRows).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.validRows[0]).toMatchObject({
      name: 'Ana',
      email: 'ana@example.com',
      organization: 'Acme',
      favorite: true,
      doNotSend: false,
      contactType: 'preventive'
    });
    expect(result.validRows[1]).toMatchObject({
      name: 'FueraEnvio',
      doNotSend: true
    });
  });

  test('formatContactsCsv exporta encabezados y mantiene flags operativos', () => {
    const csv = formatContactsCsv([
      {
        name: 'Bea',
        email: 'bea@example.com',
        organization: 'Contoso',
        phone: '123',
        contactType: 'preventive',
        favorite: true,
        doNotSend: false,
        active: true,
        notes: 'Cliente preferente'
      }
    ]);

    expect(csv).toContain('name,email,organization,phone,contactType,active,favorite,doNotSend,notes');
    expect(csv).toContain('Bea,bea@example.com,Contoso,123,preventive,true,true,false,Cliente preferente');
  });

  test('helpers de normalización y email son consistentes', () => {
    expect(isValidEmail('ok@example.com')).toBe(true);
    expect(isValidEmail('correo-invalido')).toBe(false);
    expect(normalizeContactType('preventive')).toBe('preventive');
    expect(normalizeContactType('cualquier-cosa')).toBe('escalation');
  });
});
