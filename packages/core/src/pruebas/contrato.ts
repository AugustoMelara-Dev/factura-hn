/**
 * Batería de contrato para adaptadores de `AlmacenFiscal` (como invoicehn/test_support).
 *
 * Cualquiera que implemente un almacén (Postgres, SQLite, MySQL, IndexedDB…) corre la misma batería,
 * concurrencia incluida. No depende de ningún framework de pruebas: recibe `describe` e `it`.
 *
 * @example
 * import { describe, it } from 'vitest';
 * import { ejecutarContratoAlmacen } from 'factura-hn/pruebas';
 * ejecutarContratoAlmacen({ describe, it }, {
 *   nombre: 'Postgres',
 *   crear: async () => crearAlmacenVacio(),
 *   otraConexion: async () => otraConexionAlMismoAlmacen(),
 * });
 */
import { identificadorDe, type AlmacenFiscal } from '../almacen';
import { ErrorValidacion } from '../documento';
import {
  anular,
  buscarDocumento,
  corregirFechaAdelantada,
  emitir,
  eventosAuditoria,
  registrarAutorizacion,
} from '../emision';
import type { AutorizacionCAI, DocumentoEntrada } from '../tipos';

export interface FuncionesDePrueba {
  describe(nombre: string, fn: () => void): void;
  it(nombre: string, fn: () => Promise<void>, tiempoMaximo?: number): void;
}

export interface ConfigContrato {
  nombre: string;
  /** Un almacén vacío y aislado para cada prueba. */
  crear(): Promise<AlmacenFiscal>;
  /**
   * Otra conexión al **mismo** almacén que `almacen` (otra «caja»). Si no se da, la prueba de
   * concurrencia usa la misma instancia.
   */
  otraConexion?(almacen: AlmacenFiscal): Promise<AlmacenFiscal>;
  /** Libera recursos al terminar cada prueba. */
  cerrar?(almacen: AlmacenFiscal): Promise<void>;
  /** Emisiones concurrentes en la prueba de concurrencia. Por defecto 50. */
  concurrencia?: number;
}

class ErrorContrato extends Error {
  constructor(mensaje: string) {
    super(`[contrato AlmacenFiscal] ${mensaje}`);
    this.name = 'ErrorContrato';
  }
}

function igual(real: unknown, esperado: unknown, que: string): void {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new ErrorContrato(`${que}: se esperaba ${b}, se obtuvo ${a}`);
}

async function codigoDeError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ErrorValidacion) return e.errores[0]?.codigo ?? 'ErrorValidacion';
    return e instanceof Error ? e.name : String(e);
  }
  throw new ErrorContrato('se esperaba un error y la operación terminó bien');
}

/** Datos fijos de la batería. CAI ficticios: no son autorizaciones reales del SAR. */
export const DATOS_CONTRATO = {
  reloj: () => new Date('2026-11-18T12:00:00-06:00'),
  establecimiento: '000',
  puntoEmision: '001',
  autorizacion(cai: string, rangoInicial: number, rangoFinal: number, extra: Partial<AutorizacionCAI> = {}): AutorizacionCAI {
    return {
      cai, tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
      rangoInicial, rangoFinal, fechaLimiteEmision: '2027-06-30', ...extra,
    };
  },
  entrada(extra: Partial<DocumentoEntrada> = {}): DocumentoEntrada {
    return {
      emisor: {
        rtn: '08011999123456',
        razonSocial: 'Comercial de Prueba S. de R.L.',
        nombreComercial: 'Prueba',
        direccionCasaMatriz: 'Barrio El Centro, Tocoa, Colón',
        direccionEstablecimiento: 'Barrio El Centro, Tocoa, Colón',
        telefono: '2444-0000',
        correo: 'prueba@ejemplo.hn',
      },
      lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '2', precioUnitario: '89.50' }],
      ...extra,
    };
  },
};

export function ejecutarContratoAlmacen(t: FuncionesDePrueba, config: ConfigContrato): void {
  const D = DATOS_CONTRATO;
  const opciones = { reloj: D.reloj };
  const base = { establecimiento: D.establecimiento, puntoEmision: D.puntoEmision, opciones };

  const conAlmacen = (fn: (a: AlmacenFiscal) => Promise<void>) => async () => {
    const almacen = await config.crear();
    try {
      await fn(almacen);
    } finally {
      await config.cerrar?.(almacen);
    }
  };

  t.describe(`contrato AlmacenFiscal: ${config.nombre}`, () => {
    t.it('registra autorizaciones y rechaza rangos solapados o CAI repetidos', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
      igual(await codigoDeError(() => registrarAutorizacion(a, D.autorizacion('CAI-B', 50, 150))), 'RANGO_SOLAPADO', 'solapamiento');
      igual(await codigoDeError(() => registrarAutorizacion(a, D.autorizacion('cai-a', 101, 200))), 'AUTORIZACION_DUPLICADA', 'CAI repetido');
      await registrarAutorizacion(a, D.autorizacion('CAI-B', 101, 200));
      const lista = await a.transaccion((tx) => tx.autorizaciones('000-001-01'));
      igual(lista.map((x) => [x.cai, x.rangoInicial, x.rangoFinal]), [['CAI-A', 1, 100], ['CAI-B', 101, 200]], 'autorizaciones guardadas en orden');
    }));

    t.it('emite correlativos consecutivos y el documento guardado es idéntico al emitido', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
      const docs = [];
      for (let i = 0; i < 3; i++) docs.push(await emitir(D.entrada(), { almacen: a, ...base }));
      igual(docs.map((d) => d.numero), ['000-001-01-00000001', '000-001-01-00000002', '000-001-01-00000003'], 'números');
      const leido = await buscarDocumento(a, docs[1]!.numero);
      igual(leido, docs[1], 'ida y vuelta del documento');
      igual(await buscarDocumento(a, '000-001-01-00000099'), null, 'documento inexistente');
    }));

    t.it('continúa la numeración en la siguiente autorización del mismo identificador (B-04)', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 2));
      await registrarAutorizacion(a, D.autorizacion('CAI-B', 3, 4));
      const docs = [];
      for (let i = 0; i < 4; i++) docs.push(await emitir(D.entrada(), { almacen: a, ...base }));
      igual(docs.map((d) => [d.correlativo, d.cai]), [[1, 'CAI-A'], [2, 'CAI-A'], [3, 'CAI-B'], [4, 'CAI-B']], 'serie continua');
      igual(await codigoDeError(() => emitir(D.entrada(), { almacen: a, ...base })), 'RANGO_AGOTADO', 'rango agotado');
    }));

    t.it('salta los números de una autorización vencida y nunca los emite (Arts. 42 y 62)', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-VIEJO', 1, 10, { fechaLimiteEmision: '2026-11-17' }));
      igual(await codigoDeError(() => emitir(D.entrada(), { almacen: a, ...base })), 'AUTORIZACION_VENCIDA', 'todas vencidas');
      await registrarAutorizacion(a, D.autorizacion('CAI-NUEVO', 11, 20));
      const doc = await emitir(D.entrada(), { almacen: a, ...base });
      igual([doc.correlativo, doc.cai], [11, 'CAI-NUEVO'], 'salta al rango vigente');
    }));

    t.it('sin autorización no emite', conAlmacen(async (a) => {
      igual(await codigoDeError(() => emitir(D.entrada(), { almacen: a, ...base })), 'SIN_AUTORIZACION', 'sin CAI');
    }));

    t.it('un fallo dentro de la transacción no consume el número ni deja documento', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
      igual(await codigoDeError(() => emitir(D.entrada({ lineas: [] }), { almacen: a, ...base })), 'SIN_LINEAS', 'validación');
      const fallo = await codigoDeError(() =>
        emitir(D.entrada(), { almacen: a, ...base, alEmitir: async () => { throw new Error('libro contable caído'); } }),
      );
      igual(fallo, 'Error', 'error del gancho');
      igual(await buscarDocumento(a, '000-001-01-00000001'), null, 'no quedó documento');
      const doc = await emitir(D.entrada(), { almacen: a, ...base });
      igual(doc.correlativo, 1, 'el número 1 sigue disponible');
    }));

    t.it('cada identificador (punto de emisión y tipo) lleva su propia serie', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-F1', 1, 100));
      await registrarAutorizacion(a, D.autorizacion('CAI-F2', 1, 100, { puntoEmision: '002' }));
      await emitir(D.entrada(), { almacen: a, ...base });
      await emitir(D.entrada(), { almacen: a, ...base });
      const otro = await emitir(D.entrada(), { almacen: a, ...base, puntoEmision: '002' });
      igual(otro.numero, '000-002-01-00000001', 'serie independiente');
      igual(identificadorDe(D.autorizacion('x', 1, 1, { puntoEmision: 2 })), '000-002-01', 'identificador con relleno');
    }));

    t.it('no permite guardar dos veces el mismo número (inmutabilidad)', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
      const doc = await emitir(D.entrada(), { almacen: a, ...base });
      await codigoDeError(() => a.transaccion((tx) => tx.guardarDocumento(doc)));
    }));

    t.it('anula conservando el número; no anula dos veces; el número no se reutiliza (Art. 41)', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
      const doc = await emitir(D.entrada(), { almacen: a, ...base });
      const anulado = await anular(doc.numero, { almacen: a, motivo: 'Error en la cantidad', reloj: D.reloj });
      igual(anulado.estado, 'ANULADO', 'estado');
      igual((await buscarDocumento(a, doc.numero))?.estado, 'ANULADO', 'estado guardado');
      igual((await buscarDocumento(a, doc.numero))?.totales, doc.totales, 'montos conservados');
      igual(await codigoDeError(() => anular(doc.numero, { almacen: a, motivo: 'otra vez' })), 'YA_ANULADO', 'doble anulación');
      igual(await codigoDeError(() => anular('000-001-01-00000077', { almacen: a, motivo: 'x' })), 'DOCUMENTO_NO_ENCONTRADO', 'inexistente');
      const siguiente = await emitir(D.entrada(), { almacen: a, ...base });
      igual(siguiente.correlativo, 2, 'el anulado no se reutiliza');
    }));

    t.it('rechaza emitir si el reloj quedó antes del último documento (Art. 43)', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
      await emitir(D.entrada(), { almacen: a, ...base });
      const ayer = { reloj: () => new Date('2026-11-17T12:00:00-06:00') };
      igual(await codigoDeError(() => emitir(D.entrada(), { almacen: a, ...base, opciones: ayer })), 'FECHA_ANTERIOR_AL_ULTIMO', 'cronología');
    }));

    const enDias = (dias: number) => ({ reloj: () => new Date(Date.parse('2026-11-18T12:00:00-06:00') + dias * 86_400_000) });

    t.it('rechaza un salto de fecha sospechoso; con confirmación emite y queda en la bitácora', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
      await emitir(D.entrada(), { almacen: a, ...base });
      // Reloj adelantado a 2027-03-01: dentro de la vigencia del CAI, pero 103 días después.
      const adelantado = { ...base, opciones: enDias(103) };
      igual(await codigoDeError(() => emitir(D.entrada(), { almacen: a, ...adelantado })), 'RELOJ_ADELANTADO_SOSPECHOSO', 'salto sin confirmar');
      igual(await buscarDocumento(a, '000-001-01-00000002'), null, 'el rechazo no consume número');
      // 7 días exactos no es sospechoso; el límite es configurable.
      igual((await emitir(D.entrada(), { almacen: a, ...base, opciones: enDias(7) })).correlativo, 2, '7 días se aceptan');
      igual(await codigoDeError(() => emitir(D.entrada(), { almacen: a, ...base, opciones: enDias(10), saltoMaximoDias: 2 })), 'RELOJ_ADELANTADO_SOSPECHOSO', 'límite configurable');
      const doc = await emitir(D.entrada(), { almacen: a, ...base, opciones: enDias(40), confirmarSaltoDeFecha: true, actor: 'cajera-1' });
      igual(doc.fechaEmision, '2026-12-28', 'emitido con la fecha confirmada');
      const eventos = await eventosAuditoria(a, { tipo: 'SALTO_DE_FECHA_CONFIRMADO' });
      igual(eventos.map((e) => [e.identificador, e.actor, e.detalle['dias']]), [['000-001-01', 'cajera-1', 33]], 'evento del salto');
    }));

    t.it('procedimiento ante reloj adelantado: anular con corregirFechaAdelantada desbloquea la serie sin borrar nada (Arts. 41 y 43)', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
      await emitir(D.entrada(), { almacen: a, ...base });
      // La caja tenía el reloj 3 días adelantado (no llega al umbral) y emitió dos documentos «del 21».
      const malos = [
        await emitir(D.entrada(), { almacen: a, ...base, opciones: enDias(3) }),
        await emitir(D.entrada(), { almacen: a, ...base, opciones: enDias(3) }),
      ];
      // Con el reloj corregido, la serie queda trabada hasta el 21.
      igual(await codigoDeError(() => emitir(D.entrada(), { almacen: a, ...base })), 'FECHA_ANTERIOR_AL_ULTIMO', 'serie trabada');
      const anulados = await corregirFechaAdelantada(a, { identificador: '000-001-01', motivo: 'Reloj de la caja 1 adelantado', reloj: D.reloj, actor: 'supervisor' });
      igual(anulados.map((d) => [d.numero, d.estado, d.fechaEmision]), malos.map((d) => [d.numero, 'ANULADO', '2026-11-21']), 'anulados con su fecha original');
      // Nada se borró ni se editó: los números siguen ahí, con contenido y motivo.
      for (const d of malos) {
        const guardado = await buscarDocumento(a, d.numero);
        igual([guardado?.estado, guardado?.totales, guardado?.fechaEmision], ['ANULADO', d.totales, d.fechaEmision], `conservado ${d.numero}`);
        if (!/reloj adelantado/.test(guardado?.anulacion?.motivo ?? '')) throw new Error(`motivo sin constancia: ${guardado?.anulacion?.motivo}`);
      }
      // La serie vuelve a emitir hoy y continúa la numeración (no reutiliza los anulados).
      const nuevo = await emitir(D.entrada(), { almacen: a, ...base });
      igual([nuevo.correlativo, nuevo.fechaEmision], [4, '2026-11-18'], 'serie desbloqueada');
      const eventos = await eventosAuditoria(a, { identificador: '000-001-01' });
      igual(eventos.map((e) => e.tipo), ['AUTORIZACION_REGISTRADA', 'DOCUMENTO_ANULADO', 'DOCUMENTO_ANULADO', 'FECHA_ADELANTADA_CORREGIDA'], 'bitácora');
      igual(eventos[3]!.detalle['numeros'], malos.map((d) => d.numero), 'resumen de la corrección');
      igual(eventos[3]!.actor, 'supervisor', 'actor');
      igual(await codigoDeError(() => corregirFechaAdelantada(a, { identificador: '000-001-01', motivo: 'x', reloj: D.reloj })), 'SIN_DOCUMENTOS_ADELANTADOS', 'nada que corregir');
    }));

    t.it('la bitácora registra autorizaciones y anulaciones, y un fallo no deja eventos', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100), { reloj: D.reloj, actor: 'admin' });
      await codigoDeError(() => registrarAutorizacion(a, D.autorizacion('CAI-B', 50, 60)));
      const doc = await emitir(D.entrada(), { almacen: a, ...base });
      await anular(doc.numero, { almacen: a, motivo: 'Error en la cantidad', reloj: D.reloj, actor: 'cajera-1' });
      const eventos = await eventosAuditoria(a);
      igual(eventos.map((e) => [e.tipo, e.actor, e.numero ?? null]), [
        ['AUTORIZACION_REGISTRADA', 'admin', null],
        ['DOCUMENTO_ANULADO', 'cajera-1', doc.numero],
      ], 'eventos');
      igual([eventos[0]!.instante, eventos[0]!.fecha], ['2026-11-18T18:00:00.000Z', '2026-11-18'], 'instante y fecha de Honduras');
      igual(eventos[1]!.detalle['motivo'], 'Error en la cantidad', 'motivo');
    }));

    t.it('lista documentos por fecha e identificador, en orden de número', conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
      await registrarAutorizacion(a, D.autorizacion('CAI-NC', 1, 100, { tipoDocumento: '06' }));
      for (let i = 0; i < 3; i++) await emitir(D.entrada(), { almacen: a, ...base });
      const lista = await a.transaccion((tx) => tx.documentos({ desde: '2026-11-18', hasta: '2026-11-18', identificador: '000-001-01' }));
      igual(lista.map((d) => d.correlativo), [1, 2, 3], 'listado');
      igual((await a.transaccion((tx) => tx.documentos({ desde: '2026-11-19' }))).length, 0, 'filtro de fecha');
    }));

    const n = config.concurrencia ?? 50;
    t.it(`${n} emisiones concurrentes desde varias cajas: sin huecos ni repetidos`, conAlmacen(async (a) => {
      await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 1000));
      const cajas: AlmacenFiscal[] = [a];
      if (config.otraConexion) for (let i = 0; i < 4; i++) cajas.push(await config.otraConexion(a));
      try {
        const docs = await Promise.all(
          Array.from({ length: n }, (_, i) => emitir(D.entrada(), { almacen: cajas[i % cajas.length]!, ...base })),
        );
        const numeros = docs.map((d) => d.correlativo).sort((x, y) => x - y);
        igual(numeros, Array.from({ length: n }, (_, i) => i + 1), 'correlativos 1..n');
        const guardados = await a.transaccion((tx) => tx.documentos({ identificador: '000-001-01' }));
        igual(guardados.length, n, 'documentos guardados');
      } finally {
        for (const c of cajas.slice(1)) await config.cerrar?.(c);
      }
    }), 60_000);
  });
}
