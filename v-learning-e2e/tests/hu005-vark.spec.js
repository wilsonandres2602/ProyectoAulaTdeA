import { readFileSync } from "node:fs";
import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { crearCuenta, cuentaLista } from "../support/sesiones.js";
import { cfg, exigir } from "../support/config.js";
import { LoginPage } from "../pages/LoginPage.js";
import { OnboardingPage, PREGUNTAS_VARK } from "../pages/OnboardingPage.js";

const base = { hu: "HU-005", rf: "RF-004", prioridad: "P2" };
const BANCO = JSON.parse(readFileSync(new URL("../support/vark-banco.json", import.meta.url), "utf8"));
const UMBRAL = U.s(2, "Resultado del test VARK ≤ 2 s (§7.3)");
const UMBRAL_LOGROS = U.s(2, "Pantalla de logros ≤ 2 s (§7.7, gamificación)");
// BancoVark.AYUDA_GENERAL: se agrega al final de la ayuda de cada pregunta.
const AYUDA_GENERAL = "No hay respuestas buenas ni malas: elige lo que harías de forma natural, aunque a veces uses más de una.";
const NOMBRE = { VISUAL: "Visual", LECTURA_ESCRITURA: "Lectura y escritura" };

const avance = (page) => page.getByRole("progressbar", { name: "Avance del test" });
const enunciado = (page) => page.getByRole("heading", { level: 1 });

/**
 * Estudiante nuevo: el administrador crea la cuenta y el estudiante entra con la temporal y la
 * cambia; queda en /onboarding/test. Devuelve { page, cuenta } (cuenta.password = E2E_PASSWORD).
 */
async function estudianteEnElTest(abrirContexto) {
  exigir("e2ePassword");
  const cuenta = await crearCuenta(abrirContexto, { etiqueta: "vark" });
  usuarioProbado(cuenta.correo);
  return test.step("Precondición: primer acceso del estudiante nuevo", async () => {
    const ctx = await abrirContexto();
    const page = await ctx.newPage();
    await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.temporal);
    await new OnboardingPage(page).cambiarTemporal(cuenta.temporal, cfg.e2ePassword);
    await expect(page).toHaveURL(/\/onboarding\/test/);
    cuenta.password = cfg.e2ePassword;
    delete cuenta.temporal;
    return { page, cuenta };
  });
}

/** Responde todas las preguntas con el estilo dado y mide «Ver mi resultado» hasta «Tu resultado». */
async function terminarTest(page, estilo) {
  await new OnboardingPage(page).responderVark(estilo, { terminar: false });
  await medir("Ver mi resultado → resultado del test", UMBRAL,
    () => page.getByRole("button", { name: "Ver mi resultado" }).click(),
    () => expect(page.getByRole("heading", { level: 1, name: `Tu método recomendado: ${NOMBRE[estilo]}` })).toBeVisible());
  await expect(page).toHaveURL(/\/onboarding\/resultado/);
}

const menu = (page, nombre) => page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: nombre, exact: true });

test.describe("HU-005 · Identificar estilo VARK (RF-004)", () => {
  test("CP-HU005-01 — Preguntas con ayuda @P2 @HU-005", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU005-01", tecnica: "flujo", clasificacion: "Ruta Crítica", referenciaPlan: "§7.3 test VARK con ayuda",
      ajuste: "El catálogo cita «Elige la opción que más se parezca a lo que harías normalmente…», que es el texto de reserva de VarkTest.jsx: el servidor siempre manda una ayuda propia por pregunta terminada en «No hay respuestas buenas ni malas: elige lo que harías de forma natural…» (BancoVark.AYUDA_GENERAL). Se valida ese texto" });
    const { page } = await estudianteEnElTest(abrirContexto);
    await test.step("1. Sin elegir: «Siguiente» deshabilitado y el motivo en texto", async () => {
      await expect(page.getByText(`Pregunta 1 de ${PREGUNTAS_VARK}`)).toBeVisible();
      await expect(avance(page)).toHaveAttribute("aria-valuenow", "0");
      await expect(page.getByRole("button", { name: "Siguiente" })).toBeDisabled();
      await expect(page.getByText("Elige una opción para continuar.")).toBeVisible();
    });
    const ayudas = new Set();
    for (let i = 0; i < PREGUNTAS_VARK; i++) {
      await test.step(`2.${i + 1}. Pregunta ${i + 1}: abrir la ayuda, responder y avanzar`, async () => {
        const texto = (await enunciado(page).innerText()).trim();
        const fila = BANCO.find((f) => f.enunciado === texto);
        expect(fila, `Pregunta conocida: «${texto}»`).toBeTruthy();
        const boton = page.getByRole("button", { name: "Ayuda con esta pregunta" });
        await expect(boton).toHaveAttribute("aria-expanded", "false");
        await boton.click();
        await expect(boton).toHaveAttribute("aria-expanded", "true");
        const ayuda = page.getByRole("status").filter({ hasText: AYUDA_GENERAL });
        await expect(ayuda).toBeVisible();
        const propia = (await ayuda.innerText()).replace(AYUDA_GENERAL, "").trim();
        expect(propia.length, "La pregunta tiene su propia ayuda además de la general").toBeGreaterThan(10);
        ayudas.add(propia);
        const guardada = page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/vark\/respuestas\/\d+$/.test(r.url()));
        await page.getByRole("radio", { name: fila.VISUAL, exact: true }).click();
        expect((await guardada).status()).toBeLessThan(400);
        await expect(avance(page)).toHaveAttribute("aria-valuenow", String(Math.round(((i + 1) / PREGUNTAS_VARK) * 100)));
        if (i < PREGUNTAS_VARK - 1) {
          await page.getByRole("button", { name: "Siguiente" }).click();
          await expect(enunciado(page)).not.toHaveText(texto);
          await expect(page.getByRole("button", { name: "Ayuda con esta pregunta" })).toHaveAttribute("aria-expanded", "false");
        }
      });
    }
    expect(ayudas.size, "Cada pregunta tiene una ayuda distinta").toBe(PREGUNTAS_VARK);
    await expect(page.getByRole("button", { name: "Ver mi resultado" })).toBeEnabled();
  });

  test("CP-HU005-02 — Guardado parcial y retomar @P2 @HU-005", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU005-02", tecnica: "estado", clasificacion: "Ruta Alterna", referenciaPlan: "TC-VARK-01; §7.3 guardado parcial" });
    const { page, cuenta } = await estudianteEnElTest(abrirContexto);
    await test.step("1. Responder 5 de 12", async () => {
      await new OnboardingPage(page).responderVark("AUDITIVO", { cuantas: 5, terminar: false });
      await expect(avance(page)).toHaveAttribute("aria-valuenow", String(Math.round((5 / PREGUNTAS_VARK) * 100)));
    });
    await test.step("2. Cerrar el contexto sin terminar", () => page.context().close());
    await test.step("3. Login en un contexto nuevo: retoma en la pregunta 6 con el avance conservado", async () => {
      const ctx = await abrirContexto();
      const p2 = await ctx.newPage();
      await new LoginPage(p2).iniciarSesion(cuenta.correo, cuenta.password);
      await expect(p2).toHaveURL(/\/onboarding\/test/);
      await expect(p2.getByText(`Pregunta 6 de ${PREGUNTAS_VARK}`)).toBeVisible();
      await expect(enunciado(p2)).toHaveText(BANCO[5].enunciado);
      await expect(avance(p2)).toHaveAttribute("aria-valuenow", String(Math.round((5 / PREGUNTAS_VARK) * 100)));
      await p2.getByRole("button", { name: "Anterior" }).click();
      await expect(enunciado(p2)).toHaveText(BANCO[4].enunciado);
      await expect(p2.getByRole("radio", { name: new RegExp(`^${BANCO[4].AUDITIVO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }))
        .toHaveAttribute("aria-checked", "true");
    });
  });

  test("CP-HU005-03 — Cálculo del método predominante @P2 @HU-005", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU005-03", tecnica: "flujo", clasificacion: "Ruta Crítica", referenciaPlan: "§7.3 cálculo del método" });
    const { page, cuenta } = await estudianteEnElTest(abrirContexto);
    await test.step("1. Responder las 12 con la opción de lectura/escritura y «Ver mi resultado»", () => terminarTest(page, "LECTURA_ESCRITURA"));
    await test.step("Resultado: «Tu resultado» con lectura/escritura y «Recomendado para ti»", async () => {
      await expect(page.getByText("Tu resultado").first()).toBeVisible();
      await expect(page.getByText("Recomendado para ti")).toBeVisible();
      await expect(page.getByText(`Lectura y escritura · ${PREGUNTAS_VARK} puntos`)).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, { accion: "VARK_COMPLETADO", resultado: "Permitido", usuario: cuenta.correo });
  });

  test("CP-HU005-04 — Repetir el test @P2 @HU-005", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU005-04", tecnica: "estado", clasificacion: "Ruta Alterna", referenciaPlan: "§7.3 repetir el test",
      ajuste: "Se usa un estudiante desechable con el test hecho (lectura/escritura) y no el del setup, para no cambiar su método" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "varkrep" });
    usuarioProbado(est.correo);
    const ctx = await abrirContexto();
    const page = await ctx.newPage();
    await new LoginPage(page).iniciarSesion(est.correo, est.password);
    await expect(page).toHaveURL(/\/inicio/);
    const metodos = () => page.getByRole("region", { name: "Métodos de aprendizaje" });
    const principal = (nombre) => metodos().getByRole("radiogroup", { name: "Método principal" }).getByRole("radio", { name: new RegExp(`^${nombre}`) });
    await test.step("1. /configuracion: el método es lectura/escritura", async () => {
      await menu(page, "Configuración").click();
      await expect(page).toHaveURL(/\/configuracion/);
      await expect(principal("Lectura y escritura")).toHaveAttribute("aria-checked", "true");
    });
    await test.step("2. «Repetir el test» y responder todo con la opción visual", async () => {
      await metodos().getByRole("link", { name: "Repetir el test" }).click();
      await expect(page).toHaveURL(/\/onboarding\/test/);
      await expect(page.getByText(`Pregunta 1 de ${PREGUNTAS_VARK}`)).toBeVisible();
      await terminarTest(page, "VISUAL");
    });
    await test.step("3. Seguir el onboarding hasta /inicio", async () => {
      const onb = new OnboardingPage(page);
      await onb.omitirSegundoMetodo();
      await onb.guardarAccesibilidad(["Ninguna"]);
      await expect(page).toHaveURL(/\/inicio/);
    });
    await test.step("Resultado: en «Métodos de aprendizaje» el método es visual", async () => {
      await menu(page, "Configuración").click();
      await expect(principal("Visual")).toHaveAttribute("aria-checked", "true");
      await expect(principal("Lectura y escritura")).toHaveAttribute("aria-checked", "false");
    });
    await verificarAuditoria(abrirContexto, { accion: "VARK_COMPLETADO", resultado: "Permitido", usuario: est.correo, minimo: 2 });
  });

  test("CP-HU005-05 — 30 puntos al completar @P2 @HU-005", async ({ abrirContexto }) => {
    caso({ ...base, rf: "RF-004, RF-009", caso: "CP-HU005-05", tecnica: "flujo", clasificacion: "Ruta Crítica", referenciaPlan: "§7.3 puntos por el test VARK" });
    const { page } = await estudianteEnElTest(abrirContexto);
    await test.step("Precondición: completar el test y el onboarding", () => new OnboardingPage(page).completarEstudiante());
    await test.step("1. Abrir /logros", async () => {
      await medir("Abrir Logros", UMBRAL_LOGROS,
        () => menu(page, "Logros").click(),
        () => expect(page.getByText(/^30 puntos/)).toBeVisible());
      await expect(page).toHaveURL(/\/logros/);
    });
    await test.step("Resultado: 30 puntos y «Nivel» 1", async () => {
      const tarjeta = page.getByText("Nivel", { exact: true }).locator("..");
      await expect(tarjeta.getByText("1", { exact: true })).toBeVisible();
      await expect(tarjeta.getByText(/^30 puntos/)).toBeVisible();
    });
  });
});
