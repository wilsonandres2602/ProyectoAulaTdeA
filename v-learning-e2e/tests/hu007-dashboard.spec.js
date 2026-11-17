import fs from "node:fs";
import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cerrarSesion, cuentaLista } from "../support/sesiones.js";
import { armarCurso, LECTURA, sesion } from "../support/cursos.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";
import { EstudianteCursoPage } from "../pages/EstudianteCursoPage.js";

const base = { hu: "HU-007", rf: "RF-006", prioridad: "P2" };
const UMBRAL_3S = U.s(3, "§7.3 dashboard < 3 s");
const QUIZ = "Quiz progreso";
const TAREA = "Tarea progreso";
const P = ["Primera de 50 puntos", "Segunda de 50 puntos"];
// El servidor siempre manda su mensaje motivador (DashboardService.MENSAJE_MOTIVADOR); el texto del
// catálogo es solo el de reserva de MiProgreso.jsx.
const MSG_SIN_ACTIVIDAD = "Aún no tienes actividad, y eso está bien: cada gran avance empieza con un primer paso. Elige un curso y empieza con un contenido corto.";

/**
 * Curso compartido por los casos de este archivo, armado por la UI la primera vez que se pide:
 * instructor desechable, «Módulo E2E» con la lectura, el Quiz de dos preguntas V/F de 50 puntos y
 * una tarea de 100 puntos. Cada estudiante se inscribe solo desde «Mis cursos».
 */
let compartido = null;
async function cursoBase(abrirContexto) {
  if (compartido) return compartido;
  const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "dashins" });
  const curso = await armarCurso(abrirContexto, ins, {
    prefijo: "E2E-Progreso",
    evaluaciones: [{ titulo: QUIZ, puntajeMaximo: 100, preguntas: [{ enunciado: P[0], puntaje: 50 }, { enunciado: P[1], puntaje: 50 }] }],
    tareas: [TAREA],
  });
  compartido = { ins, curso };
  return compartido;
}

/** «Mis cursos» → «Inscribirme en <curso>». */
async function inscribirse(page, curso) {
  await test.step(`Precondición: inscribirse en «${curso.titulo}»`, async () => {
    await page.getByRole("link", { name: "Mis cursos" }).click();
    await page.getByRole("button", { name: `Inscribirme en ${curso.titulo}` }).click();
    await expect(page.getByText(`Te inscribiste en «${curso.titulo}».`).first()).toBeVisible();
  });
}

/** Estudiante desechable con sesión, inscrito y con la lectura completada (tiene actividad). */
async function estudianteConActividad(abrirContexto, curso, etiqueta) {
  const est = await cuentaLista(abrirContexto, { etiqueta });
  const page = await sesion(abrirContexto, est);
  await inscribirse(page, curso);
  const ep = new EstudianteCursoPage(page);
  await test.step("Precondición: completa la lectura", () => ep.completarLectura(curso.titulo, LECTURA));
  return { est, page, ep };
}

const menuProgreso = (page) => page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Mi progreso" });
const valor = (page, rotulo) => page.locator("dt", { hasText: rotulo }).locator("xpath=following-sibling::dd");
const tablaCalificaciones = (page) => page.getByRole("table", { name: /^Mejor resultado por evaluación/ });
const tablaAvance = (page) => page.getByRole("table", { name: "Detalle del avance por curso" });

/** Abre «Mi progreso» desde el menú y mide hasta ver `listo` (el GET observado debe ser /api/progreso, sin id). */
async function abrirProgreso(page, listo, umbral = UMBRAL_3S) {
  const resp = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/progreso");
  await medir("Abrir Mi progreso", umbral, () => menuProgreso(page).click(), () => expect(listo()).toBeVisible());
  const r = await resp;
  expect(r.status()).toBe(200);
  await expect(page).toHaveURL(/\/progreso$/);
  return r;
}

/** Filas de una tabla: [{ cabecera, celdas[] }] con el texto de cada celda. */
async function filas(tabla) {
  const out = [];
  const trs = tabla.locator("tbody tr");
  for (let i = 0; i < (await trs.count()); i++) {
    const tr = trs.nth(i);
    out.push({
      cabecera: (await tr.locator("th").innerText()).replace(/\s+/g, " ").trim(),
      celdas: (await tr.locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()),
    });
  }
  return out;
}

test.describe("HU-007 · Dashboard de progreso (RF-006, RF-033)", () => {
  // ------------------------------------------------------------------ CP-HU007-01
  test("CP-HU007-01 — Estado sin actividad @P2 @HU-007", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU007-01", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3",
      ajuste: "El catálogo cita «Todavía no tienes actividad. ¡Empieza tu primera lección…», que es solo el texto de reserva de MiProgreso.jsx; el servidor siempre manda «Aún no tienes actividad, y eso está bien…» (DashboardService.MENSAJE_MOTIVADOR) y eso es lo que se valida" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "dashnew" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await test.step("1. /progreso (menú «Mi progreso»)", () =>
      abrirProgreso(page, () => page.getByText(MSG_SIN_ACTIVIDAD)));
    await test.step("Resultado: mensaje motivador y sin indicadores ni calificaciones", async () => {
      await expect(page.getByRole("heading", { name: "Mi progreso", level: 1 })).toBeVisible();
      await expect(page.locator("dt", { hasText: "Contenidos completados" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Calificaciones" })).toHaveCount(0);
    });
  });

  // ------------------------------------------------------------------ CP-HU007-02
  test("CP-HU007-02 — Avance y calificaciones coherentes con lo hecho @P2 @HU-007", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, caso: "CP-HU007-02", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3",
      ajuste: "Los pendientes no se muestran en /progreso (MiProgreso.jsx no usa `pendientes`); se validan los indicadores y la tabla «Calificaciones»" });
    const { ins, curso } = await cursoBase(abrirContexto);
    const { est, page, ep } = await estudianteConActividad(abrirContexto, curso, "dashcal");
    usuarioProbado(est.correo);
    await test.step(`Precondición: presenta «${QUIZ}» con 1 de 2 aciertos (50 %) y entrega «${TAREA}»`, async () => {
      await ep.presentarConAciertos(QUIZ, [P[0]]);
      await ep.entregarTarea(curso.titulo, TAREA, "Entrega de las pruebas E2E del dashboard.");
      await cerrarSesion(page);
      await page.context().close();
    });
    await test.step(`Precondición: el instructor califica «${TAREA}» con 90 de 100`, async () => {
      const pi = await sesion(abrirContexto, ins);
      const ed = new CursosInstructorPage(pi);
      await ed.ir();
      await ed.abrirEditor(curso.titulo);
      await ed.calificarTarea(TAREA, est.correo, 90);
      await cerrarSesion(pi);
      await pi.context().close();
    });

    const pe = await sesion(abrirContexto, est);
    await test.step("1. /progreso (menú «Mi progreso»)", () =>
      abrirProgreso(pe, () => valor(pe, "Contenidos completados")));
    await test.step("Resultado: 1 contenido completado, 2 calificadas (evaluación y tarea) y promedio 70 %", async () => {
      await expect(valor(pe, "Contenidos completados")).toHaveText("1");
      await expect(valor(pe, "Evaluaciones y tareas calificadas")).toHaveText("2");
      await expect(valor(pe, "Promedio de calificación")).toHaveText("70 %");
      await expect(valor(pe, "Tiempo de estudio")).toHaveText(/^\d+ (s|min)$/);
    });
    await test.step("Resultado: tabla «Calificaciones» (caption «Mejor resultado…») con el Quiz en 50 % y la tarea en 90 %", async () => {
      const t = tablaCalificaciones(pe);
      await expect(t).toBeVisible();
      const f = await filas(t);
      test.info().annotations.push({ type: "calificacionesVistas", description: JSON.stringify(f) });
      expect(f).toHaveLength(2);
      const quiz = f.find((x) => x.cabecera.startsWith(QUIZ));
      const tarea = f.find((x) => x.cabecera.startsWith(TAREA));
      expect(quiz, `fila de «${QUIZ}»`).toBeTruthy();
      expect(tarea, `fila de «${TAREA}»`).toBeTruthy();
      expect(quiz.cabecera.toLowerCase()).toContain("evaluación");
      expect(quiz.celdas.map((c) => c.toLowerCase())).toEqual([curso.titulo.toLowerCase(), "50 %", "1", "insuficiente"]);
      expect(tarea.cabecera.toLowerCase()).toContain("tarea");
      expect(tarea.celdas.map((c) => c.toLowerCase())).toEqual([curso.titulo.toLowerCase(), "90 %", "—", "excelente"]);
    });
  });

  // ------------------------------------------------------------------ CP-HU007-03
  test("CP-HU007-03 — Exportar PDF y Excel @P2 @HU-007", async ({ abrirContexto }) => {
    test.setTimeout(8 * 60_000);
    caso({ ...base, caso: "CP-HU007-03", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const { curso } = await cursoBase(abrirContexto);
    const { est, page } = await estudianteConActividad(abrirContexto, curso, "dashexp");
    usuarioProbado(est.correo);
    await test.step("Precondición: /progreso con actividad", () => abrirProgreso(page, () => valor(page, "Contenidos completados")));
    for (const [formato, boton, ext, firma] of [["PDF", "Exportar PDF", /\.pdf$/i, "%PDF"], ["EXCEL", "Exportar Excel", /\.xlsx$/i, "PK"]]) {
      await test.step(`«${boton}» → se descarga ${ext.source.replace(/\\|\$|\/i/g, "")} y aparece «Descarga lista.»`, async () => {
        const avisos = page.getByText("Descarga lista.", { exact: true });
        const antes = await avisos.count();
        const descarga = page.waitForEvent("download");
        const resp = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/progreso/exportar");
        await page.getByRole("button", { name: boton }).click();
        expect((await resp).status()).toBe(200);
        const d = await descarga;
        const nombre = d.suggestedFilename();
        const cabecera = fs.readFileSync(await d.path()).subarray(0, 4).toString("latin1");
        test.info().annotations.push({ type: `descarga${formato}`, description: `${nombre} (${cabecera.replace(/[^\x20-\x7e]/g, "?")})` });
        expect(nombre).toMatch(ext);
        expect(cabecera.startsWith(firma), `el archivo empieza por ${firma}`).toBeTruthy();
        await expect(avisos).toHaveCount(antes + 1);
      });
    }
    await verificarAuditoria(abrirContexto, [
      { accion: "PROGRESO_EXPORTADO", resultado: "Permitido", usuario: est.correo, recurso: "progreso/PDF" },
      { accion: "PROGRESO_EXPORTADO", resultado: "Permitido", usuario: est.correo, recurso: "progreso/EXCEL" },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU007-04
  test("CP-HU007-04 — Solo datos propios @P2 @HU-007", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU007-04", tecnica: "seguridad", clasificacion: "Ruta Alterna", clase: "Con ajuste", referenciaPlan: "§7.3",
      ajuste: "La pantalla no recibe un ID de estudiante (se observa GET /api/progreso, sin parámetros), así que no hay forma de pedir los datos de otro por la UI; se comprueba que B solo ve su curso y sus notas" });
    const { curso } = await cursoBase(abrirContexto);
    const a = await estudianteConActividad(abrirContexto, curso, "dashesa");
    await test.step(`Precondición: A presenta «${QUIZ}» con 2 de 2 aciertos (100 %)`, async () => {
      await a.ep.presentarConAciertos(QUIZ, P);
      await abrirProgreso(a.page, () => tablaCalificaciones(a.page));
      const f = await filas(tablaCalificaciones(a.page));
      expect(f.map((x) => x.celdas[1])).toEqual(["100 %"]);
      await cerrarSesion(a.page);
      await a.page.context().close();
    });
    const b = await estudianteConActividad(abrirContexto, curso, "dashesb");
    usuarioProbado(b.est.correo);
    await test.step("1. B abre /progreso", async () => {
      const r = await abrirProgreso(b.page, () => valor(b.page, "Contenidos completados"));
      expect(new URL(r.url()).search, "la petición no lleva parámetros").toBe("");
    });
    await test.step("Resultado: solo el curso de B y ninguna nota (A tiene 100 % en el Quiz)", async () => {
      await expect(valor(b.page, "Contenidos completados")).toHaveText("1");
      await expect(valor(b.page, "Evaluaciones y tareas calificadas")).toHaveText("0");
      // D-29 (solo hallazgo, decisión del usuario): sin notas el backend manda promedio 0 y se ve «0 %», aunque
      // MiProgreso.jsx tiene «—» para cuando no hay promedio. No es parte de este caso: solo se anota.
      test.info().annotations.push({ type: "promedioSinNotas", description: (await valor(b.page, "Promedio de calificación").innerText()).trim() });
      await expect(b.page.getByText("Aún no has presentado evaluaciones ni tienes tareas calificadas.")).toBeVisible();
      await expect(tablaCalificaciones(b.page)).toHaveCount(0);
      await b.page.getByRole("button", { name: "Ver como tabla" }).click();
      const f = await filas(tablaAvance(b.page));
      test.info().annotations.push({ type: "cursosDeB", description: JSON.stringify(f) });
      expect(f.map((x) => x.cabecera)).toEqual([curso.titulo]);
      await expect(b.page.getByText(a.est.nombre)).toHaveCount(0);
    });
  });

  // ------------------------------------------------------------------ CP-HU007-05
  test("CP-HU007-05 — Alternativa textual del gráfico (RF-033) @P3 @HU-007", async ({ abrirContexto }) => {
    test.setTimeout(8 * 60_000);
    caso({ ...base, rf: "RF-033", prioridad: "P3", caso: "CP-HU007-05", tecnica: "accesibilidad", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "RF-033 (adicional)" });
    const { curso } = await cursoBase(abrirContexto);
    const { est, page } = await estudianteConActividad(abrirContexto, curso, "dashtab");
    usuarioProbado(est.correo);
    await test.step("Precondición: /progreso con actividad", () => abrirProgreso(page, () => valor(page, "Contenidos completados")));
    const boton = page.getByRole("button", { name: "Ver como tabla" });
    await test.step("1. «Ver como tabla» → aparece «Detalle del avance por curso»", async () => {
      await expect(tablaAvance(page)).toBeHidden();
      await expect(boton).toHaveAttribute("aria-expanded", "false");
      await boton.click();
      await expect(tablaAvance(page)).toBeVisible();
      const f = await filas(tablaAvance(page));
      test.info().annotations.push({ type: "tablaAvance", description: JSON.stringify(f) });
      expect(f.map((x) => x.cabecera)).toEqual([curso.titulo]);
      // Avance, módulos, contenidos y tiempo, en texto (los mismos datos de la barra).
      expect(f[0].celdas).toHaveLength(4);
      expect(f[0].celdas[0]).toMatch(/^\d+ %$/);
      expect(f[0].celdas[2]).toBe("1");
      const barra = page.getByRole("progressbar", { name: `Avance en ${curso.titulo}` });
      await expect(barra).toHaveAttribute("aria-valuenow", f[0].celdas[0].replace(" %", ""));
    });
    await test.step("2. «Ocultar tabla» la oculta", async () => {
      const ocultar = page.getByRole("button", { name: "Ocultar tabla" });
      await expect(ocultar).toHaveAttribute("aria-expanded", "true");
      await ocultar.click();
      await expect(tablaAvance(page)).toBeHidden();
      await expect(page.getByRole("button", { name: "Ver como tabla" })).toBeVisible();
    });
  });
});
