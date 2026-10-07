import { registerTexts } from '../registry';

/** Textos de territory: viajan con el código de esa pantalla, no en el bundle inicial. */
const ES = {
  'territory.labelsSaved': 'Guardado ✓ · se aplica de inmediato',
  'territory.labelsError': 'No se pudieron guardar los nombres de los niveles.',
  'territory.level.country': 'Nivel 1',
  'territory.level.region': 'Nivel 2',
  'territory.level.zone': 'Nivel 3',
  'territory.level.site': 'Nivel 4',
  'territory.example.country': 'ej. País',
  'territory.example.region': 'ej. Región, Estado, Provincia',
  'territory.example.zone': 'ej. Comuna, Ciudad',
  'territory.example.site': 'ej. Sitio, Nodo',
  'territory.importChile': 'Cargar Chile (incluido)',
  'territory.importFile': 'Subir JSON de otro país…',
  'territory.imported': 'Importado',
  'territory.withError': 'con error',
  'territory.noCode': '(sin código)',
  'territory.attribution': 'Datos de Chile derivados de countries-states-cities-database (dr5hn), licencia ODbL v1.0. Traen regiones y ciudades principales, no todas las comunas: lo que falte se agrega a mano.',
  'territory.templateError': 'No se pudo descargar la plantilla.',
  'territory.importError': 'No se pudo importar el archivo.',
};

export type TerritoryKey = keyof typeof ES;

const EN: Record<TerritoryKey, string> = {
  'territory.labelsSaved': 'Saved ✓ · applies right away',
  'territory.labelsError': "Couldn't save the level names.",
  'territory.level.country': 'Level 1',
  'territory.level.region': 'Level 2',
  'territory.level.zone': 'Level 3',
  'territory.level.site': 'Level 4',
  'territory.example.country': 'e.g. Country',
  'territory.example.region': 'e.g. Region, State, Province',
  'territory.example.zone': 'e.g. District, City',
  'territory.example.site': 'e.g. Site, Node',
  'territory.importChile': 'Load Chile (included)',
  'territory.importFile': "Upload another country's JSON…",
  'territory.imported': 'Imported',
  'territory.withError': 'with errors',
  'territory.noCode': '(no code)',
  'territory.attribution': "Chile data derived from countries-states-cities-database (dr5hn), ODbL v1.0 license. It has regions and main cities, not every district: add what's missing by hand.",
  'territory.templateError': "Couldn't download the template.",
  'territory.importError': "Couldn't import the file.",
};

registerTexts(ES, EN);
