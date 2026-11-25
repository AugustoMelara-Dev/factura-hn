import { describe, expect, it } from 'vitest';
import { firmar } from '@factura-hn/api';
import { verificarFirmaWebhook } from '../src';

describe('verificarFirmaWebhook (Web Crypto)', () => {
  const cuerpo = '{"id":"1","evento":"documento.emitido","datos":{"numero":"000-001-01-00000001"}}';
  const t = 1_800_000_000;
  const ahora = () => t * 1000;

  it('acepta la firma que produce la API y rechaza cuerpo, secreto o tiempo alterados', async () => {
    const cabecera = firmar('secreto-1', cuerpo, t);
    expect(await verificarFirmaWebhook(cuerpo, cabecera, 'secreto-1', { ahora })).toBe(true);
    expect(await verificarFirmaWebhook(cuerpo.replace('01-', '02-'), cabecera, 'secreto-1', { ahora })).toBe(false);
    expect(await verificarFirmaWebhook(cuerpo, cabecera, 'secreto-2', { ahora })).toBe(false);
    expect(await verificarFirmaWebhook(cuerpo, cabecera, 'secreto-1', { ahora: () => (t + 301) * 1000 })).toBe(false);
    expect(await verificarFirmaWebhook(cuerpo, cabecera.replace(`t=${t}`, `t=${t + 1}`), 'secreto-1', { ahora })).toBe(false);
  });

  it('varias firmas v1 (rotación del secreto): basta una válida, en cualquier orden', async () => {
    const valida = firmar('secreto-1', cuerpo, t).split(',')[1]!;
    const otra = firmar('secreto-viejo', cuerpo, t).split(',')[1]!;
    expect(await verificarFirmaWebhook(cuerpo, `t=${t},${otra},${valida}`, 'secreto-1', { ahora })).toBe(true);
    expect(await verificarFirmaWebhook(cuerpo, `t=${t},${valida},${otra}`, 'secreto-1', { ahora })).toBe(true);
    expect(await verificarFirmaWebhook(cuerpo, `t=${t},${otra},${otra}`, 'secreto-1', { ahora })).toBe(false);
    // Lo que firma la API durante la gracia: los dos secretos verifican.
    const doble = firmar(['secreto-viejo', 'secreto-1'], cuerpo, t);
    expect(await verificarFirmaWebhook(cuerpo, doble, 'secreto-viejo', { ahora })).toBe(true);
    expect(await verificarFirmaWebhook(cuerpo, doble, 'secreto-1', { ahora })).toBe(true);
    expect(await verificarFirmaWebhook(cuerpo, doble, 'secreto-2', { ahora })).toBe(false);
    // Entradas desconocidas y v1 mal formados se ignoran; dos t no.
    expect(await verificarFirmaWebhook(cuerpo, `t=${t}, v0=x, v1=zz, ${valida}, v2=${'0'.repeat(64)}`, 'secreto-1', { ahora })).toBe(true);
    expect(await verificarFirmaWebhook(cuerpo, `t=${t},t=${t},${valida}`, 'secreto-1', { ahora })).toBe(false);
    // Solo cuentan las 8 primeras firmas v1.
    expect(await verificarFirmaWebhook(cuerpo, [`t=${t}`, ...Array(7).fill(otra), valida].join(','), 'secreto-1', { ahora })).toBe(true);
    expect(await verificarFirmaWebhook(cuerpo, [`t=${t}`, ...Array(8).fill(otra), valida].join(','), 'secreto-1', { ahora })).toBe(false);
  });

  it('cabeceras mal formadas o vacías: false sin lanzar', async () => {
    for (const c of [undefined, null, '', 'v1=abc', `t=${t}`, `t=x,v1=${'0'.repeat(64)}`, `t=${t},v1=${'G'.repeat(64)}`]) {
      expect(await verificarFirmaWebhook(cuerpo, c, 'secreto-1', { ahora })).toBe(false);
    }
    expect(await verificarFirmaWebhook(cuerpo, firmar('', cuerpo, t), '', { ahora })).toBe(false);
  });
});
