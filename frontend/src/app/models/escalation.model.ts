// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📦 MODELOS DE DATOS - ESCALACIONES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface Client {
  _id: string;
  name: string;
  code: string;
  description?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type ClientAlertContext = 'report' | 'copy-report';
export type ClientAlertChannelType = 'email' | 'whatsapp' | 'telefono' | 'otro';
export type ClientAlertWindowMode =
  | 'always'
  | 'outside_business_hours'
  | 'between_hours'
  | 'after_hour'
  | 'before_hour'
  | 'weekend_only'
  | 'weekdays_only';

export interface ClientAlertChannel {
  type: ClientAlertChannelType;
  target: string;
  notes?: string;
}

export interface ClientAlertTimeWindow {
  mode: ClientAlertWindowMode;
  startTime?: string;
  endTime?: string;
  daysOfWeek?: number[];
  holidayOnly?: boolean;
}

export interface ClientAlertRule {
  _id: string;
  clientId: string | {
    _id: string;
    name?: string;
    parent?: string | null;
    enabled?: boolean;
  };
  name?: string;
  enabled: boolean;
  contexts: ClientAlertContext[];
  timezone: string;
  priority: number;
  validFrom?: string | null;
  validTo?: string | null;
  holidayDates?: string[];
  timeWindows: ClientAlertTimeWindow[];
  channels: ClientAlertChannel[];
  alertMessage: string;
  acknowledgementRequired: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClientAlertEvaluation {
  hasAlert: boolean;
  context: ClientAlertContext;
  client: {
    _id: string;
    name: string;
    parent?: string | null;
  };
  evaluation: {
    evaluatedAt: string;
    timezone: string;
    localDate: string;
    localTime: string;
    dayOfWeek: number;
  };
  rule: ClientAlertRule | null;
}

export interface ClientAlertAckPayload {
  ruleId: string;
  clientId?: string;
  context?: ClientAlertContext;
  acknowledgedAt?: string;
}

export interface Service {
  _id: string;
  clientId: string | Client;
  name: string;
  code: string;
  description?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  clientName?: string; // Populated field
}

export interface Contact {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  role?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExternalPerson {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RaciContact {
  name: string;
  email?: string;
  phone?: string;
}

export interface RaciEntry {
  _id: string;
  clientId: string | Client;
  serviceId?: string | Service | null;
  activity: string;
  responsible: RaciContact;
  accountable: RaciContact;
  consulted?: RaciContact;
  informed?: RaciContact;
  notes?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EscalationRule {
  _id: string;
  serviceId: string | Service;
  recipientsTo: (string | Contact)[];
  recipientsCC: (string | Contact)[];
  emergencyPhone?: string;
  emergencyContactId?: string | Contact;
  notes?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ShiftRole {
  _id: string;
  code: 'N2' | 'TI' | 'N1_NO_HABIL';
  name: string;
  description?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ShiftRotationCycle {
  _id: string;
  roleCode: 'N2' | 'TI' | 'N1_NO_HABIL';
  startDayOfWeek: number; // 0=Sunday, 6=Saturday
  startTimeUTC: string; // "HH:MM"
  durationDays: number;
  timezone: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ShiftAssignment {
  _id: string;
  roleCode: 'N2' | 'TI' | 'N1_NO_HABIL';
  userId?: string;
  externalPersonId?: string;
  weekStartDate: string; // ISO 8601
  weekEndDate: string; // ISO 8601
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  userName?: string; // Populated field
  userEmail?: string; // Populated field
}

export interface ShiftOverride {
  _id: string;
  roleCode: 'N2' | 'TI' | 'N1_NO_HABIL';
  originalUserId?: string;
  replacementUserId: string;
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
  reason: string;
  active: boolean;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
  replacementUserName?: string; // Populated field
  replacementUserEmail?: string; // Populated field
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 DTOs PARA VISTAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UserInfo {
  id: string;
  name: string;
  email: string;
}

export interface ContactInfo {
  id: string;
  name: string;
  email?: string;
}

export interface ShiftInfo {
  role: 'N2' | 'TI' | 'N1_NO_HABIL';
  roleName: string;
  currentUser: UserInfo | null;
  shiftPeriod: {
    start: string; // ISO 8601
    end: string; // ISO 8601
  } | null;
  isOverride: boolean;
  overrideReason?: string;
}

export interface ExternalContacts {
  to: ContactInfo[];
  cc: ContactInfo[];
  emergency: {
    phone: string | null;
    contactName: string | null;
  };
}

export interface EscalationView {
  service: {
    id: string;
    name: string;
    code: string;
    clientName: string;
  };
  externalContacts: ExternalContacts;
  internalShifts: ShiftInfo[];
  timestamp: string; // ISO 8601
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📝 DTOs PARA FORMULARIOS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ClientFormData {
  name: string;
  code: string;
  description?: string;
  active: boolean;
}

export interface ClientAlertRuleFormData {
  clientId: string;
  name?: string;
  enabled: boolean;
  contexts: ClientAlertContext[];
  timezone: string;
  priority: number;
  validFrom?: string | null;
  validTo?: string | null;
  holidayDates?: string[];
  timeWindows: ClientAlertTimeWindow[];
  channels: ClientAlertChannel[];
  alertMessage: string;
  acknowledgementRequired: boolean;
}

export interface ServiceFormData {
  clientId: string;
  name: string;
  code: string;
  description?: string;
  active: boolean;
}

export interface ContactFormData {
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  role?: string;
  active: boolean;
}

export interface EscalationRuleFormData {
  serviceId: string;
  recipientsTo: string[]; // Contact IDs
  recipientsCC: string[]; // Contact IDs
  emergencyPhone?: string;
  emergencyContactId?: string;
  notes?: string;
  active: boolean;
}

export interface ShiftRotationCycleFormData {
  roleCode: 'N2' | 'TI' | 'N1_NO_HABIL';
  startDayOfWeek: number;
  startTimeUTC: string;
  durationDays: number;
  timezone: string;
  active: boolean;
}

export interface ShiftAssignmentFormData {
  roleCode: 'N2' | 'TI' | 'N1_NO_HABIL';
  userId?: string;
  externalPersonId?: string;
  weekStartDate: string; // ISO 8601
  weekEndDate: string; // ISO 8601
  notes?: string;
}

export interface ShiftOverrideFormData {
  roleCode: 'N2' | 'TI' | 'N1_NO_HABIL';
  originalUserId?: string;
  replacementUserId: string;
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
  reason: string;
  active: boolean;
}

export interface RaciEntryFormData {
  clientId: string;
  serviceId?: string | null;
  activity: string;
  responsible: string;
  accountable: string;
  consulted?: string;
  informed?: string;
  notes?: string;
  active: boolean;
}
