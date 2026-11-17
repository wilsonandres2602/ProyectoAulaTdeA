import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cuentaLista, cerrarSesion } from "../support/sesiones.js";
import { escribir, elegir } from "../support/humano.js";
import { marca } from "../support/datos.js";
import { MODULO, sesion, armarCurso, estudianteListo } from "../support/cursos.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";
import { tokenDeSesion, pedir } from "../support/api.js";
import fs from "node:fs";
import path from "node:path";

const base = { hu: "HU-025", rf: "RF-025", prioridad: "P2" };
const UMBRAL = U.s(2, "§7.3 operación del instructor < 2 s");
const VIDEO_URL = "https://example.org/e2e/clase.mp4";

/** Instructor desechable compartido por los casos del worker (cada caso usa su propio curso). */
let ins25 = null;
async function instructor(abrirContexto) {
  if (!ins25) ins25 = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "curins" });
  usuarioProbado(ins25.correo);
  return ins25;
}

/** El instructor entra, crea un curso borrador (con «Módulo E2E» si se pide) y queda en su editor. */
async function cursoNuevo(abrirContexto, prefijo, { modulo = true } = {}) {
  const ins = await instructor(abrirContexto);
  const page = await sesion(abrirContexto, ins);
  const ed = new CursosInstructorPage(page);
  const c = { titulo: `${prefijo}-${marca()}`, ins };
  await test.step(`Precondición: curso borrador «${c.titulo}»${modulo ? " con «Módulo E2E»" : ""}`, async () => {
    await ed.ir();
    c.id = await ed.crearCurso(c.titulo, "Curso de las pruebas E2E de HU-025.");
    await ed.abrirEditor(c.titulo);
    if (modulo) await ed.crearModulo(MODULO);
  });
  return { page, ed, c };
}

/** «Nuevo contenido» en el módulo → formato (y enlace o texto) → «Crear contenido»; queda abierto «Editar contenido». */
async function nuevoContenido(page, ed, titulo, formato, { url, texto } = {}) {
  await ed.pestana("Contenido").click();
  await page.getByRole("button", { name: `Nuevo contenido en ${MODULO}` }).click();
  const d = page.getByRole("dialog", { name: "Nuevo contenido" });
  await escribir(d.getByLabel("Título del contenido"), titulo);
  await elegir(d.getByLabel("Formato"), formato);
  if (texto) await escribir(d.getByLabel("Texto de la lección"), texto);
  if (url) await escribir(d.getByLabel("Enlace del recurso (video, audio o simulación)"), url);
  const r = await ed.observarPost(/^\/api\/modulos\/\d+\/contenidos$/, () => d.getByRole("button", { name: "Crear contenido" }).click());
  const e = page.getByRole("dialog", { name: "Editar contenido" });
  await expect(e).toBeVisible();
  return { id: r.id, e };
}

/** «Tipo de recurso» → enlace o texto → «Agregar recurso» → «Agregaste el recurso: <tipo>.» Devuelve el id del recurso. */
async function agregarRecurso(page, ed, e, tipo, { url, texto }) {
  await elegir(e.getByLabel("Tipo de recurso"), tipo);
  if (url) await escribir(e.getByLabel("Enlace (URL)"), url);
  else await escribir(e.getByLabel("Texto", { exact: true }), texto);
  const r = await ed.observarPost(/^\/api\/contenidos\/\d+\/recursos$/, () => e.getByRole("button", { name: "Agregar recurso" }).click());
  await expect(page.getByText(`Agregaste el recurso: ${tipo}.`).first()).toBeVisible();
  return r.id;
}

/** «Quitar <tipo>» → «¿Quitar este recurso?» → «Sí, quitar recurso» → «Quitaste el recurso.» */
async function quitarRecurso(page, e, tipo) {
  await e.getByRole("button", { name: `Quitar ${tipo}` }).click();
  const d = page.getByRole("dialog", { name: "¿Quitar este recurso?" });
  await d.getByRole("button", { name: "Sí, quitar recurso" }).click();
  await expect(page.getByText("Quitaste el recurso.").first()).toBeVisible();
}

/** PNG válido de 1×1 rellenado con ceros hasta `bytes` (el navegador ignora lo que va después de IEND). */
function pngDeTamano(bytes) {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  return Buffer.concat([png, Buffer.alloc(bytes - png.length)]);
}

const MB = 1024 * 1024;

test.describe("HU-025 · Gestión de cursos del instructor (RF-025)", () => {
  // ------------------------------------------------------------------ CP-HU025-01
  test("CP-HU025-01 — Crear borrador @P2 @HU-025", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU025-01", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const ins = await instructor(abrirContexto);
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const titulo = `E2E-Borrador-${marca()}`;
    let id;
    await test.step(`1. /cursos → «Nuevo curso» → «Título del curso» = «${titulo}» → «Crear curso»`, async () => {
      await ed.ir();
      await page.getByRole("button", { name: "Nuevo curso" }).click();
      const d = page.getByRole("dialog", { name: "Nuevo curso" });
      await escribir(d.getByLabel("Título del curso"), titulo);
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/instructor/cursos");
      await medir("crear curso", UMBRAL, () => d.getByRole("button", { name: "Crear curso" }).click(), () => expect(d).toBeHidden());
      const r = await resp;
      expect(r.status()).toBeLessThan(400);
      id = (await r.json()).id;
    });
    await test.step("Resultado: el curso aparece en «Mis cursos» como borrador", async () => {
      const tarjeta = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: titulo }) });
      await expect(tarjeta).toHaveCount(1);
      await expect(tarjeta.getByText(/^borrador$/i)).toBeVisible();
      await expect(tarjeta.getByRole("button", { name: "Publicar curso" })).toBeEnabled();
    });
    await verificarAuditoria(abrirContexto, { accion: "CURSO_CREADO", resultado: "Permitido", usuario: ins.correo, recursoContiene: `cursos/${id}` });
  });

  // ------------------------------------------------------------------ CP-HU025-02
  test("CP-HU025-02 — Módulos ordenados y posición duplicada @P2 @HU-025", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU025-02", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const { page, ed, c } = await cursoNuevo(abrirContexto, "E2E-Modulos", { modulo: false });
    const nuevoModulo = async (titulo, orden) => {
      await ed.pestana("Contenido").click();
      await page.getByRole("button", { name: "Nuevo módulo" }).click();
      const d = page.getByRole("dialog", { name: "Nuevo módulo" });
      await escribir(d.getByLabel("Título del módulo"), titulo);
      await escribir(d.getByLabel("Posición (orden)"), String(orden));
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/instructor\/cursos\/\d+\/modulos$/.test(new URL(r.url()).pathname));
      await d.getByRole("button", { name: "Crear módulo" }).click();
      return { d, r: await resp };
    };
    await test.step("1. «Nuevo módulo» «Módulo B» en la posición 2 y «Módulo A» en la posición 1", async () => {
      for (const [t, o] of [["Módulo B", 2], ["Módulo A", 1]]) {
        const { d, r } = await nuevoModulo(t, o);
        expect(r.status(), `crear ${t}`).toBeLessThan(400);
        await expect(d).toBeHidden();
      }
    });
    await test.step("Resultado: el orden mostrado es 1 (Módulo A), 2 (Módulo B)", async () => {
      const titulos = await page.getByRole("tabpanel").getByRole("heading", { level: 3, name: /^Módulo \d+: / }).allInnerTexts();
      test.info().annotations.push({ type: "ordenMostrado", description: JSON.stringify(titulos) });
      expect(titulos).toEqual(["Módulo 1: Módulo A", "Módulo 2: Módulo B"]);
    });
    await test.step("2. Un tercer módulo en la posición 1: «Ya hay un módulo en la posición 1.»", async () => {
      const { d, r } = await nuevoModulo("Módulo duplicado", 1);
      expect(r.status()).toBe(409);
      await expect(d.getByText("Ya hay un módulo en la posición 1.")).toBeVisible();
      await d.getByRole("button", { name: "Cancelar" }).click();
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "MODULO_CREADO", resultado: "Permitido", usuario: c.ins.correo, minimo: 2 },
      { accion: "HTTP POST (409)", resultado: "Error", usuario: c.ins.correo, recursoContiene: `cursos/${c.id}/modulos` },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU025-03 (parametrizado)
  const FORMATOS = [
    { formato: "Lectura", texto: "Texto de la lectura de las pruebas E2E." },
    { formato: "Video", url: VIDEO_URL },
    { formato: "Podcast", url: "https://example.org/e2e/episodio.mp3" },
    { formato: "Simulación", url: "https://example.org/e2e/simulacion.html" },
  ];
  for (const f of FORMATOS) {
    test(`CP-HU025-03 — Contenido de formato ${f.formato} @P2 @HU-025`, async ({ abrirContexto }) => {
      test.setTimeout(10 * 60_000);
      caso({ ...base, caso: "CP-HU025-03", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
      const { page, ed, c } = await cursoNuevo(abrirContexto, `E2E-Formato-${f.formato.slice(0, 3)}`);
      const r = await test.step(`1. «Nuevo contenido» → «Formato» = ${f.formato} → «Crear contenido»`, async () => {
        const t0 = Date.now();
        const n = await nuevoContenido(page, ed, `Contenido ${f.formato}`, f.formato, f);
        test.info().annotations.push({ type: "rendimiento-aprox", description: `crear contenido ${Date.now() - t0} ms (incluye tecleo)` });
        return n;
      });
      await test.step("Resultado: «Contenido creado. Ahora agrega sus recursos accesibles para poder publicarlo.»", async () => {
        await expect(page.getByText("Contenido creado. Ahora agrega sus recursos accesibles para poder publicarlo.").first()).toBeVisible();
      });
      await verificarAuditoria(abrirContexto, { accion: "CONTENIDO_CREADO", resultado: "Permitido", usuario: c.ins.correo, recursoContiene: `contenidos/${r.id}` });
    });
  }

  // ------------------------------------------------------------------ CP-HU025-04
  test("CP-HU025-04 — Recursos accesibles: agregar y quitar @P2 @HU-025", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU025-04", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const { page, ed, c } = await cursoNuevo(abrirContexto, "E2E-Recursos");
    const { id, e } = await test.step("Precondición: un video con enlace", () => nuevoContenido(page, ed, "Video con recursos", "Video", { url: VIDEO_URL }));
    let recursoId;
    await test.step("1. «Agregar recurso» (Subtítulos): aparece en «Recursos accesibles»", async () => {
      recursoId = await agregarRecurso(page, ed, e, "Subtítulos", { url: VIDEO_URL.replace(".mp4", ".vtt") });
      await expect(e.getByRole("button", { name: "Quitar Subtítulos" })).toBeVisible();
      await expect(e.getByRole("listitem").filter({ hasText: VIDEO_URL.replace(".mp4", ".vtt") })).toHaveCount(1);
    });
    await test.step("2. «Quitar» → «Sí, quitar recurso»: «Quitaste el recurso.»", async () => {
      await quitarRecurso(page, e, "Subtítulos");
      await expect(e.getByRole("button", { name: "Quitar Subtítulos" })).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "RECURSO_ACCESIBLE_AGREGADO", resultado: "Permitido", usuario: c.ins.correo, recursoContiene: `contenidos/${id} SUBTITULO` },
      { accion: "RECURSO_ACCESIBLE_ELIMINADO", resultado: "Permitido", usuario: c.ins.correo, recursoContiene: `recursos/${recursoId}` },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU025-05 (parametrizado)
  const PORTADAS = [
    { nombre: "4 MB", bytes: 4 * MB, ok: true },
    { nombre: "5 MB exactos", bytes: 5 * MB, ok: true },
    { nombre: "5 MB + 1 byte", bytes: 5 * MB + 1, ok: false },
    { nombre: "6 MB", bytes: 6 * MB, ok: false },
  ];
  for (const p of PORTADAS) {
    test(`CP-HU025-05 — Portada de ${p.nombre} @P2 @HU-025`, async ({ abrirContexto }) => {
      test.setTimeout(10 * 60_000);
      caso({ ...base, caso: "CP-HU025-05", tecnica: "límite", clasificacion: p.ok ? "Ruta Crítica" : "Ruta Alterna", clase: p.ok ? "E2E-UI" : "Con ajuste", referenciaPlan: "§7.12.1; §7.12.2",
        ajuste: p.ok ? undefined : "D-43 (diferencia): la UI rechaza el archivo en el navegador sin enviarlo; no se exige fila HTTP POST (400). El rechazo del servidor se cubre en CP-HU025-10 (E2E-API)" });
      const ins = await instructor(abrirContexto);
      const page = await sesion(abrirContexto, ins);
      const ed = new CursosInstructorPage(page);
      const subidas = [];
      page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/instructor/cursos/portada") subidas.push(r); });
      const d = page.getByRole("dialog", { name: "Nuevo curso" });
      await test.step("Precondición: /cursos → «Nuevo curso»", async () => {
        await ed.ir();
        await page.getByRole("button", { name: "Nuevo curso" }).click();
        await expect(d.getByRole("group", { name: "Portada del curso" })).toBeVisible();
      });
      await test.step(`1. «Portada del curso» → «Adjuntar imagen» → elegir portada.png de ${p.nombre} (${p.bytes} bytes)`, async () => {
        const selector = page.waitForEvent("filechooser");
        await d.getByRole("button", { name: "Adjuntar imagen" }).click();
        const fc = await selector;
        const resp = p.ok ? page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/instructor/cursos/portada") : null;
        await fc.setFiles({ name: "portada.png", mimeType: "image/png", buffer: pngDeTamano(p.bytes) });
        if (resp) {
          const r = await resp;
          test.info().annotations.push({ type: "subida", description: `HTTP ${r.status()}` });
          expect(r.status()).toBe(200);
        }
      });
      if (p.ok) {
        await test.step("Resultado: se guarda y hay vista previa", async () => {
          const img = d.getByRole("img", { name: "Vista previa de la portada" });
          await expect(img).toBeVisible();
          await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
          await expect(d.getByLabel("O pega el enlace de la imagen")).toHaveValue(/^\/api\/archivos\/portadas\/.+\.png$/);
        });
        await verificarAuditoria(abrirContexto, { accion: "HTTP POST (200)", resultado: "Permitido", usuario: ins.correo, recursoContiene: "/api/instructor/cursos/portada" });
      } else {
        await test.step("Resultado: «La imagen no puede superar los 5 MB.»", async () => {
          await expect(d.getByText("La imagen no puede superar los 5 MB.")).toBeVisible();
          await expect(d.getByRole("img", { name: "Vista previa de la portada" })).toHaveCount(0);
          await page.waitForTimeout(1000); // margen para una subida tardía; solo se observa
          test.info().annotations.push({ type: "peticionesDeSubida", description: String(subidas.length) });
          expect(subidas.length, "el navegador no envía el archivo").toBe(0);
        });
      }
    });
  }

  // ------------------------------------------------------------------ CP-HU025-06
  test("CP-HU025-06 — Publicar bloquea cursos no conformes @P2 @HU-025", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU025-06", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3; TC-CUR-01",
      ajuste: "Precondición armada en el caso: un video conforme se publica y luego se le quita la transcripción, así queda un contenido publicado no conforme (la UI no deja publicar uno no conforme)" });
    const { page, ed, c } = await cursoNuevo(abrirContexto, "E2E-NoConforme");
    const titulo = "Video que pierde la transcripción";
    await test.step("Precondición: video publicado al que luego se le quita la transcripción", async () => {
      const { e } = await nuevoContenido(page, ed, titulo, "Video", { url: VIDEO_URL });
      await agregarRecurso(page, ed, e, "Subtítulos", { url: VIDEO_URL.replace(".mp4", ".vtt") });
      await agregarRecurso(page, ed, e, "Transcripción", { texto: "Transcripción del video de las pruebas E2E." });
      await ed.observarPost(/^\/api\/contenidos\/\d+\/publicar$/, () => e.getByRole("button", { name: "Publicar contenido" }).click());
      await expect(e.getByRole("button", { name: "Despublicar contenido" })).toBeVisible();
      await quitarRecurso(page, e, "Transcripción");
      // Al quitar un recurso de un contenido publicado, el diálogo «Editar contenido» se cierra solo.
      if (await e.isVisible()) await e.getByRole("button", { name: "Cerrar" }).first().click();
      await expect(e).toBeHidden();
      const fila = page.getByRole("listitem").filter({ has: page.getByText(titulo, { exact: true }) });
      await expect(fila.getByText("Publicado", { exact: true })).toBeVisible();
      await expect(fila.getByText("No conforme", { exact: true })).toBeVisible();
    });
    protegerCuenta(c.ins.correo, "DENEGACION", 1);
    await test.step("1. «Publicar curso» → «Sí, publicar»: «Qué corregir para publicar el curso» con la lista; no se publica", async () => {
      await page.getByRole("button", { name: "Publicar curso" }).click();
      const d = page.getByRole("dialog", { name: "¿Publicar el curso?" });
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/instructor\/cursos\/\d+\/publicar$/.test(new URL(r.url()).pathname));
      await medir("publicar curso no conforme", UMBRAL, () => d.getByRole("button", { name: "Sí, publicar" }).click(),
        () => expect(page.getByRole("heading", { name: "Qué corregir para publicar el curso" })).toBeVisible());
      const r = await resp;
      registrarEvento(c.ins.correo, "DENEGACION");
      test.info().annotations.push({ type: "respuesta", description: `HTTP ${r.status()}` });
      expect(r.status()).toBe(422);
      const lista = page.getByRole("region", { name: "Qué corregir para publicar el curso" }).getByRole("listitem");
      const items = (await lista.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
      test.info().annotations.push({ type: "hallazgos", description: JSON.stringify(items) });
      expect(items.length).toBeGreaterThan(0);
      expect(items.join(" ")).toContain(titulo);
      if (await d.isVisible()) await d.getByRole("button", { name: "Cancelar" }).click();
      await expect(page.getByRole("button", { name: "Publicar curso" })).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, { accion: "PUBLICACION_CURSO_RECHAZADA", resultado: "Denegado", usuario: c.ins.correo, recursoContiene: `cursos/${c.id}` });
  });

  // ------------------------------------------------------------------ CP-HU025-07
  test("CP-HU025-07 — Evaluación con intentos no editable @P2 @HU-025", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, caso: "CP-HU025-07", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const ins = await instructor(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "curintento" });
    const EV = "Quiz con intento";
    const ENUNCIADO = "Pregunta del quiz con intento";
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Intento", evaluaciones: [{ titulo: EV, puntajeMaximo: 10, preguntas: [{ enunciado: ENUNCIADO, puntaje: 10 }] }], inscritos: [est] });
    await test.step("Precondición: el estudiante presenta la evaluación (deja un intento)", async () => {
      const { page, ep } = await estudianteListo(abrirContexto, est, curso);
      await ep.presentarConAciertos(EV, [ENUNCIADO]);
      await cerrarSesion(page);
      await page.context().close();
    });
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    await ed.ir();
    await ed.abrirEditor(curso.titulo);
    await ed.pestana("Evaluaciones y tareas").click();
    await test.step("1. «Agregar preguntas» → nueva pregunta → «Agregar pregunta»: «Esta evaluación ya tiene intentos: no se pueden agregar preguntas.»", async () => {
      await page.getByRole("button", { name: `Agregar preguntas a ${EV}` }).click();
      const p = page.getByRole("dialog", { name: `Preguntas: ${EV}` });
      await escribir(p.getByLabel("Enunciado"), "Pregunta nueva después del intento");
      await ed.llenarOpciones(p, { tipo: "VF" });
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/evaluaciones\/\d+\/preguntas$/.test(new URL(r.url()).pathname));
      await p.getByRole("button", { name: "Agregar pregunta" }).click();
      expect((await resp).status()).toBe(409);
      await expect(p.getByText("Esta evaluación ya tiene intentos: no se pueden agregar preguntas.")).toBeVisible();
      await p.getByRole("button", { name: "Cerrar" }).first().click();
    });
    await test.step("2. «Eliminar» → «Sí, eliminar»: «No se puede borrar una evaluación que ya tiene intentos.»", async () => {
      await page.getByRole("button", { name: `Eliminar ${EV}` }).click();
      const d = page.getByRole("dialog", { name: "¿Eliminar esta evaluación?" });
      const resp = page.waitForResponse((r) => r.request().method() === "DELETE" && /\/api\/evaluaciones\/\d+$/.test(new URL(r.url()).pathname));
      await d.getByRole("button", { name: "Sí, eliminar" }).click();
      expect((await resp).status()).toBe(409);
      await expect(d.getByText("No se puede borrar una evaluación que ya tiene intentos.")).toBeVisible();
      await d.getByRole("button", { name: "Cancelar" }).click();
      await expect(page.getByRole("paragraph").filter({ hasText: new RegExp(`^${EV}$`) })).toBeVisible();
    });
    const idEv = curso.evaluaciones[EV];
    await verificarAuditoria(abrirContexto, [
      { accion: "HTTP POST (409)", resultado: "Error", usuario: ins.correo, recursoContiene: `evaluaciones/${idEv}/preguntas` },
      { accion: "HTTP DELETE (409)", resultado: "Error", usuario: ins.correo, recursoContiene: `evaluaciones/${idEv}` },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU025-08
  test("CP-HU025-08 — Archivar y despublicar @P2 @HU-025", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, caso: "CP-HU025-08", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const ins = await instructor(abrirContexto);
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Archivar" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "curcatalogo" });
    const pe = await sesion(abrirContexto, est);
    const enCatalogo = () => pe.getByRole("heading", { name: curso.titulo, exact: true });
    await test.step("Precondición: el curso publicado aparece en el catálogo del estudiante", async () => {
      await pe.getByRole("link", { name: "Mis cursos" }).click();
      await expect(enCatalogo()).toBeVisible();
    });
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    await ed.ir();
    await ed.abrirEditor(curso.titulo);
    let idLectura;
    await test.step("1. «Editar Lectura E2E» → «Despublicar contenido»: «Contenido despublicado.»", async () => {
      await ed.pestana("Contenido").click();
      await page.getByRole("button", { name: "Editar Lectura E2E" }).click();
      const e = page.getByRole("dialog", { name: "Editar contenido" });
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/contenidos\/\d+\/despublicar$/.test(new URL(r.url()).pathname));
      await medir("despublicar contenido", UMBRAL, () => e.getByRole("button", { name: "Despublicar contenido" }).click(),
        () => expect(page.getByText("Contenido despublicado.").first()).toBeVisible());
      const r = await resp;
      expect(r.status()).toBeLessThan(400);
      idLectura = new URL(r.url()).pathname.match(/contenidos\/(\d+)/)[1];
      await e.getByRole("button", { name: "Cerrar" }).first().click();
    });
    await test.step("2. «Archivar» → «Sí, archivar»: «Curso archivado.»", async () => {
      await page.getByRole("button", { name: "Archivar" }).click();
      const d = page.getByRole("dialog");
      await medir("archivar curso", UMBRAL, () => d.getByRole("button", { name: "Sí, archivar" }).click(),
        () => expect(page.getByText("Curso archivado.").first()).toBeVisible());
    });
    await test.step("Resultado: el curso desaparece del catálogo del estudiante", async () => {
      await pe.reload();
      await expect(pe.getByRole("heading", { name: "Mis cursos", level: 1 })).toBeVisible();
      await expect(enCatalogo()).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "CONTENIDO_DESPUBLICADO", resultado: "Permitido", usuario: ins.correo, recursoContiene: `contenidos/${idLectura}` },
      { accion: "CURSO_ARCHIVADO", resultado: "Permitido", usuario: ins.correo, recursoContiene: `cursos/${curso.id}` },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU025-09
  test("CP-HU025-09 — Validación de opciones de pregunta @P3 @HU-025", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU025-09", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "Con ajuste", referenciaPlan: "Adicional",
      ajuste: "D-44 (diferencia): en selección única la UI solo deja una opción correcta (marcar otra desmarca la anterior), así que no se puede enviar «2 correctas». El rechazo del servidor se cubre en CP-HU025-11 (E2E-API)" });
    const { page, ed } = await cursoNuevo(abrirContexto, "E2E-Opciones");
    const p = page.getByRole("dialog", { name: "Preguntas: Quiz de opciones" });
    await test.step("Precondición: «Nueva evaluación» «Quiz de opciones» → se abre «Preguntas»", async () => {
      await ed.pestana("Evaluaciones y tareas").click();
      await page.getByRole("button", { name: `Nueva evaluación en ${MODULO}` }).click();
      const d = page.getByRole("dialog", { name: "Nueva evaluación" });
      await escribir(d.getByLabel("Título"), "Quiz de opciones");
      await ed.observarPost(/^\/api\/modulos\/\d+\/evaluaciones$/, () => d.getByRole("button", { name: "Crear evaluación" }).click());
      await expect(p).toBeVisible();
    });
    const agregar = p.getByRole("button", { name: "Agregar pregunta" });
    const correcta = (i) => p.getByRole("checkbox", { name: "Es correcta" }).nth(i);
    await test.step("1. Selección única con dos opciones y ninguna correcta: «Marca cuál opción es la correcta.»", async () => {
      await escribir(p.getByLabel("Enunciado"), "¿Cuál es la capital de Colombia?");
      await elegir(p.getByLabel("Tipo de pregunta"), "Selección única (una respuesta correcta)");
      await escribir(p.getByLabel("Opción 1", { exact: true }), "Bogotá");
      await escribir(p.getByLabel("Opción 2", { exact: true }), "Medellín");
      for (const i of [0, 1]) if (await correcta(i).isChecked()) await correcta(i).click();
      await expect(agregar).toBeDisabled();
      await expect(p.getByText("Marca cuál opción es la correcta.")).toBeVisible();
    });
    await test.step("2. Marcar las dos opciones como correctas: la selección única solo deja una marcada y no se envía nada", async () => {
      const enviadas = [];
      page.on("request", (r) => { if (r.method() === "POST" && /\/api\/evaluaciones\/\d+\/preguntas$/.test(new URL(r.url()).pathname)) enviadas.push(r); });
      await correcta(0).click();
      await expect(correcta(0)).toBeChecked();
      await correcta(1).click();
      const marcadas = [await correcta(0).isChecked(), await correcta(1).isChecked()];
      test.info().annotations.push({ type: "casillasTrasMarcarLasDos", description: JSON.stringify(marcadas) });
      expect(marcadas, "solo la última queda marcada").toEqual([false, true]);
      expect(enviadas.length).toBe(0);
    });
  });
  // ------------------------------------------------------------------ CP-HU025-10 (E2E-API, D-43)
  test("CP-HU025-10 — Portada > 5 MB por API: mismo límite que el navegador @P2 @HU-025 @api", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU025-10", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "E2E-API",
      referenciaPlan: "§7.12.1; §7.12.2; D-43 (agregado por el usuario el 12/11/2026)" });
    const ins = await instructor(abrirContexto);
    const page = await sesion(abrirContexto, ins);
    const token = await tokenDeSesion(page);
    const RUTA = "/api/instructor/cursos/portada";
    // Solo lectura, para diagnosticar «no se guarda»: carpeta de portadas del backend (vlearning.uploads.dir = uploads).
    const carpeta = path.resolve("..", "v-learning-platform", "backend", "learning-platform", "uploads", "portadas");
    const archivos = () => (fs.existsSync(carpeta) ? fs.readdirSync(carpeta).length : 0);
    const subir = async (bytes) => {
      const t0 = performance.now();
      const r = await page.request.post(RUTA, { headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false,
        multipart: { archivo: { name: "portada.png", mimeType: "image/png", buffer: pngDeTamano(bytes) } } });
      let cuerpo = null;
      try { cuerpo = await r.json(); } catch { /* sin JSON */ }
      return { status: r.status(), cuerpo, ms: Math.round(performance.now() - t0) };
    };
    const filas = [];
    for (const [nombre, bytes] of [["5 MB + 1 byte", 5 * MB + 1], ["6 MB", 6 * MB]]) {
      await test.step(`1. POST ${RUTA} con ${nombre} (${bytes} bytes): rechazo claro (no 500 ni traza) y no se guarda`, async () => {
        const antes = archivos();
        const r = await subir(bytes);
        const despues = archivos();
        filas.push({ nombre, status: r.status, codigo: r.cuerpo?.codigo, mensaje: r.cuerpo?.mensaje, archivosAntes: antes, archivosDespues: despues });
        test.info().annotations.push({ type: `respuesta ${nombre}`, description: JSON.stringify(filas.at(-1)) });
        expect.soft(r.status, "4xx, no 500").toBeGreaterThanOrEqual(400);
        expect.soft(r.status, "4xx, no 500").toBeLessThan(500);
        expect.soft(JSON.stringify(r.cuerpo ?? {}), "sin trazas ni nombres de clases").not.toMatch(/Exception|at [\w.$]+\(|java\.|org\.springframework/);
        expect.soft(r.cuerpo?.mensaje, "mensaje claro del tamaño").toBe("La imagen no puede superar los 5 MB.");
        expect(despues, "no se guarda ningún archivo").toBe(antes);
      });
    }
    await test.step(`2. POST ${RUTA} con 5 MB exactos (${5 * MB} bytes): el servidor acepta el mismo límite que el navegador`, async () => {
      const antes = archivos();
      const r = await subir(5 * MB);
      test.info().annotations.push({ type: "respuesta 5 MB", description: JSON.stringify({ status: r.status, url: r.cuerpo?.url }) });
      expect(r.status, "5 MB exactos: el navegador lo envía y el servidor debe aceptarlo").toBe(200);
      expect(r.cuerpo?.url).toMatch(/^\/api\/archivos\/portadas\/.+\.png$/);
      expect(archivos()).toBe(antes + 1);
      const g = await page.request.get(r.cuerpo.url);
      expect(g.status()).toBe(200);
      expect((await g.body()).length).toBe(5 * MB);
    });
  });

  // ------------------------------------------------------------------ CP-HU025-11 (E2E-API, D-44)
  test("CP-HU025-11 — Selección única con 2 correctas por API @P3 @HU-025 @api", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU025-11", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-API",
      referenciaPlan: "Adicional; D-44 (agregado por el usuario el 12/11/2026)" });
    const { page, ed, c } = await cursoNuevo(abrirContexto, "E2E-OpcionesAPI");
    const idEv = await test.step("Precondición: «Nueva evaluación» «Quiz por API» creada por la UI", async () => {
      await ed.pestana("Evaluaciones y tareas").click();
      await page.getByRole("button", { name: `Nueva evaluación en ${MODULO}` }).click();
      const d = page.getByRole("dialog", { name: "Nueva evaluación" });
      await escribir(d.getByLabel("Título"), "Quiz por API");
      const ev = await ed.observarPost(/^\/api\/modulos\/\d+\/evaluaciones$/, () => d.getByRole("button", { name: "Crear evaluación" }).click());
      await page.getByRole("dialog", { name: "Preguntas: Quiz por API" }).getByRole("button", { name: "Cerrar" }).first().click();
      return ev.id;
    });
    const token = await tokenDeSesion(page);
    const ruta = `/api/evaluaciones/${idEv}/preguntas`;
    await test.step(`1. POST ${ruta}: selección única con dos opciones correctas → 400 con el mensaje del plan`, async () => {
      const r = await pedir(page, "POST", ruta, { token, datos: { enunciado: "¿Cuál es la capital de Colombia?", tipo: "SELECCION_UNICA", puntaje: 10,
        opciones: [{ texto: "Bogotá", correcta: true }, { texto: "Medellín", correcta: true }] } });
      test.info().annotations.push({ type: "respuesta", description: JSON.stringify({ status: r.status, codigo: r.cuerpo?.codigo, mensaje: r.cuerpo?.mensaje }) });
      expect(r.status).toBe(400);
      expect(r.cuerpo?.codigo).toBe("OPCIONES_INVALIDAS");
      expect(r.cuerpo?.mensaje).toBe("La selección única necesita al menos 2 opciones y exactamente 1 correcta.");
    });
    await test.step("Resultado: no se guardó (la siguiente pregunta válida queda en la posición 1)", async () => {
      const r = await pedir(page, "POST", ruta, { token, datos: { enunciado: "Pregunta válida después del rechazo", tipo: "SELECCION_UNICA", puntaje: 10,
        opciones: [{ texto: "Bogotá", correcta: true }, { texto: "Medellín", correcta: false }] } });
      test.info().annotations.push({ type: "preguntaValida", description: JSON.stringify({ status: r.status, orden: r.cuerpo?.orden }) });
      expect(r.status).toBeLessThan(300);
      expect(r.cuerpo?.orden, "si la inválida se hubiera guardado, esta sería la 2").toBe(1);
    });
    await verificarAuditoria(abrirContexto, { accion: "HTTP POST (400)", resultado: "Error", usuario: c.ins.correo, recursoContiene: `evaluaciones/${idEv}/preguntas` });
  });
});
