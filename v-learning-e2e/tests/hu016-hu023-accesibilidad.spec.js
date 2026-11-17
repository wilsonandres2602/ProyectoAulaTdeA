import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { cfg, ETIQUETA_CORREO_RE } from "../support/config.js";
import { crearCuenta, cuentaLista, entrarComoAdmin, cerrarSesion } from "../support/sesiones.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { escribir, escribirLargo } from "../support/humano.js";
import { marca } from "../support/datos.js";
import { OnboardingPage } from "../pages/OnboardingPage.js";
import { MODULO as MODULO_E2E, sesion, entrarALaComunidad, armarCurso } from "../support/cursos.js";
import { leerDatos } from "../support/datosCompartidos.js";
import { registrarSecreto } from "../support/secretos.js";
import { pedir, tokenDeSesion } from "../support/api.js";
import { Recorrido, foco } from "../support/teclado.js";
import { LoginPage } from "../pages/LoginPage.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";
import { EstudianteCursoPage } from "../pages/EstudianteCursoPage.js";

const ETIQUETAS_WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Precondición (con ratón): el estudiante se inscribe solo en el curso del setup y cierra sesión. */
async function inscribirse(abrirContexto, est, curso) {
  await test.step(`Precondición: ${est.correo} se inscribe en «${curso.titulo}»`, async () => {
    const page = await sesion(abrirContexto, est);
    await page.getByRole("link", { name: "Mis cursos" }).click();
    await page.getByRole("button", { name: `Inscribirme en ${curso.titulo}` }).click();
    await expect(page.getByText(`Te inscribiste en «${curso.titulo}».`).first()).toBeVisible();
    await cerrarSesion(page);
    await page.context().close();
  });
}

/**
 * axe (WCAG 2.1 AA) sobre la pantalla actual. Devuelve las violaciones serias o críticas y anota
 * todas por impacto; también cuenta las regiones role=status/aria-live.
 */
async function auditarPantalla(page, nombre, resumen) {
  return test.step(`axe WCAG 2.1 AA: ${nombre}`, async () => {
    await expect(page.locator("h1").first()).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
    const vivas = await page.locator('[role="status"], [aria-live]').count();
    const porImpacto = {};
    for (const v of r.violations) porImpacto[v.impact ?? "sin impacto"] = [...(porImpacto[v.impact ?? "sin impacto"] ?? []), `${v.id} (${v.nodes.length})`];
    const graves = r.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    resumen.push({ pantalla: nombre, url: new URL(page.url()).pathname, regionesVivas: vivas, violaciones: porImpacto });
    await test.info().attach(`axe-${nombre.replace(/[^a-z0-9]+/gi, "_")}.json`, {
      body: JSON.stringify(r.violations.map((v) => ({ id: v.id, impacto: v.impact, ayuda: v.help, nodos: v.nodes.map((n) => n.target.join(" ")) })), null, 2),
      contentType: "application/json",
    });
    return { graves: graves.map((v) => `${nombre}: ${v.id} [${v.impact}] ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`), vivas };
  });
}

/** Controles con el mismo nombre accesible en la pantalla (se reportan como hallazgo, no fallan). */
async function nombresRepetidos(page) {
  const nombres = await page.locator("main").getByRole("button").evaluateAll((els) =>
    els.filter((e) => e.offsetParent !== null).map((e) => (e.getAttribute("aria-label") || e.innerText || "").replace(/\s+/g, " ").trim()));
  const cuenta = {};
  for (const n of nombres) if (n) cuenta[n] = (cuenta[n] ?? 0) + 1;
  return Object.entries(cuenta).filter(([, c]) => c > 1).map(([n, c]) => `«${n}» ×${c}`);
}

test.describe("HU-016 a HU-023 · Accesibilidad", () => {
  // ------------------------------------------------------------------ CP-HU017-04
  test("CP-HU017-04 — Nombres accesibles y regiones ARIA con axe (WCAG 2.1 AA) @P1 @HU-017 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ hu: "HU-017", rf: "RF-016", prioridad: "P1", caso: "CP-HU017-04", tecnica: "accesibilidad", clasificacion: "Ruta Crítica",
      clase: "E2E-UI", referenciaPlan: "§7.3; TC-ACC-02; AUT-21",
      ajuste: "D-14: se usa WCAG 2.1 AA (las pruebas a11y propias de la app usan 2.2 con mocks)" });
    const d = leerDatos();
    const est = await cuentaLista(abrirContexto, { etiqueta: "axe" });
    usuarioProbado(est.correo);
    await inscribirse(abrirContexto, est, d.cursoA);
    const graves = [];
    const resumen = [];
    const hallazgos = [];
    const sumar = async (page, nombre) => {
      const r = await auditarPantalla(page, nombre, resumen);
      graves.push(...r.graves);
      if (r.vivas === 0) graves.push(`${nombre}: sin regiones role=status ni aria-live`);
      const rep = await nombresRepetidos(page);
      if (rep.length) hallazgos.push(`${nombre}: ${rep.join(", ")}`);
    };

    await test.step("Estudiante: /login, /inicio, /cursos, lección, evaluación y /comunidad", async () => {
      const ctx = await abrirContexto();
      const page = await ctx.newPage();
      const login = new LoginPage(page);
      await login.ir();
      await sumar(page, "login");
      await login.iniciarSesion(est.correo, est.password);
      await expect(page).toHaveURL(/\/inicio/);
      await sumar(page, "inicio (estudiante)");
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await expect(page).toHaveURL(/\/cursos/);
      await sumar(page, "cursos (estudiante)");
      const ep = new EstudianteCursoPage(page);
      await page.getByRole("link", { name: d.cursoA.titulo, exact: true }).click();
      await page.getByRole("link", { name: d.cursoA.lectura, exact: true }).click();
      await expect(page).toHaveURL(/\/contenidos\/\d+/);
      await sumar(page, "lección");
      await ep.completarLectura(d.cursoA.titulo, d.cursoA.lectura);
      await ep.abrirEvaluacion(d.cursoA.evaluacion, "Comenzar");
      await sumar(page, "evaluación (intento)");
      await page.getByRole("link", { name: "Comunidad", exact: true }).click();
      await page.getByRole("combobox", { name: "Curso" }).selectOption({ label: d.cursoA.titulo });
      await expect(page.getByText("Conversación en tiempo real")).toBeVisible();
      await sumar(page, "comunidad");
      await ctx.close();
    });
    await test.step("Instructor: /inicio y /cursos", async () => {
      const page = await sesion(abrirContexto, { ...d.instructorA, password: cfg.e2ePassword });
      await sumar(page, "inicio (instructor)");
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await expect(page.getByRole("heading", { name: "Mis cursos", level: 1 })).toBeVisible();
      await sumar(page, "cursos (instructor)");
      await page.context().close();
    });
    await test.step("Administrador: /usuarios y /auditoria", async () => {
      const ctx = await abrirContexto();
      const page = await ctx.newPage();
      await entrarComoAdmin(page);
      await page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: /Usuarios/ }).first().click();
      await expect(page.getByRole("heading", { name: "Usuarios", level: 1 })).toBeVisible();
      await sumar(page, "usuarios (admin)");
      await page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: /Auditoría/ }).first().click();
      await expect(page.getByRole("heading", { name: "Auditoría", level: 1 })).toBeVisible();
      await sumar(page, "auditoría (admin)");
      await ctx.close();
    });

    test.info().annotations.push({ type: "axeResumen", description: JSON.stringify(resumen) });
    if (hallazgos.length) test.info().annotations.push({ type: "hallazgoNombresRepetidos", description: hallazgos.join(" | ") });
    await test.step("Resultado: 0 violaciones serias o críticas y regiones role=status/aria-live en cada pantalla", async () => {
      expect(graves, "Violaciones serias o críticas (WCAG 2.1 AA)").toEqual([]);
    });
  });

  // ------------------------------------------------------------------ CP-HU017-01
  test("CP-HU017-01 — Navegación solo con teclado: login → inicio → lección → evaluación @P1 @HU-017 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ hu: "HU-017", rf: "RF-016", prioridad: "P1", caso: "CP-HU017-01", tecnica: "accesibilidad", clasificacion: "Ruta Crítica",
      clase: "E2E-UI", referenciaPlan: "TC-ACC-02; §7.3",
      ajuste: "Los diálogos son <dialog> modales: Tab recorre solo el diálogo (no hay trampa porque Esc lo cierra y el foco vuelve al botón que lo abrió). La latencia de foco se mide con el ida y vuelta de Playwright (cota superior)" });
    const d = leerDatos();
    const est = await cuentaLista(abrirContexto, { etiqueta: "teclado" });
    usuarioProbado(est.correo);
    await inscribirse(abrirContexto, est, d.cursoA);

    const ctx = await abrirContexto();
    const page = await ctx.newPage();
    const r = new Recorrido(page);
    const login = new LoginPage(page);

    await test.step("1. /login solo con teclado: correo, contraseña, código y «Entrar»", async () => {
      await login.ir();
      await r.hasta(ETIQUETA_CORREO_RE);
      await r.escribir(est.correo);
      await r.hasta(/^Contraseña$/);
      registrarSecreto(est.password);
      await r.escribir(est.password);
      await r.hasta(/^Continuar$/);
      await r.tecla("Enter");
      await expect(login.tituloCodigo).toBeVisible();
      const codigo = await login.leerOtp();
      const f = await foco(page);
      if (!/Código de 6 dígitos/.test(f.nombre)) await r.hasta(/Código de 6 dígitos/);
      await r.escribir(codigo);
      await r.hasta(/^Entrar$/);
      await r.tecla("Enter");
      await expect(page).toHaveURL(/\/inicio/);
    });
    await test.step("2. /inicio → «Mis cursos» → curso → lección", async () => {
      await r.hasta(/^Mis cursos$/);
      await r.tecla("Enter");
      await expect(page).toHaveURL(/\/cursos$/);
      await r.hasta(new RegExp(`^${d.cursoA.titulo}$`));
      await r.tecla("Enter");
      await expect(page.getByRole("heading", { name: d.cursoA.titulo, level: 1 })).toBeVisible();
      await r.hasta(new RegExp(`^${d.cursoA.lectura}`));
      await r.tecla("Enter");
      await expect(page).toHaveURL(/\/contenidos\/\d+/);
    });
    await test.step("3. Lección: «Marcar como completado» con Enter", async () => {
      await r.hasta(/^Marcar como completado/);
      await r.tecla("Enter");
      await expect(page.getByText("¡Contenido completado!").first()).toBeVisible();
    });
    await test.step("4. «Evaluaciones» → «Comenzar» → responder con Espacio", async () => {
      await r.hasta(/^Evaluaciones$/, { atras: true });
      await r.tecla("Enter");
      await expect(page).toHaveURL(/\/evaluaciones/);
      await r.hasta(new RegExp(`^Comenzar ${d.cursoA.evaluacion}$`));
      await r.tecla("Enter");
      await expect(page).toHaveURL(/\/intentos\/\d+$/);
      await r.hasta(/^Verdadero/);
      await r.tecla("Space");
      await expect(page.getByRole("radio", { name: /^Verdadero( Seleccionada)?$/ })).toHaveAttribute("aria-checked", "true");
    });
    await test.step("5. Diálogo «¿Terminar la evaluación?»: Tab no sale a la página, Esc lo cierra y el foco vuelve", async () => {
      await r.hasta(/^Terminar evaluación$/);
      await r.tecla("Enter");
      const dialogo = page.getByRole("dialog", { name: "¿Terminar la evaluación?" });
      await expect(dialogo).toBeVisible();
      const nombres = new Set();
      for (let i = 0; i < 5; i++) {
        const f = await r.tecla("Tab");
        const dentro = await page.evaluate(() => !!document.activeElement?.closest("dialog[open]") || document.activeElement === document.body);
        expect(dentro, `Tab ${i + 1} sacó el foco del diálogo a «${f.nombre}»`).toBeTruthy();
        if (f.tag !== "body") nombres.add(f.nombre);
      }
      expect(nombres.size, "Tab se mueve entre los controles del diálogo (no se queda en uno)").toBeGreaterThan(1);
      await r.tecla("Escape");
      await expect(dialogo).toBeHidden();
      expect((await foco(page)).nombre).toBe("Terminar evaluación");
    });
    await test.step("6. Terminar con el teclado: «Sí, terminar»", async () => {
      await r.tecla("Enter");
      await expect(page.getByRole("dialog", { name: "¿Terminar la evaluación?" })).toBeVisible();
      await r.hasta(/^Sí, terminar$/);
      await r.tecla("Enter");
      await expect(page).toHaveURL(/\/intentos\/\d+\/resultado$/);
      await expect(page.getByRole("heading", { name: "Detalle por pregunta" })).toBeVisible();
    });
    await test.step("Resultado: el foco fue visible en todas las paradas", () => r.cerrar());
  });
});

// =================================================================== HU-016 · Perfil de accesibilidad

const base16 = { hu: "HU-016", rf: "RF-014, RF-016", prioridad: "P2" };
const UMBRAL_GUARDAR = U.s(2, "§7.3 perfil de accesibilidad < 2 s");
const UMBRAL_PREVIA = U.s(1, "§7.3 vista previa < 1 s (RF-016)");
const html = (page) => page.locator("html");
const categorias = (page) => page.getByRole("group", { name: "Categorías de accesibilidad" });
const opcionCat = (page, nombre) => categorias(page).getByRole("checkbox", { name: new RegExp(`^${nombre}\\b`) });
const panelPrevio = (page) => page.getByRole("complementary", { name: "Vista previa" });
const lineasPrevias = async (page) => (await panelPrevio(page).getByRole("listitem").allInnerTexts()).map((t) => t.trim());

/** Estudiante nuevo: el admin crea la cuenta y él hace el primer acceso y el VARK hasta /onboarding/accesibilidad. */
async function estudianteEnAccesibilidad(abrirContexto, etiqueta) {
  const cuenta = await crearCuenta(abrirContexto, { etiqueta });
  usuarioProbado(cuenta.correo);
  return test.step("Precondición: primer acceso y test VARK hasta «Tu perfil de accesibilidad»", async () => {
    const ctx = await abrirContexto();
    const page = await ctx.newPage();
    await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.temporal);
    const onb = new OnboardingPage(page);
    await onb.cambiarTemporal(cuenta.temporal, cfg.e2ePassword);
    await onb.responderVark();
    await onb.omitirSegundoMetodo();
    await expect(page).toHaveURL(/\/onboarding\/accesibilidad$/);
    await expect(page.getByRole("heading", { name: "¿Qué apoyos te ayudarían?", level: 1 })).toBeVisible();
    cuenta.password = cfg.e2ePassword;
    delete cuenta.temporal;
    return { cuenta, page };
  });
}

/** «Guardar y empezar» midiendo hasta /inicio. */
async function guardarYEmpezar(page) {
  await medir("Guardar y empezar → /inicio", UMBRAL_GUARDAR,
    () => page.getByRole("button", { name: "Guardar y empezar" }).click(),
    () => expect(page).toHaveURL(/\/inicio$/));
}

/** Abre «Accesibilidad» (panel de perfil) y devuelve un getter de cada interruptor por su nombre. */
async function abrirAjustes(page) {
  await page.getByRole("link", { name: "Accesibilidad", exact: true }).first().click();
  await expect(page).toHaveURL(/\/accesibilidad$/);
  await expect(page.getByRole("heading", { name: "Ajusta la plataforma a ti", level: 1 })).toBeVisible();
  return (nombre) => page.getByRole("main").getByRole("switch", { name: nombre, exact: true });
}

test.describe("HU-016 · Perfil de accesibilidad (RF-014, RF-016)", () => {
  // ------------------------------------------------------------------ CP-HU016-01
  test("CP-HU016-01 — Perfil con una categoría y ajustes automáticos @P2 @HU-016 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base16, caso: "CP-HU016-01", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3",
      ajuste: "El documento no cambia de clase: «Alto contraste» se aplica con el atributo data-contrast=\"high\" del <html> (utils/prefs.js), además del tamaño de letra" });
    const { cuenta, page } = await estudianteEnAccesibilidad(abrirContexto, "acc1cat");
    await test.step("Precondición: sin perfil, el documento está en contraste normal", async () => {
      await expect(html(page)).not.toHaveAttribute("data-contrast", "high");
    });
    await test.step("1. Elegir «Visual» → «Guardar y empezar»", async () => {
      await opcionCat(page, "Visual").click();
      await expect(opcionCat(page, "Visual")).toHaveAttribute("aria-checked", "true");
      await guardarYEmpezar(page);
    });
    await test.step("Resultado: se aplica «Alto contraste» y el texto grande en el documento", async () => {
      await expect(html(page)).toHaveAttribute("data-contrast", "high");
      await expect(html(page)).toHaveAttribute("data-reader", "on");
      const tam = await html(page).evaluate((el) => getComputedStyle(el).fontSize);
      test.info().annotations.push({ type: "documento", description: `data-contrast=high, font-size ${tam}` });
      expect(parseFloat(tam)).toBeGreaterThanOrEqual(20);
    });
    await verificarAuditoria(abrirContexto, { accion: "ACCESIBILIDAD_PERFIL_GUARDADO", resultado: "Permitido", usuario: cuenta.correo, recurso: "[VISUAL]" });
  });

  // ------------------------------------------------------------------ CP-HU016-02
  test("CP-HU016-02 — Varias categorías se combinan @P2 @HU-016 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base16, caso: "CP-HU016-02", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const { cuenta, page } = await estudianteEnAccesibilidad(abrirContexto, "accvarias");
    await test.step("1. Elegir «Visual» y «Auditiva»: la vista previa combina los ajustes", async () => {
      await opcionCat(page, "Visual").click();
      await opcionCat(page, "Auditiva").click();
      await expect(panelPrevio(page).getByText("Subtítulos activados")).toBeVisible();
      const l = await lineasPrevias(page);
      test.info().annotations.push({ type: "vistaPrevia", description: JSON.stringify(l) });
      for (const t of ["Alto contraste", "Optimizado para lector de pantalla", "Subtítulos activados", "Transcripciones activadas"]) expect(l).toContain(t);
    });
    await test.step("2. «Guardar y empezar»", () => guardarYEmpezar(page));
    await test.step("Resultado: en «Accesibilidad» quedan activos los ajustes de las dos categorías", async () => {
      const sw = await abrirAjustes(page);
      for (const n of ["Alto contraste", "Optimizar para lector de pantalla", "Subtítulos", "Transcripciones"]) {
        await expect(sw(n), n).toHaveAttribute("aria-checked", "true");
      }
      await expect(html(page)).toHaveAttribute("data-contrast", "high");
    });
    await verificarAuditoria(abrirContexto, { accion: "ACCESIBILIDAD_PERFIL_GUARDADO", resultado: "Permitido", usuario: cuenta.correo, recursoContiene: /VISUAL.*AUDITIVA|AUDITIVA.*VISUAL/ });
  });

  // ------------------------------------------------------------------ CP-HU016-03
  test("CP-HU016-03 — Ninguna categoría (en lugar de omitir) @P2 @HU-016 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base16, caso: "CP-HU016-03", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "Con ajuste", referenciaPlan: "§7.3",
      ajuste: "No hay un botón «Omitir»; «Ninguna» cumple esa función" });
    const { cuenta, page } = await estudianteEnAccesibilidad(abrirContexto, "accninguna");
    await test.step("1. Sin elegir nada: «Guardar y empezar» no está disponible y dice por qué", async () => {
      await expect(page.getByRole("button", { name: "Guardar y empezar" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Guardar y ajustar manualmente" })).toBeDisabled();
      await expect(page.getByText("Elige al menos una opción o «Ninguna».")).toBeVisible();
    });
    await test.step("2. «Ninguna» → «Guardar y empezar»", async () => {
      await opcionCat(page, "Ninguna").click();
      await expect(page.getByRole("button", { name: "Guardar y empezar" })).toBeEnabled();
      await guardarYEmpezar(page);
    });
    await test.step("Resultado: valores por defecto (contraste normal, texto de 16 px, sin lector)", async () => {
      await expect(html(page)).toHaveAttribute("data-contrast", "normal");
      await expect(html(page)).toHaveAttribute("data-reader", "off");
      expect(parseFloat(await html(page).evaluate((el) => getComputedStyle(el).fontSize))).toBe(16);
    });
    await verificarAuditoria(abrirContexto, { accion: "ACCESIBILIDAD_PERFIL_GUARDADO", resultado: "Permitido", usuario: cuenta.correo, recurso: "[]" });
  });

  // ------------------------------------------------------------------ CP-HU016-04
  test("CP-HU016-04 — Vista previa según la categoría @P2 @HU-016 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base16, caso: "CP-HU016-04", tecnica: "partición", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3 (RF-016)" });
    const { page } = await estudianteEnAccesibilidad(abrirContexto, "accprevia");
    await test.step("Precondición: «Vista previa» sin categoría", async () => {
      await expect(panelPrevio(page).getByText("Elige una categoría para ver cómo cambiará la plataforma.")).toBeVisible();
    });
    await test.step("1. Elegir «Visual»: la vista previa muestra sus ajustes", async () => {
      await medir("vista previa al elegir Visual", UMBRAL_PREVIA,
        () => opcionCat(page, "Visual").click(),
        () => expect(panelPrevio(page).getByText("Alto contraste", { exact: true })).toBeVisible());
      const l = await lineasPrevias(page);
      test.info().annotations.push({ type: "previaVisual", description: JSON.stringify(l) });
      expect(l).toContain("Texto de 20 px, interlineado 1.6");
      expect(l).not.toContain("Subtítulos activados");
    });
    await test.step("2. Cambiar a «Auditiva»: la vista previa cambia", async () => {
      await opcionCat(page, "Visual").click();
      await medir("vista previa al cambiar a Auditiva", UMBRAL_PREVIA,
        () => opcionCat(page, "Auditiva").click(),
        () => expect(panelPrevio(page).getByText("Subtítulos activados", { exact: true })).toBeVisible());
      const l = await lineasPrevias(page);
      test.info().annotations.push({ type: "previaAuditiva", description: JSON.stringify(l) });
      expect(l).toContain("Transcripciones activadas");
      expect(l).not.toContain("Alto contraste");
    });
  });

  // ------------------------------------------------------------------ CP-HU016-05
  test("CP-HU016-05 — Restablecer valores predeterminados @P2 @HU-016 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base16, caso: "CP-HU016-05", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "accreset" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    const sw = await abrirAjustes(page);
    await test.step("Precondición: ajustes modificados (activar «Alto contraste»)", async () => {
      await expect(sw("Alto contraste")).toHaveAttribute("aria-checked", "false");
      await sw("Alto contraste").click();
      await expect(sw("Alto contraste")).toHaveAttribute("aria-checked", "true");
      await expect(page.getByText(/^Cambios guardados automáticamente a las/)).toBeVisible();
      await expect(html(page)).toHaveAttribute("data-contrast", "high");
    });
    await test.step("1. «Restablecer valores predeterminados» → «Sí, restablecer» → «Restablecimos los valores predeterminados.»", async () => {
      await page.getByRole("button", { name: "Restablecer valores predeterminados" }).click();
      const d = page.getByRole("dialog", { name: "¿Restablecer los ajustes?" });
      await medir("restablecer", UMBRAL_GUARDAR,
        () => d.getByRole("button", { name: "Sí, restablecer" }).click(),
        () => expect(page.getByText("Restablecimos los valores predeterminados.").first()).toBeVisible());
    });
    await test.step("Resultado: «Alto contraste» vuelve a desactivarse", async () => {
      await expect(sw("Alto contraste")).toHaveAttribute("aria-checked", "false");
      await expect(html(page)).toHaveAttribute("data-contrast", "normal");
    });
    await verificarAuditoria(abrirContexto, { accion: "ACCESIBILIDAD_RESTABLECIDA", resultado: "Permitido", usuario: est.correo });
  });

  // ------------------------------------------------------------------ CP-HU016-06
  test("CP-HU016-06 — Los ajustes persisten entre sesiones @P2 @HU-016 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base16, caso: "CP-HU016-06", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3; TC-ACC-01" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "accpersiste" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await test.step("Precondición: activar «Alto contraste» y «Subrayar enlaces»", async () => {
      const sw = await abrirAjustes(page);
      for (const n of ["Alto contraste", "Subrayar enlaces"]) {
        await sw(n).click();
        await expect(sw(n)).toHaveAttribute("aria-checked", "true");
      }
      await expect(page.getByText(/^Cambios guardados automáticamente a las/)).toBeVisible();
      await page.waitForTimeout(1500); // el guardado automático va después de cada cambio; solo se espera
      await cerrarSesion(page);
      await page.context().close();
    });
    await test.step("1. Contexto nuevo → login → «Accesibilidad»: los ajustes se conservan", async () => {
      const p2 = await sesion(abrirContexto, est);
      await expect(html(p2)).toHaveAttribute("data-contrast", "high");
      await expect(html(p2)).toHaveAttribute("data-links", "underline");
      const sw = await abrirAjustes(p2);
      for (const n of ["Alto contraste", "Subrayar enlaces"]) await expect(sw(n), n).toHaveAttribute("aria-checked", "true");
    });
  });
});

// =================================================================== HU-017 · P2

test.describe("HU-017 · Navegación con teclado, P2 (RF-016)", () => {
  // ------------------------------------------------------------------ CP-HU017-02
  test("CP-HU017-02 — Enlace para saltar al contenido @P2 @HU-017 @a11y", async ({ abrirContexto }) => {
    caso({ hu: "HU-017", rf: "RF-016", prioridad: "P2", caso: "CP-HU017-02", tecnica: "accesibilidad", clasificacion: "Ruta Crítica",
      clase: "E2E-UI", referenciaPlan: "§7.3", defecto: "D-32" });
    // D-32 (defecto confirmado por el usuario): AppShell.jsx mueve el foco a <main> al abrir cada pantalla, así que el primer Tab no llega
    // al enlace «Saltar al contenido principal» (queda antes de main en el orden del documento).
    const est = await cuentaLista(abrirContexto, { etiqueta: "kbsalto" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await test.step("Precondición: /inicio recién cargada", async () => {
      await page.reload();
      await expect(page.getByRole("main")).toBeVisible();
      test.info().annotations.push({ type: "focoAlCargar", description: JSON.stringify(await foco(page)) });
    });
    await test.step("1. Primer Tab: «Saltar al contenido principal» (plan)", async () => {
      await page.keyboard.press("Tab");
      const f = await foco(page);
      test.info().annotations.push({ type: "primerFoco", description: JSON.stringify(f) });
      expect.soft(f.nombre, "D-32: el primer Tab no llega al enlace para saltar").toBe("Saltar al contenido principal");
    });
    await test.step("1b. El enlace se alcanza con Mayús+Tab y tiene foco visible", async () => {
      let pasos = 0;
      for (; pasos < 40 && (await foco(page)).nombre !== "Saltar al contenido principal"; pasos++) await page.keyboard.press("Shift+Tab");
      const f = await foco(page);
      test.info().annotations.push({ type: "pasosHastaElEnlace", description: `${pasos} Mayús+Tab desde el primer Tab` });
      expect(f.nombre).toBe("Saltar al contenido principal");
      expect(f.visible, `foco visible (${f.estilo})`).toBeTruthy();
      await expect(page.getByRole("link", { name: "Saltar al contenido principal" })).toBeInViewport();
    });
    await test.step("2. Enter: el foco pasa a main", async () => {
      await page.keyboard.press("Enter");
      await expect(page.locator("main#contenido")).toBeFocused();
      await page.keyboard.press("Tab");
      const f = await foco(page);
      test.info().annotations.push({ type: "siguienteFoco", description: JSON.stringify(f) });
      const dentro = await page.evaluate(() => document.getElementById("contenido").contains(document.activeElement));
      expect(dentro, "el siguiente Tab sigue dentro del contenido principal").toBeTruthy();
    });
  });

  // ------------------------------------------------------------------ CP-HU017-03
  test("CP-HU017-03 — Lista de atajos con la tecla ? @P2 @HU-017 @a11y", async ({ abrirContexto }) => {
    caso({ hu: "HU-017, HU-022", rf: "RF-016", prioridad: "P2", caso: "CP-HU017-03", tecnica: "accesibilidad", clasificacion: "Ruta Alterna",
      clase: "E2E-UI", referenciaPlan: "§7.3" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "kbatajos" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    const antes = await test.step("Precondición: el foco está en un control de /inicio (primer Tab)", async () => {
      await page.reload();
      await expect(page.getByRole("main")).toBeVisible();
      await page.keyboard.press("Tab");
      const f = await foco(page);
      test.info().annotations.push({ type: "focoAntes", description: JSON.stringify(f) });
      expect(f.tag).not.toBe("body");
      return f;
    });
    const dialogo = page.getByRole("dialog", { name: "Atajos de teclado" });
    await test.step("1. Tecla «?»: diálogo «Atajos de teclado»", async () => {
      await page.keyboard.press("?");
      await expect(dialogo).toBeVisible();
      for (const t of [/^Ctrl \+ K\s+\/\s+⌘ \+ K$/, /^Tab \/ Mayús \+ Tab$/, /^Esc$/, /^\?$/]) await expect(dialogo.getByText(t)).toBeVisible();
      await expect(dialogo.getByText("Mostrar esta lista de atajos")).toBeVisible();
      const dentro = await page.evaluate(() => document.querySelector("dialog[open]")?.contains(document.activeElement) ?? false);
      test.info().annotations.push({ type: "focoEnDialogo", description: String(dentro) });
      expect(dentro, "el foco entra al diálogo").toBeTruthy();
    });
    await test.step("2. Esc lo cierra y el foco vuelve a donde estaba", async () => {
      await page.keyboard.press("Escape");
      await expect(dialogo).toBeHidden();
      const f = await foco(page);
      test.info().annotations.push({ type: "focoAlCerrar", description: JSON.stringify(f) });
      expect(f.nombre).toBe(antes.nombre);
    });
  });
});

// =================================================================== HU-018 · Ajustes visuales

const base18 = { hu: "HU-018", rf: "RF-016, RF-035", prioridad: "P2" };
const UMBRAL_VISUAL = U.s(1, "§7.3 cambio visual < 1 s (RF-016)");
const GUARDADO = /^Cambios guardados automáticamente a las/;
const estilo = (page, sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const deslizador = (page, rotulo) => page.getByRole("main").getByRole("slider", { name: new RegExp(`^${rotulo}`) });

/** Mueve un deslizador con las flechas del teclado hasta que su nombre accesible diga `meta`. */
async function moverDeslizador(page, rotulo, meta, tecla) {
  const s = deslizador(page, rotulo);
  const texto = () => s.evaluate((el) => el.labels?.[0]?.innerText ?? "");
  await s.focus();
  for (let i = 0; i < 30 && !(await texto()).includes(meta); i++) await page.keyboard.press(tecla);
  expect(await texto()).toContain(meta);
}

test.describe("HU-018 · Ajustes visuales (RF-016, RF-035)", () => {
  // ------------------------------------------------------------------ CP-HU018-01
  test("CP-HU018-01 — Alto contraste, tamaño, tipografía e interlineado @P2 @HU-018 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base18, caso: "CP-HU018-01", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "TC-ACC-01; §7.3",
      defecto: "D-33" });
    // D-33 (defecto confirmado por el usuario): al entrar en otro contexto, PrefsContext.jsx cambia Atkinson/Lexend por «Poppins + Inter» si en ese
    // navegador no está la marca local de elección manual (localStorage), aunque el servidor guardó la elección.
    const est = await cuentaLista(abrirContexto, { etiqueta: "accvisual" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    const sw = await abrirAjustes(page);
    const antes = { texto: await estilo(page, "main p", "color"), tam: await estilo(page, "html", "font-size"),
      familia: await estilo(page, "body", "font-family"), lh: await estilo(page, "html", "--lh") };
    test.info().annotations.push({ type: "estiloAntes", description: JSON.stringify(antes) });
    await test.step("1. «Alto contraste»: cambian los colores (el texto pasa a negro)", async () => {
      // index.css: con data-contrast="high" se oscurecen el texto y los bordes; el fondo no cambia.
      await medir("alto contraste", UMBRAL_VISUAL, () => sw("Alto contraste").click(),
        async () => expect.poll(() => estilo(page, "main p", "color"), { timeout: 5000 }).toBe("rgb(0, 0, 0)"));
      expect(antes.texto).not.toBe("rgb(0, 0, 0)");
      await expect(html(page)).toHaveAttribute("data-contrast", "high");
    });
    await test.step("2. «Tamaño del texto:» 16 → 20 px (flechas)", async () => {
      await moverDeslizador(page, "Tamaño del texto:", "20 px", "ArrowRight");
      await expect.poll(() => estilo(page, "html", "font-size")).toBe("20px");
    });
    await test.step("3. «Tipografía» = «Atkinson Hyperlegible Next»", async () => {
      await medir("tipografía", UMBRAL_VISUAL,
        () => page.getByRole("main").getByLabel("Tipografía").selectOption({ label: "Atkinson Hyperlegible Next" }),
        async () => expect.poll(() => estilo(page, "body", "font-family"), { timeout: 5000 }).toMatch(/Atkinson/i));
      await expect(html(page)).toHaveAttribute("data-font", "atkinson");
    });
    await test.step("4. «Interlineado:» 1.5 → 1.8 (flechas)", async () => {
      await moverDeslizador(page, "Interlineado:", "1.8", "ArrowRight");
      await expect.poll(async () => (await estilo(page, "html", "--lh")).trim()).toBe("1.8");
    });
    await test.step("Resultado: «Cambios guardados automáticamente a las …»", async () => {
      await expect(page.getByRole("main").getByText(GUARDADO)).toBeVisible();
      await page.waitForTimeout(1500); // guardado diferido (600 ms) de la última tecla; solo se espera
      test.info().annotations.push({ type: "estiloDespues", description: JSON.stringify({ texto: await estilo(page, "main p", "color"),
        tam: await estilo(page, "html", "font-size"), familia: await estilo(page, "body", "font-family"), lh: await estilo(page, "html", "--lh") }) });
      await cerrarSesion(page);
      await page.context().close();
    });
    await test.step("Resultado: persiste tras volver a entrar", async () => {
      const p2 = await sesion(abrirContexto, est);
      await expect(html(p2)).toHaveAttribute("data-contrast", "high");
      await expect.soft(html(p2), "D-33: la tipografía elegida no persiste").toHaveAttribute("data-font", "atkinson");
      expect(await estilo(p2, "html", "font-size")).toBe("20px");
      expect((await estilo(p2, "html", "--lh")).trim()).toBe("1.8");
      await abrirAjustes(p2);
      await expect(deslizador(p2, "Tamaño del texto: 20 px")).toBeVisible();
      await expect(deslizador(p2, "Interlineado: 1.8")).toBeVisible();
      test.info().annotations.push({ type: "tipografiaAlVolver", description: await p2.getByRole("main").getByLabel("Tipografía").inputValue() });
      await expect.soft(p2.getByRole("main").getByLabel("Tipografía"), "D-33: la tipografía elegida no persiste").toHaveValue("Atkinson Hyperlegible Next");
    });
    await verificarAuditoria(abrirContexto, { accion: "ACCESIBILIDAD_CONFIGURACION_GUARDADA", resultado: "Permitido", usuario: est.correo });
  });

  // ------------------------------------------------------------------ CP-HU018-02
  test("CP-HU018-02 — Combinación sugerida @P2 @HU-018 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base18, caso: "CP-HU018-02", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "Con ajuste", referenciaPlan: "§7.3",
      ajuste: "El estudiante no elige colores: la combinación sugerida aparece cuando los ajustes no alcanzan para su perfil (ReglasAccesibilidad.advertencias). Con perfil Visual se desactiva «Alto contraste» y se aplica la sugerencia" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "accsugerida", categorias: ["Visual"] });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    const sw = await abrirAjustes(page);
    const avisoContraste = page.getByText("Indicaste necesidades visuales: activa el alto contraste para leer con más facilidad.");
    await test.step("Precondición: perfil Visual con «Alto contraste» activo", async () => {
      await expect(sw("Alto contraste")).toHaveAttribute("aria-checked", "true");
    });
    await test.step("1. Desactivar «Alto contraste»: aviso y «Aplicar la combinación sugerida»", async () => {
      await sw("Alto contraste").click();
      await expect(avisoContraste).toBeVisible();
      await expect(page.getByRole("button", { name: "Aplicar la combinación sugerida" })).toBeVisible();
      test.info().annotations.push({ type: "avisos", description: (await page.getByRole("main").getByRole("status").filter({ hasText: "Indicaste" }).innerText()).replace(/\s+/g, " ") });
    });
    await test.step("2. «Aplicar la combinación sugerida»: se aplica", async () => {
      await medir("aplicar la combinación sugerida", UMBRAL_VISUAL,
        () => page.getByRole("button", { name: "Aplicar la combinación sugerida" }).click(),
        () => expect(html(page)).toHaveAttribute("data-contrast", "high"));
      await expect(sw("Alto contraste")).toHaveAttribute("aria-checked", "true");
      await expect(avisoContraste).toBeHidden();
      await expect(page.getByRole("button", { name: "Aplicar la combinación sugerida" })).toHaveCount(0);
      test.info().annotations.push({ type: "tipografiaSugerida", description: await page.getByRole("main").getByLabel("Tipografía").inputValue() });
    });
  });

  // ------------------------------------------------------------------ CP-HU018-03
  test("CP-HU018-03 — La información no depende solo del color @P2 @HU-018 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base18, caso: "CP-HU018-03", tecnica: "accesibilidad", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3; TC-ACC-01" });
    await test.step("1. Reglas de la contraseña (primer acceso): cada una dice «: cumple» o «: falta»", async () => {
      const cuenta = await crearCuenta(abrirContexto, { etiqueta: "accreglas" });
      const ctx = await abrirContexto();
      const page = await ctx.newPage();
      await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.temporal);
      await expect(page).toHaveURL(/\/primer-acceso/);
      await escribir(new OnboardingPage(page).nueva, "abc"); // texto de prueba, no es una contraseña real
      const reglas = page.getByRole("main").getByRole("listitem").filter({ hasText: /: (cumple|falta)$/ });
      await expect(reglas.first()).toBeVisible();
      const textos = (await reglas.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
      test.info().annotations.push({ type: "reglasContrasena", description: JSON.stringify(textos) });
      expect(textos.length).toBeGreaterThan(1);
      for (const t of textos) expect(t).toMatch(/: (cumple|falta)$/);
      expect(textos.some((t) => t.endsWith(": cumple"))).toBeTruthy();
      expect(textos.some((t) => t.endsWith(": falta"))).toBeTruthy();
      await ctx.close();
    });
    const est = await cuentaLista(abrirContexto, { etiqueta: "accsubraya" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await test.step("2. Insignias de estado con texto (/cursos)", async () => {
      await page.getByRole("link", { name: "Mis cursos" }).click();
      const insignia = page.getByRole("main").getByText(/^\d+ cursos?$/i).first();
      await expect(insignia).toBeVisible();
      test.info().annotations.push({ type: "insignia", description: await insignia.innerText() });
    });
    await test.step("3. «Subrayar enlaces»: los enlaces quedan subrayados y axe link-in-text-block = 0", async () => {
      const sw = await abrirAjustes(page);
      await sw("Subrayar enlaces").click();
      await expect(sw("Subrayar enlaces")).toHaveAttribute("aria-checked", "true");
      await expect(html(page)).toHaveAttribute("data-links", "underline");
      const decoraciones = await page.getByRole("main").locator("a").evaluateAll((els) =>
        els.filter((e) => e.offsetParent !== null).map((e) => getComputedStyle(e).textDecorationLine));
      test.info().annotations.push({ type: "decoracionEnlaces", description: JSON.stringify(decoraciones) });
      expect(decoraciones.length).toBeGreaterThan(0);
      for (const d of decoraciones) expect(d).toContain("underline");
      const r = await new AxeBuilder({ page }).withRules(["link-in-text-block"]).analyze();
      expect(r.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ CP-HU018-04
  test("CP-HU018-04 — Fuente para dislexia (RF-035) @P3 @HU-018 @a11y", async ({ abrirContexto }) => {
    caso({ ...base18, rf: "RF-035", prioridad: "P3", caso: "CP-HU018-04", tecnica: "funcional", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "RF-035 (adicional)" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "accdislexia" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await abrirAjustes(page);
    await test.step("1. «Tipografía» = «OpenDyslexic»: la familia calculada es OpenDyslexic", async () => {
      await medir("tipografía OpenDyslexic", UMBRAL_VISUAL,
        () => page.getByRole("main").getByLabel("Tipografía").selectOption({ label: "OpenDyslexic" }),
        async () => expect.poll(() => estilo(page, "body", "font-family"), { timeout: 5000 }).toMatch(/OpenDyslexic/i));
      await expect(html(page)).toHaveAttribute("data-font", "opendyslexic");
      const familia = await estilo(page, "main p", "font-family");
      test.info().annotations.push({ type: "familia", description: familia });
      expect(familia).toMatch(/^"?OpenDyslexic/i);
      await expect(page.getByRole("main").getByText(GUARDADO)).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, { accion: "ACCESIBILIDAD_CONFIGURACION_GUARDADA", resultado: "Permitido", usuario: est.correo });
  });
});

// =================================================================== HU-019 · Contenido accesible y lectura en voz alta

const base19 = { hu: "HU-019", rf: "RF-018", prioridad: "P2" };
const IMG_URL = "https://example.org/e2e/diagrama.png";
const LECTURA_IMG = "Lectura con imagen";
const LECTURA_VOZ = "Lectura para escuchar";
const TEXTO_VOZ = "Primera frase de la lectura. Segunda frase de la lectura. Tercera frase de la lectura. Cuarta frase de la lectura. Quinta frase de la lectura. Sexta frase de la lectura.";
const voz = (page) => page.getByRole("group", { name: "Lectura en voz alta" });
const estadoVoz = (page) => voz(page).getByRole("status");

/**
 * Curso de HU-019 armado por la UI la primera vez: instructor desechable, «Módulo E2E» con una
 * lectura que tiene una imagen con texto alternativo y otra lectura de varias frases para la voz.
 */
let curso19 = null;
async function cursoHu019(abrirContexto) {
  if (curso19) return curso19;
  const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "vozins" });
  curso19 = await test.step("Precondición: el instructor arma el curso de HU-019 por la UI", async () => {
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const c = { titulo: `E2E-Voz-${marca()}`, ins };
    await ed.ir();
    c.id = await ed.crearCurso(c.titulo, "Curso de las pruebas E2E de contenido accesible.");
    await ed.abrirEditor(c.titulo);
    await ed.crearModulo(MODULO_E2E);
    c.img = await ed.crearLecturaPublicada(MODULO_E2E, LECTURA_IMG, `Mira el diagrama antes de seguir. ![Diagrama de flujo](${IMG_URL}) Después responde la pregunta.`);
    c.voz = await ed.crearLecturaPublicada(MODULO_E2E, LECTURA_VOZ, TEXTO_VOZ);
    await ed.publicarCurso();
    await cerrarSesion(page);
    await page.context().close();
    return c;
  });
  return curso19;
}

/** Estudiante desechable, inscrito solo, con la lección abierta. */
async function abrirLeccion(abrirContexto, c, titulo, etiqueta, { ctx } = {}) {
  const est = await cuentaLista(abrirContexto, { etiqueta });
  usuarioProbado(est.correo);
  const contexto = ctx ?? await abrirContexto();
  const page = await contexto.newPage();
  await new LoginPage(page).iniciarSesion(est.correo, est.password);
  await expect(page).toHaveURL(/\/inicio/);
  await page.getByRole("link", { name: "Mis cursos" }).click();
  await page.getByRole("button", { name: `Inscribirme en ${c.titulo}` }).click();
  await expect(page.getByText(`Te inscribiste en «${c.titulo}».`).first()).toBeVisible();
  await page.getByRole("link", { name: c.titulo, exact: true }).click();
  await page.getByRole("link", { name: titulo, exact: true }).click();
  await expect(page).toHaveURL(/\/contenidos\/\d+$/);
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
  return { est, page };
}

test.describe("HU-019 · Contenido accesible y lectura en voz alta (RF-018, RF-036, RF-049)", () => {
  // ------------------------------------------------------------------ CP-HU019-01
  test("CP-HU019-01 — Imagen con texto alternativo @P2 @HU-019 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base19, caso: "CP-HU019-01", tecnica: "accesibilidad", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3",
      defecto: "D-34" });
    // D-34 (defecto, impacto Medio-2; ya en docs/requisitos/auditoria-rf-032-049.md §1.1 de la app): Leccion.jsx muestra el cuerpo como texto plano ({c.cuerpo}); «![alt](url)» se ve literal y no hay <img>.
    const c = await cursoHu019(abrirContexto);
    const { page } = await abrirLeccion(abrirContexto, c, LECTURA_IMG, "vozimg");
    await test.step("1. Abrir la lección: la imagen tiene alt=«Diagrama de flujo»", async () => {
      const cuerpo = (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
      const imagenes = await page.getByRole("main").locator("img").evaluateAll((els) => els.map((e) => ({ src: e.getAttribute("src"), alt: e.getAttribute("alt") })));
      test.info().annotations.push({ type: "imagenesEnLaLeccion", description: JSON.stringify(imagenes) });
      test.info().annotations.push({ type: "textoDeLaLeccion", description: cuerpo.slice(0, 400) });
      await expect(page.getByRole("main").getByRole("img", { name: "Diagrama de flujo" })).toHaveAttribute("alt", "Diagrama de flujo");
    });
  });

  // ------------------------------------------------------------------ CP-HU019-02
  test("CP-HU019-02 — Imagen sin texto alternativo: aviso al instructor (RF-049) @P2 @HU-019 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base19, rf: "RF-018, RF-049", caso: "CP-HU019-02", tecnica: "accesibilidad", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const c = await cursoHu019(abrirContexto);
    usuarioProbado(c.ins.correo);
    const page = await sesion(abrirContexto, c.ins);
    const ed = new CursosInstructorPage(page);
    await ed.ir();
    await ed.abrirEditor(c.titulo);
    await test.step("1. Nueva lectura con «![](enlace)» → abrir el contenido en el editor: aviso de imagen sin texto alternativo", async () => {
      await ed.pestana("Contenido").click();
      await page.getByRole("button", { name: `Nuevo contenido en ${MODULO_E2E}` }).click();
      const d = page.getByRole("dialog", { name: "Nuevo contenido" });
      await escribir(d.getByLabel("Título del contenido"), "Lectura sin alt");
      await d.getByLabel("Formato").selectOption({ label: "Lectura" });
      await escribir(d.getByLabel("Texto de la lección"), `Observa la figura. ![](${IMG_URL}) Fin.`);
      await ed.observarPost(/^\/api\/modulos\/\d+\/contenidos$/, () => d.getByRole("button", { name: "Crear contenido" }).click());
      const e = page.getByRole("dialog", { name: "Editar contenido" });
      await expect(e.getByText("Hay 1 imagen(es) sin texto alternativo. Escribe la descripción entre corchetes: ![descripción](enlace).")).toBeVisible();
    });
  });

  // ------------------------------------------------------------------ CP-HU019-03
  test("CP-HU019-03 — Leer en voz alta: pausar, reanudar, velocidad, retroceder y detener @P2 @HU-019 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base19, caso: "CP-HU019-03", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "Con ajuste", referenciaPlan: "§7.3",
      ajuste: "No se verifica el audio real (Chromium sin interfaz puede no tener voces): se comprueban los estados que anuncia la región «Lectura en voz alta» y los controles" });
    const c = await cursoHu019(abrirContexto);
    const { page } = await abrirLeccion(abrirContexto, c, LECTURA_VOZ, "vozleer");
    const voces = await page.evaluate(() => window.speechSynthesis?.getVoices().length ?? -1);
    test.info().annotations.push({ type: "vocesDelNavegador", description: String(voces) });
    await test.step("1. «Velocidad» ofrece 0,75× a 2×", async () => {
      const opciones = (await voz(page).getByLabel("Velocidad").locator("option").allInnerTexts()).map((t) => t.trim());
      expect(opciones).toEqual(["0,75×", "1×", "1,25×", "1,5×", "2×"]);
    });
    await test.step("2. «Leer en voz alta» → «Leyendo frase 1 de 6»", async () => {
      await medir("inicio de la lectura en voz alta", U.s(3, "§7.3 inicio de la voz < 3 s"),
        () => voz(page).getByRole("button", { name: "Leer en voz alta" }).click(),
        () => expect(estadoVoz(page)).toHaveText(/^Leyendo frase \d+ de 6$/));
    });
    await test.step("3. «Pausar» → «Lectura en pausa»; «Reanudar» → «Leyendo frase …»", async () => {
      await voz(page).getByRole("button", { name: "Pausar" }).click();
      await expect(estadoVoz(page)).toHaveText("Lectura en pausa");
      await voz(page).getByRole("button", { name: "Reanudar" }).click();
      await expect(estadoVoz(page)).toHaveText(/^Leyendo frase \d+ de 6$/);
    });
    await test.step("4. «Velocidad» = 1,5× y «Retroceder» siguen leyendo", async () => {
      await voz(page).getByLabel("Velocidad").selectOption({ label: "1,5×" });
      await expect(voz(page).getByLabel("Velocidad")).toHaveValue("1.5");
      await voz(page).getByRole("button", { name: /^Retroceder/ }).click();
      await expect(estadoVoz(page)).toHaveText(/^Leyendo frase \d+ de 6$/);
    });
    await test.step("5. «Detener» vuelve a «Leer en voz alta»", async () => {
      await voz(page).getByRole("button", { name: "Detener" }).click();
      await expect(voz(page).getByRole("button", { name: "Leer en voz alta" })).toBeVisible();
      await expect(estadoVoz(page)).toHaveText("");
    });
  });

  // ------------------------------------------------------------------ CP-HU019-04
  test("CP-HU019-04 — Navegador sin Web Speech API @P2 @HU-019 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base19, caso: "CP-HU019-04", tecnica: "compatibilidad", clasificacion: "Ruta Alterna", clase: "Con ajuste", referenciaPlan: "§7.3",
      entorno: "Entorno simulado: navegador sin speechSynthesis ni SpeechRecognition (addInitScript, decisión 3; solo en este caso)" });
    const c = await cursoHu019(abrirContexto);
    const ctx = await abrirContexto();
    // Decisión 3: único uso permitido de addInitScript. Solo quita la Web Speech API; nada más del navegador.
    await ctx.addInitScript(() => {
      for (const k of ["speechSynthesis", "SpeechSynthesisUtterance", "SpeechRecognition", "webkitSpeechRecognition"]) {
        for (const o of [window, Window.prototype]) { try { delete o[k]; } catch { /* propiedad no configurable */ } }
      }
    });
    const { page } = await abrirLeccion(abrirContexto, c, LECTURA_VOZ, "voznoapi", { ctx });
    await test.step("Precondición: el navegador no tiene speechSynthesis", async () => {
      expect(await page.evaluate(() => "speechSynthesis" in window)).toBe(false);
    });
    await test.step("1. «Leer en voz alta» → «Tu navegador no admite lectura en voz alta.»", async () => {
      await voz(page).getByRole("button", { name: "Leer en voz alta" }).click();
      await expect(page.getByText("Tu navegador no admite lectura en voz alta.").first()).toBeVisible();
      await expect(voz(page).getByRole("button", { name: "Pausar" })).toHaveCount(0);
    });
  });

  // ------------------------------------------------------------------ CP-HU019-05
  test("CP-HU019-05 — Descargar el MP3 de la lectura (RF-036) @P3 @HU-019 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base19, rf: "RF-036", prioridad: "P3", caso: "CP-HU019-05", tecnica: "funcional", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "RF-036 (adicional)", ajuste: "Proveedor de voz «prueba» del backend: el MP3 es silencio" });
    const c = await cursoHu019(abrirContexto);
    const { est, page } = await abrirLeccion(abrirContexto, c, LECTURA_VOZ, "vozmp3");
    await test.step("1. «Descargar audio» → archivo .mp3 y «Descarga lista.»", async () => {
      const descarga = page.waitForEvent("download");
      const resp = page.waitForResponse((r) => r.request().method() === "GET" && /\/api\/contenidos\/\d+\/audio$/.test(new URL(r.url()).pathname));
      await voz(page).getByRole("button", { name: "Descargar audio" }).click();
      expect((await resp).status()).toBe(200);
      const d = await descarga;
      const nombre = d.suggestedFilename();
      const cabecera = fs.readFileSync(await d.path()).subarray(0, 3);
      test.info().annotations.push({ type: "mp3", description: `${nombre} (${cabecera.toString("hex")})` });
      expect(nombre).toMatch(/\.mp3$/i);
      // MP3: etiqueta «ID3» o la sincronía de trama 0xFFEx/0xFFFx.
      expect(cabecera.toString("latin1") === "ID3" || (cabecera[0] === 0xff && (cabecera[1] & 0xe0) === 0xe0), "cabecera de MP3").toBeTruthy();
      await expect(page.getByText("Descarga lista.").first()).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, { accion: "AUDIO_DESCARGADO", resultado: "Permitido", usuario: est.correo, recursoContiene: `contenidos/${c.voz}` });
  });
});

// =================================================================== HU-020 · Medios accesibles (RF-019, RF-037)

const base20 = { hu: "HU-020", rf: "RF-019", prioridad: "P2" };
const UMBRAL_PUBLICAR = U.s(2, "§7.3 publicar < 2 s");
const VIDEO_URL = "https://example.org/e2e/clase.mp4";
const FALTA = {
  transcripcionVideo: "Falta la transcripción completa del video.",
  subtitulos: "Falta cargar los subtítulos del video.",
  enlaceVideo: "Falta el enlace del video.",
  transcripcionPodcast: "Falta la transcripción completa del podcast.",
};
const MOTIVO_NO_PUBLICA = "Agrega los recursos que faltan para poder publicar.";

/** Instructor desechable con un curso y «Módulo E2E», armado una vez para los casos de HU-020. */
let curso20 = null;
async function cursoHu020(abrirContexto) {
  if (curso20) return curso20;
  const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "medins" });
  curso20 = await test.step("Precondición: el instructor crea el curso de HU-020 por la UI", async () => {
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const c = { titulo: `E2E-Medios-${marca()}`, ins };
    await ed.ir();
    c.id = await ed.crearCurso(c.titulo, "Curso de las pruebas E2E de medios accesibles.");
    await ed.abrirEditor(c.titulo);
    await ed.crearModulo(MODULO_E2E);
    await cerrarSesion(page);
    await page.context().close();
    return c;
  });
  return curso20;
}

/** El instructor abre el editor del curso de HU-020. */
async function editorHu020(abrirContexto, c) {
  usuarioProbado(c.ins.correo);
  const page = await sesion(abrirContexto, c.ins);
  const ed = new CursosInstructorPage(page);
  await ed.ir();
  await ed.abrirEditor(c.titulo);
  return { page, ed };
}

/** «Nuevo contenido» de video o podcast (con o sin enlace) → queda abierto «Editar contenido». */
async function nuevoMedio(page, ed, titulo, formato, url) {
  await ed.pestana("Contenido").click();
  await page.getByRole("button", { name: `Nuevo contenido en ${MODULO_E2E}` }).click();
  const d = page.getByRole("dialog", { name: "Nuevo contenido" });
  await escribir(d.getByLabel("Título del contenido"), titulo);
  await d.getByLabel("Formato").selectOption({ label: formato });
  if (url) await escribir(d.getByLabel("Enlace del recurso (video, audio o simulación)"), url);
  const c = await ed.observarPost(/^\/api\/modulos\/\d+\/contenidos$/, () => d.getByRole("button", { name: "Crear contenido" }).click());
  const e = page.getByRole("dialog", { name: "Editar contenido" });
  await expect(e.getByRole("region", { name: "Conformidad y publicación" })).toBeVisible();
  return { id: c.id, e };
}

/** «Tipo de recurso» → enlace o texto → «Agregar recurso» → «Agregaste el recurso: <tipo>.» */
async function agregarRecurso(page, ed, e, tipo, { url, texto }) {
  await e.getByLabel("Tipo de recurso").selectOption({ label: tipo });
  if (url) await escribir(e.getByLabel("Enlace (URL)"), url);
  else await escribir(e.getByLabel("Texto", { exact: true }), texto);
  await ed.observarPost(/^\/api\/contenidos\/\d+\/recursos$/, () => e.getByRole("button", { name: "Agregar recurso" }).click());
  await expect(page.getByText(`Agregaste el recurso: ${tipo}.`).first()).toBeVisible();
}

const conformidad = (e) => e.getByRole("region", { name: "Conformidad y publicación" });

/**
 * Estado «no se puede publicar»: el aviso «No se puede publicar todavía. Falta:» con los faltantes
 * esperados (y solo esos) y «Publicar contenido» deshabilitado con su motivo.
 */
async function noPublicable(e, faltantes) {
  const s = conformidad(e);
  await expect(s.getByText("No se puede publicar todavía. Falta:")).toBeVisible();
  const items = (await s.getByRole("listitem").allInnerTexts()).map((t) => t.trim()).filter((t) => t.startsWith("Falta"));
  test.info().annotations.push({ type: "faltantes", description: JSON.stringify(items) });
  expect(items.sort()).toEqual([...faltantes].sort());
  await expect(s.getByRole("button", { name: "Publicar contenido" })).toBeDisabled();
  await expect(s.getByText(MOTIVO_NO_PUBLICA)).toBeVisible();
}

/** «Publicar contenido» (midiendo) → «Contenido publicado.» y «Despublicar contenido». */
async function publicar(page, e) {
  const s = conformidad(e);
  await expect(s.getByText("Cumple con los requisitos de accesibilidad de su formato.")).toBeVisible();
  const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/contenidos\/\d+\/publicar$/.test(new URL(r.url()).pathname));
  await medir("publicar contenido", UMBRAL_PUBLICAR, () => s.getByRole("button", { name: "Publicar contenido" }).click(),
    () => expect(page.getByText("Contenido publicado.").first()).toBeVisible());
  expect((await resp).status()).toBeLessThan(400);
  await expect(s.getByRole("button", { name: "Despublicar contenido" })).toBeVisible();
}

/** D-35 (diferencia): la UI previene la publicación, así que no se exige fila de auditoría. */
const AJUSTE_D35 = "D-35 (diferencia): la UI previene la publicación; no se exige fila de auditoría";

test.describe("HU-020 · Medios accesibles (RF-019, RF-037)", () => {
  // ------------------------------------------------------------------ CP-HU020-01
  test("CP-HU020-01 — Publicar video sin transcripción @P2 @HU-020 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base20, caso: "CP-HU020-01", tecnica: "decisión", clasificacion: "Ruta Crítica", clase: "Con ajuste",
      referenciaPlan: "§7.14; Tabla B fila 2; TC-CUR-01; TC-MEDIA-01", ajuste: AJUSTE_D35 });
    const c = await cursoHu020(abrirContexto);
    const { page, ed } = await editorHu020(abrirContexto, c);
    const { e } = await test.step("Precondición: video con enlace y subtítulos, sin transcripción", async () => {
      const m = await nuevoMedio(page, ed, "Video sin transcripción", "Video", VIDEO_URL);
      await agregarRecurso(page, ed, m.e, "Subtítulos", { url: VIDEO_URL.replace(".mp4", ".vtt") });
      return m;
    });
    await test.step("1. Abrir el contenido → «Publicar contenido»: «No se puede publicar todavía. Falta:» «Falta la transcripción completa del video.»", () =>
      noPublicable(e, [FALTA.transcripcionVideo]));
  });

  // ------------------------------------------------------------------ CP-HU020-02 (Tabla B)
  const FILAS = [
    { fila: 1, nombre: "enlace, subtítulos y transcripción", url: true, sub: true, trans: true, faltan: [] },
    { fila: 3, nombre: "enlace y transcripción, sin subtítulos", url: true, sub: false, trans: true, faltan: [FALTA.subtitulos] },
    { fila: 4, nombre: "solo el enlace", url: true, sub: false, trans: false, faltan: [FALTA.subtitulos, FALTA.transcripcionVideo] },
    { fila: 5, nombre: "subtítulos y transcripción, sin enlace", url: false, sub: true, trans: true, faltan: [FALTA.enlaceVideo] },
  ];
  for (const f of FILAS) {
    test(`CP-HU020-02 — Tabla B fila ${f.fila}: ${f.nombre} @P2 @HU-020 @a11y`, async ({ abrirContexto }) => {
      test.setTimeout(10 * 60_000);
      caso({ ...base20, caso: "CP-HU020-02", tecnica: "decisión", clasificacion: f.fila === 1 ? "Ruta Crítica" : "Ruta Alterna", clase: f.faltan.length ? "Con ajuste" : "E2E-UI",
        referenciaPlan: `§7.12.3 Tabla B fila ${f.fila}`, ajuste: f.faltan.length ? AJUSTE_D35 : undefined });
      const c = await cursoHu020(abrirContexto);
      const { page, ed } = await editorHu020(abrirContexto, c);
      const { id, e } = await test.step(`Precondición: video con ${f.nombre}`, async () => {
        const m = await nuevoMedio(page, ed, `Video fila ${f.fila}`, "Video", f.url ? VIDEO_URL : null);
        if (f.sub) await agregarRecurso(page, ed, m.e, "Subtítulos", { url: VIDEO_URL.replace(".mp4", ".vtt") });
        if (f.trans) await agregarRecurso(page, ed, m.e, "Transcripción", { texto: `Transcripción del video de la fila ${f.fila}.` });
        return m;
      });
      if (!f.faltan.length) {
        await test.step("1. «Publicar contenido» → «Contenido publicado.»", () => publicar(page, e));
        await verificarAuditoria(abrirContexto, { accion: "CONTENIDO_PUBLICADO", resultado: "Permitido", usuario: c.ins.correo, recursoContiene: `contenidos/${id}` });
        return;
      }
      await test.step(`1. «Publicar contenido»: ${f.faltan.join(" ")}`, () => noPublicable(e, f.faltan));
    });
  }

  // ------------------------------------------------------------------ CP-HU020-03
  test("CP-HU020-03 — Agregar la transcripción y publicar @P2 @HU-020 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base20, caso: "CP-HU020-03", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "TC-CUR-01",
      ajuste: "La precondición «Caso 01» se arma dentro del caso (video con enlace y subtítulos, sin transcripción)" });
    const c = await cursoHu020(abrirContexto);
    const { page, ed } = await editorHu020(abrirContexto, c);
    const { id, e } = await test.step("Precondición (caso 01): video con enlace y subtítulos, sin transcripción", async () => {
      const m = await nuevoMedio(page, ed, "Video al que le falta la transcripción", "Video", VIDEO_URL);
      await agregarRecurso(page, ed, m.e, "Subtítulos", { url: VIDEO_URL.replace(".mp4", ".vtt") });
      await expect(conformidad(m.e).getByText(FALTA.transcripcionVideo)).toBeVisible();
      return m;
    });
    await test.step("1. «Agregar un recurso accesible» → «Tipo de recurso» = Transcripción → «Texto» → «Agregar recurso»", () =>
      agregarRecurso(page, ed, e, "Transcripción", { texto: "Transcripción completa del video de las pruebas E2E." }));
    await test.step("2. «Publicar contenido» → «Contenido publicado.»", () => publicar(page, e));
    await verificarAuditoria(abrirContexto, [
      { accion: "RECURSO_ACCESIBLE_AGREGADO", resultado: "Permitido", usuario: c.ins.correo, minimo: 2 },
      { accion: "CONTENIDO_PUBLICADO", resultado: "Permitido", usuario: c.ins.correo, recursoContiene: `contenidos/${id}` },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU020-04
  test("CP-HU020-04 — Podcast sin transcripción bloqueado @P2 @HU-020 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base20, rf: "RF-019, RF-039", caso: "CP-HU020-04", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "Con ajuste",
      referenciaPlan: "HU-020 y RF-039", ajuste: AJUSTE_D35 });
    const c = await cursoHu020(abrirContexto);
    const { page, ed } = await editorHu020(abrirContexto, c);
    const { e } = await test.step("Precondición: podcast con enlace, sin transcripción", () =>
      nuevoMedio(page, ed, "Podcast sin transcripción", "Podcast", "https://example.org/e2e/episodio.mp3"));
    await test.step("1. «Publicar contenido»: «Falta la transcripción completa del podcast.»", () => noPublicable(e, [FALTA.transcripcionPodcast]));
  });

  // ------------------------------------------------------------------ CP-HU020-05
  test("CP-HU020-05 — El estudiante elige subtítulos, transcripción o texto equivalente @P2 @HU-020 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base20, caso: "CP-HU020-05", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3; TC-MEDIA-01" });
    const c = await cursoHu020(abrirContexto);
    const VIDEO = "Video conforme";
    await test.step("Precondición: el instructor publica un video conforme y el curso", async () => {
      const { page, ed } = await editorHu020(abrirContexto, c);
      await ed.crearContenidoPublicado(MODULO_E2E, VIDEO, { formato: "Video", url: VIDEO_URL });
      if (await page.getByRole("button", { name: "Publicar curso" }).isVisible()) await ed.publicarCurso();
      await cerrarSesion(page);
      await page.context().close();
    });
    const est = await cuentaLista(abrirContexto, { etiqueta: "medest" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await test.step("1. Inscribirse y abrir la lección del video", async () => {
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await page.getByRole("button", { name: `Inscribirme en ${c.titulo}` }).click();
      await expect(page.getByText(`Te inscribiste en «${c.titulo}».`).first()).toBeVisible();
      await page.getByRole("link", { name: c.titulo, exact: true }).click();
      await page.getByRole("link", { name: VIDEO, exact: true }).click();
      await expect(page.getByRole("heading", { name: VIDEO })).toBeVisible();
    });
    await test.step("Resultado: el video tiene una pista de subtítulos «Español»", async () => {
      const pistas = await page.locator("video track").evaluateAll((ts) => ts.map((t) => ({ kind: t.kind, label: t.label, srclang: t.srclang, src: t.getAttribute("src") })));
      test.info().annotations.push({ type: "pistas", description: JSON.stringify(pistas) });
      expect(pistas).toEqual([expect.objectContaining({ kind: "captions", label: "Español", srclang: "es" })]);
    });
    await test.step("2. «Formas de estudiar» → «Versión en texto»: se muestra la transcripción", async () => {
      const pestanas = page.getByRole("tablist", { name: "Formas de estudiar" });
      await pestanas.getByRole("tab", { name: "Versión en texto" }).click();
      await expect(page.getByRole("tabpanel").getByText(`Transcripción de «${VIDEO}».`)).toBeVisible();
    });
  });

  // ------------------------------------------------------------------ CP-HU020-06
  test("CP-HU020-06 — Subtítulos automáticos con revisión (RF-037) @P3 @HU-020 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base20, rf: "RF-037", prioridad: "P3", caso: "CP-HU020-06", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "RF-037 (adicional)", ajuste: "Proveedor de transcripción «prueba» del backend. Al crear el video la app ya pide un borrador; el caso pide uno nuevo y lo revisa" });
    const c = await cursoHu020(abrirContexto);
    const { page, ed } = await editorHu020(abrirContexto, c);
    const { id, e } = await test.step("Precondición: video con enlace", () => nuevoMedio(page, ed, "Video con subtítulos automáticos", "Video", VIDEO_URL));
    const sub = e.getByRole("region", { name: "Subtítulos automáticos" });
    const estado = sub.getByRole("status");
    await test.step("1. «Generar borrador automático» → «Pedimos el borrador de subtítulos.» → «Borrador listo para revisar…»", async () => {
      // Al crear un video con enlace la app ya pide el borrador sola (RF-037 «al subir un video»):
      // si ya existe, se pide uno nuevo con «Generar un borrador nuevo».
      await expect(estado).not.toHaveText("");
      const inicial = (await estado.innerText()).trim();
      test.info().annotations.push({ type: "estadoAlCrear", description: inicial });
      const boton = inicial === "Todavía no hay borrador de subtítulos." ? "Generar borrador automático" : "Generar un borrador nuevo";
      await sub.getByRole("button", { name: boton }).click();
      await expect(page.getByText("Pedimos el borrador de subtítulos.").first()).toBeVisible();
      await expect(estado).toContainText("Borrador listo para revisar", { timeout: 60_000 });
      test.info().annotations.push({ type: "estadoBorrador", description: await estado.innerText() });
      const lineas = sub.getByRole("list", { name: "Líneas de subtítulos" }).getByRole("listitem");
      expect(await lineas.count()).toBeGreaterThan(0);
    });
    await test.step("2. Revisar: corregir el texto de la línea 1 → «Guardar subtítulos»", async () => {
      await escribir(sub.getByLabel("Texto de la línea 1"), "Texto revisado por el instructor.");
      await sub.getByRole("button", { name: "Guardar subtítulos" }).click();
      await expect(page.getByText("Guardamos los cambios del borrador.").first()).toBeVisible();
    });
    await test.step("3. «Aprobar subtítulos» → «Subtítulos aprobados: ya forman parte del contenido.»", async () => {
      await sub.getByRole("button", { name: "Aprobar subtítulos" }).click();
      await expect(page.getByText("Subtítulos aprobados.").first()).toBeVisible();
      await expect(estado).toHaveText("Subtítulos aprobados: ya forman parte del contenido.");
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "SUBTITULOS_SOLICITADOS", resultado: "Permitido", usuario: c.ins.correo, recursoContiene: `contenidos/${id}` },
      { accion: "SUBTITULOS_APROBADOS", resultado: "Permitido", usuario: c.ins.correo, recursoContiene: `contenidos/${id}` },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU020-08 (E2E-API, D-35)
  const MEDIOS_API = [
    { medio: "video", formato: "Video", url: VIDEO_URL, sub: true, falta: FALTA.transcripcionVideo },
    { medio: "podcast", formato: "Podcast", url: "https://example.org/e2e/episodio-api.mp3", sub: false, falta: FALTA.transcripcionPodcast },
  ];
  for (const m of MEDIOS_API) {
    test(`CP-HU020-08 — Publicación no conforme por API: ${m.medio} sin transcripción @P2 @HU-020 @a11y @api`, async ({ abrirContexto }) => {
      test.setTimeout(10 * 60_000);
      caso({ ...base20, rf: "RF-019, RF-039", caso: "CP-HU020-08", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-API",
        referenciaPlan: "D-35; HU-020 y RF-019 (rechazo y auditoría en el backend)" });
      const c = await cursoHu020(abrirContexto);
      const { page, ed } = await editorHu020(abrirContexto, c);
      const titulo = `${m.formato} API sin transcripción`;
      const { id } = await test.step(`Precondición: ${m.medio} con enlace${m.sub ? " y subtítulos" : ""}, sin transcripción, creado por la UI`, async () => {
        const r = await nuevoMedio(page, ed, titulo, m.formato, m.url);
        if (m.sub) await agregarRecurso(page, ed, r.e, "Subtítulos", { url: VIDEO_URL.replace(".mp4", ".vtt") });
        await expect(conformidad(r.e).getByText(m.falta)).toBeVisible();
        return r;
      });
      await test.step(`1. POST /api/contenidos/<id>/publicar con el token de la sesión → 422 CONTENIDO_NO_CONFORME con «${m.falta}»`, async () => {
        const r = await pedir(page, "POST", `/api/contenidos/${id}/publicar`, { token: await tokenDeSesion(page) });
        test.info().annotations.push({ type: "respuesta", description: JSON.stringify({ status: r.status, codigo: r.cuerpo?.codigo, mensaje: r.cuerpo?.mensaje }) });
        expect(r.status).toBe(422);
        expect(r.cuerpo?.codigo).toBe("CONTENIDO_NO_CONFORME");
        expect(r.cuerpo?.mensaje).toContain(m.falta);
      });
      await test.step("Resultado: el contenido sigue sin publicar («Borrador» en la lista del módulo)", async () => {
        await page.reload();
        await ed.pestana("Contenido").click();
        const fila = page.getByRole("listitem").filter({ has: page.getByText(titulo, { exact: true }) });
        await expect(fila.getByText("Borrador", { exact: true })).toBeVisible();
        await expect(fila.getByText("Publicado", { exact: true })).toHaveCount(0);
      });
      await verificarAuditoria(abrirContexto, { accion: "PUBLICACION_RECHAZADA_NO_CONFORME", resultado: "Denegado", usuario: c.ins.correo, recursoContiene: `contenidos/${id}` });
    });
  }
});

// =================================================================== HU-021 · Discapacidad auditiva (RF-034, RF-040)

const base21 = { hu: "HU-021", rf: "RF-040", prioridad: "P3" };
const SENAS_URL = "https://example.org/e2e/interprete-lsc.mp4";
const MSG_SENAS = "Este contenido incluye interpretación en lengua de señas.";

/** Instructor desechable con un curso publicado, «Módulo E2E» y un video conforme sin intérprete. */
let curso21 = null;
async function cursoHu021(abrirContexto) {
  if (curso21) return curso21;
  const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "auins" });
  curso21 = await test.step("Precondición: el instructor crea y publica el curso de HU-021 por la UI", async () => {
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const c = { titulo: `E2E-Auditiva-${marca()}`, ins, sinSenas: "Video sin intérprete" };
    await ed.ir();
    c.id = await ed.crearCurso(c.titulo, "Curso de las pruebas E2E de discapacidad auditiva.");
    await ed.abrirEditor(c.titulo);
    await ed.crearModulo(MODULO_E2E);
    await ed.crearContenidoPublicado(MODULO_E2E, c.sinSenas, { formato: "Video", url: VIDEO_URL });
    await ed.publicarCurso();
    await cerrarSesion(page);
    await page.context().close();
    return c;
  });
  return curso21;
}

/** Video con enlace, subtítulos, transcripción y el recurso «Lengua de señas»; queda abierto «Editar contenido». */
async function videoConSenas(page, ed, titulo) {
  const m = await nuevoMedio(page, ed, titulo, "Video", VIDEO_URL);
  await agregarRecurso(page, ed, m.e, "Subtítulos", { url: VIDEO_URL.replace(".mp4", ".vtt") });
  await agregarRecurso(page, ed, m.e, "Transcripción", { texto: `Transcripción de «${titulo}».` });
  await agregarRecurso(page, ed, m.e, "Lengua de señas", { url: SENAS_URL });
  return m;
}

test.describe("HU-021 · Discapacidad auditiva (RF-034, RF-040)", () => {
  // ------------------------------------------------------------------ CP-HU021-01
  test("CP-HU021-01 — Anuncio de mensajes en una región aria-live (RF-034) @P3 @HU-021 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base21, rf: "RF-034", caso: "CP-HU021-01", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const c = await cursoHu021(abrirContexto);
    const a = await cuentaLista(abrirContexto, { etiqueta: "auchata" });
    const b = await cuentaLista(abrirContexto, { etiqueta: "auchatb" });
    usuarioProbado(b.correo);
    const pb = await sesion(abrirContexto, b);
    await test.step("Precondición: B tiene activado «Anunciar mensajes y notificaciones»", async () => {
      const sw = (await abrirAjustes(pb))("Anunciar mensajes y notificaciones");
      if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "true");
    });
    await entrarALaComunidad(pb, c);
    const pa = await sesion(abrirContexto, a);
    await entrarALaComunidad(pa, c);
    const texto = `Aviso para B ${Date.now()}`;
    const region = pb.locator('[aria-live="polite"]').filter({ hasText: texto });
    await test.step(`1. A envía «${texto}»`, async () => {
      await escribir(pa.getByLabel("Escribe un mensaje"), texto);
      await medir("anuncio del mensaje en la región aria-live de B", U.s(1, "RF-034 < 1 s"),
        () => pa.getByRole("button", { name: "Enviar", exact: true }).click(),
        () => expect(region).toHaveCount(1));
    });
    await test.step("Resultado: en la página de B, la región aria-live recibe el texto y el mensaje se ve en la conversación", async () => {
      test.info().annotations.push({ type: "anuncio", description: (await region.innerText()).trim() });
      await expect(region).toContainText(texto);
      const log = pb.getByRole("log", { name: "Mensajes del curso" });
      await expect(log.getByText(texto, { exact: true })).toBeVisible();
      await expect(log).toHaveAttribute("aria-live", "off");
    });
  });

  // ------------------------------------------------------------------ CP-HU021-02
  test("CP-HU021-02 — Lengua de señas disponible y no disponible (RF-040) @P3 @HU-021 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base21, caso: "CP-HU021-02", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const c = await cursoHu021(abrirContexto);
    const CON = "Video con intérprete";
    const id = await test.step("Precondición: el instructor agrega «Lengua de señas» a un video y lo publica", async () => {
      const { page, ed } = await editorHu020(abrirContexto, c);
      const m = await videoConSenas(page, ed, CON);
      await publicar(page, m.e);
      await m.e.getByRole("button", { name: "Cerrar" }).first().click();
      await expect(m.e).toBeHidden();
      await cerrarSesion(page);
      await page.context().close();
      return m.id;
    });
    const est = await cuentaLista(abrirContexto, { etiqueta: "auest" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await test.step("Precondición: el estudiante se inscribe en el curso", async () => {
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await page.getByRole("button", { name: `Inscribirme en ${c.titulo}` }).click();
      await expect(page.getByText(`Te inscribiste en «${c.titulo}».`).first()).toBeVisible();
    });
    const abrir = async (titulo) => {
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await page.getByRole("link", { name: c.titulo, exact: true }).click();
      await page.getByRole("link", { name: titulo, exact: true }).click();
      await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
    };
    await test.step(`1. Abrir «${CON}»: «${MSG_SENAS}»`, async () => {
      await abrir(CON);
      await expect(page.getByText(MSG_SENAS)).toBeVisible();
      await expect(page.getByRole("button", { name: "Mostrar intérprete de lengua de señas" })).toBeVisible();
    });
    await test.step(`2. Abrir «${c.sinSenas}»: no aparece «${MSG_SENAS}»`, async () => {
      await abrir(c.sinSenas);
      await expect(page.getByRole("tablist", { name: "Formas de estudiar" })).toBeVisible();
      await expect(page.getByText(MSG_SENAS)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Mostrar intérprete de lengua de señas" })).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, { accion: "RECURSO_ACCESIBLE_AGREGADO", resultado: "Permitido", usuario: c.ins.correo, recursoContiene: `contenidos/${id} LENGUA_SENAS` });
  });

  // ------------------------------------------------------------------ CP-HU021-03
  test("CP-HU021-03 — Desfase del intérprete (RF-040) @P3 @HU-021 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base21, caso: "CP-HU021-03", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "RF-040 (adicional)" });
    const c = await cursoHu021(abrirContexto);
    const { page, ed } = await editorHu020(abrirContexto, c);
    const { e } = await test.step("Precondición: video con el recurso «Lengua de señas»", () => videoConSenas(page, ed, "Video para el desfase"));
    const campoDesfase = e.getByLabel("Desfase del intérprete (milisegundos)");
    const guardar = e.getByRole("button", { name: "Guardar desfase" });
    await test.step("1. «Desfase del intérprete (milisegundos)» = 500 → «Guardar desfase»: «Guardamos el desfase del intérprete.»", async () => {
      await escribir(campoDesfase, "500");
      await guardar.click();
      await expect(page.getByText("Guardamos el desfase del intérprete.").first()).toBeVisible();
      await expect(campoDesfase).toHaveValue("500");
    });
    await test.step("2. Desfase = 700000 → «Guardar desfase»: «El desfase no puede superar 10 minutos.»", async () => {
      await escribir(campoDesfase, "700000");
      await guardar.click();
      await expect(page.getByRole("alert").filter({ hasText: "El desfase no puede superar 10 minutos." })).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, { accion: "DESFASE_LENGUA_SENAS", resultado: "Permitido", usuario: c.ins.correo, recursoContiene: " 500 ms" });
  });
});

// =================================================================== HU-022 · Discapacidad motriz (RF-021)

const base22 = { hu: "HU-022", rf: "RF-021", prioridad: "P2" };
const OBJETIVO_MIN = 44; // WCAG 2.5.5 / §7.3: área de toque ≥ 44×44 px

/**
 * Mide (solo lectura) los controles visibles de la pantalla: botones, enlaces con forma de botón,
 * campos, radios, interruptores y entradas del menú. Devuelve los que miden menos de 44×44 px.
 */
async function controlesPequenos(page, pantalla) {
  const medidas = await page.locator("button, a.vl-btn, .vl-input, [role='radio'], [role='switch'], .vl-nav-item").evaluateAll((els) =>
    els.filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const nombre = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 60);
        return { nombre, ancho: Math.round(r.width), alto: Math.round(r.height) };
      })
      .filter((m) => m.ancho > 2 && m.alto > 2)); // los sr-only miden 1×1 y no son objetivos de toque
  const pequenos = medidas.filter((m) => m.ancho < 44 || m.alto < 44);
  test.info().annotations.push({ type: `controles ${pantalla}`, description: `${medidas.length} medidos; menores de 44×44: ${JSON.stringify(pequenos)}` });
  return { medidas, pequenos };
}

test.describe("HU-022 · Discapacidad motriz (RF-021)", () => {
  // ------------------------------------------------------------------ CP-HU022-01
  test("CP-HU022-01 — Controles ampliados con el perfil motor @P2 @HU-022 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base22, caso: "CP-HU022-01", tecnica: "límite", clasificacion: "Ruta Crítica", clase: "Con ajuste", referenciaPlan: "§7.3", defecto: "D-36",
      ajuste: "«Ampliado» según la app: ReglasAccesibilidad no tiene un tamaño; con la categoría MOTORA, utils/prefs.js pone data-targets=\"large\" en <html> e index.css da min-height 3.5rem a botones, campos, radios, interruptores y menú. Se mide que todo control visible sea ≥ 44×44 px" });
    const { page } = await estudianteEnAccesibilidad(abrirContexto, "motor");
    await test.step("Precondición: elegir «Motora» → «Guardar y empezar»", async () => {
      await opcionCat(page, "Motora").click();
      await expect(opcionCat(page, "Motora")).toHaveAttribute("aria-checked", "true");
      await guardarYEmpezar(page);
      await expect(html(page)).toHaveAttribute("data-targets", "large");
    });
    const pantallas = [
      ["Inicio", async () => { await expect(page).toHaveURL(/\/inicio$/); }],
      ["Mis cursos", async () => { await page.getByRole("link", { name: "Mis cursos" }).click(); await expect(page).toHaveURL(/\/cursos/); }],
      ["Accesibilidad", async () => { await abrirAjustes(page); }],
    ];
    const todos = [];
    for (const [nombre, ir] of pantallas) {
      await test.step(`1. Medir los controles principales en «${nombre}»: área de toque ≥ ${OBJETIVO_MIN}×${OBJETIVO_MIN} px`, async () => {
        await ir();
        await page.waitForLoadState("networkidle");
        const { medidas, pequenos } = await controlesPequenos(page, nombre);
        expect(medidas.length, `hay controles que medir en «${nombre}»`).toBeGreaterThan(0);
        todos.push(...pequenos.map((p) => ({ pantalla: nombre, ...p })));
      });
    }
    await test.step(`Resultado: ningún control mide menos de ${OBJETIVO_MIN}×${OBJETIVO_MIN} px`, () => {
      expect(todos, "controles con área de toque menor de 44×44 px").toEqual([]);
    });
  });

  // ------------------------------------------------------------------ CP-HU022-02
  test("CP-HU022-02 — Alternativa accesible a arrastrar y soltar @P2 @HU-022 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base22, caso: "CP-HU022-02", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "Con ajuste", referenciaPlan: "§7.3; HU-029 (CP-HU029-05)",
      ajuste: "La app no tiene actividades de arrastrar y soltar: se valida que la marca «Tiene alternativa accesible…» persista (marcada y sin marcar, también al editar otro campo) y su efecto en «Notas del curso» para un estudiante con perfil motor",
      defecto: "D-37" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "altins" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "altmotor", categorias: ["Motora"] });
    usuarioProbado(ins.correo);
    const CON = "Quiz con alternativa";
    const SIN = "Quiz sin alternativa";
    const SIN_EDITADO = "Quiz sin alternativa (título editado)";
    const curso = await armarCurso(abrirContexto, ins, {
      prefijo: "E2E-Motriz",
      evaluaciones: [
        { titulo: CON, puntajeMaximo: 10, alternativa: true, preguntas: [{ enunciado: `Pregunta de ${CON}`, puntaje: 10 }] },
        { titulo: SIN, puntajeMaximo: 10, alternativa: false, preguntas: [{ enunciado: `Pregunta de ${SIN}`, puntaje: 10 }] },
      ],
      inscritos: [est],
    });
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const abrirEvaluaciones = async () => {
      await ed.ir();
      await ed.abrirEditor(curso.titulo);
      await ed.pestana("Evaluaciones y tareas").click();
    };
    const filaEv = (t) => page.getByRole("listitem").filter({ has: page.getByText(t, { exact: true }) });
    const SIN_ALT = "Sin alternativa accesible";
    const abrirEdicion = async (titulo) => {
      await page.getByRole("button", { name: `Editar ${titulo}` }).click();
      const d = page.getByRole("dialog", { name: "Editar evaluación" });
      await expect(d.getByLabel("Título")).toHaveValue(titulo);
      return { d, casilla: d.getByRole("checkbox", { name: /Tiene alternativa accesible/ }) };
    };
    /** Celda de la evaluación sin alternativa (la segunda creada) del estudiante motor en «Notas del curso». */
    const celdaNotas = async () => {
      await ed.abrirNotas();
      const tabla = page.getByRole("region", { name: "Tabla de notas" });
      const tr = tabla.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(est.nombre) }) });
      await expect(tr).toHaveCount(1);
      const celda = tr.getByRole("cell").nth(1);
      const vista = { texto: (await celda.innerText()).replace(/\s+/g, " ").trim(), titulo: await celda.getAttribute("title") };
      return vista;
    };

    await test.step(`1. Crear «${CON}» marcando «Tiene alternativa accesible (se puede responder solo con teclado, sin arrastrar)» y «${SIN}» sin marcar (hecho en la precondición) → recargar`, async () => {
      await abrirEvaluaciones();
      await expect(filaEv(CON).getByText(SIN_ALT)).toHaveCount(0);
      await expect(filaEv(SIN).getByText(SIN_ALT)).toBeVisible();
    });
    await test.step("Resultado: al abrir «Editar», cada casilla muestra la marca guardada", async () => {
      for (const [titulo, esperada] of [[CON, true], [SIN, false]]) {
        const { d, casilla } = await abrirEdicion(titulo);
        const marcada = await casilla.isChecked();
        test.info().annotations.push({ type: "casillaAlEditar", description: `${titulo}: ${marcada ? "marcada" : "sin marcar"}` });
        expect.soft(marcada, `«${titulo}» al abrir «Editar» (D-37)`).toBe(esperada);
        await d.getByRole("button", { name: "Cancelar" }).click();
        await expect(d).toBeHidden();
      }
    });
    await test.step(`Precondición (D-37): en «Notas del curso», «${SIN}» sale «Excluida» para el estudiante motor`, async () => {
      const antes = await celdaNotas();
      test.info().annotations.push({ type: "notasAntes", description: JSON.stringify(antes) });
      expect(antes).toEqual({ texto: "Excluida", titulo: "Excluida: sin alternativa accesible (no cuenta)" });
    });
    await test.step(`2. «Editar ${SIN}» → cambiar solo el título a «${SIN_EDITADO}» → «Guardar cambios»`, async () => {
      await abrirEvaluaciones();
      const { d } = await abrirEdicion(SIN);
      await escribir(d.getByLabel("Título"), SIN_EDITADO);
      const resp = page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/evaluaciones\/\d+$/.test(new URL(r.url()).pathname));
      await d.getByRole("button", { name: "Guardar cambios" }).click();
      const r = await resp;
      expect(r.status()).toBeLessThan(400);
      const enviado = r.request().postDataJSON();
      test.info().annotations.push({ type: "putEvaluacion", description: JSON.stringify({ titulo: enviado.titulo, alternativaAccesible: enviado.alternativaAccesible }) });
      await expect(d).toBeHidden();
    });
    await test.step(`Resultado: la marca no cambia: «${SIN_EDITADO}» sigue «${SIN_ALT}»`, async () => {
      await page.reload();
      await ed.pestana("Evaluaciones y tareas").click();
      await expect(filaEv(SIN_EDITADO)).toHaveCount(1);
      const sigue = await filaEv(SIN_EDITADO).getByText(SIN_ALT).count();
      test.info().annotations.push({ type: "insigniaTrasEditar", description: sigue ? SIN_ALT : "sin insignia (pasó a «con alternativa»)" });
      expect.soft(sigue, `«${SIN_EDITADO}» debe seguir «${SIN_ALT}» (D-37)`).toBe(1);
    });
    await test.step(`Resultado: en «Notas del curso» la evaluación sigue «Excluida» para el estudiante motor`, async () => {
      const despues = await celdaNotas();
      test.info().annotations.push({ type: "notasDespues", description: JSON.stringify(despues) });
      expect.soft(despues.texto, "la exclusión del perfil motor (HU-029) se mantiene (D-37)").toBe("Excluida");
    });
    await verificarAuditoria(abrirContexto, { accion: "EVALUACION_ACTUALIZADA", resultado: "Permitido", usuario: ins.correo, recursoContiene: `evaluaciones/${curso.evaluaciones[SIN]}` });
  });
});

// =================================================================== HU-023 · Discapacidad cognitiva (RF-022, RF-046)

const base23 = { hu: "HU-023", rf: "RF-022", prioridad: "P2" };
const UMBRAL_APOYO = U.s(5, "§7.3 apoyo para estudiar < 5 s");
const LECTURA_APOYO = "Lectura con apoyo";
const LECTURA_BREVE = "Lectura breve";
const SIMPLIFICADA = "Las plantas usan la luz del sol para hacer su comida. Al hacerlo, sueltan oxígeno.";
const TEXTO_APOYO = [
  "# Fotosíntesis",
  "La fotosíntesis es el proceso con el que las plantas verdes producen su propio alimento usando la luz del sol. Las hojas contienen clorofila, un pigmento que captura la energía de la luz. Con esa energía, la planta transforma el agua y el dióxido de carbono en glucosa. La glucosa le sirve a la planta como alimento y como reserva de energía. Durante el proceso la planta libera oxígeno al aire, y ese oxígeno es el que respiran los animales. Sin la fotosíntesis no existiría la mayor parte de la vida en el planeta. Por eso las plantas son la base de casi todas las cadenas alimenticias.",
  "## Pasos del proceso",
  "1. La raíz absorbe agua del suelo.",
  "2. Las hojas captan la luz del sol.",
  "3. La clorofila transforma la energía de la luz.",
  "4. La planta libera oxígeno al aire.",
  "Glosario",
  "Clorofila: pigmento verde que capta la luz.",
  "Estoma: poro de la hoja que intercambia gases.",
].join("\n");
const TEXTO_BREVE = "Texto breve de prueba sin estructura.";
const MSG_SIN_RESUMEN = "No pudimos crear un resumen claro; te mostramos el texto original.";
const MSG_SIN_SIMPLIFICADA = "El instructor aún no cargó una versión en lenguaje simplificado. Usa los pasos y el resumen.";

/** D-16: con el perfil cognitivo la app usa el lenguaje sencillo (useTexto); se aceptan las dos variantes. */
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dosTextos = (normal, sencillo) => new RegExp(`^(${escRe(normal)}|${escRe(sencillo)})$`);
const SEC23 = {
  "Versión simplificada": dosTextos("Versión simplificada", "Texto fácil"),
  "Contenido en partes cortas": dosTextos("Contenido en partes cortas", "Texto en partes cortas"),
  "Paso a paso": dosTextos("Paso a paso", "Pasos"),
  "Conceptos clave": dosTextos("Conceptos clave", "Palabras importantes"),
  "Resumen": dosTextos("Resumen", "Idea principal"),
  "Glosario": dosTextos("Glosario", "Palabras y su significado"),
};

/** Lectura creada y publicada en el editor; con `simplificada`, antes se agrega ese recurso. */
async function lecturaConApoyo(page, ed, titulo, texto, simplificada) {
  await ed.pestana("Contenido").click();
  await page.getByRole("button", { name: `Nuevo contenido en ${MODULO_E2E}` }).click();
  const d = page.getByRole("dialog", { name: "Nuevo contenido" });
  await escribir(d.getByLabel("Título del contenido"), titulo);
  await d.getByLabel("Formato").selectOption({ label: "Lectura" });
  await escribirLargo(d.getByLabel("Texto de la lección"), texto);
  await ed.observarPost(/^\/api\/modulos\/\d+\/contenidos$/, () => d.getByRole("button", { name: "Crear contenido" }).click());
  const e = page.getByRole("dialog", { name: "Editar contenido" });
  if (simplificada) await agregarRecurso(page, ed, e, "Versión simplificada", { texto: simplificada });
  const pub = e.getByRole("button", { name: "Publicar contenido" });
  await expect(pub).toBeEnabled();
  await ed.observarPost(/^\/api\/contenidos\/\d+\/publicar$/, () => pub.click());
  await expect(e.getByRole("button", { name: "Despublicar contenido" })).toBeVisible();
  await e.getByRole("button", { name: "Cerrar" }).first().click();
  await expect(e).toBeHidden();
}

/** Instructor desechable con un curso publicado: «Lectura con apoyo» (con versión simplificada) y «Lectura breve». */
let curso23 = null;
async function cursoHu023(abrirContexto) {
  if (curso23) return curso23;
  const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "cogins" });
  curso23 = await test.step("Precondición: el instructor crea y publica el curso de HU-023 por la UI", async () => {
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const c = { titulo: `E2E-Cognitiva-${marca()}`, ins };
    await ed.ir();
    c.id = await ed.crearCurso(c.titulo, "Curso de las pruebas E2E de apoyo cognitivo.");
    await ed.abrirEditor(c.titulo);
    await ed.crearModulo(MODULO_E2E);
    await lecturaConApoyo(page, ed, LECTURA_APOYO, TEXTO_APOYO, SIMPLIFICADA);
    await lecturaConApoyo(page, ed, LECTURA_BREVE, TEXTO_BREVE, null);
    await ed.publicarCurso();
    await cerrarSesion(page);
    await page.context().close();
    return c;
  });
  return curso23;
}

/** El estudiante se inscribe en el curso y abre la lectura. */
async function abrirLecturaHu023(page, c, titulo) {
  await page.getByRole("link", { name: "Mis cursos" }).click();
  await page.getByRole("button", { name: dosTextos(`Inscribirme en ${c.titulo}`, `Anotarme en ${c.titulo}`) }).click();
  await expect(page.getByText(dosTextos(`Te inscribiste en «${c.titulo}».`, `Ya estás en «${c.titulo}».`)).first()).toBeVisible();
  await page.getByRole("link", { name: c.titulo, exact: true }).click();
  await page.getByRole("link", { name: titulo, exact: true }).click();
  await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
}

/** «Formas de estudiar» → «Apoyo para estudiar» (midiendo hasta que se ve `listo`). Devuelve el panel. */
async function abrirApoyo(page, listo) {
  const panel = page.getByRole("tabpanel");
  await medir("abrir «Apoyo para estudiar»", UMBRAL_APOYO,
    () => page.getByRole("tablist", { name: dosTextos("Formas de estudiar", "Cómo estudiar") })
      .getByRole("tab", { name: dosTextos("Apoyo para estudiar", "Ayuda para estudiar") }).click(),
    () => expect(listo(panel)).toBeVisible());
  return panel;
}

const seccion = (panel, nombre) => panel.getByRole("region", { name: SEC23[nombre] });

test.describe("HU-023 · Discapacidad cognitiva (RF-022, RF-046)", () => {
  // ------------------------------------------------------------------ CP-HU023-01
  test("CP-HU023-01 — Versión simplificada, partes cortas, pasos, conceptos y glosario @P2 @HU-023 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base23, caso: "CP-HU023-01", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3",
      ajuste: "D-16: con el perfil cognitivo la UI usa el lenguaje sencillo («Ayuda para estudiar», «Texto fácil», «Pasos»…); se aceptan las dos variantes. Las «pestañas» del plan son secciones dentro de «Apoyo para estudiar»" });
    const c = await cursoHu023(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "cogest", categorias: ["Cognitiva"] });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await test.step(`Precondición: estudiante con perfil cognitivo abre «${LECTURA_APOYO}» (lista numerada y glosario)`, () =>
      abrirLecturaHu023(page, c, LECTURA_APOYO));
    const panel = await test.step("1. Lección → «Apoyo para estudiar»", () =>
      abrirApoyo(page, (p) => seccion(p, "Versión simplificada")));
    await test.step("Resultado: «Versión simplificada» muestra el texto del instructor", async () => {
      await expect(seccion(panel, "Versión simplificada")).toContainText(SIMPLIFICADA);
    });
    await test.step("Resultado: «Contenido en partes cortas» divide el texto en unidades con título", async () => {
      const s = seccion(panel, "Contenido en partes cortas");
      const unidades = await s.getByRole("heading", { level: 4 }).allInnerTexts();
      test.info().annotations.push({ type: "unidades", description: JSON.stringify(unidades) });
      expect(unidades.length).toBeGreaterThanOrEqual(2);
      expect(unidades[0]).toMatch(/^1\. Fotosíntesis/);
    });
    await test.step("Resultado: «Paso a paso» toma la lista numerada", async () => {
      const pasos = (await seccion(panel, "Paso a paso").getByRole("listitem").allInnerTexts()).map((t) => t.trim());
      test.info().annotations.push({ type: "pasos", description: JSON.stringify(pasos) });
      expect(pasos).toEqual(["La raíz absorbe agua del suelo.", "Las hojas captan la luz del sol.",
        "La clorofila transforma la energía de la luz.", "La planta libera oxígeno al aire."]);
    });
    await test.step("Resultado: «Conceptos clave», «Resumen» y «Glosario»", async () => {
      const conceptos = (await seccion(panel, "Conceptos clave").getByRole("listitem").allInnerTexts()).map((t) => t.trim());
      test.info().annotations.push({ type: "conceptosClave", description: JSON.stringify(conceptos) });
      expect(conceptos.length).toBeGreaterThan(0);
      const resumen = (await seccion(panel, "Resumen").innerText()).trim();
      test.info().annotations.push({ type: "resumen", description: resumen });
      await expect(panel.getByText(MSG_SIN_RESUMEN)).toHaveCount(0);
      const glosario = seccion(panel, "Glosario");
      await expect(glosario.getByText("Clorofila", { exact: true })).toBeVisible();
      await expect(glosario.getByText("pigmento verde que capta la luz.")).toBeVisible();
      await expect(glosario.getByText("Estoma", { exact: true })).toBeVisible();
    });
  });

  // ------------------------------------------------------------------ CP-HU023-02
  test("CP-HU023-02 — Conservar el original si el resumen no es confiable @P2 @HU-023 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base23, caso: "CP-HU023-02", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "Con ajuste", referenciaPlan: "§7.3",
      ajuste: "Condición de TextoApoyo.resumir: con menos de 4 oraciones o menos de 60 palabras (o si el resumen no baja del 70 %) se conserva el original y se avisa; sin recurso «Versión simplificada» se muestra otro aviso en vez de esa sección" });
    const c = await cursoHu023(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "cogbreve", categorias: ["Cognitiva"] });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await test.step(`Precondición: estudiante con perfil cognitivo abre «${LECTURA_BREVE}» (una oración, sin estructura)`, () =>
      abrirLecturaHu023(page, c, LECTURA_BREVE));
    const panel = await test.step("1. Abrir «Apoyo para estudiar» (versión simplificada)", () =>
      abrirApoyo(page, (p) => p.getByText(MSG_SIN_RESUMEN)));
    await test.step(`Resultado: aviso «${MSG_SIN_RESUMEN}» y el resumen es el texto original`, async () => {
      await expect(panel.getByText(MSG_SIN_RESUMEN)).toBeVisible();
      await expect(seccion(panel, "Resumen")).toContainText(TEXTO_BREVE);
    });
    await test.step(`Resultado: sin versión simplificada del instructor, aviso «${MSG_SIN_SIMPLIFICADA}»`, async () => {
      await expect(panel.getByText(MSG_SIN_SIMPLIFICADA)).toBeVisible();
      await expect(seccion(panel, "Versión simplificada")).toHaveCount(0);
    });
  });

  // ------------------------------------------------------------------ CP-HU023-03
  test("CP-HU023-03 — Modo lectura sin distracciones (RF-046) @P3 @HU-023 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base23, rf: "RF-046", prioridad: "P3", caso: "CP-HU023-03", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "RF-046 (adicional)" });
    const c = await cursoHu023(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "coglect" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await test.step(`Precondición: el estudiante (sin perfil cognitivo) abre «${LECTURA_APOYO}»`, () => abrirLecturaHu023(page, c, LECTURA_APOYO));
    const menu = page.getByRole("link", { name: "Mis cursos" });
    const puntos = page.getByRole("link", { name: /puntos/i });
    const avisos = page.getByRole("button", { name: /^Notificaciones/ });
    const salir = page.getByRole("button", { name: "Salir del modo lectura" });
    await test.step("Precondición: se ven el menú, los puntos y los avisos", async () => {
      await expect(menu.first()).toBeVisible();
      await expect(puntos.first()).toBeVisible();
      await expect(avisos.first()).toBeVisible();
    });
    await test.step("1. «Modo lectura»: se ocultan el menú, los puntos y los avisos; aparece «Salir del modo lectura»", async () => {
      await page.getByRole("button", { name: "Modo lectura" }).click();
      await expect(salir).toBeVisible();
      await expect(page.getByText("(Esc para salir)")).toBeVisible();
      await expect(menu).toHaveCount(0);
      await expect(puntos).toHaveCount(0);
      await expect(avisos).toHaveCount(0);
      await expect(page.getByRole("heading", { name: LECTURA_APOYO })).toBeVisible();
    });
    await test.step("2. Esc: sale del modo lectura", async () => {
      await page.keyboard.press("Escape");
      await expect(salir).toHaveCount(0);
      await expect(menu.first()).toBeVisible();
      await expect(puntos.first()).toBeVisible();
      await expect(avisos.first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Modo lectura" })).toBeVisible();
    });
  });
  // ------------------------------------------------------------------ CP-HU023-04 (D-38)
  test("CP-HU023-04 — Conceptos clave conservan la ortografía original (tildes y ñ) @P3 @HU-023 @a11y", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base23, prioridad: "P3", caso: "CP-HU023-04", tecnica: "funcional", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.3 (agregado por el usuario el 12/11/2026, D-38)", defecto: "D-38",
      ajuste: "D-16: con el perfil cognitivo la UI usa el lenguaje sencillo; se aceptan las dos variantes" });
    const c = await cursoHu023(abrirContexto);
    const TITULO = "Lectura con tildes";
    const TEXTO = [
      "# Ecosistemas de montaña",
      "La montaña tiene ecosistemas muy variados según la altura. En la montaña el clima cambia rápido y la energía del sol llega con más fuerza. Los árboles pequeños crecen en las laderas de la montaña porque el viento es fuerte. El páramo es un ecosistema de montaña que guarda agua para las ciudades. Muchos animales pequeños viven en el páramo y dependen de esa agua. La energía que reciben las plantas del páramo sostiene a todo el ecosistema. Por eso cuidar la montaña y el páramo es una tarea de todos.",
      "Glosario",
      "Páramo: ecosistema de alta montaña que guarda agua.",
      "Raíz: órgano de la planta que absorbe agua.",
    ].join("\n");
    await test.step(`Precondición: el instructor publica «${TITULO}» (palabras frecuentes con tilde y ñ: montaña, páramo, energía)`, async () => {
      const { page, ed } = await editorHu020(abrirContexto, c);
      await lecturaConApoyo(page, ed, TITULO, TEXTO, null);
      await cerrarSesion(page);
      await page.context().close();
    });
    const est = await cuentaLista(abrirContexto, { etiqueta: "cogtilde", categorias: ["Cognitiva"] });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await test.step(`Precondición: estudiante con perfil cognitivo abre «${TITULO}»`, () => abrirLecturaHu023(page, c, TITULO));
    const panel = await test.step("1. Lección → «Apoyo para estudiar»", () => abrirApoyo(page, (p) => seccion(p, "Conceptos clave")));
    const original = TEXTO.toLocaleLowerCase("es-CO");
    await test.step("Resultado: cada concepto clave aparece tal como está escrito en el contenido (con tildes y ñ)", async () => {
      const conceptos = (await seccion(panel, "Conceptos clave").getByRole("listitem").allInnerTexts()).map((t) => t.trim());
      test.info().annotations.push({ type: "conceptosClave", description: JSON.stringify(conceptos) });
      expect(conceptos.length).toBeGreaterThan(0);
      const ajenos = conceptos.filter((w) => !new RegExp(`(^|[^\\p{L}])${w.toLocaleLowerCase("es-CO")}([^\\p{L}]|$)`, "u").test(original));
      test.info().annotations.push({ type: "conceptosQueNoEstanEnElTexto", description: JSON.stringify(ajenos) });
      expect.soft(ajenos, "conceptos clave que no aparecen así en el contenido (D-38)").toEqual([]);
    });
    await test.step("Control: el glosario y el resumen conservan las tildes (si fallan, se enlazan a D-38)", async () => {
      const glosario = seccion(panel, "Glosario");
      await expect.soft(glosario.getByText("Páramo", { exact: true }), "glosario con tilde (D-38)").toBeVisible();
      await expect.soft(glosario.getByText("Raíz", { exact: true }), "glosario con tilde (D-38)").toBeVisible();
      const resumen = (await seccion(panel, "Resumen").innerText()).trim();
      test.info().annotations.push({ type: "resumen", description: resumen });
      expect.soft(resumen, "el resumen usa las oraciones originales (D-38)").toMatch(/montaña|páramo|energía/);
    });
  });
});
