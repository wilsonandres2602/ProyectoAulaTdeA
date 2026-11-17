import { expect } from "@playwright/test";
import { escribir } from "../support/humano.js";
import { registrarSecreto } from "../support/secretos.js";
import { ETIQUETA_CORREO } from "../support/config.js";

/** /login (Login.jsx): credenciales → (OTP) → sesión. Selectores por etiqueta y rol. */
export class LoginPage {
  constructor(page) {
    this.page = page;
    this.correo = page.getByLabel(ETIQUETA_CORREO);
    // exact: el botón «Mostrar contraseña» también contiene la palabra.
    this.password = page.getByLabel("Contraseña", { exact: true });
    this.continuar = page.getByRole("button", { name: "Continuar", exact: true });
    this.tituloCodigo = page.getByRole("heading", { name: "Revisa tu código" });
    this.codigo = page.getByLabel("Código de 6 dígitos");
    this.entrar = page.getByRole("button", { name: "Entrar", exact: true });
    this.reenviar = page.getByRole("button", { name: "Reenviar código" });
    this.bannerOtp = page.getByText(/Tu código es/);
    this.olvide = page.getByRole("link", { name: "¿Olvidaste tu contraseña?" });
    this.enlaceDesbloqueo = page.getByRole("link", { name: /No te llegó el enlace de desbloqueo/ });
  }

  async ir() {
    await this.page.goto("/login");
    await expect(this.page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();
  }

  async llenarCredenciales(correo, password) {
    await escribir(this.correo, correo);
    await escribir(this.password, password, { secreto: true });
  }

  async enviarCredenciales(correo, password) {
    await this.llenarCredenciales(correo, password);
    await this.continuar.click();
  }

  /**
   * Un intento de credenciales en el paso 1. Espera la respuesta del servidor (solo observa) y
   * devuelve su código HTTP: 200 (OTP o sesión), 401 (genérico), 423 (bloqueo)…
   */
  async intentar(correo, password) {
    const resp = this.page.waitForResponse((r) => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
    await this.enviarCredenciales(correo, password);
    return (await resp).status();
  }

  /** Banner de error (role=alert) con el texto dado. */
  error(texto) {
    return this.page.getByRole("alert").filter({ hasText: texto });
  }

  /** Lee el código del banner «Tu código es XXXXXX», como lo vería la persona. */
  async leerOtp() {
    await expect(this.bannerOtp).toBeVisible();
    const m = (await this.bannerOtp.innerText()).match(/(\d{6})/);
    if (!m) throw new Error("No encontré un código de 6 dígitos en el banner «Tu código es…». ¿VLEARNING_DEV_EXPONER_SECRETOS=true?");
    registrarSecreto(m[1]);
    return m[1];
  }

  async llenarCodigo(codigo) {
    await escribir(this.codigo, codigo, { secreto: true });
  }

  async escribirCodigo(codigo) {
    await this.llenarCodigo(codigo);
    await this.entrar.click();
  }

  /** Espera el paso del código o la salida de /login. Devuelve "OTP", "DIRECTO" o "ERROR". */
  async esperarRespuestaCredenciales() {
    const otp = this.tituloCodigo.waitFor({ timeout: 20_000 }).then(() => "OTP").catch(() => null);
    const fuera = this.page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 })
      .then(() => "DIRECTO").catch(() => null);
    const error = this.page.getByRole("alert").first().waitFor({ timeout: 20_000 }).then(() => "ERROR").catch(() => null);
    const r = await Promise.race([otp, fuera, error].map((p) => p.then((v) => v ?? new Promise(() => {}))));
    return r;
  }

  /**
   * Flujo completo de inicio de sesión. Con o sin OTP (el estudiante puede tenerlo desactivado).
   * Devuelve "OTP" o "DIRECTO" según el camino que tomó la app.
   */
  async iniciarSesion(correo, password) {
    await this.ir();
    await this.enviarCredenciales(correo, password);
    const camino = await this.esperarRespuestaCredenciales();
    if (camino === "ERROR") {
      const msg = await this.page.getByRole("alert").first().innerText();
      throw new Error(`El inicio de sesión de ${correo} falló: «${msg}»`);
    }
    if (camino === "OTP") {
      const codigo = await this.leerOtp();
      await this.escribirCodigo(codigo);
      await this.page.waitForURL((u) => !u.pathname.startsWith("/login"));
    }
    return camino;
  }
}
