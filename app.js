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
  const width = 640;
  const chartTop = 34;
  const chartBottom = 176;
  const chartHeight = chartBottom - chartTop;
  const slot = width / data.length;
  const barWidth = Math.min(76, slot * .58);
  const bars = data.map((d, i) => {
    const h = (d.value / max) * chartHeight;
    const x = i * slot + (slot - barWidth) / 2;
    const center = i * slot + slot / 2;
    return `
      <g class="chart-bar">
        <rect x="${x.toFixed(2)}" y="${(chartBottom - h).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${h.toFixed(2)}"
              rx="8" fill="${color}"><title>${esc(d.label)}: ${money ? formatCOP(d.value) : d.value}</title></rect>
        <text x="${center.toFixed(2)}" y="204" font-size="13" font-weight="600" text-anchor="middle" fill="var(--muted)">${esc(d.label)}</text>
        ${d.value ? `<text x="${center.toFixed(2)}" y="${Math.max(22, chartBottom - h - 9).toFixed(2)}" font-size="13" font-weight="700" text-anchor="middle" fill="var(--text-soft)">${money ? "$" + (d.value / 1000).toFixed(0) + "k" : d.value}</text>` : ""}
      </g>`;
  }).join("");
  return `<div class="bar-chart"><svg viewBox="0 0 ${width} 220" preserveAspectRatio="xMidYMid meet" style="width:100%;height:${height}px" role="img" aria-label="Gráfica de barras">${bars}</svg></div>`;
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

/** Lista de asociados de un estudiante (compatible con el modelo viejo de un solo asociado). */
function asociadosDe(est) {
  if (Array.isArray(est?.asociados) && est.asociados.length) return est.asociados;
  if (est?.asociadoNombre || est?.asociadoDocumento) {
    return [{
      nombre: est.asociadoNombre || "", documento: est.asociadoDocumento || "",
      telefono: est.telefono || "", parentesco: est.parentesco || ""
    }];
  }
  return [];
}

/** Une asociados sin duplicar (por documento, o por nombre si no hay documento). */
function unirAsociados(...listas) {
  const out = []; const vistos = new Set();
  listas.flat().forEach((a) => {
    if (!a || (!a.documento && !a.nombre)) return;
    const clave = a.documento ? "d:" + String(a.documento).trim() : "n:" + String(a.nombre).trim().toLowerCase();
    if (vistos.has(clave)) return;
    vistos.add(clave); out.push(a);
  });
  return out;
}

/* =========================================================
   ROUTER
========================================================= */
const views = {
  resumen: { title: "Resumen", subtitle: "Estado general del convenio", render: renderResumen },
  ciclos: { title: "Ciclos y horarios", subtitle: "Estudiantes, servicios y fechas por ciclo", render: renderCiclos },
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
    return `<tr class="cycle-row" data-cycle="${c.id}" tabindex="0" role="button" aria-label="Ver información de ${esc(c.nombre)}">
      <td><span class="cycle-name"><span class="cycle-chevron" aria-hidden="true">›</span><strong>${esc(c.nombre)}</strong></span></td>
      <td>${esc(c.fechaLimiteInscripcion || "—")} ${vencido ? '<span class="pill gray">cerrado</span>' : ""}</td>
      <td>${esc(c.fechaInicioClases || "—")}</td>
      <td><span class="pill ${c.estado === "abierto" ? "green" : "blue"}">${esc(c.estado || "—")}</span></td>
      <td>${insN}</td>
      <td class="row-actions">${adminOnly(`
        <button class="link-btn" data-edit="${c.id}">Editar</button>
        <button class="link-btn danger" data-del="${c.id}">Eliminar</button>`)}
      </td></tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">Sin ciclos. Crea el primero.</td></tr>`;

  content.innerHTML = `<section class="panel cycle-list-panel">
    <div class="panel-heading"><div><h3>Ciclos y horarios</h3><p class="muted sm">Selecciona un ciclo para ver sus estudiantes, servicios e información completa.</p></div></div>
    <div class="table-wrap"><table class="data-table">
    <thead><tr><th>Ciclo</th><th>Límite inscripción</th><th>Inicio clases</th><th>Estado</th><th>Inscritos</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div></section>
    <section id="cycleDetail" aria-live="polite"></section>`;

  const openCycle = (id) => {
    content.querySelectorAll(".cycle-row").forEach((row) => row.classList.toggle("selected", row.dataset.cycle === id));
    renderCycleDetail(id);
  };
  content.querySelectorAll("[data-cycle]").forEach((row) => {
    row.onclick = (event) => {
      if (event.target.closest("button")) return;
      openCycle(row.dataset.cycle);
    };
    row.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCycle(row.dataset.cycle);
      }
    };
  });

  content.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
    formCiclo(state.ciclos.find((c) => c.id === b.dataset.edit));
  });
  content.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("¿Eliminar este ciclo?")) return;
    await DB.deleteCiclo(b.dataset.del);
    await refresh();
  });
}

function renderCycleDetail(cicloId) {
  const cycle = state.ciclos.find((c) => c.id === cicloId);
  const target = $("#cycleDetail");
  if (!cycle || !target) return;
  const inscripciones = state.inscripciones.filter((i) => i.cicloId === cicloId);
  const studentIds = new Set(inscripciones.map((i) => i.estudianteId).filter(Boolean));
  const total = inscripciones.reduce((sum, item) => sum + (item.precio || 0), 0);
  const rows = inscripciones.map((i) => {
    const estudiante = state.estudiantes.find((e) => e.id === i.estudianteId);
    const asociado = i.asociadoNombre || asociadosDe(estudiante)[0]?.nombre || "—";
    return `<tr>
      <td><strong>${esc(estudiante?.nombre || i.estudianteNombre || "—")}</strong></td>
      <td>${esc(asociado)}</td>
      <td>${esc(i.servicio || i.modalidad || "—")}</td>
      <td>${esc(i.duracion || "—")}</td>
      <td>${esc(i.mes || "—")}</td>
      <td>${formatCOP(i.precio || 0)}</td>
      <td><span class="pill blue">${esc(i.estado || "—")}</span></td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="cycle-empty">Este ciclo todavía no tiene estudiantes inscritos.</td></tr>`;

  target.innerHTML = `<section class="panel cycle-detail">
    <div class="cycle-detail-head">
      <div>
        <span class="muted sm">Detalle del ciclo</span>
        <h3>${esc(cycle.nombre)}</h3>
        <p class="muted">Cierre de inscripción: <strong>${esc(cycle.fechaLimiteInscripcion || "—")}</strong> · Inicio de clases: <strong>${esc(cycle.fechaInicioClases || "—")}</strong></p>
      </div>
      <span class="pill ${cycle.estado === "abierto" ? "green" : "blue"}">${esc(cycle.estado || "—")}</span>
    </div>
    <div class="cycle-summary">
      <div><span>Estudiantes</span><strong>${studentIds.size}</strong></div>
      <div><span>Servicios inscritos</span><strong>${inscripciones.length}</strong></div>
      <div><span>Valor del ciclo</span><strong>${formatCOP(total)}</strong></div>
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Estudiante</th><th>Solicitado por</th><th>Servicio / modalidad</th><th>Duración</th><th>Mes</th><th>Precio</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
  target.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  $("#topbarActions").innerHTML = `<input id="qEst" class="search" placeholder="Buscar…"><button class="btn secondary sm" id="expEst">⬇ Excel</button>` + adminOnly(`<button class="btn secondary sm" id="mergeEst">⛓ Fusionar duplicados</button><button class="btn primary sm" id="addEst">+ Estudiante</button>`);
  $("#addEst") && ($("#addEst").onclick = () => formEstudiante());
  $("#mergeEst") && ($("#mergeEst").onclick = () => fusionarDuplicados());
  $("#expEst").onclick = () => exportToExcel(state.estudiantes.map((e) => {
    const asocs = asociadosDe(e);
    return {
      Estudiante: e.nombre, Edad: e.edad ?? "",
      Asociados: asocs.map((a) => a.nombre).filter(Boolean).join(" / "),
      "Documentos asociados": asocs.map((a) => a.documento).filter(Boolean).join(" / "),
      Parentesco: asocs.map((a) => a.parentesco).filter(Boolean).join(" / "),
      Telefono: asocs.map((a) => a.telefono).filter(Boolean).join(" / "),
      Estado: e.activo === false ? "inactivo" : "activo",
      Inscripciones: state.inscripciones.filter((i) => i.estudianteId === e.id).length
    };
  }), "estudiantes-fesicol.xlsx", "Estudiantes");

  const draw = (q = "") => {
    const list = state.estudiantes.filter((e) => !q || (e.nombre || "").toLowerCase().includes(q) || asociadosDe(e).some((a) => (a.nombre || "").toLowerCase().includes(q)));
    const rows = list.map((e) => {
      const insN = state.inscripciones.filter((i) => i.estudianteId === e.id).length;
      const asocs = asociadosDe(e);
      const asocCell = asocs.length
        ? asocs.map((a) => `${esc(a.nombre || "—")}${a.parentesco ? ` <span class="muted">(${esc(a.parentesco)})</span>` : ""}`).join("<br>")
        : "—";
      const parentCell = asocs.length ? asocs.map((a) => esc(a.parentesco || "—")).join("<br>") : "—";
      const telCell = asocs.length ? asocs.map((a) => esc(a.telefono || "—")).join("<br>") : "—";
      return `<tr>
        <td><strong>${esc(e.nombre)}</strong></td>
        <td>${asocCell}</td>
        <td>${parentCell}</td>
        <td>${telCell}</td>
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

/* ---------- FUSIONAR DUPLICADOS ---------- */
/** Agrupa estudiantes con nombres parecidos (posibles duplicados). */
function detectarGruposDuplicados() {
  const ests = state.estudiantes.slice();
  const usados = new Set();
  const grupos = [];
  for (let i = 0; i < ests.length; i++) {
    if (usados.has(ests[i].id)) continue;
    const grupo = [ests[i]];
    for (let j = i + 1; j < ests.length; j++) {
      if (usados.has(ests[j].id)) continue;
      if (nombresCoinciden(ests[i].nombre, ests[j].nombre)) {
        grupo.push(ests[j]); usados.add(ests[j].id);
      }
    }
    if (grupo.length > 1) { usados.add(ests[i].id); grupos.push(grupo); }
  }
  return grupos;
}

async function fusionarDuplicados() {
  const grupos = detectarGruposDuplicados();
  if (!grupos.length) {
    openModal("Fusionar duplicados", `<div class="alert ok">No se detectaron estudiantes duplicados ✅</div>`);
    return;
  }
  const insN = (id) => state.inscripciones.filter((x) => x.estudianteId === id).length;
  const bloques = grupos.map((g, gi) => {
    // sugiere conservar el que más inscripciones tenga
    const principalId = g.slice().sort((a, b) => insN(b.id) - insN(a.id))[0].id;
    const filas = g.map((e) => `
      <label class="merge-row" style="display:flex;gap:.5rem;align-items:center;padding:.3rem 0">
        <input type="radio" name="keep-${gi}" value="${e.id}" ${e.id === principalId ? "checked" : ""}>
        <span><strong>${esc(e.nombre)}</strong> · ${esc(asociadosDe(e).map((a) => a.nombre).filter(Boolean).join(", ") || "sin asociado")} · ${insN(e.id)} inscrip.</span>
      </label>`).join("");
    return `<div class="panel" data-grupo="${gi}" style="margin-bottom:.75rem;padding:.75rem">
      <div class="muted" style="margin-bottom:.35rem">Posible duplicado (${g.length}). Marca cuál conservar:</div>
      ${filas}
      <button class="btn primary sm" data-merge-grupo="${gi}">Fusionar este grupo</button>
    </div>`;
  }).join("");

  openModal("Fusionar duplicados", `
    <p class="muted">Las inscripciones de los duplicados se reasignan al estudiante que conserves; los demás se eliminan. Esto no se puede deshacer.</p>
    ${bloques}`);

  // guarda referencia a los grupos para el handler
  const _grupos = grupos;
  document.querySelectorAll("[data-merge-grupo]").forEach((btn) => {
    btn.onclick = async () => {
      const gi = Number(btn.dataset.mergeGrupo);
      const sel = document.querySelector(`input[name="keep-${gi}"]:checked`);
      if (!sel) { toast("Selecciona cuál conservar.", "info"); return; }
      const keepId = sel.value;
      const dropIds = _grupos[gi].map((e) => e.id).filter((id) => id !== keepId);
      if (!confirm(`Se fusionarán ${dropIds.length} estudiante(s) en uno. ¿Continuar?`)) return;
      try {
        setLoading(true);
        const res = await DB.mergeEstudiantes(keepId, dropIds);
        toast(`Fusionado: ${res.movidas} inscripción(es) movidas, ${res.eliminados} eliminado(s) ✅`, "success", 5000);
        closeModal();
        await refresh();
        fusionarDuplicados();
      } catch (err) {
        console.error(err); toast("Error al fusionar: " + (err?.message || err), "error", 6000);
      } finally { setLoading(false); }
    };
  });
}

function formEstudiante(s = null) {
  const asocsIniciales = asociadosDe(s);
  if (!asocsIniciales.length) asocsIniciales.push({});
  const filaAsoc = (a = {}) => `
    <div class="asoc-row panel" style="padding:.6rem;margin-bottom:.5rem">
      <div class="grid-2">
        <label class="field"><span>Nombre del asociado</span><input class="a-nombre" value="${esc(a.nombre || "")}"></label>
        <label class="field"><span>Documento asociado</span><input class="a-doc" value="${esc(a.documento || "")}"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Parentesco</span><input class="a-parentesco" placeholder="Papá, Mamá, cónyuge…" value="${esc(a.parentesco || "")}"></label>
        <label class="field"><span>Teléfono</span><input class="a-tel" value="${esc(a.telefono || "")}"></label>
      </div>
      <button type="button" class="link-btn danger a-del">Quitar asociado</button>
    </div>`;
  openModal(s ? "Editar estudiante" : "Nuevo estudiante", `
    <form id="f" class="form">
      <div class="grid-2">
        <label class="field"><span>Nombre del inscrito</span><input name="nombre" value="${esc(s?.nombre || "")}" required></label>
        <label class="field"><span>Edad</span><input name="edad" type="number" value="${esc(s?.edad || "")}"></label>
      </div>
      <div class="field"><span>Asociados (quién(es) lo inscriben)</span>
        <div id="asocList">${asocsIniciales.map(filaAsoc).join("")}</div>
        <button type="button" class="btn secondary sm" id="addAsoc">+ Agregar asociado</button>
      </div>
      <label class="field"><span>Estado</span>
        <select name="activo">
          <option value="true" ${s?.activo !== false ? "selected" : ""}>Activo</option>
          <option value="false" ${s?.activo === false ? "selected" : ""}>Inactivo</option>
        </select>
      </label>
      <div class="form-row"><button class="btn primary" type="submit">Guardar</button></div>
    </form>`);
  const bindDel = () => $("#asocList").querySelectorAll(".a-del").forEach((b) => b.onclick = () => {
    if ($("#asocList").querySelectorAll(".asoc-row").length > 1) b.closest(".asoc-row").remove();
    else toast("Debe quedar al menos un asociado (puede dejarse vacío).", "info");
  });
  bindDel();
  $("#addAsoc").onclick = () => { $("#asocList").insertAdjacentHTML("beforeend", filaAsoc()); bindDel(); };
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.activo = fd.activo === "true";
    fd.edad = fd.edad ? Number(fd.edad) : null;
    const asociados = unirAsociados([...$("#asocList").querySelectorAll(".asoc-row")].map((row) => ({
      nombre: row.querySelector(".a-nombre").value.trim(),
      documento: row.querySelector(".a-doc").value.trim(),
      parentesco: row.querySelector(".a-parentesco").value.trim(),
      telefono: row.querySelector(".a-tel").value.trim()
    })).filter((a) => a.nombre || a.documento));
    const principal = asociados[0] || {};
    fd.asociados = asociados;
    fd.asociadoNombre = principal.nombre || "";
    fd.asociadoDocumento = principal.documento || "";
    fd.parentesco = principal.parentesco || "";
    fd.telefono = principal.telefono || "";
    await DB.saveEstudiante(fd, s?.id || null);
    closeModal(); await refresh();
    toast("Estudiante guardado ✅", "success");
  };
}

async function verHistorial(estId) {
  const est = state.estudiantes.find((e) => e.id === estId);
  const ins = state.inscripciones.filter((i) => i.estudianteId === estId);
  const asocs = asociadosDe(est);
  const asocBox = asocs.length ? `
    <div class="panel" style="padding:.6rem .8rem;margin-bottom:12px">
      <strong>Asociados que inscriben a ${esc(est?.nombre || "")}:</strong>
      <ul style="margin:.4rem 0 0;padding-left:1.1rem">
        ${asocs.map((a) => `<li>${esc(a.nombre || "—")}${a.parentesco ? ` — ${esc(a.parentesco)}` : ""}${a.documento ? ` <span class="muted">(doc. ${esc(a.documento)})</span>` : ""}</li>`).join("")}
      </ul>
    </div>` : "";
  const rows = ins.map((i) => `<tr><td>${esc(cicloNombre(i.cicloId))}</td><td>${esc(i.mes || "—")}</td><td>${esc(i.servicio || i.modalidad || "—")}</td><td>${esc(i.asociadoNombre || "—")}</td><td>${formatCOP(i.precio)}</td><td>${esc(i.estado || "—")}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Sin inscripciones registradas.</td></tr>`;
  const total = ins.reduce((a, b) => a + (b.precio || 0), 0);
  openModal(`Historial · ${est?.nombre || ""}`, `
    ${asocBox}
    <table class="data-table"><thead><tr><th>Ciclo</th><th>Mes</th><th>Servicio</th><th>Solicitado por</th><th>Precio</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="margin-top:12px"><strong>Total del plan de ${esc(est?.nombre || "este estudiante")}:</strong> ${formatCOP(total)} <span class="muted">· ${ins.length} servicio(s) sumados de todos sus asociados</span></p>`);
}

/* ---------- INSCRIPCIONES ---------- */
async function renderInscripciones() {
  $("#topbarActions").innerHTML = `<button class="btn secondary sm" id="expIns">⬇ Excel</button>` + adminOnly(`<button class="btn primary sm" id="addIns">+ Inscripción</button>`);
  $("#addIns") && ($("#addIns").onclick = () => formInscripcion());
  $("#expIns").onclick = () => exportToExcel(state.inscripciones.map((i) => ({
    Estudiante: estudianteNombre(i.estudianteId) || i.estudianteNombre || "", "Solicitado por": i.asociadoNombre ?? "", Ciclo: cicloNombre(i.cicloId), Mes: i.mes ?? "",
    Servicio: i.servicio ?? "", Modalidad: i.modalidad ?? "", Duracion: i.duracion ?? "", Precio: i.precio ?? 0, Estado: i.estado ?? ""
  })), "inscripciones-fesicol.xlsx", "Inscripciones");

  const rows = state.inscripciones.map((i) => `<tr>
      <td><strong>${esc(estudianteNombre(i.estudianteId) || i.estudianteNombre || "—")}</strong></td>
      <td>${esc(i.asociadoNombre || "—")}</td>
      <td>${esc(cicloNombre(i.cicloId))}</td>
      <td>${esc(i.mes || "—")}</td>
      <td>${esc(i.modalidad || "—")}</td>
      <td>${esc(i.duracion || "—")}</td>
      <td>${formatCOP(i.precio)}</td>
      <td><span class="pill blue">${esc(i.estado || "—")}</span></td>
      <td class="row-actions">${adminOnly(`
        <button class="link-btn" data-edit="${i.id}">Editar</button>
        <button class="link-btn danger" data-del="${i.id}">Eliminar</button>`)}
      </td></tr>`).join("") || `<tr><td colspan="9" class="muted">Sin inscripciones.</td></tr>`;

  content.innerHTML = `<section class="panel"><table class="data-table">
    <thead><tr><th>Estudiante</th><th>Solicitado por</th><th>Ciclo</th><th>Mes</th><th>Modalidad</th><th>Duración</th><th>Precio</th><th>Estado</th><th></th></tr></thead>
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
      <label class="field"><span>Solicitado por (asociado)</span><select name="asociadoDocumento" id="asocSel"><option value="">—</option></select></label>
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
  // Pobla "Solicitado por" con los asociados del estudiante seleccionado
  const estSel = $("#f").estudianteId;
  const asocSel = $("#asocSel");
  const llenarAsoc = () => {
    const est = state.estudiantes.find((e) => e.id === estSel.value);
    const asocs = asociadosDe(est);
    asocSel.innerHTML = `<option value="">—</option>` + asocs.map((a) =>
      `<option value="${esc(a.documento || a.nombre)}" data-nombre="${esc(a.nombre || "")}" ${(i?.asociadoDocumento && i.asociadoDocumento === a.documento) || (i?.asociadoNombre && i.asociadoNombre === a.nombre) ? "selected" : ""}>${esc(a.nombre || "—")}${a.parentesco ? ` (${esc(a.parentesco)})` : ""}</option>`
    ).join("");
  };
  estSel.onchange = llenarAsoc;
  llenarAsoc();
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    fd.precio = parsePrice(fd.precio);
    fd.estudianteNombre = estudianteNombre(fd.estudianteId);
    fd.asociadoNombre = asocSel.selectedOptions[0]?.dataset.nombre || "";
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
function tarifaCategoria(servicio) {
  return (servicio || "").trim().split(/\s+/)[0] || "Otros";
}

async function renderTarifas() {
  $("#topbarActions").innerHTML = `<input id="qTar" class="search" placeholder="Buscar servicio…">`;

  // estado local del buscador/orden/filtro
  const ui = { q: "", cat: "", sort: "servicio", dir: 1 };

  const categorias = [...new Set(state.tarifas.map((t) => tarifaCategoria(t.servicio)))].sort((a, b) => a.localeCompare(b, "es"));

  const draw = () => {
    let list = state.tarifas.filter((t) => {
      const okQ = !ui.q || (t.servicio || "").toLowerCase().includes(ui.q);
      const okCat = !ui.cat || tarifaCategoria(t.servicio) === ui.cat;
      return okQ && okCat;
    });
    list.sort((a, b) => {
      if (ui.sort === "precio") return ((a.precio || 0) - (b.precio || 0)) * ui.dir;
      return (a.servicio || "").localeCompare(b.servicio || "", "es") * ui.dir;
    });

    const ind = (col) => (ui.sort === col ? (ui.dir === 1 ? " ▲" : " ▼") : "");
    const rows = list.map((t) =>
      `<tr><td>${esc(t.servicio)}</td><td>${formatCOP(t.precio)}</td></tr>`
    ).join("") || `<tr><td colspan="2" class="muted">Sin resultados.</td></tr>`;

    const opts = `<option value="">Todas las categorías</option>` +
      categorias.map((c) => `<option value="${esc(c)}" ${ui.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("");

    content.innerHTML = `<section class="panel">
      <p class="muted sm">Música, danza, teatro y artes plásticas. Tarifas 2026 del convenio.</p>
      <div class="toolbar" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <select id="catTar" class="search">${opts}</select>
        <span class="muted sm">${list.length} de ${state.tarifas.length} servicios</span>
      </div>
      <table class="data-table"><thead><tr>
        <th class="sortable" data-sort="servicio" style="cursor:pointer">Servicio${ind("servicio")}</th>
        <th class="sortable" data-sort="precio" style="cursor:pointer">Precio${ind("precio")}</th>
      </tr></thead><tbody>${rows}</tbody></table></section>`;

    $("#qTar").oninput = (e) => { ui.q = e.target.value.trim().toLowerCase(); draw(); };
    $("#qTar").value = ui.q;
    $("#catTar").onchange = (e) => { ui.cat = e.target.value; draw(); };
    content.querySelectorAll("th.sortable").forEach((th) => {
      th.onclick = () => {
        const col = th.dataset.sort;
        if (ui.sort === col) ui.dir *= -1; else { ui.sort = col; ui.dir = 1; }
        draw();
      };
    });
    if (ui.q) $("#qTar").focus();
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
const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

/* ---------- Coincidencia difusa de nombres ----------
   Reconoce que dos nombres son el mismo estudiante aunque difieran en
   mayúsculas, tildes, espacios de más, orden de palabras o un pequeño typo. */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** Devuelve true si dos nombres son muy probablemente la misma persona. */
function nombresCoinciden(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // mismo conjunto de palabras en cualquier orden (incluye nombres reordenados)
  const sa = na.split(" ").filter(Boolean).sort().join(" ");
  const sb = nb.split(" ").filter(Boolean).sort().join(" ");
  if (sa === sb) return true;
  // tolerancia a typos: distancia de edición pequeña según longitud
  const maxLen = Math.max(sa.length, sb.length);
  const tol = maxLen > 14 ? 3 : maxLen > 8 ? 2 : 1;
  return levenshtein(sa, sb) <= tol;
}

/** Busca en la lista un estudiante cuyo nombre coincida (difuso). */
function findEstudianteSimilar(nombre, list = state.estudiantes) {
  return list.find((e) => nombresCoinciden(e.nombre, nombre)) || null;
}

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
    // ¿estudiante ya existe? (coincidencia difusa: tildes, mayúsculas, espacios, typos)
    const existente = findEstudianteSimilar(nombre);
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

    // Agrupa las filas por estudiante destino (existente o nuevo) para conectar
    // varios asociados (papá, mamá…) al mismo Juan Esteban y sumar sus servicios.
    const asocDeFila = (r) => (r.asociadoNombre || r.asociadoDocumento)
      ? { documento: r.asociadoDocumento, nombre: r.asociadoNombre, telefono: r.telefono, parentesco: r.parentesco }
      : null;
    const grupos = [];
    data.rows.forEach((r) => {
      let g = r.existenteId
        ? grupos.find((x) => x.existenteId === r.existenteId)
        : grupos.find((x) => !x.existenteId && nombresCoinciden(x.base.nombre, r.nombre));
      if (!g) { g = { existenteId: r.existenteId || null, base: r, rows: [] }; grupos.push(g); }
      g.rows.push(r);
    });

    const items = [];
    grupos.forEach((g) => {
      const existente = g.existenteId ? state.estudiantes.find((e) => e.id === g.existenteId) : null;
      const asociados = unirAsociados(
        existente ? asociadosDe(existente) : [],
        g.rows.map(asocDeFila).filter(Boolean)
      );
      const principal = asociados[0] || {};
      const estudiante = {
        nombre: g.base.nombre, edad: g.base.edad ? Number(g.base.edad) : null,
        asociados,
        asociadoNombre: principal.nombre || "", asociadoDocumento: principal.documento || "",
        telefono: principal.telefono || "", parentesco: principal.parentesco || ""
      };
      g.rows.forEach((r) => {
        const it = { estudianteId: g.existenteId || null, estudiante, asociado: asocDeFila(r) };
        if (cicloId) {
          it.inscripcion = {
            cicloId, mes, modalidad: r.modalidad, duracion: r.duracion,
            servicio: r.servicio, precio: r.precio,
            asociadoNombre: r.asociadoNombre || "", asociadoDocumento: r.asociadoDocumento || ""
          };
        }
        items.push(it);
      });
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
