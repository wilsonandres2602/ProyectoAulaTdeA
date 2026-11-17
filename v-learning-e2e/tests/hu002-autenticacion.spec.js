import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { cfg, exigir, ETIQUETA_CORREO } from "../support/config.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { activarCuenta, cerrarSesion, crearCuenta, cuentaLista, entrarComoAdmin } from "../support/sesiones.js";
import { protegerCuenta, registrarEvento } from "../support/guard.js";
import {
  desbloquearPorEnlace, fallarHastaBloqueo, MSG_BLOQUEO, MSG_BLOQUEO_ADMIN, MSG_DESBLOQUEO_GENERICO, MSG_GENERICO, passwordErrada,
} from "../support/desbloqueo.js";
import { escribir } from "../support/humano.js";
import { LoginPage } from "../pages/LoginPage.js";
import { UsuariosPage } from "../pages/UsuariosPage.js";

const base = { hu: "HU-002", rf: "RF-002", prioridad: "P1" };
const MSG_OTP = "El código no es correcto o ya venció. Inicia sesión de nuevo para recibir otro.";
const otroCodigo = (c) => String((Number(c) + 1) % 1_000_000).padStart(6, "0");

test.describe("HU-002 · Autenticar con OTP (RF-002, RF-043, RF-044)", () => {
  test("CP-HU002-01 — Login de instructor con OTP @P1 @HU-002", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU002-01", tecnica: "decisión", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "§7.14 CP-HU002-01; TC-AUTH-01; Tabla A fila 2; AUT-16" });
    exigir("instructorDemoPassword");
    const login = new LoginPage(page);
    usuarioProbado(cfg.instructorDemoCorreo);
    await test.step("1. Ingresar correo y contraseña", async () => {
      await login.ir();
      await login.llenarCredenciales(cfg.instructorDemoCorreo, cfg.instructorDemoPassword);
      await medir("validación de credenciales", U.s(2, "RF-002 < 2 s"),
        () => login.continuar.click(),
        () => expect(login.tituloCodigo).toBeVisible());
    });
    await test.step("2. Ingresar el OTP de 6 dígitos", async () => {
      const codigo = await login.leerOtp();
      await login.llenarCodigo(codigo);
      await medir("emisión de sesión tras el OTP", U.s(2, "RF-002 < 2 s"),
        () => login.entrar.click(),
        () => expect(page).toHaveURL(/\/inicio/));
    });
    await test.step("Resultado: panel del instructor", async () => {
      await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Mis cursos" })).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "LOGIN_CREDENCIALES_OK", resultado: "Permitido", usuario: cfg.instructorDemoCorreo },
      { accion: "LOGIN_OK", resultado: "Permitido", usuario: cfg.instructorDemoCorreo },
    ]);
  });

  test("CP-HU002-04 — Login de administrador con OTP y redirección por rol @P1 @HU-002", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU002-04", tecnica: "decisión", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "§7.3 redirección por rol; TC-AUTH-01; Tabla A fila 2" });
    usuarioProbado(cfg.adminCorreo);
    const login = new LoginPage(page);
    await test.step("1. Credenciales y OTP del administrador", async () => {
      const camino = await login.iniciarSesion(cfg.adminCorreo, cfg.adminPassword);
      expect(camino, "El administrador siempre debe pasar por el OTP").toBe("OTP");
    });
    await test.step("Resultado: panel del administrador", async () => {
      await expect(page).toHaveURL(/\/inicio/);
      await expect(page.getByText("Estudiantes activos")).toBeVisible();
      await expect(page.getByText("Instructores activos")).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, { accion: "LOGIN_OK", resultado: "Permitido", usuario: cfg.adminCorreo });
  });

  test("CP-HU002-05 — Login de estudiante con 2FA activa por defecto @P1 @HU-002", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU002-05", tecnica: "decisión", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "Tabla A fila 3; §7.3" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    const login = new LoginPage(page);
    await test.step("1. Credenciales del estudiante → pide código", async () => {
      await login.ir();
      await login.enviarCredenciales(est.correo, est.password);
      await expect(login.tituloCodigo).toBeVisible();
    });
    await test.step("2. Código válido → inicio del estudiante", async () => {
      await login.llenarCodigo(await login.leerOtp());
      await medir("emisión de sesión tras el OTP", U.s(2, "RF-002 < 2 s"),
        () => login.entrar.click(),
        () => expect(page).toHaveURL(/\/inicio/));
    });
    await verificarAuditoria(abrirContexto, { accion: "LOGIN_OK", resultado: "Permitido", usuario: est.correo });
  });

  test("CP-HU002-06 — Correo inexistente: mensaje genérico @P1 @HU-002", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU002-06", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "TC-AUTH-02; Tabla A fila 1" });
    const correo = `no.existe.${Date.now()}@${cfg.dominio}`;
    usuarioProbado(correo);
    const login = new LoginPage(page);
    await login.ir();
    await test.step("1. Correo inexistente y contraseña → Continuar", async () => {
      await login.llenarCredenciales(correo, "Cualquiera#2026");
      await medir("rechazo de credenciales", U.s(2, "RF-002 < 2 s"),
        () => login.continuar.click(),
        () => expect(login.error(MSG_GENERICO)).toBeVisible());
    });
    await test.step("Resultado: sigue en /login, sin sesión", async () => {
      await expect(page).toHaveURL(/\/login/);
      await expect(login.tituloCodigo).toBeHidden();
    });
    await verificarAuditoria(abrirContexto, { accion: "LOGIN_FALLIDO", resultado: "Denegado", usuario: "—", recurso: correo });
  });

  test("CP-HU002-07 — Contraseña incorrecta: mensaje genérico @P1 @HU-002", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU002-07", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "TC-AUTH-02; Tabla A fila 1; §7.12.2 (un fallo)" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "LOGIN_FALLIDO", 1);
    const login = new LoginPage(page);
    await login.ir();
    await test.step("1. Correo correcto y contraseña errada → Continuar", async () => {
      expect(await login.intentar(est.correo, passwordErrada(1))).toBe(401);
      registrarEvento(est.correo, "LOGIN_FALLIDO");
    });
    await test.step("Resultado: el mismo mensaje genérico; no entra", async () => {
      await expect(login.error(MSG_GENERICO)).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    });
    await verificarAuditoria(abrirContexto, { accion: "LOGIN_FALLIDO", resultado: "Denegado", usuario: est.correo, recurso: est.correo });
  });

  test("CP-HU002-08 — OTP incorrecto @P1 @HU-002", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU002-08", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "TC-AUTH-02; §7.3 OTP incorrecto" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    const login = new LoginPage(page);
    await login.ir();
    await login.enviarCredenciales(est.correo, est.password);
    await test.step("1. Escribir un código distinto al del banner → Entrar", async () => {
      const bueno = await login.leerOtp();
      await login.escribirCodigo(otroCodigo(bueno));
    });
    await test.step("Resultado: error en el campo y el foco vuelve al código", async () => {
      await expect(page.getByRole("alert").filter({ hasText: MSG_OTP })).toBeVisible();
      await expect(login.codigo).toBeFocused();
      await expect(page).toHaveURL(/\/login/);
    });
    await verificarAuditoria(abrirContexto, { accion: "OTP_FALLIDO", resultado: "Denegado", usuario: est.correo, recurso: est.correo });
  });

  test("CP-HU002-09 — Campos vacíos y código incompleto @P1 @HU-002", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU002-09", tecnica: "partición", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "TC-AUTH-02 (campos vacíos)" });
    const login = new LoginPage(page);
    await test.step("(a) Sin correo ni contraseña", async () => {
      await login.ir();
      await expect(login.continuar).toBeDisabled();
      await expect(page.getByText("Escribe tu correo y tu contraseña para continuar.")).toBeVisible();
    });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    await test.step("(b) Código de 5 dígitos → Entrar", async () => {
      await login.ir();
      await login.enviarCredenciales(est.correo, est.password);
      await login.leerOtp();
      await login.escribirCodigo("12345");
      await expect(page.getByRole("alert").filter({ hasText: "Escribe los 6 dígitos del código." })).toBeVisible();
    });
  });

  test("CP-HU002-02 — Bloqueo por intentos fallidos @P1 @HU-002", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU002-02", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "Con ajuste",
      referenciaPlan: "§7.14 CP-HU002-02; TC-AUTH-03; TE-03; §7.12.2 (4 fallos / 5.º fallo); Tabla A fila 5",
      ajuste: "El correo de aviso no se puede ver sin SMTP; la notificación en la app se valida en CP-HU002-10" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "bloqueo" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "LOGIN_FALLIDO", 5, { exenta: true });
    const login = new LoginPage(page);
    await login.ir();
    await test.step("1. Enviar 4 contraseñas erróneas", async () => {
      for (let i = 1; i <= 4; i++) {
        expect(await login.intentar(est.correo, passwordErrada(i)), `Intento ${i}`).toBe(401);
        registrarEvento(est.correo, "LOGIN_FALLIDO");
        await expect(login.error(MSG_GENERICO)).toBeVisible();
      }
    });
    await test.step("2. Enviar la 5.ª errónea → 423 y enlace de desbloqueo", async () => {
      expect(await login.intentar(est.correo, passwordErrada(5))).toBe(423);
      registrarEvento(est.correo, "LOGIN_FALLIDO");
      await expect(login.error(MSG_BLOQUEO)).toBeVisible();
      await expect(login.enlaceDesbloqueo).toBeVisible();
    });
    await test.step("3. Enviar la contraseña correcta → sigue bloqueada", async () => {
      expect(await login.intentar(est.correo, est.password)).toBe(423);
      await expect(login.error(MSG_BLOQUEO)).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "LOGIN_FALLIDO", resultado: "Denegado", usuario: est.correo, minimo: 5 },
      { accion: "BLOQUEO_TEMPORAL", resultado: "Denegado", usuario: est.correo, recurso: "demasiados intentos fallidos" },
      { accion: "LOGIN_BLOQUEADO", resultado: "Denegado", usuario: est.correo },
    ]);
  });

  test("CP-HU002-10 — Desbloqueo por enlace y cuenta usable (RF-043) @P1 @HU-002", async ({ page, abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, rf: "RF-043", caso: "CP-HU002-10", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "RF-043; prompt §2; TE-03/TE-04", defecto: "D-09" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "desbloq" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "LOGIN_FALLIDO", 6, { exenta: true });
    const login = new LoginPage(page);
    await test.step("Precondición: cuenta bloqueada por 5 fallos", () => fallarHastaBloqueo(page, est.correo));
    await test.step("1. «¿No te llegó el enlace…? Pide otro» antes de 60 s → espera", async () => {
      await login.enlaceDesbloqueo.click();
      await expect(page).toHaveURL(/\/desbloquear/);
      await escribir(page.getByLabel(ETIQUETA_CORREO), est.correo);
      await page.getByRole("button", { name: "Enviar enlace" }).click();
      await expect(page.getByRole("alert").filter({
        hasText: "Ya te enviamos un enlace hace un momento. Revisa tu correo y espera un minuto para pedir otro.",
      })).toBeVisible();
    });
    await test.step("2. Después de 60 s: pedir el enlace, abrirlo y «Desbloquear mi cuenta»", async () => {
      await desbloquearPorEnlace(page, est.correo);
      await expect(page.getByRole("status").filter({ hasText: "Tu cuenta está desbloqueada. Ya puedes iniciar sesión." })).toBeVisible();
    });
    await test.step("3. «Iniciar sesión» con la contraseña correcta y ver la notificación del bloqueo", async () => {
      await page.getByRole("link", { name: "Iniciar sesión" }).click();
      await login.iniciarSesion(est.correo, est.password);
      await page.getByRole("button", { name: /^Notificaciones/ }).click();
      await expect(page.getByRole("region", { name: "Centro de notificaciones" })
        .getByText("Tu cuenta fue bloqueada temporalmente")).toBeVisible();
      await cerrarSesion(page);
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "DESBLOQUEO_SOLICITADO", resultado: "Permitido", usuario: est.correo },
      { accion: "CUENTA_DESBLOQUEADA_POR_ENLACE", resultado: "Permitido", usuario: est.correo },
    ]);
    await test.step("4. Un fallo después de desbloquear NO vuelve a bloquear (RF-043: cuenta usable)", async () => {
      await login.ir();
      const status = await login.intentar(est.correo, passwordErrada(9));
      registrarEvento(est.correo, "LOGIN_FALLIDO");
      expect(status, "D-09: tras desbloquear, un solo fallo no debería bloquear la cuenta").toBe(401);
      await expect(login.error(MSG_GENERICO)).toBeVisible();
    });
  });

  test("CP-HU002-11 — Enlace de desbloqueo reutilizado (RF-043) @P1 @HU-002", async ({ page, abrirContexto }) => {
    test.setTimeout(10 * 60_000);
    caso({ ...base, rf: "RF-043", caso: "CP-HU002-11", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "RF-043 (enlace de un solo uso)" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "reuso" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "LOGIN_FALLIDO", 5, { exenta: true });
    let href;
    await test.step("Precondición: cuenta bloqueada y desbloqueada con un enlace", async () => {
      await fallarHastaBloqueo(page, est.correo);
      href = await desbloquearPorEnlace(page, est.correo);
      await expect(page.getByRole("status").filter({ hasText: "Tu cuenta está desbloqueada." })).toBeVisible();
    });
    await test.step("1. Abrir el mismo enlace → «Desbloquear mi cuenta»", async () => {
      await page.goto(href);
      await page.getByRole("button", { name: "Desbloquear mi cuenta" }).click();
    });
    await test.step("Resultado: enlace inválido y se ofrece pedir otro", async () => {
      await expect(page.getByRole("alert").filter({ hasText: "El enlace venció o ya se usó. Pide uno nuevo con tu correo institucional." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Pide un enlace nuevo" })).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, { accion: "DESBLOQUEO_ENLACE_INVALIDO", resultado: "Denegado", recurso: "enlace vencido o usado" });
  });

  test("CP-HU002-12 — Tercer bloqueo en 24 h: solo lo levanta el administrador (RF-043) @P1 @HU-002", async ({ page, abrirContexto }) => {
    test.setTimeout(15 * 60_000);
    caso({ ...base, rf: "RF-043", caso: "CP-HU002-12", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "RF-043 (3 bloqueos en 24 h); prompt §2" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "tresbloq" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "LOGIN_FALLIDO", 15, { exenta: true });
    for (const n of [1, 2]) {
      await test.step(`Bloqueo ${n} y desbloqueo por enlace`, async () => {
        await fallarHastaBloqueo(page, est.correo);
        await desbloquearPorEnlace(page, est.correo);
        await expect(page.getByRole("status").filter({ hasText: "Tu cuenta está desbloqueada." })).toBeVisible();
      });
    }
    await test.step("Bloqueo 3 → solo el administrador puede desbloquear", async () => {
      await fallarHastaBloqueo(page, est.correo);
      await expect(new LoginPage(page).error(MSG_BLOQUEO_ADMIN)).toBeVisible();
    });
    await test.step("El enlace ya no se ofrece", async () => {
      await page.waitForTimeout(61_000);
      await page.goto("/desbloquear");
      await escribir(page.getByLabel(ETIQUETA_CORREO), est.correo);
      await page.getByRole("button", { name: "Enviar enlace" }).click();
      await expect(page.getByRole("status").filter({ hasText: MSG_DESBLOQUEO_GENERICO })).toBeVisible();
      await expect(page.locator("a.break-all")).toHaveCount(0);
    });
    await test.step("El administrador pulsa «Activar» y el login vuelve a funcionar", async () => {
      const ctx = await abrirContexto();
      const p = await ctx.newPage();
      await entrarComoAdmin(p);
      const u = new UsuariosPage(p);
      await u.ir();
      await u.buscar(est.correo);
      await expect(u.fila(est.correo)).toContainText(/Bloqueado/i);
      await u.boton(est.nombre, "Activar").click();
      await expect(u.fila(est.correo)).toContainText(/Activo/i);
      await ctx.close();
      await new LoginPage(page).iniciarSesion(est.correo, est.password);
      await expect(page).toHaveURL(/\/inicio/);
    });
    await verificarAuditoria(abrirContexto, [
      { accion: "BLOQUEO_REQUIERE_ADMINISTRADOR", resultado: "Denegado", usuario: est.correo },
      { accion: "USUARIO_ESTADO_ACTIVO", resultado: "Permitido", usuario: cfg.adminCorreo, recurso: `usuarios/${est.id}` },
    ]);
  });

  test("CP-HU002-13 — Reenviar código con espera de 60 s (RF-044) @P2 @HU-002", async ({ page, abrirContexto }) => {
    test.setTimeout(8 * 60_000);
    caso({ ...base, rf: "RF-044", prioridad: "P2", caso: "CP-HU002-13", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "RF-044 (adicional, prompt §2)" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    const login = new LoginPage(page);
    await login.ir();
    await login.enviarCredenciales(est.correo, est.password);
    const primero = await login.leerOtp();
    await test.step("1. «Reenviar código» está deshabilitado durante 60 s", async () => {
      await expect(login.reenviar).toBeDisabled();
      await expect(page.getByText(/Podrás pedir otro código en \d+ segundos\./)).toBeVisible();
    });
    await test.step("2. Pasados 60 s: «Reenviar código»", async () => {
      await expect(login.reenviar).toBeEnabled({ timeout: 70_000 });
      await login.reenviar.click();
      await expect(page.getByRole("status").filter({ hasText: `Te enviamos un código nuevo. Vence en ${cfg.otpMinutos} minutos.` })).toBeVisible();
    });
    await test.step("3. Entrar con el código nuevo", async () => {
      await expect(login.bannerOtp).not.toContainText(primero);
      await login.escribirCodigo(await login.leerOtp());
      await expect(page).toHaveURL(/\/inicio/);
    });
    await verificarAuditoria(abrirContexto, { accion: "OTP_REENVIADO", resultado: "Permitido", usuario: est.correo, recurso: est.correo });
  });

  test("CP-HU002-14 — 5 OTP erróneos invalidan el código @P1 @HU-002", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU002-14", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "Adicional (AuthService: 5 OTP fallidos)" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    const login = new LoginPage(page);
    await login.ir();
    await login.enviarCredenciales(est.correo, est.password);
    const bueno = await login.leerOtp();
    await test.step("1. Cinco códigos erróneos", async () => {
      for (let i = 1; i <= 5; i++) {
        await login.escribirCodigo(String((Number(bueno) + i) % 1_000_000).padStart(6, "0"));
        await expect(page.getByRole("alert").filter({ hasText: MSG_OTP })).toBeVisible();
      }
    });
    await test.step("2. El código correcto también se rechaza", async () => {
      await login.escribirCodigo(bueno);
      await expect(page.getByRole("alert").filter({ hasText: MSG_OTP })).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    });
    await verificarAuditoria(abrirContexto, { accion: "OTP_FALLIDO", resultado: "Denegado", usuario: est.correo, minimo: 6 });
  });

  test("CP-HU002-15 — Cerrar sesión @P3 @HU-002", async ({ page, abrirContexto }) => {
    caso({ ...base, prioridad: "P3", caso: "CP-HU002-15", tecnica: "funcional", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "Adicional (LOGOUT)" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    await new LoginPage(page).iniciarSesion(est.correo, est.password);
    await test.step("1. Menú lateral → «Cerrar sesión»", () => cerrarSesion(page));
    await test.step("Resultado: /inicio vuelve a /login", async () => {
      await page.goto("/inicio");
      await expect(page).toHaveURL(/\/login/);
    });
    await verificarAuditoria(abrirContexto, { accion: "LOGOUT", resultado: "Permitido", usuario: est.correo, recursoContiene: "sesiones/" });
  });

  // ------------------------------------------------------------------ @lento
  test("CP-HU002-03 — OTP vencido @P1 @HU-002 @lento", async ({ page, abrirContexto }) => {
    test.setTimeout((cfg.otpMinutos + 6) * 60_000);
    caso({ ...base, caso: "CP-HU002-03", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "Lento",
      referenciaPlan: "§7.14 CP-HU002-03; §7.12.2 vigencia del OTP",
      ajuste: `D-02: la vigencia es de ${cfg.otpMinutos} min (vlearning.otp.minutos-validez), no de 5. El catálogo pide el admin, pero la decisión 9 prohíbe que el admin provoque denegaciones: se usa un estudiante desechable (la 2FA está activa por defecto)` });
    const est = await cuentaLista(abrirContexto, { etiqueta: "otpvencido" });
    usuarioProbado(est.correo);
    const login = new LoginPage(page);
    await login.ir();
    await login.enviarCredenciales(est.correo, est.password);
    const codigo = await login.leerOtp();
    await test.step(`Esperar ${cfg.otpMinutos} min 05 s`, () => page.waitForTimeout(cfg.otpMinutos * 60_000 + 5_000));
    await test.step("1. Ingresar el OTP vencido", () => login.escribirCodigo(codigo));
    await test.step("Resultado: OTP_INVALIDO genérico; no se emite sesión", async () => {
      await expect(page.getByRole("alert").filter({ hasText: MSG_OTP })).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    });
    await verificarAuditoria(abrirContexto, { accion: "OTP_FALLIDO", resultado: "Denegado", usuario: est.correo });
  });

  test("CP-HU002-16 — OTP en el límite de vigencia @P1 @HU-002 @lento", async ({ page, abrirContexto }) => {
    test.setTimeout((cfg.otpMinutos + 8) * 60_000);
    caso({ ...base, caso: "CP-HU002-16", tecnica: "límite", clasificacion: "Ruta Crítica", clase: "Lento",
      referenciaPlan: "§7.12.2 vigencia del OTP (4:59)", ajuste: `D-02: límite de ${cfg.otpMinutos} min con 15 s de margen` });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    const login = new LoginPage(page);
    await login.ir();
    await login.enviarCredenciales(est.correo, est.password);
    const codigo = await login.leerOtp();
    await test.step(`Esperar ${cfg.otpMinutos - 1} min 45 s`, () => page.waitForTimeout(cfg.otpMinutos * 60_000 - 15_000));
    await test.step("1. Ingresar el OTP antes de que venza", () => login.escribirCodigo(codigo));
    await expect(page).toHaveURL(/\/inicio/);
    await verificarAuditoria(abrirContexto, { accion: "LOGIN_OK", resultado: "Permitido", usuario: est.correo });
  });

  test("CP-HU002-17 — Expiración por 30 min de inactividad @P1 @HU-002 @lento", async ({ page, abrirContexto }) => {
    test.setTimeout(45 * 60_000);
    caso({ ...base, caso: "CP-HU002-17", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "Lento", defecto: "D-18",
      referenciaPlan: "§7.3 expiración por 30 min de inactividad; §7.12.2 (31 min)" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    await new LoginPage(page).iniciarSesion(est.correo, est.password);
    await test.step("Sin actividad durante 31 min (la pestaña queda abierta)", () => page.waitForTimeout(31 * 60_000));
    await test.step("1. Navegar", async () => {
      await page.getByRole("link", { name: /Mi progreso|Tu avance/ }).first().click();
    });
    await test.step("Resultado: vuelve a /login con el aviso de sesión terminada", async () => {
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByText(/Tu sesión terminó por tiempo/)).toBeVisible();
    });
  });

  test("CP-HU002-18 — Sesión vigente a los 29 min y aviso previo (RF-042) @P2 @HU-002 @lento", async ({ page, abrirContexto }) => {
    test.setTimeout(40 * 60_000);
    caso({ ...base, rf: "RF-042", prioridad: "P2", caso: "CP-HU002-18", tecnica: "límite", clasificacion: "Ruta Crítica", clase: "Lento", defecto: "D-18",
      referenciaPlan: "§7.12.2 (29 min); RF-042" });
    const est = await cuentaLista(abrirContexto);
    usuarioProbado(est.correo);
    await new LoginPage(page).iniciarSesion(est.correo, est.password);
    await test.step("Sin actividad durante 29 min", () => page.waitForTimeout(29 * 60_000));
    await test.step("Resultado: sigue dentro y aparece «Tu sesión está por terminar» con «Ampliar sesión»", async () => {
      await expect(page).toHaveURL(/\/inicio/);
      const aviso = page.getByText("Tu sesión está por terminar");
      // Plan: el aviso aparece a los 29 min. D-18: el sondeo de /notificaciones cada 30 s desliza la sesión y el aviso nunca sale.
      await expect(aviso).toBeVisible();
      await page.getByRole("button", { name: "Ampliar sesión" }).click();
      await expect(aviso).toBeHidden();
      await page.getByRole("link", { name: /Mi progreso|Tu avance/ }).first().click();
      await expect(page).not.toHaveURL(/\/login/);
    });
    await verificarAuditoria(abrirContexto, { accion: "SESION_RENOVADA", resultado: "Permitido", usuario: est.correo });
  });

  test("CP-HU002-19 — Bloqueo vencido: entra y el contador se reinicia (TE-04) @P1 @HU-002 @lento", async ({ page, abrirContexto }) => {
    test.setTimeout(30 * 60_000);
    caso({ ...base, caso: "CP-HU002-19", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "Lento",
      referenciaPlan: "TE-04 «ACTIVO (contador reiniciado)»", defecto: "D-09" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "te04" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "LOGIN_FALLIDO", 6, { exenta: true });
    await test.step("Precondición: cuenta bloqueada por 5 fallos", () => fallarHastaBloqueo(page, est.correo));
    await test.step("Esperar 15 min 30 s", () => page.waitForTimeout(15.5 * 60_000));
    await test.step("1. Login correcto → entra", async () => {
      await new LoginPage(page).iniciarSesion(est.correo, est.password);
      await expect(page).toHaveURL(/\/inicio/);
      await cerrarSesion(page);
    });
    await test.step("2. Un fallo después: mensaje genérico, sin bloqueo (contador reiniciado)", async () => {
      const login = new LoginPage(page);
      await login.ir();
      const status = await login.intentar(est.correo, passwordErrada(7));
      registrarEvento(est.correo, "LOGIN_FALLIDO");
      expect(status, "D-09: tras el login correcto el contador debía reiniciarse").toBe(401);
      await expect(login.error(MSG_GENERICO)).toBeVisible();
    });
  });

  test("CP-HU002-20 — 5 fallos espaciados más de 15 min no bloquean @P1 @HU-002 @lento", async ({ page, abrirContexto }) => {
    test.setTimeout(30 * 60_000);
    caso({ ...base, caso: "CP-HU002-20", tecnica: "límite", clasificacion: "Ruta Alterna", clase: "Lento",
      referenciaPlan: "§7.12.2 (5 fallos espaciados más de 15 min)" });
    const est = await cuentaLista(abrirContexto, { etiqueta: "espaciado" });
    usuarioProbado(est.correo);
    protegerCuenta(est.correo, "LOGIN_FALLIDO", 5, { exenta: true });
    const login = new LoginPage(page);
    await login.ir();
    await test.step("1. Cuatro fallos", async () => {
      for (let i = 1; i <= 4; i++) {
        expect(await login.intentar(est.correo, passwordErrada(i))).toBe(401);
        registrarEvento(est.correo, "LOGIN_FALLIDO");
      }
    });
    await test.step("Esperar 15 min 30 s", () => page.waitForTimeout(15.5 * 60_000));
    await test.step("2. Quinto fallo → mensaje genérico, sin bloqueo", async () => {
      await login.ir();
      expect(await login.intentar(est.correo, passwordErrada(5))).toBe(401);
      registrarEvento(est.correo, "LOGIN_FALLIDO");
      await expect(login.error(MSG_GENERICO)).toBeVisible();
    });
  });
});
