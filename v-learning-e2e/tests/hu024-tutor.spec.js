import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { cfg } from "../support/config.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cuentaLista } from "../support/sesiones.js";
import { escribir } from "../support/humano.js";
import { sesion, MODULO } from "../support/cursos.js";
import { cerrarSesion } from "../support/sesiones.js";
import { marca } from "../support/datos.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";

const base = { hu: "HU-024", rf: "RF-024", prioridad: "P2" };
/** D-39 (diferencia): texto real del 503 TUTOR_NO_DISPONIBLE; el plan decía «El Tutor IA no está disponible ahora. Puedes seguir con tus contenidos.». */
const MSG_NO_DISPONIBLE = "El tutor no está disponible en este momento. Intenta de nuevo en unos minutos o escribe a tu instructor.";
const TECNICO = /\b(503|TUTOR_NO_DISPONIBLE|Ollama|excepci[oó]n|exception|error \d{3}|stack|localhost|http)\b/i;
const PREGUNTA = "¿Qué es una variable en programación?";

/** Panel del Tutor IA (aside «Tutor IA»), abierto con Alt+T o con el botón flotante. */
const panel = (page) => page.getByRole("complementary", { name: "Tutor IA" });
const campo = (page) => panel(page).getByLabel("Escribe tu pregunta para el Tutor IA");
const enviarBtn = (page) => panel(page).getByRole("button", { name: "Enviar pregunta" });

/** Peticiones de consulta al tutor (solo se observan, nunca se interceptan). */
function observarConsultas(page) {
  const consultas = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/tutor\/consultas?$/.test(new URL(r.url()).pathname)) consultas.push(r);
  });
  return consultas;
}

// ---------------------------------------------------------------- Con Ollama (CP-HU024-03…06)

const MSG_NO_CONFIABLE = "No tengo una respuesta confiable para esa pregunta con el material de esta lección. "
  + "Te recomiendo escribirle a tu instructor en la comunidad del curso para que te ayude.";
// Texto corto: escribir() teclea con retraso y cada acción tiene 20 s (con ~450 caracteres se pasaba).
const TEXTO_FOTOSINTESIS = "La fotosíntesis es el proceso con el que las plantas hacen su alimento con la luz del sol. La clorofila de las hojas capta la luz. La planta transforma agua y dióxido de carbono en glucosa y libera oxígeno.";

function exigirOllama() {
  if (!cfg.ollamaDisponible) {
    test.info().annotations.push({ type: "bloqueado", description: "Sin Ollama (OLLAMA_DISPONIBLE=0): no hay modelo gemma2:2b para responder" });
    test.skip(true, "Bloqueado: necesita Ollama con gemma2:2b (OLLAMA_DISPONIBLE=1)");
  }
}

/** Solo lectura del entorno: ¿Ollama ya tiene el modelo en memoria? (GET /api/ps; no cambia nada). */
async function modeloCargado() {
  try {
    const r = await fetch(`${process.env.OLLAMA_URL ?? "http://localhost:11434"}/api/ps`);
    const j = await r.json();
    return (j.models ?? []).some((m) => String(m.name).startsWith("gemma2:2b"));
  } catch { return false; }
}

/** Instructor desechable con un curso publicado y la lectura «Fotosíntesis», armado una vez por worker. */
let curso24 = null;
async function cursoHu024(abrirContexto) {
  if (curso24) return curso24;
  const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "tutins" });
  curso24 = await test.step("Precondición: el instructor crea y publica el curso con la lectura «Fotosíntesis»", async () => {
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const c = { titulo: `E2E-Tutor-${marca()}`, leccion: "Fotosíntesis", ins };
    await ed.ir();
    c.id = await ed.crearCurso(c.titulo, "Curso de las pruebas E2E del Tutor IA.");
    await ed.abrirEditor(c.titulo);
    await ed.crearModulo(MODULO);
    await ed.crearLecturaPublicada(MODULO, c.leccion, TEXTO_FOTOSINTESIS);
    await ed.publicarCurso();
    await cerrarSesion(page);
    await page.context().close();
    return c;
  });
  return curso24;
}

/** Se inscribe, abre la lectura y el Tutor IA (Alt+T): el tutor dice «Estoy viendo «Fotosíntesis».». */
async function enLeccionConTutor(page, c) {
  await test.step(`Precondición: inscribirse, abrir «${c.leccion}» y el Tutor IA`, async () => {
    await page.getByRole("link", { name: "Mis cursos" }).click();
    await page.getByRole("button", { name: new RegExp(`^(Inscribirme|Anotarme) en ${c.titulo}$`) }).click();
    await expect(page.getByText(new RegExp(`(Te inscribiste en|Ya estás en) «${c.titulo}»\\.`)).first()).toBeVisible();
    await page.getByRole("link", { name: c.titulo, exact: true }).click();
    await page.getByRole("link", { name: c.leccion, exact: true }).click();
    await expect(page.getByRole("heading", { name: c.leccion })).toBeVisible();
    // Con el perfil cognitivo la lectura entra sola en modo lectura, que oculta el tutor: se sale con Esc.
    if (await page.getByRole("button", { name: "Salir del modo lectura" }).isVisible()) await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Abrir Tutor IA" })).toBeVisible();
    await page.keyboard.press("Alt+t");
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByText(`Estoy viendo «${c.leccion}»`)).toBeVisible();
  });
}

const log = (page) => panel(page).getByRole("log", { name: "Conversación con el Tutor IA" });
/** Bloque de una consulta en la conversación (pregunta + respuesta + «¿Te sirvió?»). */
const mensaje = (page, pregunta) => log(page).locator(":scope > div").filter({ has: page.getByText(pregunta, { exact: true }) });

/** Pregunta por la UI y mide hasta que aparece la respuesta (umbral solo como anotación). Devuelve el texto de la respuesta. */
async function preguntarYMedir(page, pregunta, metrica, umbral) {
  await escribir(campo(page), pregunta);
  await medir(metrica, umbral, () => enviarBtn(page).click(),
    () => expect(mensaje(page, pregunta).getByText(/^Tutor IA · /)).toBeVisible({ timeout: 180_000 }));
  await expect(panel(page).getByText("El Tutor IA está pensando…")).toHaveCount(0);
  const texto = (await mensaje(page, pregunta).locator("p.whitespace-pre-wrap").nth(1).innerText()).trim();
  test.info().annotations.push({ type: "respuestaTutor", description: JSON.stringify({ pregunta, respuesta: texto }) });
  return texto;
}

/** Palabras por frase de una respuesta (legibilidad observable desde la UI). */
function legibilidad(t) {
  const frases = t.split(/(?<=[.!?…])\s+|\n+/).map((f) => f.trim()).filter(Boolean);
  const palabras = t.split(/\s+/).filter(Boolean).length;
  return { frases: frases.length, palabras, palabrasPorFrase: Math.round((palabras / Math.max(1, frases.length)) * 10) / 10 };
}

/** Las respuestas del tutor no traen datos sensibles: correos, JWT, la contraseña E2E ni teléfonos. */
function sinDatosSensibles(respuestas, cuentas) {
  for (const r of respuestas) {
    expect.soft(r, "sin correos").not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect.soft(r, "sin JWT").not.toMatch(/eyJ[\w-]{10,}\.[\w-]{10,}\./);
    if (cfg.e2ePassword) expect.soft(r.includes(cfg.e2ePassword), "sin la contraseña E2E").toBe(false);
    expect.soft(r, "sin números de teléfono").not.toMatch(/\+?\d[\d\s-]{8,}\d/);
    for (const c of cuentas) expect.soft(r.includes(c.correo), "sin el correo de la cuenta").toBe(false);
  }
}

test.describe("HU-024 · Tutor IA (RF-024)", () => {
  // ------------------------------------------------------------------ CP-HU024-01
  test("CP-HU024-01 — Ollama caído: degradación controlada @P2 @HU-024", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU024-01", tecnica: "funcional", clasificacion: "Ruta Alterna", clase: "Con ajuste", referenciaPlan: "TC-TUTOR-01; §7.3",
      ajuste: "D-39 (diferencia, decisión del usuario 12/11/2026): se valida el texto real «El tutor no está disponible en este momento. Intenta de nuevo en unos minutos o escribe a tu instructor.» (lenguaje simple, sin detalles técnicos) y que se puede seguir navegando",
      entorno: cfg.ollamaDisponible ? "Ollama disponible (OLLAMA_DISPONIBLE=1): la precondición no se cumple" : "Ollama apagado (OLLAMA_DISPONIBLE=0)" });
    test.skip(cfg.ollamaDisponible, "La precondición es Ollama apagado");
    const est = await cuentaLista(abrirContexto, { etiqueta: "tutor" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    const consultas = observarConsultas(page);
    await test.step("1. Alt+T: se abre el panel «Tutor IA»", async () => {
      // La persona ve la pantalla lista (el botón flotante del tutor) antes de usar el atajo.
      await expect(page.getByRole("button", { name: "Abrir Tutor IA" })).toBeVisible();
      await page.keyboard.press("Alt+t");
      await expect(panel(page)).toBeVisible();
      await expect(campo(page)).toBeFocused();
    });
    await test.step(`2. Escribir «${PREGUNTA}» → «Enviar pregunta»`, async () => {
      await escribir(campo(page), PREGUNTA);
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/tutor\//.test(new URL(r.url()).pathname));
      await enviarBtn(page).click();
      const r = await resp;
      let cuerpo = null;
      try { cuerpo = await r.json(); } catch { /* sin cuerpo */ }
      test.info().annotations.push({ type: "respuestaTutor", description: JSON.stringify({ status: r.status(), codigo: cuerpo?.codigo, mensaje: cuerpo?.mensaje }) });
    });
    await test.step(`Resultado: «${MSG_NO_DISPONIBLE}» en lenguaje simple, sin carga infinita, y la pregunta se conserva`, async () => {
      const aviso = panel(page).getByRole("alert");
      await expect(aviso).toHaveText(MSG_NO_DISPONIBLE);
      expect(await aviso.innerText(), "sin detalles técnicos").not.toMatch(TECNICO);
      await expect(panel(page).getByText("El Tutor IA está pensando…")).toHaveCount(0);
      await expect(enviarBtn(page)).toBeEnabled();
      await expect(campo(page)).toHaveValue(PREGUNTA);
    });
    await test.step("3. Seguir navegando: «Mis cursos» funciona con el tutor caído", async () => {
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await expect(page).toHaveURL(/\/cursos/);
      await expect(page.getByRole("heading", { name: "Mis cursos", level: 1 })).toBeVisible();
      expect(consultas.length, "una sola consulta al tutor").toBe(1);
    });
  });

  // ------------------------------------------------------------------ CP-HU024-02
  test("CP-HU024-02 — Pregunta vacía @P3 @HU-024", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU024-02", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "Adicional" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "tutorvacio" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    const consultas = observarConsultas(page);
    await test.step("Precondición: botón «Abrir Tutor IA» → panel abierto con el campo vacío", async () => {
      await page.getByRole("button", { name: "Abrir Tutor IA" }).click();
      await expect(panel(page)).toBeVisible();
      await expect(campo(page)).toHaveValue("");
    });
    await test.step("1. «Enviar pregunta» sin texto: el botón está deshabilitado", async () => {
      await expect(enviarBtn(page)).toBeDisabled();
    });
    await test.step("2. Solo espacios + Enter: no se envía nada", async () => {
      await escribir(campo(page), "   ");
      await expect(enviarBtn(page)).toBeDisabled();
      await campo(page).press("Enter");
      await page.waitForTimeout(1000); // margen para una petición tardía; solo se observa
      expect(consultas.length, "ninguna consulta al tutor").toBe(0);
      await expect(panel(page).getByText("El Tutor IA está pensando…")).toHaveCount(0);
    });
  });

  // ======================== Con Ollama (OLLAMA_DISPONIBLE=1): CP-HU024-03…06 ========================

  // ------------------------------------------------------------------ CP-HU024-03
  test("CP-HU024-03 — Consulta y respuesta en < 5 s (§7.7: arranque aparte) @P2 @HU-024", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, caso: "CP-HU024-03", tecnica: "rendimiento", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3; §7.7; TC-TUTOR-01",
      ajuste: "§7.7: la primera consulta (arranque del modelo) se mide aparte y las siguientes con el modelo cargado; los tiempos se registran como anotación «rendimiento» sin hacer fallar el caso" });
    exigirOllama();
    const c = await cursoHu024(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "tutorok" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await enLeccionConTutor(page, c);
    const cargado = await modeloCargado();
    test.info().annotations.push({ type: "modeloCargadoAntes", description: cargado ? "sí (otra corrida o sonda lo dejó en memoria)" : "no (arranque en frío)" });
    const r1 = await test.step("1. Primera consulta de la corrida (arranque del modelo, medida aparte)", () =>
      preguntarYMedir(page, "¿Qué es la fotosíntesis?", `primera consulta (arranque del modelo; ${cargado ? "ya estaba cargado" : "en frío"})`, U.s(5, "§7.3 tutor < 5 s (solo referencia en el arranque)")));
    const siguientes = [];
    for (const [i, q] of ["¿Qué necesita una planta para hacer la fotosíntesis?", "¿Qué gas libera la planta durante la fotosíntesis?"].entries()) {
      siguientes.push(await test.step(`${i + 2}. Consulta con el modelo cargado: «${q}» (< 5 s)`, () =>
        preguntarYMedir(page, q, `consulta ${i + 2} con el modelo cargado`, U.s(5, "§7.3 y §7.7 tutor < 5 s"))));
    }
    await test.step("Resultado: cada consulta tiene respuesta del tutor (no el aviso de error)", async () => {
      for (const r of [r1, ...siguientes]) expect(r.length, "respuesta no vacía").toBeGreaterThan(0);
      await expect(panel(page).getByRole("alert")).toHaveCount(0);
      sinDatosSensibles([r1, ...siguientes], [est, c.ins]);
    });
    await verificarAuditoria(abrirContexto, { accion: "CONSULTA_TUTOR", resultado: "Permitido", usuario: est.correo, minimo: 3 });
  });

  // ------------------------------------------------------------------ CP-HU024-04
  test("CP-HU024-04 — Historial y «¿Te sirvió?» @P2 @HU-024", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, caso: "CP-HU024-04", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
    exigirOllama();
    const c = await cursoHu024(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "tutorhist" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await enLeccionConTutor(page, c);
    const P1 = "¿Qué es la clorofila?";
    const P2 = "¿Para qué le sirve la glucosa a la planta?";
    const respuestas = [];
    await test.step(`1. Preguntar «${P1}» y «${P2}»`, async () => {
      respuestas.push(await preguntarYMedir(page, P1, "consulta para el historial 1", U.s(5, "§7.3 tutor < 5 s")));
      respuestas.push(await preguntarYMedir(page, P2, "consulta para el historial 2", U.s(5, "§7.3 tutor < 5 s")));
      sinDatosSensibles(respuestas, [est, c.ins]);
    });
    await test.step("2. «¿Te sirvió?»: «Sí» en la primera y «No» en la segunda", async () => {
      for (const [q, boton] of [[P1, "Sí"], [P2, "No"]]) {
        const b = mensaje(page, q).getByRole("button", { name: boton, exact: true });
        const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/tutor\/respuestas\/\d+\/util$/.test(new URL(r.url()).pathname));
        await b.click();
        expect((await resp).status()).toBeLessThan(400);
        await expect(b).toHaveAttribute("aria-pressed", "true");
      }
    });
    await test.step("Resultado: tras recargar, el historial conserva las dos preguntas, sus respuestas y la valoración", async () => {
      await page.reload();
      await expect(page.getByRole("heading", { name: c.leccion })).toBeVisible();
      if (!(await panel(page).isVisible())) {
        await expect(page.getByRole("button", { name: "Abrir Tutor IA" })).toBeVisible();
        await page.keyboard.press("Alt+t");
      }
      await expect(panel(page)).toBeVisible();
      for (const [i, q] of [P1, P2].entries()) {
        await expect(mensaje(page, q)).toHaveCount(1);
        await expect(mensaje(page, q)).toContainText(respuestas[i].slice(0, 40));
      }
      const si = await mensaje(page, P1).getByRole("button", { name: "Sí", exact: true }).getAttribute("aria-pressed");
      const no = await mensaje(page, P2).getByRole("button", { name: "No", exact: true }).getAttribute("aria-pressed");
      test.info().annotations.push({ type: "valoracionTrasRecargar", description: JSON.stringify({ [P1]: `Sí aria-pressed=${si}`, [P2]: `No aria-pressed=${no}` }) });
      expect.soft(si, "«Sí» sigue marcado tras recargar").toBe("true");
      expect.soft(no, "«No» sigue marcado tras recargar").toBe("true");
    });
  });

  // ------------------------------------------------------------------ CP-HU024-05
  test("CP-HU024-05 — Adaptación por perfil de accesibilidad y desempeño, no por VARK @P2 @HU-024", async ({ abrirContexto }) => {
    test.setTimeout(20 * 60_000);
    caso({ ...base, caso: "CP-HU024-05", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "Con ajuste", referenciaPlan: "§7.3",
      ajuste: "El prompt del sistema no se ve desde el navegador. Por la UI se compara la misma pregunta en la misma lección para: A (sin categorías, VARK lectura/escritura), B (Cognitiva, mismo VARK) y C (sin categorías, VARK visual). Se espera que B reciba frases más cortas que A y que ninguna respuesta aluda al estilo VARK. Lo exacto del prompt sigue en TutorServiceTest (unitaria); construirContexto solo usa la lección, el avance y las categorías de accesibilidad" });
    exigirOllama();
    const c = await cursoHu024(abrirContexto);
    const PREG = "Explícame la fotosíntesis.";
    const perfiles = [
      { id: "A", etiqueta: "tutora", estilo: "LECTURA_ESCRITURA", categorias: ["Ninguna"], nota: "sin categorías, VARK lectura/escritura" },
      { id: "B", etiqueta: "tutorb", estilo: "LECTURA_ESCRITURA", categorias: ["Cognitiva"], nota: "Cognitiva, VARK lectura/escritura" },
      { id: "C", etiqueta: "tutorc", estilo: "VISUAL", categorias: ["Ninguna"], nota: "sin categorías, VARK visual" },
    ];
    const res = {};
    for (const p of perfiles) {
      await test.step(`${p.id}. Estudiante ${p.nota}: «${PREG}» en la lección`, async () => {
        const est = await cuentaLista(abrirContexto, { etiqueta: p.etiqueta, estilo: p.estilo, categorias: p.categorias });
        if (p.id === "B") usuarioProbado(est.correo);
        const page = await sesion(abrirContexto, est);
        await enLeccionConTutor(page, c);
        const r = await preguntarYMedir(page, PREG, `consulta del estudiante ${p.id}`, U.s(5, "§7.3 tutor < 5 s"));
        sinDatosSensibles([r], [est, c.ins]);
        res[p.id] = { respuesta: r, ...legibilidad(r) };
        await page.context().close();
      });
    }
    test.info().annotations.push({ type: "respuestasPorPerfil", description: JSON.stringify(res) });
    await test.step("Resultado: el perfil cognitivo (B) recibe frases más cortas que el perfil sin categorías (A)", () => {
      expect.soft(res.B.palabrasPorFrase, `B ${res.B.palabrasPorFrase} vs A ${res.A.palabrasPorFrase} palabras por frase`).toBeLessThan(res.A.palabrasPorFrase);
    });
    await test.step("Resultado: ninguna respuesta se adapta al estilo VARK (no lo menciona)", () => {
      for (const id of ["A", "B", "C"]) {
        expect.soft(res[id].respuesta, `respuesta de ${id} sin alusiones al estilo VARK`).not.toMatch(/\b(VARK|estilo de aprendizaje|aprendiz(aje)? visual|kinest[eé]sic|auditiv[oa] de aprendizaje)\b/i);
      }
    });
  });

  // ------------------------------------------------------------------ CP-HU024-06
  test("CP-HU024-06 — Respuesta no confiable @P2 @HU-024", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, caso: "CP-HU024-06", tecnica: "funcional", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3",
      ajuste: "Se pide un dato que ni la lección ni el conocimiento general tienen (el teléfono personal del instructor); con gemma2:2b responde SIN_RESPUESTA de forma estable (sonda previa: 6 de 6)" });
    exigirOllama();
    const c = await cursoHu024(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "tutornoconf" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await enLeccionConTutor(page, c);
    const Q = "¿Cuál es el número de teléfono personal del instructor de este curso?";
    const r = await test.step(`1. Preguntar «${Q}»`, () => preguntarYMedir(page, Q, "consulta sin respuesta confiable", U.s(5, "§7.3 tutor < 5 s")));
    await test.step(`Resultado: «${MSG_NO_CONFIABLE}»`, async () => {
      expect(r).toBe(MSG_NO_CONFIABLE);
      sinDatosSensibles([r], [est, c.ins]);
    });
    await verificarAuditoria(abrirContexto, { accion: "CONSULTA_TUTOR", resultado: "Permitido", usuario: est.correo });
  });
  // ------------------------------------------------------------------ CP-HU017-06 (D-42)
  test("CP-HU017-06 — Botones «¿Te sirvió?» del Tutor IA con nombre accesible único @P3 @HU-017 @HU-024 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ hu: "HU-017", rf: "RF-016, RF-024", prioridad: "P3", caso: "CP-HU017-06", tecnica: "funcional", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "WCAG 2.4.6 y 4.1.2; HU-024 (Tutor IA); agregado por el usuario el 12/11/2026 (D-42)", defecto: "D-42" });
    exigirOllama();
    const c = await cursoHu024(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "tutornombres" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await enLeccionConTutor(page, c);
    const preguntas = ["¿Qué es la clorofila?", "¿Qué gas libera la planta?"];
    await test.step("Precondición: dos respuestas del Tutor IA en la conversación", async () => {
      for (const q of preguntas) await preguntarYMedir(page, q, "consulta para los nombres accesibles", U.s(5, "§7.3 tutor < 5 s"));
    });
    await test.step("1. Cada botón «Sí»/«No» de «¿Te sirvió?» tiene un nombre accesible único (dice a qué respuesta se refiere)", async () => {
      const botones = log(page).getByRole("button");
      const n = await botones.count();
      const nombres = [];
      for (let k = 0; k < n; k++) {
        const b = botones.nth(k);
        nombres.push((await b.getAttribute("aria-label")) ?? (await b.innerText()).trim());
      }
      test.info().annotations.push({ type: "nombresAccesibles", description: JSON.stringify(nombres) });
      const repetidos = [...new Set(nombres.filter((x, k) => nombres.indexOf(x) !== k))];
      expect(nombres.length, "dos respuestas, dos botones cada una").toBe(4);
      expect.soft(repetidos, "nombres accesibles repetidos (WCAG 2.4.6 y 4.1.2, D-42)").toEqual([]);
      expect.soft(await log(page).getByRole("button", { name: "Sí", exact: true }).count(), "«Sí» sin contexto (D-42)").toBeLessThanOrEqual(1);
    });
  });
});
