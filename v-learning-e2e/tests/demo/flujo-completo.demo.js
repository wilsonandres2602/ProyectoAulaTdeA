// Video demostrativo del flujo principal de V-Learning (npm run video:demo).
// NO es un caso de prueba: no tiene ID del catálogo, no deja línea en auditoria/ejecuciones.jsonl y solo
// corre en el proyecto «demo» (DEMO=1). Todo se hace por la UI, como una persona, sobre vlearning_e2e.
//
// - Un contexto (y un video) por tramo: administrador, instructor, estudiante y administrador otra vez.
// - Antes de cada paso se muestra un rótulo en pantalla. El rótulo se inyecta SOLO en este spec, con un
//   pseudo-elemento (::after) para que ningún localizador por texto o por rol lo encuentre.
// - La máscara de secretos (SCRIPT_ENMASCARAR) sigue activa en todos los contextos.
// - Los tiempos de cada paso van a resultados/demo/linea-de-tiempo.json; scripts/video-demo.cjs une los
//   videos con ffmpeg, agrega la portada y genera el .srt.
// - Si un paso falla, no se esconde: el rótulo lo dice (con el defecto conocido si aplica) y el video sigue.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { SCRIPT_ENMASCARAR } from "../../support/secretos.js";
import { cfg, exigir } from "../../support/config.js";
import { escribir, escribirLargo, elegir } from "../../support/humano.js";
import { marca } from "../../support/datos.js";
import { LoginPage } from "../../pages/LoginPage.js";
import { OnboardingPage } from "../../pages/OnboardingPage.js";
import { UsuariosPage } from "../../pages/UsuariosPage.js";
import { CursosInstructorPage } from "../../pages/CursosInstructorPage.js";
import { EstudianteCursoPage } from "../../pages/EstudianteCursoPage.js";
import { AuditoriaPage } from "../../pages/AuditoriaPage.js";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SALIDA = path.join(RAIZ, "resultados", "demo");
const MEDIOS = path.join(SALIDA, "medios");
const PUERTO_MEDIOS = 5199;
const URL_VIDEO = `http://localhost:${PUERTO_MEDIOS}/clase-accesible.webm`; // .vtt al lado (subtítulos)
const VIEWPORT = { width: 1920, height: 1080 };

// ------------------------------------------------------------------ Datos «Demo»
const M = marca();
const CODIGO = `demo${M.slice(-9)}`; // va en la descripción: el estudiante lo busca en «Buscar cursos»
const CURSO = "Demo – Curso principal";
const LIBRE = "Demo – Curso libre";
const MOD1 = "Demo – Fundamentos de accesibilidad";
const MOD2 = "Demo – Contenido para todas las personas";
const MOD_LIBRE = "Demo – Primeros pasos";
const LECT1 = "Demo – ¿Qué es la accesibilidad web?";
const VID1 = "Demo – Video: los cuatro principios";
const LECT2 = "Demo – Lenguaje claro";
const VID2 = "Demo – Video: subtítulos y transcripciones";
const LECT_LIBRE = "Demo – Bienvenida al curso libre";
const LECT_LIBRE2 = "Demo – Cómo estudiar en la plataforma";
const EVAL1 = "Demo – Evaluación del módulo 1";
const EVAL2 = "Demo – Evaluación del módulo 2";
const EVAL_LIBRE = "Demo – Evaluación corta";
const TEXTO_LECT1 = [
  "## Accesibilidad web",
  "La accesibilidad web busca que todas las personas puedan percibir, entender, navegar e interactuar con un sitio.",
  "Incluye a quienes usan lector de pantalla, solo el teclado, subtítulos o textos más grandes.",
  "Las pautas WCAG la organizan en cuatro principios: perceptible, operable, comprensible y robusto.",
].join("\n");
const TEXTO_LECT2 = "El lenguaje claro usa frases cortas, palabras conocidas y una idea por párrafo. Ayuda a todas las personas a entender más rápido y con menos esfuerzo, en especial a quienes tienen una discapacidad cognitiva o aprenden en otro idioma.";
const SIMPLIFICADA = "Escribe frases cortas. Usa palabras fáciles. Pon una idea en cada párrafo.";
const TEXTO_LIBRE = "Este curso libre está abierto a cualquier estudiante. Puedes inscribirte solo desde el catálogo.";
const TEXTO_LIBRE2 = "Avanza a tu ritmo: lee cada contenido, márcalo como completado y presenta la evaluación al final del módulo.";

const P = {
  vf1: "Las pautas WCAG tienen cuatro principios.",
  u1: "¿Qué principio pide que se pueda usar solo con el teclado?",
  m1: "¿Qué ayudas sirven a una persona sorda?",
  vf2: "El lenguaje claro usa frases cortas.",
  u2: "¿Qué recurso acompaña siempre a un video accesible?",
  a2: "Escribe el nombre del texto que reproduce lo que se dice en un video.",
  vfL: "Puedo inscribirme solo en un curso libre.",
  uL: "¿Dónde ves tus puntos?",
};
const EVALUACIONES = {
  [MOD1]: { titulo: EVAL1, puntajeMaximo: 30, preguntas: [
    { enunciado: P.vf1, puntaje: 10 },
    { enunciado: P.u1, puntaje: 10, tipo: "UNICA", opciones: [{ texto: "Operable", correcta: true }, { texto: "Perceptible", correcta: false }, { texto: "Robusto", correcta: false }] },
    { enunciado: P.m1, puntaje: 10, tipo: "MULTIPLE", opciones: [{ texto: "Subtítulos", correcta: true }, { texto: "Transcripción", correcta: true }, { texto: "Audio sin texto", correcta: false }] },
  ] },
  [MOD2]: { titulo: EVAL2, puntajeMaximo: 30, preguntas: [
    { enunciado: P.vf2, puntaje: 10 },
    { enunciado: P.u2, puntaje: 10, tipo: "UNICA", opciones: [{ texto: "Subtítulos", correcta: true }, { texto: "Música de fondo", correcta: false }] },
    { enunciado: P.a2, puntaje: 10, tipo: "ABIERTA", aceptadas: ["Transcripción"] },
  ] },
  [MOD_LIBRE]: { titulo: EVAL_LIBRE, puntajeMaximo: 20, preguntas: [
    { enunciado: P.vfL, puntaje: 10 },
    { enunciado: P.uL, puntaje: 10, tipo: "UNICA", opciones: [{ texto: "En Logros", correcta: true }, { texto: "En Configuración", correcta: false }] },
  ] },
};
// Respuestas del estudiante (una incorrecta a propósito en el módulo 1, para mostrar la retroalimentación).
const RESPUESTAS = {
  [P.vf1]: "Verdadero", [P.u1]: "Perceptible", [P.m1]: ["Subtítulos", "Transcripción"],
  [P.vf2]: "Verdadero", [P.u2]: "Subtítulos", [P.a2]: { abierta: "Transcripción" },
  [P.vfL]: "Verdadero", [P.uL]: "En Logros",
};

// ------------------------------------------------------------------ Medios de la clase (video + VTT)
const VTT = `WEBVTT

00:00:00.000 --> 00:00:03.500
Bienvenidos a la clase de accesibilidad.

00:00:03.500 --> 00:00:07.000
Perceptible: la información se puede ver, oír o leer.

00:00:07.000 --> 00:00:10.500
Operable: todo se puede usar con el teclado.

00:00:10.500 --> 00:00:14.000
Comprensible y robusto: claro y compatible.
`;

/** Genera con ffmpeg-static un video WebM corto (Chromium de Playwright no trae H.264) y su VTT. */
function prepararMedios() {
  fs.mkdirSync(MEDIOS, { recursive: true });
  const webm = path.join(MEDIOS, "clase-accesible.webm");
  if (!fs.existsSync(webm)) {
    execFileSync(require("ffmpeg-static"), ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25:duration=14",
      "-c:v", "libvpx", "-b:v", "1M", "-pix_fmt", "yuv420p", webm]);
  }
  fs.writeFileSync(path.join(MEDIOS, "clase-accesible.vtt"), VTT);
}

/** Servidor local de los medios (con CORS: el <video> y la transcripción usan crossOrigin anonymous). */
function servirMedios() {
  const tipos = { ".webm": "video/webm", ".vtt": "text/vtt; charset=utf-8" };
  const srv = http.createServer((req, res) => {
    const archivo = path.join(MEDIOS, path.basename(decodeURIComponent(new URL(req.url, "http://x").pathname)));
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!fs.existsSync(archivo)) { res.writeHead(404).end(); return; }
    const tam = fs.statSync(archivo).size;
    const tipo = tipos[path.extname(archivo)] ?? "application/octet-stream";
    const rango = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    if (rango) {
      const ini = Number(rango[1] || 0);
      const fin = rango[2] ? Number(rango[2]) : tam - 1;
      res.writeHead(206, { "Content-Type": tipo, "Accept-Ranges": "bytes", "Content-Range": `bytes ${ini}-${fin}/${tam}`, "Content-Length": fin - ini + 1 });
      fs.createReadStream(archivo, { start: ini, end: fin }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": tipo, "Accept-Ranges": "bytes", "Content-Length": tam });
      fs.createReadStream(archivo).pipe(res);
    }
  });
  return new Promise((ok) => srv.listen(PUERTO_MEDIOS, "127.0.0.1", () => ok(srv)));
}

// ------------------------------------------------------------------ Rótulos y línea de tiempo
const CSS_ROTULO = `
#vl-demo-rotulo { position: fixed; z-index: 2147483647; pointer-events: none; font-family: Arial, Helvetica, sans-serif;
  color: #fff; transition: all .35s ease; }
#vl-demo-rotulo::after { content: attr(data-texto); white-space: pre-line; }
#vl-demo-rotulo[data-modo="grande"] { inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(15, 23, 42, .62); }
#vl-demo-rotulo[data-modo="grande"]::after { max-width: 1400px; padding: 44px 64px; border-radius: 22px; background: #0f2a4a;
  border: 4px solid #facc15; font-size: 46px; line-height: 1.35; font-weight: 700; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,.45); }
#vl-demo-rotulo[data-modo="barra"] { left: 50%; bottom: 18px; transform: translateX(-50%); max-width: 1500px; }
#vl-demo-rotulo[data-modo="barra"]::after { display: block; padding: 10px 26px; border-radius: 12px; background: rgba(15, 42, 74, .9);
  border: 2px solid #facc15; font-size: 24px; font-weight: 700; text-align: center; }
#vl-demo-rotulo[data-tono="falla"]::after { border-color: #f87171; background: #7f1d1d; }
`;

function ponerRotulo({ texto, modo, tono, css }) {
  if (!document.getElementById("vl-demo-estilo")) {
    const s = document.createElement("style");
    s.id = "vl-demo-estilo";
    s.textContent = css;
    document.head.appendChild(s);
  }
  let el = document.getElementById("vl-demo-rotulo");
  if (!el) {
    el = document.createElement("div");
    el.id = "vl-demo-rotulo";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  el.dataset.texto = texto;
  el.dataset.modo = modo;
  el.dataset.tono = tono ?? "";
}

const pausa = (page, ms = 1500) => page.waitForTimeout(ms);

class Rodaje {
  constructor(browser) {
    this.browser = browser;
    this.tomas = [];
    this.n = 0;
    this.fallas = [];
  }

  /** Abre un contexto limpio que graba su propio video (un tramo del video final). */
  async toma(rol) {
    const ctx = await this.browser.newContext({
      baseURL: cfg.baseURL, locale: "es-CO", timezoneId: "America/Bogota", viewport: VIEWPORT, deviceScaleFactor: 1,
      recordVideo: { dir: path.join(SALIDA, "crudo"), size: VIEWPORT },
    });
    await ctx.addInitScript(SCRIPT_ENMASCARAR);
    const page = await ctx.newPage();
    const t = { rol, inicio: Date.now(), pasos: [], page, ctx, rotulo: null, otp: [], alturas: [] };
    // Tras una carga completa (goto) el rótulo se vuelve a poner; la SPA no recarga en los clics.
    page.on("load", () => { if (t.rotulo) page.evaluate(ponerRotulo, t.rotulo).catch(() => {}); });
    this.tomas.push(t);
    return t;
  }

  async rotular(t, rotulo) {
    t.rotulo = { ...rotulo, css: CSS_ROTULO };
    await t.page.evaluate(ponerRotulo, t.rotulo).catch(() => {});
  }

  /**
   * Un paso del video: rótulo grande (2,5 s, siempre a velocidad normal), luego barra con el mismo texto
   * mientras se hace el paso. `rapido`: el montaje acelera el cuerpo del paso (el rótulo grande no).
   * `defecto`: texto que se muestra si el paso falla (p. ej. «D-34»). No se esconde ninguna falla.
   */
  async paso(t, texto, fn, { rapido = false, defecto } = {}) {
    const n = ++this.n;
    const rotulo = `${n}. ${texto}`;
    await this.vista(t);
    const reg = { n, texto: rotulo, rapido, tIntro: Date.now() - t.inicio, rapidos: [] };
    t.pasos.push(reg);
    t.actual = reg;
    await this.rotular(t, { texto: rotulo, modo: "grande" });
    await pausa(t.page, 2500);
    await this.rotular(t, { texto: rotulo + (rapido ? "  ▶▶" : ""), modo: "barra" });
    reg.tCuerpo = Date.now() - t.inicio;
    try {
      await fn();
    } catch (e) {
      const msg = String(e.message ?? e).split("\n")[0].slice(0, 160);
      reg.error = msg;
      this.fallas.push({ paso: rotulo, error: msg, defecto });
      const aviso = `${rotulo}\nFalla en este paso${defecto ? ` (defecto conocido ${defecto})` : ""}: ${msg}\nEl video continúa.`;
      reg.textoFalla = aviso;
      reg.tFalla = Date.now() - t.inicio;
      await this.rotular(t, { texto: aviso, modo: "grande", tono: "falla" });
      await pausa(t.page, 4000);
      await this.rotular(t, { texto: rotulo, modo: "barra" });
    }
    reg.tFin = Date.now() - t.inicio;
  }

  /**
   * Tramo que el montaje acelera dentro de un paso normal (tecleo de formularios, navegación). Las
   * pausas en las pantallas clave quedan fuera, a velocidad normal.
   */
  async acelerar(t, fn) {
    const ini = Date.now() - t.inicio;
    try { return await fn(); } finally { t.actual?.rapidos.push({ ini, fin: Date.now() - t.inicio }); }
  }

  /**
   * En modo visible, Windows puede achicar la ventana mientras corre y el video queda con una franja
   * gris abajo. Antes de cada paso se comprueba la altura de la vista y, si cambió, se vuelve a fijar.
   */
  async vista(t) {
    const alto = await t.page.evaluate(() => innerHeight).catch(() => null);
    t.alturas.push(alto);
    if (alto && alto !== VIEWPORT.height) await t.page.setViewportSize(VIEWPORT);
  }

  /** Cierra la toma y guarda su video en resultados/demo/<n>-<rol>.webm. */
  async cerrar(t) {
    t.fin = Date.now() - t.inicio;
    await t.ctx.close();
    const origen = await t.page.video().path();
    t.video = path.join(SALIDA, `${this.tomas.indexOf(t) + 1}-${t.rol}.webm`);
    fs.copyFileSync(origen, t.video);
  }

  guardar() {
    const datos = {
      generado: new Date().toISOString(), viewport: VIEWPORT, codigo: CODIGO,
      tomas: this.tomas.map((t) => ({ rol: t.rol, video: path.relative(RAIZ, t.video ?? ""), fin: t.fin, pasos: t.pasos, otp: t.otp, alturas: t.alturas })),
      fallas: this.fallas,
    };
    fs.writeFileSync(path.join(SALIDA, "linea-de-tiempo.json"), JSON.stringify(datos, null, 2));
  }
}

/** Login con OTP. Guarda en la línea de tiempo cuándo se ve «Revisa tu código» y dónde está el título
 *  (lo usa el montaje para revisar los fotogramas con scripts/detectar-otp.cjs). */
async function entrar(r, t, correo, password) {
  const login = new LoginPage(t.page);
  const camino = await r.acelerar(t, async () => {
    await login.ir();
    await login.enviarCredenciales(correo, password);
    return login.esperarRespuestaCredenciales();
  });
  if (camino === "ERROR") throw new Error(`El inicio de sesión falló: «${await t.page.getByRole("alert").first().innerText()}»`);
  if (camino === "OTP") {
    const caja = await login.tituloCodigo.boundingBox();
    t.otp.push({ t: Date.now() - t.inicio, titulo: caja && { x: Math.round(caja.x), y: Math.round(caja.y), w: Math.round(caja.width), h: Math.round(caja.height) } });
    await pausa(t.page, 1800); // se ve el banner del código, difuminado
    await r.acelerar(t, async () => {
      await login.escribirCodigo(await login.leerOtp());
      await t.page.waitForURL((u) => !u.pathname.startsWith("/login"));
    });
  }
}

/** «Mis cursos» del menú lateral (en el editor también hay otro enlace con ese nombre). */
async function irAMisCursos(page) {
  await page.getByRole("complementary", { name: "Menú principal" }).getByRole("link", { name: "Mis cursos" }).click();
  await expect(page.getByRole("heading", { name: "Mis cursos", level: 1 })).toBeVisible();
}

async function salir(page) {
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Recurso accesible en el diálogo «Editar contenido» (abierto). */
async function agregarRecurso(page, ed, dialogo, tipo, { url, texto }) {
  await elegir(dialogo.getByLabel("Tipo de recurso"), tipo);
  if (url) await escribir(dialogo.getByLabel("Enlace (URL)"), url);
  else await escribir(dialogo.getByLabel("Texto", { exact: true }), texto);
  await ed.observarPost(/^\/api\/contenidos\/\d+\/recursos$/, () => dialogo.getByRole("button", { name: "Agregar recurso" }).click());
  await expect(page.getByText(`Agregaste el recurso: ${tipo}.`).first()).toBeVisible();
}

/** Lectura publicada; con `simplificada`, antes se agrega ese recurso. */
async function lectura(page, ed, modulo, titulo, texto, simplificada) {
  if (!simplificada) return ed.crearLecturaPublicada(modulo, titulo, texto);
  await ed.pestana("Contenido").click();
  await page.getByRole("button", { name: `Nuevo contenido en ${modulo}` }).click();
  const d = page.getByRole("dialog", { name: "Nuevo contenido" });
  await escribir(d.getByLabel("Título del contenido"), titulo);
  await elegir(d.getByLabel("Formato"), "Lectura");
  await escribirLargo(d.getByLabel("Texto de la lección"), texto);
  await ed.observarPost(/^\/api\/modulos\/\d+\/contenidos$/, () => d.getByRole("button", { name: "Crear contenido" }).click());
  const e = page.getByRole("dialog", { name: "Editar contenido" });
  await agregarRecurso(page, ed, e, "Versión simplificada", { texto: simplificada });
  const pub = e.getByRole("button", { name: "Publicar contenido" });
  await expect(pub).toBeEnabled();
  await ed.observarPost(/^\/api\/contenidos\/\d+\/publicar$/, () => pub.click());
  await expect(e.getByRole("button", { name: "Despublicar contenido" })).toBeVisible();
  await e.getByRole("button", { name: "Cerrar" }).first().click();
  await expect(e).toBeHidden();
}

/** Abre un contenido del curso desde «Mis cursos». */
async function abrirContenido(page, curso, contenido) {
  await irAMisCursos(page);
  await page.getByRole("link", { name: curso, exact: true }).click();
  await expect(page.getByRole("heading", { name: curso, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: contenido, exact: true }).click();
  await expect(page.getByRole("heading", { name: contenido }).first()).toBeVisible();
}

async function completar(page) {
  const resp = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/contenidos\/\d+\/progreso$/.test(r.url()));
  await page.getByRole("button", { name: "Marcar como completado" }).click();
  expect((await resp).status()).toBeLessThan(400);
  await expect(page.getByText("¡Contenido completado!").first()).toBeVisible();
}

/** Presenta una evaluación respondiendo según RESPUESTAS y muestra el resultado con su detalle. */
async function presentar(r, t, ep, titulo) {
  const page = t.page;
  await r.acelerar(t, () => responderTodo(page, ep, titulo));
  await expect(page.getByRole("heading", { name: "Detalle por pregunta" })).toBeVisible();
  await pausa(page, 2000);
  await page.getByRole("heading", { name: "Detalle por pregunta" }).scrollIntoViewIfNeeded();
  await pausa(page, 2500);
}

async function responderTodo(page, ep, titulo) {
  await ep.abrirEvaluacion(titulo, "Comenzar");
  const total = Number((await page.getByText(/^Pregunta \d+ de \d+$/).innerText()).match(/de (\d+)/)[1]);
  for (let i = 1; i <= total; i++) {
    await expect(page.getByText(`Pregunta ${i} de ${total}`, { exact: true })).toBeVisible();
    const enunciado = await ep.enunciadoActual();
    const r = RESPUESTAS[enunciado];
    if (r === undefined) throw new Error(`Pregunta inesperada: «${enunciado}»`);
    const estado = await ep.responder(r);
    expect(estado, "guardado de la respuesta").toBeLessThan(400);
    await pausa(page, 600);
    if (i < total) await page.getByRole("button", { name: "Siguiente" }).click();
  }
  await page.getByRole("button", { name: "Terminar evaluación" }).click();
  await pausa(page, 800);
  await page.getByRole("dialog", { name: "¿Terminar la evaluación?" }).getByRole("button", { name: "Sí, terminar" }).click();
  await expect(page).toHaveURL(/\/intentos\/\d+\/resultado$/);
}

// ------------------------------------------------------------------ El recorrido
test.describe.configure({ mode: "serial" });

test("Video demostrativo del flujo principal (no es un caso de prueba)", async ({ browser }) => {
  exigir("adminPassword", "e2ePassword");
  fs.rmSync(path.join(SALIDA, "crudo"), { recursive: true, force: true });
  fs.mkdirSync(SALIDA, { recursive: true });
  prepararMedios();
  const servidor = await servirMedios();
  const r = new Rodaje(browser);
  const ins = { correo: `demo.${M}.instructor@${cfg.dominio}`, nombre: "Demo Instructora Ana Torres" };
  const est = { correo: `demo.${M}.estudiante@${cfg.dominio}`, nombre: "Demo Estudiante Luis Pérez" };

  try {
    // ================================================================ A. Administrador
    const adm = await r.toma("administrador");
    await r.paso(adm, "El administrador entra con correo, contraseña y código OTP (el código sale difuminado)", async () => {
      await entrar(r, adm, cfg.adminCorreo, cfg.adminPassword);
      await expect(adm.page).toHaveURL(/\/inicio/);
      await pausa(adm.page, 1500);
    });
    await r.paso(adm, "El administrador crea al instructor y al estudiante en Usuarios; la contraseña temporal sale difuminada", async () => {
      const u = new UsuariosPage(adm.page);
      await adm.page.getByRole("link", { name: "Usuarios", exact: true }).click();
      await expect(adm.page.getByRole("heading", { name: "Usuarios", level: 1 })).toBeVisible();
      for (const [c, rol] of [[ins, "INSTRUCTOR"], [est, "ESTUDIANTE"]]) {
        const { status } = await r.acelerar(adm, () => u.crear({ nombre: c.nombre, correo: c.correo, rol, programa: "Ingeniería de Software", especialidad: "Accesibilidad digital" }));
        expect(status, `crear ${rol}`).toBeLessThan(400);
        await expect(u.dialogoCredenciales).toBeVisible();
        await pausa(adm.page, 2500); // diálogo «Credenciales de acceso» con la contraseña temporal difuminada
        c.temporal = (await u.leerCredenciales()).temporal;
        await u.cerrarCredenciales();
      }
      await r.acelerar(adm, () => u.buscar(`demo.${M}`));
      await expect(adm.page.getByText("2 usuario(s) encontrados.")).toBeVisible();
      await pausa(adm.page, 2000);
      await salir(adm.page);
    });
    await r.cerrar(adm);
    if (!ins.temporal || !est.temporal) throw new Error("No se crearon las cuentas de la demo; no se puede seguir.");

    // ================================================================ B. Instructor
    const it = await r.toma("instructor");
    const ed = new CursosInstructorPage(it.page);
    await r.paso(it, "La instructora entra por primera vez y cambia su contraseña temporal", async () => {
      await entrar(r, it, ins.correo, ins.temporal);
      const onb = new OnboardingPage(it.page);
      await r.acelerar(it, () => onb.llenarCambioTemporal(ins.temporal, cfg.e2ePassword));
      await pausa(it.page, 1000);
      await onb.guardarYContinuar.click();
      await expect(it.page).toHaveURL(/\/inicio/);
      await pausa(it.page, 1500);
    });
    await r.paso(it, `La instructora crea «${CURSO}» con 2 módulos`, async () => {
      await irAMisCursos(it.page);
      await ed.crearCurso(CURSO, `Curso de la demostración de pruebas E2E (${CODIGO}).`);
      await ed.abrirEditor(CURSO);
      await ed.crearModulo(MOD1);
      await ed.crearModulo(MOD2);
      await pausa(it.page, 1500);
    }, { rapido: true });
    await r.paso(it, "Módulo 1: una lectura y un video con subtítulos y transcripción", async () => {
      await lectura(it.page, ed, MOD1, LECT1, TEXTO_LECT1);
      await ed.crearContenidoPublicado(MOD1, VID1, { formato: "Video", url: URL_VIDEO });
      await pausa(it.page, 1200);
    }, { rapido: true });
    await r.paso(it, "Módulo 2: una lectura con versión simplificada y otro video accesible", async () => {
      await lectura(it.page, ed, MOD2, LECT2, TEXTO_LECT2, SIMPLIFICADA);
      await ed.crearContenidoPublicado(MOD2, VID2, { formato: "Video", url: URL_VIDEO });
      await ed.pestana("Contenido").click();
      await pausa(it.page, 2000);
    }, { rapido: true });
    await r.paso(it, "Una evaluación por módulo, con preguntas de verdadero o falso, selección única, múltiple y abierta", async () => {
      for (const mod of [MOD1, MOD2]) await ed.crearEvaluacion(mod, EVALUACIONES[mod].titulo, EVALUACIONES[mod]);
      await pausa(it.page, 2000);
    }, { rapido: true });
    await r.paso(it, "La instructora publica el curso e inscribe al estudiante", async () => {
      await ed.publicarCurso();
      await pausa(it.page, 1000);
      await ed.inscribir([est.correo]);
      await pausa(it.page, 2000);
    });
    await r.paso(it, `La instructora crea y publica «${LIBRE}» (1 módulo, 2 contenidos y una evaluación corta) sin inscribir a nadie`, async () => {
      await irAMisCursos(it.page);
      await ed.crearCurso(LIBRE, `Curso libre de la demostración (${CODIGO}).`);
      await ed.abrirEditor(LIBRE);
      await ed.crearModulo(MOD_LIBRE);
      await lectura(it.page, ed, MOD_LIBRE, LECT_LIBRE, TEXTO_LIBRE);
      await lectura(it.page, ed, MOD_LIBRE, LECT_LIBRE2, TEXTO_LIBRE2);
      await ed.crearEvaluacion(MOD_LIBRE, EVAL_LIBRE, EVALUACIONES[MOD_LIBRE]);
      await ed.publicarCurso();
      await irAMisCursos(it.page);
      await pausa(it.page, 2000);
      await salir(it.page);
    }, { rapido: true });
    await r.cerrar(it);

    // ================================================================ C y D. Estudiante
    const es = await r.toma("estudiante");
    const pe = es.page;
    const ep = new EstudianteCursoPage(pe);
    const onb = new OnboardingPage(pe);
    await r.paso(es, "El estudiante entra por primera vez y cambia su contraseña temporal", async () => {
      await entrar(r, es, est.correo, est.temporal);
      await r.acelerar(es, () => onb.llenarCambioTemporal(est.temporal, cfg.e2ePassword));
      await pausa(pe, 1000);
      await onb.guardarYContinuar.click();
      await expect(pe).toHaveURL(/\/onboarding\/test/);
      await pausa(pe, 1500);
    });
    await r.paso(es, "Test VARK: 12 preguntas sobre cómo prefiere aprender; al final ve su estilo", async () => {
      await onb.responderVark("VISUAL");
      await expect(pe).toHaveURL(/\/onboarding\/resultado/);
      await pausa(pe, 3000);
      await onb.omitirSegundoMetodo();
    }, { rapido: true });
    await r.paso(es, "Perfil de accesibilidad: elige «Auditiva» y la vista previa muestra los ajustes", async () => {
      await expect(pe).toHaveURL(/\/onboarding\/accesibilidad/);
      await pe.getByRole("group", { name: "Categorías de accesibilidad" }).getByRole("checkbox", { name: /^Auditiva\b/ }).click();
      const prev = pe.getByRole("complementary", { name: "Vista previa" });
      await expect(prev.getByText("Subtítulos activados")).toBeVisible();
      await pausa(pe, 3000);
      await pe.getByRole("button", { name: "Guardar y empezar" }).click();
      await expect(pe).toHaveURL(/\/inicio/);
      await pausa(pe, 1500);
    });
    await r.paso(es, "Accesibilidad: alto contraste, texto más grande, fuente para dislexia (OpenDyslexic) y foco siempre visible", async () => {
      await pe.getByRole("link", { name: "Accesibilidad", exact: true }).first().click();
      await expect(pe).toHaveURL(/\/accesibilidad/);
      await pausa(pe, 1000);
      const sw = (n) => pe.getByRole("switch", { name: n, exact: true });
      await sw("Alto contraste").click();
      await expect(sw("Alto contraste")).toHaveAttribute("aria-checked", "true");
      await pausa(pe, 1500);
      const tam = pe.getByLabel(/^Tamaño del texto:/);
      await tam.focus();
      for (let i = 0; i < 4; i++) await tam.press("ArrowRight");
      await pausa(pe, 1200);
      await elegir(pe.getByLabel("Tipografía"), "OpenDyslexic");
      await sw("Navegación con teclado").click();
      await expect(pe.getByText(/Cambios guardados automáticamente/)).toBeVisible();
      await pe.getByRole("heading", { name: "Vista previa del texto" }).scrollIntoViewIfNeeded();
      await pausa(pe, 2500);
    });
    await r.paso(es, `Navegación solo con teclado: con Tab llega a la primera lectura de «${CURSO}» y la abre con Enter (foco visible)`, async () => {
      await r.acelerar(es, async () => {
        await irAMisCursos(pe);
        await pe.getByRole("link", { name: CURSO, exact: true }).click();
        await expect(pe.getByRole("heading", { name: CURSO, level: 1 })).toBeVisible();
      });
      await pe.getByRole("heading", { name: CURSO, level: 1 }).click(); // punto de partida del recorrido (sin foco en un control)
      let llego = false;
      for (let i = 0; i < 40 && !llego; i++) {
        await pe.keyboard.press("Tab");
        llego = await pe.evaluate((t) => document.activeElement?.innerText?.trim() === t, LECT1);
      }
      if (!llego) throw new Error(`Con 40 pulsaciones de Tab no se llegó al enlace «${LECT1}»`);
      await pausa(pe, 1500);
      await pe.keyboard.press("Enter");
      await expect(pe.getByRole("heading", { name: LECT1 }).first()).toBeVisible();
      await pausa(pe, 2500);
    });
    await r.paso(es, "Lectura en modo lectura y con «Leer en voz alta» (el control se ve aunque el video no tenga sonido). D-34: el Markdown se ve como texto plano", async () => {
      await pe.getByRole("button", { name: "Modo lectura" }).click();
      await pausa(pe, 3000);
      await pe.keyboard.press("Escape");
      await pausa(pe, 1000);
      const voz = pe.getByRole("group", { name: "Lectura en voz alta" });
      await voz.getByRole("button", { name: /Leer en voz alta/ }).click();
      await pausa(pe, 3000);
      await voz.getByRole("button", { name: /Detener/ }).click().catch(() => {});
      await completar(pe);
      await pausa(pe, 1200);
    }, { defecto: "D-34" });
    await r.paso(es, "Se restablecen los ajustes visuales; el video muestra subtítulos y la transcripción sincronizada", async () => {
      await pe.getByRole("link", { name: "Accesibilidad", exact: true }).first().click();
      await pe.getByRole("button", { name: "Restablecer valores predeterminados" }).click();
      await pe.getByRole("dialog", { name: "¿Restablecer los ajustes?" }).getByRole("button", { name: "Sí, restablecer" }).click();
      await expect(pe.getByText("Restablecimos los valores predeterminados.").first()).toBeVisible();
      await pausa(pe, 1200);
      await r.acelerar(es, () => abrirContenido(pe, CURSO, VID1));
      const video = pe.locator("video").first();
      await video.scrollIntoViewIfNeeded();
      const mostrar = pe.getByRole("button", { name: "Mostrar transcripción" });
      if (await mostrar.isVisible().catch(() => false)) await mostrar.click();
      const caja = await video.boundingBox();
      await pe.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2); // clic en el video: reproducir
      await pausa(pe, 6000);
      if (await video.evaluate((v) => v.paused)) throw new Error("El video no empezó a reproducirse con el clic");
      await completar(pe);
      await pausa(pe, 1200);
    });
    await r.paso(es, "Evaluación del módulo 1: responde, termina y ve el resultado con la retroalimentación por pregunta", async () => {
      await presentar(r, es, ep, EVAL1);
    });
    await r.paso(es, "Módulo 2: la lectura y su versión simplificada; luego el segundo video", async () => {
      await r.acelerar(es, () => abrirContenido(pe, CURSO, LECT2));
      await pausa(pe, 1200);
      await pe.getByRole("tablist", { name: "Formas de estudiar" }).getByRole("tab", { name: "Versión en texto" }).click();
      await expect(pe.getByRole("heading", { name: "Versión simplificada" })).toBeVisible();
      await pausa(pe, 3000);
      await pe.getByRole("tablist", { name: "Formas de estudiar" }).getByRole("tab", { name: "Contenido" }).click();
      await completar(pe);
      await r.acelerar(es, () => abrirContenido(pe, CURSO, VID2));
      await pausa(pe, 1500);
      await completar(pe);
      await pausa(pe, 1000);
    });
    await r.paso(es, "Evaluación del módulo 2 (incluye una pregunta abierta)", async () => {
      await presentar(r, es, ep, EVAL2);
    });
    await r.paso(es, `El estudiante busca «${LIBRE}» en el catálogo y se inscribe solo`, async () => {
      await r.acelerar(es, async () => {
        await escribir(pe.getByLabel("Buscar cursos"), CODIGO);
        await pe.getByLabel("Buscar cursos").press("Enter");
      });
      await expect(pe.getByRole("heading", { name: "Catálogo" })).toBeVisible();
      await pausa(pe, 1500);
      await pe.getByRole("button", { name: `Inscribirme en ${LIBRE}` }).click();
      await expect(pe.getByText(`Te inscribiste en «${LIBRE}».`).first()).toBeVisible();
      await pausa(pe, 2000);
    });
    await r.paso(es, "Completa los 2 contenidos y la evaluación corta del curso libre", async () => {
      for (const c of [LECT_LIBRE, LECT_LIBRE2]) {
        await abrirContenido(pe, LIBRE, c);
        await completar(pe);
      }
      await presentar(r, es, ep, EVAL_LIBRE);
    }, { rapido: true });
    await r.paso(es, "Mi progreso, los puntos y los logros del estudiante", async () => {
      await pe.getByRole("link", { name: "Mi progreso", exact: true }).click();
      await expect(pe.getByRole("heading", { name: "Mi progreso", level: 1 })).toBeVisible();
      await pausa(pe, 3000);
      await pe.getByRole("heading", { name: "Calificaciones" }).scrollIntoViewIfNeeded().catch(() => {});
      await pausa(pe, 2000);
      await pe.getByRole("link", { name: "Logros", exact: true }).click();
      await expect(pe.getByRole("heading", { name: "Logros", level: 1 })).toBeVisible();
      await pausa(pe, 3500);
      await pe.getByRole("heading", { name: "Clasificación del curso" }).scrollIntoViewIfNeeded().catch(() => {});
      await pausa(pe, 2000);
      await salir(pe);
    });
    await r.cerrar(es);

    // ================================================================ E. Cierre: auditoría
    const ad2 = await r.toma("auditoria");
    await r.paso(ad2, "El administrador abre Auditoría: las filas del recorrido (USUARIO_CREADO, LOGIN_OK y demás)", async () => {
      await entrar(r, ad2, cfg.adminCorreo, cfg.adminPassword);
      await ad2.page.getByRole("link", { name: "Auditoría", exact: true }).click();
      const aud = new AuditoriaPage(ad2.page);
      await expect(ad2.page.getByRole("heading", { name: "Auditoría", level: 1 })).toBeVisible();
      await expect(aud.tabla).toBeVisible();
      await pausa(ad2.page, 3500);
      // USUARIO_CREADO: el usuario de la fila es el admin y el recurso «usuarios/<id> (ROL)».
      // LOGIN_OK: el usuario de la fila es la cuenta que entró (las de la demo).
      for (const [accion, buscar] of [["USUARIO_CREADO", /\((INSTRUCTOR|ESTUDIANTE)\)/], ["LOGIN_OK", `demo.${M}`]]) {
        await r.acelerar(ad2, () => aud.filtrar({ accion }));
        const filas = await aud.filas();
        expect(filas.length, `filas ${accion}`).toBeGreaterThan(0);
        await expect(aud.tabla.getByRole("row").filter({ hasText: buscar }).first()).toBeVisible();
        await pausa(ad2.page, 3500);
      }
      await salir(ad2.page);
    });
    await r.cerrar(ad2);
  } finally {
    for (const t of r.tomas) if (!t.video) await r.cerrar(t).catch(() => {});
    r.guardar();
    servidor.close();
  }
  if (r.fallas.length) console.log(`[demo] Pasos con falla (quedaron rotulados en el video):\n${r.fallas.map((f) => `  - ${f.paso}: ${f.error}`).join("\n")}`);
});
