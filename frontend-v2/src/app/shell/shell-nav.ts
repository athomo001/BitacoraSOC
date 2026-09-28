import { MessageKey } from '../core/i18n/messages';

/**
 * Secciones de la barra lateral (spec/06-frontend-arquitectura-y-ui.md
 * sección 3): las 5 maestras del núcleo, siempre visibles y con Alt+1..5
 * fijos (invarianza: la memoria muscular del operador no cambia), más la
 * Ticketera, que es un módulo activable (`system_features.native_tickets`):
 * cuando está activa aparece como sección propia justo debajo de Bitácora
 * (pedido del dueño: "si la tengo habilitada debería verla como tal, no
 * dentro de muchos menús"), con su propio atajo que no desplaza a los demás.
 * Única fuente de verdad del menú — el atajo y el ícono viven junto a la ruta.
 */
export interface ShellNavItem {
  path: string;
  labelKey: MessageKey;
  icon: string;
  /** Alt+<dígito>, ver ShellComponent.onKeydown */
  shortcutDigit: '1' | '2' | '3' | '4' | '5' | '6';
  /** Código de `system_features` que debe estar activo para mostrar la sección. */
  requiresFeature?: string;
}

export const SHELL_NAV_ITEMS: readonly ShellNavItem[] = [
  { path: 'entries', labelKey: 'nav.entries', icon: 'edit_note', shortcutDigit: '1' },
  { path: 'tickets', labelKey: 'nav.tickets', icon: 'confirmation_number', shortcutDigit: '6', requiresFeature: 'native_tickets' },
  { path: 'shifts', labelKey: 'nav.shifts', icon: 'schedule', shortcutDigit: '2' },
  { path: 'escalation', labelKey: 'nav.escalation', icon: 'phone_in_talk', shortcutDigit: '3' },
  { path: 'directory', labelKey: 'nav.directory', icon: 'contacts', shortcutDigit: '4' },
  { path: 'admin', labelKey: 'nav.admin', icon: 'settings', shortcutDigit: '5' },
];
