#!/usr/bin/env node
/**
 * Agrega al historial una línea de anotación por cada corrida dada, sin tocar las líneas anteriores:
 * cada anotación entra a la cadena de hashes igual que un caso. Va al historial del origen donde está
 * la corrida (auditoria/ejecuciones-local.jsonl o auditoria/ejecuciones-ci.jsonl).
 *
 * Uso:
 *   node scripts/anotar-ambiente.js --ambiente "base vlearning (no aislada)" --detalle "…" <idEjecucion> [<idEjecucion> …]
 *
 * Los id pueden ser completos o el prefijo de 8 caracteres. Cada línea queda así:
 *   { tipo: "anotacion", idEjecucion, ambiente, detalle, casos, inicioCorrida, fecha, ejecutadoPor, hashAnterior, hash }
 * Las líneas de anotación no tienen el campo `caso`, así que no cuentan como ejecuciones.
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { hashRegistro, ultimoHash } from "../reporters/auditoria-reporter.js";
import { ORIGENES, archivoHistorial } from "../support/historial.js";

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const ambiente = opcion("--ambiente");
const detalle = opcion("--detalle") ?? null;
if (!ambiente || !args.length) {
  console.error("Uso: node scripts/anotar-ambiente.js --ambiente \"…\" [--detalle \"…\"] <idEjecucion> …");
  process.exit(2);
}

// Igual que el reporter: EJECUTADO_POR o el user.name de git.
let quien = process.env.EJECUTADO_POR || "";
if (!quien) { try { quien = execSync("git config user.name").toString().trim(); } catch { quien = "desconocido"; } }

const leer = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const ejecuciones = ORIGENES.flatMap((o) => leer(archivoHistorial(o)).filter((r) => r.caso).map((r) => ({ ...r, _archivo: archivoHistorial(o) })));
let n = 0;
for (const pedido of args) {
  const deLaCorrida = ejecuciones.filter((r) => r.idEjecucion === pedido || r.idEjecucion.startsWith(pedido));
  const ids = [...new Set(deLaCorrida.map((r) => r.idEjecucion))];
  const HISTORIAL = deLaCorrida[0]?._archivo;
  if (ids.length !== 1) {
    console.error(`«${pedido}»: ${ids.length ? "coincide con varias corridas" : "no está en el historial"}. No se anota.`);
    process.exitCode = 1;
    continue;
  }
  const registro = {
    tipo: "anotacion",
    idEjecucion: ids[0],
    ambiente,
    detalle,
    casos: [...new Set(deLaCorrida.map((r) => r.caso))],
    inicioCorrida: deLaCorrida.map((r) => r.inicio).sort()[0],
    fecha: new Date().toISOString(),
    ejecutadoPor: quien,
  };
  registro.hashAnterior = ultimoHash(HISTORIAL);
  registro.hash = hashRegistro(registro);
  fs.appendFileSync(HISTORIAL, `${JSON.stringify(registro)}\n`);
  n++;
}
console.log(`Anotaciones agregadas: ${n} de ${args.length}.`);
