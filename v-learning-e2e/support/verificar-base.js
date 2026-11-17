import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cfg } from "./config.js";

/**
 * globalSetup: antes de cualquier grupo comprueba que el backend escribe en la base aislada
 * (vlearning_e2e). El 11/11/2026 el backend corrió contra `vlearning` durante horas sin que nada lo
 * notara (ver ESTADO.md); esta sonda lo detiene en el acto.
 *
 * Cómo: hace UN intento de login con un correo de sonda que no existe
 * (`e2e.sonda.<marca>@<dominio>`), como lo haría cualquier persona: la app registra
 * `LOGIN_FALLIDO` anónimo con ese correo como recurso. Luego LEE (psql, solo SELECT) en qué base
 * quedó la fila. No toca ninguna cuenta, no suma fallos a nadie y no escribe en la base.
 *
 * Variables (.env): E2E_VERIFICAR_BASE (por defecto 1; 0 la omite), E2E_BASE_DATOS
 * (vlearning_e2e), PSQL (ruta de psql), DB_HOST, DB_PORT, DB_USER y DB_PASSWORD. Si DB_PASSWORD no
 * está, se lee del .env del backend (APP_REPO_DIR/backend/learning-platform/.env).
 */
export default async function verificarBase() {
  if (process.env.E2E_VERIFICAR_BASE === "0") {
    console.log("[base] E2E_VERIFICAR_BASE=0: no se verifica en qué base escribe el backend.");
    return;
  }
  const esperada = process.env.E2E_BASE_DATOS || "vlearning_e2e";
  const psql = process.env.PSQL || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
  const host = process.env.DB_HOST || "localhost";
  const puerto = process.env.DB_PORT || "5433";
  const usuario = process.env.DB_USER || "postgres";
  const clave = process.env.DB_PASSWORD || claveDelBackend();
  if (!existsSync(psql)) throw new Error(`[base] No encuentro psql en «${psql}». Define PSQL en .env o E2E_VERIFICAR_BASE=0.`);

  const consultar = (db, sql) => execFileSync(psql, ["-h", host, "-p", puerto, "-U", usuario, "-d", db, "-At", "-c", sql],
    { env: { ...process.env, PGPASSWORD: clave }, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

  const marca = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  const correo = `e2e.sonda.${marca}@${cfg.dominio}`;
  const r = await fetch(new URL("/api/auth/login", cfg.baseURL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correo, password: `Sonda-${marca}-x9!` }),
  }).catch((e) => { throw new Error(`[base] El backend no responde en ${cfg.baseURL}/api: ${e.message}`); });
  if (r.status !== 401) throw new Error(`[base] La sonda de login devolvió ${r.status} (se esperaba 401). ¿Está arriba el backend?`);

  const sql = `select count(*) from registros_auditoria where accion = 'LOGIN_FALLIDO' and recurso = '${correo}'`;
  let enEsperada = 0;
  for (let i = 0; i < 10 && !enEsperada; i++) {
    enEsperada = Number(consultar(esperada, sql));
    if (!enEsperada) await new Promise((ok) => setTimeout(ok, 300));
  }
  if (enEsperada) {
    console.log(`[base] OK: el backend escribe en «${esperada}» (sonda ${correo}).`);
    return;
  }
  const bases = consultar("postgres", "select datname from pg_database where not datistemplate and datname <> 'postgres'").split(/\r?\n/);
  const donde = bases.filter((db) => { try { return Number(consultar(db, sql)) > 0; } catch { return false; } });
  throw new Error(`[base] DETENIDO: el backend NO escribe en «${esperada}»`
    + (donde.length ? `, sino en «${donde.join(", ")}».` : " (la sonda no apareció en ninguna base).")
    + " Reinícialo con scripts/iniciar-backend-e2e.ps1 antes de correr las pruebas.");
}

function claveDelBackend() {
  const env = path.resolve(cfg.appRepoDir, "backend/learning-platform/.env");
  if (!existsSync(env)) throw new Error("[base] Falta DB_PASSWORD en .env (y no encontré el .env del backend).");
  const linea = readFileSync(env, "utf8").split(/\r?\n/).find((l) => l.startsWith("DB_PASSWORD="));
  if (!linea) throw new Error(`[base] ${env} no tiene DB_PASSWORD.`);
  return linea.slice("DB_PASSWORD=".length).replace(/^['"]|['"]$/g, "");
}
