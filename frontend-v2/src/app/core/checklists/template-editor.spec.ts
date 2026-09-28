import { EditorItem, addChild, addRoot, childCount, depthOf, move, problems, remove, rename } from './template-editor';

const TREE: EditorItem[] = [
  { key: 'internet', parentKey: null, title: 'Internet Corporativo' },
  { key: 'troncal', parentKey: 'internet', title: 'Enlace Troncal' },
  { key: 'backup', parentKey: 'internet', title: 'Enlace Backup' },
  { key: 'sede', parentKey: null, title: 'Sede Norte' },
  { key: 'router', parentKey: 'sede', title: 'Router' },
  { key: 'dns', parentKey: null, title: 'DNS' },
];
const keys = (items: EditorItem[]) => items.map((i) => i.key);

describe('template-editor', () => {
  it('agrega un sub-ítem al final de los hijos, antes del siguiente ítem raíz', () => {
    const next = addChild(TREE, 'internet', 'Nuevo')!;
    expect(next[3]).toMatchObject({ parentKey: 'internet', title: 'Nuevo' });
    expect(next[4].key).toBe('sede');
  });

  it('no deja pasar de 3 niveles', () => {
    const level3 = addChild(TREE, 'troncal', 'Puerto 1')!;
    const puerto = level3.find((i) => i.title === 'Puerto 1')!;
    expect(depthOf(level3, puerto.key)).toBe(3);
    expect(addChild(level3, puerto.key, 'Demasiado')).toBeNull();
  });

  it('mueve un ítem con todos sus sub-ítems entre hermanos', () => {
    expect(keys(move(TREE, 'sede', -1))).toEqual(['sede', 'router', 'internet', 'troncal', 'backup', 'dns']);
    expect(keys(move(TREE, 'internet', 1))).toEqual(['sede', 'router', 'internet', 'troncal', 'backup', 'dns']);
    expect(keys(move(TREE, 'backup', -1))).toEqual(['internet', 'backup', 'troncal', 'sede', 'router', 'dns']);
  });

  it('no mueve fuera de sus hermanos (primero hacia arriba, último hacia abajo)', () => {
    expect(keys(move(TREE, 'internet', -1))).toEqual(keys(TREE));
    expect(keys(move(TREE, 'backup', 1))).toEqual(keys(TREE));
  });

  it('quitar un grupo quita sus sub-ítems', () => {
    expect(keys(remove(TREE, 'internet'))).toEqual(['sede', 'router', 'dns']);
    expect(childCount(remove(TREE, 'troncal'), 'internet')).toBe(1);
  });

  it('detecta lo que el backend rechazaría', () => {
    expect(problems('', TREE)).toBe('name');
    expect(problems('P', [])).toBe('items');
    expect(problems('P', rename(TREE, 'dns', '  '))).toBe('emptyTitle');
    expect(problems('P', rename(TREE, 'backup', 'enlace troncal'))).toBe('duplicate');
    expect(problems('P', addRoot(TREE, 'VPN'))).toBeNull();
  });
});
