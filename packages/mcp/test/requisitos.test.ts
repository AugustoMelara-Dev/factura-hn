import { describe, expect, it } from 'vitest';
import { nodeAnterior, problemaDeNode, usaSQLite } from '../src/requisitos';

describe('Node 22.13 para los caminos con SQLite', () => {
  it('compara la versión de Node', () => {
    expect(['20.18.0', '22.0.0', '22.12.9', '18.20.4'].map(nodeAnterior)).toEqual([true, true, true, true]);
    expect(['22.13.0', '22.13.1', '22.20.0', '23.0.0', '24.11.1'].map(nodeAnterior)).toEqual([false, false, false, false, false]);
  });

  it('solo los caminos que abren SQLite exigen la versión', () => {
    expect(usaSQLite([], {})).toBe(true);
    expect(usaSQLite([], { FHN_API_URL: 'http://127.0.0.1:8787' })).toBe(false);
    expect(usaSQLite(['init', '--demo'], {})).toBe(true);
    expect(usaSQLite(['iniciar'], { FHN_API_URL: 'x' })).toBe(true);
    expect(usaSQLite(['registrar-cai', '--cai', 'X'], {})).toBe(true);
    expect(usaSQLite(['registrar-cai', '--api-url', 'http://127.0.0.1:8787'], {})).toBe(false);
    expect(usaSQLite(['registrar-cai', '--api-url=http://127.0.0.1:8787'], {})).toBe(false);
    expect(usaSQLite(['registrar-cai'], { FHN_API_URL: 'x' })).toBe(false);
    expect(usaSQLite(['ayuda'], {})).toBe(false);
  });

  it('el mensaje dice la versión que se tiene y la que hace falta, en español', () => {
    expect(problemaDeNode(['init', '--demo'], {}, '22.12.0')).toMatch(/^Necesitas Node 22\.13 o más reciente \(tienes 22\.12\.0\)/);
    expect(problemaDeNode(['init', '--demo'], {}, '22.13.0')).toBeNull();
    expect(problemaDeNode([], { FHN_API_URL: 'x' }, '20.0.0')).toBeNull();
  });
});
