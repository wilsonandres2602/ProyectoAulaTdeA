// npm run auditoria:excel → resultados/Casos_de_prueba_ejecutados.xlsx
// Parte de docs/Ejemplo_Casos_de_prueba.xlsx (conserva su formato) y lo llena con:
//   · «Escenarios»: los 230 casos del catálogo con su estado real (última corrida del historial).
//   · «Incidentes»: un INC_### por cada D-xx clasificado como defecto.
//   · «Métricas» (hoja nueva): las de la §7.16 del plan. «Calidad» se deja como está.
// El historial (auditoria/ejecuciones.jsonl) solo se lee.
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { cargar, sinSecretos } = require("./lib/cierre.cjs");

const d = cargar();
const PLANTILLA = path.join(d.RAIZ, "docs", "Ejemplo_Casos_de_prueba.xlsx");
const SALIDA = path.join(d.RAIZ, "resultados", "Casos_de_prueba_ejecutados.xlsx");
const ESTADOS = ["Exitoso", "Fallido", "Con ajuste", "Bloqueado", "Manual", "Fuera de repo", "No automatizable", "No ejecutado"];

/** Copia el estilo (fuente, bordes, relleno, alineación, formato) de las celdas de una fila modelo. */
function estiloDe(ws, fila, columnas) {
  const r = ws.getRow(fila);
  const out = {};
  for (let c = 1; c <= columnas; c++) out[c] = JSON.parse(JSON.stringify(r.getCell(c).style ?? {}));
  return out;
}

/** Alto aproximado para que el texto con ajuste de línea se vea completo. */
function alto(valores, anchos) {
  let lineas = 1;
  valores.forEach((v, i) => {
    const w = Math.max(8, anchos[i] ?? 12);
    const n = String(v ?? "").split("\n").reduce((acc, l) => acc + Math.max(1, Math.ceil(l.length / (w * 1.1))), 0);
    lineas = Math.max(lineas, n);
  });
  return Math.min(409, Math.max(30, lineas * 13 + 6));
}

function limpiarDesde(ws, desde, hasta, columnas) {
  for (let f = desde; f <= hasta; f++) {
    const r = ws.getRow(f);
    for (let c = 1; c <= columnas; c++) { r.getCell(c).value = null; r.getCell(c).dataValidation = undefined; }
  }
}

function escribirFila(ws, fila, valores, estilo, validaciones = {}) {
  const r = ws.getRow(fila);
  const anchos = valores.map((_, i) => ws.getColumn(i + 1).width);
  valores.forEach((v, i) => {
    const celda = r.getCell(i + 1);
    celda.value = typeof v === "string" ? sinSecretos(v) : v ?? null;
    celda.style = JSON.parse(JSON.stringify(estilo[i + 1] ?? {}));
    celda.alignment = { ...(celda.alignment ?? {}), wrapText: true, vertical: "top" };
    if (validaciones[i + 1]) celda.dataValidation = validaciones[i + 1];
  });
  r.height = alto(valores, anchos);
  r.commit();
}

const lista = (valores) => ({ type: "list", allowBlank: true, formulae: [`"${valores.join(",")}"`] });

function resultadoObtenido(r) {
  const base = {
    Exitoso: "Coincide con el resultado esperado.",
    "Con ajuste": "Coincide con el resultado esperado con el ajuste documentado (diferencia plan ↔ app).",
    Bloqueado: "No se ejecutó: depende de un recurso o dato que no está disponible (ver catálogo).",
    Manual: "Caso manual: no se automatiza en este repositorio.",
    "Fuera de repo": "Se cubre en las pruebas unitarias o de integración de la app (fuera de este repositorio).",
    "No automatizable": "No automatizable en este repositorio (ver catálogo).",
    "No ejecutado": "Aún no se corrió.",
  }[r.estado];
  if (r.estado !== "Fallido") return base + (r.noAislada ? " Corrida anotada como ambiente no aislado (base vlearning)." : "");
  const def = d.DEFECTOS.find((x) => x.casos.includes(r.id));
  const pend = !def && d.PENDIENTES.length ? ` (${d.PENDIENTES.join(", ")}, pendiente de clasificar)` : "";
  const err = String(r.error ?? "").split("\n")[0].replace(/\s+/g, " ").slice(0, 300);
  return `No coincide${def ? ` · ${def.id}: ${def.titulo}` : pend}.${err ? ` ${err}` : ""}`;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(PLANTILLA);

  // ------------------------------------------------------------ Escenarios
  const esc = wb.getWorksheet("Escenarios");
  const estiloEsc = estiloDe(esc, 3, 18);
  limpiarDesde(esc, 3, Math.max(esc.rowCount, 160), 18);
  // Un escenario por HU (ESC_001 = HU-001…); los transversales van en ESC_TRV.
  const escId = (hu) => (hu.startsWith("HU-") ? `ESC_${hu.slice(3)}` : "ESC_TRV");
  d.res.forEach((r, i) => {
    const automatizada = !["Manual", "Fuera de repo", "No automatizable"].includes(r.estado) && !(r.estado === "Bloqueado" && !r.ultima);
    escribirFila(esc, 3 + i, [
      `${r.sprint ? `Sprint ${r.sprint} · ` : ""}${r.rf}`,
      r.hu,
      escId(r.hu),
      (r.escenario || r.seccion).replace(/\s*\([^)]*RF[^)]*\)\s*$/, ""),
      r.nombre,
      r.id,
      r.precondicion || (r.usuario ? `Usuario: ${r.usuario}` : ""),
      r.pasos,
      [r.esperado, r.auditoria && r.auditoria !== "—" ? `Auditoría: ${r.auditoria}` : "", r.umbral && r.umbral !== "—" ? `Umbral: ${r.umbral}` : ""].filter(Boolean).join("\n"),
      resultadoObtenido(r),
      r.clasificacion ? r.clasificacion.replace("Crítica", "Critica") : "",
      r.estado,
      "",
      "",
      r.ultima ? r.evidencia : "",
      r.ultima?.clase === "E2E-API" || r.clase === "E2E-API" || r.hu === "Transversal" ? "Back" : "Front",
      automatizada ? "Automatizado" : "Manual",
      automatizada ? "Si" : "No",
    ], estiloEsc, {
      11: lista(["Ruta Critica", "Ruta Alterna"]), 12: lista(ESTADOS), 16: lista(["Back", "Front", "Mobile"]),
      17: lista(["Manual", "Automatizado"]), 18: lista(["Si", "No"]),
    });
  });

  // ------------------------------------------------------------ Incidentes
  const inc = wb.getWorksheet("Incidentes");
  const estiloInc = estiloDe(inc, 3, 15);
  limpiarDesde(inc, 3, Math.max(inc.rowCount, 30), 15);
  d.DEFECTOS.forEach((def, i) => {
    const casos = d.res.filter((r) => def.casos.includes(r.id));
    const c0 = casos[0] ?? {};
    const fecha = c0.ultima?.inicio ? new Date(c0.ultima.inicio) : null;
    escribirFila(inc, 3 + i, [
      `INC_${String(i + 1).padStart(3, "0")}`,
      `${def.id} · ${def.titulo}`,
      [c0.precondicion ? `Precondición: ${c0.precondicion}` : "", c0.pasos ? `Pasos: ${c0.pasos}` : "", `Esperado: ${c0.esperado ?? ""}`, `Obtenido / causa: ${def.causa}`, `Recomendación: ${def.recomendacion}`].filter(Boolean).join("\n"),
      def.casos.join(", "),
      def.tipo,
      fecha,
      c0.sprint ?? "",
      `${c0.hu ?? ""} · ${c0.rf ?? ""}`,
      def.impacto,
      "Proyecto",
      "Pruebas",
      "Automatizada",
      def.asignado,
      "Asignada",
      c0.ultima ? c0.evidencia : "",
    ], estiloInc, { 9: lista(["Alto-3", "Medio-2", "Bajo-1"]), 10: lista(["Proyecto", "Cliente"]), 11: lista(["Desarrollo", "Pruebas", "Pre-Productivo", "Producción"]), 12: lista(["Manual", "Automatizada"]), 14: lista(["Asignada", "Proceso", "Solucionado", "Devuelto", "Cerrado", "Anulado"]) });
    if (fecha) inc.getRow(3 + i).getCell(6).numFmt = "dd/mm/yyyy";
  });

  // ------------------------------------------------------------ Métricas (§7.16)
  const m = d.metricas;
  const prev = wb.getWorksheet("Métricas");
  if (prev) wb.removeWorksheet(prev.id);
  const met = wb.addWorksheet("Métricas", { views: [{ state: "frozen", ySplit: 2 }] });
  met.columns = [{ width: 34 }, { width: 52 }, { width: 18 }, { width: 22 }, { width: 14 }];
  const titulo = met.getRow(1);
  titulo.getCell(1).value = "MÉTRICAS DE CIERRE (§7.16 del plan de pruebas)";
  titulo.getCell(1).font = { bold: true, size: 14 };
  met.mergeCells("A1:E1");
  const enc = met.getRow(2);
  ["Métrica", "Fórmula", "Meta", "Resultado", "¿Cumple?"].forEach((t, i) => {
    const c = enc.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  const pct = (x) => `${x.toFixed(1).replace(".", ",")} %`;
  const filas = [
    ["Porcentaje aprobado por ciclo (ciclo 1)", "(aprobados ÷ ejecutados) × 100; aprobados = exitosos + con ajuste", "≥ 90 %", `${pct(m.aprobacion)} (${m.exitosos + m.ajuste}/${m.ejecutados})`, m.aprobacion >= 90 ? "Sí" : "No"],
    ["Tasa de fallas por ciclo (ciclo 1)", "(fallidos ÷ ejecutados) × 100", "—", `${pct(m.tasaFallas)} (${m.fallidos}/${m.ejecutados})`, "—"],
    ["Cobertura de historias", "HU con al menos un caso ejecutado ÷ 30 HU vigentes", "100 %", `${pct((m.huCubiertas / m.huVigentes) * 100)} (${m.huCubiertas}/${m.huVigentes})`, m.huCubiertas === m.huVigentes ? "Sí" : "No"],
    ["Casos P1 ejecutados o bloqueados", "(P1 ejecutados + bloqueados) ÷ P1", "100 %", `${pct((m.p1EjecutadosOBloqueados / m.p1Total) * 100)} (${m.p1EjecutadosOBloqueados}/${m.p1Total}); los ${m.p1FueraDeRepo} restantes son fuera de repo o no automatizables`, m.p1EjecutadosOBloqueados + m.p1FueraDeRepo === m.p1Total ? "Sí (con capa unitaria aparte)" : "No"],
    ["Cobertura de código", "Líneas y ramas según JaCoCo y Vitest", "≥ 70 % líneas, ≥ 60 % ramas", "No medida aquí (fuera de este repositorio)", "—"],
    ["Defectos por prioridad", "Abiertos al final de la fase, por criticidad", "0 críticos y 0 altos abiertos", `Abiertos: ${m.porImpacto["Alto-3"]} Alto-3, ${m.porImpacto["Medio-2"]} Medio-2, ${m.porImpacto["Bajo-1"]} Bajo-1 (${m.defectos} en total; todos «Asignada»)`, m.porImpacto["Alto-3"] === 0 ? "Sí" : "No"],
    ["Estabilidad del pipeline", "Ejecuciones de CI en verde ÷ ejecuciones en main", "—", "Sin datos: el workflow de CI aún no se ha ejecutado", "—"],
  ];
  filas.forEach((v, i) => {
    const r = met.getRow(3 + i);
    v.forEach((t, j) => { const c = r.getCell(j + 1); c.value = t; c.alignment = { wrapText: true, vertical: "top" }; c.border = { bottom: { style: "thin", color: { argb: "FFBFBFBF" } } }; });
    r.getCell(5).font = { bold: true, color: { argb: v[4].startsWith("Sí") ? "FF2E7D32" : v[4] === "No" ? "FFC62828" : "FF595959" } };
  });
  let f = 3 + filas.length + 2;
  met.getRow(f).getCell(1).value = "Casos por estado";
  met.getRow(f).getCell(1).font = { bold: true };
  f++;
  const porEstado = ESTADOS.map((e) => [e, d.res.filter((r) => r.estado === e).length]).filter(([, n]) => n);
  for (const [e, n] of [...porEstado, ["Total del catálogo", m.total]]) {
    met.getRow(f).getCell(1).value = e;
    met.getRow(f).getCell(4).value = n;
    if (e.startsWith("Total")) { met.getRow(f).getCell(1).font = { bold: true }; met.getRow(f).getCell(4).font = { bold: true }; }
    f++;
  }
  f++;
  met.getRow(f).getCell(1).value = "Ambiente";
  met.getRow(f).getCell(1).font = { bold: true };
  f++;
  for (const [k, v] of [["Fechas de ejecución", `${d.ambiente.desde} a ${d.ambiente.hasta}`], ["Commit de la app", d.ambiente.commitApp], ["Commit de las pruebas (última corrida)", d.ambiente.commitPruebas], ["Navegador", d.ambiente.navegador], ["URL", d.ambiente.baseUrl], ["Corridas en el historial", String(m.corridas)], ["Generado", new Date().toISOString().slice(0, 16).replace("T", " ")]]) {
    met.getRow(f).getCell(1).value = k;
    met.getRow(f).getCell(2).value = v;
    f++;
  }

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  await wb.xlsx.writeFile(SALIDA);
  console.log(`Excel generado: ${path.relative(d.RAIZ, SALIDA)} · ${d.res.length} casos · ${d.DEFECTOS.length} incidentes · aprobación ${pct(m.aprobacion)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
