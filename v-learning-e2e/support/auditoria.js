import { test } from "@playwright/test";
import { AuditoriaPage } from "../pages/AuditoriaPage.js";
import { entrarComoAdmin } from "./sesiones.js";
import { hoyISO } from "./datos.js";
import { inicioCaso } from "./caso.js";

const norm = (s) => (s ?? "").trim().toLowerCase();

/**
 * Verificación en la auditoría de la app (RF-014), por la pantalla: abre un contexto nuevo, entra
 * como administrador por /login (con OTP), va a /auditoria y, para cada fila esperada, filtra por
 * acción, resultado y fecha de hoy, pulsa «Buscar» y busca una fila que cumpla con todo y que sea
 * posterior al inicio del caso. Adjunta la captura de cada búsqueda. Si falta alguna, el caso
 * falla diciendo cuál.
 *
 * Ojo: el login del administrador también deja filas (LOGIN_OK); por eso se filtra por acción y
 * se compara usuario/recurso.
 *
 * Cada esperado: { accion, resultado: "Permitido"|"Denegado"|"Error", usuario?, recurso?,
 * recursoContiene?, minimo? }. `usuario` es el correo de la columna Usuario («—» si anónimo).
 */
export async function verificarAuditoria(abrirContexto, esperados) {
  const lista = Array.isArray(esperados) ? esperados : [esperados];
  const desde = new Date(inicioCaso().getTime() - 60_000); // la tabla muestra minutos
  const titulo = lista.map((e) => e.accion).join(", ");
  return test.step(`Auditoría en la app (/auditoria): ${titulo}`, async () => {
    const ctx = await abrirContexto();
    const page = await ctx.newPage();
    const faltan = [];
    try {
      await entrarComoAdmin(page);
      const aud = new AuditoriaPage(page);
      await aud.ir();
      const hoy = hoyISO();
      let primero = true;
      for (const e of lista) {
        const etiqueta = `${e.accion}${e.usuario ? ` · ${e.usuario}` : ""}${e.recurso ? ` · ${e.recurso}` : ""} · ${e.resultado}`;
        await test.step(`Buscar ${etiqueta}`, async () => {
          await aud.filtrar({ accion: e.accion, resultado: e.resultado, desde: primero ? hoy : undefined, hasta: primero ? hoy : undefined });
          primero = false;
          const filas = await aud.filas();
          const sinFecha = filas.find((f) => !f.fecha);
          if (sinFecha) throw new Error(`No pude leer la fecha «${sinFecha.fechaTexto}» de /auditoria; revisa parsearFechaTabla.`);
          const cumplen = filas.filter((f) =>
            norm(f.accion) === norm(e.accion)
            && norm(f.resultado) === norm(e.resultado)
            && (e.usuario === undefined || norm(f.usuario) === norm(e.usuario))
            && (e.recurso === undefined || norm(f.recurso) === norm(e.recurso))
            && (e.recursoContiene === undefined || (e.recursoContiene instanceof RegExp
              ? e.recursoContiene.test(f.recurso) : norm(f.recurso).includes(norm(e.recursoContiene))))
            && f.fecha >= desde);
          await test.info().attach(`auditoria-${e.accion.replace(/[^A-Za-z0-9_]+/g, "_")}.png`, {
            body: await page.screenshot({ fullPage: true }), contentType: "image/png",
          });
          const minimo = e.minimo ?? 1;
          if (cumplen.length < minimo) {
            const vistas = filas.slice(0, 6).map((f) => `${f.fechaTexto} | ${f.usuario} | ${f.accion} | ${f.recurso} | ${f.resultado}`).join("\n    ");
            faltan.push(`${minimo > 1 ? `${minimo} filas` : "la fila"} ${etiqueta} (encontré ${cumplen.length}). Primeras filas con ese filtro:\n    ${vistas || "(ninguna)"}`);
          } else {
            test.info().annotations.push({ type: "auditoriaApp", description: `${etiqueta} (${cumplen.length})` });
          }
        });
      }
    } finally {
      await ctx.close();
    }
    if (faltan.length) {
      throw new Error(`Auditoría de la app: faltan registros posteriores a ${desde.toISOString()}:\n  - ${faltan.join("\n  - ")}`);
    }
  });
}
