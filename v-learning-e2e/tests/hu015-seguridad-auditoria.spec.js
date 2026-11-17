import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { cfg } from "../support/config.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { cuentaLista, entrarComoAdmin } from "../support/sesiones.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import { leerDatos } from "../support/datosCompartidos.js";
import { pedir, tokenDeSesion } from "../support/api.js";
import { escribir, elegir } from "../support/humano.js";
import { MSG_BLOQUEO, MSG_BLOQUEO_ADMIN } from "../support/desbloqueo.js";
import { LoginPage } from "../pages/LoginPage.js";
import { AuditoriaPage } from "../pages/AuditoriaPage.js";
import { CursosInstructorPage } from "../pages/CursosInstructorPage.js";
import { hoyISO } from "../support/datos.js";

const base = { hu: "HU-015", rf: "RF-014", prioridad: "P1" };
const MSG_RECHAZO = "Detectamos contenido no permitido en tu solicitud. Quita los símbolos especiales y vuelve a intentarlo.";

/** Entra por /login en un contexto nuevo y anota cualquier diálogo JS que aparezca (no debería). */
async function sesion(abrirContexto, cuenta) {
  const ctx = await abrirContexto();
  const page = await ctx.newPage();
  page.dialogos = [];
  page.on("dialog", async (d) => { page.dialogos.push(d.message()); await d.dismiss(); });
  await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.password);
  await expect(page).toHaveURL(/\/inicio/);
  return page;
}

/** El estudiante se inscribe en el curso del setup desde «Mis cursos» y abre su Comunidad. */
async function abrirComunidad(page, curso) {
  await test.step(`Precondición: inscribirse en «${curso}» y abrir la Comunidad`, async () => {
    await page.getByRole("link", { name: "Mis cursos" }).click();
    await page.getByRole("button", { name: `Inscribirme en ${curso}` }).click();
    await expect(page.getByText(`Te inscribiste en «${curso}».`).first()).toBeVisible();
    await page.getByRole("link", { name: "Comunidad", exact: true }).click();
    await expect(page).toHaveURL(/\/comunidad/);
    await elegir(page.getByRole("combobox", { name: "Curso" }), curso);
    await expect(page.getByLabel("Escribe un mensaje")).toBeVisible();
  });
}

/** Escribe y envía un mensaje; devuelve el HTTP del POST (solo se observa). */
async function enviarMensaje(page, texto) {
  await escribir(page.getByLabel("Escribe un mensaje"), texto);
  const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/cursos\/\d+\/mensajes$/.test(r.url()));
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  return (await resp).status();
}

const rechazo = (page) => page.getByRole("status").filter({ hasText: MSG_RECHAZO });

test.describe("HU-015 · Protección y auditoría (RF-014)", () => {
  // ------------------------------------------------------------------ CP-HU015-01
  test("CP-HU015-01 — XSS escrito en un campo real @P1 @HU-015", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU015-01", tecnica: "seguridad", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "TC-SEC-01; §7.3" });
    const d = leerDatos();
    const est = await cuentaLista(abrirContexto, { etiqueta: "xss" });
    const ins = await cuentaLista(abrirContexto, { rol: "INSTRUCTOR", especialidad: "Pruebas", etiqueta: "xssins" });
    usuarioProbado(est.correo);
    usuarioProbado(ins.correo);
    protegerCuenta(est.correo, "MALICIOSA", 1);
    protegerCuenta(ins.correo, "MALICIOSA", 1);

    const page = await sesion(abrirContexto, est);
    await abrirComunidad(page, d.cursoA.titulo);
    await test.step("1. Comunidad → mensaje «<script>alert(1)</script>» → «Enviar»", async () => {
      await escribir(page.getByLabel("Escribe un mensaje"), "<script>alert(1)</script>");
      const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/mensajes$/.test(r.url()));
      await medir("rechazo de entrada maliciosa (XSS)", U.ms(100, "Detección ≤ 100 ms (solo se registra)"),
        () => page.getByRole("button", { name: "Enviar", exact: true }).click(),
        () => expect(rechazo(page)).toBeVisible());
      expect((await resp).status()).toBe(400);
      registrarEvento(est.correo, "MALICIOSA");
    });
    await test.step("Resultado: no se publica el mensaje y no se ejecuta ningún script", async () => {
      await expect(page.getByLabel("Mensajes del curso").getByText("alert(1)")).toHaveCount(0);
      expect(page.dialogos).toEqual([]);
    });

    const pi = await sesion(abrirContexto, ins);
    await test.step("2. Instructor: «Nuevo curso» con el título «<img src=x onerror=alert(1)>»", async () => {
      const ed = new CursosInstructorPage(pi);
      await ed.ir();
      await pi.getByRole("button", { name: "Nuevo curso" }).click();
      const dlg = pi.getByRole("dialog", { name: "Nuevo curso" });
      await escribir(dlg.getByLabel("Título del curso"), "<img src=x onerror=alert(1)>");
      const resp = pi.waitForResponse((r) => r.request().method() === "POST" && /\/api\/instructor\/cursos$/.test(r.url()));
      await dlg.getByRole("button", { name: "Crear curso" }).click();
      expect((await resp).status()).toBe(400);
      registrarEvento(ins.correo, "MALICIOSA");
      await expect(dlg.getByRole("alert").filter({ hasText: MSG_RECHAZO })).toBeVisible();
      expect(pi.dialogos).toEqual([]);
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "ENTRADA_MALICIOSA_XSS", resultado: "Denegado", usuario: est.correo, recursoContiene: "/mensajes" },
      { accion: "ENTRADA_MALICIOSA_XSS", resultado: "Denegado", usuario: ins.correo, recurso: "/api/instructor/cursos" },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU015-02
  test("CP-HU015-02 — SQLi en el login y en el buscador @P1 @HU-015", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU015-02", tecnica: "seguridad", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "TC-SEC-01; §7.3",
      ajuste: "El buscador de cursos filtra en el navegador (no llama al API): se valida la lista vacía sin errores técnicos" });
    const login = new LoginPage(page);
    await test.step("(a) /login con el correo «' OR '1'='1» y una contraseña", async () => {
      await login.ir();
      const status = await login.intentar("' OR '1'='1", "Cualquiera#2026");
      expect(status).toBe(400);
      await expect(login.error(MSG_RECHAZO)).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    });
    const est = await cuentaLista(abrirContexto, { etiqueta: "sqli" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "MALICIOSA", 1);
    const p = await sesion(abrirContexto, est);
    await test.step("(b) «Buscar cursos» con «' OR 1=1 --» → Enter", async () => {
      const errores = [];
      p.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) errores.push(`${r.status()} ${r.url()}`); });
      await escribir(p.getByRole("search").getByLabel("Buscar cursos"), "' OR 1=1 --");
      await p.getByRole("search").getByLabel("Buscar cursos").press("Enter");
      await expect(p).toHaveURL(/\/cursos\?q=/);
      await expect(p.getByText(/Resultados para «' OR 1=1 --»: 0/)).toBeVisible();
      await expect(p.getByText(/Exception|SQL|syntax error|stack/i)).toHaveCount(0);
      expect(errores).toEqual([]);
    });
    await verificarAuditoria(abrirContexto, { accion: "ENTRADA_MALICIOSA_SQL", resultado: "Denegado", usuario: "—", recurso: "/api/auth/login" });
  });

  // ------------------------------------------------------------------ CP-HU015-03
  test("CP-HU015-03 — Bloqueo automático tras 3 entradas maliciosas @P1 @HU-015", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU015-03", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "Adicional (SeguridadService: 3 entradas maliciosas en 10 min)" });
    const d = leerDatos();
    const est = await cuentaLista(abrirContexto, { etiqueta: "bloqmal" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "MALICIOSA", 3, { exenta: true });
    const page = await sesion(abrirContexto, est);
    await abrirComunidad(page, d.cursoA.titulo);
    const intentos = ["<script>alert(1)</script>", "<iframe src=x>", "<img src=x onerror=alert(2)>"];
    for (const [i, texto] of intentos.entries()) {
      await test.step(`${i + 1}. Enviar «${texto}» → rechazado`, async () => {
        expect(await enviarMensaje(page, texto)).toBe(400);
        registrarEvento(est.correo, "MALICIOSA");
        await expect(rechazo(page)).toBeVisible();
      });
    }
    await test.step("4. Navegar → la sesión se cerró y vuelve a /login", async () => {
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await expect(page).toHaveURL(/\/login/);
    });
    await test.step("5. Iniciar sesión con la contraseña correcta → mensaje de bloqueo", async () => {
      const login = new LoginPage(page);
      await login.ir();
      expect(await login.intentar(est.correo, est.password)).toBe(423);
      await expect(login.error(MSG_BLOQUEO).or(login.error(MSG_BLOQUEO_ADMIN))).toBeVisible();
    });
    expect(page.dialogos).toEqual([]);
    await verificarAuditoria(abrirContexto, [
      { accion: "ENTRADA_MALICIOSA_XSS", resultado: "Denegado", usuario: est.correo, minimo: 3 },
      { accion: "USUARIO_BLOQUEADO_AUTOMATICO", resultado: "Permitido", usuario: est.correo, recurso: "entradas sospechosas repetidas" },
    ]);
  });

  // ------------------------------------------------------------------ CP-HU015-04
  test("CP-HU015-04 — Contenido HTML se muestra como texto @P1 @HU-015", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU015-04", tecnica: "seguridad", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "TC-SEC-01 (escapado en la salida)" });
    const d = leerDatos();
    const est = await cuentaLista(abrirContexto, { etiqueta: "html" });
    usuarioProbado(est.correo);
    const page = await sesion(abrirContexto, est);
    await abrirComunidad(page, d.cursoA.titulo);
    const texto = `<b>hola</b> ${Date.now()}`;
    await test.step("1. Enviar el mensaje «<b>hola</b> …» (no coincide con los patrones del filtro)", async () => {
      expect(await enviarMensaje(page, texto)).toBeLessThan(400);
    });
    await test.step("Resultado: se ve literalmente «<b>hola</b>» y no se crea un elemento <b>", async () => {
      const lista = page.getByLabel("Mensajes del curso");
      await expect(lista.getByText(texto, { exact: true })).toBeVisible();
      await expect(lista.locator("b", { hasText: "hola" })).toHaveCount(0);
    });
  });

  // ------------------------------------------------------------------ CP-HU015-05
  test("CP-HU015-05 — Los errores no exponen secretos ni trazas @P1 @HU-015 @api", async ({ abrirContexto }) => {
    caso({ ...base, caso: "CP-HU015-05", tecnica: "seguridad", clasificacion: "Ruta Alterna", clase: "E2E-API",
      referenciaPlan: "TC-SEC-01",
      ajuste: "D-19: el DTO de error usa `timestamp` en vez de `fecha`, y tiene `detalles` (errores por campo en los 400); se admiten si no exponen secretos" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "errores" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "DENEGACION", 1);
    const page = await sesion(abrirContexto, est);
    const token = await tokenDeSesion(page);
    const casos = [
      ["400 (JSON mal formado)", () => page.request.fetch(`/api/cursos/${leerDatos().cursoA.id}/mensajes`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, data: "{ no es json", failOnStatusCode: false }), 400],
      ["401 (sin token)", () => page.request.fetch("/api/mis-cursos", { failOnStatusCode: false }), 401],
      ["403 (endpoint de admin)", () => page.request.fetch("/api/admin/usuarios", { headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false }), 403],
      ["404 (curso inexistente)", () => page.request.fetch("/api/cursos/999999999", { headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false }), 404],
    ];
    const PROHIBIDO = /Exception|\bat (com|org|java)\.|stack ?trace|"trace"|\bselect\b.+\bfrom\b|\binsert into\b|eyJ[A-Za-z0-9_-]+\.|password|hash/i;
    for (const [nombre, peticion, esperado] of casos) {
      await test.step(`${nombre}: cuerpo JSON limpio`, async () => {
        const r = await peticion();
        if (esperado === 403) registrarEvento(est.correo, "DENEGACION");
        expect(r.status(), nombre).toBe(esperado);
        const texto = await r.text();
        await test.info().attach(`cuerpo-${esperado}.json`, { body: texto, contentType: "application/json" });
        const cuerpo = JSON.parse(texto);
        // D-19: el campo de la fecha se llama `timestamp` (ErrorRespuesta), no `fecha`.
        expect(Object.keys(cuerpo).filter((k) => !["codigo", "mensaje", "detalles", "timestamp", "ruta"].includes(k)), "Campos de más").toEqual([]);
        expect(typeof cuerpo.codigo).toBe("string");
        expect(typeof cuerpo.mensaje).toBe("string");
        expect(texto).not.toMatch(PROHIBIDO);
      });
    }
  });

  // ------------------------------------------------------------------ CP-HU015-06
  test("CP-HU015-06 — Auditoría de operaciones sensibles consultable @P1 @HU-015", async ({ page }) => {
    caso({ ...base, caso: "CP-HU015-06", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "§7.3; RF-014" });
    usuarioProbado(cfg.adminCorreo);
    await test.step("Precondición: administrador por /login con OTP", () => entrarComoAdmin(page));
    const aud = new AuditoriaPage(page);
    await aud.ir();
    const hoy = hoyISO();
    await test.step("1. «Acción»=USUARIO_CREADO, «Resultado»=Permitido, «Desde»/«Hasta»=hoy → «Buscar»", async () => {
      await aud.filtrar({ accion: "USUARIO_CREADO", resultado: "Permitido", desde: hoy, hasta: hoy });
      const filas = await aud.filas();
      expect(filas.length).toBeGreaterThan(0);
      const cab = await aud.tabla.locator("thead th").allInnerTexts();
      expect(cab.map((c) => c.trim())).toEqual(["Fecha", "Usuario", "Acción", "Recurso", "Resultado", "IP"]);
      for (const f of filas) {
        expect(f.accion).toBe("USUARIO_CREADO");
        expect(f.resultado.toLowerCase()).toBe("permitido");
        expect(f.fecha.getTime(), `Fecha ${f.fechaTexto} dentro de hoy`).toBeGreaterThanOrEqual(Date.parse(`${hoy}T00:00:00-05:00`));
      }
      await expect(page.getByRole("status").filter({ hasText: /^\d+ registro\(s\)\.$/ })).toBeVisible();
    });
    await test.step("2. Acción vacía y «Resultado»=Denegado → solo filas denegadas", async () => {
      await aud.filtrar({ accion: "", resultado: "Denegado" });
      const filas = await aud.filas();
      expect(filas.length).toBeGreaterThan(0);
      for (const f of filas) expect(f.resultado.toLowerCase()).toBe("denegado");
    });
    await test.step("3. «Desde» posterior a «Hasta» → mensaje y «Buscar» deshabilitado", async () => {
      const manana = new Date(Date.parse(`${hoy}T12:00:00-05:00`) + 86_400_000).toISOString().slice(0, 10);
      await aud.escribirFecha(aud.form.getByLabel("Desde"), manana);
      await expect(aud.form.getByText("La fecha final es anterior a la inicial.")).toBeVisible();
      await expect(aud.form.getByRole("button", { name: "Buscar" })).toBeDisabled();
    });
  });

  // ------------------------------------------------------------------ CP-HU015-07
  test("CP-HU015-07 — Bloqueo tras 10 accesos denegados en 10 min @P2 @HU-015 @api", async ({ abrirContexto }) => {
    caso({ ...base, prioridad: "P2", caso: "CP-HU015-07", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-API",
      referenciaPlan: "Adicional (SeguridadService: 10 denegaciones en 10 min)" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "diezden" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "DENEGACION", 10, { exenta: true });
    const page = await sesion(abrirContexto, est);
    const token = await tokenDeSesion(page);
    const rutas = ["/api/admin/usuarios", "/api/admin/dashboard", "/api/admin/auditoria", "/api/admin/gamificacion/reglas", "/api/admin/cursos"];
    await test.step("1. 10 GET a endpoints de admin con su token → 403 cada uno", async () => {
      for (let i = 0; i < 10; i++) {
        const r = await pedir(page, "GET", rutas[i % rutas.length], { token });
        registrarEvento(est.correo, "DENEGACION");
        expect(r.status, `Petición ${i + 1}`).toBe(403);
      }
    });
    await test.step("2. La sesión quedó cerrada: el mismo token ya no sirve (401)", async () => {
      const r = await pedir(page, "GET", "/api/mis-cursos", { token });
      expect(r.status).toBe(401);
    });
    await test.step("3. En la UI: navegar → vuelve a /login; iniciar sesión → mensaje de bloqueo", async () => {
      await page.getByRole("link", { name: "Mis cursos" }).click();
      await expect(page).toHaveURL(/\/login/);
      const login = new LoginPage(page);
      await login.ir();
      expect(await login.intentar(est.correo, est.password)).toBe(423);
      await expect(login.error(MSG_BLOQUEO).or(login.error(MSG_BLOQUEO_ADMIN))).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "HTTP GET (403)", resultado: "Denegado", usuario: est.correo, minimo: 10 },
      { accion: "USUARIO_BLOQUEADO_AUTOMATICO", resultado: "Permitido", usuario: est.correo, recurso: "accesos denegados repetidos" },
    ]);
  });
});
