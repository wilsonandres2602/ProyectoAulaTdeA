import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { escribir } from "../support/humano.js";

const BANCO = JSON.parse(readFileSync(new URL("../support/vark-banco.json", import.meta.url), "utf8"));

/** Primer acceso (PrimerAcceso.jsx), test VARK (VarkTest/VarkResultado) y perfil de accesibilidad. */
export class OnboardingPage {
  constructor(page) {
    this.page = page;
  }

  // ---------------- Primer acceso ----------------
  get temporal() { return this.page.getByLabel("Contraseña temporal"); }
  get nueva() { return this.page.getByLabel("Contraseña nueva", { exact: true }); }
  get repetir() { return this.page.getByLabel("Repite la contraseña nueva"); }
  get guardarYContinuar() { return this.page.getByRole("button", { name: "Guardar y continuar" }); }

  async llenarCambioTemporal(temporal, nueva, repetir = nueva) {
    await expect(this.page).toHaveURL(/\/primer-acceso/);
    await escribir(this.temporal, temporal, { secreto: true });
    await escribir(this.nueva, nueva, { secreto: true });
    await escribir(this.repetir, repetir, { secreto: true });
  }

  async cambiarTemporal(temporal, nueva, repetir = nueva) {
    await this.llenarCambioTemporal(temporal, nueva, repetir);
    await this.guardarYContinuar.click();
  }

  // ---------------- Test VARK ----------------
  /** Responde `cuantas` preguntas (todas por defecto) eligiendo la opción del estilo dado. */
  async responderVark(estilo = "LECTURA_ESCRITURA", { cuantas = BANCO.length, terminar = true } = {}) {
    await expect(this.page).toHaveURL(/\/onboarding\/test/);
    for (let i = 0; i < cuantas; i++) {
      const enunciado = (await this.page.getByRole("heading", { level: 1 }).innerText()).trim();
      const fila = BANCO.find((f) => f.enunciado === enunciado);
      if (!fila) throw new Error(`Pregunta VARK desconocida: «${enunciado}». ¿Cambió BancoVark?`);
      // Espera el guardado de la respuesta (PUT /api/vark/respuestas/<n>, solo se observa): si se pulsa
      // «Ver mi resultado» antes, el servidor responde «Faltan respuestas en las preguntas: [12].».
      const guardada = this.page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/vark\/respuestas\/\d+$/.test(r.url()));
      await this.page.getByRole("radio", { name: fila[estilo], exact: true }).click();
      expect((await guardada).status(), "Guardado de la respuesta VARK").toBeLessThan(400);
      const siguiente = this.page.getByRole("button", { name: "Siguiente" });
      const verResultado = this.page.getByRole("button", { name: "Ver mi resultado" });
      if (await verResultado.isVisible()) {
        if (terminar && i === cuantas - 1) await verResultado.click();
        break;
      }
      if (i < cuantas - 1) {
        await siguiente.click();
        await expect(this.page.getByRole("heading", { level: 1 })).not.toHaveText(enunciado);
      }
    }
  }

  async omitirSegundoMetodo() {
    await expect(this.page).toHaveURL(/\/onboarding\/resultado/);
    await this.page.getByRole("button", { name: "Omitir segundo método" }).click();
  }

  // ---------------- Perfil de accesibilidad ----------------
  /** categorias: ["Ninguna"] o nombres como «Visual», «Auditiva», «Motora», «Cognitiva». */
  async guardarAccesibilidad(categorias = ["Ninguna"], { manual = false } = {}) {
    await expect(this.page).toHaveURL(/\/onboarding\/accesibilidad/);
    const grupo = this.page.getByRole("group", { name: "Categorías de accesibilidad" });
    for (const c of categorias) await grupo.getByRole("checkbox", { name: new RegExp(`^${c}\\b`) }).click();
    await this.page.getByRole("button", { name: manual ? "Guardar y ajustar manualmente" : "Guardar y empezar" }).click();
  }

  /** Onboarding completo de un estudiante recién activado. */
  async completarEstudiante({ estilo = "LECTURA_ESCRITURA", categorias = ["Ninguna"] } = {}) {
    await this.responderVark(estilo);
    await this.omitirSegundoMetodo();
    await this.guardarAccesibilidad(categorias);
    await expect(this.page).toHaveURL(/\/inicio/);
  }
}

export const PREGUNTAS_VARK = BANCO.length;
