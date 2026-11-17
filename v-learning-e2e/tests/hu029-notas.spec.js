import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cerrarSesion, cuentaLista } from "../support/sesiones.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import { MSG_403, pedir, tokenDeSesion } from "../support/api.js";
import { leerDatos } from "../support/datosCompartidos.js";
import { marca } from "../support/datos.js";
import { LoginPage } from "../pages/LoginPage.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";
import { EstudianteCursoPage } from "../pages/EstudianteCursoPage.js";

const base = { hu: "HU-029", rf: "RF-029", prioridad: "P1" };
const UMBRAL = U.s(3, "Notas del curso ≤ 3 s (§7.7, solo se registra)");
const MODULO = "Módulo Notas";
const LECTURA = "Lectura Notas";
const TEXTO_LECTURA = "Lectura corta de las pruebas E2E de notas. Se completa antes de presentar las evaluaciones.";

/** Entra por /login en un contexto nuevo como la cuenta dada. */
async function sesion(abrirContexto, cuenta) {
  const ctx = await abrirContexto();
  const page = await ctx.newPage();
  await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.password);
  await expect(page).toHaveURL(/\/inicio/);
  return page;
}

/**
 * El instructor arma por la UI un curso publicado con un módulo, una lectura publicada, las
 * evaluaciones y tareas dadas, e inscribe a los estudiantes. Devuelve { titulo, id, evaluaciones }.
 */
async function armarCurso(abrirContexto, ins, { evaluaciones = [], tareas = [], inscritos = [] }) {
  return test.step("Precondición: el instructor arma y publica el curso por la UI", async () => {
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const curso = { titulo: `E2E-Notas-${marca()}`, evaluaciones: {}, tareas: {} };
    await ed.ir();
    curso.id = await ed.crearCurso(curso.titulo, "Curso de las pruebas E2E de notas.");
    await ed.abrirEditor(curso.titulo);
    await ed.crearModulo(MODULO);
    await ed.crearLecturaPublicada(MODULO, LECTURA, TEXTO_LECTURA);
    for (const e of evaluaciones) curso.evaluaciones[e.titulo] = await ed.crearEvaluacion(MODULO, e.titulo, e);
    for (const t of tareas) curso.tareas[t] = await ed.crearTarea(t);
    await ed.publicarCurso();
    if (inscritos.length) await ed.inscribir(inscritos.map((c) => c.correo));
    await cerrarSesion(page);
    await page.context().close();
    return curso;
  });
}

/** El estudiante completa la lectura y luego hace `acciones(EstudianteCursoPage)`. */
async function comoEstudiante(abrirContexto, est, curso, descripcion, acciones) {
  return test.step(`Precondición: ${descripcion}`, async () => {
    const page = await sesion(abrirContexto, est);
    const ep = new EstudianteCursoPage(page);
    await ep.completarLectura(curso.titulo, LECTURA);
    await acciones(ep, page);
    await cerrarSesion(page);
    await page.context().close();
  });
}

/** El instructor abre «Notas del curso» desde el editor y mide hasta ver el resumen. */
async function verNotas(abrirContexto, ins, curso, esperar) {
  const page = await sesion(abrirContexto, ins);
  const ed = new CursosInstructorPage(page);
  await ed.ir();
  await ed.abrirEditor(curso.titulo);
  await medir("cargar las notas del curso", UMBRAL, () => ed.abrirNotas(), () => esperar(page));
  return page;
}

const tabla = (page) => page.getByRole("region", { name: "Tabla de notas" });

/** Fila de un estudiante en la tabla de notas: celdas de actividades, nota final y estado. */
async function fila(page, nombre) {
  const tr = tabla(page).getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(nombre) }) });
  await expect(tr).toHaveCount(1);
  const celdas = tr.getByRole("cell");
  const n = await celdas.count();
  const leer = async (i) => ({
    texto: (await celdas.nth(i).innerText()).replace(/\s+/g, " ").trim(),
    titulo: await celdas.nth(i).getAttribute("title"),
  });
  const actividades = [];
  for (let i = 0; i < n - 2; i++) actividades.push(await leer(i));
  return { actividades, final: (await leer(n - 2)).texto, estado: (await leer(n - 1)).texto };
}

/** Los tres indicadores del resumen: promedio general, aprueban y no aprueban. */
async function indicadores(page) {
  const valor = async (t) => (await page.getByText(t, { exact: true }).locator("xpath=following-sibling::p[1]").innerText()).trim();
  return { promedio: await valor("Promedio general del curso"), aprueban: await valor("Aprueban"), noAprueban: await valor("No aprueban") };
}

/**
 * D-22: la app formatea con String(numero), así que 60.0 y 100.0 se ven «60 %» y «100 %» (sin el
 * decimal), mientras 59.9 se ve «59,9 %». Se compara el valor y se anota el texto literal.
 */
function pct(texto) {
  const m = String(texto).match(/^(\d+(?:,\d+)?) %/);
  expect(m, `«${texto}» no es un porcentaje`).toBeTruthy();
  return Number(m[1].replace(",", "."));
}

function anotarFilas(filas) {
  test.info().annotations.push({ type: "notasVistas", description: JSON.stringify(filas) });
}

test.describe("HU-029 · Notas del curso (RF-029)", () => {
  // ------------------------------------------------------------------ CP-HU029-01
  test("CP-HU029-01 — Límite de aprobación 59,9 % y 60,0 % @P1 @HU-029", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, caso: "CP-HU029-01", tecnica: "límite", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "§7.14; TC-NOT-01; §7.12.2; AUT-20",
      ajuste: "Pesos 599/401 y 600/400 en una sola evaluación (máximo 100): tres preguntas V/F de 599, 1 y 400 puntos; A acierta la de 599 (599/1000) y B las de 599 y 1 (600/1000). D-22: la UI muestra «60 %» (sin el decimal); se compara el valor" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "notins" });
    const a = await cuentaLista(abrirContexto, { etiqueta: "nota599" });
    const b = await cuentaLista(abrirContexto, { etiqueta: "nota600" });
    usuarioProbado(ins.correo);
    const P = ["Pregunta de 599 puntos", "Pregunta de 1 punto", "Pregunta de 400 puntos"];
    const curso = await armarCurso(abrirContexto, ins, {
      evaluaciones: [{ titulo: "Quiz límite", puntajeMaximo: 100,
        preguntas: [{ enunciado: P[0], puntaje: 599 }, { enunciado: P[1], puntaje: 1 }, { enunciado: P[2], puntaje: 400 }] }],
      inscritos: [a, b],
    });
    await comoEstudiante(abrirContexto, a, curso, "A acierta solo la de 599 puntos (59,9 %)", (ep) => ep.presentarConAciertos("Quiz límite", [P[0]]));
    await comoEstudiante(abrirContexto, b, curso, "B acierta la de 599 y la de 1 punto (60,0 %)", (ep) => ep.presentarConAciertos("Quiz límite", [P[0], P[1]]));

    const page = await test.step("1. Instructor → «Notas del curso»", () =>
      verNotas(abrirContexto, ins, curso, (p) => expect(tabla(p)).toBeVisible()));
    await test.step("Resultado: A «No aprueba» con 59,9 %; B «Aprueba» con 60,0 %", async () => {
      const fa = await fila(page, a.nombre);
      const fb = await fila(page, b.nombre);
      anotarFilas({ A: fa, B: fb });
      expect(pct(fa.actividades[0].texto)).toBe(59.9);
      expect(pct(fa.final)).toBe(59.9);
      expect(fa.estado).toMatch(/^No aprueba/i);
      expect(pct(fb.actividades[0].texto)).toBe(60.0);
      expect(pct(fb.final)).toBe(60.0);
      expect(fb.estado).toMatch(/^Aprueba/i);
    });
    await test.step("Resultado: promedio 60,0 % (59,95 redondeado HALF_UP), «Aprueban» 1 y «No aprueban» 1", async () => {
      const ind = await indicadores(page);
      test.info().annotations.push({ type: "indicadores", description: JSON.stringify(ind) });
      expect(pct(ind.promedio)).toBe(60.0);
      expect({ aprueban: ind.aprueban, noAprueban: ind.noAprueban }).toEqual({ aprueban: "1", noAprueban: "1" });
    });
  });

  // ------------------------------------------------------------------ CP-HU029-02
  test("CP-HU029-02 — Cuenta el mejor intento por evaluación @P1 @HU-029", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU029-02", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "§7.3" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "notins" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "notmejor" });
    usuarioProbado(est.correo);
    const P = ["Primera de 40 puntos", "Segunda de 40 puntos", "Tercera de 20 puntos"];
    const curso = await armarCurso(abrirContexto, ins, {
      evaluaciones: [{ titulo: "Quiz intentos", puntajeMaximo: 100,
        preguntas: [{ enunciado: P[0], puntaje: 40 }, { enunciado: P[1], puntaje: 40 }, { enunciado: P[2], puntaje: 20 }] }],
      inscritos: [est],
    });
    await comoEstudiante(abrirContexto, est, curso, "dos intentos: 40 % y luego 80 %", async (ep, page) => {
      await ep.presentarConAciertos("Quiz intentos", [P[0]]);
      await expect(page.getByText(/40(,0+)?\s?%/).first()).toBeVisible();
      await ep.presentarConAciertos("Quiz intentos", [P[0], P[1]]);
      await expect(page.getByText(/80(,0+)?\s?%/).first()).toBeVisible();
    });

    const page = await test.step("1. Instructor → «Notas del curso»", () =>
      verNotas(abrirContexto, ins, curso, (p) => expect(tabla(p)).toBeVisible()));
    await test.step("Resultado: la celda muestra 80,0 % (el mejor intento)", async () => {
      const f = await fila(page, est.nombre);
      anotarFilas(f);
      expect(pct(f.actividades[0].texto)).toBe(80.0);
      expect(pct(f.final)).toBe(80.0);
    });
  });

  // ------------------------------------------------------------------ CP-HU029-03
  test("CP-HU029-03 — Tarea entregada sin calificar no cuenta @P1 @HU-029", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU029-03", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.3; TC-NOT-01" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "notins" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "nottarea" });
    usuarioProbado(est.correo);
    const curso = await armarCurso(abrirContexto, ins, {
      evaluaciones: [{ titulo: "Quiz tarea", puntajeMaximo: 100, preguntas: [{ enunciado: "Pregunta única", puntaje: 1 }] }],
      tareas: ["Tarea por calificar"],
      inscritos: [est],
    });
    await comoEstudiante(abrirContexto, est, curso, "presenta la evaluación (100 %) y entrega la tarea", async (ep) => {
      await ep.presentarConAciertos("Quiz tarea", ["Pregunta única"]);
      await ep.entregarTarea(curso.titulo, "Tarea por calificar", "Entrega de las pruebas E2E.");
    });

    const page = await test.step("1. Instructor → «Notas del curso»", () =>
      verNotas(abrirContexto, ins, curso, (p) => expect(tabla(p)).toBeVisible()));
    await test.step("Resultado: «Por calificar» y la nota final no la incluye", async () => {
      const f = await fila(page, est.nombre);
      anotarFilas(f);
      expect(pct(f.actividades[0].texto)).toBe(100.0);
      expect(f.actividades[1]).toEqual({ texto: "Por calificar", titulo: "Entregada, por calificar (no cuenta)" });
      expect(pct(f.final), "Con la tarea contando 0 % sería 50,0 %").toBe(100.0);
      expect(f.estado).toContain("1 por calificar");
    });
  });

  // ------------------------------------------------------------------ CP-HU029-04
  test("CP-HU029-04 — Actividad no presentada cuenta 0 % @P1 @HU-029", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU029-04", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.3" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "notins" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "notnopres" });
    usuarioProbado(est.correo);
    const curso = await armarCurso(abrirContexto, ins, {
      evaluaciones: [
        { titulo: "Quiz presentado", puntajeMaximo: 100, preguntas: [{ enunciado: "Pregunta presentada", puntaje: 1 }] },
        { titulo: "Quiz sin presentar", puntajeMaximo: 100, preguntas: [{ enunciado: "Pregunta sin presentar", puntaje: 1 }] },
      ],
      inscritos: [est],
    });
    await comoEstudiante(abrirContexto, est, curso, "presenta solo «Quiz presentado» (100 %)",
      (ep) => ep.presentarConAciertos("Quiz presentado", ["Pregunta presentada"]));

    const page = await test.step("1. Instructor → «Notas del curso»", () =>
      verNotas(abrirContexto, ins, curso, (p) => expect(tabla(p)).toBeVisible()));
    await test.step("Resultado: «No presentada» (cuenta 0 %)", async () => {
      const f = await fila(page, est.nombre);
      anotarFilas(f);
      expect(pct(f.actividades[0].texto)).toBe(100.0);
      expect(f.actividades[1]).toEqual({ texto: "0 % No presentada", titulo: "No presentada (cuenta 0 %)" });
      expect(pct(f.final)).toBe(50.0);
      expect(f.estado).toMatch(/^No aprueba/i);
      expect(f.estado).toContain("1 sin presentar");
    });
  });

  // ------------------------------------------------------------------ CP-HU029-05
  test("CP-HU029-05 — Exclusión para perfil motor sin alternativa accesible @P1 @HU-029", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU029-05", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.3; TC-NOT-01; HU-022" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "notins" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "notmotor", categorias: ["Motora"] });
    usuarioProbado(est.correo);
    const curso = await armarCurso(abrirContexto, ins, {
      evaluaciones: [
        { titulo: "Quiz accesible", puntajeMaximo: 100, preguntas: [{ enunciado: "Pregunta accesible", puntaje: 1 }] },
        { titulo: "Quiz sin alternativa", puntajeMaximo: 100, alternativa: false, preguntas: [{ enunciado: "Pregunta sin alternativa", puntaje: 1 }] },
      ],
      inscritos: [est],
    });
    await comoEstudiante(abrirContexto, est, curso, "el estudiante motor presenta «Quiz accesible» (100 %)", async (ep, page) => {
      await ep.presentarConAciertos("Quiz accesible", ["Pregunta accesible"]);
      await page.getByRole("link", { name: "Evaluaciones" }).click();
      await expect(page.getByText("No calificada por ahora: aún no tiene una alternativa accesible.")).toBeVisible();
    });

    const page = await test.step("1. Instructor → «Notas del curso»", () =>
      verNotas(abrirContexto, ins, curso, (p) => expect(tabla(p)).toBeVisible()));
    await test.step("Resultado: «Excluida» y no cuenta en la nota final", async () => {
      const f = await fila(page, est.nombre);
      anotarFilas(f);
      expect(pct(f.actividades[0].texto)).toBe(100.0);
      expect(f.actividades[1]).toEqual({ texto: "Excluida", titulo: "Excluida: sin alternativa accesible (no cuenta)" });
      expect(pct(f.final), "Si contara como no presentada sería 50,0 %").toBe(100.0);
      expect(f.estado).toMatch(/^Aprueba/i);
    });
  });

  // ------------------------------------------------------------------ CP-HU029-06 (API)
  test("CP-HU029-06 — Notas de un curso ajeno: 403 @P1 @HU-029 @api", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU029-06", tecnica: "seguridad", clasificacion: "Ruta Alterna", clase: "E2E-API",
      referenciaPlan: "§7.3; CP-HU004-05" });
    const d = leerDatos();
    const idA = d.cursoA.id;
    const ruta = `/api/cursos/${idA}/notas`;
    const est = await cuentaLista(abrirContexto, { etiqueta: "notajeno" });
    const insB = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "notinsb" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "DENEGACION", 1);
    protegerCuenta(insB.correo, "DENEGACION", 4);

    const pe = await sesion(abrirContexto, est);
    await test.step(`1. Estudiante (UI): /cursos/${idA}/notas redirige a /inicio`, async () => {
      await pe.goto(`/cursos/${idA}/notas`);
      await expect(pe).toHaveURL(/\/inicio$/);
      await expect(pe.getByText("Notas del curso", { exact: true })).toHaveCount(0);
    });
    await test.step(`2. Estudiante (API): GET ${ruta} → 403`, async () => {
      const r = await pedir(pe, "GET", ruta, { token: await tokenDeSesion(pe) });
      registrarEvento(est.correo, "DENEGACION");
      expect(r.status).toBe(403);
      expect(r.cuerpo?.codigo).toBe("ACCESO_DENEGADO");
      // El @PreAuthorize del controlador rechaza al estudiante antes del servicio: mensaje genérico.
      expect(r.cuerpo?.mensaje).toBe(MSG_403);
    });

    const pi = await sesion(abrirContexto, insB);
    await test.step(`3. Instructor B (UI): /cursos/${idA}/notas → «Solo puedes ver las notas de tus cursos.»`, async () => {
      let denegadas = 0;
      const oir = (r) => { if (r.url().includes("/api/") && r.status() === 403) denegadas++; };
      pi.on("response", oir);
      await pi.goto(`/cursos/${idA}/notas`);
      await expect(pi.getByText("Solo puedes ver las notas de tus cursos.")).toBeVisible();
      pi.off("response", oir);
      registrarEvento(insB.correo, "DENEGACION", Math.max(denegadas, 1));
    });
    await test.step(`4. Instructor B (API): GET ${ruta} → 403 ACCESO_DENEGADO`, async () => {
      const r = await pedir(pi, "GET", ruta, { token: await tokenDeSesion(pi) });
      registrarEvento(insB.correo, "DENEGACION");
      expect(r.status).toBe(403);
      expect(r.cuerpo?.codigo).toBe("ACCESO_DENEGADO");
      expect(r.cuerpo?.mensaje).toBe("Solo puedes ver las notas de tus cursos.");
    });

    await verificarAuditoria(abrirContexto, [
      { accion: "HTTP GET (403)", resultado: "Denegado", usuario: est.correo, recurso: ruta },
      { accion: "HTTP GET (403)", resultado: "Denegado", usuario: insB.correo, recurso: ruta, minimo: 2 },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU029-07
  test("CP-HU029-07 — Curso publicado sin inscritos @P1 @HU-029", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU029-07", tecnica: "partición", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.3" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "notvacio" });
    usuarioProbado(ins.correo);
    const curso = await armarCurso(abrirContexto, ins, {
      evaluaciones: [{ titulo: "Quiz sin inscritos", puntajeMaximo: 100, preguntas: [{ enunciado: "Pregunta sin inscritos", puntaje: 1 }] }],
    });
    const page = await test.step("1. Instructor → «Notas del curso»", () =>
      verNotas(abrirContexto, ins, curso, (p) => expect(p.getByText("Este curso aún no tiene estudiantes inscritos")).toBeVisible()));
    await test.step("Resultado: sin tabla; promedio «—», aprueban 0 y no aprueban 0", async () => {
      await expect(page.getByText("Cuando inscribas estudiantes, aquí verás sus notas.")).toBeVisible();
      await expect(tabla(page)).toHaveCount(0);
      expect(await indicadores(page)).toEqual({ promedio: "—", aprueban: "0", noAprueban: "0" });
    });
  });

  // ------------------------------------------------------------------ CP-HU029-09
  // Caso nuevo (decisión del usuario, 11/11/2026). CP-HU029-08 ya era «200 estudiantes» (Bloqueado).
  test("CP-HU029-09 — Formato de la nota con un decimal @P3 @HU-029", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU029-09", tecnica: "funcional", clasificacion: "Ruta Alterna",
      clase: "E2E-UI", referenciaPlan: "§7.12.2 (un decimal, HALF_UP); decisión del usuario 11/11/2026", defecto: "D-22" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "notins" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "notformato" });
    usuarioProbado(ins.correo);
    const Q60 = ["Formato 599 puntos", "Formato 1 punto", "Formato 400 puntos"];
    const Q59 = ["Límite 599 puntos", "Límite 401 puntos"];
    const curso = await armarCurso(abrirContexto, ins, {
      evaluaciones: [
        { titulo: "Quiz sesenta", puntajeMaximo: 100,
          preguntas: [{ enunciado: Q60[0], puntaje: 599 }, { enunciado: Q60[1], puntaje: 1 }, { enunciado: Q60[2], puntaje: 400 }] },
        { titulo: "Quiz cien", puntajeMaximo: 100, preguntas: [{ enunciado: "Formato pregunta única", puntaje: 1 }] },
        { titulo: "Quiz cincuenta y nueve", puntajeMaximo: 100,
          preguntas: [{ enunciado: Q59[0], puntaje: 599 }, { enunciado: Q59[1], puntaje: 401 }] },
      ],
      inscritos: [est],
    });
    await comoEstudiante(abrirContexto, est, curso, "obtiene 60,0 %, 100,0 % y 59,9 %", async (ep) => {
      await ep.presentarConAciertos("Quiz sesenta", [Q60[0], Q60[1]]);
      await ep.presentarConAciertos("Quiz cien", ["Formato pregunta única"]);
      await ep.presentarConAciertos("Quiz cincuenta y nueve", [Q59[0]]);
    });

    const page = await test.step("1. Instructor → «Notas del curso»", () =>
      verNotas(abrirContexto, ins, curso, (p) => expect(tabla(p)).toBeVisible()));
    await test.step("Resultado: toda nota se muestra con un decimal («60,0 %», «100,0 %», «59,9 %»)", async () => {
      const f = await fila(page, est.nombre);
      const ind = await indicadores(page);
      anotarFilas({ fila: f, indicadores: ind });
      const vistas = {
        "Quiz sesenta": f.actividades[0].texto, "Quiz cien": f.actividades[1].texto,
        "Quiz cincuenta y nueve": f.actividades[2].texto, "Nota final": f.final, "Promedio general": ind.promedio,
      };
      // Valores: 60,0 · 100,0 · 59,9 · final (60+100+59,9)/3 = 73,3 · promedio 73,3.
      expect(Object.values(vistas).map(pct)).toEqual([60.0, 100.0, 59.9, 73.3, 73.3]);
      const sinDecimal = Object.entries(vistas).filter(([, t]) => !/^\d+,\d %$/.test(t)).map(([k, t]) => `${k}: «${t}»`);
      expect(sinDecimal, "D-22: estas notas no se muestran con un decimal").toEqual([]);
    });
  });
});
