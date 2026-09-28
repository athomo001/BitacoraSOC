import { ChecklistItem } from './checklists.service';
import { causeSuggestions, depth, emptyAnswers, groupStatus, leaves, progress, toServices } from './checklist-form';

// Mockup de spec/06 §6.6: un grupo con 2 sub-ítems + ítems sueltos.
const ITEMS: ChecklistItem[] = [
  { id: 'internet', title: 'Internet Corporativo', itemOrder: 1 },
  { id: 'sede', title: 'Conectividad Sede Norte', itemOrder: 2 },
  { id: 'router', parentItemId: 'sede', title: 'Router Principal', itemOrder: 3 },
  { id: 'switch', parentItemId: 'sede', title: 'Switch Backup', itemOrder: 4 },
  { id: 'camaras', title: 'Cámaras Sala de Control', itemOrder: 5 },
];

describe('checklist-form', () => {
  it('las hojas son los ítems sin hijos, tengan padre o no (regresión: antes se evaluaban solo los raíz)', () => {
    expect(leaves(ITEMS).map((i) => i.id)).toEqual(['internet', 'router', 'switch', 'camaras']);
  });

  it('todas las hojas arrancan sin evaluar, nunca en verde por defecto', () => {
    const answers = emptyAnswers(ITEMS);
    expect(Object.keys(answers)).toEqual(['internet', 'router', 'switch', 'camaras']);
    expect(Object.values(answers).every((a) => a.status === null)).toBe(true);
    expect(progress(ITEMS, answers)).toMatchObject({ evaluated: 0, total: 4, complete: false });
  });

  it('no está completo hasta evaluar todo y justificar cada rojo', () => {
    const answers = emptyAnswers(ITEMS);
    answers['internet'].status = 'verde';
    answers['router'].status = 'rojo';
    answers['switch'].status = 'verde';
    answers['camaras'].status = 'verde';
    expect(progress(ITEMS, answers)).toMatchObject({ evaluated: 4, red: 1, redWithoutObservation: 1, complete: false });
    answers['router'].observation = 'Sin respuesta SNMP';
    expect(progress(ITEMS, answers).complete).toBe(true);
  });

  it('el grupo se calcula: peor estado gana, pendiente mientras falte un hijo', () => {
    const answers = emptyAnswers(ITEMS);
    expect(groupStatus('sede', ITEMS, answers)).toBeNull();
    answers['switch'].status = 'verde';
    expect(groupStatus('sede', ITEMS, answers)).toBeNull();
    answers['router'].status = 'verde';
    expect(groupStatus('sede', ITEMS, answers)).toBe('verde');
    answers['router'].status = 'rojo';
    expect(groupStatus('sede', ITEMS, answers)).toBe('rojo');
  });

  it('el payload solo lleva hojas, nunca el grupo calculado', () => {
    const answers = emptyAnswers(ITEMS);
    for (const id of Object.keys(answers)) answers[id].status = 'verde';
    const services = toServices(ITEMS, answers);
    expect(services.map((s) => s.checklistItemId)).not.toContain('sede');
    expect(services).toHaveLength(4);
  });

  it('calcula la profundidad para sangrar sub-ítems', () => {
    expect(depth(ITEMS[2], ITEMS)).toBe(1);
    expect(depth(ITEMS[0], ITEMS)).toBe(0);
  });

  it('sugiere reutilizar la observación de un rojo ANTERIOR con palabra clave en común (misma regla que checklist.Correlate)', () => {
    const items: ChecklistItem[] = [
      { id: 'troncal', title: 'Enlace Troncal Fibra', itemOrder: 1 },
      { id: 'dns', title: 'DNS interno', itemOrder: 2 },
      { id: 'backup', title: 'Enlace Backup Fibra', itemOrder: 3 },
    ];
    const answers = emptyAnswers(items);
    answers['troncal'] = { status: 'rojo', observation: 'Corte de fibra Km 42' };
    answers['dns'] = { status: 'rojo', observation: '' };
    answers['backup'] = { status: 'rojo', observation: '' };

    const suggestions = causeSuggestions(items, answers);

    expect(suggestions['backup']).toEqual({ fromItemId: 'troncal', fromTitle: 'Enlace Troncal Fibra', observation: 'Corte de fibra Km 42' });
    expect(suggestions['dns']).toBeUndefined(); // sin palabra en común
    expect(suggestions['troncal']).toBeUndefined(); // ya tiene observación
  });

  it('no sugiere hacia adelante: un rojo posterior nunca explica a uno anterior', () => {
    const items: ChecklistItem[] = [
      { id: 'a', title: 'Enlace Norte', itemOrder: 1 },
      { id: 'b', title: 'Enlace Sur', itemOrder: 2 },
    ];
    const answers = emptyAnswers(items);
    answers['a'] = { status: 'rojo', observation: '' };
    answers['b'] = { status: 'rojo', observation: 'Caído' };
    expect(causeSuggestions(items, answers)).toEqual({});
  });
});
