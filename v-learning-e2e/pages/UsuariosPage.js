import { expect } from "@playwright/test";
import { elegir, escribir } from "../support/humano.js";
import { registrarSecreto } from "../support/secretos.js";
import { ROL_TEXTO } from "../support/datos.js";
import { ETIQUETA_CORREO } from "../support/config.js";

/** /usuarios (admin/Usuarios.jsx): alta de cuentas, estados y reenvío de credenciales. */
export class UsuariosPage {
  constructor(page) {
    this.page = page;
    this.nuevo = page.getByRole("button", { name: "Nuevo usuario" });
    this.dialogoNuevo = page.getByRole("dialog", { name: "Nuevo usuario" });
    this.dialogoCredenciales = page.getByRole("dialog", { name: "Credenciales de acceso" });
    this.filtro = page.getByRole("search", { name: "Filtrar usuarios" });
  }

  async ir() {
    await this.page.goto("/usuarios");
    await expect(this.page.getByRole("heading", { name: "Usuarios", level: 1 })).toBeVisible();
  }

  async abrirNuevo() {
    await this.nuevo.click();
    await expect(this.dialogoNuevo).toBeVisible();
  }

  /**
   * Llena el formulario «Nuevo usuario» y pulsa «Crear usuario». Observa (sin modificar) la
   * respuesta del POST para conocer el ID creado. Devuelve { status, id }.
   */
  async crear({ nombre, correo, rol = "ESTUDIANTE", programa, especialidad, codigo }, { alEnviar } = {}) {
    await this.abrirNuevo();
    const d = this.dialogoNuevo;
    if (nombre !== undefined) await escribir(d.getByLabel("Nombre completo"), nombre);
    if (correo !== undefined) await escribir(d.getByLabel(ETIQUETA_CORREO), correo);
    await elegir(d.getByLabel("Rol"), ROL_TEXTO[rol]);
    if (rol === "ESTUDIANTE" && programa) await escribir(d.getByLabel("Programa académico"), programa);
    if (rol === "INSTRUCTOR" && especialidad) await escribir(d.getByLabel("Especialidad"), especialidad);
    if (rol !== "ADMINISTRADOR" && codigo) await escribir(d.getByLabel(/^Código/), codigo);
    const respuesta = this.page.waitForResponse(
      (r) => r.url().endsWith("/api/admin/usuarios") && r.request().method() === "POST");
    const enviar = () => d.getByRole("button", { name: "Crear usuario" }).click();
    // alEnviar(enviar) permite medir solo el clic y la respuesta, sin el tecleo del formulario.
    await (alEnviar ? alEnviar(enviar) : enviar());
    const r = await respuesta;
    let id = null;
    if (r.ok()) {
      const cuerpo = await r.json();
      id = cuerpo?.usuario?.id ?? null;
    }
    return { status: r.status(), id };
  }

  /** Lee el diálogo «Credenciales de acceso». La contraseña temporal se registra como secreto. */
  async leerCredenciales() {
    await expect(this.dialogoCredenciales).toBeVisible();
    const mensaje = (await this.dialogoCredenciales.getByRole("status").innerText()).trim();
    const temporal = (await this.dialogoCredenciales.getByTestId("pass-temporal").innerText()).trim();
    registrarSecreto(temporal);
    return { mensaje, temporal };
  }

  async cerrarCredenciales() {
    await this.dialogoCredenciales.getByRole("button", { name: "Entendido" }).click();
    await expect(this.dialogoCredenciales).toBeHidden();
  }

  /** Error del formulario «Nuevo usuario» (banner o error de campo). */
  errorDialogo(texto) {
    return this.dialogoNuevo.getByRole("alert").filter({ hasText: texto });
  }

  async buscar(texto) {
    await escribir(this.filtro.getByLabel("Nombre o correo"), texto);
    await this.filtro.getByLabel("Nombre o correo").press("Enter");
  }

  fila(correo) {
    return this.page.getByRole("row").filter({ hasText: correo });
  }

  /** Abre /usuarios, busca por correo y espera a que la tabla muestre solo esa cuenta. */
  async irA(correo) {
    await this.ir();
    const resp = this.page.waitForResponse((r) => r.request().method() === "GET"
      && r.url().includes("/api/admin/usuarios?") && r.url().includes("q="));
    await this.buscar(correo);
    await resp;
    await expect(this.page.getByText("1 usuario(s) encontrados.")).toBeVisible();
    await expect(this.fila(correo)).toBeVisible();
  }

  /** Celda «Estado» de la fila (Rol, Código, Programa, Estado: la 4.ª celda; el nombre es rowheader). */
  estado(correo) {
    return this.fila(correo).getByRole("cell").nth(3);
  }

  /** Aviso flotante (región role=status del NotifContext) con el texto dado. */
  aviso(texto) {
    return this.page.getByRole("status").filter({ hasText: texto });
  }

  /** Acción de la fila: «Activar», «Desactivar», «Bloquear», «Reenviar credenciales». */
  boton(nombre, accion) {
    return this.page.getByRole("button", { name: `${accion} a ${nombre}` });
  }

  /** Total visible en el pie de la tabla de usuarios (para comprobar que no se creó nada). */
  async totalUsuarios() {
    const t = await this.page.getByText(/usuario\(s\)|Página \d+ de \d+/).first().innerText().catch(() => "");
    return t;
  }
}
