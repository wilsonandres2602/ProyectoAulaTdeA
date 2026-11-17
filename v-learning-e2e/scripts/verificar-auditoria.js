#!/usr/bin/env node
/**
 * npm run auditoria:verificar: comprueba la cadena de hashes de CADA historial por origen
 * (auditoria/ejecuciones-local.jsonl y auditoria/ejecuciones-ci.jsonl; ver support/historial.js):
 *  - cada línea es JSON válido;
 *  - hashAnterior coincide con el hash de la línea anterior (la primera, con 64 ceros);
 *  - hash = SHA-256(hashAnterior + JSON del registro sin el campo hash).
 * Un archivo que no existe todavía no es error (p. ej. el del CI antes de la primera corrida).
 * Sale con código 1 si alguna cadena está rota y dice cuál y en qué línea.
 * Con un argumento verifica solo ese archivo: node scripts/verificar-auditoria.js <ruta.jsonl>
 */
import fs from "node:fs";
import path from "node:path";
import { hashRegistro } from "../reporters/auditoria-reporter.js";
import { ORIGENES, archivoHistorial } from "../support/historial.js";

const GENESIS = "0".repeat(64);

function verificar(archivo, nombre) {
  const rel = path.relative(process.cwd(), archivo);
  if (!fs.existsSync(archivo)) {
    console.log(`[${nombre}] Sin historial todavía (${rel} no existe).`);
    return true;
  }
  const lineas = fs.readFileSync(archivo, "utf8").split("\n");
  let anterior = GENESIS;
  let n = 0;
  const errores = [];
  lineas.forEach((l, i) => {
    if (!l.trim()) return;
    n++;
    let r;
    try { r = JSON.parse(l); } catch { errores.push(`Línea ${i + 1}: no es JSON válido.`); return; }
    const { hash, ...resto } = r;
    if (resto.hashAnterior !== anterior) errores.push(`Línea ${i + 1} (${r.caso}): hashAnterior no coincide con el hash de la línea anterior.`);
    const calculado = hashRegistro(resto);
    if (calculado !== hash) errores.push(`Línea ${i + 1} (${r.caso}): el hash no coincide; el registro fue modificado.`);
    anterior = hash;
  });
  if (errores.length) {
    console.error(`[${nombre}] Cadena ROTA en ${rel} (${n} registros):\n- ${errores.join("\n- ")}`);
    return false;
  }
  console.log(`[${nombre}] Cadena íntegra: ${n} registro(s) en ${rel}. Último hash: ${anterior}`);
  return true;
}

const archivos = process.argv[2]
  ? [[path.resolve(process.argv[2]), path.basename(process.argv[2])]]
  : ORIGENES.map((o) => [archivoHistorial(o), o]);
const rotas = archivos.filter(([a, n]) => !verificar(a, n)).map(([, n]) => n);
if (rotas.length) {
  console.error(`Cadena rota en: ${rotas.join(", ")}.`);
  process.exit(1);
}
