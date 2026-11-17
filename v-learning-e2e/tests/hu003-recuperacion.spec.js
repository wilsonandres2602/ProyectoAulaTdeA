import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { cfg, ETIQUETA_CORREO } from "../support/config.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cuentaLista, entrarComoAdmin } from "../support/sesiones.js";
import { escribir } from "../support/humano.js";
import { registrarSecreto } from "../support/secretos.js";
import { LoginPage } from "../pages/LoginPage.js";
import { UsuariosPage } from "../pages/UsuariosPage.js";

const base = { hu: "HU-003", rf: "RF-003", prioridad: "P1" };
const MSG_GENERICO = "Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña.";
const MSG_OK = "Tu contraseña se actualizó. Ya puedes iniciar sesión.";
const MSG_ENLACE = "El enlace venció o ya se usó. Solicita uno nuevo desde «¿Olvidaste tu contraseña?».";
const MSG_NO_CUMPLE = "La contraseña aún no cumple los requisitos.";

/** /login → «¿Olvidaste tu contraseña?» → correo → «Enviar enlace». Devuelve el enlace de desarrollo (o null). */
async function pedirEnlace(page, correo) {
  await new LoginPage(page).ir();
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page.getByRole("heading", { name: "Recupera tu contraseña" })).toBeVisible();
  await escribir(page.getByLabel(ETIQUETA_CORREO), correo);
  await medir("respuesta de recuperación", [U.s(3, "HU-003 < 3 s"), U.s(60, "RF-003 < 60 s (correo bloqueado sin SMTP)")],
    () => page.getByRole("button", { name: "Enviar enlace" }).click(),
    () => expect(page.getByRole("status").filter({ hasText: MSG_GENERICO })).toBeVisible());
  const enlace = page.locator("a.break-all");
  if (!(await enlace.isVisible())) return null;
  const href = await enlace.getAttribute("href");
  registrarSecreto(new URL(href).searchParams.get("token"));
  return href;
}

/** Abre el enlace (clic, como la persona) y escribe la contraseña nueva dos veces. */
async function escribirNueva(page, nueva, repetir = nueva) {
  await escribir(page.getByLabel("Contraseña nueva", { exact: true }), nueva, { secreto: true });
  await escribir(page.getByLabel("Repite la contraseña"), repetir, { secreto: true });
}

const guardar = (page) => page.getByRole("button", { name: "Guardar contraseña" });

async function abrirEnlace(page) {
  await page.locator("a.break-all").click();
  await expect(page.getByRole("heading", { name: "Crea una contraseña nueva" })).toBeVisible();
}

const conLongitud = (n) => `Ab#1${"x".repeat(n - 4)}`;

test.describe("HU-003 · Recuperar contraseña (RF-003)", () => {
  test("CP-HU003-02 — Respuesta genérica para correo registrado y no registrado @P1 @HU-003", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU003-02", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "Con ajuste",
      referenciaPlan: "§7.3 respuesta genérica; TC-REC-01",
      ajuste: "D-08: en modo desarrollo el correo registrado muestra además el enlace; aceptado solo en desarrollo" });
    const est = await cuentaLista(abrirContexto);
    const inexistente = `no.existe.${Date.now()}@${cfg.dominio}`;
    usuarioProbado(est.correo);
    let tRegistrado;
    let tNoRegistrado;
    await test.step("1. Solicitar enlace con el correo registrado", async () => {
      await pedirEnlace(page, est.correo);
      tRegistrado = (await page.getByRole("status").filter({ hasText: MSG_GENERICO }).innerText()).trim();
    });
    await test.step("2. Solicitar enlace con un correo no registrado", async () => {
      const href = await pedirEnlace(page, inexistente);
      expect(href).toBeNull();
      tNoRegistrado = (await page.getByRole("status").filter({ hasText: MSG_GENERICO }).innerText()).trim();
    });
    await test.step("Resultado: el mismo mensaje en ambos casos", () => {
      expect(tNoRegistrado).toBe(tRegistrado);
      expect(tRegistrado).toBe(MSG_GENERICO);
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "RECUPERACION_SOLICITADA", resultado: "Permitido", usuario: est.correo, recurso: est.correo },
      { accion: "RECUPERACION_SOLICITADA", resultado: "Denegado", usuario: "—", recurso: inexistente },
    ]);
  });

  test("CP-HU003-03 — Restablecer con enlace vigente e ingresar @P1 @HU-003", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU003-03", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "TC-REC-01; §7.12.1 contraseña válida" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    const nueva = `${cfg.e2ePassword}R`;
    await test.step("1. Solicitar el enlace", () => pedirEnlace(page, est.correo));
    await test.step("2. Abrir el enlace y escribir la contraseña nueva", async () => {
      await abrirEnlace(page);
      await escribirNueva(page, nueva);
    });
    await test.step("3. «Guardar contraseña»", async () => {
      await medir("restablecer contraseña", U.s(3, "HU-003 < 3 s"),
        () => guardar(page).click(),
        () => expect(page.getByRole("status").filter({ hasText: MSG_OK })).toBeVisible());
    });
    await test.step("4. «Ir a iniciar sesión» e ingresar con la nueva", async () => {
      await page.getByRole("link", { name: "Ir a iniciar sesión" }).click();
      await new LoginPage(page).iniciarSesion(est.correo, nueva);
      await expect(page).toHaveURL(/\/inicio/);
    });
    await verificarAuditoria(abrirContexto, { accion: "PASSWORD_RESTABLECIDA", resultado: "Permitido", usuario: est.correo, recurso: `usuarios/${est.id}` });
  });

  test("CP-HU003-01 — Enlace de recuperación reutilizado @P1 @HU-003", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU003-01", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.14 CP-HU003-01; §7.12.2 (segundo uso); TC-REC-01" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    const primera = `${cfg.e2ePassword}A`;
    let href;
    await test.step("Precondición: contraseña ya restablecida con un enlace", async () => {
      href = await pedirEnlace(page, est.correo);
      await abrirEnlace(page);
      await escribirNueva(page, primera);
      await guardar(page).click();
      await expect(page.getByRole("status").filter({ hasText: MSG_OK })).toBeVisible();
    });
    await test.step("1. Abrir de nuevo el mismo enlace", async () => {
      await page.goto(href);
      await expect(page.getByRole("heading", { name: "Crea una contraseña nueva" })).toBeVisible();
    });
    await test.step("2. Ingresar una contraseña válida → Guardar", async () => {
      await escribirNueva(page, `${cfg.e2ePassword}B`);
      await guardar(page).click();
    });
    await test.step("Resultado: ENLACE_INVALIDO, se ofrece otro enlace y la contraseña no cambia", async () => {
      await expect(page.getByRole("alert").filter({ hasText: MSG_ENLACE })).toBeVisible();
      await expect(page.getByRole("link", { name: "Pedir otro enlace" })).toBeVisible();
      await new LoginPage(page).iniciarSesion(est.correo, primera);
      await expect(page).toHaveURL(/\/inicio/);
    });
    await verificarAuditoria(abrirContexto, { accion: "RESTABLECER_ENLACE_INVALIDO", resultado: "Denegado", usuario: est.correo, recurso: "enlace vencido o usado" });
  });

  test("CP-HU003-04 — Política: contraseña de 9 caracteres @P1 @HU-003", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU003-04", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "Con ajuste",
      referenciaPlan: "§7.12.1 (menos de 10); §7.12.2 (9)", ajuste: "D-06: la UI no deja enviar, no hay 400 PASSWORD_DEBIL" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    await pedirEnlace(page, est.correo);
    await abrirEnlace(page);
    await test.step("1. Escribir 9 caracteres válidos", () => escribirNueva(page, conLongitud(9)));
    await test.step("Resultado: botón deshabilitado y la regla de longitud en «falta»", async () => {
      await expect(guardar(page)).toBeDisabled();
      await expect(page.getByText(MSG_NO_CUMPLE)).toBeVisible();
      await expect(page.getByRole("list", { name: "Requisitos de la contraseña" }).getByRole("listitem")
        .filter({ hasText: "Al menos 10 caracteres" })).toContainText(": falta");
    });
  });

  for (const [id, n] of [["CP-HU003-05", 10], ["CP-HU003-06", 72]]) {
    test(`${id} — Política: ${n} caracteres (límite válido) @P1 @HU-003`, async ({ page, abrirContexto }) => {
      caso({ ...base, caso: id, tecnica: "límite", clasificacion: "Ruta Crítica", clase: "E2E-UI",
        referenciaPlan: `§7.12.2 longitud de contraseña (${n})` });
      const est = await cuentaLista(abrirContexto);
      usuarioProbado(est.correo);
      await pedirEnlace(page, est.correo);
      await abrirEnlace(page);
      await test.step(`1. Escribir ${n} caracteres → Guardar`, async () => {
        await escribirNueva(page, conLongitud(n));
        await guardar(page).click();
      });
      await test.step("Resultado: aceptada", async () => {
        await expect(page.getByRole("status").filter({ hasText: MSG_OK })).toBeVisible();
      });
      await verificarAuditoria(abrirContexto, { accion: "PASSWORD_RESTABLECIDA", resultado: "Permitido", usuario: est.correo });
    });
  }

  test("CP-HU003-07 — Política: contraseña de 73 caracteres @P1 @HU-003", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU003-07", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "Con ajuste",
      referenciaPlan: "§7.12.1 (más de 72); §7.12.2 (73)", ajuste: "D-06: la respuesta es la validación del DTO «Máximo 72 caracteres.», no PASSWORD_DEBIL" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    await pedirEnlace(page, est.correo);
    await abrirEnlace(page);
    await test.step("1. Escribir 73 caracteres → Guardar", async () => {
      await escribirNueva(page, conLongitud(73));
      await guardar(page).click();
    });
    await test.step("Resultado: rechazada por longitud; el enlace sigue sirviendo", async () => {
      await expect(page.getByRole("alert").filter({ hasText: "Revisa los campos marcados y vuelve a intentarlo." })).toBeVisible();
      await escribirNueva(page, conLongitud(20));
      await guardar(page).click();
      await expect(page.getByRole("status").filter({ hasText: MSG_OK })).toBeVisible();
    });
  });

  test("CP-HU003-08 — Política: falta un tipo de carácter @P1 @HU-003", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU003-08", tecnica: "partición", clasificacion: "Ruta Alterna", clase: "Con ajuste",
      referenciaPlan: "§7.12.1 (falta un tipo de carácter)", ajuste: "D-06: la UI deshabilita el botón y marca la regla" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    await pedirEnlace(page, est.correo);
    await abrirEnlace(page);
    const variantes = [
      ["Vlearning2026", "Un símbolo (por ejemplo # o !)"],
      ["Vlearning#abc", "Un número"],
      ["vlearning#2026", "Una letra mayúscula"],
      ["VLEARNING#2026", "Una letra minúscula"],
    ];
    for (const [valor, regla] of variantes) {
      await test.step(`«${valor}» → falta «${regla}»`, async () => {
        await escribirNueva(page, valor);
        await expect(guardar(page)).toBeDisabled();
        await expect(page.getByRole("list", { name: "Requisitos de la contraseña" }).getByRole("listitem")
          .filter({ hasText: regla })).toContainText(": falta");
      });
    }
  });

  test("CP-HU003-09 — Política: contiene la parte local del correo @P1 @HU-003", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU003-09", tecnica: "partición", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.12.1 (contiene la parte local del correo)" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    const local = est.correo.split("@")[0];
    await pedirEnlace(page, est.correo);
    await abrirEnlace(page);
    await test.step("1. Contraseña que incluye la parte local → Guardar", async () => {
      await escribirNueva(page, `Zz#9${local}`);
      await guardar(page).click();
    });
    await test.step("Resultado: el backend la rechaza", async () => {
      await expect(page.getByRole("alert").filter({ hasText: "La contraseña debe no contener la primera parte de tu correo." })).toBeVisible();
    });
  });

  test("CP-HU003-10 — Restablecer cierra las sesiones previas @P1 @HU-003", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU003-10", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.3 cierre de sesiones previas" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    await test.step("Precondición: sesión abierta en el contexto A", async () => {
      await new LoginPage(page).iniciarSesion(est.correo, est.password);
      await expect(page).toHaveURL(/\/inicio/);
    });
    await test.step("1. Contexto B: recuperar y restablecer", async () => {
      const ctx = await abrirContexto();
      const b = await ctx.newPage();
      await pedirEnlace(b, est.correo);
      await abrirEnlace(b);
      await escribirNueva(b, `${cfg.e2ePassword}C`);
      await guardar(b).click();
      await expect(b.getByRole("status").filter({ hasText: MSG_OK })).toBeVisible();
      await ctx.close();
    });
    await test.step("2. Contexto A: navegar → vuelve a /login", async () => {
      await page.reload();
      await expect(page).toHaveURL(/\/login/);
    });
    await verificarAuditoria(abrirContexto, { accion: "PASSWORD_RESTABLECIDA", resultado: "Permitido", usuario: est.correo });
  });

  test("CP-HU003-11 — Cuenta inactiva pide recuperación @P2 @HU-003", async ({ page, abrirContexto }) => {
    caso({ ...base, prioridad: "P2", caso: "CP-HU003-11", tecnica: "partición", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "Adicional (RecuperacionService: cuenta inactiva)" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    await test.step("Precondición: el administrador desactiva la cuenta", async () => {
      const ctx = await abrirContexto();
      const p = await ctx.newPage();
      await entrarComoAdmin(p);
      const u = new UsuariosPage(p);
      await u.ir();
      await u.buscar(est.correo);
      await u.boton(est.nombre, "Desactivar").click();
      await expect(u.fila(est.correo)).toContainText(/Inactivo/i);
      await ctx.close();
    });
    await test.step("1. Pedir el enlace → banner genérico y sin enlace", async () => {
      const href = await pedirEnlace(page, est.correo);
      expect(href).toBeNull();
    });
    await verificarAuditoria(abrirContexto, { accion: "RECUPERACION_SOLICITADA", resultado: "Denegado", usuario: "—", recurso: est.correo });
  });

  // ------------------------------------------------------------------ @lento
  for (const [id, segundos, valido] of [["CP-HU003-12", 15 * 60 + 5, false], ["CP-HU003-13", 15 * 60 - 15, true]]) {
    test(`${id} — Enlace ${valido ? "en el límite (14:45)" : "vencido (15:05)"} @P1 @HU-003 @lento`, async ({ page, abrirContexto }) => {
      test.setTimeout(30 * 60_000);
      caso({ ...base, caso: id, tecnica: "límite", clasificacion: valido ? "Ruta Crítica" : "Ruta Alterna", clase: "Lento",
        referenciaPlan: `§7.12.2 vigencia del enlace (${valido ? "14:59" : "15:01"})` });
      const est = await cuentaLista(abrirContexto);
      usuarioProbado(est.correo);
      await pedirEnlace(page, est.correo);
      await abrirEnlace(page);
      await test.step(`Esperar ${Math.floor(segundos / 60)} min ${segundos % 60} s`, () => page.waitForTimeout(segundos * 1000));
      await test.step("1. Escribir la nueva → Guardar", async () => {
        await escribirNueva(page, `${cfg.e2ePassword}D`);
        await guardar(page).click();
      });
      if (valido) await expect(page.getByRole("status").filter({ hasText: MSG_OK })).toBeVisible();
      else await expect(page.getByRole("alert").filter({ hasText: MSG_ENLACE })).toBeVisible();
      await verificarAuditoria(abrirContexto, valido
        ? { accion: "PASSWORD_RESTABLECIDA", resultado: "Permitido", usuario: est.correo }
        : { accion: "RESTABLECER_ENLACE_INVALIDO", resultado: "Denegado", usuario: est.correo });
    });
  }
});
