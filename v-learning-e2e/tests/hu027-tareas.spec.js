import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cuentaLista } from "../support/sesiones.js";
import { escribir } from "../support/humano.js";
import { sesion, armarCurso, MODULO } from "../support/cursos.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";

const base = { hu: "HU-027", rf: "RF-027", prioridad: "P2" };
const UMBRAL = U.s(2, "§7.3 tareas < 2 s");

/** Instructor desechable compartido por los casos del worker. */
let ins27 = null;
async function instructor(abrirContexto) {
  if (!ins27) ins27 = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "tarins" });
  return ins27;
}

/** El instructor abre «Evaluaciones y tareas» del curso. */
async function editorTareas(abrirContexto, ins, curso) {
  const page = await sesion(abrirContexto, ins);
  const ed = new CursosInstructorPage(page);
  await ed.ir();
  await ed.abrirEditor(curso.titulo);
  await ed.pestana("Evaluaciones y tareas").click();
  return { page, ed };
}

/** El estudiante abre el curso; devuelve la tarjeta de la tarea. */
async function tarjetaTarea(page, curso, tarea) {
  await page.getByRole("link", { name: "Mis cursos", exact: true }).click();
  await page.getByRole("link", { name: curso.titulo, exact: true }).click();
  await expect(page.getByRole("heading", { name: curso.titulo, level: 1 })).toBeVisible();
  const t = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: tarea }) });
  await expect(t).toHaveCount(1);
  return t;
}

/** «Entregar/Editar entrega <tarea>» → texto y enlace → «Enviar/Reenviar entrega» (midiendo) → «Entrega guardada.» */
async function entregar(page, tarjeta, tarea, { texto, enlace, boton, metrica }) {
  await tarjeta.getByRole("button", { name: new RegExp(`^(Entregar|Editar entrega) ${tarea}$`) }).click();
  const d = page.getByRole("dialog", { name: tarea });
  if (texto !== undefined) await escribir(d.getByLabel("Tu respuesta"), texto);
  if (enlace !== undefined) await escribir(d.getByLabel("Enlace a tu trabajo (opcional)"), enlace);
  const resp = page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/tareas\/\d+\/entrega$/.test(new URL(r.url()).pathname));
  await medir(metrica, UMBRAL, () => d.getByRole("button", { name: boton }).click(), () => expect(page.getByText("Entrega guardada.").first()).toBeVisible());
  expect((await resp).status()).toBeLessThan(400);
  await expect(d).toBeHidden();
}

/** Campana de notificaciones: devuelve el panel «Centro de notificaciones». */
async function notificaciones(page) {
  await page.getByRole("button", { name: /^Notificaciones/ }).first().click();
  const p = page.getByRole("region", { name: "Centro de notificaciones" });
  await expect(p).toBeVisible();
  return p;
}

test.describe("HU-027 · Tareas calificables (RF-027)", () => {
  // ------------------------------------------------------------------ CP-HU027-01
  test("CP-HU027-01 — Crear la tarea y notificar @P3 @HU-027", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU027-01", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const ins = await instructor(abrirContexto);
    usuarioProbado(ins.correo);
    const est = await cuentaLista(abrirContexto, { etiqueta: "tarnotif" });
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Tarea", inscritos: [est] });
    const TAREA = "Ensayo del módulo";
    const { page, ed } = await editorTareas(abrirContexto, ins, curso);
    let id;
    await test.step(`1. «Nueva tarea» → «Título» = ${TAREA}, «Instrucciones», «Puntaje máximo» = 20 → «Guardar tarea»`, async () => {
      await page.getByRole("button", { name: "Nueva tarea en este módulo" }).click();
      const d = page.getByRole("dialog", { name: "Nueva tarea" });
      await escribir(d.getByLabel("Título"), TAREA);
      await escribir(d.getByLabel("Instrucciones"), "Escribe un ensayo corto sobre el módulo.");
      await escribir(d.getByLabel("Puntaje máximo"), "20");
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/modulos\/\d+\/tareas$/.test(new URL(r.url()).pathname));
      await medir("crear tarea", UMBRAL, () => d.getByRole("button", { name: "Guardar tarea" }).click(),
        () => expect(page.getByText("Tarea creada y notificada a los estudiantes.").first()).toBeVisible());
      const r = await resp;
      expect(r.status()).toBeLessThan(400);
      id = (await r.json()).id;
      await expect(d).toBeHidden();
    });
    await test.step(`Resultado: el estudiante inscrito recibe la notificación «Nueva tarea: ${TAREA}»`, async () => {
      const pe = await sesion(abrirContexto, est);
      const p = await notificaciones(pe);
      await expect(p.getByText(`Nueva tarea: ${TAREA}`).first()).toBeVisible();
      await pe.context().close();
    });
    await verificarAuditoria(abrirContexto, { accion: "TAREA_CREADA", resultado: "Permitido", usuario: ins.correo, recursoContiene: `tareas/${id}` });
  });

  // ------------------------------------------------------------------ CP-HU027-02
  test("CP-HU027-02 — Entrega con texto y enlace, y entrega vacía @P2 @HU-027", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, caso: "CP-HU027-02", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3; TC-TAR-01" });
    const ins = await instructor(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "tarentrega" });
    usuarioProbado(est.correo);
    const TAREA = "Tarea de entrega";
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Entrega", tareas: [TAREA], inscritos: [est] });
    const page = await sesion(abrirContexto, est);
    const t = await tarjetaTarea(page, curso, TAREA);
    await test.step("1. Entrega vacía: «Enviar entrega» deshabilitado con «Escribe tu respuesta o agrega un enlace.»", async () => {
      await t.getByRole("button", { name: `Entregar ${TAREA}` }).click();
      const d = page.getByRole("dialog", { name: TAREA });
      await expect(d.getByRole("button", { name: "Enviar entrega" })).toBeDisabled();
      await expect(d.getByText("Escribe tu respuesta o agrega un enlace.")).toBeVisible();
      await d.getByRole("button", { name: "Cancelar" }).click();
      await expect(d).toBeHidden();
    });
    await test.step("2. «Tu respuesta» y «Enlace a tu trabajo (opcional)» → «Enviar entrega»: «Entrega guardada.» y «Entregada, pendiente de calificar»", async () => {
      await entregar(page, t, TAREA, { texto: "Mi primera respuesta.", enlace: "https://example.org/e2e/trabajo", boton: "Enviar entrega", metrica: "enviar entrega" });
      await expect(t.getByText(/^Entregada, pendiente de calificar$/i)).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, { accion: "TAREA_ENTREGADA", resultado: "Permitido", usuario: est.correo, recursoContiene: `tareas/${curso.tareas[TAREA]}` });
  });

  // ------------------------------------------------------------------ CP-HU027-03
  test("CP-HU027-03 — Modificar antes de calificar @P2 @HU-027", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, caso: "CP-HU027-03", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "TC-TAR-01; §7.3" });
    const ins = await instructor(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "tarreenvio" });
    usuarioProbado(est.correo);
    const TAREA = "Tarea para reenviar";
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Reenvio", tareas: [TAREA], inscritos: [est] });
    const page = await sesion(abrirContexto, est);
    let t = await tarjetaTarea(page, curso, TAREA);
    await test.step("Precondición: la tarea ya está entregada", () =>
      entregar(page, t, TAREA, { texto: "Versión 1 de la respuesta.", boton: "Enviar entrega", metrica: "primera entrega" }));
    await test.step("1. «Editar entrega» → nuevo texto → «Reenviar entrega»", () =>
      entregar(page, t, TAREA, { texto: "Versión 2 de la respuesta, corregida.", boton: "Reenviar entrega", metrica: "reenviar entrega" }));
    await test.step("Resultado: se reemplaza y se ve «Última entrega: …»", async () => {
      await page.reload();
      t = await tarjetaTarea(page, curso, TAREA);
      await expect(t.getByText(/^Última entrega: /)).toBeVisible();
      await t.getByRole("button", { name: `Editar entrega ${TAREA}` }).click();
      const d = page.getByRole("dialog", { name: TAREA });
      await expect(d.getByLabel("Tu respuesta")).toHaveValue("Versión 2 de la respuesta, corregida.");
      await d.getByRole("button", { name: "Cancelar" }).click();
    });
    await verificarAuditoria(abrirContexto, { accion: "TAREA_REENVIADA", resultado: "Permitido", usuario: est.correo, recursoContiene: `tareas/${curso.tareas[TAREA]}` });
  });

  // ------------------------------------------------------------------ CP-HU027-04
  test("CP-HU027-04 — Calificar con retroalimentación; notificación; ya no se puede modificar @P2 @HU-027", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, caso: "CP-HU027-04", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "Con ajuste", referenciaPlan: "TC-TAR-01; §7.3",
      ajuste: "D-46 (diferencia): «Editar entrega» queda visible pero deshabilitado con «Ya fue calificada.»; se valida que la entrega no cambia" });
    const ins = await instructor(abrirContexto);
    usuarioProbado(ins.correo);
    const est = await cuentaLista(abrirContexto, { etiqueta: "tarnota" });
    const TAREA = "Tarea para calificar";
    const RETRO = "Buen trabajo; revisa la conclusión.";
    const TEXTO = "Respuesta para calificar.";
    let ultimaEntrega;
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Calificar", tareas: [TAREA], inscritos: [est] });
    await test.step("Precondición: el estudiante entrega la tarea", async () => {
      const pe = await sesion(abrirContexto, est);
      const t = await tarjetaTarea(pe, curso, TAREA);
      await entregar(pe, t, TAREA, { texto: TEXTO, boton: "Enviar entrega", metrica: "entrega previa" });
      ultimaEntrega = (await t.getByText(/^Última entrega:/).innerText()).trim();
      await pe.context().close();
    });
    let idEntrega;
    await test.step(`1. Instructor: «Entregas» → puntaje 8 y «Retroalimentación (opcional)» → «Calificar»`, async () => {
      const { page } = await editorTareas(abrirContexto, ins, curso);
      await page.getByRole("button", { name: `Entregas de ${TAREA}` }).click();
      const d = page.getByRole("dialog", { name: `Entregas: ${TAREA}` });
      const entrega = d.getByRole("listitem").filter({ hasText: est.correo });
      await expect(entrega).toHaveCount(1);
      await escribir(entrega.getByLabel(/^Puntaje \(0 a /), "8");
      await escribir(entrega.getByLabel("Retroalimentación (opcional)"), RETRO);
      const resp = page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/entregas\/\d+\/calificacion$/.test(new URL(r.url()).pathname));
      await medir("calificar tarea", UMBRAL, () => entrega.getByRole("button", { name: "Calificar" }).click(),
        () => expect(entrega.getByText(/^Calificada: 8(\.0+)?\//i)).toBeVisible());
      const r = await resp;
      expect(r.status()).toBeLessThan(400);
      idEntrega = new URL(r.url()).pathname.match(/entregas\/(\d+)/)[1];
      await page.context().close();
    });
    await test.step("2. Estudiante: insignia «Calificada», «Retroalimentación del instructor: …», notificación y «Editar entrega» deshabilitado con «Ya fue calificada.» (D-46)", async () => {
      const pe = await sesion(abrirContexto, est);
      const p = await notificaciones(pe);
      await expect(p.getByText(`Tarea calificada: ${TAREA}`).first()).toBeVisible();
      await pe.keyboard.press("Escape");
      const t = await tarjetaTarea(pe, curso, TAREA);
      await expect(t.getByText(/^Calificada: 8(\.0+)? de 10/i)).toBeVisible();
      await expect(t.getByText("Retroalimentación del instructor:")).toBeVisible();
      await expect(t.getByText(RETRO)).toBeVisible();
      const editar = t.getByRole("button", { name: `Editar entrega ${TAREA}` });
      await expect(editar, "D-46: el botón queda visible pero no se puede usar").toBeDisabled();
      await expect(t.getByText("Ya fue calificada.")).toBeVisible();
      await expect(pe.getByRole("dialog", { name: TAREA })).toHaveCount(0);
      await expect(t.getByText(/^Última entrega:/), "la fecha de la entrega no cambia").toHaveText(ultimaEntrega);
      await pe.context().close();
    });
    await test.step("3. Instructor: en «Entregas» la entrega sigue igual (mismo texto y misma fecha)", async () => {
      const { page } = await editorTareas(abrirContexto, ins, curso);
      await page.getByRole("button", { name: `Entregas de ${TAREA}` }).click();
      const d = page.getByRole("dialog", { name: `Entregas: ${TAREA}` });
      const entrega = d.getByRole("listitem").filter({ hasText: est.correo });
      await expect(entrega).toHaveCount(1);
      await expect(entrega.getByText(TEXTO, { exact: true })).toBeVisible();
      await expect(entrega.getByText(/^Calificada: 8(\.0+)?\//i)).toBeVisible();
      await page.context().close();
    });
    await verificarAuditoria(abrirContexto, { accion: "TAREA_CALIFICADA", resultado: "Permitido", usuario: ins.correo, recursoContiene: `entregas_tarea/${idEntrega}` });
  });

  // ------------------------------------------------------------------ CP-HU027-05
  test("CP-HU027-05 — Tarea vencida @P3 @HU-027", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU027-05", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "Con ajuste", referenciaPlan: "§7.3",
      ajuste: "El formulario sí acepta una fecha pasada: se crea con «Fecha límite (opcional)» = ayer 10:00 a. m. (no hizo falta esperar 2 min)" });
    const ins = await instructor(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "tarvencida" });
    usuarioProbado(est.correo);
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Vencida", inscritos: [est] });
    const TAREA = "Tarea vencida";
    const ayer = new Date(Date.now() - 24 * 3600 * 1000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" }); // AAAA-MM-DD
    await test.step(`Precondición: el instructor crea «${TAREA}» con fecha límite ${ayer} 10:00 a. m.`, async () => {
      const { page } = await editorTareas(abrirContexto, ins, curso);
      await page.getByRole("button", { name: "Nueva tarea en este módulo" }).click();
      const d = page.getByRole("dialog", { name: "Nueva tarea" });
      await escribir(d.getByLabel("Título"), TAREA);
      await escribir(d.getByLabel("Puntaje máximo"), "10");
      const fecha = d.getByLabel("Fecha límite (opcional)");
      const [a, m, dd] = ayer.split("-");
      await fecha.click({ position: { x: 8, y: 8 } });
      await fecha.pressSequentially(`${dd}${m}${a}`, { delay: 60 });
      await fecha.press("Tab");
      await fecha.pressSequentially("1000a", { delay: 60 });
      await expect(fecha).toHaveValue(`${ayer}T10:00`);
      await page.getByRole("dialog", { name: "Nueva tarea" }).getByRole("button", { name: "Guardar tarea" }).click();
      await expect(page.getByText("Tarea creada y notificada a los estudiantes.").first()).toBeVisible();
      await page.context().close();
    });
    await test.step("1. El estudiante abre la tarea: «Plazo vencido» y «El plazo de entrega venció.»", async () => {
      const pe = await sesion(abrirContexto, est);
      const t = await tarjetaTarea(pe, curso, TAREA);
      await expect(t.getByText(/^Plazo vencido$/i)).toBeVisible();
      await expect(t.getByRole("button", { name: `Entregar ${TAREA}` })).toBeDisabled();
      await expect(t.getByText("El plazo de entrega venció.")).toBeVisible();
    });
  });
});
