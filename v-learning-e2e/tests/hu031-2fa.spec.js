import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cerrarSesion, cuentaLista } from "../support/sesiones.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import { pedir, tokenDeSesion } from "../support/api.js";
import { escribir } from "../support/humano.js";
import { LoginPage } from "../pages/LoginPage.js";

const base = { hu: "HU-031", rf: "RF-031" };
const UMBRAL = U.s(2, "Cambio de la verificación en dos pasos ≤ 2 s (§7.7, solo se registra)");
const MSG_OBLIGATORIA = "Es obligatoria para tu rol: cada vez que inicies sesión te enviaremos un código a tu correo institucional.";
const MSG_PASS_INCORRECTA = "Escribe tu contraseña actual para desactivar la verificación en dos pasos.";
const MSG_DESACTIVADA = "Desactivaste la verificación en dos pasos.";
const MSG_ACTIVADA = "Activaste la verificación en dos pasos.";

/** Entra por /login en un contexto nuevo; devuelve { page, camino } ("OTP" o "DIRECTO"). */
async function entrar(abrirContexto, cuenta) {
  const ctx = await abrirContexto();
  const page = await ctx.newPage();
  const camino = await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.password);
  await expect(page).toHaveURL(/\/inicio/);
  return { page, camino };
}

/**
 * Abre /configuracion desde el menú lateral («Menú principal» → «Configuración»). En escritorio el
 * menú desplegable con el nombre está oculto: el perfil va en el panel «Tu perfil».
 */
async function irAConfiguracion(page) {
  await page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Configuración" }).click();
  await expect(page).toHaveURL(/\/configuracion/);
  const seccion = page.getByRole("region", { name: "Verificación en dos pasos" });
  await expect(seccion).toBeVisible();
  return seccion;
}

const interruptor = (seccion) => seccion.getByRole("switch", { name: "Pedir un código al iniciar sesión" });
const aviso = (page, texto) => page.getByRole("status").filter({ hasText: texto });

/** Desactiva la 2FA confirmando con la contraseña dada; devuelve el HTTP del PUT. */
async function desactivar(page, seccion, password, esperarResultado) {
  await interruptor(seccion).click();
  const campo = seccion.getByLabel("Confirma tu contraseña para desactivarla", { exact: true });
  await expect(campo).toBeVisible();
  await escribir(campo, password, { secreto: true });
  const resp = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/api/auth/doble-factor"));
  await medir("desactivar la verificación en dos pasos", UMBRAL,
    () => seccion.getByRole("button", { name: "Desactivar", exact: true }).click(),
    esperarResultado);
  return (await resp).status();
}

/** Cierra la sesión y vuelve a entrar en la misma página; devuelve el camino del login. */
async function reentrar(page, cuenta) {
  await cerrarSesion(page);
  const camino = await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.password);
  await expect(page).toHaveURL(/\/inicio/);
  return camino;
}

test.describe("HU-031 · Verificación en dos pasos del estudiante (RF-031)", () => {
  // ------------------------------------------------------------------ CP-HU031-02
  test("CP-HU031-02 — Activada por defecto para un estudiante nuevo @P1 @HU-031", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU031-02", tecnica: "estado", clasificacion: "Ruta Crítica",
      clase: "E2E-UI", referenciaPlan: "§7.3" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "2fadef" });
    usuarioProbado(est.correo);

    const { page, camino } = await test.step("1. Login: pide el código de 6 dígitos", () => entrar(abrirContexto, est));
    expect(camino, "El login de un estudiante nuevo debe pasar por «Revisa tu código»").toBe("OTP");

    await test.step("2. /configuracion: «Pedir un código al iniciar sesión» activado", async () => {
      const seccion = await irAConfiguracion(page);
      await expect(interruptor(seccion)).toHaveAttribute("aria-checked", "true");
      await expect(seccion.getByText("Activado", { exact: true })).toBeVisible();
    });
  });

  // ------------------------------------------------------------------ CP-HU031-03
  test("CP-HU031-03 — Desactivar con la contraseña correcta @P1 @HU-031", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU031-03", tecnica: "estado", clasificacion: "Ruta Crítica",
      clase: "E2E-UI", referenciaPlan: "TC-2FA-01; Tabla A fila 4; §7.3" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "2faoff" });
    usuarioProbado(est.correo);
    const { page } = await entrar(abrirContexto, est);
    const seccion = await test.step("1. Abrir /configuracion", () => irAConfiguracion(page));

    await test.step("2. Desactivar el interruptor → «Confirma tu contraseña para desactivarla» → «Desactivar»", async () => {
      const status = await desactivar(page, seccion, est.password, () => expect(aviso(page, MSG_DESACTIVADA)).toBeVisible());
      expect(status).toBe(200);
      await expect(interruptor(seccion)).toHaveAttribute("aria-checked", "false");
      await expect(seccion.getByText("Sin este paso, tu cuenta solo está protegida por la contraseña.")).toBeVisible();
    });

    await test.step("3. Cerrar sesión y volver a entrar: entra directo, sin «Revisa tu código»", async () => {
      expect(await reentrar(page, est)).toBe("DIRECTO");
    });

    await verificarAuditoria(abrirContexto, {
      accion: "DOBLE_FACTOR_DESACTIVADO", resultado: "Permitido", usuario: est.correo, recurso: `usuarios/${est.id}`,
    });
  });

  // ------------------------------------------------------------------ CP-HU031-04
  test("CP-HU031-04 — Desactivar con la contraseña incorrecta @P1 @HU-031", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU031-04", tecnica: "partición", clasificacion: "Ruta Alterna",
      clase: "E2E-UI", referenciaPlan: "TC-2FA-01" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "2famal" });
    usuarioProbado(est.correo);
    const { page } = await entrar(abrirContexto, est);
    const seccion = await test.step("1. Abrir /configuracion", () => irAConfiguracion(page));

    await test.step("2. Desactivar con una contraseña errada", async () => {
      const status = await desactivar(page, seccion, `${est.password}x`,
        () => expect(seccion.getByRole("alert").filter({ hasText: MSG_PASS_INCORRECTA })).toBeVisible());
      expect(status).toBe(400);
    });

    await test.step("Resultado: la verificación sigue activada (también tras recargar)", async () => {
      await expect(interruptor(seccion)).toHaveAttribute("aria-checked", "true");
      await expect(aviso(page, MSG_DESACTIVADA)).toHaveCount(0);
      await page.reload();
      await expect(interruptor(page.getByRole("region", { name: "Verificación en dos pasos" }))).toHaveAttribute("aria-checked", "true");
    });

    await test.step("El siguiente login sigue pidiendo el código", async () => {
      expect(await reentrar(page, est)).toBe("OTP");
    });

    await verificarAuditoria(abrirContexto, {
      accion: "DOBLE_FACTOR_DESACTIVAR_FALLIDO", resultado: "Denegado", usuario: est.correo,
    });
  });

  // ------------------------------------------------------------------ CP-HU031-01
  test("CP-HU031-01 — El instructor no puede desactivarla @P1 @HU-031 @api", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU031-01", tecnica: "seguridad", clasificacion: "Ruta Alterna",
      clase: "E2E-API", referenciaPlan: "§7.14; TC-2FA-01",
      ajuste: "D-13: el servicio no audita el intento; el catálogo esperaba `HTTP PUT (403)` del filtro",
      defecto: "D-21" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "2fains" });
    usuarioProbado(ins.correo);
    protegerCuenta(ins.correo, "DENEGACION", 1);

    const { page, camino } = await entrar(abrirContexto, ins);
    expect(camino, "El instructor siempre pasa por el código").toBe("OTP");

    await test.step("1. UI: /configuracion muestra que es obligatoria y no hay interruptor", async () => {
      const seccion = await irAConfiguracion(page);
      await expect(seccion.getByText(MSG_OBLIGATORIA)).toBeVisible();
      await expect(seccion.getByRole("switch")).toHaveCount(0);
    });

    await test.step("2. API: PUT /api/auth/doble-factor para desactivarla con su sesión", async () => {
      const token = await tokenDeSesion(page);
      const r = await pedir(page, "PUT", "/api/auth/doble-factor",
        { token, datos: { habilitado: false, password: ins.password } });
      registrarEvento(ins.correo, "DENEGACION");
      test.info().annotations.push({
        type: "rendimiento",
        description: JSON.stringify({ metrica: "rechazo de la desactivación (403)", valorMs: r.ms,
          umbrales: [{ fuente: UMBRAL.fuente, umbralMs: UMBRAL.ms, cumple: r.ms <= UMBRAL.ms }] }),
      });
      expect(r.status).toBe(403);
      expect(r.cuerpo?.codigo).toBe("DOBLE_FACTOR_OBLIGATORIO");
      expect(r.cuerpo?.mensaje).toBe("La verificación en dos pasos es obligatoria para tu rol.");
    });

    await test.step("Resultado: el siguiente login sigue pidiendo el código", async () => {
      expect(await reentrar(page, ins)).toBe("OTP");
    });

    // D-21 (defecto, 11/11/2026): AuditoriaFilter omite todo /api/auth/ y AuthService no registra el
    // 403 DOBLE_FACTOR_OBLIGATORIO, así que el intento no deja ninguna fila. El plan pide «intento
    // auditado»: la expectativa no se cambia y el caso queda fallando.
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP PUT (403)", resultado: "Denegado", usuario: ins.correo,
    });
  });

  // ------------------------------------------------------------------ CP-HU031-05
  test("CP-HU031-05 — Volver a activarla @P2 @HU-031", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P2", caso: "CP-HU031-05", tecnica: "estado", clasificacion: "Adicional",
      clase: "E2E-UI", referenciaPlan: "Adicional" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "2faon" });
    usuarioProbado(est.correo);
    const { page } = await entrar(abrirContexto, est);
    const seccion = await irAConfiguracion(page);

    await test.step("Precondición: la verificación está desactivada", async () => {
      expect(await desactivar(page, seccion, est.password, () => expect(aviso(page, MSG_DESACTIVADA)).toBeVisible())).toBe(200);
      await expect(interruptor(seccion)).toHaveAttribute("aria-checked", "false");
    });

    await test.step("1. Activar el interruptor → «Activaste la verificación en dos pasos.»", async () => {
      const resp = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/api/auth/doble-factor"));
      await medir("activar la verificación en dos pasos", UMBRAL,
        () => interruptor(seccion).click(),
        () => expect(aviso(page, MSG_ACTIVADA)).toBeVisible());
      expect((await resp).status()).toBe(200);
      await expect(interruptor(seccion)).toHaveAttribute("aria-checked", "true");
    });

    await test.step("2. Cerrar sesión y volver a entrar: pide el código", async () => {
      expect(await reentrar(page, est)).toBe("OTP");
    });

    await verificarAuditoria(abrirContexto, [
      { accion: "DOBLE_FACTOR_DESACTIVADO", resultado: "Permitido", usuario: est.correo, recurso: `usuarios/${est.id}` },
      { accion: "DOBLE_FACTOR_ACTIVADO", resultado: "Permitido", usuario: est.correo, recurso: `usuarios/${est.id}` },
    ]);
  });
});
