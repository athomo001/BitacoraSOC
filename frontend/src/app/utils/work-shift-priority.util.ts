/**
 * File Purpose: frontend/src/app/utils/work-shift-priority.util.ts
 * Responsibilities: Resolver la condición visible de un analista basada en la prioridad de negocio.
 * Prioridad: MEDICAL_LEAVE (Licencia) > VACATION (Vacaciones) > TELEWORK (Teletrabajo) > Otras.
 */

export function resolverCondicionVisible(
  allAssignments: any[],
  userId: string,
  externalPersonId: string,
  startDate: Date | string,
  endDate: Date | string
): string | null {
  const startLimit = new Date(startDate);
  const endLimit = new Date(endDate);

  if (isNaN(startLimit.getTime()) || isNaN(endLimit.getTime())) {
    return null;
  }

  // Filtrar asignaciones correspondientes al usuario/analista consultado
  const userAssignments = allAssignments.filter(asg => {
    const asgUserId = asg.userId?._id || asg.userId;
    const asgExtId = asg.externalPersonId?._id || asg.externalPersonId;

    if (userId && asgUserId && String(asgUserId) === String(userId)) return true;
    if (externalPersonId && asgExtId && String(asgExtId) === String(externalPersonId)) return true;
    return false;
  });

  // Filtrar las asignaciones que se solapan con el período consultado (inclusivo)
  const overlapping = userAssignments.filter(asg => {
    const start = new Date(asg.weekStartDate);
    const end = new Date(asg.weekEndDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return false;
    }

    // Cruce inclusivo
    return start <= endLimit && end >= startLimit;
  });

  if (overlapping.length === 0) {
    return null;
  }

  // Resolver según prioridad de negocio:
  // 1. Licencia Médica (MEDICAL_LEAVE)
  const hasMedicalLeave = overlapping.some(asg => asg.roleCode === 'MEDICAL_LEAVE');
  if (hasMedicalLeave) return 'MEDICAL_LEAVE';

  // 2. Vacaciones (VACATION)
  const hasVacation = overlapping.some(asg => asg.roleCode === 'VACATION');
  if (hasVacation) return 'VACATION';

  // 3. Teletrabajo (TELEWORK)
  const hasTelework = overlapping.some(asg => asg.roleCode === 'TELEWORK');
  if (hasTelework) return 'TELEWORK';

  // 4. Otras condiciones (se retorna la de la primera asignación que coincida)
  return overlapping[0].roleCode;
}
