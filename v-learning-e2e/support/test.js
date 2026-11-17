import { test as base, expect } from "@playwright/test";
import { SCRIPT_ENMASCARAR } from "./secretos.js";

/**
 * `test` del proyecto:
 *  - enmascara en pantalla (video y capturas) el OTP, la contraseña temporal y los enlaces con
 *    token que muestra el modo desarrollo;
 *  - anota el navegador y su versión;
 *  - `abrirContexto(nombre)` abre un contexto limpio adicional (otra persona u otra sesión), como
 *    alguien que entra de nuevo, sin compartir storageState. Playwright también le graba video y trace.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(SCRIPT_ENMASCARAR);
    await use(context);
  },

  navegador: [async ({ browser, browserName }, use, testInfo) => {
    testInfo.annotations.push({ type: "navegador", description: `${browserName} ${browser.version()}` });
    await use(browserName);
  }, { auto: true }],

  // El trace del caso ya incluye estos contextos; el video no, así que se graba aparte y se adjunta.
  abrirContexto: async ({ browser, viewport }, use, testInfo) => {
    const abiertos = [];
    const paginas = [];
    await use(async () => {
      const ctx = await browser.newContext({
        recordVideo: { dir: testInfo.outputPath("videos-contextos"), size: viewport ?? { width: 1366, height: 800 } },
      });
      await ctx.addInitScript(SCRIPT_ENMASCARAR);
      ctx.on("page", (p) => paginas.push(p));
      abiertos.push(ctx);
      return ctx;
    });
    for (const c of abiertos) await c.close().catch(() => {});
    let n = 0;
    for (const p of paginas) {
      const ruta = await p.video()?.path().catch(() => null);
      if (ruta) await testInfo.attach(`video-contexto-${++n}`, { path: ruta, contentType: "video/webm" });
    }
  },
});

export { expect };
