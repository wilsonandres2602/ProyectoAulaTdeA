import fs from "node:fs";
import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { cfg } from "../support/config.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cuentaLista, entrarComoAdmin } from "../support/sesiones.js";
import { sesion } from "../support/cursos.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import { pedir, tokenDeSesion } from "../support/api.js";
import { leerDatos } from "../support/datosCompartidos.js";
import { AuditoriaPage } from "../pages/AuditoriaPage.js";

const base = { hu: "HU-014", rf: "RF-012" };
const UMBRAL = U.s(10, "Informe ≤ 10 s (§7.3/§7.7, solo se registra)");

/** Abre /informes desde el menú lateral. */
async function irAInformes(page) {
  await page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Informes" }).click();
  await expect(page.getByRole("heading", { name: "Informes de avance", level: 1 })).toBeVisible();
  const curso = page.getByRole("combobox", { name: "Curso" });
  await expect(curso.locator("option").nth(1)).toBeAttached();
  return curso;
}

/** Textos de las opciones del desplegable «Curso» (sin «Todos mis cursos»). */
async function cursosListados(select) {
  return (await select.locator("option").allInnerTexts()).map((t) => t.trim()).filter((t) => t && t !== "Todos mis cursos");
}

/** «Descargar PDF|Excel»: mide hasta «Informe generado.», valida el archivo y lo busca en «Informes generados». */
async function descargar(page, formato) {
  const boton = page.getByRole("button", { name: formato === "PDF" ? "Descargar PDF" : "Descargar Excel" });
  const historial = page.getByRole("region", { name: "Informes generados" }).getByRole("listitem");
  const antes = await historial.filter({ hasText: formato === "PDF" ? "PDF" : "Excel" }).count();
  // Se mide hasta la respuesta del POST (el aviso de una descarga anterior puede seguir en pantalla).
  const descarga = page.waitForEvent("download");
  const resp = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/informes");
  await medir(`descargar informe ${formato}`, UMBRAL, () => boton.click(), async () => expect((await resp).status()).toBe(200));
  await expect(page.getByText("Informe generado.", { exact: true }).last()).toBeVisible();
  const d = await descarga;
  const nombre = d.suggestedFilename();
  const cabecera = fs.readFileSync(await d.path()).subarray(0, 4).toString("latin1");
  test.info().annotations.push({ type: `descarga${formato}`, description: `${nombre} (${cabecera.replace(/[^\x20-\x7e]/g, "?")})` });
  expect(nombre).toMatch(formato === "PDF" ? /\.pdf$/i : /\.xlsx$/i);
  // %PDF para el PDF; PK (zip) para el .xlsx. El archivo no se adjunta: contiene datos de estudiantes.
  expect(cabecera.startsWith(formato === "PDF" ? "%PDF" : "PK")).toBeTruthy();
  await expect(historial.filter({ hasText: formato === "PDF" ? "PDF" : "Excel" })).toHaveCount(antes + 1);
}

test.describe("HU-014 · Informes administrativos (RF-012)", () => {
  // ------------------------------------------------------------------ CP-HU014-02
  test("CP-HU014-02 — Descargar PDF y Excel @P1 @HU-014", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU014-02", tecnica: "funcional", clasificacion: "Ruta Crítica",
      clase: "E2E-UI", referenciaPlan: "§7.3; TC-REP-01" });
    const d = leerDatos();
    const ins = { ...d.instructorA, password: cfg.e2ePassword };
    usuarioProbado(ins.correo);
    const page = await sesion(abrirContexto, ins);
    const curso = await test.step("1. /informes y elegir el curso del instructor", async () => {
      const select = await irAInformes(page);
      await select.selectOption({ label: d.cursoA.titulo });
      return select;
    });
    await test.step("2. «Descargar PDF» → .pdf, «Informe generado.» y aparece en «Informes generados»", () => descargar(page, "PDF"));
    await test.step("3. «Descargar Excel» → .xlsx, «Informe generado.» y aparece en «Informes generados»", () => descargar(page, "EXCEL"));
    await expect(curso).toHaveValue(String(d.cursoA.id));
    await verificarAuditoria(abrirContexto, [
      { accion: "INFORME_GENERADO", resultado: "Permitido", usuario: ins.correo, recurso: "informes/PDF" },
      { accion: "INFORME_GENERADO", resultado: "Permitido", usuario: ins.correo, recurso: "informes/EXCEL" },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU014-03 (API)
  test("CP-HU014-03 — Instructor limitado a sus cursos @P1 @HU-014 @api", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU014-03", tecnica: "seguridad", clasificacion: "Ruta Alterna",
      clase: "E2E-API", referenciaPlan: "TC-REP-01; §7.3" });
    const d = leerDatos();
    const insB = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "infinsb" });
    usuarioProbado(insB.correo);
    protegerCuenta(insB.correo, "DENEGACION", 1);
    const page = await sesion(abrirContexto, insB);

    await test.step(`1. UI: el desplegable «Curso» no lista «${d.cursoA.titulo}» (del instructor A)`, async () => {
      await page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Informes" }).click();
      await expect(page.getByRole("heading", { name: "Informes de avance", level: 1 })).toBeVisible();
      const select = page.getByRole("combobox", { name: "Curso" });
      await expect(select.locator("option").first()).toHaveText("Todos mis cursos");
      const lista = await cursosListados(select);
      test.info().annotations.push({ type: "cursosInstructorB", description: JSON.stringify(lista) });
      expect(lista).not.toContain(d.cursoA.titulo);
    });
    await test.step(`2. API: POST /api/informes con cursoId ${d.cursoA.id} → 403 «Ese curso no es tuyo.»`, async () => {
      const r = await pedir(page, "POST", "/api/informes", { token: await tokenDeSesion(page), datos: { formato: "PDF", cursoId: d.cursoA.id } });
      registrarEvento(insB.correo, "DENEGACION");
      expect(r.status).toBe(403);
      expect(r.cuerpo?.mensaje).toBe("Ese curso no es tuyo.");
    });
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP POST (403)", resultado: "Denegado", usuario: insB.correo, recurso: "/api/informes",
    });
  });

  // ------------------------------------------------------------------ CP-HU014-04
  test("CP-HU014-04 — Administrador con alcance global @P1 @HU-014", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU014-04", tecnica: "decisión", clasificacion: "Ruta Crítica",
      clase: "E2E-UI", referenciaPlan: "TC-REP-01" });
    const d = leerDatos();
    usuarioProbado(cfg.adminCorreo);
    const deA = await test.step("Precondición: cursos que ve el instructor A en su desplegable", async () => {
      const p = await sesion(abrirContexto, { ...d.instructorA, password: cfg.e2ePassword });
      const lista = await cursosListados(await irAInformes(p));
      await p.context().close();
      return lista;
    });

    const ctx = await abrirContexto();
    const page = await ctx.newPage();
    await entrarComoAdmin(page);
    await test.step("1. /informes → «Curso»: lista los cursos de todos los instructores", async () => {
      const lista = await cursosListados(await irAInformes(page));
      test.info().annotations.push({ type: "cursosAdmin", description: `${lista.length} cursos; del instructor A: ${deA.length}` });
      expect(lista).toContain(d.cursoA.titulo);
      const ajenos = lista.filter((t) => !deA.includes(t));
      expect(ajenos.length, "Cursos de otros instructores en el desplegable del admin").toBeGreaterThan(0);
    });
    await test.step("2. «Vista previa» con «Todos mis cursos»: incluye estudiantes de varios cursos", async () => {
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/informes/vista"));
      await medir("vista previa global del admin", UMBRAL,
        () => page.getByRole("button", { name: "Vista previa" }).click(),
        () => expect(page.getByRole("region").filter({ has: page.locator("table") }).first()).toBeVisible());
      expect((await resp).status()).toBe(200);
      const tabla = page.locator("table").first();
      const cabeceras = (await tabla.locator("thead th").allInnerTexts()).map((t) => t.trim());
      const iCurso = cabeceras.indexOf("Curso");
      expect(iCurso, `Columnas: ${cabeceras.join(", ")}`).toBeGreaterThanOrEqual(0);
      const filas = tabla.locator("tbody tr");
      const n = await filas.count();
      const cursos = new Set();
      for (let i = 0; i < n; i++) cursos.add((await filas.nth(i).locator("th, td").nth(iCurso).innerText()).trim());
      const muestra = n ? (await filas.first().locator("th, td").allInnerTexts()).join(" | ") : "";
      test.info().annotations.push({ type: "vistaAdmin", description: `${n} filas, ${cursos.size} cursos. Columnas: ${cabeceras.join(", ")}. Primera fila: ${muestra}` });
      expect(cursos.size).toBeGreaterThan(1);
      expect(cursos.has(d.cursoA.titulo)).toBeTruthy();
    });
    await test.step("3. «Descargar PDF» como administrador", () => descargar(page, "PDF"));
    await verificarAuditoria(abrirContexto, {
      accion: "INFORME_GENERADO", resultado: "Permitido", usuario: cfg.adminCorreo, recurso: "informes/PDF",
    });
  });
});

// =================================================================== P2 y P3 de HU-014

const SIN_DATOS = "No hay datos para los filtros elegidos.";

/** «Vista previa» (midiendo) → filas de la tabla como { nombre, celdas[] } y las cabeceras. */
async function vistaPrevia(page, nombre) {
  const resp = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/informes/vista"));
  const tabla = page.getByRole("main").locator("table").first();
  await medir(nombre, UMBRAL, () => page.getByRole("button", { name: "Vista previa" }).click(),
    async () => expect((await resp).status()).toBe(200));
  await expect(tabla.or(page.getByText(SIN_DATOS))).toBeVisible();
  if (!(await tabla.isVisible())) return { cabeceras: [], filas: [] };
  const cabeceras = (await tabla.locator("thead th").allInnerTexts()).map((t) => t.trim());
  const trs = tabla.locator("tbody tr");
  const filas = [];
  for (let i = 0; i < (await trs.count()); i++) {
    filas.push((await trs.nth(i).locator("th, td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()));
  }
  return { cabeceras, filas };
}

test.describe("HU-014 · Informes administrativos, P2 y P3 (RF-012)", () => {
  // ------------------------------------------------------------------ CP-HU014-01
  test("CP-HU014-01 — Filtro por nivel de progreso @P2 @HU-014", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU014-01", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "§7.3",
      ajuste: "Curso del setup: el estudiante A completó su única lectura (100 %) y se agrega un estudiante desechable que se inscribe solo y no avanza (0 %)" });
    const d = leerDatos();
    const ins = { ...d.instructorA, password: cfg.e2ePassword };
    usuarioProbado(ins.correo);
    const nuevo = await cuentaLista(abrirContexto, { etiqueta: "infcero" });
    await test.step(`Precondición: un estudiante sin avance se inscribe en «${d.cursoA.titulo}»`, async () => {
      const p = await sesion(abrirContexto, nuevo);
      await p.getByRole("link", { name: "Mis cursos" }).click();
      await p.getByRole("button", { name: `Inscribirme en ${d.cursoA.titulo}` }).click();
      await expect(p.getByText(`Te inscribiste en «${d.cursoA.titulo}».`).first()).toBeVisible();
      await p.context().close();
    });
    const page = await sesion(abrirContexto, ins);
    const curso = await irAInformes(page);
    await curso.selectOption({ label: d.cursoA.titulo });
    const nombres = (v) => v.filas.map((f) => f[0]);
    await test.step("Precondición: sin filtro de nivel salen los dos estudiantes", async () => {
      const v = await vistaPrevia(page, "vista previa sin nivel");
      test.info().annotations.push({ type: "vistaTodos", description: JSON.stringify(v) });
      expect(nombres(v).some((n) => n.includes(d.estudianteA.nombre))).toBeTruthy();
      expect(nombres(v).some((n) => n.includes(nuevo.nombre))).toBeTruthy();
    });
    await test.step("1. «Nivel de progreso» = «Completado (100 %)» → «Vista previa»: solo filas al 100 %", async () => {
      await page.getByRole("combobox", { name: "Nivel de progreso" }).selectOption({ label: "Completado (100 %)" });
      const v = await vistaPrevia(page, "vista previa con nivel Completado");
      test.info().annotations.push({ type: "vistaCompletado", description: JSON.stringify(v) });
      expect(v.filas.length).toBeGreaterThan(0);
      expect(nombres(v).some((n) => n.includes(d.estudianteA.nombre))).toBeTruthy();
      expect(nombres(v).some((n) => n.includes(nuevo.nombre))).toBeFalsy();
      const iAvance = v.cabeceras.findIndex((c) => /avance|progreso/i.test(c));
      expect(iAvance, `Columnas: ${v.cabeceras.join(", ")}`).toBeGreaterThanOrEqual(0);
      for (const f of v.filas) expect(f[iAvance], `avance de «${f[0]}»`).toMatch(/^100([.,]0+)? ?%$/);
    });
  });

  // ------------------------------------------------------------------ CP-HU014-05
  test("CP-HU014-05 — Sin datos para los filtros @P2 @HU-014", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P2", caso: "CP-HU014-05", tecnica: "partición", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.3", ajuste: "Filtro sin coincidencias: el curso del setup con «Nivel de progreso» = «Alto (80 % a 99 %)» (su estudiante está al 100 %)" });
    const d = leerDatos();
    const ins = { ...d.instructorA, password: cfg.e2ePassword };
    usuarioProbado(ins.correo);
    const page = await sesion(abrirContexto, ins);
    const curso = await irAInformes(page);
    await test.step("1. «Curso» del setup + «Alto (80 % a 99 %)» → «Vista previa»", async () => {
      await curso.selectOption({ label: d.cursoA.titulo });
      await page.getByRole("combobox", { name: "Nivel de progreso" }).selectOption({ label: "Alto (80 % a 99 %)" });
      const v = await vistaPrevia(page, "vista previa sin coincidencias");
      expect(v.filas).toEqual([]);
    });
    await test.step(`Resultado: «${SIN_DATOS}»`, async () => {
      await expect(page.getByRole("status").filter({ hasText: SIN_DATOS })).toBeVisible();
    });
  });

  // ------------------------------------------------------------------ CP-HU014-06
  test("CP-HU014-06 — Rango de fechas inválido @P3 @HU-014", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P3", caso: "CP-HU014-06", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "Adicional" });
    const d = leerDatos();
    const ins = { ...d.instructorA, password: cfg.e2ePassword };
    usuarioProbado(ins.correo);
    const page = await sesion(abrirContexto, ins);
    await irAInformes(page);
    const fechas = new AuditoriaPage(page);
    await test.step("1. «Desde» 20/11/2026 y «Hasta» 10/11/2026", async () => {
      await fechas.escribirFecha(page.getByLabel("Desde"), "2026-11-20");
      await fechas.escribirFecha(page.getByLabel("Hasta"), "2026-11-10");
    });
    await test.step("Resultado: «La fecha final es anterior a la inicial.» y no se puede generar", async () => {
      await expect(page.getByText("La fecha final es anterior a la inicial.")).toBeVisible();
      for (const b of ["Vista previa", "Descargar PDF", "Descargar Excel"]) await expect(page.getByRole("button", { name: b })).toBeDisabled();
    });
  });
});
