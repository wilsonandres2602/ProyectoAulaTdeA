import { test, expect } from "../support/test.js";
import { caso, medir, U, usuarioProbado } from "../support/caso.js";
import { cfg, ETIQUETA_CORREO } from "../support/config.js";
import { correoE2E, nombreE2E } from "../support/datos.js";
import { escribir } from "../support/humano.js";
import { verificarAuditoria } from "../support/auditoria.js";
import { crearCuenta, entrarComoAdmin } from "../support/sesiones.js";
import { UsuariosPage } from "../pages/UsuariosPage.js";
import { LoginPage } from "../pages/LoginPage.js";
import { OnboardingPage } from "../pages/OnboardingPage.js";

const base = { hu: "HU-001", rf: "RF-001", prioridad: "P1" };

test.describe("HU-001 · Registrar cuenta (RF-001)", () => {
  test("CP-HU001-01 — Registro exitoso de estudiante @P1 @HU-001", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU001-01", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "§7.14 CP-HU001-01; §7.3; §7.12.1 correo válido; TE-01; TC-REG-01" });
    const usuarios = new UsuariosPage(page);
    const correo = correoE2E("est");
    const nombre = nombreE2E("Estudiante");
    usuarioProbado(correo);
    let id;

    await test.step("Precondición: administrador autenticado por /login con OTP", () => entrarComoAdmin(page));
    await test.step("1. Ir a Usuarios › Nuevo usuario", async () => {
      await usuarios.ir();
      await usuarios.abrirNuevo();
    });
    await test.step("2. Ingresar nombre, correo, rol Estudiante y programa", async () => {
      const d = usuarios.dialogoNuevo;
      await escribir(d.getByLabel("Nombre completo"), nombre);
      await escribir(d.getByLabel(ETIQUETA_CORREO), correo);
      await d.getByLabel("Rol").selectOption({ label: "Estudiante" });
      await escribir(d.getByLabel("Programa académico"), "Ingeniería de Software");
    });
    await test.step("3. Guardar", async () => {
      const resp = page.waitForResponse((r) => r.url().endsWith("/api/admin/usuarios") && r.request().method() === "POST");
      await medir("registro de usuario", U.s(3, "RF-001 / HU-001 < 3 s"),
        () => usuarios.dialogoNuevo.getByRole("button", { name: "Crear usuario" }).click(),
        () => expect(usuarios.dialogoCredenciales).toBeVisible());
      const r = await resp;
      expect(r.status(), "El alta debe responder 201").toBe(201);
      id = (await r.json()).usuario.id;
    });
    await test.step("Resultado: credenciales de acceso y cuenta en «Primer acceso pendiente»", async () => {
      const { mensaje } = await usuarios.leerCredenciales();
      expect(mensaje).toContain("Se creó la cuenta.");
      await expect(usuarios.dialogoCredenciales.getByText("Contraseña temporal (entrégala por un canal seguro)")).toBeVisible();
      await expect(usuarios.dialogoCredenciales.getByText("Solo se muestra ahora.", { exact: false })).toBeVisible();
      await usuarios.cerrarCredenciales();
      await usuarios.buscar(correo);
      const fila = usuarios.fila(correo);
      await expect(fila).toBeVisible();
      await expect(fila).toContainText(/Primer acceso pendiente/i);
      await expect(fila).toContainText("Aún no ha ingresado");
    });
    await verificarAuditoria(abrirContexto, {
      accion: "USUARIO_CREADO", resultado: "Permitido", usuario: cfg.adminCorreo, recurso: `usuarios/${id} (ESTUDIANTE)`,
    });
  });

  test("CP-HU001-02 — Registro con correo duplicado @P1 @HU-001", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU001-02", tecnica: "partición", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.14 CP-HU001-02; §7.12.1 (409 CORREO_DUPLICADO); TC-REG-01" });
    const usuarios = new UsuariosPage(page);
    await test.step("Precondición: administrador autenticado; existe " + cfg.correoExistente, () => entrarComoAdmin(page));
    await usuarios.ir();
    let antes;
    await test.step("Contar cuentas con ese correo antes del intento", async () => {
      await usuarios.buscar(cfg.correoExistente);
      antes = await usuarios.fila(cfg.correoExistente).count();
      expect(antes).toBe(1);
    });
    await test.step(`1. Registrar un usuario con ${cfg.correoExistente}`, async () => {
      await usuarios.abrirNuevo();
      const d = usuarios.dialogoNuevo;
      await escribir(d.getByLabel("Nombre completo"), nombreE2E("Duplicado"));
      await escribir(d.getByLabel(ETIQUETA_CORREO), cfg.correoExistente);
      await d.getByLabel("Rol").selectOption({ label: "Estudiante" });
      await escribir(d.getByLabel("Programa académico"), "Ingeniería de Software");
    });
    await test.step("2. Guardar", async () => {
      const resp = page.waitForResponse((r) => r.url().endsWith("/api/admin/usuarios") && r.request().method() === "POST");
      await usuarios.dialogoNuevo.getByRole("button", { name: "Crear usuario" }).click();
      expect((await resp).status()).toBe(409);
    });
    await test.step("Resultado: mensaje claro y no se crea registro", async () => {
      await expect(usuarios.errorDialogo("Ya existe una cuenta con ese correo. No se creó nada.")).toBeVisible();
      await expect(usuarios.dialogoCredenciales).toBeHidden();
      await usuarios.dialogoNuevo.getByRole("button", { name: "Cancelar" }).click();
      await usuarios.buscar(cfg.correoExistente);
      await expect(usuarios.fila(cfg.correoExistente)).toHaveCount(antes);
    });
    await verificarAuditoria(abrirContexto, {
      accion: "USUARIO_DUPLICADO", resultado: "Denegado", usuario: cfg.adminCorreo, recurso: cfg.correoExistente,
    });
  });

  test("CP-HU001-03 — Registro con dominio no institucional @P1 @HU-001", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU001-03", tecnica: "partición", clasificacion: "Ruta Alterna", clase: "Con ajuste",
      referenciaPlan: "§7.14 CP-HU001-03; §7.12.1 (400 DOMINIO_NO_PERMITIDO); TC-REG-01",
      ajuste: "D-04: el código acepta un solo dominio (APP_DOMINIO); gmail/outlook y dominios del admin no implementados" });
    const usuarios = new UsuariosPage(page);
    const correo = `nuevo.${Date.now()}@gmail.com`;
    await test.step("Precondición: administrador autenticado", () => entrarComoAdmin(page));
    await usuarios.ir();
    await test.step(`1. Registrar con ${correo}`, async () => {
      await usuarios.abrirNuevo();
      const d = usuarios.dialogoNuevo;
      await escribir(d.getByLabel("Nombre completo"), nombreE2E("Dominio"));
      await escribir(d.getByLabel(ETIQUETA_CORREO), correo);
      await escribir(d.getByLabel("Programa académico"), "Ingeniería de Software");
    });
    await test.step("2. Guardar", async () => {
      const resp = page.waitForResponse((r) => r.url().endsWith("/api/admin/usuarios") && r.request().method() === "POST");
      await usuarios.dialogoNuevo.getByRole("button", { name: "Crear usuario" }).click();
      expect((await resp).status()).toBe(400);
    });
    await test.step("Resultado: 400 DOMINIO_NO_PERMITIDO y no se crea", async () => {
      await expect(usuarios.errorDialogo(`El correo debe terminar en @${cfg.dominio}.`)).toBeVisible();
      await usuarios.dialogoNuevo.getByRole("button", { name: "Cancelar" }).click();
      await usuarios.buscar(correo);
      await expect(usuarios.fila(correo)).toHaveCount(0);
    });
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP POST (400)", resultado: "Error", usuario: cfg.adminCorreo, recurso: "/api/admin/usuarios",
    });
  });

  test("CP-HU001-04 — Registro con correo de formato inválido @P1 @HU-001", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU001-04", tecnica: "partición", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.6 campos mal formados" });
    const usuarios = new UsuariosPage(page);
    await entrarComoAdmin(page);
    await usuarios.ir();
    await test.step("1. Registrar con el correo «correo-sin-arroba» y guardar", async () => {
      await usuarios.abrirNuevo();
      const d = usuarios.dialogoNuevo;
      await escribir(d.getByLabel("Nombre completo"), nombreE2E("Formato"));
      await escribir(d.getByLabel(ETIQUETA_CORREO), "correo-sin-arroba");
      await escribir(d.getByLabel("Programa académico"), "Ingeniería de Software");
      await d.getByRole("button", { name: "Crear usuario" }).click();
    });
    await test.step("Resultado: banner de revisión y error de campo del correo", async () => {
      await expect(usuarios.errorDialogo("Revisa los campos marcados y vuelve a intentarlo.")).toBeVisible();
      await expect(usuarios.errorDialogo("El correo no tiene un formato válido.")).toBeVisible();
      await expect(usuarios.dialogoCredenciales).toBeHidden();
    });
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP POST (400)", resultado: "Error", usuario: cfg.adminCorreo, recurso: "/api/admin/usuarios",
    });
  });

  test("CP-HU001-05 — Estudiante sin programa académico @P1 @HU-001", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU001-05", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "§7.3 «programa o especialidad faltante según rol»" });
    const usuarios = new UsuariosPage(page);
    await entrarComoAdmin(page);
    await usuarios.ir();
    await test.step("1. Rol Estudiante con «Programa académico» vacío → Crear usuario", async () => {
      await usuarios.abrirNuevo();
      const d = usuarios.dialogoNuevo;
      await escribir(d.getByLabel("Nombre completo"), nombreE2E("SinPrograma"));
      await escribir(d.getByLabel(ETIQUETA_CORREO), correoE2E("sinprog"));
      await d.getByRole("button", { name: "Crear usuario" }).click();
    });
    await test.step("Resultado: «Indica el programa académico del estudiante.»", async () => {
      await expect(usuarios.errorDialogo("Indica el programa académico del estudiante.")).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, {
      accion: "HTTP POST (400)", resultado: "Error", usuario: cfg.adminCorreo, recurso: "/api/admin/usuarios",
    });
  });

  test("CP-HU001-06 — Instructor sin especialidad @P1 @HU-001", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU001-06", tecnica: "decisión", clasificacion: "Ruta Alterna", clase: "Con ajuste",
      referenciaPlan: "§7.3 «programa o especialidad faltante según rol»",
      ajuste: "D-05: el código no exige especialidad al instructor; se valida que la cuenta se crea" });
    const usuarios = new UsuariosPage(page);
    await entrarComoAdmin(page);
    await usuarios.ir();
    const correo = correoE2E("ins");
    usuarioProbado(correo);
    let id;
    await test.step("1. Rol Instructor con «Especialidad» vacía → Crear usuario", async () => {
      const r = await usuarios.crear({ nombre: nombreE2E("Instructor"), correo, rol: "INSTRUCTOR" });
      expect(r.status).toBe(201);
      id = r.id;
    });
    await test.step("Resultado: la cuenta se crea (credenciales de acceso)", async () => {
      await usuarios.leerCredenciales();
      await usuarios.cerrarCredenciales();
    });
    await verificarAuditoria(abrirContexto, {
      accion: "USUARIO_CREADO", resultado: "Permitido", usuario: cfg.adminCorreo, recurso: `usuarios/${id} (INSTRUCTOR)`,
    });
  });

  for (const rol of ["INSTRUCTOR", "ADMINISTRADOR"]) {
    test(`CP-HU001-07 — Registro correcto de ${rol.toLowerCase()} @P1 @HU-001`, async ({ page, abrirContexto }) => {
      caso({ ...base, caso: "CP-HU001-07", tecnica: "partición", clasificacion: "Ruta Crítica", clase: "E2E-UI",
        referenciaPlan: "§7.3 «registro correcto por rol»" });
      const usuarios = new UsuariosPage(page);
      await entrarComoAdmin(page);
      await usuarios.ir();
      const correo = correoE2E(rol === "INSTRUCTOR" ? "ins" : "adm");
      usuarioProbado(correo);
      let id;
      await test.step(`1. Crear cuenta con rol ${rol}`, async () => {
        const x = await usuarios.crear({ nombre: nombreE2E(rol), correo, rol, especialidad: "Pruebas" }, {
          alEnviar: (enviar) => medir(`registro de ${rol.toLowerCase()}`, U.s(3, "RF-001 < 3 s"),
            enviar, () => expect(usuarios.dialogoCredenciales).toBeVisible()),
        });
        id = x.id;
        expect(x.status).toBe(201);
        expect(id).toBeTruthy();
      });
      await test.step("Resultado: credenciales y rol en la lista", async () => {
        await usuarios.leerCredenciales();
        await usuarios.cerrarCredenciales();
        await usuarios.buscar(correo);
        await expect(usuarios.fila(correo)).toContainText(rol === "INSTRUCTOR" ? "Instructor" : "Administrador");
      });
      await verificarAuditoria(abrirContexto, {
        accion: "USUARIO_CREADO", resultado: "Permitido", usuario: cfg.adminCorreo, recurso: `usuarios/${id} (${rol})`,
      });
    });
  }

  test("CP-HU001-08 — Primer acceso: cambiar la contraseña temporal @P1 @HU-001", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU001-08", tecnica: "estado", clasificacion: "Ruta Crítica", clase: "E2E-UI",
      referenciaPlan: "TE-02 (PENDIENTE_PRIMER_ACCESO → ACTIVO)" });
    const cuenta = await crearCuenta(abrirContexto);
    usuarioProbado(cuenta.correo);
    const onb = new OnboardingPage(page);
    await test.step("1. Iniciar sesión con la contraseña temporal", async () => {
      await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.temporal);
      await expect(page).toHaveURL(/\/primer-acceso/);
      await expect(page.getByRole("heading", { name: /^Hola, / })).toBeVisible();
    });
    await test.step("2. Cambiar la temporal por una válida → «Guardar y continuar»", async () => {
      await onb.llenarCambioTemporal(cuenta.temporal, cfg.e2ePassword);
      await medir("primer acceso", U.s(2, "RF-030 / cambio de contraseña < 2 s"),
        () => onb.guardarYContinuar.click(),
        () => expect(page).toHaveURL(/\/onboarding\/test/));
    });
    await verificarAuditoria(abrirContexto, {
      accion: "PRIMER_ACCESO_COMPLETADO", resultado: "Permitido", usuario: cuenta.correo, recurso: `usuarios/${cuenta.id}`,
    });
    await test.step("Resultado: la cuenta aparece «Activo» en /usuarios", async () => {
      const ctx = await abrirContexto();
      const p = await ctx.newPage();
      await entrarComoAdmin(p);
      const u = new UsuariosPage(p);
      await u.ir();
      await u.buscar(cuenta.correo);
      await expect(u.fila(cuenta.correo)).toContainText(/Activo/i);
      await ctx.close();
    });
  });

  test("CP-HU001-09 — Primer acceso con temporal errónea o nueva igual a la temporal @P1 @HU-001", async ({ page, abrirContexto }) => {
    caso({ ...base, caso: "CP-HU001-09", tecnica: "estado", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "TE-02 (transiciones inválidas)" });
    const cuenta = await crearCuenta(abrirContexto);
    usuarioProbado(cuenta.correo);
    const onb = new OnboardingPage(page);
    await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.temporal);
    await test.step("(a) Temporal errónea", async () => {
      await onb.cambiarTemporal(`${cfg.e2ePassword}x`, cfg.e2ePassword);
      await expect(page.getByRole("alert").filter({ hasText: "La contraseña actual no es correcta." })).toBeVisible();
    });
    await test.step("(b) Nueva igual a la temporal", async () => {
      await onb.cambiarTemporal(cuenta.temporal, cuenta.temporal);
      await expect(page.getByRole("alert").filter({ hasText: "La nueva contraseña debe ser distinta de la temporal." })).toBeVisible();
    });
    await verificarAuditoria(abrirContexto, {
      accion: "PRIMER_ACCESO_FALLIDO", resultado: "Denegado", usuario: cuenta.correo, recurso: "contraseña actual incorrecta",
    });
  });

  test("CP-HU001-10 — «Crear usuario» deshabilitado con campos vacíos @P3 @HU-001", async ({ page }) => {
    caso({ ...base, prioridad: "P3", caso: "CP-HU001-10", tecnica: "funcional", clasificacion: "Ruta Alterna", clase: "E2E-UI",
      referenciaPlan: "Adicional (validación de la interfaz)" });
    const usuarios = new UsuariosPage(page);
    await entrarComoAdmin(page);
    await usuarios.ir();
    await usuarios.abrirNuevo();
    await test.step("Resultado: botón deshabilitado con el motivo", async () => {
      await expect(usuarios.dialogoNuevo.getByRole("button", { name: "Crear usuario" })).toBeDisabled();
      await expect(usuarios.dialogoNuevo.getByText("Completa nombre y correo.")).toBeVisible();
    });
  });
});
