import { expect, test } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage.js";
import { escribir } from "./humano.js";
import { registrarSecreto } from "./secretos.js";
import { registrarEvento } from "./guard.js";
import { ETIQUETA_CORREO } from "./config.js";

export const MSG_GENERICO = "El correo o la contraseña no son correctos.";
export const MSG_BLOQUEO = /Tu cuenta está bloqueada temporalmente\. Te enviamos a tu correo un enlace para desbloquearla, o inténtalo de nuevo en unos \d+ minutos\./;
export const MSG_BLOQUEO_ADMIN = "Tu cuenta está bloqueada. Solo un administrador puede desbloquearla.";
export const MSG_DESBLOQUEO_GENERICO = "Si tu cuenta está bloqueada por intentos fallidos, te enviamos un enlace para desbloquearla.";

/** Contraseña errónea derivada (nunca la real). */
export const passwordErrada = (n) => `Errada#${1000 + n}x`;

/**
 * Falla el login de una cuenta desechable (exenta del guard) hasta que aparece el mensaje de
 * bloqueo o hasta `maximo` intentos. Devuelve cuántos fallos hicieron falta.
 */
export async function fallarHastaBloqueo(page, correo, { maximo = 5 } = {}) {
  const login = new LoginPage(page);
  await login.ir();
  for (let i = 1; i <= maximo; i++) {
    const status = await login.intentar(correo, passwordErrada(i));
    registrarEvento(correo, "LOGIN_FALLIDO");
    if (status === 423) {
      await expect(login.error(MSG_BLOQUEO).or(login.error(MSG_BLOQUEO_ADMIN))).toBeVisible();
      return i;
    }
    await expect(login.error(MSG_GENERICO)).toBeVisible();
  }
  throw new Error(`La cuenta ${correo} no se bloqueó después de ${maximo} intentos fallidos.`);
}

/**
 * Pide un enlace de desbloqueo en /desbloquear (espera los 60 s que exige la app desde el último
 * enlace) y lo abre como lo haría la persona. Devuelve el texto final de la pantalla.
 */
export async function desbloquearPorEnlace(page, correo, { esperarSegundos = 61 } = {}) {
  await test.step(`Esperar ${esperarSegundos} s (la app exige 60 s entre enlaces)`, async () => {
    await page.waitForTimeout(esperarSegundos * 1000);
  });
  await page.goto("/desbloquear");
  await escribir(page.getByLabel(ETIQUETA_CORREO), correo);
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByRole("status").filter({ hasText: MSG_DESBLOQUEO_GENERICO })).toBeVisible();
  const enlace = page.locator("a.break-all");
  await expect(enlace, "En modo desarrollo la app muestra el enlace de desbloqueo").toBeVisible();
  const href = await enlace.getAttribute("href");
  registrarSecreto(new URL(href).searchParams.get("token"));
  await enlace.click();
  await page.getByRole("button", { name: "Desbloquear mi cuenta" }).click();
  return href;
}
