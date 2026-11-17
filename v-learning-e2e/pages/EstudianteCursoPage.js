import { expect } from "@playwright/test";
import { escribir } from "../support/humano.js";

/** Curso, lección y evaluación del estudiante (Cursos.jsx, CursoDetalle.jsx, Leccion.jsx, Evaluaciones.jsx, TomarEvaluacion.jsx). */
export class EstudianteCursoPage {
  constructor(page) {
    this.page = page;
  }

  /** «Mis cursos» → curso → lección → «Marcar como completado». */
  async completarLectura(curso, contenido) {
    await this.page.getByRole("link", { name: "Mis cursos" }).click();
    await this.page.getByRole("link", { name: curso, exact: true }).click();
    await expect(this.page.getByRole("heading", { name: curso, level: 1 })).toBeVisible();
    await this.page.getByRole("link", { name: contenido, exact: true }).click();
    await expect(this.page).toHaveURL(/\/contenidos\/\d+/);
    const resp = this.page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/contenidos\/\d+\/progreso$/.test(r.url()));
    await this.page.getByRole("button", { name: "Marcar como completado" }).click();
    expect((await resp).status()).toBeLessThan(400);
    await expect(this.page.getByText("¡Contenido completado!").first()).toBeVisible();
  }

  /**
   * «Evaluaciones» → «Comenzar» o «Intentar de nuevo» <título> → recorre las preguntas con
   * «Siguiente» y responde «Verdadero» solo en las que tienen el enunciado de `aciertos` (las
   * demás quedan sin responder y cuentan como incorrectas) → «Terminar evaluación» → «Sí, terminar».
   * El orden puede variar por estudiante, así que se guía por el enunciado de cada pantalla.
   * Devuelve el id del intento (de la URL del resultado).
   */
  async presentarConAciertos(titulo, aciertos) {
    // Del menú lateral: la página de resultado también tiene un enlace «Evaluaciones».
    await this.page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Evaluaciones" }).click();
    await this.page.getByRole("button", { name: new RegExp(`^(Comenzar|Intentar de nuevo) ${titulo}$`) }).click();
    await expect(this.page).toHaveURL(/\/intentos\/\d+$/);
    const indicador = this.page.getByText(/^Pregunta \d+ de \d+$/);
    await expect(indicador).toBeVisible();
    const total = Number((await indicador.innerText()).match(/de (\d+)/)[1]);
    for (let i = 1; i <= total; i++) {
      await expect(this.page.getByText(`Pregunta ${i} de ${total}`, { exact: true })).toBeVisible();
      // En escritorio también está el h2 «Tu perfil» del panel lateral: se lee el del contenido principal.
      const enunciado = (await this.page.getByRole("main").getByRole("heading", { level: 2 }).first().innerText()).trim();
      if (aciertos.includes(enunciado)) {
        const guardada = this.page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/intentos\/\d+\/respuestas\/\d+$/.test(r.url()));
        await this.page.getByRole("radio", { name: "Verdadero" }).click();
        expect((await guardada).status()).toBeLessThan(400);
      }
      if (i < total) await this.page.getByRole("button", { name: "Siguiente" }).click();
    }
    await this.page.getByRole("button", { name: "Terminar evaluación" }).click();
    await this.page.getByRole("dialog", { name: "¿Terminar la evaluación?" }).getByRole("button", { name: "Sí, terminar" }).click();
    await expect(this.page).toHaveURL(/\/intentos\/\d+\/resultado$/);
    return Number(this.page.url().match(/\/intentos\/(\d+)\/resultado/)[1]);
  }

  /**
   * «Evaluaciones» (menú lateral) → «Comenzar», «Intentar de nuevo» o «Reanudar» <título>.
   * Devuelve el id del intento (de la URL /intentos/<id>).
   */
  async abrirEvaluacion(titulo, accion = "Comenzar|Intentar de nuevo|Reanudar") {
    await this.page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Evaluaciones" }).click();
    await this.page.getByRole("button", { name: new RegExp(`^(${accion}) ${titulo}$`) }).click();
    await expect(this.page).toHaveURL(/\/intentos\/\d+$/);
    await expect(this.page.getByText(/^Pregunta \d+ de \d+$/)).toBeVisible();
    return Number(this.page.url().match(/\/intentos\/(\d+)$/)[1]);
  }

  /** Enunciado de la pregunta en pantalla (el h2 del contenido principal). */
  async enunciadoActual() {
    return (await this.page.getByRole("main").getByRole("heading", { level: 2 }).first().innerText()).trim();
  }

  /** Va a la pregunta con ese enunciado usando la navegación «Ir a una pregunta». */
  async irAPregunta(enunciado) {
    const nav = this.page.getByRole("navigation", { name: "Ir a una pregunta" }).getByRole("button");
    const n = await nav.count();
    for (let i = 0; i < n; i++) {
      await nav.nth(i).click();
      await expect(this.page.getByText(`Pregunta ${i + 1} de ${n}`, { exact: true })).toBeVisible();
      if ((await this.enunciadoActual()) === enunciado) return i + 1;
    }
    throw new Error(`No encontré la pregunta «${enunciado}» en el intento.`);
  }

  /**
   * Responde la pregunta en pantalla y espera el resultado del guardado automático (PUT): devuelve
   * el código HTTP, o "SIN_RED" si la petición no salió. `valor`: texto de la opción (única o V/F),
   * lista de textos (múltiple) o { abierta: "texto" }.
   */
  async responder(valor) {
    const ruta = /\/api\/intentos\/\d+\/respuestas\/\d+$/;
    const esperar = () => Promise.race([
      this.page.waitForResponse((r) => r.request().method() === "PUT" && ruta.test(r.url())).then((r) => r.status()),
      this.page.waitForEvent("requestfailed", (q) => q.method() === "PUT" && ruta.test(q.url())).then(() => "SIN_RED"),
    ]);
    if (Array.isArray(valor)) {
      let ultimo;
      for (const v of valor) {
        const r = esperar();
        await this.page.getByRole("group", { name: /^Opciones/ }).getByRole("checkbox", { name: v, exact: true }).check();
        ultimo = await r;
      }
      return ultimo;
    }
    if (valor && typeof valor === "object") {
      // La abierta guarda en cada tecla: se espera el PUT de la última.
      const campo = this.page.getByRole("main").getByLabel("Tu respuesta", { exact: true });
      await escribir(campo, valor.abierta.slice(0, -1));
      const r = esperar();
      await campo.pressSequentially(valor.abierta.slice(-1));
      return r;
    }
    const r = esperar();
    // OpcionCard agrega «Seleccionada» al nombre accesible de la opción ya marcada.
    await this.page.getByRole("radio", { name: new RegExp(`^${valor}( Seleccionada)?$`) }).click();
    return r;
  }

  /** Va a la última pregunta → «Terminar evaluación» → «Sí, terminar». Devuelve el id del intento. */
  async terminar() {
    await this.page.getByRole("navigation", { name: "Ir a una pregunta" }).getByRole("button").last().click();
    await this.page.getByRole("button", { name: "Terminar evaluación" }).click();
    await this.page.getByRole("dialog", { name: "¿Terminar la evaluación?" }).getByRole("button", { name: "Sí, terminar" }).click();
    await expect(this.page).toHaveURL(/\/intentos\/\d+\/resultado$/);
    await expect(this.page.getByRole("heading", { name: "Detalle por pregunta" })).toBeVisible();
    return Number(this.page.url().match(/\/intentos\/(\d+)\/resultado/)[1]);
  }

  /** «Detalle por pregunta» del resultado: { [enunciado]: { tuRespuesta, obtenido, puntaje, texto } }. */
  async detalle() {
    const items = this.page.getByRole("region", { name: "Detalle por pregunta" }).getByRole("listitem");
    const n = await items.count();
    const out = {};
    for (let i = 0; i < n; i++) {
      const texto = (await items.nth(i).innerText()).replace(/\s+/g, " ").trim();
      const m = texto.match(/^\d+\. (.+?) \((?:in)?correcta\) Tu respuesta: (.*?) · ([\d.,]+) de ([\d.,]+) puntos/);
      if (!m) throw new Error(`No pude leer el detalle: «${texto}»`);
      out[m[1].trim()] = { tuRespuesta: m[2], obtenido: Number(m[3].replace(",", ".")), puntaje: Number(m[4].replace(",", ".")), texto };
    }
    return out;
  }

  /** «Mis cursos» → curso → «Entregar <tarea>» → «Tu respuesta» → «Enviar entrega». */
  async entregarTarea(curso, tarea, texto) {
    await this.page.getByRole("link", { name: "Mis cursos" }).click();
    await this.page.getByRole("link", { name: curso, exact: true }).click();
    await expect(this.page.getByRole("heading", { name: curso, level: 1 })).toBeVisible();
    await this.page.getByRole("button", { name: `Entregar ${tarea}` }).click();
    const d = this.page.getByRole("dialog", { name: tarea });
    await escribir(d.getByLabel("Tu respuesta"), texto);
    const resp = this.page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/tareas\/\d+\/entrega$/.test(r.url()));
    await d.getByRole("button", { name: "Enviar entrega" }).click();
    expect((await resp).status()).toBeLessThan(400);
    await expect(this.page.getByRole("status").filter({ hasText: "Entrega guardada." })).toBeVisible();
  }

  /**
   * «Evaluaciones» → «Comenzar <título>» → responde la única pregunta → «Terminar evaluación» →
   * «Sí, terminar». Devuelve el id del intento, tomado de la URL del resultado (/intentos/<id>/resultado).
   */
  async presentarEvaluacion(titulo, respuesta = "Verdadero") {
    await this.page.getByRole("link", { name: "Evaluaciones" }).click();
    await this.page.getByRole("button", { name: `Comenzar ${titulo}` }).click();
    await expect(this.page).toHaveURL(/\/intentos\/\d+$/);
    await this.page.getByRole("radio", { name: respuesta }).click();
    await expect(this.page.getByText("Respuesta guardada")).toBeVisible();
    await this.page.getByRole("button", { name: "Terminar evaluación" }).click();
    await this.page.getByRole("dialog", { name: "¿Terminar la evaluación?" }).getByRole("button", { name: "Sí, terminar" }).click();
    await expect(this.page).toHaveURL(/\/intentos\/\d+\/resultado$/);
    return Number(this.page.url().match(/\/intentos\/(\d+)\/resultado/)[1]);
  }
}
