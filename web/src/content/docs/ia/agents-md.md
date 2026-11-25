---
title: AGENTS.md
description: Qué es el AGENTS.md de factura-hn, en qué paquetes viaja y qué le indica a un agente que integra la librería.
sidebar:
  order: 2
---

`AGENTS.md` es la guía de integración para agentes de IA (Claude, Cursor, OpenCode, Codex…). Dice cómo agregar
factura-hn a un proyecto sin inventar reglas: qué funciones usar, en qué orden y qué no hacer. Los prompts de
una línea mandan a leerlo completo antes de escribir código.

## Dónde está

El archivo vive en la raíz del repositorio y se copia dentro de los paquetes al publicarlos
(`scripts/copiar-docs.mjs`, en el paso `prepack`):

| Paquete | Ruta tras instalarlo | Quién la usa |
|---|---|---|
| `factura-hn` | `node_modules/factura-hn/AGENTS.md` | El prompt del SDK |
| `@factura-hn/cliente` | `node_modules/@factura-hn/cliente/AGENTS.md` | El prompt de la API (sección «Con la API REST») |

Leerlo desde `node_modules` tiene una ventaja: es la copia de la versión instalada, así que nombra las funciones
que esa versión exporta. El paquete `factura-hn` trae también `docs/` con la guía del SDK, la persistencia, los
errores, la API, el autoalojamiento y la normativa.

Una prueba del repositorio compila cada bloque de código TypeScript de `AGENTS.md` contra la API actual y
comprueba que las funciones y los tipos que nombra existan.

El texto completo está en
[GitHub](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/AGENTS.md).

## Qué dice

**Dos caminos.** El SDK, si el proyecto es JS/TS y emite contra su propia base. La API, si el proyecto es de otro
lenguaje o varias cajas emiten contra un servidor de factura-hn. Si el proyecto no lo deja claro, el agente
pregunta.

**Principios no negociables.**

1. No inventar reglas fiscales: usar `validarEntrada` y `emitir`, y mostrar `ErrorValidacion.errores` tal cual.
2. Un solo camino: `emitir` y `anular` sobre un `AlmacenFiscal`. `crearFacturador` es una fachada sobre esas
   mismas funciones.
3. Un almacén probado: `AlmacenPostgres`, `AlmacenSQLite` o uno propio que pase `ejecutarContratoAlmacen`.
4. Números inmutables: anular o corregir con notas 06 y 07, nunca borrar.
5. Emitir en el servidor.
6. Cobrar `totales.total`, no la suma de precios (Art. 9 de la Ley del ISV).
7. Datos del CAI desde la base, cargados por el usuario desde su resolución del SAR.
8. Montos como texto exacto (`'89.50'`).

**Secciones con código.** Configuración una vez, modo de prueba y fachada, mapeo del carrito a
`DocumentoEntrada`, servicio de emisión, notas de crédito, momento de emisión (Art. 14), reloj del dispositivo
(Art. 43), quién opera (bitácora), interfaz recomendada, pruebas que agregar y la sección «Con la API REST».

**Referencia rápida de errores.** Una tabla con los códigos más comunes y qué hacer con cada uno. El catálogo
completo está en la [referencia de errores](/referencia/errores/).

## Páginas relacionadas

- [Prompts](/ia/prompts/): los prompts que mandan a leer este archivo.
- [Skill](/ia/skill/): el mismo procedimiento en el formato de skill de Claude.
- [Referencia del SDK](/referencia/sdk/) y [referencia de la API](/referencia/api/).
