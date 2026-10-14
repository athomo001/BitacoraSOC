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

/** De dónde sale el fondo: OSM público, un servidor propio o solo la silueta de los países. */
export type MapTilesMode = 'osm' | 'custom' | 'none';

export interface MapTiles {
  mode: MapTilesMode;
  url: string;
}
