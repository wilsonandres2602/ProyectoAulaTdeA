import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cuentaLista } from "../support/sesiones.js";
import { entrarALaComunidad, sesion, armarCurso } from "../support/cursos.js";
import { escribir } from "../support/humano.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import { pedir, tokenDeSesion } from "../support/api.js";
import { leerDatos } from "../support/datosCompartidos.js";

const base = { hu: "HU-028", rf: "RF-028" };

test.describe("HU-028 · Moderar la comunidad (RF-028)", () => {
  // ------------------------------------------------------------------ CP-HU028-06 (API)
  test("CP-HU028-06 — El estudiante no modera @P1 @HU-028 @api", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU028-06", tecnica: "seguridad", clasificacion: "Ruta Alterna",
      clase: "E2E-API", referenciaPlan: "§7.3; §7.12.4 (403)",
      ajuste: "No hay DELETE de mensajes: «Eliminar» de la UI es POST /api/mensajes/<id>/ocultar, así que la fila es `HTTP POST (403)` y no `HTTP DELETE (403)`" });
    const d = leerDatos();
    const est = await cuentaLista(abrirContexto, { etiqueta: "nomodera" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "DENEGACION", 1);
    const page = await sesion(abrirContexto, est);
    await entrarALaComunidad(page, d.cursoA);
    const texto = `Mensaje para probar la moderación ${Date.now()}`;

    const id = await test.step("Precondición: el estudiante publica un mensaje (el id se observa en la respuesta)", async () => {
      await escribir(page.getByLabel("Escribe un mensaje"), texto);
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/cursos\/\d+\/mensajes$/.test(r.url()));
      await page.getByRole("button", { name: "Enviar", exact: true }).click();
      const r = await resp;
      expect(r.status()).toBeLessThan(400);
      await expect(page.getByRole("log", { name: "Mensajes del curso" }).getByText(texto, { exact: true })).toBeVisible();
      return (await r.json()).id;
    });
    await test.step("1. UI: no hay controles de moderación para el estudiante", async () => {
      await expect(page.getByRole("tab", { name: /Mensajes reportados/ })).toHaveCount(0);
      const log = page.getByRole("log", { name: "Mensajes del curso" });
      await expect(log.getByRole("button", { name: /^(Eliminar|Mantener)/ })).toHaveCount(0);
      await expect(page.getByRole("switch", { name: "Cola de reenvío de mensajes" })).toHaveCount(0);
    });
    const ruta = `/api/mensajes/${id}/ocultar`;
    await test.step(`2. API: POST ${ruta} («Eliminar») → 403 «No tienes permiso para moderar.»`, async () => {
      const r = await pedir(page, "POST", ruta, { token: await tokenDeSesion(page) });
      registrarEvento(est.correo, "DENEGACION");
      expect(r.status).toBe(403);
      expect(r.cuerpo?.mensaje).toBe("No tienes permiso para moderar.");
    });
    await test.step("Resultado: el mensaje sigue en la conversación", async () => {
      await page.reload();
      await expect(page.getByText("Conversación en tiempo real")).toBeVisible();
      await expect(page.getByRole("log", { name: "Mensajes del curso" }).getByText(texto, { exact: true })).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP POST (403)", resultado: "Denegado", usuario: est.correo, recurso: ruta,
    });
  });
});

// =================================================================== CP-HU028-01…05 (P2, sin setup)

const UMBRAL_MOD = U.s(1, "§7.3 moderar < 1 s");
const log = (page) => page.getByRole("log", { name: "Mensajes del curso" });
const itemMensaje = (page, texto) => log(page).getByRole("listitem").filter({ has: page.getByText(texto, { exact: true }) });

/** Curso publicado (instructor desechable) con dos estudiantes A y B, compartido por los casos del worker. */
let esc28 = null;
async function escenario28(abrirContexto) {
  if (esc28) return esc28;
  const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "modins" });
  const a = await cuentaLista(abrirContexto, { etiqueta: "moda" });
  const b = await cuentaLista(abrirContexto, { etiqueta: "modb" });
  const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Moderar" });
  esc28 = { ins, a, b, curso, inscritos: new Set() };
  return esc28;
}

/** Entra a la Comunidad del curso (la primera vez el estudiante se inscribe desde el catálogo). */
async function comunidad(abrirContexto, e, cuenta) {
  const page = await sesion(abrirContexto, cuenta);
  if (cuenta.rol === "INSTRUCTOR" || e.inscritos.has(cuenta.correo)) {
    await test.step(`Precondición: ${cuenta.correo} abre la Comunidad de «${e.curso.titulo}»`, async () => {
      await page.getByRole("link", { name: "Comunidad", exact: true }).click();
      await page.getByRole("combobox", { name: "Curso" }).selectOption({ label: e.curso.titulo });
      await expect(page.getByText("Conversación en tiempo real")).toBeVisible();
    });
  } else {
    await entrarALaComunidad(page, e.curso);
    e.inscritos.add(cuenta.correo);
  }
  return page;
}

/** El estudiante publica un mensaje; devuelve su id (observado en la respuesta). */
async function publicar(page, texto) {
  await escribir(page.getByLabel("Escribe un mensaje"), texto);
  const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/cursos\/\d+\/mensajes$/.test(new URL(r.url()).pathname));
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const r = await resp;
  expect(r.status()).toBeLessThan(400);
  await expect(log(page).getByText(texto, { exact: true })).toBeVisible();
  return (await r.json()).id;
}

/** A publica un mensaje y B lo reporta. Devuelve { id, pb }. */
async function mensajeReportado(abrirContexto, e, texto) {
  const pa = await comunidad(abrirContexto, e, e.a);
  const id = await publicar(pa, texto);
  await pa.context().close();
  const pb = await comunidad(abrirContexto, e, e.b);
  const item = itemMensaje(pb, texto);
  await expect(item).toHaveCount(1);
  const resp = pb.waitForResponse((r) => r.request().method() === "POST" && new RegExp(`/api/mensajes/${id}/reportar$`).test(new URL(r.url()).pathname));
  await item.getByRole("button", { name: `Reportar mensaje de ${e.a.nombre}` }).click();
  const r = await resp;
  expect(r.status()).toBeLessThan(400);
  return { id, pb, aviso: (await r.json().catch(() => ({}))).mensaje };
}

/** El instructor abre «Mensajes reportados» y devuelve la tarjeta del mensaje. */
async function tarjetaReportada(abrirContexto, e, texto) {
  const page = await comunidad(abrirContexto, e, e.ins);
  await page.getByRole("tablist", { name: "Secciones de la comunidad" }).getByRole("tab", { name: /^Mensajes reportados/ }).click();
  await expect(page.getByRole("heading", { name: /^Mensajes reportados \(\d+\)$/ })).toBeVisible();
  const tarjeta = page.getByRole("listitem").filter({ has: page.getByText(texto, { exact: true }) });
  await expect(tarjeta).toHaveCount(1);
  return { page, tarjeta };
}

test.describe("HU-028 · Moderar la comunidad, P2 (RF-028)", () => {
  // ------------------------------------------------------------------ CP-HU028-01
  test("CP-HU028-01 — Reportar un mensaje ajeno: queda en revisión sin borrarse @P2 @HU-028", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU028-01", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "TC-MOD-01; §7.3; ENVIADO→REPORTADO" });
    const e = await escenario28(abrirContexto);
    usuarioProbado(e.b.correo);
    const texto = `Mensaje para reportar ${Date.now()}`;
    const { id, pb, aviso } = await test.step("1. A publica un mensaje; B: «Reportar» en el mensaje de A", () => mensajeReportado(abrirContexto, e, texto));
    await test.step("Resultado: insignia «Reportado · en revisión»; el mensaje sigue visible", async () => {
      test.info().annotations.push({ type: "avisoAlReportar", description: String(aviso) });
      const item = itemMensaje(pb, texto);
      await expect(item.getByText("Reportado · en revisión", { exact: true })).toBeVisible();
      await expect(item.getByText(texto, { exact: true })).toBeVisible();
      await expect(item.getByRole("button", { name: /^Reportar/ })).toHaveCount(0);
      await pb.reload();
      await expect(itemMensaje(pb, texto).getByText("Reportado · en revisión", { exact: true })).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, { accion: "MENSAJE_REPORTADO", resultado: "Permitido", usuario: e.b.correo, recursoContiene: `mensajes/${id}` });
  });

  // ------------------------------------------------------------------ CP-HU028-02
  test("CP-HU028-02 — No se puede reportar el mensaje propio @P2 @HU-028", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU028-02", tecnica: "seguridad", clasificacion: "Ruta Alterna", clase: "Con ajuste", referenciaPlan: "TC-MOD-01; §7.12.4 (400 REPORTE_PROPIO)",
      ajuste: "La UI no muestra «Reportar» en los mensajes propios (`!mio`); se valida que no aparece. El 400 «No puedes reportar tu propio mensaje.» no se puede producir por la UI" });
    const e = await escenario28(abrirContexto);
    usuarioProbado(e.a.correo);
    const texto = `Mensaje propio ${Date.now()}`;
    const pa = await comunidad(abrirContexto, e, e.a);
    await test.step("1. A publica un mensaje y lo ve en la conversación", () => publicar(pa, texto));
    await test.step("Resultado: el mensaje propio («Tú») no tiene «Reportar»", async () => {
      const item = itemMensaje(pa, texto);
      await expect(item.getByText("Tú", { exact: true })).toBeVisible();
      await expect(item.getByRole("button", { name: /^Reportar/ })).toHaveCount(0);
      await pa.reload();
      await expect(itemMensaje(pa, texto).getByRole("button", { name: /^Reportar/ })).toHaveCount(0);
    });
  });

  // ------------------------------------------------------------------ CP-HU028-03
  test("CP-HU028-03 — Lista de reportados del instructor @P2 @HU-028", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU028-03", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3",
      ajuste: "La precondición «caso 01» (un mensaje de A reportado por B) se arma dentro del caso" });
    const e = await escenario28(abrirContexto);
    usuarioProbado(e.ins.correo);
    const texto = `Mensaje reportado para la lista ${Date.now()}`;
    await test.step("Precondición (caso 01): A publica y B reporta", async () => { const { pb } = await mensajeReportado(abrirContexto, e, texto); await pb.context().close(); });
    await test.step("1. Instructor: /comunidad → «Secciones de la comunidad» → «Mensajes reportados»: el mensaje aparece «En revisión»", async () => {
      const { tarjeta } = await tarjetaReportada(abrirContexto, e, texto);
      await expect(tarjeta.getByText("En revisión", { exact: true })).toBeVisible();
      await expect(tarjeta.getByText(e.curso.titulo, { exact: true })).toBeVisible();
      await expect(tarjeta.getByText(e.a.nombre, { exact: true })).toBeVisible();
      await expect(tarjeta.getByRole("button", { name: `Eliminar mensaje de ${e.a.nombre}` })).toBeVisible();
      await expect(tarjeta.getByRole("button", { name: `Mantener mensaje de ${e.a.nombre}` })).toBeVisible();
    });
  });

  // ------------------------------------------------------------------ CP-HU028-04
  test("CP-HU028-04 — Eliminar: REPORTADO→OCULTO @P2 @HU-028", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU028-04", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "TC-MOD-01; §7.3" });
    const e = await escenario28(abrirContexto);
    usuarioProbado(e.ins.correo);
    const texto = `Mensaje para eliminar ${Date.now()}`;
    const { id, pb } = await test.step("Precondición: A publica y B reporta", () => mensajeReportado(abrirContexto, e, texto));
    await test.step("1. Instructor: «Eliminar» → «Sí, eliminar»: «El mensaje se eliminó.»", async () => {
      const { page, tarjeta } = await tarjetaReportada(abrirContexto, e, texto);
      await tarjeta.getByRole("button", { name: `Eliminar mensaje de ${e.a.nombre}` }).click();
      const d = page.getByRole("dialog", { name: "¿Eliminar este mensaje?" });
      await medir("eliminar mensaje reportado", UMBRAL_MOD, () => d.getByRole("button", { name: "Sí, eliminar" }).click(),
        () => expect(page.getByText("El mensaje se eliminó.").first()).toBeVisible());
      await expect(page.getByRole("listitem").filter({ has: page.getByText(texto, { exact: true }) })).toHaveCount(0);
    });
    await test.step("Resultado: B ya no lo ve", async () => {
      await pb.reload();
      await expect(pb.getByText("Conversación en tiempo real")).toBeVisible();
      await expect(log(pb).getByText(texto, { exact: true })).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, { accion: "MENSAJE_ELIMINADO", resultado: "Permitido", usuario: e.ins.correo, recursoContiene: `mensajes/${id}` });
  });

  // ------------------------------------------------------------------ CP-HU028-05
  test("CP-HU028-05 — Mantener: REPORTADO→ENVIADO @P2 @HU-028", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU028-05", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3; §7.12.4" });
    const e = await escenario28(abrirContexto);
    usuarioProbado(e.ins.correo);
    const texto = `Mensaje para mantener ${Date.now()}`;
    const { id, pb } = await test.step("Precondición: A publica y B reporta (otro mensaje)", () => mensajeReportado(abrirContexto, e, texto));
    await test.step("1. Instructor: «Mantener»", async () => {
      const { page, tarjeta } = await tarjetaReportada(abrirContexto, e, texto);
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && new RegExp(`/api/mensajes/${id}/`).test(new URL(r.url()).pathname));
      await medir("mantener mensaje reportado", UMBRAL_MOD, () => tarjeta.getByRole("button", { name: `Mantener mensaje de ${e.a.nombre}` }).click(),
        () => expect(page.getByRole("listitem").filter({ has: page.getByText(texto, { exact: true }) })).toHaveCount(0));
      const r = await resp;
      expect(r.status()).toBeLessThan(400);
      test.info().annotations.push({ type: "avisoAlMantener", description: String((await r.json().catch(() => ({}))).mensaje) });
    });
    await test.step("Resultado: pierde la insignia de reportado y sigue visible", async () => {
      await pb.reload();
      const item = itemMensaje(pb, texto);
      await expect(item.getByText(texto, { exact: true })).toBeVisible();
      await expect(item.getByText("Reportado · en revisión", { exact: true })).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, { accion: "REPORTE_DESCARTADO", resultado: "Permitido", usuario: e.ins.correo, recursoContiene: `mensajes/${id}` });
  });
});
