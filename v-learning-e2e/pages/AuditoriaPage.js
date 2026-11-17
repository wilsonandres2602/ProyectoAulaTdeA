import { expect } from "@playwright/test";
import { elegir, escribir } from "../support/humano.js";

const MESES = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sept: 8, sep: 8, oct: 9, nov: 10, dic: 11 };

/**
 * Convierte la fecha que muestra la tabla (Intl es-CO) a Date, en hora de Bogotá (UTC-5, sin
 * horario de verano). Formatos aceptados:
 *  - numérico, el que muestra hoy la app: «11/11/2026, 12:31 a. m.» (día/mes/año);
 *  - con mes abreviado: «10 nov 2026, 7:45 p. m.»;
 *  - con hora de 24 h si no hay «a. m.»/«p. m.».
 * Devuelve null si no reconoce el texto (verificarAuditoria lo trata como error, no como «vale»).
 */
export function parsearFechaTabla(texto) {
  const t = (texto ?? "").replace(/[  ]/g, " ").toLowerCase().trim();
  let dia, mes, anio, resto;
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(.*)$/);
  if (m) { dia = Number(m[1]); mes = Number(m[2]) - 1; anio = Number(m[3]); resto = m[4]; }
  else {
    m = t.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?\s+(?:de\s+)?(\d{4}),?\s+(.*)$/);
    if (!m) return null;
    dia = Number(m[1]); mes = MESES[m[2]] ?? MESES[m[2].slice(0, 3)]; anio = Number(m[3]); resto = m[4];
  }
  const h = resto.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:(a|p)\.?\s*m\.?)?/);
  if (!h || mes === undefined) return null;
  let hora = Number(h[1]);
  if (h[3]) { hora %= 12; if (h[3] === "p") hora += 12; }
  return new Date(Date.UTC(anio, mes, dia, hora + 5, Number(h[2])));
}

/** /auditoria (admin/Auditoria.jsx). */
export class AuditoriaPage {
  constructor(page) {
    this.page = page;
    this.form = page.getByRole("search", { name: "Filtrar auditoría" });
    this.tabla = page.getByRole("table", { name: "Registros de auditoría" });
  }

  async ir() {
    await this.page.goto("/auditoria");
    await expect(this.page.getByRole("heading", { name: "Auditoría", level: 1 })).toBeVisible();
  }

  /** Escribe una fecha AAAA-MM-DD en un <input type="date"> tecleando día, mes y año (es-CO). */
  async escribirFecha(campo, iso) {
    const [a, m, d] = iso.split("-");
    await campo.click();
    // El campo ocupa todo el ancho: el clic en el centro no cae en el segmento del día. Con las
    // flechas se llega al primer segmento (día, en es-CO), como lo haría alguien con el teclado.
    for (let i = 0; i < 3; i++) await campo.press("ArrowLeft");
    await campo.pressSequentially(`${d}${m}${a}`, { delay: 60 });
    // Si Chromium no aceptara el tecleo, el filtro quedaría vacío y la búsqueda pasaría igual.
    await expect(campo, `La fecha ${iso} no quedó escrita en el filtro`).toHaveValue(iso);
  }

  /** resultado: "Permitido" | "Denegado" | "Error" | undefined (todos). */
  async filtrar({ accion, resultado, desde, hasta }) {
    if (accion !== undefined) await escribir(this.form.getByLabel("Acción"), accion);
    if (resultado) await elegir(this.form.getByLabel("Resultado"), resultado);
    if (desde) await this.escribirFecha(this.form.getByLabel("Desde"), desde);
    if (hasta) await this.escribirFecha(this.form.getByLabel("Hasta"), hasta);
    // Solo se observa la respuesta (decisión 6): sirve para saber cuándo la tabla ya muestra el
    // resultado de ESTE filtro y no el anterior, que sigue en pantalla mientras llega el nuevo.
    const respuesta = this.page.waitForResponse((r) => r.url().includes("/api/admin/auditoria")
      && r.request().method() === "GET");
    await this.form.getByRole("button", { name: "Buscar" }).click();
    const r = await respuesta;
    this.ultima = r.ok() ? (await r.json()).registros ?? [] : null;
  }

  /** Filas visibles como objetos { fecha, fechaTexto, usuario, accion, recurso, resultado, ip }. */
  async filas() {
    const vacio = this.page.getByRole("heading", { name: "No hay registros con esos filtros" });
    const filas = this.tabla.locator("tbody tr");
    if (this.ultima) {
      // Esperar a que la pantalla refleje la última búsqueda.
      if (this.ultima.length === 0) await expect(vacio).toBeVisible();
      else {
        await expect(filas).toHaveCount(this.ultima.length);
        await expect(filas.first().locator("td").nth(2)).toHaveText(this.ultima[0].accion);
        await expect(filas.first().locator("td").nth(1)).toHaveText(this.ultima[0].usuarioCorreo ?? "—");
      }
    }
    await expect(this.tabla.or(vacio)).toBeVisible();
    if (await vacio.isVisible()) return [];
    // Una sola lectura de todas las filas, para no mezclar dos renderizados.
    const celdas = await filas.evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((td) => td.innerText.trim())));
    return celdas.map((c) => ({ fechaTexto: c[0], fecha: parsearFechaTabla(c[0] ?? ""), usuario: c[1], accion: c[2], recurso: c[3], resultado: c[4], ip: c[5] }));
  }
}
