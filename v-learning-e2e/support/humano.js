import { cfg } from "./config.js";
import { registrarSecreto } from "./secretos.js";

/**
 * Escribe como una persona: clic en el campo, borra lo que haya con el teclado y teclea con
 * retraso. Nunca usa `fill`. Si el texto es secreto, se registra para limpiarlo de las evidencias.
 */
export async function escribir(campo, texto, { secreto = false, retraso = cfg.tecleoMs } = {}) {
  if (secreto) registrarSecreto(texto);
  await campo.click();
  await campo.press("Control+A");
  await campo.press("Delete");
  if (texto) await campo.pressSequentially(String(texto), { delay: retraso });
}

/** Textos largos (p. ej. 1000 caracteres): mismo tecleo, con menos retraso para no tardar minutos. */
export async function escribirLargo(campo, texto) {
  await escribir(campo, texto, { retraso: Math.min(cfg.tecleoMs, 3) });
}

/** Elige una opción de un <select> por su texto visible (lo que haría una persona). */
export async function elegir(select, textoVisible) {
  await select.selectOption({ label: textoVisible });
}
