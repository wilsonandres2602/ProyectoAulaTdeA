import { test, expect } from "../support/test.js";
import { caso, usuarioProbado } from "../support/caso.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cerrarSesion, cuentaLista } from "../support/sesiones.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import { leerDatos } from "../support/datosCompartidos.js";
import { MSG_401, MSG_403, pedir, tokenDeSesion } from "../support/api.js";
import { LoginPage } from "../pages/LoginPage.js";

const base = { hu: "HU-004", rf: "RF-013", prioridad: "P1" };

/** Entra por /login (con OTP si lo pide) en un contexto nuevo y devuelve la página. */
async function sesion(abrirContexto, cuenta) {
  const ctx = await abrirContexto();
  const page = await ctx.newPage();
  await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.password);
  await expect(page).toHaveURL(/\/inicio/);
  return page;
}

/** Observa (sin interceptar) las respuestas 401/403 del API mientras corre `accion`. */
async function denegacionesDurante(page, accion) {
  const vistas = [];
  const oir = (r) => { if (r.url().includes("/api/") && [401, 403].includes(r.status())) vistas.push(`${r.request().method()} ${new URL(r.url()).pathname} (${r.status()})`); };
  page.on("response", oir);
  try { await accion(); } finally { page.off("response", oir); }
  return vistas;
}

test.describe("HU-004 · Control de acceso por rol (RF-013)", () => {
  // ------------------------------------------------------------------ CP-HU004-02 (UI)
  const RUTAS = {
    ESTUDIANTE: (d) => [
      ["/usuarios", "Usuarios"], ["/auditoria", "Auditoría"], ["/gamificacion", "Gamificación"],
      ["/informes", "Informes"], [`/cursos/${d.cursoA.id}/editar`, d.cursoA.titulo],
    ],
    // /informes y /cursos/<id>/editar sí son del instructor (SoloRol INSTRUCTOR/ADMINISTRADOR):
    // el instructor ajeno a un curso se prueba en CP-HU004-05.
    INSTRUCTOR: () => [["/usuarios", "Usuarios"], ["/auditoria", "Auditoría"], ["/gamificacion", "Gamificación"]],
  };

  for (const rol of ["ESTUDIANTE", "INSTRUCTOR"]) {
    test(`CP-HU004-02 — ${rol === "ESTUDIANTE" ? "Estudiante" : "Instructor"} escribe rutas de admin en la barra @P1 @HU-004`, async ({ abrirContexto }) => {
      caso({ ...base, caso: "CP-HU004-02", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI",
        referenciaPlan: "§7.3 «matriz por rol»; TC-RBAC-01",
        ajuste: rol === "INSTRUCTOR" ? "El instructor sí tiene /informes y /cursos/<id>/editar (propios); solo se prueban las rutas de admin" : undefined });
      const d = leerDatos();
      const cuenta = await cuentaLista(abrirContexto, rol === "INSTRUCTOR" ? { rol, especialidad: "Pruebas" } : {});
      usuarioProbado(cuenta.correo);
      const page = await test.step("Precondición: sesión abierta por /login", () => sesion(abrirContexto, cuenta));
      for (const [ruta, titulo] of RUTAS[rol](d)) {
        await test.step(`${ruta} → redirige a /inicio sin mostrar la pantalla`, async () => {
          const denegadas = await denegacionesDurante(page, async () => {
            await page.goto(ruta);
            await expect(page).toHaveURL(/\/inicio$/);
            await expect(page.getByRole("heading", { name: titulo, level: 1 })).toBeHidden();
          });
          expect(denegadas, "La guarda de la UI no debe llamar al API protegido").toEqual([]);
        });
      }
    });
  }

  // ------------------------------------------------------------------ CP-HU004-01 (API)
  test("CP-HU004-01 — Estudiante en endpoint de administración @P1 @HU-004 @api", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU004-01", tecnica: "seguridad", clasificacion: "Ruta Alterna", clase: "E2E-API",
      referenciaPlan: "§7.14 CP-HU004-01; TC-RBAC-01; AUT-13" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "DENEGACION", 1);
    const page = await sesion(abrirContexto, est);
    await test.step("Paso 0 (UI): /usuarios redirige a /inicio", async () => {
      await page.goto("/usuarios");
      await expect(page).toHaveURL(/\/inicio$/);
    });
    const token = await tokenDeSesion(page);
    await test.step("Paso 1: GET /api/admin/usuarios con su token → 403 ACCESO_DENEGADO", async () => {
      const r = await pedir(page, "GET", "/api/admin/usuarios", { token });
      registrarEvento(est.correo, "DENEGACION");
      test.info().annotations.push({ type: "rendimiento", description: JSON.stringify({
        metrica: "respuesta 403 de RBAC (incluye la red)", valorMs: r.ms,
        umbrales: [{ fuente: "Sobrecosto de RBAC ≤ 200 ms (solo se registra)", umbralMs: 200, cumple: r.ms <= 200 }] }) });
      expect(r.status).toBe(403);
      expect(r.cuerpo?.codigo).toBe("ACCESO_DENEGADO");
      expect(r.cuerpo?.mensaje).toBe(MSG_403);
    });
    await test.step("Paso 2: la misma petición sin token → 401 NO_AUTENTICADO", async () => {
      const r = await pedir(page, "GET", "/api/admin/usuarios");
      expect(r.status).toBe(401);
      expect(r.cuerpo?.codigo).toBe("NO_AUTENTICADO");
      expect(r.cuerpo?.mensaje).toBe(MSG_401);
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "HTTP GET (403)", resultado: "Denegado", usuario: est.correo, recurso: "/api/admin/usuarios" },
      { accion: "HTTP GET (401)", resultado: "Denegado", usuario: "—", recurso: "/api/admin/usuarios" },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU004-03 (API)
  test("CP-HU004-03 — Token inválido y token de una sesión cerrada @P1 @HU-004 @api", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU004-03", tecnica: "seguridad", clasificacion: "Ruta Alterna", clase: "E2E-API",
      referenciaPlan: "§7.3 token inválido / sesión cerrada" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    const token = await tokenDeSesion(page);
    await test.step("Con el token vigente, GET /api/mis-cursos responde 200", async () => {
      expect((await pedir(page, "GET", "/api/mis-cursos", { token })).status).toBe(200);
    });
    await test.step("(a) Token alterado (firma cambiada) → 401", async () => {
      const ultimo = token.at(-1);
      const alterado = token.slice(0, -1) + (ultimo === "A" ? "B" : "A");
      const r = await pedir(page, "GET", "/api/mis-cursos", { token: alterado });
      expect(r.status).toBe(401);
      expect(r.cuerpo?.codigo).toBe("NO_AUTENTICADO");
    });
    await test.step("(b) «Cerrar sesión» por la UI y reutilizar el token anterior → 401", async () => {
      await cerrarSesion(page);
      const r = await pedir(page, "GET", "/api/mis-cursos", { token });
      expect(r.status).toBe(401);
      expect(r.cuerpo?.codigo).toBe("NO_AUTENTICADO");
    });
    await verificarAuditoria(abrirContexto, { accion: "HTTP GET (401)", resultado: "Denegado", usuario: "—", recurso: "/api/mis-cursos", minimo: 2 });
  });

  // ------------------------------------------------------------------ CP-HU004-04 (API)
  const MATRIZ = {
    ESTUDIANTE: {
      denegados: ["/api/admin/usuarios", "/api/admin/dashboard", "/api/admin/auditoria", "/api/admin/gamificacion/reglas",
        "/api/instructor/cursos", "/api/informes"],
      permitidos: ["/api/cursos", "/api/mis-cursos", "/api/progreso"],
    },
    INSTRUCTOR: {
      denegados: ["/api/admin/usuarios", "/api/admin/dashboard", "/api/admin/auditoria", "/api/admin/gamificacion/reglas", "/api/admin/cursos"],
      permitidos: ["/api/instructor/cursos", "/api/informes"],
    },
    ADMINISTRADOR: {
      denegados: ["/api/cursos", "/api/mis-cursos", "/api/progreso", "/api/logros", "/api/vark/preguntas"],
      permitidos: ["/api/admin/usuarios", "/api/admin/dashboard", "/api/informes"],
    },
  };

  test("CP-HU004-04 — Matriz de endpoints por rol @P1 @HU-004 @api", async ({ abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, caso: "CP-HU004-04", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-API",
      referenciaPlan: "§7.3; TC-RBAC-01 (lista sacada de los @PreAuthorize de los controladores)",
      ajuste: "Solo GET (sin efectos); máximo 6 denegaciones por cuenta; el admin es una cuenta E2E desechable, nunca el admin demo" });
    const esperados = [];
    for (const [rol, m] of Object.entries(MATRIZ)) {
      await test.step(`Rol ${rol}`, async () => {
        const cuenta = await cuentaLista(abrirContexto, { rol, especialidad: rol === "INSTRUCTOR" ? "Pruebas" : undefined });
        usuarioProbado(cuenta.correo);
        protegerCuenta(cuenta.correo, "DENEGACION", m.denegados.length);
        const page = await sesion(abrirContexto, cuenta);
        const token = await tokenDeSesion(page);
        for (const ruta of m.denegados) {
          const r = await pedir(page, "GET", ruta, { token });
          registrarEvento(cuenta.correo, "DENEGACION");
          expect.soft(r.status, `${rol} GET ${ruta}`).toBe(403);
        }
        for (const ruta of m.permitidos) {
          const r = await pedir(page, "GET", ruta, { token });
          expect.soft(r.status, `${rol} GET ${ruta}`).toBeGreaterThanOrEqual(200);
          expect.soft(r.status, `${rol} GET ${ruta}`).toBeLessThan(300);
        }
        esperados.push({ accion: "HTTP GET (403)", resultado: "Denegado", usuario: cuenta.correo, minimo: m.denegados.length });
      });
    }
    await verificarAuditoria(abrirContexto, esperados);
  });

  // ------------------------------------------------------------------ CP-HU004-05 (API)
  test("CP-HU004-05 — Instructor fuera de sus cursos @P1 @HU-004 @api", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU004-05", tecnica: "seguridad", clasificacion: "Ruta Alterna", clase: "E2E-API",
      referenciaPlan: "§7.3; HU-025 §7.3 «solo el instructor dueño»; TC-REP-01" });
    const d = leerDatos();
    const insB = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "insb" });
    usuarioProbado(insB.correo);
    protegerCuenta(insB.correo, "DENEGACION", 6);
    const page = await sesion(abrirContexto, insB);
    const idA = d.cursoA.id;
    await test.step(`UI: /cursos/${idA}/editar → «Este curso pertenece a otro instructor.»`, async () => {
      const den = await denegacionesDurante(page, async () => {
        await page.goto(`/cursos/${idA}/editar`);
        await expect(page.getByText("Este curso pertenece a otro instructor.")).toBeVisible();
      });
      registrarEvento(insB.correo, "DENEGACION", Math.max(den.length, 1));
    });
    await test.step(`UI: /cursos/${idA}/notas → «Solo puedes ver las notas de tus cursos.»`, async () => {
      const den = await denegacionesDurante(page, async () => {
        await page.goto(`/cursos/${idA}/notas`);
        await expect(page.getByText("Solo puedes ver las notas de tus cursos.")).toBeVisible();
      });
      registrarEvento(insB.correo, "DENEGACION", Math.max(den.length, 1));
    });
    const token = await tokenDeSesion(page);
    await test.step(`API: GET /api/instructor/cursos/${idA} → 403 CURSO_AJENO`, async () => {
      const r = await pedir(page, "GET", `/api/instructor/cursos/${idA}`, { token });
      registrarEvento(insB.correo, "DENEGACION");
      expect(r.status).toBe(403);
      expect(r.cuerpo?.codigo).toBe("CURSO_AJENO");
    });
    await test.step(`API: GET /api/cursos/${idA}/notas → 403`, async () => {
      const r = await pedir(page, "GET", `/api/cursos/${idA}/notas`, { token });
      registrarEvento(insB.correo, "DENEGACION");
      expect(r.status).toBe(403);
      expect(r.cuerpo?.mensaje).toBe("Solo puedes ver las notas de tus cursos.");
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "HTTP GET (403)", resultado: "Denegado", usuario: insB.correo, recurso: `/api/instructor/cursos/${idA}` },
      { accion: "HTTP GET (403)", resultado: "Denegado", usuario: insB.correo, recurso: `/api/cursos/${idA}/notas` },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU004-06 (API)
  test("CP-HU004-06 — Estudiante sobre datos ajenos @P1 @HU-004 @api", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU004-06", tecnica: "seguridad", clasificacion: "Ruta Alterna", clase: "E2E-API",
      referenciaPlan: "§7.3 datos de otro estudiante" });
    const d = leerDatos();
    const idA = d.cursoA.intentoEstudianteA;
    const estB = await cuentaLista(abrirContexto, { etiqueta: "estb" });
    usuarioProbado(estB.correo);
    protegerCuenta(estB.correo, "DENEGACION", 4);
    const page = await sesion(abrirContexto, estB);
    await test.step(`UI: /intentos/${idA}/resultado → «Ese intento pertenece a otra persona.»`, async () => {
      const den = await denegacionesDurante(page, async () => {
        await page.goto(`/intentos/${idA}/resultado`);
        await expect(page.getByText("Ese intento pertenece a otra persona.")).toBeVisible();
      });
      registrarEvento(estB.correo, "DENEGACION", Math.max(den.length, 1));
    });
    const token = await tokenDeSesion(page);
    await test.step(`API: GET /api/intentos/${idA}/resultado → 403 INTENTO_AJENO`, async () => {
      const r = await pedir(page, "GET", `/api/intentos/${idA}/resultado`, { token });
      registrarEvento(estB.correo, "DENEGACION");
      expect(r.status).toBe(403);
      expect(r.cuerpo?.codigo).toBe("INTENTO_AJENO");
      expect(r.cuerpo?.mensaje).toBe("Ese intento pertenece a otra persona.");
    });
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP GET (403)", resultado: "Denegado", usuario: estB.correo, recurso: `/api/intentos/${idA}/resultado`, minimo: 2,
    });
  });
});
