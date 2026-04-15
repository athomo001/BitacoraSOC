process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

jest.mock('../email', () => ({
  sendEmail: jest.fn()
}));

const ShiftReminder = require('../../models/ShiftReminder');
const { buildReminderHtml } = require('../shiftReminderScheduler');

describe('MAIL-REM-079 - recordatorios largos y multilínea', () => {
  test('acepta textos superiores a 500 caracteres en el modelo', () => {
    const reminderText = Array.from({ length: 37 }, (_, index) => `Línea ${index + 1}: contenido de recordatorio SOC con detalle operativo.`).join('\n');

    expect(reminderText.length).toBeGreaterThan(500);

    const doc = new ShiftReminder({
      label: 'Checklist Zerodays',
      reminderText,
      frequencyType: 'hours',
      intervalHours: 4,
      targetShiftIds: [],
      enabled: true
    });

    const error = doc.validateSync();
    expect(error).toBeUndefined();
  });

  test('preserva saltos de línea al construir el HTML del correo', () => {
    const reminderText = 'Primera línea\r\n* Punto 1\r\n* Punto 2\r\n\r\nCierre';
    const html = buildReminderHtml({ appTitle: 'Bitácora SOC', reminderText });

    expect(typeof html).toBe('string');
    expect(html).toContain('Primera línea');
    expect(html).toContain('&bull;');
    expect(html).toContain('Punto 1');
    expect(html).toContain('Cierre');
  });
});
