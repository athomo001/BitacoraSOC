/**
 * File Purpose: backend/src/utils/glpi-inbound-sync.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Importación entrante GLPI -> Bitácora.
 *
 * Por cada entidad GLPI mapeada y habilitada en `GlpiConfig.entityMappings`:
 *   - Tickets nunca vistos (sin fila en `GlpiTicketLink`) generan la entrada "original".
 *   - Tickets ya conocidos solo generan una entrada nueva por cada seguimiento (followup)
 *     externo posterior a su último cursor sincronizado — los followups que la propia
 *     bitácora escribió (vía `addTicketFollowup`) se descartan por `GLPI_SYNC_MARKER`.
 *
 * El cursor de "qué tan atrás mirar" vive en dos niveles:
 *   - `entityMappings[i].lastPolledAt`: hasta dónde se revisaron tickets de esa entidad.
 *   - `GlpiTicketLink.lastSyncedDateMod`: hasta dónde se revisaron followups de ese ticket.
 * Si una entidad falla a mitad de ciclo, su cursor no avanza y el próximo poll reintenta
 * la misma ventana; reprocesar una ventana ya sincronizada es seguro porque la existencia
 * de `GlpiTicketLink` evita duplicar la entrada original, y el cursor por-ticket evita
 * duplicar followups ya importados.
 */
const cron = require('node-cron');
const Entry = require('../models/Entry');
const GlpiTicketLink = require('../models/GlpiTicketLink');
const CatalogLogSource = require('../models/CatalogLogSource');
const User = require('../models/User');
const { ensureGlpiConfig, searchTickets, listNewFollowups } = require('./glpi-dispatch');
const { auditSystem } = require('./audit');
const { logger } = require('./logger');

const stripHtml = (html) => String(html || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#039;/g, "'")
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const formatSantiagoTime = (date) => date.toLocaleTimeString('es-CL', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Santiago'
});

const resolveEntryType = (mapping, itilCategoriesId) => {
  if (itilCategoriesId) {
    const override = (mapping.categoryOverrides || []).find((o) => o.itilCategoriesId === itilCategoriesId);
    if (override) return override.entryType;
  }
  return mapping.defaultEntryType || 'operativa';
};

const buildImportedContent = ({ ticketId, title, body }) => {
  const cleanBody = stripHtml(body) || '(sin contenido)';
  return `[GLPI #${ticketId}] ${title}\n\n${cleanBody}`;
};

const createImportedEntry = async ({ content, entryType, clientId, clientName, tags, ticketId, importUser }) => {
  const now = new Date();
  const entry = new Entry({
    content,
    entryType,
    entryDate: now,
    entryTime: formatSantiagoTime(now),
    tags,
    clientId: clientId || null,
    clientName: clientName || null,
    createdBy: importUser._id,
    createdByUsername: importUser.username,
    glpiTicketId: String(ticketId),
    glpiLinkedAt: now
  });
  await entry.save();
  return entry;
};

const runGlpiInboundSync = async () => {
  const config = await ensureGlpiConfig();

  if (!config.enabled || config.mode !== 'api' || !config.inbound?.enabled) {
    return { success: false, skipped: true, reason: 'disabled' };
  }

  const enabledMappings = (config.entityMappings || []).filter((mapping) => mapping.enabled && mapping.clientId);
  if (enabledMappings.length === 0) {
    return { success: false, skipped: true, reason: 'no-mappings' };
  }

  if (!config.inbound.importUserId) {
    return { success: false, skipped: true, reason: 'no-import-user' };
  }

  const importUser = await User.findById(config.inbound.importUserId).select('username').lean();
  if (!importUser) {
    return { success: false, skipped: true, reason: 'import-user-not-found' };
  }

  const pollStartedAt = new Date();
  let importedCount = 0;
  let lastError = null;

  for (const mapping of enabledMappings) {
    try {
      const clientDoc = await CatalogLogSource.findById(mapping.clientId).select('name').lean();
      const clientName = clientDoc?.name || mapping.label || null;

      const { tickets, truncated: ticketsTruncated } = await searchTickets(config, {
        entitiesId: mapping.entitiesId,
        dateModAfter: mapping.lastPolledAt || null
      });

      for (const ticket of tickets) {
        if (!ticket.id) continue;
        const ticketIdStr = String(ticket.id);
        const entryType = resolveEntryType(mapping, ticket.itilCategoriesId);

        let link = await GlpiTicketLink.findOne({ ticketId: ticketIdStr });

        if (!link) {
          const entry = await createImportedEntry({
            content: buildImportedContent({ ticketId: ticket.id, title: ticket.name || 'Ticket GLPI', body: ticket.content }),
            entryType,
            clientId: mapping.clientId,
            clientName,
            tags: ['glpi-import'],
            ticketId: ticketIdStr,
            importUser
          });

          link = await GlpiTicketLink.create({
            ticketId: ticketIdStr,
            entitiesId: mapping.entitiesId,
            clientId: mapping.clientId,
            entryType,
            originEntryId: entry._id,
            lastSyncedDateMod: ticket.dateMod || pollStartedAt,
            firstImportedAt: pollStartedAt,
            lastImportedAt: pollStartedAt
          });
          importedCount += 1;
          continue;
        }

        const { followups, truncated: followupsTruncated } = await listNewFollowups(config, {
          ticketId: ticketIdStr,
          dateModAfter: link.lastSyncedDateMod
        });

        for (const followup of followups) {
          await createImportedEntry({
            content: buildImportedContent({ ticketId: ticket.id, title: `Actualización de ${ticket.name || 'ticket GLPI'}`, body: followup.content }),
            entryType: link.entryType || entryType,
            clientId: link.clientId || mapping.clientId,
            clientName,
            tags: ['glpi-import', 'glpi-update'],
            ticketId: ticketIdStr,
            importUser
          });
          importedCount += 1;
        }

        if (followupsTruncated) {
          // Se cortó por volumen antes de llegar al último followup real: el cursor solo
          // avanza hasta el último que sí se importó, para retomar el resto en el próximo ciclo.
          const lastImportedDateMod = followups.length > 0 ? followups[followups.length - 1].dateMod : null;
          if (lastImportedDateMod && (!link.lastSyncedDateMod || lastImportedDateMod > link.lastSyncedDateMod)) {
            link.lastSyncedDateMod = lastImportedDateMod;
          }
          logger.warn({ ticketId: ticketIdStr }, 'GLPI inbound: seguimientos truncados por volumen alto, se retoman en el próximo ciclo');
        } else if (ticket.dateMod && (!link.lastSyncedDateMod || ticket.dateMod > link.lastSyncedDateMod)) {
          link.lastSyncedDateMod = ticket.dateMod;
        }
        link.lastImportedAt = pollStartedAt;
        await link.save();
      }

      if (ticketsTruncated) {
        // Mismo criterio a nivel de entidad: no saltar directo a "ahora", retomar desde el
        // último ticket procesado para no perder los que quedaron fuera del rango leído.
        const lastProcessedDateMod = tickets.length > 0 ? tickets[tickets.length - 1].dateMod : null;
        mapping.lastPolledAt = lastProcessedDateMod || mapping.lastPolledAt || pollStartedAt;
        logger.warn({ entitiesId: mapping.entitiesId, count: tickets.length }, 'GLPI inbound: tickets truncados por volumen alto, se retoman en el próximo ciclo');
      } else {
        mapping.lastPolledAt = pollStartedAt;
      }
    } catch (mappingError) {
      lastError = mappingError;
      logger.error({ err: mappingError, entitiesId: mapping.entitiesId }, 'Error importando tickets GLPI de una entidad');
    }
  }

  config.markModified('entityMappings');
  config.inbound.lastPollAt = pollStartedAt;
  config.inbound.lastPollSuccess = !lastError;
  config.inbound.lastPollMessage = lastError
    ? `Importación parcial (revisar logs) — ${importedCount} entrada(s) nueva(s), último error: ${lastError.message}`
    : `Importación OK — ${importedCount} entrada(s) nueva(s)`;
  config.inbound.lastImportedCount = importedCount;
  await config.save({ validateModifiedOnly: true });

  await auditSystem({
    event: lastError ? 'glpi.inbound.partial' : 'glpi.inbound.success',
    level: lastError ? 'warn' : 'info',
    result: { success: !lastError, reason: config.inbound.lastPollMessage },
    metadata: { importedCount, mappingsProcessed: enabledMappings.length }
  }).catch((auditError) => {
    logger.warn({ err: auditError }, 'No se pudo registrar auditoría de importación GLPI');
  });

  return { success: !lastError, importedCount, error: lastError };
};

let schedulerTask = null;
let lastRunAtMs = 0;

const startGlpiInboundScheduler = () => {
  if (schedulerTask) {
    logger.warn('GLPI inbound scheduler already running');
    return;
  }

  schedulerTask = cron.schedule('* * * * *', async () => {
    try {
      const config = await ensureGlpiConfig();
      if (!config.enabled || !config.inbound?.enabled) {
        return;
      }

      const intervalMs = (config.inbound.pollingIntervalMinutes || 5) * 60 * 1000;
      if (lastRunAtMs && (Date.now() - lastRunAtMs) < intervalMs) {
        return;
      }

      lastRunAtMs = Date.now();
      await runGlpiInboundSync();
    } catch (error) {
      logger.error({ err: error }, 'Error en scheduler de importación entrante GLPI');
    }
  });
};

const stopGlpiInboundScheduler = () => {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
  }
};

module.exports = {
  runGlpiInboundSync,
  startGlpiInboundScheduler,
  stopGlpiInboundScheduler,
  // Exportados para pruebas unitarias (son funciones puras, sin acceso a red/DB).
  resolveEntryType,
  stripHtml,
  buildImportedContent
};
