import { expect, test } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";
import { EstudianteCursoPage } from "../pages/EstudianteCursoPage.js";
import { cerrarSesion } from "./sesiones.js";
import { marca } from "./datos.js";

/**
 * Cursos armados por la UI dentro de un caso (instructor y estudiantes desechables). Mismo patrón
 * que tests/hu029-notas.spec.js, que todavía tiene su copia local.
 */
export const MODULO = "Módulo E2E";
export const LECTURA = "Lectura E2E";
const TEXTO_LECTURA = "Lectura corta de las pruebas E2E. Se completa antes de presentar las evaluaciones.";

/** Entra por /login en un contexto nuevo como la cuenta dada. */
export async function sesion(abrirContexto, cuenta) {
  const ctx = await abrirContexto();
  const page = await ctx.newPage();
  await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.password);
  await expect(page).toHaveURL(/\/inicio/);
  return page;
}

/**
 * El instructor arma por la UI un curso publicado con un módulo, una lectura publicada, las
 * evaluaciones dadas (ver CursosInstructorPage.crearEvaluacion) y las tareas, e inscribe a los
 * estudiantes. Devuelve { titulo, id, evaluaciones: { titulo: id }, tareas: { titulo: id } }.
 */
export async function armarCurso(abrirContexto, ins, { prefijo = "E2E-Curso", evaluaciones = [], tareas = [], inscritos = [] }) {
  return test.step("Precondición: el instructor arma y publica el curso por la UI", async () => {
    const page = await sesion(abrirContexto, ins);
    const ed = new CursosInstructorPage(page);
    const curso = { titulo: `${prefijo}-${marca()}`, evaluaciones: {}, tareas: {} };
    await ed.ir();
    curso.id = await ed.crearCurso(curso.titulo, "Curso de las pruebas E2E.");
    await ed.abrirEditor(curso.titulo);
    await ed.crearModulo(MODULO);
    await ed.crearLecturaPublicada(MODULO, LECTURA, TEXTO_LECTURA);
    for (const e of evaluaciones) curso.evaluaciones[e.titulo] = await ed.crearEvaluacion(MODULO, e.titulo, e);
    for (const t of tareas) curso.tareas[t] = await ed.crearTarea(t);
    await ed.publicarCurso();
    if (inscritos.length) await ed.inscribir(inscritos.map((c) => c.correo));
    await cerrarSesion(page);
    await page.context().close();
    return curso;
  });
}

/**
 * Abre la sesión del estudiante en un contexto nuevo y completa la lectura del curso (habilita las
 * evaluaciones). Devuelve { page, ep } con la sesión abierta.
 */
export async function estudianteListo(abrirContexto, est, curso) {
  return test.step(`Precondición: ${est.correo} entra y completa la lectura`, async () => {
    const page = await sesion(abrirContexto, est);
    const ep = new EstudianteCursoPage(page);
    await ep.completarLectura(curso.titulo, LECTURA);
    return { page, ep };
  });
}

/**
 * El estudiante se inscribe solo en un curso publicado desde «Mis cursos» y abre su Comunidad
 * (/comunidad/<id>). Misma secuencia que tests/hu012-chat.spec.js, que tiene su copia local.
 */
export async function entrarALaComunidad(page, curso) {
  await test.step(`Precondición: inscribirse en «${curso.titulo}» y abrir su Comunidad`, async () => {
    await page.getByRole("link", { name: "Mis cursos" }).click();
    await page.getByRole("button", { name: `Inscribirme en ${curso.titulo}` }).click();
    await expect(page.getByText(`Te inscribiste en «${curso.titulo}».`).first()).toBeVisible();
    await page.getByRole("link", { name: "Comunidad", exact: true }).click();
    await expect(page).toHaveURL(/\/comunidad/);
    await page.getByRole("combobox", { name: "Curso" }).selectOption({ label: curso.titulo });
    await expect(page).toHaveURL(new RegExp(`/comunidad/${curso.id}$`));
    await expect(page.getByText("Conversación en tiempo real")).toBeVisible();
  });
}
