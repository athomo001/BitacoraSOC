/**
 * File Purpose: backend/src/utils/glpi-entity-mappings.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const mongoose = require('mongoose');

const ENTRY_TYPES = ['operativa', 'incidente'];

/**
 * Combina el arreglo `entityMappings` actual de `GlpiConfig` con el payload entrante del
 * formulario de administración. Preserva `lastPolledAt` (el cursor de sondeo) de las filas
 * que ya existían por `_id`, y descarta silenciosamente los `categoryOverrides` mal formados
 * en vez de rechazar el guardado completo por un solo override inválido.
 */
const mergeEntityMappings = (existingMappings = [], incomingMappings = []) => {
  const existingById = new Map(
    (existingMappings || []).map((mapping) => [String(mapping._id), mapping])
  );

  return (incomingMappings || []).map((mapping) => {
    const existing = mapping._id && mongoose.isValidObjectId(mapping._id)
      ? existingById.get(String(mapping._id))
      : null;

    return {
      _id: existing ? existing._id : undefined,
      entitiesId: Number(mapping.entitiesId),
      label: String(mapping.label || '').trim(),
      clientId: mapping.clientId || null,
      defaultEntryType: ENTRY_TYPES.includes(mapping.defaultEntryType) ? mapping.defaultEntryType : 'operativa',
      categoryOverrides: Array.isArray(mapping.categoryOverrides)
        ? mapping.categoryOverrides
          .filter((override) => override && override.itilCategoriesId !== undefined && ENTRY_TYPES.includes(override.entryType))
          .map((override) => ({ itilCategoriesId: Number(override.itilCategoriesId), entryType: override.entryType }))
        : [],
      enabled: mapping.enabled !== false,
      lastPolledAt: existing ? existing.lastPolledAt : null
    };
  });
};

module.exports = {
  ENTRY_TYPES,
  mergeEntityMappings
};
