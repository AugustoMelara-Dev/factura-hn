#!/usr/bin/env node
/**
 * Consola del operador: `factura-hn-api ayuda` lista los comandos (ver ./consola).
 */
import { ejecutarConsola } from './consola';

ejecutarConsola(process.argv.slice(2)).then(
  // exitCode y no exit(): una salida larga por tubería (`openapi | …`) termina de escribirse.
  (codigo) => {
    process.exitCode = codigo;
  },
  (e) => {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
