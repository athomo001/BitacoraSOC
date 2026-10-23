/** Una localidad del Mapa (#24) con lo que hay que revisar en ella. */
export interface MapPoint {
  id: string;
  kind: 'country' | 'region' | 'zone' | 'site';
  name: string;
  parentName?: string;
  latitude: number;
  longitude: number;
  openIncidents: number;
  lastIncidentTitle?: string;
  maintenanceUntil?: string;
  maintenanceTitle?: string;
  /** Tickets abiertos con lugar aquí (0 con la Ticketera apagada). */
  openTickets: number;
  lastTicketTitle?: string;
}

export interface MapUnitDetail {
  incidents: { id: string; title: string; glpiTicket?: string; openedAt: string; assetName?: string }[];
  windows: { id: string; title: string; endsAt: string; suppressNotifications: boolean; assetName?: string }[];
  teams: { id: string; name: string; coveredVia: string }[];
  tickets: { id: string; ticketNumber: string; title: string; priority: string; status: string; assetName?: string }[];
}

/** ok: verde; warn: mantenimiento activo; bad: ticket, incidente o entrada de incidente abiertos. */
export type MapAssetStatus = 'ok' | 'warn' | 'bad';

/** Un equipo del Inventario con coordenadas (propias o de su grupo): capa «Equipos». */
export interface MapAsset {
  id: string;
  name: string;
  code: string;
  kind: string;
  latitude: number;
  longitude: number;
  address?: string;
  groupName?: string;
  placeName?: string;
  /** Sin cliente, es interno. */
  clientId?: string;
  clientName?: string;
  status: MapAssetStatus;
  /** Lo último de cada cosa que lo afecta, con cuántas hay. */
  ticket?: { id: string; number: string; title: string; status: string; priority: string; count: number };
  incident?: { title: string; openedAt: string; count: number };
  entry?: { id: string; content: string; at: string; author: string; count: number };
  maintenance?: { title: string; until: string };
}

/** Los equipos que comparten un punto (un rack entero cae en el mismo): un solo pin. */
export interface MapSpot {
  key: string;
  latitude: number;
  longitude: number;
  assets: MapAsset[];
}

/** De dónde sale el fondo: OSM público, un servidor propio o solo la silueta de los países. */
export type MapTilesMode = 'osm' | 'custom' | 'none';

export interface MapTiles {
  mode: MapTilesMode;
  url: string;
}
