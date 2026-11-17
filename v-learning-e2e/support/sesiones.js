import { expect, test } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage.js";
import { UsuariosPage } from "../pages/UsuariosPage.js";
import { OnboardingPage } from "../pages/OnboardingPage.js";
import { cfg, exigir } from "./config.js";
import { correoE2E, nombreE2E } from "./datos.js";

// Si el login del admin falla una vez, no se reintenta en el resto de la corrida (workers: 1):
// cada intento suma LOGIN_FALLIDO y 3 bloqueos en 24 h dejan al único admin sin desbloqueo posible.
let falloAdmin = null;

/** Inicia sesión como administrador por /login con OTP, en la página dada. */
export async function entrarComoAdmin(page) {
  exigir("adminPassword");
  if (falloAdmin) {
    throw new Error(`No se reintenta el login del administrador en esta corrida (falló antes: ${falloAdmin}). Revisa ADMIN_PASSWORD en .env.`);
  }
  try {
    await new LoginPage(page).iniciarSesion(cfg.adminCorreo, cfg.adminPassword);
  } catch (e) {
    if (/falló: «/.test(e.message)) falloAdmin = e.message.split("falló: ")[1] ?? e.message;
    throw e;
  }
  await expect(page).toHaveURL(/\/inicio/);
}

/** Cierra la sesión desde el menú lateral, como una persona. */
export async function cerrarSesion(page) {
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login/);
}

const ABREV = { ESTUDIANTE: "est", INSTRUCTOR: "ins", ADMINISTRADOR: "adm" };

/**
 * Crea una cuenta por la UI del administrador (en un contexto aparte) y devuelve
 * { correo, nombre, id, rol, temporal }. La contraseña temporal solo vive en memoria.
 */
export async function crearCuenta(abrirContexto, { rol = "ESTUDIANTE", programa = "Ingeniería de Software", especialidad, etiqueta } = {}) {
  return test.step(`Precondición: el administrador crea una cuenta de ${rol.toLowerCase()}`, async () => {
    const ctx = await abrirContexto();
    const page = await ctx.newPage();
    await entrarComoAdmin(page);
    const usuarios = new UsuariosPage(page);
    await usuarios.ir();
    const correo = correoE2E(etiqueta ?? ABREV[rol]);
    const nombre = nombreE2E(rol === "ESTUDIANTE" ? "Estudiante" : rol === "INSTRUCTOR" ? "Instructor" : "Admin");
    const { status, id } = await usuarios.crear({ nombre, correo, rol, programa, especialidad });
    if (status >= 400) throw new Error(`No se pudo crear la cuenta de prueba ${correo} (HTTP ${status}).`);
    const { temporal } = await usuarios.leerCredenciales();
    await usuarios.cerrarCredenciales();
    await ctx.close();
    return { correo, nombre, id, rol, temporal };
  });
}

/**
 * Primer acceso de una cuenta recién creada (y onboarding si es estudiante). Deja la cuenta con
 * la contraseña E2E_PASSWORD. Se hace en un contexto aparte y se cierra la sesión al final.
 */
export async function activarCuenta(abrirContexto, cuenta, { estilo = "LECTURA_ESCRITURA", categorias = ["Ninguna"] } = {}) {
  exigir("e2ePassword");
  return test.step(`Precondición: ${cuenta.correo} completa el primer acceso`, async () => {
    const ctx = await abrirContexto();
    const page = await ctx.newPage();
    await new LoginPage(page).iniciarSesion(cuenta.correo, cuenta.temporal);
    const onb = new OnboardingPage(page);
    await onb.cambiarTemporal(cuenta.temporal, cfg.e2ePassword);
    if (cuenta.rol === "ESTUDIANTE") await onb.completarEstudiante({ estilo, categorias });
    else await expect(page).toHaveURL(/\/inicio/);
    await cerrarSesion(page);
    await ctx.close();
    cuenta.password = cfg.e2ePassword;
    delete cuenta.temporal;
    return cuenta;
  });
}

/** Crea y activa una cuenta lista para usar. */
export async function cuentaLista(abrirContexto, opciones = {}) {
  const c = await crearCuenta(abrirContexto, opciones);
  return activarCuenta(abrirContexto, c, opciones);
}
