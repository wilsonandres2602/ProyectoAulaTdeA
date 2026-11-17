import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { cfg } from "../support/config.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cerrarSesion, cuentaLista, entrarComoAdmin } from "../support/sesiones.js";
import { sesion } from "../support/cursos.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import { pedir, tokenDeSesion } from "../support/api.js";
import { escribir } from "../support/humano.js";
import { marca } from "../support/datos.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";
import { EstudianteCursoPage } from "../pages/EstudianteCursoPage.js";

const base = { hu: "HU-011", rf: "RF-009" };
const UMBRAL_LOGROS = U.s(2, "§7.3 logros < 2 s");
const MODULO = "Módulo E2E";
const LECTURAS = [1, 2, 3, 4, 5].map((n) => `Lectura ${n}`);
const QUIZ = "Quiz puntos";
const Q = { A: "Gamificación: pregunta de 50", B: "Gamificación: pregunta de 30", C: "Gamificación: pregunta de 10 (a)", D: "Gamificación: pregunta de 10 (b)" };
const RUTA_REGLAS = /^\/api\/admin\/gamificacion\/reglas\/\d+$/;

const menu = (page, nombre) => page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: nombre, exact: true });

/**
 * Curso compartido por los casos de este archivo, armado por la UI la primera vez que se pide:
 * instructor desechable; «Módulo E2E» con 5 lecturas publicadas (así completar 4 no finaliza el
 * curso, que daría puntos de CURSO_FINALIZADO) y «Quiz puntos» con preguntas V/F de 50, 30, 10 y 10.
 * Cada estudiante se inscribe solo desde «Mis cursos».
 */
let compartido = null;
async function cursoBase(abrirContexto) {
  if (compartido) return compartido;
  const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "gamins" });
  compartido = await test.step("Precondición: el instructor arma el curso de gamificación por la UI", async () => {
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const c = { titulo: `E2E-Gamif-${marca()}`, ins };
    await ed.ir();
    c.id = await ed.crearCurso(c.titulo, "Curso de las pruebas E2E de gamificación.");
    await ed.abrirEditor(c.titulo);
    await ed.crearModulo(MODULO);
    for (const l of LECTURAS) await ed.crearLecturaPublicada(MODULO, l, `${l} de las pruebas E2E de gamificación.`);
    await ed.crearEvaluacion(MODULO, QUIZ, { puntajeMaximo: 100, preguntas: [
      { enunciado: Q.A, puntaje: 50 }, { enunciado: Q.B, puntaje: 30 }, { enunciado: Q.C, puntaje: 10 }, { enunciado: Q.D, puntaje: 10 }] });
    await ed.publicarCurso();
    await cerrarSesion(page);
    await page.context().close();
    return c;
  });
  return compartido;
}

/** Estudiante desechable con sesión abierta e inscrito solo en el curso compartido. */
async function estudianteInscrito(abrirContexto, curso, etiqueta) {
  const est = await cuentaLista(abrirContexto, { etiqueta });
  const page = await sesion(abrirContexto, est);
  await test.step(`Precondición: inscribirse en «${curso.titulo}»`, async () => {
    await page.getByRole("link", { name: "Mis cursos" }).click();
    await page.getByRole("button", { name: `Inscribirme en ${curso.titulo}` }).click();
    await expect(page.getByText(`Te inscribiste en «${curso.titulo}».`).first()).toBeVisible();
  });
  return { est, page, ep: new EstudianteCursoPage(page) };
}

/** Abre /logros desde el menú (midiendo) y devuelve { puntos, nivel }. */
async function verLogros(page, nombre = "Abrir Logros") {
  if (/\/logros$/.test(page.url())) await page.getByRole("link", { name: "Mis cursos" }).click();
  const resumen = page.getByText(/^\d+ puntos · /);
  await medir(nombre, UMBRAL_LOGROS, () => menu(page, "Logros").click(), () => expect(resumen).toBeVisible());
  await expect(page).toHaveURL(/\/logros$/);
  const puntos = Number((await resumen.innerText()).match(/^(\d+) puntos/)[1]);
  const nivel = Number((await page.getByText("Nivel", { exact: true }).locator("..").locator("p.text-4xl").innerText()).trim());
  return { puntos, nivel };
}

// ------------------------------------------------------------------ administrador: reglas

/** /gamificacion del admin en la pestaña dada; devuelve el JSON del GET de esa pestaña. */
async function abrirGamificacion(page, pestana = "Reglas de puntos") {
  const ruta = pestana === "Reglas de puntos" ? "/api/admin/gamificacion/reglas" : "/api/admin/gamificacion/insignias";
  const resp = page.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === ruta);
  await menu(page, "Gamificación").click();
  await expect(page.getByRole("heading", { name: "Gamificación", level: 1 })).toBeVisible();
  if (pestana !== "Reglas de puntos") await page.getByRole("tab", { name: pestana }).click();
  const r = await resp;
  expect(r.status()).toBe(200);
  return r.json();
}

/** Texto de cada tarjeta de regla, en el orden de la pantalla. */
async function fotoReglas(page) {
  const items = page.getByRole("tabpanel").getByRole("listitem");
  await expect(items.first()).toBeVisible();
  return (await items.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
}

/** La tarjeta de la primera regla de «Completar un contenido» (la que usa el backend: menor id). */
const reglaContenido = (page) => page.getByRole("tabpanel").getByRole("listitem").filter({ hasText: "Completar un contenido →" }).first();

/** «Editar <regla>» → «Puntos» = n → «Guardar regla» → «Regla actualizada.» */
async function cambiarPuntos(page, n) {
  const tarjeta = reglaContenido(page);
  await tarjeta.getByRole("button", { name: /^Editar / }).click();
  const d = page.getByRole("dialog", { name: "Editar regla" });
  await escribir(d.getByLabel("Puntos", { exact: true }), String(n));
  const resp = page.waitForResponse((r) => r.request().method() === "PUT" && RUTA_REGLAS.test(new URL(r.url()).pathname));
  await d.getByRole("button", { name: "Guardar regla" }).click();
  expect((await resp).status()).toBe(200);
  await expect(d).toBeHidden();
  await expect(reglaContenido(page)).toContainText(`→ ${n} puntos`);
}

test.describe("HU-011 · Gamificación (RF-009, RF-047)", () => {
  // ------------------------------------------------------------------ CP-HU011-01
  test("CP-HU011-01 — 50 puntos por contenido solo la primera vez @P2 @HU-011", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU011-01", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "TC-GAM-01; §7.3",
      ajuste: "Un contenido completado ya no muestra «Marcar como completado»: «volver a completarlo» es volver a abrirlo y quedarse unos segundos (la lección envía su avance), y se comprueba que los puntos no cambian" });
    const curso = await cursoBase(abrirContexto);
    const { est, page, ep } = await estudianteInscrito(abrirContexto, curso, "gamcont");
    usuarioProbado(est.correo);
    const p0 = await test.step("Precondición: puntos conocidos en /logros", () => verLogros(page));
    await test.step(`1. Completar «${LECTURAS[0]}» → /logros: +50`, async () => {
      await ep.completarLectura(curso.titulo, LECTURAS[0]);
      const p1 = await verLogros(page);
      test.info().annotations.push({ type: "puntos", description: `${p0.puntos} → ${p1.puntos}` });
      expect(p1.puntos).toBe(p0.puntos + 50);
    });
    await test.step(`2. Volver a abrir «${LECTURAS[0]}» (ya completado) → /logros: sin cambio`, async () => {
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await page.getByRole("link", { name: curso.titulo, exact: true }).click();
      await page.getByRole("link", { name: LECTURAS[0], exact: true }).click();
      await expect(page).toHaveURL(/\/contenidos\/\d+$/);
      await expect(page.getByRole("heading", { name: LECTURAS[0] })).toBeVisible();
      await expect(page.getByRole("button", { name: "Marcar como completado" })).toHaveCount(0);
      await page.waitForTimeout(3_000);
      const p2 = await verLogros(page);
      expect(p2.puntos).toBe(p0.puntos + 50);
    });
  });

  // ------------------------------------------------------------------ CP-HU011-02
  test("CP-HU011-02 — Evaluación: hasta 100 puntos, solo suma la mejora @P2 @HU-011", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU011-02", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "TC-GAM-01; §7.3",
      ajuste: "«Quiz puntos» con preguntas de 50, 30, 10 y 10: 50 % = solo la de 50; 80 % = 50 + 30; 60 % = 50 + 10" });
    const curso = await cursoBase(abrirContexto);
    const { est, page, ep } = await estudianteInscrito(abrirContexto, curso, "gameval");
    usuarioProbado(est.correo);
    await test.step(`Precondición: completar «${LECTURAS[0]}» (habilita la evaluación)`, () => ep.completarLectura(curso.titulo, LECTURAS[0]));
    let antes = await test.step("Precondición: puntos en /logros", () => verLogros(page));
    for (const [pct, aciertos, suma] of [[50, [Q.A], 50], [80, [Q.A, Q.B], 30], [60, [Q.A, Q.C], 0]]) {
      await test.step(`Intento al ${pct} % → /logros: +${suma}`, async () => {
        await ep.presentarConAciertos(QUIZ, aciertos);
        await expect(page.getByText(new RegExp(`^${pct}(\\.0+)? de 100 puntos$`))).toBeVisible();
        const despues = await verLogros(page);
        test.info().annotations.push({ type: `puntos${pct}`, description: `${antes.puntos} → ${despues.puntos}` });
        expect(despues.puntos - antes.puntos).toBe(suma);
        antes = despues;
      });
    }
  });

  // ------------------------------------------------------------------ CP-HU011-03
  test("CP-HU011-03 — Nivel cada 500 puntos (499 / 500 / 999 / 1000) @P3 @HU-011", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU011-03", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "Con ajuste",
      referenciaPlan: "§7.12.2",
      ajuste: "Aprobado (decisión 5): el admin cambia por la UI los «Puntos» de la regla «Completar un contenido» antes de cada lectura para llegar a 499, 500, 999 y 1000; el valor original se restaura en finally y se comprueba que todas las reglas quedaron como estaban (si no, anotación ambienteAlterado)" });
    const curso = await cursoBase(abrirContexto);
    const { est, page, ep } = await estudianteInscrito(abrirContexto, curso, "gamnivel");
    usuarioProbado(est.correo);
    const p0 = await test.step("Precondición: puntos iniciales del estudiante", () => verLogros(page));
    expect(p0.puntos, "el estudiante empieza por debajo de 499").toBeLessThan(499);

    const actx = await abrirContexto();
    const admin = await actx.newPage();
    await entrarComoAdmin(admin);
    const { foto, original } = await test.step("Precondición: el admin abre /gamificacion y anota las reglas", async () => {
      await abrirGamificacion(admin);
      const f = await fotoReglas(admin);
      test.info().annotations.push({ type: "reglasAntes", description: JSON.stringify(f) });
      const t = (await reglaContenido(admin).innerText()).replace(/\s+/g, " ");
      expect(t, "la regla de contenido debe estar activa").toMatch(/Activa/i);
      return { foto: f, original: Number(t.match(/→ (\d+) puntos/)[1]) };
    });
    let cambiada = false;
    try {
      const metas = [[499, 1], [500, 2], [999, 2], [1000, 3]];
      let actual = p0.puntos;
      for (const [i, [meta, nivel]] of metas.entries()) {
        const delta = meta - actual;
        await test.step(`${i + 1}. Admin: «Puntos» = ${delta} → el estudiante completa «${LECTURAS[i]}» → ${meta} puntos, «Nivel» ${nivel}`, async () => {
          await cambiarPuntos(admin, delta);
          cambiada = true;
          await ep.completarLectura(curso.titulo, LECTURAS[i]);
          const l = await verLogros(page, `Abrir Logros (${meta})`);
          test.info().annotations.push({ type: `nivel${meta}`, description: `${l.puntos} puntos, nivel ${l.nivel}` });
          expect(l.puntos).toBe(meta);
          expect(l.nivel).toBe(nivel);
          actual = l.puntos;
        });
      }
    } finally {
      await test.step(`Teardown: restaurar «Puntos» = ${original} y comprobar que las reglas quedaron como estaban`, async () => {
        if (cambiada) await cambiarPuntos(admin, original);
        await admin.reload();
        await expect(admin.getByRole("heading", { name: "Gamificación", level: 1 })).toBeVisible();
        const despues = await fotoReglas(admin);
        const igual = JSON.stringify(despues) === JSON.stringify(foto);
        if (!igual) {
          test.info().annotations.push({ type: "ambienteAlterado", description: JSON.stringify({ antes: foto, despues }) });
        }
        expect.soft(igual, "las reglas de gamificación quedaron como estaban").toBeTruthy();
      });
      await actx.close();
    }
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP PUT (200)", resultado: "Permitido", usuario: cfg.adminCorreo, recursoContiene: "/api/admin/gamificacion/reglas/", minimo: 5,
    });
  });

  // ------------------------------------------------------------------ CP-HU011-04
  test("CP-HU011-04 — Insignias por umbral @P3 @HU-011", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU011-04", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const nombre = `E2E-${marca()}`;
    const actx = await abrirContexto();
    const admin = await actx.newPage();
    await entrarComoAdmin(admin);
    await test.step(`1. Admin: «Nueva insignia» «${nombre}» con «Puntos requeridos» = 30`, async () => {
      await abrirGamificacion(admin, "Insignias");
      await admin.getByRole("button", { name: "Nueva insignia" }).click();
      const d = admin.getByRole("dialog", { name: "Nueva insignia" });
      await escribir(d.getByLabel("Nombre", { exact: true }), nombre);
      await escribir(d.getByLabel("Puntos requeridos"), "30");
      const resp = admin.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/admin/gamificacion/insignias");
      await d.getByRole("button", { name: "Guardar insignia" }).click();
      expect((await resp).status()).toBe(201);
      await expect(d).toBeHidden();
      await expect(admin.getByRole("tabpanel").getByRole("listitem").filter({ hasText: nombre })).toHaveCount(1);
    });
    const est = await cuentaLista(abrirContexto, { etiqueta: "gamins" });
    usuarioProbado(est.correo);
    await test.step("2. Un estudiante nuevo completa el VARK (30 puntos) → /logros", async () => {
      const page = await sesion(abrirContexto, est);
      await verLogros(page);
      const obtenidas = page.getByRole("region", { name: "Insignias obtenidas" });
      const tarjeta = obtenidas.getByRole("listitem").filter({ hasText: nombre });
      await expect(tarjeta).toBeVisible();
      await expect(tarjeta.getByText(/^Obtenida el .+/)).toBeVisible();
      test.info().annotations.push({ type: "insignia", description: (await tarjeta.innerText()).replace(/\s+/g, " ") });
      await page.context().close();
    });
    await test.step("3. Admin: repetir el nombre → «Ya existe una insignia con ese nombre.»", async () => {
      await admin.getByRole("button", { name: "Nueva insignia" }).click();
      const d = admin.getByRole("dialog", { name: "Nueva insignia" });
      await escribir(d.getByLabel("Nombre", { exact: true }), nombre);
      await escribir(d.getByLabel("Puntos requeridos"), "30");
      const resp = admin.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/admin/gamificacion/insignias");
      await d.getByRole("button", { name: "Guardar insignia" }).click();
      expect((await resp).status()).toBe(409);
      await expect(d.getByText("Ya existe una insignia con ese nombre.")).toBeVisible();
      await d.getByRole("button", { name: "Cancelar" }).click();
    });
    await actx.close();
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP POST (201)", resultado: "Permitido", usuario: cfg.adminCorreo, recurso: "/api/admin/gamificacion/insignias",
    });
  });

  // ------------------------------------------------------------------ CP-HU011-05
  test("CP-HU011-05 — Modo privado en la clasificación @P3 @HU-011", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU011-05", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3",
      defecto: "D-31" });
    // D-31 (defecto confirmado por el usuario): cambiarPrivacidad no recalcula la clasificación guardada (RankingService la reutiliza hasta 10 min),
    // así que B sigue viendo a A justo después de que A activa el modo privado.
    const curso = await cursoBase(abrirContexto);
    const a = await estudianteInscrito(abrirContexto, curso, "gampriva");
    await test.step(`Precondición: A completa «${LECTURAS[0]}»`, () => a.ep.completarLectura(curso.titulo, LECTURAS[0]));
    const b = await estudianteInscrito(abrirContexto, curso, "gamprivb");
    usuarioProbado(a.est.correo);
    await test.step(`Precondición: B completa «${LECTURAS[0]}»`, () => b.ep.completarLectura(curso.titulo, LECTURAS[0]));

    /** B: /logros → «Clasificación del curso» → «Curso» = el curso compartido; devuelve los nombres. */
    const nombresQueVeB = async () => {
      await verLogros(b.page);
      await b.page.getByRole("combobox", { name: "Curso" }).selectOption({ label: curso.titulo });
      const tabla = b.page.getByRole("table", { name: /^Clasificación por puntos|^Tabla de posiciones por puntos/ });
      await expect(tabla).toBeVisible();
      const filas = (await tabla.locator("tbody tr").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
      return filas;
    };
    await test.step("Precondición: B ve a A en la clasificación", async () => {
      const filas = await nombresQueVeB();
      test.info().annotations.push({ type: "clasificacionAntes", description: JSON.stringify(filas) });
      expect(filas.some((f) => f.includes(a.est.nombre))).toBeTruthy();
    });
    await test.step("1. A: /logros → desactivar «Aparecer en la clasificación» → «Ya no apareces en la clasificación.»", async () => {
      await verLogros(a.page);
      const sw = a.page.getByRole("switch", { name: "Aparecer en la clasificación" });
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await sw.click();
      await expect(a.page.getByText("Ya no apareces en la clasificación.").first()).toBeVisible();
      await expect(sw).toHaveAttribute("aria-checked", "false");
    });
    await test.step("2. B ve «Clasificación del curso»: no aparece el nombre de A", async () => {
      const filas = await nombresQueVeB();
      test.info().annotations.push({ type: "clasificacionDespues", description: JSON.stringify(filas) });
      expect(filas.some((f) => f.includes(b.est.nombre)), "B se ve a sí mismo").toBeTruthy();
      expect(filas.some((f) => f.includes(a.est.nombre)), "B no ve a A").toBeFalsy();
    });
  });

  // ------------------------------------------------------------------ CP-HU011-06 (API)
  test("CP-HU011-06 — Reglas editables solo por el administrador @P3 @HU-011 @api", async ({ abrirContexto }) => {
    test.setTimeout(8 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU011-06", tecnica: "seguridad", clasificacion: "Ruta Alterna", clase: "E2E-API", referenciaPlan: "§7.3" });
    const regla = await test.step("Precondición: id de la regla de contenido, observado en el GET del admin", async () => {
      const ctx = await abrirContexto();
      const admin = await ctx.newPage();
      await entrarComoAdmin(admin);
      const lista = await abrirGamificacion(admin);
      await ctx.close();
      const r = lista.find((x) => x.evento === "CONTENIDO_COMPLETADO");
      expect(r, "regla de CONTENIDO_COMPLETADO").toBeTruthy();
      return r;
    });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "gamapi" });
    usuarioProbado(ins.correo);
    const page = await sesion(abrirContexto, ins);
    await test.step("1. UI: /gamificacion redirige a /inicio", async () => {
      await expect(menu(page, "Gamificación")).toHaveCount(0);
      await page.goto("/gamificacion");
      await expect(page).toHaveURL(/\/inicio$/);
      await expect(page.getByRole("heading", { name: "Gamificación", level: 1 })).toHaveCount(0);
    });
    protegerCuenta(ins.correo, "DENEGACION", 1);
    await test.step(`2. API: PUT /api/admin/gamificacion/reglas/${regla.id} con los mismos valores → 403`, async () => {
      const r = await pedir(page, "PUT", `/api/admin/gamificacion/reglas/${regla.id}`, { token: await tokenDeSesion(page),
        datos: { nombre: regla.nombre, descripcion: regla.descripcion, evento: regla.evento, puntos: regla.puntos, activo: regla.activo } });
      registrarEvento(ins.correo, "DENEGACION");
      test.info().annotations.push({ type: "respuesta", description: `${r.status} ${JSON.stringify(r.cuerpo)}` });
      expect(r.status).toBe(403);
    });
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP PUT (403)", resultado: "Denegado", usuario: ins.correo, recurso: `/api/admin/gamificacion/reglas/${regla.id}`,
    });
  });

  // ------------------------------------------------------------------ CP-HU011-07
  test("CP-HU011-07 — Pausar la gamificación (RF-047) @P3 @HU-011", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, rf: "RF-047", prioridad: "P3", caso: "CP-HU011-07", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "RF-047 (adicional)" });
    const curso = await cursoBase(abrirContexto);
    const { est, page, ep } = await estudianteInscrito(abrirContexto, curso, "gampausa");
    usuarioProbado(est.correo);
    const p0 = await test.step("1. /logros → «Pausar la gamificación» → «Gamificación en pausa.»", async () => {
      const l = await verLogros(page);
      const sw = page.getByRole("switch", { name: "Pausar la gamificación" });
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await sw.click();
      await expect(page.getByText("Gamificación en pausa.").first()).toBeVisible();
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await expect(page.getByText(/^La gamificación está en pausa/)).toBeVisible();
      return l;
    });
    await test.step(`2. Completar «${LECTURAS[0]}»`, () => ep.completarLectura(curso.titulo, LECTURAS[0]));
    await test.step("Resultado: no hay aviso de puntos («Ganaste 50 puntos») en las notificaciones", async () => {
      await page.reload();
      const campana = page.getByRole("button", { name: /^Notificaciones/ });
      await campana.click();
      const centro = page.getByRole("region", { name: "Centro de notificaciones" });
      await expect(centro).toBeVisible();
      await expect(centro.getByRole("heading", { name: "Notificaciones" })).toBeVisible();
      test.info().annotations.push({ type: "notificaciones", description: (await centro.innerText()).replace(/\s+/g, " ").slice(0, 500) });
      await expect(centro.getByText(/Ganaste 50 puntos/)).toHaveCount(0);
      await campana.click();
    });
    await test.step("Resultado: el total sube 50 puntos", async () => {
      // RF-047: en pausa la barra superior no muestra los puntos (TopBar.jsx); el total se lee en /logros.
      await expect(page.getByRole("link", { name: /puntos\. Ver mis logros$/ })).toHaveCount(0);
      const l = await verLogros(page);
      expect(l.puntos).toBe(p0.puntos + 50);
    });
  });
});
