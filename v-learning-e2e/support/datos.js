import { cfg } from "./config.js";

let secuencia = 0;

/** Marca de tiempo corta y única para nombres y correos de prueba. */
export function marca() {
  secuencia += 1;
  const t = new Date();
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}${p(secuencia, 3)}`;
}

/** Correo de prueba reconocible en la auditoría: e2e.<marca>.<rol>@<dominio>. */
export function correoE2E(rol = "est", dominio = cfg.dominio) {
  return `e2e.${marca()}.${rol}@${dominio}`;
}

export function nombreE2E(rol = "Estudiante") {
  return `E2E ${rol} ${marca()}`;
}

export const ROL_TEXTO = { ESTUDIANTE: "Estudiante", INSTRUCTOR: "Instructor", ADMINISTRADOR: "Administrador" };

/** Fecha local (Bogotá) como AAAA-MM-DD. */
export function hoyISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}
