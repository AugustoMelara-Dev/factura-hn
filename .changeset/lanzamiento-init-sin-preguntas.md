---
"factura-hn": minor
---

`npx factura-hn init` deja un ejemplo funcionando sin preguntas: crea `emitir.mjs` y `emisor.json` en modo de prueba
y dice el siguiente comando exacto (`node emitir.mjs`, o primero `npm install factura-hn`, `pnpm add`, `yarn add` o
`bun add` si el paquete aún no está en la carpeta). Si los archivos ya existen e iguales, termina bien; si cambiaron,
no toca nada y lo dice (`--forzar` para reemplazarlos). Con Node menor que 20 avisa antes de escribir.

Los mensajes de error dicen en palabras simples qué pasó y qué hacer: `TIPO_NO_SOPORTADO`,
`CORRELATIVO_FUERA_DE_RANGO`, los de la dirección y el teléfono del emisor, `SIN_DOCUMENTOS_ADELANTADOS`, los números
mal escritos y los formatos de exportación. README, AGENTS.md, llms.txt y la skill, más cortos y directos.
