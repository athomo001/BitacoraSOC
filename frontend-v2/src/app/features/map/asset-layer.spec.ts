import { TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/i18n/i18n.service';
import { MapAsset } from '../../core/map/map.models';
import { groupSpots, plain, spotTone, tipElement } from './asset-layer';

import '../../core/i18n/packs/map';

const base = { kind: 'server', latitude: -33.4489, longitude: -70.6693, groupName: 'Rack A', clientName: 'Minera Norte', clientId: 'c1' };
const when = () => '08:42';

describe('Capa Equipos del mapa', () => {
  it('los equipos del mismo punto son un pin con el color del peor; los afectados primero', () => {
    const spots = groupSpots([
      { id: 'a1', name: 'SW-01', code: 'sw-01', status: 'ok', ...base },
      { id: 'a2', name: 'SRV-02', code: 'srv-02', status: 'warn', maintenance: { title: 'Cambio de fuente', until: '2026-10-23T18:00:00Z' }, ...base },
      { id: 'a3', name: 'RT-03', code: 'rt-03', status: 'bad', incident: { title: 'Caída troncal', openedAt: '2026-10-23T08:42:00Z', count: 1 }, ...base },
    ] as MapAsset[]);
    expect(spots).toHaveLength(1);
    expect(spotTone(spots[0])).toBe('bad');
    expect(spots[0].assets.map((a) => a.id)).toEqual(['a3', 'a2', 'a1']);
  });

  it('la tarjetita dice qué pasó y por qué, sin interpretar HTML', () => {
    const i18n = TestBed.inject(I18nService);
    const [spot] = groupSpots([
      { id: 'a1', name: 'RT-03', code: 'rt-03', status: 'bad', ...base,
        incident: { title: 'Caída troncal', openedAt: '2026-10-23T08:42:00Z', count: 1 },
        entry: { id: 'e1', content: '<img src=x onerror=alert(1)> Corte de fibra', at: '2026-10-23T09:00:00Z', author: 'Ana', count: 1 } },
      { id: 'a2', name: 'SW-01', code: 'sw-01', status: 'ok', ...base },
    ] as MapAsset[]);
    const tip = tipElement(spot, i18n, when);
    expect(tip.textContent).toContain('Rack A');
    expect(tip.textContent).toContain('Minera Norte · 2 equipos');
    expect(tip.textContent).toContain('Incidente abierto desde 08:42: Caída troncal');
    expect(tip.textContent).toContain('Bitácora · Ana, 08:42');
    expect(tip.querySelector('img')).toBeNull();
    expect(tip.querySelectorAll('.mp-tip__line--bad')).toHaveLength(2);
  });

  it('un punto sin novedad lo dice', () => {
    const i18n = TestBed.inject(I18nService);
    const [spot] = groupSpots([{ id: 'a1', name: 'SW-01', code: 'sw-01', status: 'ok', ...base, clientName: undefined, clientId: undefined } as MapAsset]);
    const tip = tipElement(spot, i18n, when);
    expect(tip.textContent).toContain('Internos (sin cliente) · 1 equipo');
    expect(tip.textContent).toContain('Sin novedad');
  });

  it('el Markdown de la Bitácora queda en una línea simple y corta', () => {
    expect(plain('## Corte\n**fibra** en [tramo](http://x) norte')).toBe('Corte fibra en tramo norte');
    expect(plain('a'.repeat(200), 20)).toHaveLength(20);
  });
});
