import { expect } from "@playwright/test";
import { registrarSecreto } from "./secretos.js";

/**
 * Solo para los casos E2E-API. El token se LEE de la sesión que la persona inició por la UI
 * (sessionStorage["vl.token"]); nunca se inyecta ni se fabrica.
 */
export async function tokenDeSesion(page) {
  const token = await page.evaluate(() => sessionStorage.getItem("vl.token"));
  expect(token, "La sesión iniciada por la UI debe tener un token en sessionStorage").toBeTruthy();
  registrarSecreto(token);
  return token;
}

/**
 * Petición al backend por el proxy del frontend (baseURL). `token` null = sin cabecera
 * Authorization. Devuelve { status, cuerpo, ms }.
 */
export async function pedir(page, metodo, ruta, { token = null, datos } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const t0 = performance.now();
  const r = await page.request.fetch(ruta, { method: metodo, headers, data: datos, failOnStatusCode: false });
  const ms = Math.round(performance.now() - t0);
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch { /* sin cuerpo JSON */ }
  return { status: r.status(), cuerpo, ms };
}

export const MSG_403 = "No tienes permiso para realizar esta acción.";
export const MSG_401 = "Tu sesión no es válida o expiró. Inicia sesión de nuevo.";
