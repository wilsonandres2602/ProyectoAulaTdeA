// Datos de cierre compartidos por `npm run auditoria:excel` y `npm run informe`.
// Solo LEE: docs/MAPEO_CASOS.md (catálogo), los historiales por origen auditoria/ejecuciones-local.jsonl
// y auditoria/ejecuciones-ci.jsonl (nunca se modifican; se combinan por fecha de inicio) y
// scripts/lib/defectos.cjs (clasificación de D-xx decidida por el usuario, ver ESTADO.md).
const fs = require("node:fs");
const path = require("node:path");
const { DEFECTOS, DIFERENCIAS, HALLAZGOS, HALLAZGOS_DETALLE, PENDIENTES } = require("./defectos.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const HU_VIGENTES = Array.from({ length: 31 }, (_, i) => `HU-${String(i + 1).padStart(3, "0")}`).filter((h) => h !== "HU-008");
// Casos con ID de RF: a qué HU se cargan (la misma que usa el spec en su anotación `hu`).
const HU_DE_RF = { "RF-032": "HU-019", "RF-045": "HU-019", "RF-048": "HU-017", "RF-049": "HU-020" };

/** Celdas de una fila de tabla Markdown (respeta `|` dentro de código). */
function celdas(linea) {
  const out = [];
  let actual = "";
  let codigo = false;
  for (const ch of linea.trim().replace(/^\|/, "").replace(/\|$/, "")) {
    if (ch === "`") codigo = !codigo;
    if (ch === "|" && !codigo) { out.push(actual.trim()); actual = ""; } else actual += ch;
  }
  out.push(actual.trim());
  return out;
}

// Secretos: los valores de .env (y del entorno) cuyas claves parecen contraseñas, secretos o tokens.
// Se reemplazan por [REDACTADO] en todo texto que va al Excel o al informe. Ojo: la contraseña demo
// del administrador también aparece como ejemplo en el plan (§7.12.1) y en el catálogo (CP-HU003-03).
const SECRETOS = (() => {
  const vals = new Set();
  const agregar = (k, v) => { if (/PASSWORD|SECRET|TOKEN|CLAVE/i.test(k) && v && String(v).length >= 6) vals.add(String(v)); };
  try {
    for (const l of fs.readFileSync(path.join(RAIZ, ".env"), "utf8").split(/\r?\n/)) {
      const mm = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (mm) agregar(mm[1], mm[2].trim().replace(/^(['"])(.*)\1$/, "$2"));
    }
  } catch { /* sin .env (p. ej. en CI): solo las variables del entorno */ }
  for (const [k, v] of Object.entries(process.env)) agregar(k, v);
  return [...vals].sort((x, y) => y.length - x.length);
})();
/** Reemplaza cualquier secreto conocido por [REDACTADO]. */
const sinSecretos = (t) => SECRETOS.reduce((acc, s) => acc.split(s).join("[REDACTADO]"), String(t ?? ""));

/** Quita el marcado Markdown para mostrar el texto en Excel o Word (y redacta secretos). */
const plano = (t) => sinSecretos(String(t ?? "")).replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/<br\s*\/?>/g, "\n").replace(/\s+\n/g, "\n").trim();

/** Normaliza la clase del catálogo («E2E-UI (antes Bloqueado…)» → «E2E-UI»). */
function claseBase(c) {
  const t = plano(c);
  for (const k of ["E2E-UI", "E2E-API", "Con ajuste", "Lento", "Bloqueado", "Manual", "Fuera de repo", "No automatizable"]) if (t.startsWith(k)) return k;
  return t;
}

/** Catálogo: 230 entradas (224 CP-… y 6 transversales), con la HU, el RF, el sprint y el spec de su sección. */
function leerCatalogo() {
  const md = fs.readFileSync(path.join(RAIZ, "docs", "MAPEO_CASOS.md"), "utf8").split(/\r?\n/);
  const inicio = md.findIndex((l) => l.startsWith("## 2."));
  const fin = md.findIndex((l, i) => i > inicio && l.startsWith("## 3."));
  const casos = [];
  let seccion = null;
  for (const l of md.slice(inicio, fin)) {
    const h = l.match(/^### (.+)$/);
    if (h) {
      const partes = h[1].split(" · ");
      seccion = {
        titulo: partes[0],
        nombre: partes[1] ?? partes[0],
        rf: (h[1].match(/\(([^)]*RF[^)]*)\)/) ?? [])[1] ?? "",
        sprint: (h[1].match(/Sprints? ([\d–-]+)/) ?? [])[1] ?? "",
        spec: (h[1].match(/spec `([^`]+)`/) ?? [])[1] ?? "",
      };
      continue;
    }
    if (!l.startsWith("| ") || l.startsWith("| ID") || /^\|\s*-/.test(l)) continue;
    const c = celdas(l);
    if (!/^(CP-|AUT-|COB-|NA-)/.test(c[0])) continue;
    const id = c[0];
    const transversal = !id.startsWith("CP-");
    const rfDeId = id.startsWith("CP-RF") ? `RF-${id.slice(5, 8)}` : null;
    const huId = transversal ? "Transversal" : id.startsWith("CP-HU") ? `HU-${id.slice(5, 8)}` : HU_DE_RF[rfDeId] ?? "Transversal";
    casos.push({
      id,
      hu: huId,
      rf: rfDeId ?? seccion?.rf ?? "",
      sprint: seccion?.sprint ?? "",
      escenario: seccion?.nombre ?? "",
      seccion: seccion?.titulo ?? "",
      spec: seccion?.spec ?? "",
      nombre: plano(c[1]),
      clase: claseBase(c[2]),
      prioridad: c[3],
      usuario: transversal ? "" : plano(c[4]),
      precondicion: transversal ? "" : plano(c[5]),
      pasos: transversal ? "" : plano(c[6]),
      esperado: transversal ? plano(c[4]) : plano(c[7]),
      auditoria: transversal ? "" : plano(c[8]),
      umbral: transversal ? "" : plano(c[9]),
    });
  }
  return casos;
}

// Un historial por origen (ver support/historial.js): cada uno con su cadena y un solo escritor.
const ORIGENES = ["local", "ci"];
const archivoHistorial = (o) => path.join(RAIZ, "auditoria", `ejecuciones-${o}.jsonl`);

/**
 * Historial (solo lectura): combina los dos orígenes por fecha de inicio del caso, de modo que la
 * «última corrida» de cada caso es la más reciente sin importar si fue local o del CI. A igual fecha
 * se conserva el orden de cada archivo. Cada registro lleva `origen`.
 */
function leerHistorial() {
  const porOrigen = {};
  const lineas = ORIGENES.flatMap((o) => {
    const f = archivoHistorial(o);
    const ls = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
    porOrigen[o] = ls.length;
    return ls.map((r, i) => ({ ...r, origen: o, _orden: i }));
  });
  const registros = lineas.filter((r) => r.caso && r.estado)
    .sort((a, b) => (a.inicio ?? "").localeCompare(b.inicio ?? "") || ORIGENES.indexOf(a.origen) - ORIGENES.indexOf(b.origen) || a._orden - b._orden);
  const noAisladas = new Set(lineas.filter((r) => r.tipo === "anotacion").map((r) => r.idEjecucion));
  return { registros, noAisladas, total: lineas.length, porOrigen };
}

/**
 * Estado real de cada caso: la última corrida en la que aparece (todas sus filas si es
 * parametrizado). Fallido si alguna fila falló; Bloqueado si todas quedaron bloqueadas; «Con
 * ajuste» si pasó con clase «Con ajuste»; si no, Exitoso. Sin corrida: la clase del catálogo
 * (Bloqueado, Manual, Fuera de repo, No automatizable) o «No ejecutado».
 */
function resultados(catalogo, historial) {
  const porCaso = new Map();
  historial.registros.forEach((r, i) => { const l = porCaso.get(r.caso) ?? []; l.push({ ...r, _i: i }); porCaso.set(r.caso, l); });
  return catalogo.map((c) => {
    const regs = porCaso.get(c.id) ?? [];
    if (!regs.length) {
      const estado = ["Bloqueado", "Manual", "Fuera de repo", "No automatizable"].includes(c.clase) ? c.clase : "No ejecutado";
      return { ...c, estado, ejecutado: false, corridas: 0, ultima: null, filas: [], estadoCatalogo: true };
    }
    const ultimo = regs[regs.length - 1];
    const filas = regs.filter((r) => r.idEjecucion === ultimo.idEjecucion);
    let estado;
    if (filas.some((r) => r.estado === "Fallido")) estado = "Fallido";
    else if (filas.every((r) => r.estado === "Bloqueado")) estado = "Bloqueado";
    else if (filas.every((r) => ["Exitoso", "Bloqueado"].includes(r.estado))) estado = (ultimo.clase === "Con ajuste" || c.clase === "Con ajuste") ? "Con ajuste" : "Exitoso";
    else estado = "No ejecutado";
    const evid = filas.flatMap((r) => r.evidencias?.capturas ?? []);
    return {
      ...c,
      estado,
      ejecutado: ["Exitoso", "Con ajuste", "Fallido"].includes(estado),
      corridas: new Set(regs.map((r) => r.idEjecucion)).size,
      ultima: ultimo,
      filas,
      clasificacion: ultimo.clasificacion ?? "",
      tecnica: ultimo.tecnica ?? "",
      error: filas.map((r) => r.error).find(Boolean) ?? "",
      evidencia: evid[0] ?? `evidencias/${ultimo.idEjecucion}/${c.id}/`,
      noAislada: historial.noAisladas.has(ultimo.idEjecucion),
      rendimiento: filas.flatMap((r) => (Array.isArray(r.rendimiento) ? r.rendimiento : [])),
    };
  });
}

/** Métricas de la §7.16 (y conteos de apoyo). */
function metricas(res) {
  const n = (f) => res.filter(f).length;
  const exitosos = n((r) => r.estado === "Exitoso");
  const ajuste = n((r) => r.estado === "Con ajuste");
  const fallidos = n((r) => r.estado === "Fallido");
  const ejecutados = exitosos + ajuste + fallidos;
  const p1 = res.filter((r) => r.prioridad === "P1");
  const p1Ok = p1.filter((r) => r.ejecutado || r.estado === "Bloqueado").length;
  const p1Fuera = p1.filter((r) => ["Fuera de repo", "No automatizable", "Manual"].includes(r.estado)).length;
  const huCubiertas = HU_VIGENTES.filter((h) => res.some((r) => r.hu === h && r.ejecutado));
  const porImpacto = { "Alto-3": 0, "Medio-2": 0, "Bajo-1": 0 };
  for (const d of DEFECTOS) porImpacto[d.impacto]++;
  return {
    total: res.length, exitosos, ajuste, fallidos, ejecutados,
    bloqueados: n((r) => r.estado === "Bloqueado"), manuales: n((r) => r.estado === "Manual"),
    fueraRepo: n((r) => r.estado === "Fuera de repo"), noAutomatizables: n((r) => r.estado === "No automatizable"),
    noEjecutados: n((r) => r.estado === "No ejecutado"),
    aprobacion: ejecutados ? ((exitosos + ajuste) / ejecutados) * 100 : 0,
    tasaFallas: ejecutados ? (fallidos / ejecutados) * 100 : 0,
    huCubiertas: huCubiertas.length, huVigentes: HU_VIGENTES.length,
    huSinEjecucion: HU_VIGENTES.filter((h) => !huCubiertas.includes(h)),
    p1Total: p1.length, p1EjecutadosOBloqueados: p1Ok, p1FueraDeRepo: p1Fuera,
    defectos: DEFECTOS.length, porImpacto,
    corridas: new Set(res.flatMap((r) => r.filas.map((f) => f.idEjecucion))).size,
  };
}

/** Rendimiento: cada medición registrada (última corrida de cada caso) con su umbral §7.7. */
function rendimiento(res) {
  const filas = [];
  for (const r of res) for (const m of r.rendimiento ?? []) for (const u of m.umbrales ?? []) filas.push({ caso: r.id, hu: r.hu, metrica: m.metrica, ms: m.valorMs, fuente: u.fuente, umbralMs: u.umbralMs, cumple: u.cumple });
  return filas;
}

/** Datos del ambiente para el resumen (commit de la app y de las pruebas, fechas, navegador). */
function ambiente(historial) {
  const regs = historial.registros;
  const fechas = regs.map((r) => r.inicio).filter(Boolean).sort();
  const ult = regs[regs.length - 1] ?? {};
  return {
    desde: fechas[0]?.slice(0, 10), hasta: fechas[fechas.length - 1]?.slice(0, 10),
    commitApp: ult.commitApp, commitPruebas: ult.commitPruebas, navegador: ult.navegador, baseUrl: ult.baseUrl,
    ejecutadoPor: ult.ejecutadoPor, registros: historial.total, registrosPorOrigen: historial.porOrigen,
  };
}

function cargar() {
  const catalogo = leerCatalogo();
  const historial = leerHistorial();
  const res = resultados(catalogo, historial);
  return { catalogo, historial, res, metricas: metricas(res), rendimiento: rendimiento(res), ambiente: ambiente(historial), DEFECTOS, DIFERENCIAS, HALLAZGOS, HALLAZGOS_DETALLE, PENDIENTES, HU_VIGENTES, RAIZ };
}

module.exports = { cargar, plano, celdas, sinSecretos };
