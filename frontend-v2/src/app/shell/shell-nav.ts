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
  /** Alt+<dígito>, ver ShellComponent.onKeydown (ya no quedan dígitos libres: los nuevos van sin atajo). */
  shortcutDigit?: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
  /** Código de `system_features` que debe estar activo para mostrar la sección. */
  requiresFeature?: string;
  /** Necesita SOC o NOC encendido: con solo la Ticketera no aparece (pedido del dueño). */
  requiresSocOrNoc?: boolean;
  /** Necesita el módulo NOC encendido (territorio, activos). */
  requiresNoc?: boolean;
  /** Además, que el usuario vea al menos un complemento (si no, no hay nada que abrir). */
  requiresComplements?: boolean;
  /** Capacidad de grupo que debe tener el usuario (el admin la tiene siempre). */
  requiresCapability?: string;
  /** Solo el perfil Operativo de SOC/NOC (spec/16 §3.2). */
  requiresOperational?: boolean;
  /** Operativo, o gente de un área propia que ve sus guardias y escalamiento (9e). */
  requiresAreaOps?: boolean;
  /** Gestión CSM: perfil Gestión, jefaturas y admin (9.4). */
  requiresManagement?: boolean;
  /** Mi equipo: jefaturas, admin y auditor (10f: el auditor ve la Calidad). */
  requiresTeam?: boolean;
}

export const SHELL_NAV_ITEMS: readonly ShellNavItem[] = [
  { path: 'entries', labelKey: 'nav.entries', icon: 'edit_note', shortcutDigit: '1', requiresSocOrNoc: true, requiresOperational: true },
  { path: 'tickets', labelKey: 'nav.tickets', icon: 'confirmation_number', shortcutDigit: '6', requiresFeature: 'native_tickets' },
  { path: 'shifts', labelKey: 'nav.shifts', icon: 'schedule', shortcutDigit: '2', requiresSocOrNoc: true, requiresAreaOps: true },
  { path: 'escalation', labelKey: 'nav.escalation', icon: 'phone_in_talk', shortcutDigit: '3', requiresSocOrNoc: true, requiresAreaOps: true },
  // Mapa (#24): localidades y sectores a revisar. Es del módulo NOC (territorio).
  { path: 'map', labelKey: 'nav.map', icon: 'map', shortcutDigit: '0', requiresNoc: true, requiresOperational: true },
  { path: 'directory', labelKey: 'nav.directory', icon: 'contacts', shortcutDigit: '4' },
  // Inventario (spec/16 §4.2, 9.2): equipos por área; el servidor decide qué ve cada uno.
  { path: 'inventory', labelKey: 'nav.inventory', icon: 'dns', requiresAreaOps: true },
  // Agenda (spec/16 §4.3, 9.3): todos los perfiles (decisión del dueño 2026-10-14).
  { path: 'agenda', labelKey: 'nav.agenda', icon: 'event_note' },
  // Reportes (comentario del dueño #10): informes y boletines por correo. Es del núcleo:
  // SOC (incidentes de seguridad) y NOC (caída de un enlace) le avisan igual al cliente.
  { path: 'reports', labelKey: 'nav.reports', icon: 'outgoing_mail', shortcutDigit: '8', requiresOperational: true },
  // Complementos (spec/11 §7): un solo ítem con una pestaña por complemento.
  { path: 'complements', labelKey: 'nav.complements', icon: 'extension', shortcutDigit: '7', requiresFeature: 'complements', requiresComplements: true },
  // Gestión CSM (spec/16 §4.4, 9.4): perfil Gestión, jefaturas y admin.
  { path: 'management', labelKey: 'nav.management', icon: 'insights', requiresManagement: true },
  // Mi equipo (spec/16 §3.5, 9d): la jefatura de área; el auditor entra a la Calidad (10f).
  { path: 'team', labelKey: 'nav.team', icon: 'groups', shortcutDigit: '9', requiresTeam: true },
  { path: 'admin', labelKey: 'nav.admin', icon: 'settings', shortcutDigit: '5' },
];
