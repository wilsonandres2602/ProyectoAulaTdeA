import { test } from "@playwright/test";

/**
 * Metadatos de trazabilidad de un caso del plan. Se guardan como anotaciones de Playwright: el
 * reporte HTML y el modo UI las muestran, y el reporter las copia al historial y al Excel.
 *
 * @param {object} m
 * @param {string} m.caso          ID del catálogo (CP-HU002-02, …)
 * @param {string} m.hu            HU-002
 * @param {string} m.rf            RF-002
 * @param {"P1"|"P2"|"P3"} m.prioridad
 * @param {string} m.tecnica       funcional | partición | límite | decisión | estado | seguridad | accesibilidad
 * @param {string} m.referenciaPlan  p. ej. «§7.14 CP-HU002-02; TC-AUTH-03; TE-03»
 * @param {"Ruta Crítica"|"Ruta Alterna"} m.clasificacion
 * @param {string} [m.clase]       E2E-UI | E2E-API | Con ajuste | Lento
 * @param {string} [m.ajuste]      qué se valida distinto del plan
 * @param {string} [m.defecto]     D-xx si se espera que falle por un defecto conocido
 * @param {string} [m.entorno]     entorno simulado, si aplica
 */
export function caso(m) {
  const info = test.info();
  for (const [k, v] of Object.entries(m)) {
    if (v !== undefined && v !== null && v !== "") info.annotations.push({ type: k, description: String(v) });
  }
  info.annotations.push({ type: "inicioCaso", description: new Date().toISOString() });
}

/** Correo de la cuenta probada (nunca una contraseña). */
export function usuarioProbado(correo) {
  test.info().annotations.push({ type: "usuarioProbado", description: correo });
}

/** Momento en que empezó el caso (para buscar en la auditoría solo filas posteriores). */
export function inicioCaso() {
  const a = test.info().annotations.find((x) => x.type === "inicioCaso");
  return a ? new Date(a.description) : new Date();
}

/**
 * Mide el tiempo desde la acción hasta que el resultado aparece en pantalla, y lo registra como
 * anotación «rendimiento» SIN hacer fallar la prueba. `umbrales` admite el umbral de la HU y el
 * del RF cuando el plan da dos (§7.7).
 */
export async function medir(nombre, umbrales, accion, esperarResultado) {
  const t0 = performance.now();
  await accion();
  await esperarResultado();
  const ms = Math.round(performance.now() - t0);
  const lista = Array.isArray(umbrales) ? umbrales : [umbrales];
  const detalle = lista.map((u) => ({ fuente: u.fuente, umbralMs: u.ms, cumple: ms <= u.ms }));
  test.info().annotations.push({
    type: "rendimiento",
    description: JSON.stringify({ metrica: nombre, valorMs: ms, umbrales: detalle }),
  });
  return ms;
}

/** Atajos para umbrales frecuentes de la §7.7. */
export const U = {
  s: (seg, fuente) => ({ ms: seg * 1000, fuente }),
  ms: (ms, fuente) => ({ ms, fuente }),
};
