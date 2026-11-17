import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { cfg } from "../support/config.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cuentaLista, entrarComoAdmin } from "../support/sesiones.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import { MSG_BLOQUEO_ADMIN, MSG_GENERICO } from "../support/desbloqueo.js";
import { LoginPage } from "../pages/LoginPage.js";
import { UsuariosPage } from "../pages/UsuariosPage.js";

const base = { hu: "HU-030", rf: "RF-030", prioridad: "P1" };
const UMBRAL = U.s(2, "Cambio de estado ≤ 2 s (§7.7, solo se registra)");
const SIN_CONFIRMACION = "La UI no pide confirmación al bloquear, desactivar o activar: la acción se aplica con el clic";

/** Entra por /login en un contexto nuevo como la cuenta dada. */
async function sesion(abrirContexto, cuenta) {
  const ctx = await abrirContexto();
  const page = await ctx.newPage();
  await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.password);
  await expect(page).toHaveURL(/\/inicio/);
  return page;
}

/** El administrador entra y abre /usuarios filtrado por el correo. */
async function adminEnUsuarios(abrirContexto, correo) {
  const ctx = await abrirContexto();
  const page = await ctx.newPage();
  await entrarComoAdmin(page);
  const usuarios = new UsuariosPage(page);
  await usuarios.irA(correo);
  return usuarios;
}

/** Pulsa una acción de estado de la fila y mide hasta el aviso; devuelve el HTTP del PATCH. */
async function cambiarEstado(usuarios, cuenta, accion, textoEstado) {
  const page = usuarios.page;
  const resp = page.waitForResponse((r) => r.request().method() === "PATCH"
    && r.url().endsWith(`/api/admin/usuarios/${cuenta.id}/estado`));
  await medir(`${accion.toLowerCase()} una cuenta`, UMBRAL,
    () => usuarios.boton(cuenta.nombre, accion).click(),
    () => expect(usuarios.aviso(`${cuenta.nombre}: ahora está ${textoEstado.toLowerCase()}.`)).toBeVisible());
  const status = (await resp).status();
  await expect(usuarios.estado(cuenta.correo)).toHaveText(textoEstado);
  return status;
}

/** La sesión abierta de la persona deja de servir: al navegar, el API responde 401 y vuelve a /login. */
async function sesionCerrada(page, cuenta) {
  const r401 = page.waitForResponse((r) => r.url().includes("/api/") && r.status() === 401);
  await page.getByRole("link", { name: "Mis cursos" }).click();
  await r401;
  registrarEvento(cuenta.correo, "DENEGACION");
  await expect(page).toHaveURL(/\/login/);
}

test.describe("HU-030 · Administrar cuentas (RF-030)", () => {
  // ------------------------------------------------------------------ CP-HU030-02
  test("CP-HU030-02 — Indicadores del panel del administrador @P1 @HU-030", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU030-02", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "§7.3" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "panel" });
    usuarioProbado(est.correo);

    const ctx = await abrirContexto();
    const page = await ctx.newPage();
    await entrarComoAdmin(page);
    const metrica = (nombre) => page.getByRole("list", { name: "Métricas" })
      .getByRole("link", { name: new RegExp(nombre) }).locator("dd");
    const leer = async (nombre) => Number((await metrica(nombre).innerText()).replace(/\D/g, ""));
    const antes = await test.step("1. /inicio: leer «Usuarios bloqueados» y «Estudiantes activos»", async () => {
      await expect(metrica("Usuarios bloqueados")).toBeVisible();
      return { bloqueados: await leer("Usuarios bloqueados"), activos: await leer("Estudiantes activos") };
    });
    test.info().annotations.push({ type: "indicadoresAntes", description: JSON.stringify(antes) });

    await test.step(`2. /usuarios: «Bloquear a ${est.nombre}»`, async () => {
      const usuarios = new UsuariosPage(page);
      // exact: hay otro acceso «Gestionar usuarios Altas, …» más abajo en el panel.
      await page.getByRole("link", { name: "Gestionar usuarios", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Usuarios", level: 1 })).toBeVisible();
      await usuarios.buscar(est.correo);
      await expect(page.getByText("1 usuario(s) encontrados.")).toBeVisible();
      expect(await cambiarEstado(usuarios, est, "Bloquear", "Bloqueado")).toBe(200);
    });

    await test.step("3. Volver a «Inicio»: los indicadores cambian en 1", async () => {
      await page.getByRole("link", { name: "Inicio", exact: true }).click();
      await expect(page).toHaveURL(/\/inicio/);
      await expect.poll(() => leer("Usuarios bloqueados")).toBe(antes.bloqueados + 1);
      expect(await leer("Estudiantes activos")).toBe(antes.activos - 1);
    });
  });

  // ------------------------------------------------------------------ CP-HU030-01
  test("CP-HU030-01 — Bloquear una cuenta con la sesión abierta @P1 @HU-030", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU030-01", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "§7.14; TC-ADM-01; TE-05", ajuste: SIN_CONFIRMACION });
    const est = await cuentaLista(abrirContexto, { etiqueta: "bloq" });
    usuarioProbado(est.correo);
    const pe = await test.step("Precondición: el estudiante tiene la sesión abierta en otro contexto", () => sesion(abrirContexto, est));

    const usuarios = await adminEnUsuarios(abrirContexto, est.correo);
    await test.step(`1. Admin: «Bloquear a ${est.nombre}»`, async () => {
      expect(await cambiarEstado(usuarios, est, "Bloquear", "Bloqueado")).toBe(200);
    });
    await test.step("2. Estudiante: navega a «Mis cursos» y vuelve a /login (401)", () => sesionCerrada(pe, est));
    await test.step("3. Estudiante: reintenta el login", async () => {
      const login = new LoginPage(pe);
      await login.ir();
      expect(await login.intentar(est.correo, est.password)).toBe(423);
      await expect(login.error(MSG_BLOQUEO_ADMIN)).toBeVisible();
      await expect(pe).toHaveURL(/\/login/);
    });
    await verificarAuditoria(abrirContexto, {
      accion: "USUARIO_ESTADO_BLOQUEADO", resultado: "Permitido", usuario: cfg.adminCorreo, recurso: `usuarios/${est.id}`,
    });
  });

  // ------------------------------------------------------------------ CP-HU030-03
  test("CP-HU030-03 — Inactivar una cuenta @P1 @HU-030", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU030-03", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "TE-05", ajuste: SIN_CONFIRMACION });
    const est = await cuentaLista(abrirContexto, { etiqueta: "inact" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "LOGIN_FALLIDO", 1);

    const usuarios = await adminEnUsuarios(abrirContexto, est.correo);
    await test.step(`1. Admin: «Desactivar a ${est.nombre}» → insignia «Inactivo»`, async () => {
      expect(await cambiarEstado(usuarios, est, "Desactivar", "Inactivo")).toBe(200);
    });
    await test.step("2. El estudiante intenta entrar con su contraseña correcta", async () => {
      const login = new LoginPage(page);
      await login.ir();
      expect(await login.intentar(est.correo, est.password)).toBe(401);
      registrarEvento(est.correo, "LOGIN_FALLIDO");
      await expect(login.error(MSG_GENERICO)).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    });
    await verificarAuditoria(abrirContexto, {
      accion: "USUARIO_ESTADO_INACTIVO", resultado: "Permitido", usuario: cfg.adminCorreo, recurso: `usuarios/${est.id}`,
    });
  });

  // ------------------------------------------------------------------ CP-HU030-04
  test("CP-HU030-04 — Activar una cuenta bloqueada @P1 @HU-030", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU030-04", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "TE-06", ajuste: SIN_CONFIRMACION });
    const est = await cuentaLista(abrirContexto, { etiqueta: "activ" });
    usuarioProbado(est.correo);

    const usuarios = await adminEnUsuarios(abrirContexto, est.correo);
    await test.step(`Precondición: «Bloquear a ${est.nombre}»`, async () => {
      expect(await cambiarEstado(usuarios, est, "Bloquear", "Bloqueado")).toBe(200);
    });
    await test.step(`1. Admin: «Activar a ${est.nombre}» → «Activo»`, async () => {
      expect(await cambiarEstado(usuarios, est, "Activar", "Activo")).toBe(200);
    });
    await test.step("2. El estudiante entra con su contraseña", async () => {
      const pe = await sesion(abrirContexto, est);
      await expect(pe.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, {
      accion: "USUARIO_ESTADO_ACTIVO", resultado: "Permitido", usuario: cfg.adminCorreo, recurso: `usuarios/${est.id}`,
    });
  });

  // ------------------------------------------------------------------ CP-HU030-05
  test("CP-HU030-05 — Reenviar credenciales a una cuenta activa con sesión abierta @P1 @HU-030", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU030-05", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "TE-07; TC-ADM-01" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "reenv" });
    usuarioProbado(est.correo);
    const pe = await test.step("Precondición: el estudiante tiene la sesión abierta", () => sesion(abrirContexto, est));

    const usuarios = await adminEnUsuarios(abrirContexto, est.correo);
    await test.step(`1. Admin: «Reenviar credenciales a ${est.nombre}»`, async () => {
      const resp = usuarios.page.waitForResponse((r) => r.request().method() === "POST"
        && r.url().endsWith(`/api/admin/usuarios/${est.id}/reenviar-credenciales`));
      await medir("reenvío de credenciales", UMBRAL,
        () => usuarios.boton(est.nombre, "Reenviar credenciales").click(),
        () => expect(usuarios.dialogoCredenciales).toBeVisible());
      expect((await resp).status()).toBe(200);
      const { mensaje } = await usuarios.leerCredenciales();
      expect(mensaje).toMatch(/^Se generó una contraseña temporal nueva\./);
      await expect(usuarios.dialogoCredenciales.getByTestId("pass-temporal")).toBeVisible();
      await usuarios.cerrarCredenciales();
    });
    await test.step("2. La fila queda en «Primer acceso pendiente»", async () => {
      await expect(usuarios.estado(est.correo)).toHaveText("Primer acceso pendiente");
    });
    await test.step("3. La sesión abierta del estudiante se cierra al navegar", () => sesionCerrada(pe, est));
    await verificarAuditoria(abrirContexto, {
      accion: "CREDENCIALES_REENVIADAS", resultado: "Permitido", usuario: cfg.adminCorreo, recurso: `usuarios/${est.id}`,
    });
  });

  // ------------------------------------------------------------------ CP-HU030-06
  test("CP-HU030-06 — Una cuenta inactiva rechaza el reenvío de credenciales @P1 @HU-030", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU030-06", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "TE-08" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "reinac" });
    usuarioProbado(est.correo);

    const usuarios = await adminEnUsuarios(abrirContexto, est.correo);
    await test.step(`Precondición: «Desactivar a ${est.nombre}»`, async () => {
      expect(await cambiarEstado(usuarios, est, "Desactivar", "Inactivo")).toBe(200);
    });
    await test.step(`1. Admin: «Reenviar credenciales a ${est.nombre}»`, async () => {
      const resp = usuarios.page.waitForResponse((r) => r.request().method() === "POST"
        && r.url().endsWith(`/api/admin/usuarios/${est.id}/reenviar-credenciales`));
      await usuarios.boton(est.nombre, "Reenviar credenciales").click();
      expect((await resp).status()).toBe(409);
      await expect(usuarios.aviso("La cuenta está inactiva. Actívala antes de reenviar credenciales.")).toBeVisible();
      await expect(usuarios.dialogoCredenciales).toBeHidden();
      await expect(usuarios.estado(est.correo)).toHaveText("Inactivo");
    });
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP POST (409)", resultado: "Error", usuario: cfg.adminCorreo,
      recursoContiene: `/api/admin/usuarios/${est.id}/reenviar-credenciales`,
    });
  });

  // ------------------------------------------------------------------ CP-HU030-07
  test("CP-HU030-07 — El administrador no cambia el estado de su propia cuenta @P1 @HU-030", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU030-07", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "TE-09" });
    usuarioProbado(cfg.adminCorreo);
    // Un 400 queda como «Error» en la auditoría, no como «Denegado»: no suma al bloqueo por denegaciones.
    const usuarios = await adminEnUsuarios(abrirContexto, cfg.adminCorreo);
    await test.step("1. Fila del administrador: «Desactivar»", async () => {
      const fila = usuarios.fila(cfg.adminCorreo);
      await expect(usuarios.estado(cfg.adminCorreo)).toHaveText("Activo");
      const boton = fila.getByRole("button", { name: /^Desactivar a / });
      await expect(boton, "La UI muestra el botón en la fila propia").toBeVisible();
      const resp = usuarios.page.waitForResponse((r) => r.request().method() === "PATCH"
        && /\/api\/admin\/usuarios\/\d+\/estado$/.test(r.url()));
      await boton.click();
      expect((await resp).status()).toBe(400);
      await expect(usuarios.aviso("No puedes cambiar el estado de tu propia cuenta.")).toBeVisible();
      await expect(usuarios.estado(cfg.adminCorreo)).toHaveText("Activo");
    });
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP PATCH (400)", resultado: "Error", usuario: cfg.adminCorreo, recursoContiene: /\/api\/admin\/usuarios\/\d+\/estado$/,
    });
  });
});
