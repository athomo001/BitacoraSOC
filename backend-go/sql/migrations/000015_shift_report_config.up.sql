-- 000015: el "Reporte de Turno" por correo vuelve al formato del legacy
-- (estándar del área), con su misma configuración por turno
-- (WorkShift.emailReportConfig): qué secciones incluir y la plantilla del
-- asunto con [fecha], [turno] y [hora].
ALTER TABLE work_shifts
  ADD COLUMN email_include_checklist BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN email_include_entries BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN email_subject_template TEXT NOT NULL DEFAULT 'Reporte SOC [fecha] [turno]';
