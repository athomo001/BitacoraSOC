import { coordsLabel, parseCoords } from './location-fields';

describe('Coordenadas de un equipo o grupo', () => {
  it('entiende lo que copia un mapa: «lat, lng», con espacio o con «;» y coma decimal', () => {
    expect(parseCoords('-33.4489, -70.6693')).toEqual({ latitude: -33.4489, longitude: -70.6693 });
    expect(parseCoords('  -33.4489 -70.6693 ')).toEqual({ latitude: -33.4489, longitude: -70.6693 });
    expect(parseCoords('-33,4489; -70,6693')).toEqual({ latitude: -33.4489, longitude: -70.6693 });
  });

  it('vacío es sin coordenadas; lo que no se entiende o está fuera de rango no vale', () => {
    expect(parseCoords('')).toEqual({});
    expect(parseCoords('-33.4489')).toBeNull();
    expect(parseCoords('Santiago, Chile')).toBeNull();
    expect(parseCoords('-95, -70')).toBeNull();
    expect(parseCoords('-33, 190')).toBeNull();
  });

  it('se muestran como se escriben', () => {
    expect(coordsLabel(-33.4489, -70.6693)).toBe('-33.4489, -70.6693');
    expect(coordsLabel(undefined, undefined)).toBe('');
  });
});
