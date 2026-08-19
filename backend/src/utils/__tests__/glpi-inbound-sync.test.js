/**
 * File Purpose: backend/src/utils/__tests__/glpi-inbound-sync.test.js
 * Responsibilities: Pruebas unitarias para las funciones puras del importador entrante GLPI.
 * QA Notes: No ejercitan red/DB — runGlpiInboundSync en sí requiere Mongo/GLPI reales (fuera de scope aquí).
 */

const { resolveEntryType, stripHtml, buildImportedContent } = require('../glpi-inbound-sync');

describe('resolveEntryType', () => {
  test('usa el override de categoría cuando la categoría del ticket coincide', () => {
    const mapping = {
      defaultEntryType: 'operativa',
      categoryOverrides: [
        { itilCategoriesId: 12, entryType: 'incidente' }
      ]
    };

    expect(resolveEntryType(mapping, 12)).toBe('incidente');
  });

  test('cae al defaultEntryType si la categoría del ticket no tiene override', () => {
    const mapping = {
      defaultEntryType: 'operativa',
      categoryOverrides: [
        { itilCategoriesId: 12, entryType: 'incidente' }
      ]
    };

    expect(resolveEntryType(mapping, 99)).toBe('operativa');
  });

  test('cae al defaultEntryType si el ticket no tiene categoría', () => {
    const mapping = { defaultEntryType: 'incidente', categoryOverrides: [] };
    expect(resolveEntryType(mapping, null)).toBe('incidente');
  });

  test('usa "operativa" si el mapeo no define defaultEntryType', () => {
    expect(resolveEntryType({}, null)).toBe('operativa');
  });
});

describe('stripHtml', () => {
  test('convierte <br> y </p> en saltos de línea', () => {
    expect(stripHtml('Línea uno<br>Línea dos<br/><p>Párrafo</p>')).toBe('Línea uno\nLínea dos\nPárrafo');
  });

  test('elimina el resto de las etiquetas HTML', () => {
    expect(stripHtml('<div><strong>Texto</strong> normal</div>')).toBe('Texto normal');
  });

  test('decodifica entidades HTML comunes', () => {
    expect(stripHtml('Tom &amp; Jerry &lt;3 &quot;GLPI&quot;')).toBe('Tom & Jerry <3 "GLPI"');
  });

  test('colapsa múltiples saltos de línea consecutivos', () => {
    expect(stripHtml('<p>Uno</p><p></p><p>Dos</p>')).toBe('Uno\n\nDos');
  });

  test('maneja contenido vacío o nulo sin lanzar error', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
    expect(stripHtml('')).toBe('');
  });
});

describe('buildImportedContent', () => {
  test('arma el encabezado con el id del ticket y el título', () => {
    const content = buildImportedContent({ ticketId: 42, title: 'Servidor caído', body: '<p>El servidor no responde</p>' });
    expect(content).toBe('[GLPI #42] Servidor caído\n\nEl servidor no responde');
  });

  test('usa un placeholder cuando el cuerpo queda vacío tras limpiar el HTML', () => {
    const content = buildImportedContent({ ticketId: 1, title: 'Ticket sin cuerpo', body: '<p></p>' });
    expect(content).toBe('[GLPI #1] Ticket sin cuerpo\n\n(sin contenido)');
  });
});
