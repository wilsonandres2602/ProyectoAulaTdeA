// npm run informe → resultados/Informe_de_cierre_pruebas_V-Learning.docx (y .pdf si hay Word en Windows)
// Informe de cierre de la §7.16 del plan, con tablas numeradas en formato APA 7 (Arial 11).
// Lee el catálogo, el historial (solo lectura) y la clasificación de D-xx (scripts/lib). Sin secretos:
// no incluye correos, contraseñas, OTP ni tokens; solo IDs de casos, corridas y commits.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak } = require("docx");
const apa = require("./lib/apa7.cjs");
const { cargar, celdas, plano, sinSecretos } = require("./lib/cierre.cjs");

// Títulos con espacio extra antes y después (preferencia del usuario; ver skill APA 7).
const ESPACIO = { 1: { before: 480, after: 240 }, 2: { before: 480, after: 120 }, 3: { before: 360, after: 120 } };
apa.heading = (n, texto) => new Paragraph({
  heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][n - 1],
  spacing: { line: 480, ...ESPACIO[n] },
  children: [new TextRun({ text: texto })],
});

const d = cargar();
const m = d.metricas;
const SALIDA_DOCX = path.join(d.RAIZ, "resultados", "Informe_de_cierre_pruebas_V-Learning.docx");
const SALIDA_PDF = SALIDA_DOCX.replace(/\.docx$/, ".pdf");
const pct = (x) => `${x.toFixed(1).replace(".", ",")} %`;
const ms = (x) => `${Math.round(x).toLocaleString("es-CO")} ms`;
const fechaCO = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
const commitPruebasActual = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: d.RAIZ }).toString().trim(); } catch { return "—"; } })();

// Spec de cada caso: el archivo de tests/ que contiene su ID.
const specDe = {};
for (const f of fs.readdirSync(path.join(d.RAIZ, "tests")).filter((x) => x.endsWith(".js"))) {
  const t = fs.readFileSync(path.join(d.RAIZ, "tests", f), "utf8");
  for (const id of new Set(t.match(/CP-[A-Z]{2,3}\d{0,3}-\d{2}/g) ?? [])) (specDe[id] ??= new Set()).add(f.replace(/\.(spec|setup)\.js$/, ""));
}

let numTabla = 0;
// Todo texto pasa por sinSecretos antes de ir al documento.
const tabla = (opts) => apa.apaTable({ number: ++numTabla, ...opts, title: sinSecretos(opts.title), note: opts.note && sinSecretos(opts.note), rows: opts.rows.map((f) => f.map((c) => sinSecretos(c))) });
const P = (t) => apa.para(sinSecretos(t));
const bloques = [];
const vertical = [];
const horizontal = [];
let actual = vertical;
const seccion = (landscape) => { actual = []; bloques.push({ children: actual, landscape }); };
const add = (...x) => actual.push(...x);

// ------------------------------------------------------------------ Portada
seccion(false);
add(
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2400, after: 480, line: 480 }, children: [new TextRun({ text: "Informe de cierre de pruebas E2E de V-Learning", bold: true, font: apa.FONT, size: 28 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: 480 }, children: apa.runs("Pruebas de extremo a extremo automatizadas con Playwright (repositorio v-learning-e2e)") }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: 480 }, children: apa.runs(`Ciclo 1 · ${fechaCO(d.ambiente.desde)} a ${fechaCO(d.ambiente.hasta)}`) }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: 480 }, children: apa.runs(`Aplicación: manu-b11/v-learning-platform, commit ${String(d.ambiente.commitApp).slice(0, 7)} · Pruebas: commit ${commitPruebasActual}`) }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: 480 }, children: apa.runs(`Generado el ${new Date().toLocaleDateString("es-CO")} con npm run informe`) }),
  new Paragraph({ children: [new PageBreak()] }),
);

// ------------------------------------------------------------------ 1. Resumen ejecutivo
add(apa.heading(1, "Resumen ejecutivo"));
add(P(`Este informe cierra el ciclo 1 de las pruebas de extremo a extremo (E2E) de V-Learning definidas en la §7 del plan de pruebas. El catálogo tiene ${m.total} casos: los 224 del plan y 6 que el equipo agregó durante la ejecución (CP-HU029-09, CP-HU020-08, CP-HU023-04, CP-HU017-06, CP-HU025-10 y CP-HU025-11). De ellos, ${m.ejecutados} se ejecutaron contra el frontend, el backend y la base de datos reales, sin simulaciones; ${m.exitosos} pasaron tal como los describe el plan, ${m.ajuste} pasaron con un ajuste documentado (diferencias entre el plan y la app) y ${m.fallidos} fallaron.`));
add(P(`La tasa de aprobación es ${pct(m.aprobacion)} (meta ≥ 90 %), la cobertura de historias es ${m.huCubiertas} de ${m.huVigentes} HU vigentes y quedan ${m.defectos} defectos abiertos: ${m.porImpacto["Alto-3"]} de impacto alto, ${m.porImpacto["Medio-2"]} medio y ${m.porImpacto["Bajo-1"]} bajo. ${m.aprobacion >= 90 ? "La aprobación alcanza la meta, pero por los defectos altos abiertos" : "Por los defectos altos abiertos y la aprobación por debajo de la meta,"} la recomendación es __No ir__ (ver la sección de criterios de salida). La Tabla 1 resume el alcance y el ambiente.`));
add(...tabla({
  title: "Alcance, ambiente y versiones de la ejecución",
  headers: ["Elemento", "Valor"],
  rows: [
    ["Alcance", `${m.total} casos del catálogo docs/MAPEO_CASOS.md (30 HU vigentes; HU-008 retirada). Fuera de este repositorio: pruebas unitarias e integración (AUT-01…AUT-15), cobertura JaCoCo y carga (k6)`],
    ["Tipo de prueba", "E2E-UI (acciones de usuario) y E2E-API (seguridad y autorización con el token de una sesión iniciada por la UI); accesibilidad con @axe-core/playwright, WCAG 2.1 AA"],
    ["Fechas de ejecución", `${fechaCO(d.ambiente.desde)} a ${fechaCO(d.ambiente.hasta)}`],
    ["Aplicación bajo prueba", `manu-b11/v-learning-platform, commit ${d.ambiente.commitApp}`],
    ["Repositorio de pruebas", `v-learning-e2e, commit ${commitPruebasActual} (última corrida registrada con ${String(d.ambiente.commitPruebas).slice(0, 7)})`],
    ["Ambiente", `Local: frontend ${d.ambiente.baseUrl} (Vite), backend http://localhost:8080 (Spring Boot), PostgreSQL con la base aislada vlearning_e2e`],
    ["Navegador", `${d.ambiente.navegador}, es-CO, America/Bogota, vista de escritorio, 1 worker`],
    ["Servicios externos", "Sin SMTP (correo no medido). Ollama con gemma2:2b solo para CP-HU024-03…06 y CP-HU017-06; CP-HU024-01 con Ollama apagado"],
    ["Historial auditable", `Un archivo por origen, cada uno con su cadena SHA-256: auditoria/ejecuciones-local.jsonl (${d.ambiente.registrosPorOrigen.local} registros) y auditoria/ejecuciones-ci.jsonl (${d.ambiente.registrosPorOrigen.ci} registros). Se combinan por fecha; ${m.corridas} corridas vigentes por caso`],
    ["Observación de ambiente", "27 corridas del 11/11/2026 cayeron en la base vlearning (no aislada); quedaron anotadas en el historial y los grupos rápidos se repitieron sobre vlearning_e2e"],
  ],
  columnWidths: [1, 3], bodyAlign: "left", keepTogether: false,
  note: "El estado de cada caso es el de su última corrida. No se incluyen contraseñas, códigos OTP, tokens ni correos de las cuentas de prueba.",
}));

// ------------------------------------------------------------------ 2. Matriz de ejecución por HU
add(apa.heading(1, "Matriz de ejecución por historia de usuario"));
add(P(`La Tabla 2 muestra, por HU, cuántos casos pasaron, cuántos pasaron con ajuste, cuántos fallaron y cuántos no se ejecutan en este repositorio (bloqueados, manuales, fuera de repositorio o no automatizables). El porcentaje es la aprobación sobre los casos ejecutados. La matriz completa por caso está en el Anexo.`));
const grupos = [...d.HU_VIGENTES, "Transversal"];
const filaHu = (hu) => {
  const rs = d.res.filter((r) => r.hu === hu);
  const c = (e) => rs.filter((r) => r.estado === e).length;
  const ej = c("Exitoso") + c("Con ajuste") + c("Fallido");
  return [hu, rs.length, c("Exitoso"), c("Con ajuste"), c("Fallido"), c("Bloqueado"), c("Manual"), c("Fuera de repo") + c("No automatizable"), ej ? pct(((c("Exitoso") + c("Con ajuste")) / ej) * 100) : "—"].map(String);
};
const filasHu = grupos.map(filaHu);
filasHu.push(["Total", m.total, m.exitosos, m.ajuste, m.fallidos, m.bloqueados, m.manuales, m.fueraRepo + m.noAutomatizables, pct(m.aprobacion)].map(String));
add(...tabla({
  title: "Resultados de la ejecución por historia de usuario",
  headers: ["HU", "Casos", "Pasan", "Con ajuste", "Fallan", "Bloq.", "Manual", "Fuera / No aut.", "% aprob."],
  rows: filasHu, columnWidths: [1.2, 0.9, 0.9, 1, 0.9, 0.8, 0.9, 1.2, 1.1], totalsRows: [filasHu.length - 1], keepTogether: false,
  note: "Bloq. = bloqueados; Fuera / No aut. = fuera de repositorio o no automatizables. «Transversal» agrupa las pruebas unitarias, de integración, de cobertura y de carga que no pertenecen a una HU. % aprob. = (pasan + con ajuste) ÷ ejecutados.",
}));

// ------------------------------------------------------------------ 3. Trazabilidad
add(apa.heading(1, "Matriz de trazabilidad"));
add(P("La Tabla 3 relaciona cada HU con sus requisitos funcionales, sus casos y el archivo de pruebas (spec) que los implementa. Los RF salen de las anotaciones de cada caso en el historial y, si el caso no se ejecuta aquí, de la sección del catálogo."));
const rango = (ids) => {
  const porPref = {};
  for (const id of ids) { const mm = id.match(/^(CP-[A-Z]+\d*)-(\d+)$/); if (mm) (porPref[mm[1]] ??= []).push(mm[2]); else (porPref[id] ??= []); }
  return Object.entries(porPref).map(([p, ns]) => (ns.length ? `${p}-${ns.sort().join(", ")}` : p)).join("; ");
};
const filasTraz = d.HU_VIGENTES.map((hu) => {
  const rs = d.res.filter((r) => r.hu === hu);
  const rf = new Set();
  rs.forEach((r) => String(r.ultima?.rf ?? r.rf).split(/,\s*/).filter((x) => /^RF-\d+$/.test(x.trim())).forEach((x) => rf.add(x.trim())));
  if (!rf.size) rs.forEach((r) => (r.rf.match(/RF-\d+/g) ?? []).forEach((x) => rf.add(x)));
  const specs = new Set(rs.flatMap((r) => [...(specDe[r.id] ?? [])]));
  return [hu, rs[0]?.escenario?.replace(/\s*\([^)]*\)\s*$/, "") ?? "", [...rf].sort().join(", "), rango(rs.map((r) => r.id)), [...specs].sort().join(", ") || "—"];
});
add(...tabla({
  title: "Trazabilidad entre historias, requisitos, casos y scripts",
  headers: ["HU", "Historia", "RF", "Casos", "Spec"],
  rows: filasTraz, columnWidths: [0.8, 1.8, 1.4, 2.6, 1.6], bodyAlign: "left", keepTogether: false,
  note: "CP-HU017-06 está en hu024-tutor porque necesita respuestas reales del Tutor IA. Los casos fuera de este repositorio (AUT, COB, NA) no tienen spec aquí.",
}));

// ------------------------------------------------------------------ 4. Defectos (horizontal)
seccion(true);
add(apa.heading(1, "Defectos"));
add(P(`Quedan ${m.defectos} defectos abiertos, todos en estado «Asignada» en el Excel de incidentes. La criticidad es la que decidió el equipo; donde no la fijó, sale de la prioridad del caso (P1 → Alto-3, P2 → Medio-2, P3 → Bajo-1). La Tabla 4 los resume con su causa y una recomendación de corrección.`));
const orden = { "Alto-3": 0, "Medio-2": 1, "Bajo-1": 2 };
const defOrd = [...d.DEFECTOS].sort((a, b) => orden[a.impacto] - orden[b.impacto] || a.id.localeCompare(b.id));
add(...tabla({
  title: "Defectos abiertos con impacto, causa y recomendación",
  headers: ["ID", "Impacto", "Tipo", "Caso", "Defecto y causa", "Recomendación"],
  rows: defOrd.map((x) => [x.destacado ? `__${x.id}__` : x.id, x.impacto, x.tipo, x.casos.join(", "), `__${x.titulo}.__ ${x.causa}`, x.recomendacion]),
  columnWidths: [0.75, 0.95, 1.35, 1.45, 3.9, 2.6], width: apa.LANDSCAPE_CONTENT_W, bodyAlign: "left", keepTogether: false,
  note: `En negrita, los cuatro defectos destacados. D-46 (CP-HU027-04: «Editar entrega» deshabilitado en vez de oculto tras calificar) es una diferencia, no un defecto. Hallazgos que no son defectos: ${d.HALLAZGOS.join(", ").replace(/, ([^,]*)$/, " y $1")}${d.HALLAZGOS_DETALLE?.["D-47"] ? ` (D-47: ${d.HALLAZGOS_DETALLE["D-47"].titulo.toLowerCase()}; la recomendación es dejar vlearning.dev.exponer-secretos en false por defecto)` : ""}.`,
}));
seccion(false);
add(apa.heading(2, "Defectos destacados"));
const dest = (id, texto) => add(apa.runInHeading(4, `${id}: ${d.DEFECTOS.find((x) => x.id === id).titulo}`, texto));
dest("D-09", "Es un riesgo de seguridad y de usabilidad (Alto-3, P1). El contador de intentos fallidos se calcula sobre la auditoría y no se reinicia ni con un login correcto ni al desbloquear por enlace: tras desbloquear, un solo fallo vuelve a bloquear la cuenta (423). CP-HU002-10 falla. Corregirlo es requisito para cumplir TE-04 y RF-043.");
dest("D-18", "La sesión nunca vence por inactividad mientras la pestaña está abierta, porque el sondeo de notificaciones cada 30 s renueva la sesión; el aviso previo de RF-042 nunca aparece. Se midió en los casos lentos CP-HU002-17 y 18 (31 min, 63 consultas). Afecta la seguridad en equipos compartidos.");
dest("D-34", "La lección muestra el Markdown como texto plano: sin encabezados, listas, tablas ni imágenes con texto alternativo. Rompe la semántica que necesitan los lectores de pantalla (HU-019) y es la causa común de varios fallos de accesibilidad de contenido; ya estaba identificado en la auditoría interna de RF-032 a RF-049.");
dest("D-37", "Es un defecto de integridad de datos (Alto-3): editar solo el título de una evaluación sin alternativa accesible la marca como «con alternativa» porque el formulario siempre inicia la casilla en verdadero. Se confirmó con datos desechables: el estudiante con perfil motor pasó de «Excluida» a «0 % No presentada» y la evaluación empezó a contar en su nota (HU-029). Es silencioso para el instructor.");

// ------------------------------------------------------------------ 5. Diferencias (horizontal)
seccion(true);
add(apa.heading(1, "Diferencias entre el plan y la aplicación"));
add(P("Las diferencias son comportamientos de la app que no coinciden con lo que asumía el plan pero que el equipo aceptó (el caso pasa «con ajuste»). La Tabla 5 las lista con lo que conviene actualizar en el plan."));
const md = fs.readFileSync(path.join(d.RAIZ, "docs", "MAPEO_CASOS.md"), "utf8").split(/\r?\n/);
const temaDe = {};
for (const l of md) if (/^\| D-\d+ \|/.test(l)) { const c = celdas(l); temaDe[c[0]] = plano(c[1]).replace(/^(Diferencia, no defecto|DEFECTO|Defecto|Pendiente de clasificar)[^.]*\.\s*/i, "").replace(/\s*\(decisión[^)]*\)/i, "").trim(); }
add(...tabla({
  title: "Diferencias aceptadas y actualizaciones propuestas al plan",
  headers: ["ID", "Tema", "Qué actualizar en el plan"],
  rows: Object.entries(d.DIFERENCIAS).sort(([a], [b]) => a.localeCompare(b)).map(([id, upd]) => [id, temaDe[id] || "—", upd]),
  columnWidths: [0.6, 3, 6], width: apa.LANDSCAPE_CONTENT_W, bodyAlign: "left", keepTogether: false,
  note: "El detalle de cada diferencia (lo que dice el plan, lo que hace el código y la decisión) está en docs/MAPEO_CASOS.md §3.",
}));
seccion(false);
add(apa.heading(2, "Actualización de la §7.15"));
add(P("La §7.15 del plan describe la automatización E2E con Cypress y cypress-axe dentro del repositorio de la app y un pipeline en GitHub Actions sobre ese repositorio. La ejecución real usó Playwright (@playwright/test 1.64) con @axe-core/playwright y WCAG 2.1 AA, en un repositorio aparte (v-learning-e2e) que no modifica la app. Se propone actualizar la §7.15 y la §8.1 (herramientas) para reflejar: el repositorio separado y su workflow manual (.github/workflows/e2e.yml) que levanta PostgreSQL, el backend y el frontend; la base aislada vlearning_e2e; el historial auditable con cadena de hashes (un archivo por origen: auditoria/ejecuciones-local.jsonl y auditoria/ejecuciones-ci.jsonl); y que las capas unitaria y de integración (JUnit, MockMvc, Testcontainers, Vitest) siguen en el repositorio de la app."));

// ------------------------------------------------------------------ 6. Rendimiento
add(apa.heading(1, "Rendimiento frente a los umbrales"));
add(P("Las pruebas registran tiempos sin hacerlas fallar: se mide solo el clic y la respuesta visible, en un equipo local con un solo usuario. La Tabla 6 agrupa las mediciones de la última corrida de cada caso por umbral de la §7.7. No se afirma conformidad de volumen ni de concurrencia: esos criterios (informes con 10 000 registros, 100 o 200 estudiantes, 500 usuarios) quedaron bloqueados o fuera de este repositorio."));
const porFuente = {};
for (const r of d.rendimiento) (porFuente[r.fuente] ??= []).push(r);
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const filasRend = Object.entries(porFuente).sort(([a], [b]) => a.localeCompare(b, "es")).map(([fuente, xs]) => [
  fuente, String(xs.length), ms(mediana(xs.map((x) => x.ms))), ms(Math.max(...xs.map((x) => x.ms))), `${xs.filter((x) => x.cumple).length} de ${xs.length}`,
]);
add(...tabla({
  title: "Tiempos medidos frente a los umbrales de la §7.7",
  headers: ["Umbral (fuente)", "Mediciones", "Mediana", "Máximo", "Cumplen"],
  rows: filasRend, columnWidths: [4, 1.2, 1.3, 1.3, 1.2], keepTogether: false,
  note: `Tutor IA (§7.7: medir aparte el primer arranque): con el modelo en frío la primera consulta tardó 3954 ms y las siguientes 386 y 866 ms. Los «@lento» de HU-002/HU-003 miden la sesión (minutos) y no aparecen aquí. ${d.rendimiento.filter((x) => !x.cumple).length ? "Hay mediciones por encima del umbral: ver el Excel de casos." : "Todas las mediciones están dentro de su umbral."}`,
}));

// ------------------------------------------------------------------ 7. Criterios de salida
add(apa.heading(1, "Criterios de salida y recomendación"));
add(P("La Tabla 7 evalúa cada criterio de salida de la §7.8 con los datos de esta ejecución."));
const altos = d.DEFECTOS.filter((x) => x.impacto === "Alto-3").map((x) => x.id).join(", ");
add(...tabla({
  title: "Evaluación de los criterios de salida de la §7.8",
  headers: ["Criterio", "Resultado", "¿Cumple?"],
  rows: [
    ["100 % de las HU vigentes trazadas a casos", `${m.huVigentes} de ${m.huVigentes} HU con casos; ${m.huCubiertas} con al menos un caso ejecutado`, "Sí"],
    ["Todos los casos P1 ejecutados o formalmente bloqueados", `${m.p1EjecutadosOBloqueados} de ${m.p1Total} P1 ejecutados o bloqueados; los ${m.p1FueraDeRepo} restantes son de la capa unitaria o de integración (fuera de este repositorio)`, "Sí, en la capa E2E"],
    ["Tasa de aprobación ≥ 90 %", `${pct(m.aprobacion)} (${m.exitosos + m.ajuste} de ${m.ejecutados} ejecutados)`, m.aprobacion >= 90 ? "Sí" : "No"],
    ["Ningún defecto crítico o alto abierto sin aceptación", `${m.porImpacto["Alto-3"]} defectos Alto-3 abiertos (${altos}), sin aceptación del responsable`, "No"],
    ["Pipeline de CI en verde en main", "El workflow .github/workflows/e2e.yml existe pero aún no se ha ejecutado en GitHub (el repositorio no está publicado)", "No evaluable"],
    ["Resultados, evidencias y reportes guardados", "Historial con cadena de hashes íntegra, capturas versionadas, traces y videos locales, Excel de casos e incidentes e informe", "Sí"],
    ["Riesgos y defectos restantes comunicados", "Este informe, la hoja «Incidentes» y ESTADO.md", "Sí"],
  ],
  columnWidths: [3, 5, 1.4], bodyAlign: "left",
}));
add(apa.heading(2, "Recomendación: no ir"));
add(P(`No se recomienda pasar a producción con esta versión (commit ${String(d.ambiente.commitApp).slice(0, 7)}). ${m.aprobacion >= 90 ? "No se cumple el criterio de defectos" : "Dos criterios de salida no se cumplen"}: hay ${m.porImpacto["Alto-3"]} defectos de impacto alto abiertos sin aceptación, entre ellos dos de seguridad de sesión (D-09 y D-18), uno de integridad de datos que cambia notas sin aviso (D-37) y la pérdida de respuestas sin conexión (D-23)${m.aprobacion >= 90 ? `. La aprobación (${pct(m.aprobacion)}) supera la meta del 90 % por muy poco: cualquier regresión la deja por debajo` : `; y la aprobación es ${pct(m.aprobacion)}, por debajo del 90 %`}. Además, el pipeline de CI todavía no tiene corridas.`));
add(P("La decisión puede cambiar a Ir cuando: se corrijan los defectos Alto-3 (o el responsable acepte por escrito los que queden), se repitan sus casos y la regresión de las HU afectadas manteniendo la aprobación en 90 % o más y el workflow de CI corra en verde en main. Los defectos Medio-2 y Bajo-1 pueden quedar en el plan de la siguiente versión con responsable y fecha."));

// ------------------------------------------------------------------ Video demostrativo
// Sale de resultados/demo/montaje.json (npm run video:demo). No es un caso de prueba ni cuenta en las métricas.
add(apa.heading(1, "Video demostrativo"));
const montaje = (() => { try { return JSON.parse(fs.readFileSync(path.join(d.RAIZ, "resultados", "demo", "montaje.json"), "utf8")); } catch { return null; } })();
if (!montaje) {
  add(P("El video demostrativo del flujo principal se genera con npm run video:demo en resultados/Video_demo_V-Learning.mp4. No se encontró una grabación al generar este informe."));
} else {
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  add(P(`Aparte de la suite, el video resultados/Video_demo_V-Learning.mp4 (${mmss(montaje.duracionS)} min, H.264, 1920 × 1080; subtítulos en resultados/Video_demo_V-Learning.srt) muestra el flujo principal por la interfaz, como una persona, sobre la base vlearning_e2e y con datos con prefijo «Demo»: el administrador crea las cuentas, la instructora arma y publica dos cursos, y el estudiante hace el onboarding, usa las funciones de accesibilidad, completa ambos cursos y revisa su progreso; al final el administrador muestra la auditoría. Se genera con npm run video:demo, no forma parte de test:e2e y no cuenta como caso de prueba. Los códigos OTP, las contraseñas temporales y los tokens salen difuminados; ${montaje.fotogramasRevisados} fotogramas de muestra se revisaron con scripts/detectar-otp.cjs. Los tramos de preparación se aceleraron ×${String(montaje.factorRapido).replace(".", ",")}.`));
  add(P(montaje.fallas?.length
    ? `Pasos con falla, rotulados en el video sin esconderla: ${montaje.fallas.map((x) => `${x.paso.split(".")[0]} (${x.defecto ? `${x.defecto}: ` : ""}${x.error})`).join("; ")}.`
    : "Todos los pasos del recorrido se completaron sin fallas. El rótulo del paso de la lectura recuerda D-34: la lección muestra el Markdown como texto plano."));
  add(...tabla({
    title: "Pasos del video demostrativo",
    headers: ["Paso", "Qué se ve"],
    rows: montaje.pasos.map((p) => [String(p.n), p.texto.replace(/^\d+\.\s*/, "") + (p.rapido ? " (acelerado)" : "")]),
    columnWidths: [0.6, 6], bodyAlign: "left", keepTogether: false,
    note: "Cada paso empieza con un rótulo en pantalla; el archivo .srt repite los mismos textos con sus tiempos.",
  }));
}

// ------------------------------------------------------------------ Anexo: matriz por caso
add(new Paragraph({ children: [new PageBreak()] }));
add(apa.heading(1, "Anexo: matriz de ejecución por caso"));
add(P(`La Tabla ${numTabla + 1} es la matriz de ejecución que pide la §7.16: cada caso con su resultado en la última corrida, su prioridad, el responsable y un comentario.`));
const comentario = (r) => {
  if (r.estado === "Fallido") { const x = d.DEFECTOS.find((y) => y.casos.includes(r.id)); return x ? `${x.id} (${x.impacto})` : "Fallido sin defecto asociado"; }
  if (r.estado === "Con ajuste") return "Diferencia documentada (MAPEO §3)";
  if (r.estado === "Bloqueado") return "Dependencia no disponible";
  if (["Fuera de repo", "No automatizable", "Manual"].includes(r.estado)) return "No se ejecuta en este repositorio";
  return r.noAislada ? "Corrida anotada: base no aislada" : "";
};
add(...tabla({
  title: "Matriz de ejecución por caso de prueba",
  headers: ["ID", "HU", "P", "Resultado", "Responsable", "Comentario"],
  rows: d.res.map((r) => [r.id, r.hu, r.prioridad, r.estado, r.ejecutado || r.estado === "Bloqueado" ? "QA E2E (automatizado)" : "Equipo de la app", comentario(r)]),
  columnWidths: [1.5, 1, 0.5, 1.1, 1.6, 2.4], bodyAlign: "left", keepTogether: false,
  note: "QA E2E = repositorio v-learning-e2e. El detalle de pasos, resultado esperado y evidencia de cada caso está en resultados/Casos_de_prueba_ejecutados.xlsx (npm run auditoria:excel).",
}));

// ------------------------------------------------------------------ Guardar
async function main() {
  const doc = apa.createDocument(bloques, { pageNumber: true, title: "Informe de cierre de pruebas E2E de V-Learning" });
  fs.mkdirSync(path.dirname(SALIDA_DOCX), { recursive: true });
  await apa.save(doc, SALIDA_DOCX);
  console.log(`Informe generado: ${path.relative(d.RAIZ, SALIDA_DOCX)} (${numTabla} tablas)`);
  if (process.platform === "win32" && process.env.INFORME_PDF !== "0") {
    const ps = `$w = New-Object -ComObject Word.Application; $w.Visible = $false; try { $d = $w.Documents.Open('${SALIDA_DOCX.replace(/'/g, "''")}', $false, $true); $d.SaveAs2('${SALIDA_PDF.replace(/'/g, "''")}', 17); $d.Close($false) } finally { $w.Quit() }`;
    try {
      execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "pipe", timeout: 180_000 });
      console.log(`PDF generado: ${path.relative(d.RAIZ, SALIDA_PDF)}`);
    } catch (e) {
      console.log(`No se generó el PDF (se necesita Microsoft Word): ${String(e.message).split("\n")[0]}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
