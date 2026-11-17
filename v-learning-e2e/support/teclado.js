import { expect, test } from "@playwright/test";

/**
 * Recorridos solo con teclado (CP-HU017-01). Cada parada del foco se revisa: nombre accesible,
 * si es visible (`:focus-visible` con contorno o sombra) y cuánto tardó en moverse tras la tecla.
 * Nada de esto toca la app: solo lee `document.activeElement`.
 */

/** Describe el elemento con foco: { tag, rol, nombre, visible, tabindex, estilo }. */
export async function foco(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { tag: "body", nombre: "", visible: true, tabindex: null };
    const etiqueta = el.getAttribute("aria-label")
      || (el.getAttribute("aria-labelledby") || "").split(" ").map((id) => document.getElementById(id)?.innerText ?? "").join(" ").trim()
      || el.labels?.[0]?.innerText
      || el.innerText
      || el.getAttribute("title")
      || el.value
      || "";
    const cs = getComputedStyle(el);
    const contorno = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    const sombra = cs.boxShadow && cs.boxShadow !== "none";
    return {
      tag: el.tagName.toLowerCase(),
      rol: el.getAttribute("role") || "",
      nombre: etiqueta.replace(/\s+/g, " ").trim().slice(0, 120),
      visible: el.matches(":focus-visible") && (contorno || sombra),
      tabindex: el.getAttribute("tabindex"),
      estilo: `outline:${cs.outlineStyle} ${cs.outlineWidth}; box-shadow:${cs.boxShadow === "none" ? "none" : "sí"}`,
    };
  });
}

/**
 * Registro de un recorrido: guarda las paradas, las que no tienen foco visible y la latencia
 * máxima entre la tecla y el cambio de foco.
 */
export class Recorrido {
  constructor(page) {
    this.page = page;
    this.paradas = 0;
    this.sinFocoVisible = [];
    this.latencias = [];
  }

  /** Pulsa una tecla y espera a que el foco cambie (o 1 s); revisa la nueva parada. */
  async tecla(tecla) {
    const antes = await this.page.evaluateHandle(() => document.activeElement);
    const t0 = performance.now();
    await this.page.keyboard.press(tecla);
    // La latencia incluye el ida y vuelta de Playwright: es una cota superior.
    const cambio = await this.page.waitForFunction((a) => document.activeElement !== a, antes, { timeout: 1000, polling: "raf" })
      .then(() => true).catch(() => false);
    const ms = performance.now() - t0;
    await antes.dispose();
    if (cambio && /Tab/.test(tecla)) this.latencias.push(ms);
    const f = await foco(this.page);
    // Los encabezados con tabindex=-1 reciben foco por programa al cambiar de pantalla: no son
    // paradas de Tab y la app les quita el contorno a propósito.
    if (f.tag !== "body" && f.tabindex !== "-1") {
      this.paradas++;
      if (!f.visible) this.sinFocoVisible.push(`${f.tag}${f.rol ? `[${f.rol}]` : ""} «${f.nombre}» (${f.estilo})`);
    }
    return f;
  }

  /** Tab (o Mayús+Tab) hasta que el foco tenga un nombre que cumpla `patron`. */
  async hasta(patron, { atras = false, max = 80 } = {}) {
    for (let i = 0; i < max; i++) {
      const f = await this.tecla(atras ? "Shift+Tab" : "Tab");
      if (patron.test(f.nombre)) return f;
    }
    throw new Error(`Con ${max} pulsaciones de ${atras ? "Mayús+Tab" : "Tab"} no llegué a un control ${patron}.`);
  }

  /** Escribe en el control con foco usando solo el teclado. */
  async escribir(texto) {
    await this.page.keyboard.type(texto, { delay: 15 });
  }

  /** Anota el resumen y comprueba que nunca faltó el foco visible. */
  async cerrar() {
    const max = this.latencias.length ? Math.round(Math.max(...this.latencias)) : 0;
    const prom = this.latencias.length ? Math.round(this.latencias.reduce((a, b) => a + b, 0) / this.latencias.length) : 0;
    test.info().annotations.push({ type: "recorridoTeclado", description: JSON.stringify({ paradas: this.paradas, sinFocoVisible: this.sinFocoVisible.length, latenciaMaxMs: max, latenciaPromMs: prom }) });
    test.info().annotations.push({
      type: "rendimiento",
      description: JSON.stringify({ metrica: "máximo entre Tab y el cambio de foco", valorMs: max, umbrales: [
        { fuente: "RF < 200 ms", umbralMs: 200, cumple: max < 200 }, { fuente: "HU < 300 ms", umbralMs: 300, cumple: max < 300 }] }),
    });
    expect(this.sinFocoVisible, "Paradas de foco sin indicador visible").toEqual([]);
  }
}
