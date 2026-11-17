// npm run video:montar (y el final de npm run video:demo): une los videos de la demo en uno solo.
//
// Entrada: resultados/demo/linea-de-tiempo.json y los .webm de cada tramo (tests/demo/flujo-completo.demo.js).
// Salida:  resultados/Video_demo_V-Learning.mp4 (H.264, -preset veryfast) y resultados/Video_demo_V-Learning.srt.
//
// - Portada «V-Learning – Demostración de pruebas E2E» con la fecha (renderizada con Chromium).
// - Los tramos van en orden: administrador, instructor, estudiante y auditoría.
// - El rótulo grande de cada paso va siempre a velocidad normal. El cuerpo de los pasos marcados «rápido»
//   (armar cursos, test VARK…) se acelera con un mismo factor, calculado para que el video dure 5 min o
//   menos; el rótulo de esos pasos lleva «▶▶» y el .srt dice el factor.
// - Revisión de secretos: extrae 1 fotograma por segundo y corre scripts/detectar-otp.cjs con la caja del
//   título «Revisa tu código» que midió la demo; lista los fotogramas del OTP para revisarlos a ojo.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");

const RAIZ = path.resolve(__dirname, "..");
const DEMO = path.join(RAIZ, "resultados", "demo");
const SALIDA_MP4 = path.join(RAIZ, "resultados", "Video_demo_V-Learning.mp4");
const SALIDA_SRT = SALIDA_MP4.replace(/\.mp4$/, ".srt");
const MAX_S = 5 * 60 - 6; // margen bajo los 5 minutos
const PORTADA_S = 4;
const FPS = 30;
const COLA_MS = 600; // lo que se deja después del último paso de cada tramo

const tl = JSON.parse(fs.readFileSync(path.join(DEMO, "linea-de-tiempo.json"), "utf8"));
const tomas = tl.tomas.filter((t) => t.video && fs.existsSync(path.join(RAIZ, t.video)));
if (!tomas.length) throw new Error("No hay videos de la demo: corre primero npm run video:demo.");

// ------------------------------------------------------------------ Segmentos
// Cada segmento: { toma, ini, fin (ms del tramo), tipo: "normal" | "rapido" }.
const segs = [];
for (const [i, t] of tomas.entries()) {
  const add = (ini, fin, tipo) => { if (fin - ini > 40) segs.push({ toma: i, ini, fin, tipo }); };
  let cursor = 0;
  for (const p of t.pasos) {
    add(cursor, p.tIntro, "rapido"); // carga entre pasos
    add(p.tIntro, p.tCuerpo, "normal"); // rótulo grande
    // Cuerpo: rápido si el paso entero lo es o dentro de un tramo «acelerar» (tecleo, navegación);
    // la falla rotulada siempre a velocidad normal.
    const cortes = new Set([p.tCuerpo, p.tFin]);
    for (const r of p.rapidos ?? []) { cortes.add(Math.max(p.tCuerpo, r.ini)); cortes.add(Math.min(p.tFin, r.fin)); }
    if (p.tFalla !== undefined) cortes.add(p.tFalla);
    const puntos = [...cortes].filter((x) => x >= p.tCuerpo && x <= p.tFin).sort((a, b) => a - b);
    for (let k = 0; k < puntos.length - 1; k++) {
      const [a, b] = [puntos[k], puntos[k + 1]];
      const medio = (a + b) / 2;
      const falla = p.tFalla !== undefined && medio >= p.tFalla;
      const rap = !falla && (p.rapido || (p.rapidos ?? []).some((r) => medio >= r.ini && medio <= r.fin));
      add(a, b, rap ? "rapido" : "normal");
    }
    cursor = p.tFin;
  }
  add(cursor, Math.min(t.fin ?? cursor, cursor + COLA_MS), "normal");
}
const suma = (tipo) => segs.filter((s) => s.tipo === tipo).reduce((a, s) => a + (s.fin - s.ini) / 1000, 0);
const normal = suma("normal");
const rapido = suma("rapido");
// Factor de los tramos rápidos (de 0,5 en 0,5, mínimo 2). Si aun con 16× no alcanza, se acelera también
// lo normal (sin tocar los rótulos grandes), y se informa.
let F = 2;
while (PORTADA_S + normal + rapido / F > MAX_S && F < 16) F += 0.5;
let G = 1;
if (PORTADA_S + normal + rapido / F > MAX_S) {
  const rotulos = tomas.flatMap((t) => t.pasos).reduce((a, p) => a + (p.tCuerpo - p.tIntro) / 1000, 0);
  G = Math.ceil(((normal - rotulos) / (MAX_S - PORTADA_S - rapido / F - rotulos)) * 10) / 10;
}
const esRotulo = (s) => tomas[s.toma].pasos.some((p) => s.ini === p.tIntro && s.fin === p.tCuerpo);
for (const s of segs) s.vel = s.tipo === "rapido" ? F : esRotulo(s) ? 1 : G;

// Línea de tiempo de salida (segundos).
let reloj = PORTADA_S;
for (const s of segs) { s.salIni = reloj; reloj += (s.fin - s.ini) / 1000 / s.vel; s.salFin = reloj; }
const total = reloj;
const mapear = (toma, ms) => {
  const propios = segs.filter((s) => s.toma === toma);
  const s = propios.find((x) => ms >= x.ini && ms <= x.fin) ?? (ms < propios[0].ini ? propios[0] : propios.at(-1));
  const dentro = Math.min(Math.max(ms, s.ini), s.fin);
  return s.salIni + (dentro - s.ini) / 1000 / s.vel;
};

// ------------------------------------------------------------------ Portada
const fecha = new Date(tl.generado).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" });
async function portada(archivo) {
  const { chromium } = require("@playwright/test");
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.setContent(`<!doctype html><html lang="es"><body style="margin:0;width:1920px;height:1080px;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#0f2a4a,#1e4f8a);font-family:Arial,Helvetica,sans-serif;color:#fff">
    <div style="text-align:center;max-width:1500px">
      <div style="font-size:30px;letter-spacing:6px;color:#facc15;font-weight:700">VIDEO DEMOSTRATIVO</div>
      <h1 style="font-size:84px;margin:28px 0 24px">V-Learning – Demostración de pruebas E2E</h1>
      <div style="font-size:40px">${fecha}</div>
      <div style="font-size:30px;margin-top:48px;opacity:.9">Flujo principal por la interfaz: administrador, instructor, estudiante y auditoría</div>
      <div style="font-size:24px;margin-top:18px;opacity:.75">Playwright · base aislada vlearning_e2e · OTP, contraseñas temporales y tokens difuminados</div>
    </div></body></html>`);
  await p.screenshot({ path: archivo });
  await b.close();
}

// ------------------------------------------------------------------ SRT
const srtT = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
function srt() {
  const cues = [{ ini: 0, fin: PORTADA_S, texto: `V-Learning – Demostración de pruebas E2E\n${fecha}` }];
  for (const [i, t] of tomas.entries()) {
    for (const p of t.pasos) {
      const ini = mapear(i, p.tIntro);
      const finPaso = mapear(i, p.tFalla ?? p.tFin);
      cues.push({ ini, fin: finPaso, texto: p.texto + (p.rapido ? `\n(tramo acelerado ×${String(F).replace(".", ",")})` : "") });
      if (p.tFalla !== undefined) cues.push({ ini: finPaso, fin: mapear(i, p.tFin), texto: p.textoFalla });
    }
  }
  return cues.map((c, k) => `${k + 1}\n${srtT(c.ini)} --> ${srtT(Math.max(c.fin, c.ini + 0.5))}\n${c.texto}\n`).join("\n");
}

// ------------------------------------------------------------------ ffmpeg
function correr(args) {
  const r = spawnSync(ffmpeg, args, { encoding: "utf8", maxBuffer: 1e8 });
  if (r.status !== 0) throw new Error(`ffmpeg falló:\n${(r.stderr ?? "").split("\n").slice(-15).join("\n")}`);
  return r.stderr ?? "";
}
function duracion(archivo) {
  const e = spawnSync(ffmpeg, ["-i", archivo], { encoding: "utf8" }).stderr ?? "";
  const m = e.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

async function main() {
  const png = path.join(DEMO, "portada.png");
  await portada(png);
  const entradas = ["-loop", "1", "-framerate", String(FPS), "-t", String(PORTADA_S), "-i", png];
  for (const t of tomas) entradas.push("-i", path.join(RAIZ, t.video));
  const f = [`[0:v]scale=1920:1080,setsar=1,fps=${FPS},format=yuv420p,trim=duration=${PORTADA_S},setpts=PTS-STARTPTS,fade=t=out:st=${PORTADA_S - 0.5}:d=0.5[p]`];
  const etiquetas = ["[p]"];
  tomas.forEach((_, i) => {
    const propios = segs.filter((s) => s.toma === i);
    f.push(`[${i + 1}:v]split=${propios.length}${propios.map((_, k) => `[t${i}_${k}]`).join("")}`);
    propios.forEach((s, k) => {
      const e = `[s${i}_${k}]`;
      f.push(`[t${i}_${k}]trim=start=${(s.ini / 1000).toFixed(3)}:end=${(s.fin / 1000).toFixed(3)},setpts=(PTS-STARTPTS)/${s.vel},fps=${FPS},scale=1920:1080,setsar=1,format=yuv420p${e}`);
      etiquetas.push(e);
    });
  });
  f.push(`${etiquetas.join("")}concat=n=${etiquetas.length}:v=1:a=0[v]`);
  const guion = path.join(DEMO, "filtro.txt");
  fs.writeFileSync(guion, f.join(";\n"));
  console.log(`[montaje] ${tomas.length} tramos, ${segs.length} segmentos; normal ${normal.toFixed(0)} s, rápido ${rapido.toFixed(0)} s → ×${F}${G > 1 ? `, resto ×${G}` : ""}; estimado ${total.toFixed(1)} s`);
  correr(["-y", "-loglevel", "error", ...entradas, "-filter_complex_script", guion, "-map", "[v]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart", SALIDA_MP4]);
  fs.writeFileSync(SALIDA_SRT, srt());
  const dur = duracion(SALIDA_MP4);

  // Revisión de secretos sobre fotogramas de muestra (1 por segundo).
  const fotos = path.join(DEMO, "fotogramas");
  fs.rmSync(fotos, { recursive: true, force: true });
  fs.mkdirSync(fotos, { recursive: true });
  correr(["-y", "-loglevel", "error", "-i", SALIDA_MP4, "-vf", "fps=1", path.join(fotos, "f_%04d.png")]);
  const lista = fs.readdirSync(fotos).filter((x) => x.endsWith(".png")).map((x) => path.join(fotos, x));
  fs.writeFileSync(path.join(DEMO, "fotogramas.txt"), lista.join("\n"));
  const otp = [];
  for (const [i, t] of tomas.entries()) {
    for (const [k, o] of (t.otp ?? []).entries()) {
      if (!o.titulo) continue;
      const ref = path.join(DEMO, `otp-ref-${i + 1}-${k + 1}.png`);
      correr(["-y", "-loglevel", "error", "-ss", (mapear(i, o.t) + 0.6).toFixed(2), "-i", SALIDA_MP4, "-frames:v", "1", ref]);
      const zona = [o.titulo.x, o.titulo.y, Math.max(o.titulo.w, 40), o.titulo.h].join(",");
      const sal = execFileSync(process.execPath, [path.join(RAIZ, "scripts", "detectar-otp.cjs"), RAIZ, ref, path.join(DEMO, "fotogramas.txt"), zona], { encoding: "utf8" });
      for (const l of sal.split(/\r?\n/).filter(Boolean)) otp.push({ tramo: t.rol, fotograma: path.relative(RAIZ, l.split(" ").slice(1).join(" ")), dif: Number(l.split(" ")[0]) });
    }
  }
  const resumen = {
    generado: new Date().toISOString(), salida: path.relative(RAIZ, SALIDA_MP4), srt: path.relative(RAIZ, SALIDA_SRT),
    duracionS: dur, factorRapido: F, factorResto: G, pasos: tomas.flatMap((t) => t.pasos.map((p) => ({ n: p.n, texto: p.texto, rapido: p.rapido, error: p.error }))),
    fallas: tl.fallas, fotogramasRevisados: lista.length, fotogramasOtp: otp,
  };
  fs.writeFileSync(path.join(DEMO, "montaje.json"), JSON.stringify(resumen, null, 2));
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  console.log(`[montaje] Video: ${resumen.salida} (${dur ? mmss(dur) : "?"}) · Subtítulos: ${resumen.srt}`);
  console.log(`[montaje] Fotogramas revisados: ${lista.length}; con la pantalla del OTP: ${otp.length} (revisarlos a ojo: ${[...new Set(otp.map((o) => path.basename(o.fotograma)))].join(", ") || "ninguno"})`);
  if (tl.fallas?.length) console.log(`[montaje] Pasos con falla rotulada: ${tl.fallas.map((x) => x.paso.split(".")[0]).join(", ")}`);
  if (dur && dur > 300) { console.error("[montaje] El video supera los 5 minutos."); process.exitCode = 1; }
}
main().catch((e) => { console.error(e); process.exit(1); });
