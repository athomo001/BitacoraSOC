/**
 * Reglas del editor de plantillas (Administración → Checklist), separadas de
 * la pantalla para probarlas. La lista siempre está en orden de pantalla
 * (cada padre antes que sus hijos), que es lo que exige el backend
 * (checklist.ValidateTemplate).
 */
export interface EditorItem {
  /** id existente o clave temporal "new-N" para los ítems nuevos. */
  key: string;
  parentKey: string | null;
  title: string;
}

/** Mismo límite que checklist.MaxDepth en el backend. */
export const MAX_DEPTH = 3;

let counter = 0;
export function newKey(): string {
  counter += 1;
  return `new-${Date.now().toString(36)}-${counter}`;
}

export function depthOf(items: readonly EditorItem[], key: string): number {
  let level = 1;
  let parent = items.find((item) => item.key === key)?.parentKey ?? null;
  while (parent && level <= MAX_DEPTH + 1) {
    level++;
    parent = items.find((item) => item.key === parent)?.parentKey ?? null;
  }
  return level;
}

/** El ítem y todos sus descendientes: en orden de pantalla son un bloque contiguo. */
function blockEnd(items: readonly EditorItem[], index: number): number {
  const keys = new Set([items[index].key]);
  let end = index + 1;
  while (end < items.length && items[end].parentKey !== null && keys.has(items[end].parentKey!)) {
    keys.add(items[end].key);
    end++;
  }
  return end;
}

export function childCount(items: readonly EditorItem[], key: string): number {
  return items.filter((item) => item.parentKey === key).length;
}

export function addRoot(items: readonly EditorItem[], title: string): EditorItem[] {
  return [...items, { key: newKey(), parentKey: null, title }];
}

/** Sub-ítem nuevo al final de los hijos de `key`; null si ya está en la profundidad máxima. */
export function addChild(items: readonly EditorItem[], key: string, title: string): EditorItem[] | null {
  const index = items.findIndex((item) => item.key === key);
  if (index < 0 || depthOf(items, key) >= MAX_DEPTH) return null;
  const end = blockEnd(items, index);
  return [...items.slice(0, end), { key: newKey(), parentKey: key, title }, ...items.slice(end)];
}

export function remove(items: readonly EditorItem[], key: string): EditorItem[] {
  const index = items.findIndex((item) => item.key === key);
  if (index < 0) return [...items];
  return [...items.slice(0, index), ...items.slice(blockEnd(items, index))];
}

/** Sube (-1) o baja (+1) el ítem con sus sub-ítems entre sus hermanos. */
export function move(items: readonly EditorItem[], key: string, delta: -1 | 1): EditorItem[] {
  const index = items.findIndex((item) => item.key === key);
  if (index < 0) return [...items];
  const parent = items[index].parentKey;
  const siblings = items.map((item, i) => ({ item, i })).filter(({ item }) => item.parentKey === parent);
  const position = siblings.findIndex(({ i }) => i === index);
  const other = siblings[position + delta];
  if (!other) return [...items];
  const [firstStart, secondStart] = delta < 0 ? [other.i, index] : [index, other.i];
  const firstEnd = blockEnd(items, firstStart);
  const secondEnd = blockEnd(items, secondStart);
  return [
    ...items.slice(0, firstStart),
    ...items.slice(secondStart, secondEnd),
    ...items.slice(firstEnd, secondStart),
    ...items.slice(firstStart, firstEnd),
    ...items.slice(secondEnd),
  ];
}

export function rename(items: readonly EditorItem[], key: string, title: string): EditorItem[] {
  return items.map((item) => (item.key === key ? { ...item, title } : item));
}

/** Lo mismo que rechazaría el backend, para avisar antes de guardar. */
export function problems(name: string, items: readonly EditorItem[]): 'name' | 'items' | 'emptyTitle' | 'duplicate' | null {
  if (!name.trim()) return 'name';
  if (items.length === 0) return 'items';
  if (items.some((item) => !item.title.trim())) return 'emptyTitle';
  const seen = new Set<string>();
  for (const item of items) {
    const id = `${item.parentKey ?? ''}\u0000${item.title.trim().toLowerCase()}`;
    if (seen.has(id)) return 'duplicate';
    seen.add(id);
  }
  return null;
}
