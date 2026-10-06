import { ActionLog, ContactResult, ResolvedStep } from '../../core/escalation/escalation.service';

export type StepStatus = 'answered' | 'failed' | 'current' | 'pending';

export interface FlowState {
  /** Paso en curso (null si ya contestaron en un paso anterior o se agotó todo). */
  current: number | null;
  answered: boolean;
  exhausted: boolean;
  statusByStep: Map<number, StepStatus>;
  /** Último resultado por contacto (en cualquier paso). */
  lastResultByContact: Map<string, ContactResult>;
  /** Último resultado por paso y contacto ("2:c-juan"): la misma persona puede estar en varios niveles. */
  lastResultByStepContact: Map<string, ContactResult>;
  /** A quién toca llamar ahora dentro del paso actual (sequential o un pool). */
  nextMemberId: string | null;
  /** Desde cuándo está en curso el paso actual (para la cuenta regresiva). */
  currentSince: string | null;
}

export const stepContactKey = (order: number, contactId: string): string => `${order}:${contactId}`;

/**
 * Reconstruye el estado de la tarjeta de escalación a partir de la línea de
 * tiempo del incidente, con las mismas reglas que escalation.Next del
 * backend: si quien no contestó es de un pool (TI-Mundo…), se sigue con el
 * siguiente del pool; agotado el pool, o en unique/pool con alguien que no es
 * de un pool, se pasa al nivel siguiente; en sequential, cuando todos sus
 * miembros fallaron. "Escalar" cierra el paso en cualquier modo. Se deriva de
 * los intentos registrados (no de estado local) para que un F5 o un segundo
 * operador vean exactamente lo mismo.
 */
export function flowState(steps: readonly ResolvedStep[], actions: readonly ActionLog[], since: string): FlowState {
  const ordered = [...actions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const statusByStep = new Map<number, StepStatus>();
  const lastResultByContact = new Map<string, ContactResult>();
  const lastResultByStepContact = new Map<string, ContactResult>();
  for (const a of ordered) {
    if (!a.contactId) continue;
    lastResultByContact.set(a.contactId, a.result);
    lastResultByStepContact.set(stepContactKey(a.stepOrder, a.contactId), a.result);
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
    const members = step.team.members;
    const trackable = members.filter((m) => m.contactId);
    const tried = new Set<string>();
    let failed = false;
    let lastPool: string | null = null;
    for (const a of acts) {
      if (a.result === 'escalated_next_tier') {
        failed = true;
        break;
      }
      if (a.contactId) tried.add(a.contactId);
      const who = members.find((m) => m.contactId && m.contactId === a.contactId);
      if (who?.pool) {
        lastPool = who.pool.id;
        const pool = members.filter((m) => m.pool?.id === who.pool?.id && m.contactId);
        if (pool.every((m) => tried.has(m.contactId as string))) {
          lastPool = null;
          if (step.mode !== 'sequential') {
            failed = true;
            break;
          }
        }
        continue;
      }
      lastPool = null;
      if (step.mode !== 'sequential') {
        failed = true;
        break;
      }
    }
    if (!failed && step.mode === 'sequential' && trackable.length > 0 && trackable.every((m) => tried.has(m.contactId as string))) {
      failed = true;
    }
    if (failed) {
      statusByStep.set(step.order, 'failed');
      currentSince = acts.at(-1)?.createdAt ?? currentSince;
      continue;
    }
    statusByStep.set(step.order, 'current');
    current = step.order;
    if (lastPool) {
      nextMemberId = members.find((m) => m.pool?.id === lastPool && (!m.contactId || !tried.has(m.contactId)))?.id ?? null;
    } else if (step.mode === 'sequential') {
      nextMemberId = members.find((m) => !m.contactId || !tried.has(m.contactId))?.id ?? null;
    }
  }
  const exhausted = !answered && current === null && steps.length > 0;
  return {
    current,
    answered,
    exhausted,
    statusByStep,
    lastResultByContact,
    lastResultByStepContact,
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
