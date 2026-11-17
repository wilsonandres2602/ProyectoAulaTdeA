import fs from "node:fs";
import { test, expect } from "../support/test.js";
import { caso, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cuentaLista, cerrarSesion, entrarComoAdmin } from "../support/sesiones.js";
import { escribir } from "../support/humano.js";
import { sesion, armarCurso, MODULO, LECTURA } from "../support/cursos.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";

/** Formatos de RF-032 con su nombre en pantalla, extensión y firma del archivo. */
const FORMATOS = [
  { tipo: "MP3", nombre: "Audio MP3", ext: "mp3", firma: (b) => b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { tipo: "EPUB", nombre: "Libro electrónico EPUB", ext: "epub", firma: (b) => b.subarray(0, 2).toString("latin1") === "PK" && b.includes(Buffer.from("application/epub+zip")) },
  { tipo: "HTML", nombre: "HTML accesible", ext: "html", firma: (b) => /<!doctype html|<html/i.test(b.subarray(0, 200).toString("utf8")) },
  { tipo: "BRF", nombre: "Braille electrónico BRF", ext: "brf", firma: (b) => b.length > 0 && [...b].every((x) => x === 10 || x === 13 || x === 12 || (x >= 32 && x < 127)) },
];

test.describe("Extras · RF-032, RF-048 y RF-049", () => {
  // ------------------------------------------------------------------ CP-RF032-01
  test("CP-RF032-01 — Formatos alternativos MP3, EPUB, HTML accesible y BRF @P3 @RF-032 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ hu: "HU-019", rf: "RF-032", prioridad: "P3", caso: "CP-RF032-01", tecnica: "funcional", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "RF-032 (adicional)" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "fmtins" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "fmtest" });
    usuarioProbado(est.correo);
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Formatos", inscritos: [est] });
    const page = await sesion(abrirContexto, est);
    await test.step(`Precondición: el estudiante abre «${LECTURA}»`, async () => {
      await page.getByRole("link", { name: "Mis cursos", exact: true }).click();
      await page.getByRole("link", { name: curso.titulo, exact: true }).click();
      await page.getByRole("link", { name: LECTURA, exact: true }).click();
      await expect(page.getByRole("heading", { name: LECTURA })).toBeVisible();
    });
    const d = page.getByRole("dialog", { name: "Descargar en otro formato" });
    await test.step("1. «Descargar en otro formato»: se listan los 4 formatos", async () => {
      await page.getByRole("button", { name: "Descargar en otro formato" }).click();
      for (const f of FORMATOS) await expect(d.getByRole("paragraph").filter({ hasText: new RegExp(`^${f.nombre}$`) })).toBeVisible();
    });
    const descargas = [];
    for (const f of FORMATOS) {
      await test.step(`2. «Generar ${f.nombre}» → «Descargar ${f.nombre}»: archivo .${f.ext} válido`, async () => {
        const item = d.getByRole("listitem").filter({ hasText: f.nombre });
        const generar = item.getByRole("button", { name: new RegExp(`^(Generar|Intentar de nuevo) ${f.nombre}$`) });
        if (await generar.count()) await generar.click();
        const bajar = item.getByRole("button", { name: `Descargar ${f.nombre}` });
        await expect(bajar).toBeVisible({ timeout: 120_000 });
        const evento = page.waitForEvent("download");
        await bajar.click();
        const archivo = await evento;
        const bytes = fs.readFileSync(await archivo.path());
        const info = { formato: f.tipo, nombre: archivo.suggestedFilename(), bytes: bytes.length, cabecera: bytes.subarray(0, 8).toString("hex") };
        descargas.push(info);
        test.info().annotations.push({ type: `descarga ${f.tipo}`, description: JSON.stringify(info) });
        expect(info.nombre).toMatch(new RegExp(`\\.${f.ext}$`, "i"));
        expect(bytes.length).toBeGreaterThan(0);
        expect(f.firma(bytes), `firma de ${f.tipo}`).toBe(true);
      });
    }
    await verificarAuditoria(abrirContexto, [
      { accion: "FORMATO_SOLICITADO", resultado: "Permitido", usuario: est.correo, minimo: 4 },
      { accion: "FORMATO_DESCARGADO", resultado: "Permitido", usuario: est.correo, minimo: 4 },
    ]);
  });

  // ------------------------------------------------------------------ CP-RF048-01
  test("CP-RF048-01 — Ayuda en un lugar consistente (3 roles, 5 páginas) @P3 @RF-048 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ hu: "HU-017", rf: "RF-048", prioridad: "P3", caso: "CP-RF048-01", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "RF-048 (adicional); WCAG 3.2.6" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "ayudaest" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "ayudains" });
    usuarioProbado(est.correo);
    const roles = [
      { rol: "Estudiante", entrar: (ctx) => sesion(abrirContexto, est), paginas: ["/inicio", "/cursos", "/evaluaciones", "/comunidad", "/progreso"] },
      { rol: "Instructor", entrar: (ctx) => sesion(abrirContexto, ins), paginas: ["/inicio", "/cursos", "/comunidad", "/informes", "/configuracion"] },
      { rol: "Administrador", entrar: async () => { const p = await (await abrirContexto()).newPage(); await entrarComoAdmin(p); return p; },
        paginas: ["/inicio", "/usuarios", "/cursos", "/auditoria", "/gamificacion"] },
    ];
    /** Solo lectura: posición del botón «Ayuda», región que lo contiene y su orden de Tab dentro de la barra superior. */
    const medirAyuda = (page) => page.evaluate(() => {
      const visibles = (el) => el.checkVisibility() && el.getClientRects().length > 0;
      const boton = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Ayuda" && visibles(b));
      if (!boton) return null;
      const header = boton.closest("header");
      const enfocables = header ? [...header.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((e) => !e.disabled && visibles(e)) : [];
      const r = boton.getBoundingClientRect();
      return { region: header ? "header (banner)" : boton.parentElement?.tagName, ordenTab: enfocables.indexOf(boton) + 1, de: enfocables.length,
        x: Math.round(r.left), y: Math.round(r.top), derecha: Math.round(window.innerWidth - r.right) };
    });
    const resultados = [];
    for (const r of roles) {
      await test.step(`${r.rol}: recorrer ${r.paginas.join(", ")}`, async () => {
        const page = await r.entrar();
        for (const ruta of r.paginas) {
          await page.goto(ruta);
          await expect(page).toHaveURL(new RegExp(`${ruta}$`));
          await expect(page.getByRole("button", { name: "Ayuda", exact: true })).toBeVisible();
          const m = await medirAyuda(page);
          resultados.push({ rol: r.rol, ruta, ...m });
        }
        await test.step(`${r.rol}: «Ayuda» abre el diálogo «Ayuda»`, async () => {
          await page.getByRole("button", { name: "Ayuda", exact: true }).click();
          const d = page.getByRole("dialog", { name: "Ayuda" });
          await expect(d).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(d).toBeHidden();
        });
        await cerrarSesion(page);
        await page.context().close();
      });
    }
    test.info().annotations.push({ type: "posicionesAyuda", description: JSON.stringify(resultados) });
    await test.step("Resultado: el botón «Ayuda» está en la misma región, en la misma posición y en el mismo orden de Tab", () => {
      for (const r of roles) {
        const filas = resultados.filter((x) => x.rol === r.rol);
        expect(new Set(filas.map((x) => x.region)).size, `${r.rol}: misma región`).toBe(1);
        expect(filas[0].region).toBe("header (banner)");
        expect(new Set(filas.map((x) => `${x.ordenTab}/${x.de}`)).size, `${r.rol}: mismo orden de Tab`).toBe(1);
        expect(Math.max(...filas.map((x) => x.derecha)) - Math.min(...filas.map((x) => x.derecha)), `${r.rol}: misma distancia al borde derecho`).toBeLessThanOrEqual(2);
        expect(Math.max(...filas.map((x) => x.y)) - Math.min(...filas.map((x) => x.y)), `${r.rol}: misma altura`).toBeLessThanOrEqual(2);
      }
    });
  });

  // ------------------------------------------------------------------ CP-RF049-01
  test("CP-RF049-01 — Verificador: salto de encabezado y enlace no descriptivo @P3 @RF-049 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ hu: "HU-020", rf: "RF-049", prioridad: "P3", caso: "CP-RF049-01", tecnica: "funcional", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "RF-049 (adicional)",
      ajuste: "El verificador revisa mientras se escribe (panel «Revisión de accesibilidad (WCAG 2.2)» del editor); no hay un botón «Verificar»" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "verins" });
    usuarioProbado(ins.correo);
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const titulo = `E2E-Verificador-${Date.now()}`;
    await test.step("Precondición: curso borrador con «Módulo E2E»", async () => {
      await ed.ir();
      await ed.crearCurso(titulo, "Curso del verificador de accesibilidad.");
      await ed.abrirEditor(titulo);
      await ed.crearModulo(MODULO);
    });
    const TEXTO = ["# Título de la lectura", "### Subtítulo que salta un nivel", "Para más información haz clic [aquí](https://example.org/e2e/guia)."].join("\n");
    const panel = page.getByRole("region", { name: "Revisión de accesibilidad (WCAG 2.2)" });
    await test.step("1. Lectura con «# Título» → «### Sub» y un enlace «aquí» → el verificador revisa", async () => {
      await ed.pestana("Contenido").click();
      await page.getByRole("button", { name: `Nuevo contenido en ${MODULO}` }).click();
      const d = page.getByRole("dialog", { name: "Nuevo contenido" });
      await escribir(d.getByLabel("Título del contenido"), "Lectura con problemas de estructura");
      await d.getByLabel("Formato").selectOption({ label: "Lectura" });
      await escribir(d.getByLabel("Texto de la lección"), TEXTO);
      await ed.observarPost(/^\/api\/modulos\/\d+\/contenidos$/, () => d.getByRole("button", { name: "Crear contenido" }).click());
      await expect(panel.getByRole("status")).toContainText(/advertencia/, { timeout: 15_000 });
    });
    await test.step("Resultado: hallazgos con los criterios 1.3.1 y 2.4.4", async () => {
      const items = (await panel.getByRole("listitem").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
      test.info().annotations.push({ type: "hallazgos", description: JSON.stringify(items) });
      test.info().annotations.push({ type: "resumen", description: await panel.getByRole("status").innerText() });
      expect(items.some((t) => t.includes("Criterio WCAG 1.3.1") && t.includes("salta del nivel 1 al 3")), "salto de encabezado (1.3.1)").toBe(true);
      expect(items.some((t) => t.includes("Criterio WCAG 2.4.4") && t.includes("«aquí»")), "enlace no descriptivo (2.4.4)").toBe(true);
    });
  });
});
