/**
 * File Purpose: backend/src/utils/backup-manifest.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const AdminNote = require('../models/AdminNote');
const AppConfig = require('../models/AppConfig');
const AuditLog = require('../models/AuditLog');
const CatalogEvent = require('../models/CatalogEvent');
const CatalogLogSource = require('../models/CatalogLogSource');
const CatalogOperationType = require('../models/CatalogOperationType');
const ChecklistNotificationLog = require('../models/ChecklistNotificationLog');
const ChecklistTemplate = require('../models/ChecklistTemplate');
const Client = require('../models/Client');
const ClientEscalationRule = require('../models/ClientEscalationRule');
const Complement = require('../models/Complement');
const ComplementSharedRecord = require('../models/ComplementSharedRecord');
const Contact = require('../models/Contact');
const Entry = require('../models/Entry');
const EscalationRule = require('../models/EscalationRule');
const ExternalPerson = require('../models/ExternalPerson');
const GlpiConfig = require('../models/GlpiConfig');
const LogForwardingConfig = require('../models/LogForwardingConfig');
const PersonalNote = require('../models/PersonalNote');
const RaciEntry = require('../models/RaciEntry');
const Service = require('../models/Service');
const ServiceCatalog = require('../models/ServiceCatalog');
const ShiftAssignment = require('../models/ShiftAssignment');
const ShiftCheck = require('../models/ShiftCheck');
const ShiftClosure = require('../models/ShiftClosure');
const ShiftOverride = require('../models/ShiftOverride');
const ShiftRole = require('../models/ShiftRole');
const ShiftRotationCycle = require('../models/ShiftRotationCycle');
const SmtpConfig = require('../models/SmtpConfig');
const User = require('../models/User');
const WorkShift = require('../models/WorkShift');
const WorkShiftAssignment = require('../models/WorkShiftAssignment');

const backupModels = {
  entries: Entry,
  checks: ShiftCheck,
  users: User,
  adminNotes: AdminNote,
  appConfigs: AppConfig,
  auditLogs: AuditLog,
  catalogEvents: CatalogEvent,
  catalogLogSources: CatalogLogSource,
  catalogOperationTypes: CatalogOperationType,
  checklistNotificationLogs: ChecklistNotificationLog,
  checklistTemplates: ChecklistTemplate,
  clients: Client,
  clientEscalationRules: ClientEscalationRule,
  complements: Complement,
  complementSharedRecords: ComplementSharedRecord,
  contacts: Contact,
  escalationRules: EscalationRule,
  externalPersons: ExternalPerson,
  glpiConfigs: GlpiConfig,
  logForwardingConfigs: LogForwardingConfig,
  personalNotes: PersonalNote,
  raciEntries: RaciEntry,
  services: Service,
  serviceCatalogs: ServiceCatalog,
  shiftAssignments: ShiftAssignment,
  shiftClosures: ShiftClosure,
  shiftOverrides: ShiftOverride,
  shiftRoles: ShiftRole,
  shiftRotationCycles: ShiftRotationCycle,
  smtpConfigs: SmtpConfig,
  workShifts: WorkShift,
  workShiftAssignments: WorkShiftAssignment
};

const BACKUP_EXPORT_VERSION = '3.1';

module.exports = {
  backupModels,
  BACKUP_EXPORT_VERSION
};