import { registerTexts } from '../registry';

/** Textos de complements: viajan con el código de esa pantalla, no en el bundle inicial. */
const ES = {
  'comp.maintenance': 'En mantenimiento',
  'comp.maintenanceHint': 'Un administrador lo está actualizando. Vuelve a abrirlo más tarde; los demás complementos siguen funcionando.',
  'comp.down': 'No disponible',
  'comp.downHint': 'El servicio del complemento no responde. Se reintenta solo cada 30 segundos y la pestaña vuelve cuando responda.',
  'comp.disconnected': 'Complemento desconectado',
  'comp.disconnectedHint': 'Envió demasiados mensajes seguidos y se cerró por seguridad. Recárgalo para volver a abrirlo.',
  'comp.isolated': 'Aislado',
  'comp.isolatedHint': 'Se sirve desde otro origen: no puede leer tu sesión ni llamar a la API como tú',
  'comp.reload': 'Recargar complemento',
  'comp.fullscreen': 'Pantalla completa',
  'comp.openError': 'No se pudo abrir el complemento.',
  'comp.none': 'No tienes complementos disponibles.',
  'comp.entryCreated': 'El complemento creó una entrada en la bitácora.',
  'comp.entryError': 'El complemento no pudo crear la entrada.',
};

export type ComplementsKey = keyof typeof ES;

const EN: Record<ComplementsKey, string> = {
  'comp.maintenance': 'Under maintenance',
  'comp.maintenanceHint': 'An administrator is updating it. Open it again later; the other add-ons keep working.',
  'comp.down': 'Unavailable',
  'comp.downHint': "The add-on's service is not responding. It retries every 30 seconds and the tab comes back when it responds.",
  'comp.disconnected': 'Add-on disconnected',
  'comp.disconnectedHint': 'It sent too many messages in a row and was closed for safety. Reload it to open it again.',
  'comp.isolated': 'Isolated',
  'comp.isolatedHint': 'Served from another origin: it cannot read your session or call the API as you',
  'comp.reload': 'Reload add-on',
  'comp.fullscreen': 'Full screen',
  'comp.openError': 'Could not open the add-on.',
  'comp.none': 'You have no add-ons available.',
  'comp.entryCreated': 'The add-on created a logbook entry.',
  'comp.entryError': 'The add-on could not create the entry.',
};

registerTexts(ES, EN);
