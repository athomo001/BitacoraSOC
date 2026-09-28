import { ChecklistItem } from './checklists.service';

export type CheckStatus = 'verde' | 'rojo';

/** Respuesta del analista a una hoja. `null` = todavía sin evaluar (nunca se asume verde). */
export interface LeafAnswer {
  status: CheckStatus | null;
  observation: string;
}

export type ChecklistAnswers = Record<string, LeafAnswer>;

export interface ChecklistProgress {
  evaluated: number;
  total: number;
  red: number;
  /** Hojas en rojo sin observación: el backend las rechaza (400). */
  redWithoutObservation: number;
  complete: boolean;
}

/**
 * Reglas del formulario de checklist (spec/06 §6.6), separadas de la
 * pantalla para poder probarlas: un ítem CON sub-ítems es un grupo que se
 * calcula ("peor estado gana"); todo ítem SIN sub-ítems es una hoja que el
 * analista evalúa, tenga padre o no. La versión anterior trataba "tiene
 * padre" como "es grupo" y rompía toda plantilla jerárquica.
 */
export function groupIds(items: readonly ChecklistItem[]): Set<string> {
  return new Set(items.flatMap((item) => (item.parentItemId ? [item.parentItemId] : [])));
}

export function leaves(items: readonly ChecklistItem[]): ChecklistItem[] {
  const groups = groupIds(items);
  return items.filter((item) => !groups.has(item.id));
}

/** Todas las hojas arrancan SIN evaluar: antes partían en verde y el checklist se enviaba con un clic sin mirar nada. */
export function emptyAnswers(items: readonly ChecklistItem[]): ChecklistAnswers {
  return Object.fromEntries(leaves(items).map((leaf) => [leaf.id, { status: null, observation: '' }]));
}

export function progress(items: readonly ChecklistItem[], answers: ChecklistAnswers): ChecklistProgress {
  const leafItems = leaves(items);
  let evaluated = 0;
  let red = 0;
  let redWithoutObservation = 0;
  for (const leaf of leafItems) {
    const answer = answers[leaf.id];
    if (!answer?.status) continue;
    evaluated++;
    if (answer.status === 'rojo') {
      red++;
      if (!answer.observation.trim()) redWithoutObservation++;
    }
  }
  return { evaluated, total: leafItems.length, red, redWithoutObservation, complete: evaluated === leafItems.length && redWithoutObservation === 0 };
}

/** Estado calculado de un grupo: rojo si alguna hoja debajo está en rojo; null si falta evaluar alguna. */
export function groupStatus(groupId: string, items: readonly ChecklistItem[], answers: ChecklistAnswers): CheckStatus | null {
  const children = items.filter((item) => item.parentItemId === groupId);
  let pending = false;
  for (const child of children) {
    const status = answers[child.id] ? answers[child.id].status : groupStatus(child.id, items, answers);
    if (status === 'rojo') return 'rojo';
    if (status === null) pending = true;
  }
  return pending ? null : 'verde';
}

/** Profundidad para sangrar sub-ítems en pantalla. */
export function depth(item: ChecklistItem, items: readonly ChecklistItem[]): number {
  let level = 0;
  let parentId = item.parentItemId;
  while (parentId && level < 10) {
    level++;
    parentId = items.find((candidate) => candidate.id === parentId)?.parentItemId;
  }
  return level;
}

/** Payload de POST /api/shift-checks: solo hojas, ya validadas por `progress().complete`. */
export function toServices(items: readonly ChecklistItem[], answers: ChecklistAnswers) {
  return leaves(items).map((leaf) => ({
    checklistItemId: leaf.id,
    serviceTitle: leaf.title,
    status: answers[leaf.id].status as CheckStatus,
    observation: answers[leaf.id].observation.trim() || undefined,
  }));
}
