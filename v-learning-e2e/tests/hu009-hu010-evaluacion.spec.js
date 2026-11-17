import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cerrarSesion, cuentaLista } from "../support/sesiones.js";
import { armarCurso, estudianteListo, LECTURA, MODULO, sesion } from "../support/cursos.js";
import { marca } from "../support/datos.js";
import { EstudianteCursoPage } from "../pages/EstudianteCursoPage.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";

const base = { hu: "HU-009", rf: "RF-007" };
const UMBRAL_CORRECCION = U.s(2, "Corrección ≤ 2 s (§7.7, solo se registra)");
const MSG_PLAN_SIN_RED = "No se pudo guardar. Se volverá a intentar al cambiar de pregunta.";
const MSG_APP_SIN_RED = "No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.";

// OpcionCard agrega «Seleccionada» al nombre accesible de la opción marcada.
const opcion = (page, texto) => page.getByRole("radio", { name: new RegExp(`^${texto}( Seleccionada)?$`) });
const estadoGuardado = (page) => page.getByRole("main").getByRole("status").filter({ hasText: /Respuesta guardada|Guardando|No se pudo guardar|No pudimos conectar/ });

/** Instructor y estudiante desechables con un curso que tiene una evaluación de V/F. */
async function cursoConQuiz(abrirContexto, etiqueta, titulo, enunciados) {
  const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "evains" });
  const est = await cuentaLista(abrirContexto, { etiqueta });
  const curso = await armarCurso(abrirContexto, ins, {
    prefijo: "E2E-Eval",
    evaluaciones: [{ titulo, puntajeMaximo: 100, preguntas: enunciados.map((e) => ({ enunciado: e, puntaje: 10 })) }],
    inscritos: [est],
  });
  return { ins, est, curso };
}

test.describe("HU-009 · Evaluación interactiva (RF-007)", () => {
  // ------------------------------------------------------------------ CP-HU009-02
  test("CP-HU009-02 — Iniciar intento y guardado automático por respuesta @P1 @HU-009", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P1", caso: "CP-HU009-02", tecnica: "funcional", clasificacion: "Ruta Crítica",
      clase: "E2E-UI", referenciaPlan: "§7.3; TC-EVAL-01",
      ajuste: "«Tus respuestas se guardan solas al responder cada pregunta.» solo sale en el aviso de los 2 últimos minutos de una evaluación con tiempo; sin límite se valida el subtítulo de /evaluaciones («Tus respuestas se guardan solas.»). «Guardando…» es transitorio: se valida el estado final «Respuesta guardada» tras el PUT 200" });
    const P = ["Guardado: primera pregunta", "Guardado: segunda pregunta"];
    const { est, curso } = await cursoConQuiz(abrirContexto, "evaguarda", "Quiz guardado", P);
    usuarioProbado(est.correo);
    const { page, ep } = await estudianteListo(abrirContexto, est, curso);

    await test.step("1. /evaluaciones: «Tus respuestas se guardan solas.»", async () => {
      await page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Evaluaciones" }).click();
      await expect(page.getByText(/Tus respuestas se guardan solas\./).first()).toBeVisible();
    });
    const intentoId = await test.step("2. «Comenzar Quiz guardado» abre el intento", () => ep.abrirEvaluacion("Quiz guardado", "Comenzar"));
    await test.step("3. Responder la 1.ª pregunta → «Respuesta guardada»", async () => {
      expect(await ep.responder("Verdadero")).toBe(200);
      await expect(estadoGuardado(page)).toHaveText("Respuesta guardada");
      await expect(opcion(page, "Verdadero")).toHaveAttribute("aria-checked", "true");
    });
    // D-24 (hallazgo, 11/11/2026): al recargar /intentos/<id> la pantalla se pinta con el estado de
    // navegación viejo (sin las respuestas guardadas). No es parte de este caso del plan; ver ESTADO.md.
    await verificarAuditoria(abrirContexto, {
      accion: "INTENTO_INICIADO", resultado: "Permitido", usuario: est.correo, recurso: `evaluaciones/${curso.evaluaciones["Quiz guardado"]}`,
    });
    test.info().annotations.push({ type: "intento", description: String(intentoId) });
  });

  // ------------------------------------------------------------------ CP-HU009-01
  test("CP-HU009-01 — Reanudar la evaluación en otra sesión @P1 @HU-009", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P1", caso: "CP-HU009-01", tecnica: "estado", clasificacion: "Ruta Crítica",
      clase: "E2E-UI", referenciaPlan: "§7.14; TC-EVAL-01; estado EN_PROGRESO" });
    const P = ["Reanudar: primera pregunta", "Reanudar: segunda pregunta"];
    const { est, curso } = await cursoConQuiz(abrirContexto, "evareanuda", "Quiz reanudar", P);
    usuarioProbado(est.correo);

    const { page, ep } = await estudianteListo(abrirContexto, est, curso);
    const intentoId = await test.step("1. Iniciar y responder una pregunta", async () => {
      const id = await ep.abrirEvaluacion("Quiz reanudar", "Comenzar");
      await ep.irAPregunta(P[0]);
      expect(await ep.responder("Verdadero")).toBe(200);
      await expect(estadoGuardado(page)).toHaveText("Respuesta guardada");
      return id;
    });
    await test.step("2. Cerrar el contexto del navegador sin terminar", () => page.context().close());

    const p2 = await test.step("3. Contexto nuevo: login", () => sesion(abrirContexto, est));
    const ep2 = new EstudianteCursoPage(p2);
    await test.step("4. Volver a la evaluación: «Reanudar» → «Retomaste tu intento donde lo dejaste.» con la respuesta marcada", async () => {
      expect(await ep2.abrirEvaluacion("Quiz reanudar", "Reanudar")).toBe(intentoId);
      await expect(p2.getByText("Retomaste tu intento donde lo dejaste.")).toBeVisible();
      await ep2.irAPregunta(P[0]);
      await expect(opcion(p2, "Verdadero")).toHaveAttribute("aria-checked", "true");
    });
    await test.step("5. Responder la otra y terminar: se corrige", async () => {
      await ep2.irAPregunta(P[1]);
      expect(await ep2.responder("Verdadero")).toBe(200);
      await p2.getByRole("navigation", { name: "Ir a una pregunta" }).getByRole("button").last().click();
      await p2.getByRole("button", { name: "Terminar evaluación" }).click();
      await medir("corrección al terminar", UMBRAL_CORRECCION,
        () => p2.getByRole("dialog", { name: "¿Terminar la evaluación?" }).getByRole("button", { name: "Sí, terminar" }).click(),
        () => expect(p2.getByRole("heading", { name: "Detalle por pregunta" })).toBeVisible());
      const det = await ep2.detalle();
      test.info().annotations.push({ type: "detalle", description: JSON.stringify(det) });
      expect(det[P[0]]).toMatchObject({ tuRespuesta: "Verdadero", obtenido: 10, puntaje: 10 });
      expect(det[P[1]]).toMatchObject({ tuRespuesta: "Verdadero", obtenido: 10, puntaje: 10 });
      await expect(p2.getByText("100 de 100 puntos")).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, {
      accion: "INTENTO_FINALIZADO", resultado: "Permitido", usuario: est.correo, recurso: `intentos/${intentoId}`,
    });
  });

  // ------------------------------------------------------------------ CP-HU009-03
  test("CP-HU009-03 — Corrección por tipo de pregunta @P1 @HU-009", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, prioridad: "P1", caso: "CP-HU009-03", tecnica: "partición", clasificacion: "Ruta Crítica",
      clase: "E2E-UI", referenciaPlan: "§7.3; §7.13 CC-01, CC-02, CC-03, CC-05, CC-06, CC-07, CD-01, CP-05, CP-06, CP-07" });
    const Q = {
      U: "Única: lenguaje que corre en la JVM",
      VF: "V/F: la JVM ejecuta bytecode",
      M: "Múltiple: lenguajes con tipado estático",
      A: "Abierta: paradigma principal de Java",
    };
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "evains" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "evatipos" });
    usuarioProbado(est.correo);
    const curso = await armarCurso(abrirContexto, ins, {
      prefijo: "E2E-Eval",
      evaluaciones: [{ titulo: "Quiz tipos", puntajeMaximo: 40, preguntas: [
        { enunciado: Q.U, puntaje: 10, tipo: "UNICA", opciones: [{ texto: "Java", correcta: true }, { texto: "Bash", correcta: false }, { texto: "HTML", correcta: false }] },
        { enunciado: Q.VF, puntaje: 10 },
        { enunciado: Q.M, puntaje: 10, tipo: "MULTIPLE", opciones: [{ texto: "Java", correcta: true }, { texto: "C#", correcta: true }, { texto: "Python", correcta: false }] },
        { enunciado: Q.A, puntaje: 10, tipo: "ABIERTA", aceptadas: ["Programación orientada a objetos"] },
      ] }],
      inscritos: [est],
    });
    const { page, ep } = await estudianteListo(abrirContexto, est, curso);

    /** Un intento: responde lo indicado (null = sin responder), termina y devuelve el detalle. */
    const intento = async (respuestas) => {
      await ep.abrirEvaluacion("Quiz tipos");
      for (const [clave, valor] of Object.entries(respuestas)) {
        if (valor === null) continue;
        await ep.irAPregunta(Q[clave]);
        expect(await ep.responder(valor)).toBe(200);
      }
      await ep.terminar();
      return ep.detalle();
    };

    await test.step("1. Única correcta; V/F correcta; múltiple con 1 de 2 correctas; abierta «programacion orientada a objetos!» → 10 / 10 / 5 / 10", async () => {
      const det = await intento({ U: "Java", VF: "Verdadero", M: ["Java"], A: { abierta: "programacion orientada a objetos!" } });
      test.info().annotations.push({ type: "detalleIntento1", description: JSON.stringify(det) });
      test.info().annotations.push({ type: "porcentajeVisto", description: await page.locator("p.text-4xl").first().innerText() });
      expect([det[Q.U].obtenido, det[Q.VF].obtenido, det[Q.M].obtenido, det[Q.A].obtenido]).toEqual([10, 10, 5, 10]);
      await expect(page.getByText("35 de 40 puntos")).toBeVisible();
    });
    await test.step("2. Variantes: múltiple «1,2,3» → 5; abierta errada → 0; única sin responder → «Sin responder», 0", async () => {
      const det = await intento({ U: null, VF: "Verdadero", M: ["Java", "C#", "Python"], A: { abierta: "programacion funcional" } });
      test.info().annotations.push({ type: "detalleIntento2", description: JSON.stringify(det) });
      expect(det[Q.M].obtenido).toBe(5);
      expect(det[Q.A].obtenido).toBe(0);
      expect(det[Q.U]).toMatchObject({ tuRespuesta: "Sin responder", obtenido: 0 });
      await expect(page.getByText("15 de 40 puntos")).toBeVisible();
    });
    await test.step("3. Variante: múltiple con solo la incorrecta → 0 (nunca negativo)", async () => {
      const det = await intento({ U: null, VF: null, M: ["Python"], A: null });
      test.info().annotations.push({ type: "detalleIntento3", description: JSON.stringify(det) });
      expect(det[Q.M].obtenido).toBe(0);
      await expect(page.getByText("0 de 40 puntos")).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, {
      accion: "INTENTO_FINALIZADO", resultado: "Permitido", usuario: est.correo, recursoContiene: "intentos/", minimo: 3,
    });
  });

  // ------------------------------------------------------------------ CP-HU009-08
  test("CP-HU009-08 — Interrupción de red durante la evaluación @P1 @HU-009", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P1", caso: "CP-HU009-08", tecnica: "estado", clasificacion: "Ruta Alterna",
      clase: "Con ajuste", referenciaPlan: "TC-EVAL-01", defecto: "D-23",
      ajuste: "La desconexión se emula con context.setOffline (decisión 4), no con page.route; la conexión se restaura dentro del caso" });
    const P = ["Red: primera pregunta", "Red: segunda pregunta"];
    const { est, curso } = await cursoConQuiz(abrirContexto, "evared", "Quiz red", P);
    usuarioProbado(est.correo);
    const { page, ep } = await estudianteListo(abrirContexto, est, curso);
    const ctx = page.context();

    await ep.abrirEvaluacion("Quiz red", "Comenzar");
    await test.step("1. Responder la 1.ª pregunta con conexión", async () => {
      await ep.irAPregunta(P[0]);
      expect(await ep.responder("Verdadero")).toBe(200);
      await expect(estadoGuardado(page)).toHaveText("Respuesta guardada");
    });
    try {
      await test.step("2. context.setOffline(true) → responder la 2.ª: aviso de que no se pudo guardar", async () => {
        await ep.irAPregunta(P[1]);
        await ctx.setOffline(true);
        expect(await ep.responder("Verdadero")).toBe("SIN_RED");
        await expect(estadoGuardado(page)).not.toHaveText(/Guardando|Respuesta guardada/);
        const visto = (await estadoGuardado(page).innerText()).trim();
        test.info().annotations.push({ type: "avisoSinRed", description: visto });
        expect([MSG_PLAN_SIN_RED, MSG_APP_SIN_RED], `Aviso sin red: «${visto}»`).toContain(visto);
      });
    } finally {
      await ctx.setOffline(false);
    }
    await test.step("3. Volver a conectar y cambiar de pregunta: la respuesta pendiente se guarda («Respuesta guardada»)", async () => {
      const puts = [];
      const oir = (r) => { if (r.request().method() === "PUT" && /\/api\/intentos\/\d+\/respuestas\/\d+$/.test(r.url())) puts.push(r.status()); };
      page.on("response", oir);
      await ep.irAPregunta(P[0]);
      await ep.irAPregunta(P[1]);
      await page.waitForTimeout(1500); // margen para un reintento en segundo plano (solo se observa)
      page.off("response", oir);
      test.info().annotations.push({ type: "reintentosAlCambiar", description: JSON.stringify(puts) });
      // D-23: soft, para que el paso siguiente muestre si la respuesta pendiente se perdió.
      await expect.soft(estadoGuardado(page), "D-23: no reintenta el guardado al cambiar de pregunta").toHaveText("Respuesta guardada");
      expect.soft(puts.length, "D-23: ningún PUT de reintento al cambiar de pregunta").toBeGreaterThan(0);
    });
    await test.step("Resultado: al terminar, las dos respuestas cuentan y no hay duplicados", async () => {
      await ep.terminar();
      const det = await ep.detalle();
      test.info().annotations.push({ type: "detalle", description: JSON.stringify(det) });
      expect(Object.keys(det)).toHaveLength(2);
      expect(det[P[0]]).toMatchObject({ tuRespuesta: "Verdadero", obtenido: 10 });
      expect(det[P[1]]).toMatchObject({ tuRespuesta: "Verdadero", obtenido: 10 });
    });
  });
});

// =================================================================== P2 y P3 de HU-009

/** Fila de una evaluación en /evaluaciones (menú lateral). */
async function filaEvaluacion(page, titulo) {
  await page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Evaluaciones" }).click();
  const li = page.getByRole("listitem").filter({ has: page.getByText(titulo, { exact: true }) });
  await expect(li).toHaveCount(1);
  return li;
}

/** Texto del cronómetro («Tiempo restante: mm:ss») → segundos. */
async function segundosDelReloj(page) {
  const reloj = page.getByText("Tiempo restante:", { exact: false }).locator("..");
  await expect(reloj).toBeVisible();
  const texto = (await reloj.innerText()).replace(/\s+/g, " ").trim();
  const m = texto.match(/(\d{2}):(\d{2})$/);
  expect(m, `cronómetro «${texto}»`).toBeTruthy();
  return { texto, segundos: Number(m[1]) * 60 + Number(m[2]) };
}

test.describe("HU-009 · Evaluación interactiva, P2 y P3 (RF-007, RF-041, RF-042)", () => {
  // ------------------------------------------------------------------ CP-HU009-04
  test("CP-HU009-04 — Historial de intentos: repetir conserva el historial @P2 @HU-009", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU009-04", tecnica: "estado", clasificacion: "Ruta Alterna",
      clase: "E2E-UI", referenciaPlan: "§7.3; §7.12.4" });
    const P = ["Historial: primera pregunta", "Historial: segunda pregunta"];
    const { est, curso } = await cursoConQuiz(abrirContexto, "evahist", "Quiz historial", P);
    usuarioProbado(est.correo);
    const { page, ep } = await estudianteListo(abrirContexto, est, curso);
    await test.step("Precondición: un intento finalizado con 1 de 2 (50 %)", async () => {
      await ep.presentarConAciertos("Quiz historial", [P[0]]);
      await expect(page.getByText(/^50(.0+)? de 100 puntos$/)).toBeVisible();
    });
    await test.step("1. «Intentar de nuevo» (en el resultado) → terminar con 2 de 2", async () => {
      await page.getByRole("button", { name: "Intentar de nuevo" }).click();
      await expect(page).toHaveURL(/\/intentos\/\d+$/);
      for (const e of P) {
        await ep.irAPregunta(e);
        expect(await ep.responder("Verdadero")).toBe(200);
      }
      await ep.terminar();
      await expect(page.getByText(/^100(.0+)? de 100 puntos$/)).toBeVisible();
    });
    await test.step("Resultado: «Mejoraste respecto a tu mejor resultado anterior (50 %).»", async () => {
      await expect(page.getByText("Mejoraste respecto a tu mejor resultado anterior (50 %).")).toBeVisible();
    });
    await test.step("Resultado: /evaluaciones muestra «2 intentos» y «Mejor resultado: 100 %»", async () => {
      const li = await filaEvaluacion(page, "Quiz historial");
      const texto = (await li.innerText()).replace(/\s+/g, " ");
      test.info().annotations.push({ type: "filaEvaluacion", description: texto });
      await expect(li.getByText("2 intentos", { exact: true })).toBeVisible();
      await expect(li.getByText("Mejor resultado: 100 %")).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, {
      accion: "INTENTO_INICIADO", resultado: "Permitido", usuario: est.correo,
      recurso: `evaluaciones/${curso.evaluaciones["Quiz historial"]}`, minimo: 2,
    });
  });

  // ------------------------------------------------------------------ CP-HU009-05
  test("CP-HU009-05 — Un intento finalizado no admite respuestas @P2 @HU-009", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU009-05", tecnica: "estado", clasificacion: "Ruta Alterna",
      clase: "E2E-UI", referenciaPlan: "§7.12.4" });
    const P = ["Cerrado: primera pregunta", "Cerrado: segunda pregunta"];
    const { est, curso } = await cursoConQuiz(abrirContexto, "evacerr", "Quiz cerrado", P);
    usuarioProbado(est.correo);
    const { page, ep } = await estudianteListo(abrirContexto, est, curso);
    const id = await test.step("Precondición: un intento finalizado", () => ep.presentarConAciertos("Quiz cerrado", [P[0]]));
    await test.step(`1. page.goto('/intentos/${id}') → «Este intento ya terminó.» (o redirección al resultado)`, async () => {
      const puts = [];
      const oir = (r) => { if (r.request().method() === "PUT" && new RegExp(`/api/intentos/${id}/respuestas/\\d+$`).test(r.url())) puts.push(r.status()); };
      page.on("response", oir);
      await page.goto(`/intentos/${id}`);
      const terminado = page.getByText("Este intento ya terminó.").first();
      const resultado = page.getByRole("heading", { name: "Detalle por pregunta" });
      const pregunta = page.getByText(/^Pregunta \d+ de \d+$/);
      await expect(terminado.or(resultado).or(pregunta)).toBeVisible();
      if (await pregunta.isVisible()) {
        // La pantalla del intento se abre otra vez: se intenta responder, como lo haría la persona.
        test.info().annotations.push({ type: "alAbrir", description: `Se ve la pantalla del intento en ${page.url()}` });
        const enunciado = (await page.getByRole("main").getByRole("heading", { level: 2 }).first().innerText()).trim();
        const r = page.waitForResponse((x) => x.request().method() === "PUT" && /\/api\/intentos\/\d+\/respuestas\/\d+$/.test(x.url()));
        await opcion(page, "Falso").click();
        const resp = await r;
        test.info().annotations.push({ type: "putAlResponder", description: `${new URL(resp.url()).pathname} → ${resp.status()} (${enunciado})` });
      }
      page.off("response", oir);
      await expect(terminado.or(resultado)).toBeVisible();
      expect(puts.filter((s) => s < 400), "ninguna respuesta se guarda en el intento terminado").toEqual([]);
    });
    await test.step("Resultado: el intento conserva su resultado (50 de 100 puntos)", async () => {
      await page.goto(`/intentos/${id}/resultado`);
      await expect(page.getByText(/^50(.0+)? de 100 puntos$/)).toBeVisible();
    });
  });

  // ------------------------------------------------------------------ CP-HU009-06
  test("CP-HU009-06 — Tiempo adicional y ampliación para perfil motor @P2 @HU-009", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, rf: "RF-007, RF-041, RF-042", prioridad: "P2", caso: "CP-HU009-06", tecnica: "decisión", clasificacion: "Ruta Alterna",
      clase: "E2E-UI", referenciaPlan: "HU-009 + HU-022 + RF-041 + RF-042",
      ajuste: "«Ampliar tiempo» solo aparece con 2 minutos o menos: se comprueba el reloj de 15 min en la evaluación de 10 min y la ampliación en otra evaluación de 1 min (1,5x → 2 min) para no esperar 13 min. La acomodación da además 5 «Minutos que puede pedir…», sin los cuales no hay botón" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "evains" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "evamotor", categorias: ["Motora"] });
    usuarioProbado(est.correo);
    const Q10 = "Quiz 10 minutos", Q1 = "Quiz 1 minuto";
    const curso = await armarCurso(abrirContexto, ins, {
      prefijo: "E2E-Eval",
      evaluaciones: [
        { titulo: Q10, puntajeMaximo: 100, tiempoLimite: 10, preguntas: [{ enunciado: "Tiempo: pregunta única", puntaje: 10 }] },
        { titulo: Q1, puntajeMaximo: 100, tiempoLimite: 1, preguntas: [{ enunciado: "Ampliar: pregunta única", puntaje: 10 }] },
      ],
      inscritos: [est],
    });
    await test.step("Precondición: el instructor asigna la acomodación 1,5x (y 5 min de ampliación) en «Notas del curso»", async () => {
      const pi = await sesion(abrirContexto, ins);
      const ed = new CursosInstructorPage(pi);
      await ed.ir();
      await ed.abrirEditor(curso.titulo);
      await ed.abrirNotas();
      await ed.asignarAcomodacion(est.nombre, { multiplicador: "1,5x (50 % más de tiempo)", ampliacion: 5 });
      await expect(pi.getByText(/^Acomodación:/).first()).toBeVisible();
      await cerrarSesion(pi);
      await pi.context().close();
    });
    const { page, ep } = await estudianteListo(abrirContexto, est, curso);
    await test.step(`1. Iniciar «${Q10}»: el reloj «Tiempo restante:» parte de 15 min`, async () => {
      const li = await filaEvaluacion(page, Q10);
      await expect(li.getByText("15 min", { exact: true })).toBeVisible();
      await ep.abrirEvaluacion(Q10, "Comenzar");
      const r = await segundosDelReloj(page);
      test.info().annotations.push({ type: "relojAlIniciar", description: r.texto });
      expect(r.segundos).toBeGreaterThan(14 * 60 + 45);
      expect(r.segundos).toBeLessThanOrEqual(15 * 60);
      await expect(page.getByRole("button", { name: /^Ampliar tiempo/ })).toHaveCount(0);
    });
    await test.step(`2. Iniciar «${Q1}» (2 min con 1,5x) → «Ampliar tiempo (+5 min)» → «Ampliamos tu tiempo. Ahora terminas a las …»`, async () => {
      await ep.abrirEvaluacion(Q1, "Comenzar");
      const antes = await segundosDelReloj(page);
      test.info().annotations.push({ type: "relojQuiz1", description: antes.texto });
      expect(antes.segundos).toBeLessThanOrEqual(120);
      expect(antes.segundos).toBeGreaterThan(100);
      await expect(page.getByText("Quedan 2 minutos o menos.")).toBeVisible();
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/intentos\/\d+\/ampliar$/.test(new URL(r.url()).pathname));
      await page.getByRole("button", { name: "Ampliar tiempo (+5 min)" }).click();
      expect((await resp).status()).toBe(200);
      const aviso = page.getByText(/^Ampliamos tu tiempo\. Ahora terminas a las .+\.$/).first();
      await expect(aviso).toBeVisible();
      test.info().annotations.push({ type: "avisoAmpliacion", description: (await aviso.innerText()).trim() });
      const despues = await segundosDelReloj(page);
      expect(despues.segundos).toBeGreaterThan(6 * 60);
      await expect(page.getByRole("button", { name: /^Ampliar tiempo/ })).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "ACOMODACION_ASIGNADA", resultado: "Permitido", usuario: ins.correo, recursoContiene: `cursos/${curso.id}/estudiantes/` },
      { accion: "INTENTO_AMPLIADO", resultado: "Permitido", usuario: est.correo, recursoContiene: /^intentos\/\d+ \+5 min$/ },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU009-07
  test("CP-HU009-07 — Tiempo agotado @P3 @HU-009", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU009-07", tecnica: "límite", clasificacion: "Ruta Alterna",
      clase: "E2E-UI", referenciaPlan: "Adicional (RF-007)",
      ajuste: "D-30 (solo hallazgo, decisión del usuario): la UI no muestra «Se acabó el tiempo. Calificamos lo que alcanzaste a responder.»; se valida que termine sola y califique lo respondido, y se anota si aparece el texto" });
    // D-30 (solo hallazgo): al llegar a 0 el cronómetro llama a finalizar() y abre el resultado normal; «Se acabó el tiempo…»
    // solo existe como 409 TIEMPO_AGOTADO del backend (al guardar o ampliar tarde), así que la UI no lo muestra.
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "evains" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "evatiempo" });
    usuarioProbado(est.correo);
    const P = ["Agotado: primera pregunta", "Agotado: segunda pregunta"];
    const curso = await armarCurso(abrirContexto, ins, {
      prefijo: "E2E-Eval",
      evaluaciones: [{ titulo: "Quiz 1 minuto", puntajeMaximo: 100, tiempoLimite: 1, preguntas: P.map((e) => ({ enunciado: e, puntaje: 10 })) }],
      inscritos: [est],
    });
    const { page, ep } = await estudianteListo(abrirContexto, est, curso);
    const id = await test.step("1. Iniciar y responder solo la 1.ª pregunta", async () => {
      const i = await ep.abrirEvaluacion("Quiz 1 minuto", "Comenzar");
      const r = await segundosDelReloj(page);
      test.info().annotations.push({ type: "relojAlIniciar", description: r.texto });
      await ep.irAPregunta(P[0]);
      expect(await ep.responder("Verdadero")).toBe(200);
      return i;
    });
    await test.step("2. Esperar 65 s sin terminar", async () => {
      await page.waitForTimeout(65_000);
      test.info().annotations.push({ type: "urlTrasEsperar", description: new URL(page.url()).pathname });
    });
    await test.step("Resultado: se califica lo respondido (50 de 100 puntos)", async () => {
      await expect(page).toHaveURL(new RegExp(`/intentos/${id}/resultado$`));
      const det = await ep.detalle();
      test.info().annotations.push({ type: "detalle", description: JSON.stringify(det) });
      expect(det[P[0]]).toMatchObject({ tuRespuesta: "Verdadero", obtenido: 10 });
      expect(det[P[1]]).toMatchObject({ tuRespuesta: "Sin responder", obtenido: 0 });
    });
    await test.step("Resultado: aviso de tiempo agotado (D-30, solo se anota)", async () => {
      const visto = await page.getByText("Se acabó el tiempo. Calificamos lo que alcanzaste a responder.").count();
      test.info().annotations.push({ type: "avisoTiempoAgotado", description: visto ? "visible" : "no aparece (D-30)" });
    });
    await verificarAuditoria(abrirContexto, {
      accion: "INTENTO_FINALIZADO", resultado: "Permitido", usuario: est.correo, recurso: `intentos/${id}`,
    });
  });
});

// =================================================================== HU-010

const base10 = { hu: "HU-010", rf: "RF-008", prioridad: "P2" };
const UMBRAL_CLASIF = U.s(1, "Clasificación < 1 s después del puntaje (§7.3, solo se registra)");
const MODULO_SIN = "Módulo sin recursos";
const MSG_REFUERZO = "Este tema todavía necesita refuerzo, y está bien: puedes repetir la evaluación cuando quieras. Empieza por estos materiales.";
const MSG_SIN_RECURSOS = "Repasa los apuntes del módulo e inténtalo de nuevo cuando te sientas listo o lista.";

/**
 * Evaluaciones de 2 preguntas V/F (puntaje máximo 100) cuyos pesos dan exactamente cada porcentaje
 * al responder solo la primera, solo la segunda, ninguna o las dos.
 */
const PESOS = { "Quiz 30-70": [3000, 7000], "Quiz 59,99": [5999, 4001], "Quiz 60": [6000, 4000],
  "Quiz 84,99": [8499, 1501], "Quiz 85": [8500, 1500], "Quiz 90": [9000, 1000] };
const enunciado = (quiz, n) => `${quiz} · pregunta ${n} de ${PESOS[quiz]?.[n - 1] ?? 5} puntos`;
const LIMITES = [
  { pct: "0", quiz: "Quiz 30-70", aciertos: [], clase: "Insuficiente" },
  { pct: "30", quiz: "Quiz 30-70", aciertos: [1], clase: "Insuficiente" },
  { pct: "59,99", quiz: "Quiz 59,99", aciertos: [1], clase: "Insuficiente" },
  { pct: "60", quiz: "Quiz 60", aciertos: [1], clase: "Aceptable" },
  { pct: "70", quiz: "Quiz 30-70", aciertos: [2], clase: "Aceptable" },
  { pct: "84,99", quiz: "Quiz 84,99", aciertos: [1], clase: "Aceptable" },
  { pct: "85", quiz: "Quiz 85", aciertos: [1], clase: "Excelente" },
  { pct: "90", quiz: "Quiz 90", aciertos: [1], clase: "Excelente" },
  { pct: "100", quiz: "Quiz 30-70", aciertos: [1, 2], clase: "Excelente" },
];

/**
 * Curso de HU-010, armado por la UI la primera vez que se pide: instructor desechable; «Módulo E2E»
 * con la lectura y las evaluaciones de PESOS; «Módulo sin recursos» sin contenidos y con «Quiz sin
 * recursos» (2 preguntas de 5). Un estudiante desechable, inscrito por el instructor, completa la
 * lectura y presenta todas las evaluaciones (cada caso abre su propia sesión).
 */
let cursoClasif = null;
async function cursoHu010(abrirContexto) {
  if (cursoClasif) return cursoClasif;
  const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "clasins" });
  const est = await cuentaLista(abrirContexto, { etiqueta: "clasest" });
  const curso = await test.step("Precondición: el instructor arma el curso de clasificación por la UI", async () => {
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const c = { titulo: `E2E-Clasif-${marca()}`, evaluaciones: {} };
    await ed.ir();
    c.id = await ed.crearCurso(c.titulo, "Curso de las pruebas E2E de clasificación y retroalimentación.");
    await ed.abrirEditor(c.titulo);
    await ed.crearModulo(MODULO);
    await ed.crearLecturaPublicada(MODULO, LECTURA, "Lectura corta de las pruebas E2E de clasificación. Sirve de material de refuerzo.");
    for (const [quiz, [a, b]] of Object.entries(PESOS)) {
      c.evaluaciones[quiz] = await ed.crearEvaluacion(MODULO, quiz, { puntajeMaximo: 100,
        preguntas: [{ enunciado: enunciado(quiz, 1), puntaje: a }, { enunciado: enunciado(quiz, 2), puntaje: b }] });
    }
    await ed.crearModulo(MODULO_SIN);
    c.evaluaciones["Quiz sin recursos"] = await ed.crearEvaluacion(MODULO_SIN, "Quiz sin recursos", { puntajeMaximo: 100,
      preguntas: [{ enunciado: enunciado("Quiz sin recursos", 1), puntaje: 5 }, { enunciado: enunciado("Quiz sin recursos", 2), puntaje: 5 }] });
    await ed.publicarCurso();
    await ed.inscribir([est.correo]);
    await cerrarSesion(page);
    await page.context().close();
    return c;
  });
  await test.step("Precondición: el estudiante completa la lectura", async () => {
    const page = await sesion(abrirContexto, est);
    await new EstudianteCursoPage(page).completarLectura(curso.titulo, LECTURA);
    await cerrarSesion(page);
    await page.context().close();
  });
  cursoClasif = { ins, est, curso };
  return cursoClasif;
}

/**
 * Presenta `quiz` respondiendo «Verdadero» solo en las preguntas `aciertos` (1 y/o 2) y mide desde
 * «Sí, terminar» hasta ver la clasificación. Devuelve { id, porcentaje, puntos, clase, mensaje }.
 */
async function presentarYMedir(page, ep, quiz, aciertos) {
  const id = await ep.abrirEvaluacion(quiz);
  for (const n of aciertos) {
    await ep.irAPregunta(enunciado(quiz, n));
    expect(await ep.responder("Verdadero")).toBe(200);
  }
  await page.getByRole("navigation", { name: "Ir a una pregunta" }).getByRole("button").last().click();
  await page.getByRole("button", { name: "Terminar evaluación" }).click();
  const tarjeta = page.getByRole("main").locator("p.text-4xl").locator("..");
  await medir("clasificación tras el puntaje", UMBRAL_CLASIF,
    () => page.getByRole("dialog", { name: "¿Terminar la evaluación?" }).getByRole("button", { name: "Sí, terminar" }).click(),
    () => expect(tarjeta.getByText(/^(Insuficiente|Aceptable|Excelente)$/i)).toBeVisible());
  await expect(page).toHaveURL(new RegExp(`/intentos/${id}/resultado$`));
  const puntos = (await tarjeta.getByText(/ de 100 puntos$/).innerText()).trim();
  return {
    id,
    porcentaje: (await tarjeta.locator("p.text-4xl").innerText()).trim(),
    puntos,
    clase: (await tarjeta.getByText(/^(Insuficiente|Aceptable|Excelente)$/i).innerText()).trim(),
    mensaje: (await tarjeta.locator("p.text-lg").innerText()).trim(),
  };
}

test.describe("HU-010 · Retroalimentación (RF-008)", () => {
  for (const l of LIMITES) {
    // ---------------------------------------------------------------- CP-HU010-01 (parametrizado)
    test(`CP-HU010-01 — Clasificación en el límite ${l.pct} % → ${l.clase} @P2 @HU-010`, async ({ abrirContexto }) => {
      test.setTimeout(15 * 60_000);
      caso({ ...base10, caso: "CP-HU010-01", tecnica: "límite", clasificacion: "Ruta Crítica", clase: "E2E-UI",
        referenciaPlan: "§7.3; §7.12.1; §7.12.2",
        ajuste: `${l.quiz} con pesos ${PESOS[l.quiz].join("/")} sobre puntaje máximo 100; se responde ${l.aciertos.length ? `la pregunta ${l.aciertos.join(" y ")}` : "ninguna"}. D-22: el porcentaje grande se ve redondeado a entero; se compara el puntaje («N de 100 puntos»)` });
      const { est } = await cursoHu010(abrirContexto);
      usuarioProbado(est.correo);
      const page = await sesion(abrirContexto, est);
      const ep = new EstudianteCursoPage(page);
      const r = await test.step(`1. Presentar «${l.quiz}» respondiendo ${l.aciertos.length ? l.aciertos.join(" y ") : "ninguna"} → terminar`, () =>
        presentarYMedir(page, ep, l.quiz, l.aciertos));
      test.info().annotations.push({ type: "resultadoVisto", description: JSON.stringify(r) });
      await test.step(`Resultado: ${l.pct} de 100 puntos y «${l.clase}»`, async () => {
        const n = Number(r.puntos.match(/^([\d.,]+) de 100 puntos$/)[1].replace(",", "."));
        expect(n).toBe(Number(l.pct.replace(",", ".")));
        expect(r.clase.toLowerCase()).toBe(l.clase.toLowerCase());
      });
      await verificarAuditoria(abrirContexto, { accion: "INTENTO_FINALIZADO", resultado: "Permitido", usuario: est.correo, recurso: `intentos/${r.id}` });
    });
  }

  // ------------------------------------------------------------------ CP-HU010-02
  test("CP-HU010-02 — Recomendaciones de refuerzo @P2 @HU-010", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base10, caso: "CP-HU010-02", tecnica: "decisión", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const { est } = await cursoHu010(abrirContexto);
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    const ep = new EstudianteCursoPage(page);
    const r = await test.step("1. Resultado Insuficiente en un módulo con materiales («Quiz 30-70», solo la 1.ª: 30 %)", () =>
      presentarYMedir(page, ep, "Quiz 30-70", [1]));
    await test.step("Resultado: mensaje de refuerzo y sección «Para reforzar» con la lectura del módulo", async () => {
      expect(r.clase.toLowerCase()).toBe("insuficiente");
      expect(r.mensaje).toBe(MSG_REFUERZO);
      const seccion = page.getByRole("region", { name: "Para reforzar" });
      await expect(seccion).toBeVisible();
      const items = seccion.getByRole("listitem");
      test.info().annotations.push({ type: "materiales", description: JSON.stringify(await items.allInnerTexts()) });
      await expect(items.getByRole("link", { name: LECTURA, exact: true })).toBeVisible();
    });
  });

  // ------------------------------------------------------------------ CP-HU010-03
  test("CP-HU010-03 — Mensaje genérico sin recursos de refuerzo @P2 @HU-010", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base10, caso: "CP-HU010-03", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const { est } = await cursoHu010(abrirContexto);
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    const ep = new EstudianteCursoPage(page);
    const r = await test.step(`1. Resultado Insuficiente en «${MODULO_SIN}» (sin contenidos): «Quiz sin recursos» sin responder`, () =>
      presentarYMedir(page, ep, "Quiz sin recursos", []));
    await test.step("Resultado: «Repasa los apuntes del módulo e inténtalo de nuevo cuando te sientas listo o lista…» y sin «Para reforzar»", async () => {
      expect(r.clase.toLowerCase()).toBe("insuficiente");
      expect(r.mensaje.startsWith(MSG_SIN_RECURSOS), `mensaje «${r.mensaje}»`).toBeTruthy();
      await expect(page.getByRole("region", { name: "Para reforzar" })).toHaveCount(0);
    });
  });
});
