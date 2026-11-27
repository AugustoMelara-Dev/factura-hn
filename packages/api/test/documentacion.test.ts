/**
 * La guía de la API (`docs/api.md`, que el sitio copia en su referencia) es documentación de producto: sin métricas
 * internas del desarrollo (OWASP, mutación, cobertura).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guia = readFileSync(new URL('../../../docs/api.md', import.meta.url), 'utf8');

describe('docs/api.md', () => {
  it('no menciona métricas internas', () => {
    expect(guia).not.toMatch(/OWASP|mutaci[oó]n|cobertura/i);
  });
});
