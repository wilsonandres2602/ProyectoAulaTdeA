import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { cfg } from "./support/config.js";

// Un UUID por corrida. El proceso principal lo crea y los workers lo heredan por el entorno.
process.env.ID_EJECUCION ??= randomUUID();

const contexto = {
  baseURL: cfg.baseURL,
  locale: "es-CO",
  timezoneId: "America/Bogota",
  viewport: { width: 1366, height: 800 },
  trace: "on",
  video: "on",
  screenshot: "on",
  launchOptions: { slowMo: process.env.HEADED ? cfg.slowMo : 0 },
  actionTimeout: 20_000,
  navigationTimeout: 30_000,
};

export default defineConfig({
  testDir: "./tests",
  // Orden estable y sin carreras sobre las mismas cuentas.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 6 * 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results",
  // Antes de cualquier grupo: el backend debe escribir en la base aislada (vlearning_e2e).
  globalSetup: "./support/verificar-base.js",
  // El video demostrativo (DEMO=1) no es un caso de prueba: no deja línea en el historial ni evidencias.
  reporter: process.env.DEMO
    ? [["list"]]
    : [
      // El reporter propio va primero: limpia los secretos de los traces antes de que el HTML los copie.
      ["./reporters/auditoria-reporter.js"],
      ["list"],
      ["html", { open: "never" }],
      ["json", { outputFile: "resultados/ultimo.json" }],
    ],
  use: contexto,
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.js/,
      use: { ...devices["Desktop Chrome"], ...contexto },
    },
    {
      name: "chromium",
      testIgnore: /.*\.setup\.js/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], ...contexto },
    },
    // Compatibilidad secundaria del plan (§4): Edge. Solo con EDGE=1 y Edge instalado.
    ...(process.env.EDGE
      ? [{
          name: "msedge",
          testIgnore: /.*\.setup\.js/,
          dependencies: ["setup"],
          use: { ...devices["Desktop Edge"], channel: "msedge", ...contexto },
        }]
      : []),
    // Video demostrativo (npm run video:demo). Solo existe con DEMO=1, así que test:e2e nunca lo corre.
    // Graba sus propios contextos (uno por rol) a 1920×1080; sin trace ni video del fixture.
    ...(process.env.DEMO
      ? [{
          name: "demo",
          testDir: "./tests/demo",
          testMatch: /.*\.demo\.js/,
          timeout: 60 * 60_000,
          use: {
            ...devices["Desktop Chrome"], ...contexto,
            viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
            // Pantalla completa: con 1920×1080 la ventana normal no cabe y Windows la achica (franja gris).
            headless: false, launchOptions: { slowMo: 600, args: ["--start-fullscreen"] },
            trace: "off", video: "off", screenshot: "off",
          },
        }]
      : []),
  ],
});
