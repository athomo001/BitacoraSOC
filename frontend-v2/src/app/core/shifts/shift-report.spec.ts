import { buildShiftReport, formatTickets, parsePending, sanitizeMetric } from './shift-report';

const headings = {
  tickets: 'TICKETS ACTIVOS O DEL DIA',
  notes: 'OBSERVACIONES GENERALES',
  summary: 'RESUMEN DE GESTIÓN DEL TURNO',
  carried: 'PENDIENTES DEL TURNO ANTERIOR',
  pending: 'PENDIENTES PARA EL PRÓXIMO TURNO',
  noTickets: '(Sin tickets activos)',
  noNotes: '(Sin observaciones)',
};

describe('reporte de inicio/cierre de turno (portado del legacy)', () => {
  it('ordena los tickets con // y pega el comentario de la línea siguiente', () => {
    expect(formatTickets('// 5806, JUNJI, Nueva ofensa mg5\nesperando confirmación', 'cierre')).toEqual([
      '* 5806 | JUNJI | Nueva ofensa mg5\n  └ Situación actual: esperando confirmación',
    ]);
  });

  it('acepta la lista pegada tal cual del CDC (número, tab, descripción) y mezcla de , y ;', () => {
    expect(formatTickets('5 245\t[QA] Nueva plataforma\n// 5 193;acme,[QA][2022-180] QA', 'inicio')).toEqual([
      '* 5245 | [QA] Nueva plataforma',
      '* 5 193 | acme | [QA][2022-180] QA',
    ]);
  });

  it('no pierde nada: una línea sin formato queda como viñeta y un └ propio se respeta', () => {
    expect(formatTickets('nada raro\n// 1, A, x\n└ Estado: ya avisado', 'inicio')).toEqual(['* nada raro', '* 1 | A | x\n  └ Estado: ya avisado']);
  });

  it('la cifra admite solo enteros de hasta 3 dígitos', () => {
    expect(sanitizeMetric('1.234a')).toBe('123');
  });

  it('cierre: etiqueta, secciones y pendientes para el próximo turno', () => {
    const text = buildShiftReport({
      mode: 'cierre', metricLabel: 'Incidentes gestionados (SOC)', metricValue: '6', ticketsText: '', notesText: 'Todo tranquilo',
      pendingText: '- [ ] Revisar QRadar', headings,
    });
    expect(text).toBe(
      '#cierredeturno\n\n## RESUMEN DE GESTIÓN DEL TURNO\n* Incidentes gestionados (SOC): 6\n\n## TICKETS ACTIVOS O DEL DIA\n(Sin tickets activos)\n\n## OBSERVACIONES GENERALES\nTodo tranquilo\n\n## PENDIENTES PARA EL PRÓXIMO TURNO\n- [ ] Revisar QRadar',
    );
  });

  it('inicio: incluye los pendientes del turno anterior con lo marcado', () => {
    const text = buildShiftReport({
      mode: 'inicio', metricLabel: 'Tickets totales CDC', metricValue: '37', ticketsText: '', notesText: '',
      carried: [{ text: 'Seguir 5799', done: true }, { text: 'Revisar VPN', done: false }], headings,
    });
    expect(text).toContain('#iniciodeturno\n\n* Tickets totales CDC: 37\n\n## PENDIENTES DEL TURNO ANTERIOR\n- [x] Seguir 5799\n- [ ] Revisar VPN');
  });

  it('lee los pendientes que dejó el cierre anterior', () => {
    expect(parsePending('- [ ] Uno\n- [x] Dos\nTres')).toEqual([
      { text: 'Uno', done: false },
      { text: 'Dos', done: true },
      { text: 'Tres', done: false },
    ]);
  });
});
