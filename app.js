/* =========================================================
   Panel FESICOL · Musicala — app.js (Firestore)
   Fase 1: fundación (ciclos, estudiantes, inscripciones,
   facturación, tarifas, resumen con KPIs reales).
========================================================= */

import { initFirebase } from "./firebase.js";
import * as DB from "./db.js";
import { formatCOP, parsePrice } from "./db.js";

const firebaseConfig = {
  apiKey: "AIzaSyBoZuK8koOeOhl2nBrqyUoEznpkqnnrTbs",
  authDomain: "manager-fesicol.firebaseapp.com",
  projectId: "manager-fesicol",
  storageBucket: "manager-fesicol.firebasestorage.app",
  messagingSenderId: "501861978891",
  appId: "1:501861978891:web:83eda7b8358121f23f880e"
};

const fb = initFirebase(firebaseConfig, { persistence: "local", debug: true });
const { auth, db, storage, onAuthStateChanged, signInWithEmailAndPassword, signOut, signInWithGoogle, consumeRedirectResult, prettyAuthError } = fb;
DB.initDb(db, storage);

/* -------- Roles -------- */
const ADMIN_EMAILS = [
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com",
  "imusicala@gmail.com",
  "musicalaasesor@gmail.com"
];
const isAdminEmail = (email) => ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase());
const isAdmin = () => state.role === "admin";

/* -------- DOM helpers -------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* -------- UI base -------- */
const loaderEl = $("#globalLoader");
const toastHost = $("#toastHost");
const authView = $("#authView");
const appView = $("#appView");
const content = $("#dashContent");
const modal = $("#modal");
const modalBody = $("#modalBody");

const state = {
  view: "resumen",
  booted: false,
  role: "lector",
  user: null,
  ciclos: [],
  estudiantes: [],
  inscripciones: [],
  facturas: [],
  tarifas: [],
  usuarios: []
};

/** Devuelve "" si el usuario no puede escribir (oculta botones de acción). */
function adminOnly(html) { return isAdmin() ? html : ""; }

/* -------- Utils UI -------- */
function setLoading(on, msg = "Cargando…") {
  if (!loaderEl) return;
  loaderEl.hidden = !on;
  const t = loaderEl.querySelector(".loader-text");
  if (t) t.textContent = msg;
}
function toast(message, type = "info", ttl = 3200) {
  if (!toastHost || !message) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = String(message);
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 250); }, ttl);
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function monthISO() { return new Date().toISOString().slice(0, 7); }

function openModal(title, html) {
  $("#modalTitle").textContent = title;
  modalBody.innerHTML = html;
  if (typeof modal.showModal === "function" && !modal.open) modal.showModal();
}
function closeModal() { if (modal.open) modal.close(); }
$("#closeModal")?.addEventListener("click", closeModal);
modal?.addEventListener("click", (e) => {
  const r = modal.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!inside) closeModal();
});

/* =========================================================
   Fase 3 · Helpers (gráficas SVG, fechas, exportar Excel)
========================================================= */
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function mesLabel(ym) {
  const [y, m] = String(ym || "").split("-");
  return m ? `${MESES[Number(m) - 1] || m} ${String(y).slice(2)}` : "—";
}
function diasHasta(fechaISO) {
  if (!fechaISO) return null;
  return Math.ceil((new Date(fechaISO) - new Date(todayISO())) / 86400000);
}

/** Gráfica de barras vertical en SVG. data = [{label, value}] */
function barChart(data, { height = 200, color = "var(--primary)", money = true } = {}) {
  if (!data.length) return `<p class="muted">Sin datos para graficar.</p>`;
  const max = Math.max(...data.map((d) => d.value), 1);
  const bw = 100 / data.length;
  const bars = data.map((d, i) => {
    const h = (d.value / max) * 78;
    const x = i * bw;
    return `
      <g>
        <rect x="${(x + bw * 0.15).toFixed(2)}" y="${(82 - h).toFixed(2)}" width="${(bw * 0.7).toFixed(2)}" height="${h.toFixed(2)}"
              rx="1.4" fill="${color}"><title>${esc(d.label)}: ${money ? formatCOP(d.value) : d.value}</title></rect>
        <text x="${(x + bw / 2).toFixed(2)}" y="96" font-size="3.4" text-anchor="middle" fill="var(--muted)">${esc(d.label)}</text>
        ${d.value ? `<text x="${(x + bw / 2).toFixed(2)}" y="${(80 - h).toFixed(2)}" font-size="3" text-anchor="middle" fill="var(--text-soft)">${money ? "$" + (d.value / 1000).toFixed(0) + "k" : d.value}</text>` : ""}
      </g>`;
  }).join("");
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:${height}px" role="img">${bars}</svg>`;
}

/** Exporta filas (array de objetos) a un .xlsx descargable. */
async function exportToExcel(rows, filename, sheetName = "Datos") {
  if (!rows.length) { toast("No hay datos para exportar.", "info"); return; }
  setLoading(true, "Generando Excel…");
  try {
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
    toast("Excel generado ✅", "success");
  } catch (e) {
    console.error(e); toast("Error generando Excel: " + (e?.message || e), "error", 5000);
  } finally { setLoading(false); }
}

/* =========================================================
   SEED inicial (tarifas + ciclos) la primera vez
========================================================= */
async function ensureSeed() {
  try {
    if ((await DB.tarifasCount()) === 0) {
      const res = await fetch("fesicol.json", { cache: "no-store" });
      const data = await res.json();
      const precios = data?.actions?.find((a) => a.id === "precios_2026");
      const rows = precios?.action?.rows || [];
      if (rows.length) {
        await DB.seedTarifas(rows);
        toast(`Tarifas 2026 cargadas (${rows.length}) ✅`, "success");
      }
    }
    if ((await DB.ciclosCount()) === 0) {
      await DB.seedCiclos(defaultCiclos());
      toast("Ciclos iniciales creados ✅", "success");
    }
  } catch (e) {
    console.warn("Seed:", e);
  }
}

function defaultCiclos() {
  // Estructura base editable desde la sección Ciclos.
  return [
    { nombre: "Ciclo 1", fechaLimiteInscripcion: "2026-02-15", fechaInicioClases: "2026-02-20", estado: "abierto" },
    { nombre: "Ciclo 2", fechaLimiteInscripcion: "2026-04-15", fechaInicioClases: "2026-04-20", estado: "planeado" },
    { nombre: "Ciclo 3", fechaLimiteInscripcion: "2026-06-15", fechaInicioClases: "2026-06-20", estado: "planeado" },
    { nombre: "Ciclo 4", fechaLimiteInscripcion: "2026-08-15", fechaInicioClases: "2026-08-20", estado: "planeado" },
    { nombre: "Ciclo 5", fechaLimiteInscripcion: "2026-10-15", fechaInicioClases: "2026-10-20", estado: "planeado" }
  ];
}

/* =========================================================
   Carga de datos
========================================================= */
async function loadAll() {
  const [ciclos, estudiantes, inscripciones, facturas, tarifas] = await Promise.all([
    DB.getCiclos(), DB.getEstudiantes(), DB.getInscripciones(), DB.getFacturas(), DB.getTarifas()
  ]);
  Object.assign(state, { ciclos, estudiantes, inscripciones, facturas, tarifas });
}

function cicloNombre(id) {
  return state.ciclos.find((c) => c.id === id)?.nombre || "—";
}
function estudianteNombre(id) {
  return state.estudiantes.find((e) => e.id === id)?.nombre || "—";
}

/* =========================================================
   ROUTER
========================================================= */
const views = {
  resumen: { title: "Resumen", subtitle: "Estado general del convenio", render: renderResumen },
  ciclos: { title: "Ciclos y fechas", subtitle: "Fechas de inscripción por ciclo", render: renderCiclos },
  estudiantes: { title: "Estudiantes", subtitle: "Historial y seguimiento", render: renderEstudiantes },
  inscripciones: { title: "Inscripciones", subtitle: "Registro por ciclo", render: renderInscripciones },
  planilla: { title: "Importar planilla", subtitle: "Carga masiva desde el Excel de FESICOL", render: renderPlanilla, admin: true },
  facturacion: { title: "Facturación", subtitle: "Facturas, cuentas de cobro y soportes", render: renderFacturacion },
  tarifas: { title: "Tarifas 2026", subtitle: "Precios del convenio", render: renderTarifas },
  usuarios: { title: "Usuarios", subtitle: "Quién puede acceder al panel", render: renderUsuarios, admin: true }
};

async function navigate(view) {
  if (!views[view]) view = "resumen";
  if (views[view].admin && !isAdmin()) view = "resumen";
  state.view = view;
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#viewTitle").textContent = views[view].title;
  $("#viewSubtitle").textContent = views[view].subtitle;
  $("#topbarActions").innerHTML = "";
  $("#sidebar")?.classList.remove("open");
  content.innerHTML = `<div class="muted" style="padding:24px">Cargando…</div>`;
  await views[view].render();
}

/* ---------- RESUMEN ---------- */
async function renderResumen() {
  const ins = state.inscripciones;
  const ingresosTotal = ins.reduce((a, b) => a + (b.precio || 0), 0);
  const mes = monthISO();
  const ingresosMes = ins.filter((i) => (i.mes || "").startsWith(mes)).reduce((a, b) => a + (b.precio || 0), 0);
  const activos = state.estudiantes.filter((e) => e.activo !== false).length;

  // Próxima fecha límite de inscripción
  const hoy = todayISO();
  const prox = state.ciclos
    .filter((c) => c.fechaLimiteInscripcion && c.fechaLimiteInscripcion >= hoy)
    .sort((a, b) => a.fechaLimiteInscripcion.localeCompare(b.fechaLimiteInscripcion))[0];
  const diasRestantes = prox ? Math.ceil((new Date(prox.fechaLimiteInscripcion) - new Date(hoy)) / 86400000) : null;

  const kpis = [
    { icon: "💰", label: "Ingresos totales", value: formatCOP(ingresosTotal) },
    { icon: "📆", label: `Ingresos ${mes}`, value: formatCOP(ingresosMes) },
    { icon: "👥", label: "Estudiantes activos", value: activos },
    { icon: "📝", label: "Inscripciones", value: ins.length }
  ];

  // Alertas: ciclos cuya fecha límite cae dentro de los próximos 30 días
  const proximos = state.ciclos
    .filter((c) => { const d = diasHasta(c.fechaLimiteInscripcion); return d !== null && d >= 0 && d <= 30; })
    .sort((a, b) => a.fechaLimiteInscripcion.localeCompare(b.fechaLimiteInscripcion));
  const alerta = proximos.length
    ? proximos.map((c) => {
        const d = diasHasta(c.fechaLimiteInscripcion);
        return `<div class="alert ${d <= 7 ? "warn" : "info"}">
          <strong>⏰ ${esc(c.nombre)}:</strong> cierre de inscripción ${esc(c.fechaLimiteInscripcion)}
          — ${d === 0 ? "¡hoy!" : `faltan ${d} día${d === 1 ? "" : "s"}`}</div>`;
      }).join("")
    : `<div class="alert info">No hay fechas de inscripción en los próximos 30 días. Revísalas en <b>Ciclos y fechas</b>.</div>`;

  // Ingresos por mes (últimos 6 meses con datos)
  const ingresosPorMes = {};
  ins.forEach((i) => { if (i.mes) ingresosPorMes[i.mes] = (ingresosPorMes[i.mes] || 0) + (i.precio || 0); });
  const chartData = Object.keys(ingresosPorMes).sort().slice(-6)
    .map((ym) => ({ label: mesLabel(ym), value: ingresosPorMes[ym] }));

  // Calendario de ciclos
  const timeline = state.ciclos
    .slice().sort((a, b) => String(a.fechaLimiteInscripcion).localeCompare(String(b.fechaLimiteInscripcion)))
    .map((c) => {
      const d = diasHasta(c.fechaLimiteInscripcion);
      const cls = d === null ? "gray" : d < 0 ? "gray" : d <= 7 ? "warn" : "green";
      const insN = ins.filter((i) => i.cicloId === c.id).length;
      return `<div class="tl-item">
        <div class="tl-dot ${cls}"></div>
        <div class="tl-body">
          <strong>${esc(c.nombre)}</strong>
          <span class="muted sm">Cierre: ${esc(c.fechaLimiteInscripcion || "—")} · Inicio: ${esc(c.fechaInicioClases || "—")}</span>
          <span class="muted sm">${insN} inscrito(s) ${d !== null && d >= 0 ? `· faltan ${d}d` : d !== null ? "· cerrado" : ""}</span>
        </div></div>`;
    }).join("") || `<p class="muted">Sin ciclos.</p>`;

  // Inscripciones por modalidad
  const porMod = {};
  ins.forEach((i) => { const m = i.modalidad || "Sin modalidad"; porMod[m] = (porMod[m] || 0) + 1; });
  const modRows = Object.entries(porMod).sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `<tr><td>${esc(m)}</td><td>${n}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">Sin datos aún.</td></tr>`;

  // Últimas inscripciones
  const ultimas = ins.slice(0, 6).map((i) => `
    <tr><td>${esc(estudianteNombre(i.estudianteId) || i.estudianteNombre || "—")}</td>
        <td>${esc(cicloNombre(i.cicloId))}</td>
        <td>${esc(i.modalidad || "—")}</td>
        <td>${formatCOP(i.precio)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Aún no hay inscripciones.</td></tr>`;

  content.innerHTML = `
    ${alerta}
    <div class="kpis">
      ${kpis.map((k) => `<div class="kpi"><div class="kpi-icon">${k.icon}</div><div class="kpi-value">${k.value}</div><div class="kpi-label">${k.label}</div></div>`).join("")}
    </div>
    <div class="grid-2 gap">
      <section class="panel">
        <h3>Ingresos por mes</h3>
        ${barChart(chartData)}
      </section>
      <section class="panel">
        <h3>Calendario de ciclos</h3>
        <div class="timeline">${timeline}</div>
      </section>
    </div>
    <div class="grid-2 gap">
      <section class="panel">
        <h3>Inscripciones por modalidad</h3>
        <table class="data-table"><thead><tr><th>Modalidad</th><th>#</th></tr></thead><tbody>${modRows}</tbody></table>
      </section>
      <section class="panel">
        <h3>Últimas inscripciones</h3>
        <table class="data-table"><thead><tr><th>Estudiante</th><th>Ciclo</th><th>Modalidad</th><th>Precio</th></tr></thead><tbody>${ultimas}</tbody></table>
      </section>
    </div>`;
}

/* ---------- CICLOS ---------- */
async function renderCiclos() {
  $("#topbarActions").innerHTML = adminOnly(`<button class="btn primary sm" id="addCiclo">+ Nuevo ciclo</button>`);
  $("#addCiclo") && ($("#addCiclo").onclick = () => formCiclo());

  const hoy = todayISO();
  const rows = state.ciclos.map((c) => {
    const insN = state.inscripciones.filter((i) => i.cicloId === c.id).length;
    const vencido = c.fechaLimiteInscripcion && c.fechaLimiteInscripcion < hoy;
    return `<tr>
      <td><strong>${esc(c.nombre)}</strong></td>
      <td>${esc(c.fechaLimiteInscripcion || "—")} ${vencido ? '<span class="pill gray">cerrado</span>' : ""}</td>
      <td>${esc(c.fechaInicioClases || "—")}</td>
      <td><span class="pill ${c.estado === "abierto" ? "green" : "blue"}">${esc(c.estado || "—")}</span></td>
      <td>${insN}</td>
      <td class="row-actions">${adminOnly(`
        <button class="link-btn" data-edit="${c.id}">Editar</button>
        <button class="link-btn danger" data-del="${c.id}">Eliminar</button>`)}
      </td></tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">Sin ciclos. Crea el primero.</td></tr>`;

  content.innerHTML = `<section class="panel"><table class="data-table">
    <thead><tr><th>Ciclo</th><th>Límite inscripción</th><th>Inicio clases</th><th>Estado</th><th>Inscritos</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></section>`;

  content.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
    formCiclo(state.ciclos.find((c) => c.id === b.dataset.edit));
  });
  content.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("¿Eliminar este ciclo?")) return;
    await DB.deleteCiclo(b.dataset.del);
    await refresh();
  });
}

function formCiclo(c = null) {
  openModal(c ? "Editar ciclo" : "Nuevo ciclo", `
    <form id="f" class="form">
      <label class="field"><span>Nombre</span><input name="nombre" value="${esc(c?.nombre || "")}" required></label>
      <div class="grid-2">
        <label class="field"><span>Límite de inscripción</span><input name="fechaLimiteInscripcion" type="date" value="${esc(c?.fechaLimiteInscripcion || "")}"></label>
        <label class="field"><span>Inicio de clases</span><input name="fechaInicioClases" type="date" value="${esc(c?.fechaInicioClases || "")}"></label>
      </div>
      <label class="field"><span>Estado</span>
        <select name="estado">
          ${["planeado", "abierto", "cerrado"].map((s) => `<option ${c?.estado === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </label>
      <div class="form-row"><button class="btn primary" type="submit">Guardar</button></div>
    </form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (!c) fd.orden = state.ciclos.length + 1;
    await DB.saveCiclo(fd, c?.id || null);
    closeModal(); await refresh();
    toast("Ciclo guardado ✅", "success");
  };
}

/* ---------- ESTUDIANTES ---------- */
async function renderEstudiantes() {
  $("#topbarActions").innerHTML = `<input id="qEst" class="search" placeholder="Buscar…"><button class="btn secondary sm" id="expEst">⬇ Excel</button>` + adminOnly(`<button class="btn primary sm" id="addEst">+ Estudiante</button>`);
  $("#addEst") && ($("#addEst").onclick = () => formEstudiante());
  $("#expEst").onclick = () => exportToExcel(state.estudiantes.map((e) => ({
    Estudiante: e.nombre, Edad: e.edad ?? "", Asociado: e.asociadoNombre ?? "", "Documento asociado": e.asociadoDocumento ?? "",
    Parentesco: e.parentesco ?? "", Telefono: e.telefono ?? "", Estado: e.activo === false ? "inactivo" : "activo",
    Inscripciones: state.inscripciones.filter((i) => i.estudianteId === e.id).length
  })), "estudiantes-fesicol.xlsx", "Estudiantes");

  const draw = (q = "") => {
    const list = state.estudiantes.filter((e) => !q || (e.nombre || "").toLowerCase().includes(q) || (e.asociadoNombre || "").toLowerCase().includes(q));
    const rows = list.map((e) => {
      const insN = state.inscripciones.filter((i) => i.estudianteId === e.id).length;
      return `<tr>
        <td><strong>${esc(e.nombre)}</strong></td>
        <td>${esc(e.asociadoNombre || "—")}</td>
        <td>${esc(e.parentesco || "—")}</td>
        <td>${esc(e.telefono || "—")}</td>
        <td>${insN}</td>
        <td><span class="pill ${e.activo === false ? "gray" : "green"}">${e.activo === false ? "inactivo" : "activo"}</span></td>
        <td class="row-actions">
          <button class="link-btn" data-hist="${e.id}">Historial</button>${adminOnly(`
          <button class="link-btn" data-edit="${e.id}">Editar</button>
          <button class="link-btn danger" data-del="${e.id}">Eliminar</button>`)}
        </td></tr>`;
    }).join("") || `<tr><td colspan="7" class="muted">Sin estudiantes.</td></tr>`;
    content.innerHTML = `<section class="panel"><table class="data-table">
      <thead><tr><th>Estudiante</th><th>Asociado</th><th>Parentesco</th><th>Teléfono</th><th>Inscrip.</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></section>`;
    content.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => formEstudiante(state.estudiantes.find((x) => x.id === b.dataset.edit)));
    content.querySelectorAll("[data-hist]").forEach((b) => b.onclick = () => verHistorial(b.dataset.hist));
    content.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (!confirm("¿Eliminar estudiante?")) return;
      await DB.deleteEstudiante(b.dataset.del); await refresh();
    });
  };
  draw();
  $("#qEst").oninput = (e) => draw(e.target.value.trim().toLowerCase());
}

function formEstudiante(s = null) {
  openModal(s ? "Editar estudiante" : "Nuevo estudiante", `
    <form id="f" class="form">
      <div class="grid-2">
        <label class="field"><span>Nombre del inscrito</span><input name="nombre" value="${esc(s?.nombre || "")}" required></label>
        <label class="field"><span>Edad</span><input name="edad" type="number" value="${esc(s?.edad || "")}"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Nombre del asociado</span><input name="asociadoNombre" value="${esc(s?.asociadoNombre || "")}"></label>
        <label class="field"><span>Documento asociado</span><input name="asociadoDocumento" value="${esc(s?.asociadoDocumento || "")}"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Parentesco</span><input name="parentesco" placeholder="Hijo/a, cónyuge… (vacío si es el asociado)" value="${esc(s?.parentesco || "")}"></label>
        <label class="field"><span>Teléfono</span><input name="telefono" value="${esc(s?.telefono || "")}"></label>
      </div>
      <label class="field"><span>Estado</span>
        <select name="activo">
          <option value="true" ${s?.activo !== false ? "selected" : ""}>Activo</option>
          <option value="false" ${s?.activo === false ? "selected" : ""}>Inactivo</option>
        </select>
      </label>
      <div class="form-row"><button class="btn primary" type="submit">Guardar</button></div>
    </form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.activo = fd.activo === "true";
    fd.edad = fd.edad ? Number(fd.edad) : null;
    await DB.saveEstudiante(fd, s?.id || null);
    closeModal(); await refresh();
    toast("Estudiante guardado ✅", "success");
  };
}

async function verHistorial(estId) {
  const est = state.estudiantes.find((e) => e.id === estId);
  const ins = state.inscripciones.filter((i) => i.estudianteId === estId);
  const rows = ins.map((i) => `<tr><td>${esc(cicloNombre(i.cicloId))}</td><td>${esc(i.mes || "—")}</td><td>${esc(i.modalidad || "—")}</td><td>${esc(i.duracion || "—")}</td><td>${formatCOP(i.precio)}</td><td>${esc(i.estado || "—")}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Sin inscripciones registradas.</td></tr>`;
  const total = ins.reduce((a, b) => a + (b.precio || 0), 0);
  openModal(`Historial · ${est?.nombre || ""}`, `
    <table class="data-table"><thead><tr><th>Ciclo</th><th>Mes</th><th>Modalidad</th><th>Duración</th><th>Precio</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="margin-top:12px"><strong>Total facturado a este estudiante:</strong> ${formatCOP(total)}</p>`);
}

/* ---------- INSCRIPCIONES ---------- */
async function renderInscripciones() {
  $("#topbarActions").innerHTML = `<button class="btn secondary sm" id="expIns">⬇ Excel</button>` + adminOnly(`<button class="btn primary sm" id="addIns">+ Inscripción</button>`);
  $("#addIns") && ($("#addIns").onclick = () => formInscripcion());
  $("#expIns").onclick = () => exportToExcel(state.inscripciones.map((i) => ({
    Estudiante: estudianteNombre(i.estudianteId) || i.estudianteNombre || "", Ciclo: cicloNombre(i.cicloId), Mes: i.mes ?? "",
    Servicio: i.servicio ?? "", Modalidad: i.modalidad ?? "", Duracion: i.duracion ?? "", Precio: i.precio ?? 0, Estado: i.estado ?? ""
  })), "inscripciones-fesicol.xlsx", "Inscripciones");

  const rows = state.inscripciones.map((i) => `<tr>
      <td><strong>${esc(estudianteNombre(i.estudianteId) || i.estudianteNombre || "—")}</strong></td>
      <td>${esc(cicloNombre(i.cicloId))}</td>
      <td>${esc(i.mes || "—")}</td>
      <td>${esc(i.modalidad || "—")}</td>
      <td>${esc(i.duracion || "—")}</td>
      <td>${formatCOP(i.precio)}</td>
      <td><span class="pill blue">${esc(i.estado || "—")}</span></td>
      <td class="row-actions">${adminOnly(`
        <button class="link-btn" data-edit="${i.id}">Editar</button>
        <button class="link-btn danger" data-del="${i.id}">Eliminar</button>`)}
      </td></tr>`).join("") || `<tr><td colspan="8" class="muted">Sin inscripciones.</td></tr>`;

  content.innerHTML = `<section class="panel"><table class="data-table">
    <thead><tr><th>Estudiante</th><th>Ciclo</th><th>Mes</th><th>Modalidad</th><th>Duración</th><th>Precio</th><th>Estado</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></section>`;
  content.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => formInscripcion(state.inscripciones.find((x) => x.id === b.dataset.edit)));
  content.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("¿Eliminar inscripción?")) return;
    await DB.deleteInscripcion(b.dataset.del); await refresh();
  });
}

function formInscripcion(i = null) {
  const estOpts = state.estudiantes.map((e) => `<option value="${e.id}" ${i?.estudianteId === e.id ? "selected" : ""}>${esc(e.nombre)}</option>`).join("");
  const cicloOpts = state.ciclos.map((c) => `<option value="${c.id}" ${i?.cicloId === c.id ? "selected" : ""}>${esc(c.nombre)}</option>`).join("");
  const tarifaOpts = state.tarifas.map((t) => `<option value="${t.precio}" ${i?.servicio === t.servicio ? "selected" : ""} data-serv="${esc(t.servicio)}">${esc(t.servicio)} — ${formatCOP(t.precio)}</option>`).join("");
  openModal(i ? "Editar inscripción" : "Nueva inscripción", `
    <form id="f" class="form">
      <div class="grid-2">
        <label class="field"><span>Estudiante</span><select name="estudianteId" required><option value="">Selecciona…</option>${estOpts}</select></label>
        <label class="field"><span>Ciclo</span><select name="cicloId" required><option value="">Selecciona…</option>${cicloOpts}</select></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Mes</span><input name="mes" type="month" value="${esc(i?.mes || monthISO())}"></label>
        <label class="field"><span>Servicio / Tarifa</span><select name="servicio" id="servSel"><option value="">Selecciona…</option>${tarifaOpts}</select></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Modalidad</span><input name="modalidad" value="${esc(i?.modalidad || "")}"></label>
        <label class="field"><span>Duración</span><input name="duracion" value="${esc(i?.duracion || "")}"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Precio (COP)</span><input name="precio" id="precioInp" type="text" value="${i?.precio ? i.precio : ""}"></label>
        <label class="field"><span>Estado</span>
          <select name="estado">${["Inscrito", "Activo", "Facturado", "Pagado", "Retirado"].map((s) => `<option ${i?.estado === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </label>
      </div>
      <div class="form-row"><button class="btn primary" type="submit">Guardar</button></div>
    </form>`);
  const servSel = $("#servSel");
  servSel.onchange = () => {
    const opt = servSel.selectedOptions[0];
    if (opt?.value) {
      $("#precioInp").value = opt.value;
      const serv = opt.dataset.serv || "";
      // Intenta derivar modalidad/duración del nombre del servicio
      const f = $("#f");
      if (!f.modalidad.value) f.modalidad.value = serv.split(" Paquete")[0].split(" 1 mes")[0];
    }
  };
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.precio = parsePrice(fd.precio);
    fd.estudianteNombre = estudianteNombre(fd.estudianteId);
    await DB.saveInscripcion(fd, i?.id || null);
    closeModal(); await refresh();
    toast("Inscripción guardada ✅", "success");
  };
}

/* ---------- FACTURACIÓN ---------- */
async function renderFacturacion() {
  $("#topbarActions").innerHTML = `<button class="btn secondary sm" id="expFac">⬇ Excel</button>` + adminOnly(`<button class="btn primary sm" id="addFac">+ Documento</button>`);
  $("#addFac") && ($("#addFac").onclick = () => formFactura());
  $("#expFac").onclick = () => exportToExcel(state.facturas.map((f) => ({
    Documento: f.nombre ?? "", Tipo: f.tipo ?? "", Periodo: f.periodo ?? "", Valor: f.valor ?? 0,
    Estado: f.estado ?? "", Responsable: f.responsable ?? "", Nota: f.nota ?? "", Archivo: f.archivoUrl ?? ""
  })), "facturacion-fesicol.xlsx", "Facturacion");

  const total = state.facturas.reduce((a, b) => a + (b.valor || 0), 0);
  const rows = state.facturas.map((f) => `<tr>
      <td>${f.archivoUrl ? `<a href="${esc(f.archivoUrl)}" target="_blank" rel="noopener">${esc(f.nombre || "Documento")}</a>` : esc(f.nombre || "—")}</td>
      <td>${esc(f.tipo || "—")}</td>
      <td>${esc(f.periodo || "—")}</td>
      <td>${formatCOP(f.valor)}</td>
      <td><span class="pill blue">${esc(f.estado || "—")}</span></td>
      <td class="row-actions">${adminOnly(`
        <button class="link-btn" data-edit="${f.id}">Editar</button>
        <button class="link-btn danger" data-del="${f.id}">Eliminar</button>`)}
      </td></tr>`).join("") || `<tr><td colspan="6" class="muted">Sin documentos.</td></tr>`;

  content.innerHTML = `
    <div class="alert info"><strong>Total facturado registrado:</strong> ${formatCOP(total)}</div>
    <section class="panel"><table class="data-table">
    <thead><tr><th>Documento</th><th>Tipo</th><th>Periodo</th><th>Valor</th><th>Estado</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></section>`;
  content.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => formFactura(state.facturas.find((x) => x.id === b.dataset.edit)));
  content.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("¿Eliminar documento?")) return;
    const f = state.facturas.find((x) => x.id === b.dataset.del);
    if (f?.archivoPath) await DB.deleteArchivo(f.archivoPath);
    await DB.deleteFactura(b.dataset.del); await refresh();
  });
}

function formFactura(f = null) {
  openModal(f ? "Editar documento" : "Nuevo documento", `
    <form id="f" class="form">
      <div class="grid-2">
        <label class="field"><span>Nombre del documento</span><input name="nombre" value="${esc(f?.nombre || "")}" placeholder="Ej: Cuenta de cobro junio" required></label>
        <label class="field"><span>Periodo</span><input name="periodo" type="month" value="${esc(f?.periodo || monthISO())}"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Tipo</span>
          <select name="tipo">${["Factura", "Cuenta de cobro", "Contrato", "Soporte de asistencia", "Otro"].map((s) => `<option ${f?.tipo === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </label>
        <label class="field"><span>Estado</span>
          <select name="estado">${["Pendiente", "En revisión", "Aprobado", "Firmado", "Radicado", "Pagado"].map((s) => `<option ${f?.estado === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Valor (COP)</span><input name="valor" value="${f?.valor || ""}"></label>
        <label class="field"><span>Responsable</span><input name="responsable" value="${esc(f?.responsable || "")}"></label>
      </div>
      <label class="field"><span>Archivo adjunto</span><input name="archivo" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx"></label>
      ${f?.archivoUrl ? `<small class="muted">Actual: <a href="${esc(f.archivoUrl)}" target="_blank">${esc(f.nombre || "ver")}</a></small>` : ""}
      <label class="field"><span>Nota</span><textarea name="nota" rows="3">${esc(f?.nota || "")}</textarea></label>
      <div class="form-row"><button class="btn primary" type="submit">Guardar</button></div>
    </form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = Object.fromEntries(new FormData(form));
    const file = form.archivo.files[0];
    delete fd.archivo;
    fd.valor = parsePrice(fd.valor);
    try {
      setLoading(true, "Guardando…");
      if (file) {
        const up = await DB.uploadArchivo(file, "facturacion");
        fd.archivoUrl = up.url; fd.archivoPath = up.path;
      } else if (f) {
        fd.archivoUrl = f.archivoUrl || ""; fd.archivoPath = f.archivoPath || "";
      }
      await DB.saveFactura(fd, f?.id || null);
      closeModal(); await refresh();
      toast("Documento guardado ✅", "success");
    } catch (err) {
      console.error(err); toast("Error: " + (err?.message || err), "error", 5000);
    } finally { setLoading(false); }
  };
}

/* ---------- TARIFAS ---------- */
async function renderTarifas() {
  $("#topbarActions").innerHTML = `<input id="qTar" class="search" placeholder="Buscar servicio…">`;
  const draw = (q = "") => {
    const list = state.tarifas.filter((t) => !q || (t.servicio || "").toLowerCase().includes(q));
    const rows = list.map((t) => `<tr><td>${esc(t.servicio)}</td><td>${formatCOP(t.precio)}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">Sin resultados.</td></tr>`;
    content.innerHTML = `<section class="panel"><p class="muted sm">Música, danza, teatro y artes plásticas. Tarifas 2026 del convenio.</p>
      <table class="data-table"><thead><tr><th>Servicio</th><th>Precio</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    $("#qTar").oninput = (e) => draw(e.target.value.trim().toLowerCase());
    $("#qTar").value = q;
    if (q) $("#qTar").focus();
  };
  draw();
}

/* ---------- USUARIOS (gestión de acceso) ---------- */
async function renderUsuarios() {
  state.usuarios = await DB.getUsuarios();
  $("#topbarActions").innerHTML = `<button class="btn primary sm" id="addUsr">+ Agregar usuario</button>`;
  $("#addUsr").onclick = () => formUsuario();

  const adminRows = ADMIN_EMAILS.map((e) =>
    `<tr><td>${esc(e)}</td><td><span class="pill blue">admin</span></td><td class="muted sm">fijo</td></tr>`).join("");
  const lectorRows = state.usuarios
    .filter((u) => !ADMIN_EMAILS.includes(u.email))
    .map((u) => `<tr>
      <td>${esc(u.email)}${u.nombre ? ` <span class="muted">· ${esc(u.nombre)}</span>` : ""}</td>
      <td><span class="pill ${u.role === "admin" ? "blue" : "gray"}">${esc(u.role || "lector")}</span></td>
      <td class="row-actions"><button class="link-btn danger" data-del="${esc(u.email)}">Quitar</button></td>
    </tr>`).join("") || `<tr><td colspan="3" class="muted">Aún no agregaste lectores.</td></tr>`;

  content.innerHTML = `
    <div class="alert info">Los <b>lectores</b> solo ven la información (no pueden crear, editar ni borrar).
      Deben ingresar con <b>“Continuar con Google”</b> usando el correo que registres aquí.</div>
    <section class="panel">
      <h3>Administradores</h3>
      <table class="data-table"><thead><tr><th>Correo</th><th>Rol</th><th></th></tr></thead><tbody>${adminRows}</tbody></table>
    </section>
    <section class="panel">
      <h3>Usuarios con acceso de lectura</h3>
      <table class="data-table"><thead><tr><th>Correo</th><th>Rol</th><th></th></tr></thead><tbody>${lectorRows}</tbody></table>
    </section>`;
  content.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm(`¿Quitar acceso a ${b.dataset.del}?`)) return;
    await DB.deleteUsuario(b.dataset.del);
    await renderUsuarios();
    toast("Usuario removido ✅", "success");
  });
}

function formUsuario() {
  openModal("Agregar usuario", `
    <form id="f" class="form">
      <label class="field"><span>Correo (Gmail)</span><input name="email" type="email" placeholder="correo@gmail.com" required></label>
      <label class="field"><span>Nombre (opcional)</span><input name="nombre"></label>
      <label class="field"><span>Rol</span>
        <select name="role"><option value="lector">Lector (solo ver)</option><option value="admin">Administrador</option></select>
      </label>
      <small class="muted">El usuario podrá entrar con Google usando ese correo.</small>
      <div class="form-row"><button class="btn primary" type="submit">Guardar</button></div>
    </form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    await DB.saveUsuario(fd.email, fd);
    closeModal(); await renderUsuarios();
    toast("Usuario agregado ✅", "success");
  };
}

/* ---------- IMPORTAR PLANILLA (Fase 2) ---------- */
const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Busca el precio en tarifas combinando modalidad + duración. */
function matchTarifa(modalidad, duracion) {
  const m = norm(modalidad), d = norm(duracion);
  if (!m && !d) return null;
  // 1) servicio que contenga ambos
  let t = state.tarifas.find((x) => { const s = norm(x.servicio); return (!m || s.includes(m)) && (!d || s.includes(d)); });
  if (!t && (m || d)) t = state.tarifas.find((x) => { const s = norm(x.servicio); return (m && s.includes(m)) || (d && s.includes(d)); });
  return t || null;
}

let _pendingPlanilla = null; // filas parseadas en espera de confirmar

async function renderPlanilla() {
  const cicloOpts = state.ciclos.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  content.innerHTML = `
    <div class="alert info"><strong>Importa la planilla mensual de FESICOL.</strong>
      Sube el Excel tal cual lo envían; el panel lee la hoja <b>FUENTE</b>, te muestra una vista previa y, al confirmar,
      crea/actualiza estudiantes e inscripciones, calculando el precio según las tarifas 2026.</div>
    <section class="panel">
      <div class="grid-2">
        <label class="field"><span>Ciclo de esta planilla</span><select id="planCiclo"><option value="">— Sin inscripción (solo estudiantes) —</option>${cicloOpts}</select></label>
        <label class="field"><span>Mes</span><input id="planMes" type="month" value="${monthISO()}"></label>
      </div>
      <label class="field"><span>Archivo de la planilla (.xlsx)</span><input id="planFile" type="file" accept=".xlsx,.xls"></label>
      <div class="form-row"><button class="btn primary" id="planParse">Leer planilla</button></div>
    </section>
    <div id="planPreview"></div>`;

  $("#planParse").onclick = async () => {
    const file = $("#planFile").files[0];
    if (!file) { toast("Selecciona el archivo de la planilla.", "error"); return; }
    setLoading(true, "Leyendo planilla…");
    try {
      const XLSX = await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets["FUENTE"] || wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      _pendingPlanilla = parsePlanillaRows(rows, file);
      drawPlanillaPreview();
    } catch (err) {
      console.error(err); toast("No pude leer el Excel: " + (err?.message || err), "error", 5000);
    } finally { setLoading(false); }
  };
}

let _xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_xlsxPromise) return _xlsxPromise;
  _xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("No se pudo cargar la librería de Excel."));
    document.head.appendChild(s);
  });
  return _xlsxPromise;
}

/** Detecta la fila de encabezados y extrae los registros. */
function parsePlanillaRows(rows, file) {
  // Encuentra la fila que contiene "NOMBRE DEL INSCRITO"
  let hIdx = rows.findIndex((r) => r.some((c) => norm(c).includes("nombre del inscrito")));
  if (hIdx < 0) hIdx = 8;
  const header = rows[hIdx].map(norm);
  const col = (needle) => header.findIndex((h) => h.includes(needle));
  const idx = {
    asociado: col("nombre del asociado"),
    doc: col("documento"),
    tel: col("telefono"),
    inscrito: col("nombre del inscrito"),
    edad: col("edad"),
    parentesco: col("parentesco"),
    modalidad: col("modalidad"),
    duracion: col("duracion")
  };
  const out = [];
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const nombre = String(r[idx.inscrito] ?? "").trim();
    if (!nombre) continue;
    const modalidad = String(r[idx.modalidad] ?? "").trim();
    const duracion = String(r[idx.duracion] ?? "").trim();
    const tar = matchTarifa(modalidad, duracion);
    // ¿estudiante ya existe? (por nombre)
    const existente = state.estudiantes.find((e) => norm(e.nombre) === norm(nombre));
    out.push({
      nombre,
      edad: r[idx.edad] || "",
      asociadoNombre: String(r[idx.asociado] ?? "").trim(),
      asociadoDocumento: String(r[idx.doc] ?? "").trim(),
      telefono: String(r[idx.tel] ?? "").trim(),
      parentesco: String(r[idx.parentesco] ?? "").trim(),
      modalidad, duracion,
      servicio: tar?.servicio || "",
      precio: tar?.precio || 0,
      tarifaOk: !!tar,
      existenteId: existente?.id || null
    });
  }
  return { rows: out, fileName: file.name, file };
}

function drawPlanillaPreview() {
  const data = _pendingPlanilla;
  if (!data || !data.rows.length) {
    $("#planPreview").innerHTML = `<div class="alert warn">No encontré filas con estudiantes en la planilla.</div>`;
    return;
  }
  const conCiclo = !!$("#planCiclo").value;
  const sinTarifa = data.rows.filter((r) => conCiclo && !r.tarifaOk).length;
  const totalPrecio = data.rows.reduce((a, b) => a + (conCiclo ? b.precio : 0), 0);

  const rows = data.rows.map((r) => `<tr>
    <td>${esc(r.nombre)} ${r.existenteId ? '<span class="pill gray">existe</span>' : '<span class="pill green">nuevo</span>'}</td>
    <td>${esc(r.asociadoNombre)}</td>
    <td>${esc(r.parentesco || "—")}</td>
    <td>${esc(r.modalidad || "—")}</td>
    <td>${esc(r.duracion || "—")}</td>
    <td>${conCiclo ? (r.tarifaOk ? formatCOP(r.precio) : '<span class="pill gray">sin tarifa</span>') : "—"}</td>
  </tr>`).join("");

  $("#planPreview").innerHTML = `
    <section class="panel">
      <h3>Vista previa · ${esc(data.fileName)} (${data.rows.length} registros)</h3>
      ${sinTarifa ? `<div class="alert warn">${sinTarifa} registro(s) sin tarifa automática: revisa modalidad/duración o edítalos luego en Inscripciones.</div>` : ""}
      ${conCiclo ? `<p><strong>Total estimado de la planilla:</strong> ${formatCOP(totalPrecio)}</p>` : `<p class="muted">Sin ciclo seleccionado: solo se cargarán/actualizarán estudiantes (sin inscripción).</p>`}
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Inscrito</th><th>Asociado</th><th>Parentesco</th><th>Modalidad</th><th>Duración</th><th>Precio</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="form-row"><button class="btn primary" id="planConfirm">Confirmar e importar</button></div>
    </section>`;

  $("#planConfirm").onclick = () => confirmImportPlanilla();
}

async function confirmImportPlanilla() {
  const data = _pendingPlanilla;
  if (!data) return;
  const cicloId = $("#planCiclo").value;
  const mes = $("#planMes").value;
  setLoading(true, "Importando planilla…");
  try {
    // Sube el archivo original a Storage como soporte
    let archivo = {};
    try { archivo = await DB.uploadArchivo(data.file, "planillas"); } catch (_) {}

    const items = data.rows.map((r) => {
      const it = {
        estudianteId: r.existenteId || null,
        estudiante: {
          nombre: r.nombre, edad: r.edad ? Number(r.edad) : null,
          asociadoNombre: r.asociadoNombre, asociadoDocumento: r.asociadoDocumento,
          telefono: r.telefono, parentesco: r.parentesco
        },
        asociado: r.asociadoDocumento ? {
          documento: r.asociadoDocumento, nombre: r.asociadoNombre, telefono: r.telefono
        } : null
      };
      if (cicloId) {
        it.inscripcion = {
          cicloId, mes, modalidad: r.modalidad, duracion: r.duracion,
          servicio: r.servicio, precio: r.precio
        };
      }
      return it;
    });

    const res = await DB.importPlanilla(items, {
      cicloId: cicloId || null, mes, archivoUrl: archivo.url || "", archivoPath: archivo.path || "",
      nombre: data.fileName, estado: "procesada"
    });

    _pendingPlanilla = null;
    await loadAll();
    toast(`Planilla importada: ${res.nuevosEst} estudiante(s) nuevo(s), ${res.nuevasIns} inscripción(es) ✅`, "success", 5000);
    await navigate("inscripciones");
  } catch (err) {
    console.error(err); toast("Error importando: " + (err?.message || err), "error", 6000);
  } finally { setLoading(false); }
}

/* =========================================================
   Refresh + boot
========================================================= */
async function refresh() {
  await loadAll();
  await views[state.view].render();
}

async function bootApp() {
  if (state.booted) return;
  state.booted = true;
  setLoading(true, "Preparando panel…");
  try {
    // Solo el admin siembra datos (los lectores no tienen permiso de escritura)
    if (isAdmin()) await ensureSeed();
    await loadAll();
    await navigate("resumen");
  } catch (e) {
    console.error("bootApp:", e);
    toast("Error cargando el panel: " + (e?.message || e), "error", 6000);
  } finally { setLoading(false); }
}

/** Determina el rol del usuario; null si no está autorizado. */
async function determineRole(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  if (isAdminEmail(email)) return "admin";
  try {
    const u = await DB.getUsuario(email);
    return u ? (u.role || "lector") : null;
  } catch (_) {
    return null; // permiso denegado = no autorizado
  }
}

/** Ajusta la interfaz según el rol (oculta secciones de admin y marca solo-lectura). */
function applyRoleUI() {
  const admin = isAdmin();
  $$(".admin-only").forEach((el) => { el.style.display = admin ? "" : "none"; });
  let badge = $("#roleBadge");
  if (!admin) {
    if (!badge) {
      badge = document.createElement("span");
      badge.id = "roleBadge";
      badge.className = "pill gray";
      badge.textContent = "Solo lectura";
      $(".sidebar-foot")?.prepend(badge);
    }
  } else if (badge) { badge.remove(); }
}

/* -------- Nav wiring -------- */
$$(".nav-item").forEach((b) => b.onclick = () => navigate(b.dataset.view));
$("#btnMenu")?.addEventListener("click", () => $("#sidebar").classList.toggle("open"));

/* =========================================================
   AUTH
========================================================= */
function showAuth(msg = "") {
  authView.hidden = false; appView.hidden = true;
  $("#authMsg").textContent = msg || "";
  setLoading(false);
}
function showApp(user) {
  authView.hidden = true; appView.hidden = false;
  $("#sessionEmail").textContent = user?.email || "—";
  setLoading(false);
}

$("#loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim();
  const pass = $("#loginPass").value;
  if (!email || !pass) { $("#authMsg").textContent = "Completa correo y contraseña."; return; }
  setLoading(true, "Ingresando…");
  try { await signInWithEmailAndPassword(auth, email, pass); }
  catch (err) { setLoading(false); $("#authMsg").textContent = prettyAuthError?.(err) || "No se pudo ingresar."; }
});
$("#btnGoogle")?.addEventListener("click", async () => {
  setLoading(true, "Abriendo Google…");
  try {
    const res = await signInWithGoogle({ preferRedirect: /Android|iPhone|iPad/i.test(navigator.userAgent) });
    if (!res?.ok) throw res?.error || new Error(res?.message);
  } catch (err) { setLoading(false); $("#authMsg").textContent = prettyAuthError?.(err) || err?.message || "Error con Google."; }
});
$("#btnLogout")?.addEventListener("click", async () => {
  setLoading(true, "Cerrando sesión…");
  try { await signOut(auth); state.booted = false; } finally { setLoading(false); }
});

async function init() {
  showAuth("");
  try { await consumeRedirectResult(); } catch (_) {}
  onAuthStateChanged(auth, async (user) => {
    if (!user) { showAuth(""); return; }
    setLoading(true, "Verificando acceso…");
    const role = await determineRole(user);
    if (!role) {
      await signOut(auth).catch(() => {});
      showAuth("Tu correo no tiene acceso a este panel. Pídele a un administrador que te agregue.");
      return;
    }
    state.role = role;
    state.user = user;
    showApp(user);
    applyRoleUI();
    await bootApp();
  });
}

console.log("[FESICOL] Panel Firestore · build 2026-06-16");
init();
