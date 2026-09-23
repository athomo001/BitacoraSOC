import { ActionLog, ContactResult, ResolvedStep } from '../../core/escalation/escalation.service';

export type StepStatus = 'answered' | 'failed' | 'current' | 'pending';

export interface FlowState {
  /** Paso en curso (null si ya contestaron en un paso anterior o se agotó todo). */
  current: number | null;
  answered: boolean;
  exhausted: boolean;
  statusByStep: Map<number, StepStatus>;
  /** Último resultado por contacto, para pintar cada fila de la tarjeta. */
  lastResultByContact: Map<string, ContactResult>;
  /** En modo sequential, a quién toca llamar ahora dentro del paso actual. */
  nextMemberId: string | null;
  /** Desde cuándo está en curso el paso actual (para la cuenta regresiva). */
  currentSince: string | null;
}

/**
 * Reconstruye el estado de la tarjeta de escalación a partir de la línea de
 * tiempo del incidente, con las mismas reglas que escalation.Next del
 * backend: en sequential se agota el paso cuando todos sus miembros fallaron;
 * en unique/pool basta un intento fallido para pasar al siguiente. Se deriva
 * de los intentos registrados (no de estado local) para que un F5 o un
 * segundo operador vean exactamente lo mismo.
 */
export function flowState(steps: readonly ResolvedStep[], actions: readonly ActionLog[], since: string): FlowState {
  const ordered = [...actions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const statusByStep = new Map<number, StepStatus>();
  const lastResultByContact = new Map<string, ContactResult>();
  for (const a of ordered) {
    if (a.contactId) lastResultByContact.set(a.contactId, a.result);
  }
  let current: number | null = null;
  let answered = false;
  let nextMemberId: string | null = null;
  let currentSince: string | null = since;

  for (const step of [...steps].sort((a, b) => a.order - b.order)) {
    if (current !== null || answered) {
      statusByStep.set(step.order, 'pending');
      continue;
    }
    const acts = ordered.filter((a) => a.stepOrder === step.order);
    if (acts.some((a) => a.result === 'answered')) {
      statusByStep.set(step.order, 'answered');
      answered = true;
      continue;
    }
    const failedContacts = new Set(acts.filter((a) => a.contactId).map((a) => a.contactId as string));
    const trackable = step.team.members.filter((m) => m.contactId);
    const failed =
      step.mode === 'sequential'
        ? trackable.length > 0 && trackable.every((m) => failedContacts.has(m.contactId as string))
        : acts.length > 0;
    if (failed) {
      statusByStep.set(step.order, 'failed');
      currentSince = acts.at(-1)?.createdAt ?? currentSince;
      continue;
    }
    statusByStep.set(step.order, 'current');
    current = step.order;
    if (step.mode === 'sequential') {
      nextMemberId = step.team.members.find((m) => !m.contactId || !failedContacts.has(m.contactId))?.id ?? null;
    }
  }
  const exhausted = !answered && current === null && steps.length > 0;
  return {
    current,
    answered,
    exhausted,
    statusByStep,
    lastResultByContact,
    nextMemberId,
    currentSince: current === null ? null : currentSince,
  };
}

/** Segundos que faltan para escalar el paso actual (negativo = ya venció). */
export function secondsUntilEscalation(step: ResolvedStep, currentSince: string | null, now: number): number | null {
  if (!currentSince || step.waitBeforeEscalateMinutes <= 0) return null;
  const deadline = new Date(currentSince).getTime() + step.waitBeforeEscalateMinutes * 60_000;
  return Math.round((deadline - now) / 1000);
}

/** 305 → "05:05"; -70 → "-01:10". */
export function formatCountdown(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const mm = String(Math.floor(abs / 60)).padStart(2, '0');
  const ss = String(abs % 60).padStart(2, '0');
  return `${sign}${mm}:${ss}`;
}
