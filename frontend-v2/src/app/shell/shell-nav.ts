/**
 * Las 5 secciones maestras del núcleo más la ticketera opcional de Fase 10 (spec/06-frontend-arquitectura-y-ui.md
 * sección 3 — corregida esta fase: un diagrama anterior de esa sección
 * incluía "Métricas y Analítica" como 6ta sección, contradiciendo esta
 * lista ya cerrada en spec/02-alcance-y-roadmap.md sección 4 y
 * spec/00-mapa-mental.md; el dashboard /metrics completo es Backlog
 * Post-Corte). Única fuente de verdad de la barra lateral — el atajo de
 * teclado y el ícono viven junto a la ruta, no repetidos en 2 archivos.
 */
export interface ShellNavItem {
  path: string;
  label: string;
  icon: string;
  /** Alt+1..Alt+5, ver ShellComponent.onKeydown */
  shortcutDigit: '1' | '2' | '3' | '4' | '5' | '6';
}

export const SHELL_NAV_ITEMS: readonly ShellNavItem[] = [
  { path: 'entries', label: 'Bitácora', icon: 'assignment', shortcutDigit: '1' },
  { path: 'tickets', label: 'Ticketera ITIL', icon: 'confirmation_number', shortcutDigit: '6' },
  { path: 'shifts', label: 'Turnos y Checklist', icon: 'schedule', shortcutDigit: '2' },
  { path: 'escalation', label: 'Escalamiento / Despacho', icon: 'campaign', shortcutDigit: '3' },
  { path: 'directory', label: 'Directorio', icon: 'contacts', shortcutDigit: '4' },
  { path: 'admin', label: 'Administración', icon: 'settings', shortcutDigit: '5' },
];
