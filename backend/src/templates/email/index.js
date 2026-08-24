/**
 * File Purpose: backend/src/templates/email/index.js
 * Responsibilities: Centralize and export all email templates across the backend application.
 */

// Importamos todas las plantillas centralizadas
const { buildEscalationScheduleEmail } = require('./escalationSchedule');
const { buildOutOfOfficeCalendarEmail } = require('./outOfOfficeCalendar');
const { buildIncidentEmail, buildIncidentEmailPreview, PALETTES } = require('./incidentReport');
const { buildShiftReportEmail } = require('./shiftReport');
const { buildPasswordRecoveryEmail } = require('./passwordRecovery');
const { buildReminderHtml, formatReminderTextForEmail } = require('./shiftReminder');
const { buildBirthdayEmail } = require('./birthdayCongratulation');

// Exportación centralizada
module.exports = {
  buildEscalationScheduleEmail,
  buildOutOfOfficeCalendarEmail,
  buildIncidentEmail,
  buildIncidentEmailPreview,
  PALETTES,
  buildShiftReportEmail,
  buildPasswordRecoveryEmail,
  buildReminderHtml,
  formatReminderTextForEmail,
  buildBirthdayEmail
};
