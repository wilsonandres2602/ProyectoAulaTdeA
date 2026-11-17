import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cuentaLista, cerrarSesion, entrarComoAdmin } from "../support/sesiones.js";
import { sesion, armarCurso } from "../support/cursos.js";
import { escribirLargo } from "../support/humano.js";
import { marca } from "../support/datos.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import { pedir, tokenDeSesion } from "../support/api.js";
import { leerDatos } from "../support/datosCompartidos.js";

const base = { hu: "HU-026", rf: "RF-026" };

test.describe("HU-026 · Inscribir estudiantes (RF-026)", () => {
  // ------------------------------------------------------------------ CP-HU026-06 (API)
  test("CP-HU026-06 — El instructor solo inscribe en sus cursos @P1 @HU-026 @api", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P1", caso: "CP-HU026-06", tecnica: "seguridad", clasificacion: "Ruta Alterna",
      clase: "E2E-API", referenciaPlan: "§7.3" });
    const d = leerDatos();
    const ruta = `/api/instructor/cursos/${d.cursoA.id}/inscripciones`;
    const insB = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "insinsb" });
    usuarioProbado(insB.correo);
    protegerCuenta(insB.correo, "DENEGACION", 1);
    const page = await sesion(abrirContexto, insB);

    await test.step("Precondición (UI): el curso de A no está en «Mis cursos» del instructor B", async () => {
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await expect(page.getByRole("heading", { name: "Mis cursos", level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: d.cursoA.titulo })).toHaveCount(0);
    });
    await test.step(`1. API: POST ${ruta} con un correo de estudiante → 403 «Este curso pertenece a otro instructor.»`, async () => {
      const r = await pedir(page, "POST", ruta, { token: await tokenDeSesion(page), datos: { correos: [d.estudianteA.correo] } });
      registrarEvento(insB.correo, "DENEGACION");
      expect(r.status).toBe(403);
      expect(r.cuerpo?.codigo).toBe("CURSO_AJENO");
      expect(r.cuerpo?.mensaje).toBe("Este curso pertenece a otro instructor.");
    });
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP POST (403)", resultado: "Denegado", usuario: insB.correo, recurso: ruta,
    });
  });
});

// =================================================================== CP-HU026-01…05 (P2/P3, sin setup)

const UMBRAL_INSCRIBIR = U.s(5, "§7.3 inscripción < 5 s");
const UMBRAL_AUTO = U.s(2, "§7.3 autoinscripción < 2 s");
const MSG_MAX = "Puedes inscribir máximo 200 correos por vez. Divide la lista y envíala en partes.";
const NO_ENCONTRADOS = "No encontramos estos correos como estudiantes; revisa que estén bien escritos y que la persona tenga cuenta";

/** Instructor desechable compartido por los casos del worker. */
let ins26 = null;
async function instructor26(abrirContexto) {
  if (!ins26) ins26 = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "insins" });
  return ins26;
}

/** El instructor abre la pestaña «Estudiantes» del curso. */
async function pestanaEstudiantes(abrirContexto, ins, curso) {
  const page = await sesion(abrirContexto, ins);
  const ed = new CursosInstructorPage(page);
  await ed.ir();
  await ed.abrirEditor(curso.titulo);
  await ed.pestana("Estudiantes").click();
  return page;
}

/** Pega los correos y pulsa «Inscribir estudiantes» midiendo hasta el resultado. Devuelve el bloque de resultado. */
async function inscribirPorUI(page, correos, metrica) {
  await escribirLargo(page.getByLabel("Correos de los estudiantes"), correos.join("\n"));
  await expect(page.getByText(`${correos.length} correo(s) detectado(s).`)).toBeVisible();
  const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/instructor\/cursos\/\d+\/inscripciones$/.test(new URL(r.url()).pathname));
  const resultado = page.getByRole("status").filter({ hasText: /Inscritos ahora|Ya estaban inscritos|No encontramos/ });
  await medir(metrica, UMBRAL_INSCRIBIR, () => page.getByRole("button", { name: "Inscribir estudiantes" }).click(), () => expect(resultado).toBeVisible());
  expect((await resp).status()).toBeLessThan(400);
  return resultado;
}

/** Banner del resultado cuyo título empieza por `titulo` (cada grupo es un hijo directo del bloque de resultado). */
const grupo = (resultado, titulo) => resultado.locator(":scope > *").filter({ hasText: titulo });

/** El estudiante abre «Notificaciones» y devuelve el panel. */
async function abrirNotificaciones(page) {
  await page.getByRole("button", { name: /^Notificaciones/ }).first().click();
  const p = page.getByRole("dialog", { name: "Centro de notificaciones" }).or(page.getByRole("region", { name: "Centro de notificaciones" })).or(page.locator('[aria-label="Centro de notificaciones"]'));
  await expect(p.first()).toBeVisible();
  return p.first();
}

test.describe("HU-026 · Inscribir estudiantes, P2/P3 (RF-026)", () => {
  // ------------------------------------------------------------------ CP-HU026-01
  test("CP-HU026-01 — Inscribir un correo @P2 @HU-026", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU026-01", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const ins = await instructor26(abrirContexto);
    usuarioProbado(ins.correo);
    const est = await cuentaLista(abrirContexto, { etiqueta: "insuno" });
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Inscribir" });
    const page = await pestanaEstudiantes(abrirContexto, ins, curso);
    const resultado = await test.step(`1. «Correos de los estudiantes» = ${est.correo} → «Inscribir estudiantes»`, () =>
      inscribirPorUI(page, [est.correo], "inscribir 1 correo"));
    await test.step("Resultado: grupo «Inscritos ahora» con el correo", async () => {
      await expect(resultado.getByText("Inscritos ahora (1)")).toBeVisible();
      await expect(resultado.getByRole("listitem").filter({ hasText: est.correo.toLowerCase() })).toHaveCount(1);
      await expect(resultado.getByText(/^Ya estaban inscritos/)).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, { accion: "INSCRIPCION_MASIVA", resultado: "Permitido", usuario: ins.correo, recursoContiene: `cursos/${curso.id} (1)` });
  });

  // ------------------------------------------------------------------ CP-HU026-02
  test("CP-HU026-02 — Inscripción mixta y notificación solo al nuevo @P2 @HU-026", async ({ abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU026-02", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "TC-INS-01; §7.3",
      ajuste: "El estudiante «ya inscrito» se inscribe solo desde el catálogo (autoinscripción, que no notifica) para que la única notificación esperable sea la de la inscripción masiva" });
    const ins = await instructor26(abrirContexto);
    usuarioProbado(ins.correo);
    const nuevo = await cuentaLista(abrirContexto, { etiqueta: "insnuevo" });
    const yaEsta = await cuentaLista(abrirContexto, { etiqueta: "insyaesta" });
    const otroIns = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "insotro" });
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Mixta" });
    await test.step("Precondición: el estudiante «ya inscrito» se inscribe solo desde el catálogo", async () => {
      const pe = await sesion(abrirContexto, yaEsta);
      await pe.getByRole("link", { name: "Mis cursos" }).click();
      await pe.getByRole("button", { name: `Inscribirme en ${curso.titulo}` }).click();
      await expect(pe.getByText(`Te inscribiste en «${curso.titulo}».`).first()).toBeVisible();
      await pe.context().close();
    });
    const page = await pestanaEstudiantes(abrirContexto, ins, curso);
    const resultado = await test.step("1. Pegar los 3 correos (nuevo, ya inscrito e instructor) → «Inscribir estudiantes»", () =>
      inscribirPorUI(page, [nuevo.correo, yaEsta.correo, otroIns.correo], "inscribir 3 correos mixtos"));
    await test.step("Resultado: «Inscritos ahora» 1; «Ya estaban inscritos» 1; «No encontramos estos correos como estudiantes; …» 1", async () => {
      await expect(resultado.getByText("Inscritos ahora (1)")).toBeVisible();
      await expect(resultado.getByText("Ya estaban inscritos (1)")).toBeVisible();
      await expect(resultado.getByText(`${NO_ENCONTRADOS} (1)`)).toBeVisible();
      for (const [titulo, c] of [["Inscritos ahora", nuevo], ["Ya estaban inscritos", yaEsta], [NO_ENCONTRADOS, otroIns]]) {
        await expect(grupo(resultado, titulo).getByRole("listitem").filter({ hasText: c.correo.toLowerCase() }), `${c.correo} en «${titulo.slice(0, 25)}…»`).toHaveCount(1);
      }
    });
    await test.step("2. Cada estudiante revisa «Notificaciones»: solo el nuevo tiene «Te inscribieron en un curso»", async () => {
      const texto = `Ya puedes entrar al curso «${curso.titulo}».`;
      for (const [c, esperado] of [[nuevo, 1], [yaEsta, 0]]) {
        const pe = await sesion(abrirContexto, c);
        const panel = await abrirNotificaciones(pe);
        const n = await panel.getByText(texto).count();
        test.info().annotations.push({ type: `notificaciones ${c.correo}`, description: `${n} con «${texto}»` });
        expect(n, `${c.correo}`).toBe(esperado);
        await pe.context().close();
      }
    });
    await verificarAuditoria(abrirContexto, { accion: "INSCRIPCION_MASIVA", resultado: "Permitido", usuario: ins.correo, recursoContiene: `cursos/${curso.id} (1)` });
  });

  // ------------------------------------------------------------------ CP-HU026-03
  test("CP-HU026-03 — Autoinscripción en un curso publicado @P2 @HU-026", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU026-03", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI", referenciaPlan: "§7.3",
      ajuste: "D-16: en lenguaje normal la sección se llama «En curso» («Tus cursos» en lenguaje sencillo); se aceptan las dos" });
    const ins = await instructor26(abrirContexto);
    const est = await cuentaLista(abrirContexto, { etiqueta: "insauto" });
    usuarioProbado(est.correo);
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-Auto" });
    const page = await sesion(abrirContexto, est);
    const tus = page.getByRole("region", { name: /^(En curso|Tus cursos)$/ });
    const catalogo = page.getByRole("region", { name: "Catálogo" });
    await test.step("Precondición: el curso está en el «Catálogo» y no en «Tus cursos»", async () => {
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await expect(catalogo.getByRole("heading", { name: curso.titulo })).toBeVisible();
      await expect(tus.getByRole("heading", { name: curso.titulo })).toHaveCount(0);
    });
    await test.step("1. «Catálogo» → «Inscribirme»", async () => {
      await medir("autoinscripción", UMBRAL_AUTO, () => catalogo.getByRole("button", { name: `Inscribirme en ${curso.titulo}` }).click(),
        () => expect(page.getByText(`Te inscribiste en «${curso.titulo}».`).first()).toBeVisible());
    });
    await test.step("Resultado: el curso pasa a «Tus cursos»", async () => {
      await expect(tus.getByRole("heading", { name: curso.titulo }).or(tus.getByRole("link", { name: curso.titulo, exact: true })).first()).toBeVisible();
      await expect(catalogo.getByRole("heading", { name: curso.titulo })).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, { accion: "INSCRIPCION", resultado: "Permitido", usuario: est.correo, recursoContiene: `cursos/${curso.id}` });
  });

  // ------------------------------------------------------------------ CP-HU026-04
  test("CP-HU026-04 — Curso no publicado @P2 @HU-026", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, prioridad: "P2", caso: "CP-HU026-04", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "§7.3" });
    const ins = await instructor26(abrirContexto);
    usuarioProbado(ins.correo);
    const titulo = `E2E-Borrador26-${marca()}`;
    await test.step("1. Instructor: curso en borrador → «Estudiantes»: «Solo puedes inscribir estudiantes cuando el curso está publicado.»", async () => {
      const page = await sesion(abrirContexto, ins);
      const ed = new CursosInstructorPage(page);
      await ed.ir();
      await ed.crearCurso(titulo, "Curso en borrador de HU-026.");
      await ed.abrirEditor(titulo);
      await ed.pestana("Estudiantes").click();
      await expect(page.getByText("Solo puedes inscribir estudiantes cuando el curso está publicado.")).toBeVisible();
      await cerrarSesion(page);
      await page.context().close();
    });
    await test.step("2. Admin → /cursos: «Inscribir estudiantes» deshabilitado con «Solo se inscribe en cursos publicados.»", async () => {
      const ctx = await abrirContexto();
      const page = await ctx.newPage();
      await entrarComoAdmin(page);
      await page.goto("/cursos");
      const tarjeta = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: titulo }) });
      await expect(tarjeta).toHaveCount(1);
      await expect(tarjeta.getByRole("button", { name: `Inscribir estudiantes en ${titulo}` })).toBeDisabled();
      await expect(tarjeta.getByText("Solo se inscribe en cursos publicados.")).toBeVisible();
      await cerrarSesion(page);
    });
  });

  // ------------------------------------------------------------------ CP-HU026-05
  test("CP-HU026-05 — Más de 200 correos @P3 @HU-026", async ({ abrirContexto }) => {
    test.setTimeout(12 * 60_000);
    caso({ ...base, prioridad: "P3", caso: "CP-HU026-05", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "E2E-UI", referenciaPlan: "Adicional" });
    const ins = await instructor26(abrirContexto);
    usuarioProbado(ins.correo);
    const curso = await armarCurso(abrirContexto, ins, { prefijo: "E2E-201" });
    const page = await pestanaEstudiantes(abrirContexto, ins, curso);
    const correos = Array.from({ length: 201 }, (_, i) => `e2e${i + 1}@tdea.edu.co`);
    const enviadas = [];
    page.on("request", (r) => { if (r.method() === "POST" && /\/inscripciones$/.test(new URL(r.url()).pathname)) enviadas.push(r); });
    await test.step("1. Pegar 201 correos → «Inscribir estudiantes»", async () => {
      // En bloques de 40: cada acción de tecleo tiene 20 s y 201 correos seguidos no caben.
      const campo = page.getByLabel("Correos de los estudiantes");
      await escribirLargo(campo, correos.slice(0, 40).join(","));
      for (let k = 40; k < correos.length; k += 40) await campo.pressSequentially("," + correos.slice(k, k + 40).join(","), { delay: 2 });
      await expect(page.getByText("201 correo(s) detectado(s).")).toBeVisible();
      await page.getByRole("button", { name: "Inscribir estudiantes" }).click();
    });
    await test.step(`Resultado: «${MSG_MAX}» y no se envía nada`, async () => {
      await expect(page.getByText(MSG_MAX)).toBeVisible();
      await page.waitForTimeout(1000); // margen para una petición tardía; solo se observa
      expect(enviadas.length).toBe(0);
    });
  });
});
