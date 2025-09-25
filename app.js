/* =========================
   Alianza FESICOL · Musicala
   app.js (simple, sin import ni botones extra)
   ========================= */

const DATA_URL = "fesicol.json";

/* -------- Fallback por si falla el JSON -------- */
window.__fallbackData = {
  meta: {
    title: "Alianza FESICOL · Musicala",
    subtitle: "Gestión integral del convenio",
    period: "2025",
    last_updated: "2025-09-25",
    themeColor: "#0C41C4"
  },
  intro: {
    title: "Alcance del convenio",
    lead: "Tablero único para cronogramas, actas, reportes, PQRS y materiales académicos de FESICOL.",
    bullets: [
      "Control de cronograma oficial.",
      "Acceso rápido a documentos clave.",
      "Seguimiento a indicadores."
    ]
  },
  assets: { cronograma_image: "cronogramafesicol.jpg" },
  api: { baseUrl: "" },
  datasets: {},
  actions: [],
  footer: "Musicala · FESICOL"
};

/* -------- Atajos DOM -------- */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* -------- API (Apps Script) -------- */
let API_BASE = null; // se setea desde el JSON

async function loadData() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo cargar el JSON");
    const data = await res.json();
    API_BASE = data?.api?.baseUrl || API_BASE;
    return data;
  } catch (err) {
    console.warn("Usando fallback local:", err.message);
    return window.__fallbackData;
  }
}

function requireApi() {
  if (!API_BASE) { alert("Falta configurar la URL del WebApp en el JSON."); return false; }
  return true;
}
async function apiGet(params) {
  const qs = new URLSearchParams(params || {}).toString();
  const r = await fetch(`${API_BASE}?${qs}`, { method: "GET" });
  if (!r.ok) throw new Error("API GET error");
  return r.json();
}
async function apiPost(params) {
  const body = new URLSearchParams(params || {}).toString();
  const r = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!r.ok) throw new Error("API POST error");
  return r.json();
}

/* -------- Render / Tema -------- */
function setThemeColor(color) {
  if (!color) return;
  document.documentElement.style.setProperty("--primary", color);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", color);
}
function renderHeader(meta) {
  $("#title").textContent = meta.title || "Alianza FESICOL";
  $("#subtitle").textContent = meta.subtitle || "Gestión del convenio";
  $("#periodoBadge").textContent = meta.period ? `Periodo ${meta.period}` : "Periodo";
  $("#lastUpdated").textContent = meta.last_updated ? `Actualizado: ${meta.last_updated}` : "Actualizado: —";
  $("#footerNote").textContent = window.__data.footer || "Musicala · FESICOL";
}
function renderIntro(intro) {
  if (!intro) return;
  $("#introCard").hidden = false;
  $("#introTitle").textContent = intro.title || "Alcance";
  $("#introLead").textContent  = intro.lead || "";
  const ul = $("#introBullets");
  ul.innerHTML = "";
  (intro.bullets || []).forEach(b => {
    const li = document.createElement("li");
    li.textContent = b;
    ul.appendChild(li);
  });
}
function createActionCard(item) {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.kind = item.kind || "operativo";

  const h4 = document.createElement("h4");
  h4.textContent = `${item.icon || "•"} ${item.title}`;

  const p = document.createElement("p");
  p.textContent = item.description || "";

  const tags = document.createElement("div");
  tags.className = "tags";
  (item.tags || []).forEach(t => {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = t;
    tags.appendChild(span);
  });

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.innerHTML = `<span class="icon">↗</span> Abrir`;
  btn.addEventListener("click", () => handleAction(item.action));

  card.append(h4, p, tags, btn);
  return card;
}
function renderActions(actions) {
  const grid = $("#actionsGrid");
  grid.innerHTML = "";
  actions.forEach(a => grid.appendChild(createActionCard(a)));
  $$(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      $$(".chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      const filter = chip.dataset.filter;
      [...grid.children].forEach(card => {
        const kind = card.dataset.kind;
        card.style.display = (filter === "all" || filter === kind) ? "" : "none";
      });
    });
  });
}

/* -------- KPIs: solo 2, tomados del archivo -------- */
function renderKPIsFromStats(stats) {
  const kpis = [
    { label: "Estudiantes inscritos", value: stats?.inscritos_total ?? "—" },
    { label: "Estudiantes activos",   value: stats?.activos_total   ?? "—" }
  ];
  const sec = $("#kpisSection");
  const grid = $("#kpisGrid");
  grid.innerHTML = "";
  kpis.forEach(k => {
    const el = document.createElement("div");
    el.className = "kpi";
    el.innerHTML = `<div class="value">${k.value}</div><div class="label">${k.label}</div>`;
    grid.appendChild(el);
  });
  sec.hidden = false;
}

/* -------- Router de acciones -------- */
function handleAction(action) {
  if (!action) return;

  if (action.type === "link" && action.href) return window.open(action.href, "_blank", "noopener");

  if (action.type === "image_modal" && action.src) {
    $("#imgModalTitle").textContent = action.title || "Vista";
    const img = $("#modalImage");
    img.src = action.src;
    img.alt = action.title || "Vista";
    const dlg = $("#imgModal");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else window.open(action.src, "_blank", "noopener");
    return;
  }

  if (action.type === "csv_table") {
    let cfg = action;
    if (action.dataset && window.__data?.datasets?.[action.dataset]) {
      const ds = window.__data.datasets[action.dataset];
      cfg = { title: action.title || ds.title, src: ds.src, columns: ds.columns };
    }
    if (!cfg?.src) return alert("No se encontró la fuente CSV.");
    return openTableModal(cfg.title || "Datos", cfg.src, cfg.columns);
  }

  if (action.type === "add_form") return openAddModal();
}

/* -------- Modal imagen: solo cerrar -------- */
$("#closeModal")?.addEventListener("click", () => { const d = $("#imgModal"); if (d.open) d.close(); });

/* -------- CSV: parser + tabla ------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (inQuotes && text[i+1] === '"') { field += '"'; i++; } else inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { row.push(field); field = ""; continue; }
    if ((ch === '\n' || ch === '\r') && !inQuotes) { if (ch === '\r' && text[i+1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function buildTable(headers, rows, columnsWanted) {
  const thead = $("#dataTable thead");
  const tbody = $("#dataTable tbody");
  thead.innerHTML = ""; tbody.innerHTML = "";
  let indices = headers.map((_, i) => i), finalHeaders = headers;
  if (Array.isArray(columnsWanted) && columnsWanted.length) {
    const normal = s => String(s||"").trim().toLowerCase();
    indices = columnsWanted.map(c => headers.findIndex(h => normal(h) === normal(c)));
    const filtered = [], filteredIdx = [];
    indices.forEach((idx, i) => { if (idx >= 0) { filtered.push(columnsWanted[i]); filteredIdx.push(idx); } });
    finalHeaders = filtered.length ? filtered : headers;
    indices = filtered.length ? filteredIdx : headers.map((_, i) => i);
  }
  const trh = document.createElement("tr");
  finalHeaders.forEach(h => { const th = document.createElement("th"); th.textContent = h; trh.appendChild(th); });
  thead.appendChild(trh);
  rows.forEach(r => {
    const tr = document.createElement("tr");
    indices.forEach(idx => { const td = document.createElement("td"); td.textContent = r[idx] ?? ""; tr.appendChild(td); });
    tbody.appendChild(tr);
  });
}
async function openTableModal(title, src, columnsWanted) {
  $("#tableModalTitle").textContent = title;
  $("#downloadCSV")?.setAttribute("href", src); // por si lo sigues mostrando
  try {
    const res = await fetch(src, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo cargar el CSV");
    const text = await res.text();
    const rows = parseCSV(text).filter(r => r.some(c => c && String(c).trim() !== ""));
    if (!rows.length) throw new Error("CSV vacío");
    const headers = rows[0]; const data = rows.slice(1);
    buildTable(headers, data, columnsWanted);
    const search = $("#tableSearch"), tbody = $("#dataTable tbody"), empty = $("#tableEmpty");
    const allRows = () => Array.from(tbody.querySelectorAll("tr"));
    function applyFilter() {
      const q = search.value.trim().toLowerCase(); let visible = 0;
      allRows().forEach(tr => { const match = tr.textContent.toLowerCase().includes(q); tr.style.display = match ? "" : "none"; if (match) visible++; });
      empty.style.display = visible ? "none" : "block";
    }
    const debounce = (fn, t=160) => { let id; return (...a)=>{ clearTimeout(id); id=setTimeout(()=>fn(...a),t); }; };
    search.oninput = debounce(applyFilter, 160); search.value=""; applyFilter();
  } catch (e) { alert("Error cargando la tabla: " + e.message); console.error(e); }
  const dlg = $("#tableModal"); if (typeof dlg.showModal === "function") dlg.showModal(); else window.open(src, "_blank", "noopener");
}
$("#closeTableModal")?.addEventListener("click", () => { const d = $("#tableModal"); if (d.open) d.close(); });

/* -------- Agregar inscripción (individual) -------- */
const addModal = $("#addModal");
$("#closeAddModal")?.addEventListener("click", () => addModal.open && addModal.close());

async function openAddModal() {
  if (!requireApi()) return;
  // Cargar base oficial para autocompletar
  try {
    const res = await apiGet({ action: "students" });
    const dl = $("#listaEstudiantes"); dl.innerHTML = "";
    (res?.data || []).forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.nombreInscrito;
      opt.label = `${s.nombreInscrito} — ${s.curso || s.instrumento || ""}`;
      opt.dataset.asociado = s.nombreAsociado || "";
      opt.dataset.curso = s.curso || s.instrumento || "";
      opt.dataset.telefono = s.telefono || "";
      dl.appendChild(opt);
    });
  } catch (e) { console.error(e); alert("No pude cargar la base de estudiantes."); }

  const inpInscrito = $("#addNombreInscrito");
  const inpAsociado = $("#addNombreAsociado");
  const inpCurso    = $("#addCurso");
  const inpTel      = $("#addTelefono");

  function fillFromDatalist() {
    const opt = [...$("#listaEstudiantes").children].find(o => o.value === inpInscrito.value);
    if (opt) { inpAsociado.value = opt.dataset.asociado || ""; inpCurso.value = opt.dataset.curso || ""; inpTel.value = opt.dataset.telefono || ""; }
  }
  inpInscrito.addEventListener("change", fillFromDatalist);
  inpInscrito.addEventListener("input",  () => { if (!inpInscrito.value) { inpAsociado.value = inpCurso.value = inpTel.value = ""; } });

  addModal.showModal();
}

$("#addForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireApi()) return;

  const item = {
    nombreAsociado: $("#addNombreAsociado").value.trim(),
    nombreInscrito: $("#addNombreInscrito").value.trim(),
    curso:          $("#addCurso").value.trim(),
    telefono:       $("#addTelefono").value.trim(),
    mes:            $("#addMes").value
  };

  try {
    const r = await apiPost({ action: "addOne", item: JSON.stringify(item) });
    if (r?.ok) { alert("Inscripción guardada ✅"); addModal.close(); /* refresca KPIs */ loadStatsAndRender(); }
    else { alert("No pude guardar la inscripción." + (r?.error ? `\nMotivo: ${r.error}` : "")); console.error("API response:", r); }
  } catch (err) {
    alert("No pude guardar la inscripción.\n" + (err?.message || "")); console.error(err);
  }
});

/* -------- KPIs: fetch stats y render -------- */
async function loadStatsAndRender() {
  if (!API_BASE) return; // por si el JSON no tiene API todavía
  try {
    const stats = await apiGet({ action: "stats" });
    renderKPIsFromStats(stats);
  } catch (e) {
    console.warn("No pude traer stats:", e.message);
  }
}

/* ------------------ INIT ------------------ */
(async function init(){
  const data = await loadData();
  window.__data = data;

  setThemeColor(data?.meta?.themeColor);
  renderHeader(data.meta || {});
  renderIntro(data.intro || {});
  renderActions(data.actions || []);

  await loadStatsAndRender(); // KPIs desde archivo
})();
