import { expect } from "@playwright/test";
import { elegir, escribir } from "../support/humano.js";

/**
 * /cursos y /cursos/:id/editar del instructor (Cursos.jsx, EditorCurso.jsx, ModuloEditor.jsx,
 * ContenidoEditor.jsx, EvaluacionEditor.jsx). Los IDs se leen OBSERVANDO la respuesta del POST
 * (decisión 6): nunca se intercepta ni se modifica nada.
 */
export class CursosInstructorPage {
  constructor(page) {
    this.page = page;
  }

  /** Hace `accion` y devuelve el JSON de la respuesta POST cuya ruta cumple `patron`. */
  async observarPost(patron, accion) {
    const resp = this.page.waitForResponse((r) => r.request().method() === "POST" && patron.test(new URL(r.url()).pathname));
    await accion();
    const r = await resp;
    expect(r.status(), `POST ${new URL(r.url()).pathname}`).toBeLessThan(400);
    return r.json().catch(() => ({}));
  }

  async ir() {
    await this.page.getByRole("link", { name: "Mis cursos" }).click();
    await expect(this.page.getByRole("heading", { name: "Mis cursos", level: 1 })).toBeVisible();
  }

  /** «Nuevo curso» → título y descripción → «Crear curso». Devuelve el id. */
  async crearCurso(titulo, descripcion) {
    await this.page.getByRole("button", { name: "Nuevo curso" }).click();
    const d = this.page.getByRole("dialog", { name: "Nuevo curso" });
    await escribir(d.getByLabel("Título del curso"), titulo);
    if (descripcion) await escribir(d.getByLabel("Descripción"), descripcion);
    const curso = await this.observarPost(/^\/api\/instructor\/cursos$/, () => d.getByRole("button", { name: "Crear curso" }).click());
    await expect(d).toBeHidden();
    return curso.id;
  }

  /** Desde la lista, «Editar» en la tarjeta del curso. */
  async abrirEditor(titulo) {
    const tarjeta = this.page.getByRole("listitem").filter({ has: this.page.getByRole("heading", { name: titulo }) });
    await tarjeta.getByRole("link", { name: "Editar" }).click();
    await expect(this.page.getByRole("heading", { name: titulo, level: 1 })).toBeVisible();
  }

  pestana(nombre) {
    return this.page.getByRole("tab", { name: nombre });
  }

  async crearModulo(titulo) {
    await this.pestana("Contenido").click();
    await this.page.getByRole("button", { name: "Nuevo módulo" }).click();
    const d = this.page.getByRole("dialog", { name: "Nuevo módulo" });
    await escribir(d.getByLabel("Título del módulo"), titulo);
    const m = await this.observarPost(/^\/api\/instructor\/cursos\/\d+\/modulos$/, () => d.getByRole("button", { name: "Crear módulo" }).click());
    await expect(d).toBeHidden();
    await expect(this.page.getByRole("heading", { name: new RegExp(`Módulo \\d+: ${titulo}$`) })).toBeVisible();
    return m.id;
  }

  /** Lectura con texto (conforme por RF-019), creada y publicada. Devuelve el id. */
  async crearLecturaPublicada(modulo, titulo, texto) {
    await this.pestana("Contenido").click();
    await this.page.getByRole("button", { name: `Nuevo contenido en ${modulo}` }).click();
    const d = this.page.getByRole("dialog", { name: "Nuevo contenido" });
    await escribir(d.getByLabel("Título del contenido"), titulo);
    await elegir(d.getByLabel("Formato"), "Lectura");
    await escribir(d.getByLabel("Texto de la lección"), texto);
    const c = await this.observarPost(/^\/api\/modulos\/\d+\/contenidos$/, () => d.getByRole("button", { name: "Crear contenido" }).click());
    // Tras crear, el mismo diálogo pasa a «Editar contenido» con la sección de publicación.
    const e = this.page.getByRole("dialog", { name: "Editar contenido" });
    const publicar = e.getByRole("button", { name: "Publicar contenido" });
    await expect(publicar).toBeEnabled();
    await this.observarPost(/^\/api\/contenidos\/\d+\/publicar$/, () => publicar.click());
    await expect(e.getByRole("button", { name: "Despublicar contenido" })).toBeVisible();
    await e.getByRole("button", { name: "Cerrar" }).first().click();
    await expect(e).toBeHidden();
    return c.id;
  }

  /**
   * Contenido de cualquier formato, creado y publicado. Para video y podcast se agregan antes los
   * recursos que exige la publicación (RF-019): video → «Subtítulos» (enlace) y «Transcripción»
   * (texto); podcast → «Transcripción». formato: "Video" | "Podcast" | "Simulación" | "Lectura".
   * Devuelve el id.
   */
  async crearContenidoPublicado(modulo, titulo, { formato, url, texto }) {
    await this.pestana("Contenido").click();
    await this.page.getByRole("button", { name: `Nuevo contenido en ${modulo}` }).click();
    const d = this.page.getByRole("dialog", { name: "Nuevo contenido" });
    await escribir(d.getByLabel("Título del contenido"), titulo);
    await elegir(d.getByLabel("Formato"), formato);
    if (formato === "Lectura") await escribir(d.getByLabel("Texto de la lección"), texto);
    else await escribir(d.getByLabel("Enlace del recurso (video, audio o simulación)"), url);
    const c = await this.observarPost(/^\/api\/modulos\/\d+\/contenidos$/, () => d.getByRole("button", { name: "Crear contenido" }).click());
    const e = this.page.getByRole("dialog", { name: "Editar contenido" });
    const recursos = formato === "Video"
      ? [{ tipo: "Subtítulos", url: url.replace(/\.\w+$/, ".vtt") }, { tipo: "Transcripción", texto: `Transcripción de «${titulo}».` }]
      : formato === "Podcast" ? [{ tipo: "Transcripción", texto: `Transcripción de «${titulo}».` }] : [];
    for (const r of recursos) {
      await elegir(e.getByLabel("Tipo de recurso"), r.tipo);
      if (r.url) await escribir(e.getByLabel("Enlace (URL)"), r.url);
      else await escribir(e.getByLabel("Texto", { exact: true }), r.texto);
      await this.observarPost(/^\/api\/contenidos\/\d+\/recursos$/, () => e.getByRole("button", { name: "Agregar recurso" }).click());
      await expect(this.page.getByText(`Agregaste el recurso: ${r.tipo}.`).first()).toBeVisible();
    }
    const publicar = e.getByRole("button", { name: "Publicar contenido" });
    await expect(publicar).toBeEnabled();
    await this.observarPost(/^\/api\/contenidos\/\d+\/publicar$/, () => publicar.click());
    await expect(e.getByRole("button", { name: "Despublicar contenido" })).toBeVisible();
    await e.getByRole("button", { name: "Cerrar" }).first().click();
    await expect(e).toBeHidden();
    return c.id;
  }

  /**
   * Evaluación tipo Quiz con una pregunta de verdadero o falso (la correcta es «Verdadero»).
   * Devuelve el id de la evaluación.
   */
  async crearEvaluacionVF(modulo, titulo, enunciado) {
    await this.pestana("Evaluaciones y tareas").click();
    await this.page.getByRole("button", { name: `Nueva evaluación en ${modulo}` }).click();
    const d = this.page.getByRole("dialog", { name: "Nueva evaluación" });
    await escribir(d.getByLabel("Título"), titulo);
    const ev = await this.observarPost(/^\/api\/modulos\/\d+\/evaluaciones$/, () => d.getByRole("button", { name: "Crear evaluación" }).click());
    // Se abre solo el diálogo de preguntas.
    const p = this.page.getByRole("dialog", { name: `Preguntas: ${titulo}` });
    await escribir(p.getByLabel("Enunciado"), enunciado);
    await elegir(p.getByLabel("Tipo de pregunta"), "Verdadero o falso");
    await p.getByRole("checkbox", { name: "Es correcta" }).first().check();
    await this.observarPost(/^\/api\/evaluaciones\/\d+\/preguntas$/, () => p.getByRole("button", { name: "Agregar pregunta" }).click());
    await p.getByRole("button", { name: "Cerrar" }).first().click();
    await expect(p).toBeHidden();
    return ev.id;
  }

  /**
   * Evaluación tipo Quiz con varias preguntas, cada una con su puntaje (por defecto verdadero o
   * falso con «Verdadero» como correcta; ver `llenarOpciones` para los otros tipos). `alternativa` es la casilla «Tiene alternativa
   * accesible…» (marcada por defecto en la app). `tiempoLimite`: «Tiempo límite (minutos)» (vacío =
   * sin límite). Devuelve el id de la evaluación.
   */
  async crearEvaluacion(modulo, titulo, { puntajeMaximo = 100, alternativa = true, tiempoLimite, preguntas }) {
    await this.pestana("Evaluaciones y tareas").click();
    await this.page.getByRole("button", { name: `Nueva evaluación en ${modulo}` }).click();
    const d = this.page.getByRole("dialog", { name: "Nueva evaluación" });
    await escribir(d.getByLabel("Título"), titulo);
    await escribir(d.getByLabel("Puntaje máximo"), String(puntajeMaximo));
    if (tiempoLimite) await escribir(d.getByLabel("Tiempo límite (minutos)"), String(tiempoLimite));
    const casilla = d.getByRole("checkbox", { name: /Tiene alternativa accesible/ });
    if ((await casilla.isChecked()) !== alternativa) await casilla.click();
    await expect(casilla).toBeChecked({ checked: alternativa });
    if (!alternativa) await expect(d.getByText(/se excluirá de la calificación de estudiantes con perfil motor/)).toBeVisible();
    const ev = await this.observarPost(/^\/api\/modulos\/\d+\/evaluaciones$/, () => d.getByRole("button", { name: "Crear evaluación" }).click());
    const p = this.page.getByRole("dialog", { name: `Preguntas: ${titulo}` });
    for (const [i, q] of preguntas.entries()) {
      await escribir(p.getByLabel("Enunciado"), q.enunciado);
      await this.llenarOpciones(p, q);
      await escribir(p.getByLabel("Puntaje", { exact: true }), String(q.puntaje));
      await this.observarPost(/^\/api\/evaluaciones\/\d+\/preguntas$/, () => p.getByRole("button", { name: "Agregar pregunta" }).click());
      // El formulario se vuelve a montar vacío con la siguiente posición.
      await expect(p.getByLabel("Posición")).toHaveValue(String(i + 2));
      await expect(p.getByLabel("Enunciado")).toHaveValue("");
    }
    await p.getByRole("button", { name: "Cerrar" }).first().click();
    await expect(p).toBeHidden();
    return ev.id;
  }

  /**
   * Tipo y opciones de una pregunta en el diálogo «Preguntas: …». `q.tipo`: "VF" (por defecto; la
   * correcta es «Verdadero»), "UNICA", "MULTIPLE" (opciones [{ texto, correcta }]) o "ABIERTA"
   * (`q.aceptadas`: respuestas aceptadas).
   */
  async llenarOpciones(p, q) {
    const TIPO = { VF: "Verdadero o falso", UNICA: "Selección única (una respuesta correcta)",
      MULTIPLE: "Selección múltiple (varias correctas)", ABIERTA: "Abierta (respuesta escrita)" };
    const tipo = q.tipo ?? "VF";
    await elegir(p.getByLabel("Tipo de pregunta"), TIPO[tipo]);
    if (tipo === "VF") {
      await expect(p.getByRole("checkbox", { name: "Es correcta" }).first()).toBeChecked();
      return;
    }
    if (tipo === "ABIERTA") {
      for (const [j, texto] of q.aceptadas.entries()) {
        if (j > 0) await p.getByRole("button", { name: "Agregar otra respuesta" }).click();
        await escribir(p.getByLabel(`Respuesta ${j + 1}`, { exact: true }), texto);
      }
      return;
    }
    for (const [j, o] of q.opciones.entries()) {
      if (j > 1) await p.getByRole("button", { name: "Agregar opción" }).click();
      await escribir(p.getByLabel(`Opción ${j + 1}`, { exact: true }), o.texto);
      const correcta = p.getByRole("checkbox", { name: "Es correcta" }).nth(j);
      if ((await correcta.isChecked()) !== o.correcta) await correcta.click();
    }
    for (const [j, o] of q.opciones.entries()) {
      await expect(p.getByRole("checkbox", { name: "Es correcta" }).nth(j)).toBeChecked({ checked: o.correcta });
    }
  }

  /** «Nueva tarea en este módulo» (en «Evaluaciones y tareas») → «Guardar tarea». Devuelve el id. */
  async crearTarea(titulo, puntajeMaximo = 100) {
    await this.pestana("Evaluaciones y tareas").click();
    await this.page.getByRole("button", { name: "Nueva tarea en este módulo" }).click();
    const d = this.page.getByRole("dialog", { name: "Nueva tarea" });
    await escribir(d.getByLabel("Título"), titulo);
    await escribir(d.getByLabel("Puntaje máximo"), String(puntajeMaximo));
    const t = await this.observarPost(/^\/api\/modulos\/\d+\/tareas$/, () => d.getByRole("button", { name: "Guardar tarea" }).click());
    await expect(d).toBeHidden();
    await expect(this.page.getByText(titulo, { exact: true }).first()).toBeVisible();
    return t.id;
  }

  /**
   * «Evaluaciones y tareas» → «Entregas de <tarea>» → en la entrega del estudiante, «Puntaje (0 a N)»
   * → «Calificar». Espera el PUT de la calificación y la insignia «Calificada: <puntaje>/…».
   */
  async calificarTarea(tarea, estudiante, puntaje) {
    await this.pestana("Evaluaciones y tareas").click();
    await this.page.getByRole("button", { name: `Entregas de ${tarea}` }).click();
    const d = this.page.getByRole("dialog", { name: `Entregas: ${tarea}` });
    const entrega = d.getByRole("listitem").filter({ hasText: estudiante });
    await expect(entrega).toHaveCount(1);
    await escribir(entrega.getByLabel(/^Puntaje \(0 a /), String(puntaje));
    const resp = this.page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/entregas\/\d+\/calificacion$/.test(new URL(r.url()).pathname));
    await entrega.getByRole("button", { name: "Calificar" }).click();
    expect((await resp).status()).toBeLessThan(400);
    await expect(entrega.getByText(new RegExp(`^Calificada: ${puntaje}(\\.0+)?/`, "i"))).toBeVisible();
    await d.getByRole("button", { name: "Cerrar" }).first().click();
    await expect(d).toBeHidden();
  }

  /**
   * En «Notas del curso» (ya abierta): «Acomodaciones de <nombre>» → «Multiplicador de tiempo» y
   * «Minutos que puede pedir al recibir el aviso de tiempo» → «Guardar acomodación».
   * `multiplicador`: texto visible de la opción (p. ej. «1,5x (50 % más de tiempo)»).
   */
  async asignarAcomodacion(nombre, { multiplicador, ampliacion = 0 }) {
    await this.page.getByRole("button", { name: `Acomodaciones de ${nombre}` }).click();
    const d = this.page.getByRole("dialog", { name: `Acomodaciones de ${nombre}` });
    if (multiplicador) await elegir(d.getByLabel("Multiplicador de tiempo"), multiplicador);
    await escribir(d.getByLabel("Minutos que puede pedir al recibir el aviso de tiempo"), String(ampliacion));
    const resp = this.page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/.*acomodaciones$/.test(new URL(r.url()).pathname));
    await d.getByRole("button", { name: "Guardar acomodación" }).click();
    expect((await resp).status()).toBeLessThan(400);
    await expect(this.page.getByText(`Acomodación guardada para ${nombre}.`).first()).toBeVisible();
  }

  /** Desde el editor del curso, «Notas del curso». Espera la respuesta del GET de notas. */
  async abrirNotas() {
    const resp = this.page.waitForResponse((r) => r.request().method() === "GET" && /\/api\/cursos\/\d+\/notas$/.test(r.url()));
    await this.page.getByRole("link", { name: "Notas del curso" }).click();
    expect((await resp).status()).toBe(200);
    await expect(this.page).toHaveURL(/\/cursos\/\d+\/notas$/);
  }

  async publicarCurso() {
    await this.page.getByRole("button", { name: "Publicar curso" }).click();
    const d = this.page.getByRole("dialog", { name: "¿Publicar el curso?" });
    await this.observarPost(/^\/api\/instructor\/cursos\/\d+\/publicar$/, () => d.getByRole("button", { name: "Sí, publicar" }).click());
    await expect(this.page.getByRole("button", { name: "Publicar curso" })).toBeHidden();
  }

  /** Pestaña «Estudiantes»: inscribe por correo y comprueba que quedaron en «Inscritos ahora». */
  async inscribir(correos) {
    await this.pestana("Estudiantes").click();
    await escribir(this.page.getByLabel("Correos de los estudiantes"), correos.join("\n"));
    await this.observarPost(/^\/api\/instructor\/cursos\/\d+\/inscripciones$/,
      () => this.page.getByRole("button", { name: "Inscribir estudiantes" }).click());
    const resultado = this.page.getByRole("status").filter({ hasText: "Inscritos ahora" });
    for (const c of correos) await expect(resultado).toContainText(c);
  }
}
