import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";
import { cfg } from "./config.js";
import { archivoHistorial, origenActual } from "./historial.js";

/**
 * Guard de cuentas. En el backend, los contadores se calculan sobre la tabla de auditoría
 * (AuthService, SeguridadService) y un login exitoso no los reinicia. Por eso el guard cuenta
 * los eventos de cada cuenta en la ventana, sin importar los éxitos:
 *   - LOGIN_FALLIDO: máx. 3 en 15 min (el backend bloquea con 5).
 *   - DENEGACION (401/403 autenticado): máx. 8 en 10 min (el backend bloquea con 10).
 *   - MALICIOSA (SQLi/XSS): máx. 2 en 10 min (el backend bloquea con 3).
 * El administrador no puede acumular ninguno. Las cuentas desechables de los casos que buscan
 * el bloqueo a propósito se marcan como exentas.
 *
 * Fuentes: el historial versionado DEL MISMO ORIGEN (auditoria/ejecuciones-local.jsonl o, en el CI,
 * ejecuciones-ci.jsonl; campo eventosGuard) y el registro de la corrida actual
 * (resultados/guard-<idEjecucion>.json). Solo el mismo origen: cada uno tiene su propia base de datos
 * (la local y la del servicio PostgreSQL del CI), así que los eventos del otro no cuentan para sus
 * contadores.
 */
const LIMITES = {
  LOGIN_FALLIDO: { max: 3, ventanaMin: 15 },
  DENEGACION: { max: 8, ventanaMin: 10 },
  MALICIOSA: { max: 2, ventanaMin: 10 },
};

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HISTORIAL = archivoHistorial(origenActual(), RAIZ);
const actual = () => path.join(RAIZ, "resultados", `guard-${process.env.ID_EJECUCION}.json`);

function leerActual() {
  try { return JSON.parse(fs.readFileSync(actual(), "utf8")); } catch { return []; }
}

function leerHistorial() {
  try {
    return fs.readFileSync(HISTORIAL, "utf8").split("\n").filter(Boolean)
      .flatMap((l) => { try { return JSON.parse(l).eventosGuard ?? []; } catch { return []; } });
  } catch { return []; }
}

export function eventosRecientes(cuenta, tipo) {
  const desde = Date.now() - LIMITES[tipo].ventanaMin * 60_000;
  const todos = [...leerHistorial(), ...leerActual()];
  const vistos = new Set();
  return todos.filter((e) => {
    const k = `${e.cuenta}|${e.tipo}|${e.fecha}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return e.cuenta === cuenta.toLowerCase() && e.tipo === tipo && Date.parse(e.fecha) >= desde;
  });
}

/**
 * Antes de provocar `n` eventos sobre `cuenta`, salta el caso si se superaría el límite.
 * Las cuentas exentas solo se registran, sin saltar el caso.
 */
export function protegerCuenta(cuenta, tipo, n = 1, { exenta = false } = {}) {
  const lim = LIMITES[tipo];
  const esAdmin = cuenta.toLowerCase() === cfg.adminCorreo.toLowerCase();
  const previos = eventosRecientes(cuenta, tipo).length;
  const maximo = esAdmin ? 0 : lim.max;
  if (!exenta && previos + n > maximo) {
    test.info().annotations.push({ type: "bloqueado", description: "guard de cuentas" });
    test.skip(true,
      `Guard: ${cuenta} ya tiene ${previos} evento(s) ${tipo} en los últimos ${lim.ventanaMin} min; `
      + `con ${n} más pasaría el máximo seguro (${maximo}). Espera o usa otra cuenta.`);
  }
}

/** Registra eventos provocados (en la corrida actual y como anotación para el historial). */
export function registrarEvento(cuenta, tipo, n = 1) {
  const lista = leerActual();
  for (let i = 0; i < n; i++) {
    const e = { cuenta: cuenta.toLowerCase(), tipo, fecha: new Date().toISOString() };
    lista.push(e);
    test.info().annotations.push({ type: "guard", description: JSON.stringify(e) });
  }
  fs.mkdirSync(path.dirname(actual()), { recursive: true });
  fs.writeFileSync(actual(), JSON.stringify(lista));
}
