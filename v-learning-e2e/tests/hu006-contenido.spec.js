import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cuentaLista, cerrarSesion } from "../support/sesiones.js";
import { sesion } from "../support/cursos.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import { marca } from "../support/datos.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";

const base = { hu: "HU-006", rf: "RF-005", prioridad: "P2" };
const UMBRAL_CURSO = [U.s(2, "HU: contenido personalizado < 2 s"), U.s(3, "RF-005 < 3 s")];
const UMBRAL_2S = U.s(2, "§7.3 < 2 s");
const UMBRAL_3S = U.s(3, "§7.3 < 3 s");
const MSG_SIN_AFIN = "Este módulo no tiene contenidos en tu método preferido; te mostramos los formatos disponibles.";

/**
 * Curso compartido por los casos de este archivo, armado por la UI la primera vez que se pide:
 * - «Módulo E2E»: un video, un podcast y una lectura, creados en ese orden (por id la lectura va
 *   última; si sale primera es por el método del estudiante).
 * - «Módulo sin lectura»: solo un video (para el aviso de formato no disponible).
 * Lo crea un instructor desechable; cada estudiante se inscribe solo desde «Mis cursos».
 */
let curso = null;
async function cursoBase(abrirContexto) {
  if (curso) return curso;
  const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "inscont" });
  curso = await test.step("Precondición: el instructor arma el curso con lectura, video y podcast", async () => {
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const c = { titulo: `E2E-Contenido-${marca()}`, m1: "Módulo E2E", m2: "Módulo sin lectura" };
    await ed.ir();
    c.id = await ed.crearCurso(c.titulo, "Curso de las pruebas E2E de contenido personalizado.");
    await ed.abrirEditor(c.titulo);
    await ed.crearModulo(c.m1);
    c.video = { titulo: "Video E2E" };
    c.video.id = await ed.crearContenidoPublicado(c.m1, c.video.titulo, { formato: "Video", url: "https://example.org/e2e/video.mp4" });
    c.podcast = { titulo: "Podcast E2E" };
    c.podcast.id = await ed.crearContenidoPublicado(c.m1, c.podcast.titulo, { formato: "Podcast", url: "https://example.org/e2e/podcast.mp3" });
    c.lectura = { titulo: "Lectura E2E" };
    c.lectura.id = await ed.crearContenidoPublicado(c.m1, c.lectura.titulo, { formato: "Lectura",
      texto: "Lectura corta de las pruebas E2E sobre contenido personalizado." });
    await ed.crearModulo(c.m2);
    c.video2 = { titulo: "Video sin lectura E2E" };
    c.video2.id = await ed.crearContenidoPublicado(c.m2, c.video2.titulo, { formato: "Video", url: "https://example.org/e2e/video2.mp4" });
    await ed.publicarCurso();
    await cerrarSesion(page);
    await page.context().close();
    return c;
  });
  return curso;
}

/** Estudiante desechable (test VARK de lectura/escritura, sin segundo método) con la sesión abierta. */
async function estudiante(abrirContexto, etiqueta) {
  const est = await cuentaLista(abrirContexto, { etiqueta });
  usuarioProbado(est.correo);
  const page = await sesion(abrirContexto, est);
  return { est, page };
}

/** «Mis cursos» → «Inscribirme en <curso>». */
async function inscribirse(page, c) {
  await test.step(`Precondición: inscribirse en «${c.titulo}»`, async () => {
    await page.getByRole("link", { name: "Mis cursos" }).click();
    await page.getByRole("button", { name: `Inscribirme en ${c.titulo}` }).click();
    await expect(page.getByText(`Te inscribiste en «${c.titulo}».`).first()).toBeVisible();
  });
}

const modulo = (page, n, titulo) => page.getByRole("region", { name: new RegExp(`^Módulo ${n}: ${titulo}`) });
const items = (region) => region.getByRole("listitem");

/** Abre el curso desde «Mis cursos» y mide hasta «Contenidos ordenados para tu método:». */
async function abrirCurso(page, c, umbral = UMBRAL_CURSO) {
  await page.getByRole("link", { name: "Mis cursos" }).click();
  await medir("Abrir el curso con los contenidos ordenados", umbral,
    () => page.getByRole("link", { name: c.titulo, exact: true }).click(),
    () => expect(page.getByText("Contenidos ordenados para tu método:")).toBeVisible());
  await expect(page.getByRole("heading", { name: c.titulo, level: 1 })).toBeVisible();
}

test.describe("HU-006 · Contenido personalizado (RF-005)", () => {
  test("CP-HU006-01 — Orden según el método principal @P2 @HU-006", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU006-01", tecnica: "flujo", clasificacion: "Ruta Crítica", referenciaPlan: "TC-CONT-01; §7.3",
      ajuste: "Estudiante desechable con VARK de lectura y curso armado en el caso (el curso base del setup solo tiene una lectura)" });
    const c = await cursoBase(abrirContexto);
    const { page } = await estudiante(abrirContexto, "contord");
    await inscribirse(page, c);
    await test.step("1. /cursos → curso → módulo", () => abrirCurso(page, c));
    await test.step("Resultado: la lectura va primero y solo ella lleva «Recomendado para ti»", async () => {
      await expect(page.getByText("Contenidos ordenados para tu método:").locator("..")).toContainText("Lectura y escritura");
      const lista = items(modulo(page, 1, c.m1));
      await expect(lista).toHaveCount(3);
      await expect(lista.nth(0).getByRole("link")).toHaveText(c.lectura.titulo);
      await expect(lista.nth(0).getByText("Recomendado para ti")).toBeVisible();
      for (const i of [1, 2]) await expect(lista.nth(i).getByText("Recomendado para ti")).toHaveCount(0);
      // Video y podcast tienen el mismo rango: quedan en el orden de creación.
      await expect(lista.nth(1).getByRole("link")).toHaveText(c.video.titulo);
      await expect(lista.nth(2).getByRole("link")).toHaveText(c.podcast.titulo);
    });
  });

  test("CP-HU006-02 — Cambio manual de métodos @P2 @HU-006", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU006-02", tecnica: "estado", clasificacion: "Ruta Alterna", referenciaPlan: "§7.3 cambio manual de métodos",
      ajuste: "Estudiante desechable (lectura) para no cambiar el método del estudiante del setup" });
    const c = await cursoBase(abrirContexto);
    const { est, page } = await estudiante(abrirContexto, "contmet");
    await inscribirse(page, c);
    await test.step("Precondición: en el curso la lectura va primero", async () => {
      await abrirCurso(page, c);
      await expect(items(modulo(page, 1, c.m1)).nth(0).getByRole("link")).toHaveText(c.lectura.titulo);
    });
    await test.step("1. /configuracion → «Método principal» = Auditivo → «Guardar métodos»", async () => {
      await page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Configuración" }).click();
      await expect(page).toHaveURL(/\/configuracion/);
      const metodos = page.getByRole("region", { name: "Métodos de aprendizaje" });
      await metodos.getByRole("radiogroup", { name: "Método principal" }).getByRole("radio", { name: /^Auditivo/ }).click();
      await medir("Guardar métodos", UMBRAL_2S,
        () => metodos.getByRole("button", { name: "Guardar métodos" }).click(),
        () => expect(page.getByText("Actualizamos tus métodos de aprendizaje.").first()).toBeVisible());
    });
    await test.step("2. Volver al curso: ahora el podcast va primero con «Recomendado para ti»", async () => {
      await abrirCurso(page, c);
      await expect(page.getByText("Contenidos ordenados para tu método:").locator("..")).toContainText("Auditivo");
      const lista = items(modulo(page, 1, c.m1));
      await expect(lista.nth(0).getByRole("link")).toHaveText(c.podcast.titulo);
      await expect(lista.nth(0).getByText("Recomendado para ti")).toBeVisible();
      await expect(lista.filter({ hasText: c.lectura.titulo }).getByText("Recomendado para ti")).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, { accion: "VARK_METODOS_CAMBIADOS", resultado: "Permitido", usuario: est.correo });
  });

  test("CP-HU006-03 — Fallback cuando falta el formato del método @P2 @HU-006", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU006-03", tecnica: "límite", clasificacion: "Ruta Alterna", referenciaPlan: "TC-CONT-01; §7.3" });
    const c = await cursoBase(abrirContexto);
    const { page } = await estudiante(abrirContexto, "contfal");
    await inscribirse(page, c);
    await test.step("1. Abrir el curso y el módulo que solo tiene video", () => abrirCurso(page, c));
    await test.step("Resultado: aviso de formato no disponible y el video a la vista", async () => {
      const m2 = modulo(page, 2, c.m2);
      await expect(m2.getByText(MSG_SIN_AFIN)).toBeVisible();
      await expect(items(m2)).toHaveCount(1);
      await expect(items(m2).nth(0).getByRole("link")).toHaveText(c.video2.titulo);
      await expect(modulo(page, 1, c.m1).getByText(MSG_SIN_AFIN)).toHaveCount(0);
    });
  });

  test("CP-HU006-04 — Registro de avance y tiempo @P2 @HU-006", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU006-04", tecnica: "flujo", clasificacion: "Ruta Crítica", referenciaPlan: "TC-CONT-01; §7.3 avance y tiempo" });
    const c = await cursoBase(abrirContexto);
    const { page } = await estudiante(abrirContexto, "contava");
    await inscribirse(page, c);
    const progreso = () => page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Mi progreso" });
    const valor = (rotulo) => page.locator("dt", { hasText: rotulo }).locator("xpath=following-sibling::dd");
    await test.step("Precondición: «Mi progreso» sin contenidos completados", async () => {
      await progreso().click();
      await expect(page).toHaveURL(/\/progreso/);
      // El texto del estado vacío lo manda el servidor («Aún no tienes actividad, y eso está bien…»).
      const vacio = page.getByText(/no tienes actividad/);
      await expect(vacio.or(valor("Contenidos completados"))).toBeVisible();
      if (!(await vacio.isVisible())) await expect(valor("Contenidos completados")).toHaveText("0");
    });
    await test.step("1. Abrir la lectura y quedarse unos segundos", async () => {
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await page.getByRole("link", { name: c.titulo, exact: true }).click();
      await page.getByRole("link", { name: c.lectura.titulo, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/contenidos/${c.lectura.id}$`));
      await page.waitForTimeout(5_000);
    });
    await test.step("2. «Marcar como completado» → «¡Contenido completado!»", async () => {
      await medir("Marcar como completado", UMBRAL_3S,
        () => page.getByRole("button", { name: "Marcar como completado" }).click(),
        () => expect(page.getByText("¡Contenido completado!").first()).toBeVisible());
    });
    await test.step("3. /progreso: sube «Contenidos completados» y el tiempo", async () => {
      await progreso().click();
      await expect(valor("Contenidos completados")).toHaveText("1");
      await expect(valor("Tiempo de estudio")).toHaveText(/^\d+ (s|min)$/);
      const tiempo = (await valor("Tiempo de estudio").innerText()).trim();
      expect(tiempo, "El tiempo registrado es mayor que cero").not.toBe("0 s");
    });
  });

  test("CP-HU006-05 — Estudiante no inscrito no accede @P2 @HU-006", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU006-05", tecnica: "seguridad", clasificacion: "Ruta Alterna", referenciaPlan: "§7.3" });
    const c = await cursoBase(abrirContexto);
    const { est, page } = await estudiante(abrirContexto, "contnoi");
    protegerCuenta(est.correo, "DENEGACION", 1);
    await test.step(`1. Ir directo a /contenidos/${c.lectura.id} sin estar inscrito`, async () => {
      const resp = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === `/api/contenidos/${c.lectura.id}`);
      await page.goto(`/contenidos/${c.lectura.id}`);
      expect((await resp).status()).toBe(403);
      registrarEvento(est.correo, "DENEGACION");
    });
    await test.step("Resultado: «Inscríbete en el curso para ver este contenido.»", async () => {
      await expect(page.getByText("Inscríbete en el curso para ver este contenido.")).toBeVisible();
      await expect(page.getByText("Lectura corta de las pruebas E2E sobre contenido personalizado.")).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, { accion: "HTTP GET (403)", resultado: "Denegado", usuario: est.correo, recursoContiene: `/api/contenidos/${c.lectura.id}` });
  });
});
