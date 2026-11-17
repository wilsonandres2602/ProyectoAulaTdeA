import { createHash, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { cfg } from "../support/config.js";
import { borrarRegistroSecretos, leerSecretos } from "../support/secretos.js";
import { archivoHistorial, origenActual } from "../support/historial.js";

/**
 * Historial propio y auditable de las ejecuciones (capa 2).
 *
 * Al terminar cada prueba:
 *  1. Borra los secretos de la corrida (contraseñas, OTP, contraseñas temporales y tokens) de los
 *     traces y de los adjuntos de texto. Va primero en la lista de reporters para que el reporte
 *     HTML copie los archivos ya limpios.
 *  2. Copia las evidencias a evidencias/<idEjecucion>/<caso>/.
 *  3. Agrega una línea al historial de su origen (solo se agregan líneas): local →
 *     auditoria/ejecuciones-local.jsonl; CI (CI=true) → auditoria/ejecuciones-ci.jsonl. Cada línea
 *     guarda hashAnterior y hash = SHA-256(hashAnterior + JSON del registro), para detectar ediciones.
 */
const RAIZ = process.cwd();
const ORIGEN = origenActual();
const HISTORIAL = archivoHistorial(ORIGEN, RAIZ);
const HISTORIAL_REL = path.relative(RAIZ, HISTORIAL).replace(/\\/g, "/");
const GENESIS = "0".repeat(64);

export function hashRegistro(registroSinHash) {
  return createHash("sha256").update(registroSinHash.hashAnterior + JSON.stringify(registroSinHash)).digest("hex");
}

export function ultimoHash(archivo = HISTORIAL) {
  try {
    const lineas = fs.readFileSync(archivo, "utf8").split("\n").filter(Boolean);
    return lineas.length ? JSON.parse(lineas[lineas.length - 1]).hash : GENESIS;
  } catch { return GENESIS; }
}

const git = (cmd, cwd) => { try { return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };

const ESTADO = { passed: "Exitoso", failed: "Fallido", timedOut: "Fallido", interrupted: "No ejecutado" };

function escaparHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Reemplaza cada secreto (y sus formas escapadas) en un texto. */
function limpiarTexto(texto, secretos) {
  let t = texto;
  for (const s of secretos) {
    for (const v of new Set([s, escaparHtml(s), JSON.stringify(s).slice(1, -1), encodeURIComponent(s)])) {
      if (v && t.includes(v)) t = t.split(v).join("[REDACTADO]");
    }
  }
  // Tokens JWT de sesión (cabecera.contenido.firma): la app los manda en cada petición de cualquier
  // sesión abierta por la UI, también las que no pasan por registrarSecreto (setup, auditoría…).
  return t.replace(JWT, "[REDACTADO]");
}

const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function esBinario(buf) {
  const n = Math.min(buf.length, 4000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Limpia los secretos dentro del .zip del trace (eventos, red y snapshots del DOM). */
function limpiarTrace(archivo, secretos) {
  if (!secretos.length || !fs.existsSync(archivo)) return 0;
  const zip = new AdmZip(archivo);
  let cambios = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const buf = e.getData();
    if (esBinario(buf)) continue;
    const antes = buf.toString("utf8");
    const despues = limpiarTexto(antes, secretos);
    if (despues !== antes) { zip.updateFile(e.entryName, Buffer.from(despues, "utf8")); cambios++; }
  }
  if (cambios) zip.writeZip(archivo);
  return cambios;
}

export default class AuditoriaReporter {
  constructor() {
    this.idEjecucion = process.env.ID_EJECUCION || randomUUID();
    this.commitApp = cfg.appCommit || git("git rev-parse HEAD", path.resolve(RAIZ, cfg.appRepoDir)) || "desconocido";
    this.commitPruebas = git("git rev-parse HEAD", RAIZ) || "sin-commit";
    this.ejecutadoPor = cfg.ejecutadoPor || git("git config user.name", RAIZ) || "desconocido";
    this.resumen = { Exitoso: 0, Fallido: 0, Bloqueado: 0, "No ejecutado": 0 };
  }

  onBegin() {
    fs.mkdirSync(path.dirname(HISTORIAL), { recursive: true });
    if (!fs.existsSync(HISTORIAL)) fs.writeFileSync(HISTORIAL, "");
  }

  onTestEnd(test, result) {
    // Playwright ≥ 1.5x guarda las anotaciones del intento en result.annotations y además las copia a
    // test.annotations: se toma una sola fuente para no duplicarlas.
    const fuente = result.annotations?.length ? result.annotations : test.annotations;
    const anot = (t) => fuente.filter((a) => a.type === t).map((a) => a.description);
    const una = (t) => anot(t).at(-1);
    const caso = una("caso") ?? test.title.split(" ")[0];
    const proyecto = test.parent?.project()?.name ?? "";
    // 1) Limpiar secretos de los adjuntos (los traces y los textos).
    const secretos = leerSecretos(this.idEjecucion).concat([cfg.adminPassword, cfg.instructorDemoPassword, cfg.e2ePassword].filter(Boolean));
    for (const a of result.attachments) {
      if (!a.path || !fs.existsSync(a.path)) continue;
      if (a.name === "trace" || a.path.endsWith(".zip")) limpiarTrace(a.path, secretos);
      else if (/text|json/.test(a.contentType ?? "")) {
        const t = fs.readFileSync(a.path, "utf8");
        const l = limpiarTexto(t, secretos);
        if (l !== t) fs.writeFileSync(a.path, l);
      }
    }
    // La preparación de datos no es un caso: no se registra, pero su trace también se limpia
    // (el reporte HTML lo copia y lleva las contraseñas y los JWT de las cuentas que crea).
    if (proyecto === "setup" && !una("caso")) return;

    let estado = ESTADO[result.status] ?? "No ejecutado";
    if (result.status === "skipped") estado = anot("bloqueado").length ? "Bloqueado" : "No ejecutado";
    this.resumen[estado] = (this.resumen[estado] ?? 0) + 1;

    // 2) Copiar evidencias.
    const carpeta = path.join(RAIZ, "evidencias", this.idEjecucion, caso.replace(/[^A-Za-z0-9_.-]/g, "_"));
    const evid = { video: [], trace: [], capturas: [] };
    for (const a of result.attachments) {
      const tipo = a.contentType?.startsWith("video") ? "video" : a.name === "trace" ? "trace" : a.contentType?.startsWith("image") ? "capturas" : null;
      if (!tipo) continue;
      fs.mkdirSync(carpeta, { recursive: true });
      const nombre = a.path ? `${evid[tipo].length}-${path.basename(a.path)}` : `${evid[tipo].length}-${a.name.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
      const destino = path.join(carpeta, nombre);
      if (a.path && fs.existsSync(a.path)) fs.copyFileSync(a.path, destino);
      else if (a.body) fs.writeFileSync(destino, a.body);
      else continue;
      evid[tipo].push(path.relative(RAIZ, destino).split(path.sep).join("/"));
    }

    // 3) Registro encadenado.
    const error = result.error ? limpiarTexto((result.error.message ?? String(result.error)).replace(/\u001b\[[0-9;]*m/g, "").split("\n").slice(0, 6).join(" ").slice(0, 600), secretos) : undefined;
    const registro = {
      idEjecucion: this.idEjecucion,
      ciclo: cfg.ciclo,
      caso,
      hu: una("hu"),
      rf: una("rf"),
      prioridad: una("prioridad"),
      tecnica: una("tecnica"),
      clase: una("clase"),
      clasificacion: una("clasificacion"),
      referenciaPlan: una("referenciaPlan"),
      titulo: test.title,
      estado,
      motivo: result.status === "skipped" ? anot("skip").concat(anot("bloqueado")).join("; ") || undefined : undefined,
      defectoEsperado: una("defecto"),
      ajuste: una("ajuste"),
      entorno: una("entorno"),
      duracionMs: result.duration,
      inicio: result.startTime.toISOString(),
      fin: new Date(result.startTime.getTime() + result.duration).toISOString(),
      rendimiento: anot("rendimiento").map((d) => JSON.parse(d)),
      auditoriaApp: anot("auditoriaApp"),
      usuarioProbado: anot("usuarioProbado").join(", ") || undefined,
      baseUrl: cfg.baseURL,
      navegador: una("navegador") ?? proyecto,
      proyecto,
      commitApp: this.commitApp,
      commitPruebas: this.commitPruebas,
      ejecutadoPor: this.ejecutadoPor,
      error,
      evidencias: evid,
      eventosGuard: anot("guard").map((d) => JSON.parse(d)),
      ambienteAlterado: una("ambienteAlterado"),
    };
    const limpio = JSON.parse(JSON.stringify(registro)); // quita undefined
    limpio.hashAnterior = ultimoHash();
    limpio.hash = hashRegistro(limpio);
    fs.appendFileSync(HISTORIAL, `${JSON.stringify(limpio)}\n`);
  }

  onEnd() {
    borrarRegistroSecretos(this.idEjecucion);
    const r = this.resumen;
    console.log(`\n[auditoría] Ejecución ${this.idEjecucion} · ciclo ${cfg.ciclo}: `
      + `${r.Exitoso} exitosos, ${r.Fallido} fallidos, ${r.Bloqueado} bloqueados, ${r["No ejecutado"]} no ejecutados. `
      + `Historial (${ORIGEN}): ${HISTORIAL_REL} · Evidencias: evidencias/${this.idEjecucion}/`);
    // Anclaje: el último hash de la cadena queda impreso y en resultados/ultimo-hash.txt; el CI lo pone
    // en el mensaje del commit del historial. Así, reescribir el JSONL completo (recalculando todos los
    // hashes) no pasa inadvertido: el hash anclado en git ya no aparecería en el archivo.
    const hash = ultimoHash();
    let registros = 0;
    try { registros = fs.readFileSync(HISTORIAL, "utf8").split("\n").filter(Boolean).length; } catch { /* sin historial */ }
    console.log(`[auditoría] Último hash de la cadena ${ORIGEN} (${HISTORIAL_REL}): ${hash} (${registros} registros)`);
    try {
      fs.mkdirSync(path.join(RAIZ, "resultados"), { recursive: true });
      fs.writeFileSync(path.join(RAIZ, "resultados", "ultimo-hash.txt"), `${hash} ${registros} ${ORIGEN}\n`);
    } catch { /* solo informativo */ }
  }

  printsToStdio() { return false; }
}
