import { test, expect } from "../support/test.js";
import { cuentaLista } from "../support/sesiones.js";
import { marca } from "../support/datos.js";
import { guardarDatos } from "../support/datosCompartidos.js";
import { LoginPage } from "../pages/LoginPage.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";
import { EstudianteCursoPage } from "../pages/EstudianteCursoPage.js";
import { cerrarSesion } from "../support/sesiones.js";

/**
 * Datos compartidos de la corrida, creados por la UI como lo haría la gente (paso 2 de ESTADO.md).
 * Hoy cubre lo que necesita HU-004:
 *   - instructor A (cuenta nueva) con el curso «E2E-Curso-<marca>» publicado: un módulo, una
 *     lectura publicada y una evaluación Quiz con una pregunta de verdadero o falso;
 *   - estudiante A (cuenta nueva) inscrito por el instructor, que completa la lectura y presenta
 *     la evaluación (deja un intento).
 * Se ampliará (video, podcast, tarea, 4 tipos de pregunta, instructor B…) cuando lo pidan HU-025/029.
 * En resultados/datos-<idEjecucion>.json se guardan solo IDs, nombres y correos.
 */
test("Datos compartidos E2E (curso, instructor y estudiante con intento)", async ({ abrirContexto }) => {
  test.setTimeout(15 * 60_000);
  const m = marca();
  const curso = { titulo: `E2E-Curso-${m}`, modulo: "Módulo E2E", lectura: "Lectura E2E", evaluacion: "Quiz E2E" };

  const insA = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "insa" });
  const estA = await cuentaLista(abrirContexto, { etiqueta: "esta" });

  await test.step("El instructor A crea, publica el curso e inscribe al estudiante A", async () => {
    const ctx = await abrirContexto();
    const page = await ctx.newPage();
    await new LoginPage(page).iniciarSesion(insA.correo, insA.password);
    const ed = new CursosInstructorPage(page);
    await ed.ir();
    curso.id = await ed.crearCurso(curso.titulo, "Curso creado por las pruebas E2E.");
    await ed.abrirEditor(curso.titulo);
    curso.moduloId = await ed.crearModulo(curso.modulo);
    curso.lecturaId = await ed.crearLecturaPublicada(curso.modulo, curso.lectura,
      "Esta es una lectura corta de las pruebas E2E. Explica un tema sencillo en dos frases.");
    curso.evaluacionId = await ed.crearEvaluacionVF(curso.modulo, curso.evaluacion, "Las pruebas E2E usan la interfaz real.");
    await ed.publicarCurso();
    await ed.inscribir([estA.correo]);
    await cerrarSesion(page);
    await ctx.close();
  });

  await test.step("El estudiante A completa la lectura y presenta la evaluación", async () => {
    const ctx = await abrirContexto();
    const page = await ctx.newPage();
    await new LoginPage(page).iniciarSesion(estA.correo, estA.password);
    const est = new EstudianteCursoPage(page);
    await est.completarLectura(curso.titulo, curso.lectura);
    curso.intentoEstudianteA = await est.presentarEvaluacion(curso.evaluacion);
    expect(curso.intentoEstudianteA).toBeGreaterThan(0);
    await cerrarSesion(page);
    await ctx.close();
  });

  const datos = {
    instructorA: { id: insA.id, correo: insA.correo, nombre: insA.nombre },
    estudianteA: { id: estA.id, correo: estA.correo, nombre: estA.nombre },
    cursoA: curso,
  };
  guardarDatos(datos);
  test.info().annotations.push({ type: "datosCompartidos", description: JSON.stringify(datos) });
});
