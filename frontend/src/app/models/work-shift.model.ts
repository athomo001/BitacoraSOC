/**
 * Modelos de Turnos de Trabajo
 * 
 * Función:
 *   - Definir interfaces para gestión de turnos de trabajo
 *   - Turnos regulares (oficina) y de emergencia (no hábil)
 *   - Asignación opcional de usuarios y checklists
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📦 MODELOS PRINCIPALES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface WorkShift {
  _id: string;
  name: string; // Ej: "Turno Mañana", "Turno Tarde", "Turno Noche"
  code: string; // Ej: "MORNING", "AFTERNOON", "NIGHT", "EMERGENCY"
  description?: string;
  type: 'regular' | 'emergency'; // regular: oficina, emergency: no hábil
  startTime: string; // HH:MM formato 24h
  endTime: string; // HH:MM formato 24h (puede ser < startTime si cruza medianoche)
  timezone: string; // Ej: "America/Santiago"
  assignedUserId?: string | null; // Usuario asignado (opcional)
  assignedUserIds?: Array<string | { _id: string; fullName?: string; email?: string }>;
  assignedUserName?: string; // Populated field
  assignedUserEmail?: string; // Populated field
  checklistTemplateId?: string | null; // Template de checklist asociado (opcional)
  checklistTemplateName?: string; // Populated field
  checklistTemplateStartId?: string | null; // Template de checklist de inicio (opcional)
  checklistTemplateStartName?: string; // Populated field
  checklistTemplateEndId?: string | null; // Template de checklist de cierre (opcional)
  checklistTemplateEndName?: string; // Populated field
  emailReportConfig?: {
    enabled: boolean; // Habilitar reenvío automático al finalizar turno
    includeChecklist: boolean; // Incluir checklist entrada/salida
    includeEntries: boolean; // Incluir entradas de bitácora
    recipients: string[]; // Emails destinatarios
    subjectTemplate: string; // Asunto con variables: [fecha], [turno], [hora]
  };
  order: number; // Orden de visualización
  active: boolean;
  color?: string; // Color hex para UI
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkShiftFormData {
  name: string;
  code: string;
  description?: string;
  type: 'regular' | 'emergency';
  startTime: string;
  endTime: string;
  timezone: string;
  assignedUserId?: string | null;
  assignedUserIds?: string[];
  checklistTemplateId?: string | null; // Template de checklist asociado (opcional, legacy)
  checklistTemplateName?: string; // Populated field
  checklistTemplateStartId?: string | null; // Template de checklist Inicio (opcional)
  checklistTemplateStartName?: string; // Populated field
  checklistTemplateEndId?: string | null; // Template de checklist Cierre (opcional)
  checklistTemplateEndName?: string; // Populated field
  emailReportConfig?: {
    enabled?: boolean;
    includeChecklist?: boolean;
    includeEntries?: boolean;
    recipients?: string[];
    subjectTemplate?: string;
  };
  order?: number;
  active?: boolean;
  color?: string;
}

export interface CurrentShiftResponse {
  shift: WorkShift | null;
  currentTime: string; // HH:MM
  timezone: string;
  message?: string;
}

export interface ReorderRequest {
  shifts: Array<{
    id: string;
    order: number;
  }>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📝 TIPOS AUXILIARES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ShiftType = 'regular' | 'emergency';

export interface ShiftTypeOption {
  value: ShiftType;
  label: string;
  description: string;
}

export const SHIFT_TYPE_OPTIONS: ShiftTypeOption[] = [
  {
    value: 'regular',
    label: 'Regular',
    description: 'Turno normal de oficina'
  },
  {
    value: 'emergency',
    label: 'Emergencia',
    description: 'Turno de emergencia fuera de horario hábil'
  }
];

export const DEFAULT_COLORS = [
  '#1976d2', // Azul
  '#388e3c', // Verde
  '#f57c00', // Naranja
  '#7b1fa2', // Púrpura
  '#c62828', // Rojo
  '#0097a7', // Cyan
  '#5d4037', // Marrón
  '#455a64', // Gris azulado
];
