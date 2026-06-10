const { generateSecret, verifyTOTP } = require('../src/utils/totp');

describe('Pruebas Unitarias de TOTP (MFA)', () => {
  test('generateSecret genera cadenas Base32 válidas', () => {
    const secret = generateSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(10);
    expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
  });

  test('verifyTOTP retorna falso para valores nulos o inválidos', () => {
    expect(verifyTOTP(null, 'ABCDEF')).toBe(false);
    expect(verifyTOTP('123456', null)).toBe(false);
    expect(verifyTOTP('abc123', 'ABCDEFGHIJKLMNOP')).toBe(false);
  });
});
