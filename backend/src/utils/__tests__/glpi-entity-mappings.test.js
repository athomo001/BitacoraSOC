/**
 * File Purpose: backend/src/utils/__tests__/glpi-entity-mappings.test.js
 * Responsibilities: Pruebas unitarias para el merge de mapeos entidad GLPI -> cliente.
 * QA Notes: El cursor de sondeo (lastPolledAt) no debe perderse al re-guardar la config.
 */

const { mergeEntityMappings } = require('../glpi-entity-mappings');

describe('mergeEntityMappings', () => {
  test('preserva lastPolledAt de una fila existente identificada por _id', () => {
    const cursor = new Date('2026-08-01T10:00:00Z');
    const existing = [{
      _id: '507f1f77bcf86cd799439011',
      entitiesId: 5,
      label: 'Entidad Vieja',
      clientId: 'client-1',
      defaultEntryType: 'operativa',
      categoryOverrides: [],
      enabled: true,
      lastPolledAt: cursor
    }];

    const incoming = [{
      _id: '507f1f77bcf86cd799439011',
      entitiesId: 5,
      label: 'Entidad Renombrada',
      clientId: 'client-1',
      defaultEntryType: 'incidente',
      enabled: true
    }];

    const result = mergeEntityMappings(existing, incoming);

    expect(result).toHaveLength(1);
    expect(result[0].lastPolledAt).toBe(cursor);
    expect(result[0].label).toBe('Entidad Renombrada');
    expect(result[0].defaultEntryType).toBe('incidente');
  });

  test('una fila nueva (sin _id existente) arranca con lastPolledAt en null', () => {
    const result = mergeEntityMappings([], [{
      entitiesId: 9,
      clientId: 'client-2',
      defaultEntryType: 'operativa',
      enabled: true
    }]);

    expect(result[0]._id).toBeUndefined();
    expect(result[0].lastPolledAt).toBeNull();
  });

  test('un _id que no coincide con ninguna fila existente se trata como fila nueva', () => {
    const existing = [{
      _id: '507f1f77bcf86cd799439011',
      lastPolledAt: new Date('2026-08-01T10:00:00Z')
    }];

    const result = mergeEntityMappings(existing, [{
      _id: '507f1f77bcf86cd799439099',
      entitiesId: 3,
      clientId: 'client-3',
      enabled: true
    }]);

    expect(result[0]._id).toBeUndefined();
    expect(result[0].lastPolledAt).toBeNull();
  });

  test('defaultEntryType inválido cae a "operativa"', () => {
    const result = mergeEntityMappings([], [{
      entitiesId: 1,
      clientId: 'client-1',
      defaultEntryType: 'algo-invalido',
      enabled: true
    }]);

    expect(result[0].defaultEntryType).toBe('operativa');
  });

  test('descarta categoryOverrides mal formados sin rechazar el resto del mapeo', () => {
    const result = mergeEntityMappings([], [{
      entitiesId: 1,
      clientId: 'client-1',
      enabled: true,
      categoryOverrides: [
        { itilCategoriesId: 7, entryType: 'incidente' },
        { itilCategoriesId: 8, entryType: 'no-valido' },
        { entryType: 'operativa' } // sin itilCategoriesId
      ]
    }]);

    expect(result[0].categoryOverrides).toEqual([
      { itilCategoriesId: 7, entryType: 'incidente' }
    ]);
  });

  test('enabled se interpreta como true salvo que venga explícitamente false', () => {
    const result = mergeEntityMappings([], [
      { entitiesId: 1, clientId: 'client-1' },
      { entitiesId: 2, clientId: 'client-2', enabled: false }
    ]);

    expect(result[0].enabled).toBe(true);
    expect(result[1].enabled).toBe(false);
  });
});
