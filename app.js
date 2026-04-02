/* =========================
   Alianza FESICOL · Musicala
   app.js (completo + mejorado)
   - Firebase Auth: email/pass + Google (popup / redirect)
   - Mejor manejo de errores y loading
   - Render seguro del tablero
   - Modales más sólidos
   - Tabla CSV / tabla estática
   - Formulario de inscripción conectado al API
   - Facturación / contratos conectados al API
   - Soporte para descarga de archivos locales (xlsx, pdf, docx, etc.)
   ========================= */

import { initFirebase } from "./firebase.js";

const BUILD = "2026-04-01.3";
const DATA_URL = "fesicol.json";
const API_TIMEOUT_MS = 20000;

/* -------- Firebase config -------- */
const firebaseConfig = {
  apiKey: "AIzaSyBoZuK8koOeOhl2nBrqyUoEznpkqnnrTbs",
  authDomain: "manager-fesicol.firebaseapp.com",
  projectId: "manager-fesicol",
  storageBucket: "manager-fesicol.firebasestorage.app",
  messagingSenderId: "501861978891",
  appId: "1:501861978891:web:83eda7b8358121f23f880e"
};

const {
  auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  signInWithGoogle,
  consumeRedirectResult,
  prettyAuthError
} = initFirebase(firebaseConfig, {
  persistence: "local",
  debug: true
});

/* -------- Fallback por si falla el JSON -------- */
window.__fallbackData = {
  meta: {
    title: "Alianza FESICOL · Musicala",
    subtitle: "Gestión integral del convenio",
    period: "2026",
    last_updated: "2026-01-19",
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
  api: {
    baseUrl: "",
    endpoints: {
      stats: "stats",
      students: "students",
      add_one: "addOne",
      add_enrollment: "addOne",
      list_billing: "getBilling",
      add_billing: "addBilling"
    }
  },
  datasets: {},
  actions: [],
  footer: "Musicala · FESICOL"
};

/* -------- Atajos DOM -------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* -------- Estado global -------- */
const state = {
  data: null,
  apiBase: null,
  appBooted: false,
  studentsCache: [],
  addModalWired: false,
  billingModalWired: false,
  busy: false
};

/* -------- Elementos UI base -------- */
const loaderEl = $("#globalLoader");
const toastHost = $("#toastHost");

const authView = $("#authView");
const appView = $("#appView");

const loginForm = $("#loginForm");
const loginEmail = $("#loginEmail");
const loginPass = $("#loginPass");
const authMsg = $("#authMsg");
const btnLogin = $("#btnLogin");
const btnGoogle = $("#btnGoogle");

const btnLogout = $("#btnLogout");
const sessionEmail = $("#sessionEmail");

/* -------- Modales -------- */
const imgModal = $("#imgModal");
const tableModal = $("#tableModal");
const addModal = $("#addModal");
const billingModal = $("#billingModal");

/* -------- Formularios -------- */
const addForm = $("#addForm");
const billingForm = $("#billingForm");

/* -------- Billing UI -------- */
const billingTableBody = $("#billingTable tbody");
const billingEmpty = $("#billingEmpty");
const billingSubmitBtn = $("#billingSubmitBtn");
const billingRefreshBtn = $("#billingRefreshBtn");

/* -------- Helpers generales -------- */
function setText(sel, value, fallback = "") {
  const el = typeof sel === "string" ? $(sel) : sel;
  if (el) el.textContent = value ?? fallback;
}

function setHTML(sel, value, fallback = "") {
  const el = typeof sel === "string" ? $(sel) : sel;
  if (el) el.innerHTML = value ?? fallback;
}

function isStandaloneMode() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true
  );
}

function isMobileLike() {
  return /Android|webOS|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent);
}

function setAuthControlsDisabled(disabled) {
  [loginEmail, loginPass, btnLogin, btnGoogle].forEach((el) => {
    if (!el) return;
    el.disabled = !!disabled;
    el.setAttribute("aria-disabled", String(!!disabled));
  });
}

function setAppControlsDisabled(disabled) {
  if (btnLogout) {
    btnLogout.disabled = !!disabled;
    btnLogout.setAttribute("aria-disabled", String(!!disabled));
  }
}

function setLoading(on, msg = "Cargando…") {
  state.busy = !!on;

  if (loaderEl) {
    loaderEl.hidden = !on;
    const text = loaderEl.querySelector(".loader-text");
    if (text) text.textContent = msg;
    loaderEl.setAttribute("aria-busy", String(!!on));
  }

  setAuthControlsDisabled(on);
  setAppControlsDisabled(on);
}

function toast(message, type = "info", ttl = 3200) {
  if (!toastHost || !message) return;

  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.setAttribute("role", "status");
  t.textContent = String(message);

  toastHost.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));

  window.setTimeout(() => {
    t.classList.remove("show");
    window.setTimeout(() => t.remove(), 250);
  }, ttl);
}

function setThemeColor(color) {
  if (!color) return;
  document.documentElement.style.setProperty("--primary", color);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", color);
}

function clearAuthMessage() {
  if (authMsg) authMsg.textContent = "";
}

function setAuthMessage(message = "") {
  if (authMsg) authMsg.textContent = message;
}

function normalizeMonthValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function safeTrim(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return safeTrim(value).toLowerCase();
}

function getApiEndpoint(name, fallback = "") {
  return safeTrim(state.data?.api?.endpoints?.[name]) || fallback;
}

function getEnrollmentEndpoint() {
  return (
    getApiEndpoint("add_enrollment") ||
    getApiEndpoint("add_one") ||
    "addOne"
  );
}

function getBillingConfig() {
  const actions = Array.isArray(state.data?.actions) ? state.data.actions : [];
  const item = actions.find((a) => a?.id === "facturacion");
  return item?.action || null;
}

function isExternalUrl(url = "") {
  return /^https?:\/\//i.test(safeTrim(url));
}

function isBlobLikeUrl(url = "") {
  return /^(blob:|data:)/i.test(safeTrim(url));
}

function resolveActionUrl(url = "") {
  const raw = safeTrim(url);
  if (!raw) return "";

  if (isExternalUrl(raw) || isBlobLikeUrl(raw)) return raw;

  try {
    return new URL(raw, window.location.href).href;
  } catch {
    return raw;
  }
}

function fileExtensionFromUrl(url = "") {
  const cleanUrl = safeTrim(url).split("?")[0].split("#")[0];
  const parts = cleanUrl.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function guessFilename(url = "", fallback = "archivo") {
  const cleanUrl = safeTrim(url).split("?")[0].split("#")[0];
  const parts = cleanUrl.split("/");
  const last = safeTrim(parts.pop());
  return last || fallback;
}

function shouldUseDownloadAttribute(url = "", explicitDownload = false) {
  if (explicitDownload) return true;
  if (isExternalUrl(url)) return false;

  const ext = fileExtensionFromUrl(url);
  return ["xlsx", "xls", "csv", "pdf", "doc", "docx", "zip"].includes(ext);
}

function triggerFileOpen(url, options = {}) {
  const href = resolveActionUrl(url);
  if (!href) {
    toast("No se encontró el archivo para abrir.", "error", 4200);
    return;
  }

  const filename = safeTrim(options.filename) || guessFilename(href, "archivo");
  const useDownload = shouldUseDownloadAttribute(href, !!options.download);

  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener noreferrer";

  if (useDownload) {
    a.download = filename;
  } else {
    a.target = "_blank";
  }

  document.body.appendChild(a);
  a.click();
  a.remove();
}

function getActionButtonLabel(action = {}) {
  const type = safeTrim(action?.type).toLowerCase();

  if (type === "download_file") return "Descargar";
  if (type === "link" && action?.download) return "Descargar";

  return "Abrir";
}

/* -------- Auth UI -------- */
function showAuth(msg = "") {
  if (authView) authView.hidden = false;
  if (appView) appView.hidden = true;

  setAuthMessage(msg);
  setLoading(false);

  if (loginPass) loginPass.value = "";
}

function showApp(user) {
  if (authView) authView.hidden = true;
  if (appView) appView.hidden = false;

  setText(sessionEmail, user?.email || "—");
  clearAuthMessage();
  setLoading(false);
}

function resetProtectedUI() {
  const actionsGrid = $("#actionsGrid");
  const kpisGrid = $("#kpisGrid");
  const kpisSection = $("#kpisSection");

  if (actionsGrid) actionsGrid.innerHTML = "";
  if (kpisGrid) kpisGrid.innerHTML = "";
  if (kpisSection) kpisSection.hidden = true;

  closeDialog(imgModal);
  closeDialog(tableModal);
  closeDialog(addModal);
  closeDialog(billingModal);

  state.data = null;
  state.apiBase = null;
  state.studentsCache = [];
  state.appBooted = false;
}

/* -------- API helpers -------- */
function requireApi() {
  if (!state.apiBase) {
    toast("Falta configurar la URL del WebApp en el JSON.", "error", 4200);
    return false;
  }
  return true;
}

async function fetchWithTimeout(url, options = {}, timeout = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return res;
  } finally {
    window.clearTimeout(id);
  }
}

async function parseJsonSafe(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("La API no devolvió JSON válido.");
  }
}

async function apiGet(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${state.apiBase}?${qs}`;
  const res = await fetchWithTimeout(url, {
    method: "GET",
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(`API GET error (${res.status})`);
  }

  return parseJsonSafe(res);
}

async function apiPost(params = {}) {
  const body = new URLSearchParams(params).toString();

  const res = await fetchWithTimeout(state.apiBase, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body
  });

  if (!res.ok) {
    throw new Error(`API POST error (${res.status})`);
  }

  return parseJsonSafe(res);
}

/* -------- Data load -------- */
async function loadData() {
  try {
    const res = await fetchWithTimeout(DATA_URL, { cache: "no-store" }, 15000);
    if (!res.ok) throw new Error("No se pudo cargar el JSON");

    const data = await res.json();
    state.apiBase = safeTrim(data?.api?.baseUrl) || state.apiBase || null;
    return data;
  } catch (err) {
    console.warn("Usando fallback local:", err?.message || err);
    const fallback = window.__fallbackData;
    state.apiBase = safeTrim(fallback?.api?.baseUrl) || null;
    return fallback;
  }
}

/* -------- Render: Header / Intro -------- */
function renderHeader(meta = {}) {
  setText("#title", meta.title || "Alianza FESICOL");
  setText("#subtitle", meta.subtitle || "Gestión del convenio");
  setText("#periodoBadge", meta.period ? `Periodo ${meta.period}` : "Periodo");
  setText(
    "#lastUpdated",
    meta.last_updated ? `Actualizado: ${meta.last_updated}` : "Actualizado: —"
  );
  setText("#footerNote", state.data?.footer || "Musicala · FESICOL");
}

function renderIntro(intro = {}) {
  const introCard = $("#introCard");
  if (!introCard) return;

  introCard.hidden = false;
  setText("#introTitle", intro.title || "Alcance");
  setText("#introLead", intro.lead || "");

  const ul = $("#introBullets");
  if (!ul) return;

  ul.innerHTML = "";
  (intro.bullets || []).forEach((b) => {
    const li = document.createElement("li");
    li.textContent = b;
    ul.appendChild(li);
  });
}

/* -------- Actions -------- */
function normalizeKind(kind) {
  const k = String(kind || "operativo").toLowerCase().trim();
  return k === "administrativo" ? "administrativo" : "operativo";
}

function createActionCard(item = {}) {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.kind = normalizeKind(item.kind);

  const h4 = document.createElement("h4");
  h4.textContent = `${item.icon || "•"} ${item.title || "Acción"}`;

  const p = document.createElement("p");
  p.textContent = item.description || "";

  const tags = document.createElement("div");
  tags.className = "tags";

  (item.tags || []).forEach((t) => {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = t;
    tags.appendChild(span);
  });

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.type = "button";
  btn.innerHTML = `<span class="icon">↗</span> ${getActionButtonLabel(item.action)}`;
  btn.addEventListener("click", () => handleAction(item.action));

  card.append(h4, p, tags, btn);
  return card;
}

function sortActions(actions) {
  const list = Array.isArray(actions) ? [...actions] : [];

  list.sort((a, b) => {
    const pa = Number.isFinite(a?.priority) ? a.priority : 9999;
    const pb = Number.isFinite(b?.priority) ? b.priority : 9999;
    if (pa !== pb) return pa - pb;
    return String(a?.title || "").localeCompare(String(b?.title || ""), "es");
  });

  return list;
}

function applyActionFilter(filter = "all") {
  const grid = $("#actionsGrid");
  if (!grid) return;

  [...grid.children].forEach((card) => {
    const kind = card.dataset.kind;
    card.style.display = filter === "all" || filter === kind ? "" : "none";
  });
}

function renderActions(actions) {
  const grid = $("#actionsGrid");
  if (!grid) return;

  grid.innerHTML = "";

  const ordered = sortActions(actions);
  ordered.forEach((a) => grid.appendChild(createActionCard(a)));

  const activeChip = $(".chip.active");
  const filter = activeChip?.dataset?.filter || "all";
  applyActionFilter(filter);
}

function initChipsOnce() {
  $$(".chip").forEach((chip) => {
    if (chip.dataset.wired === "1") return;
    chip.dataset.wired = "1";

    chip.addEventListener("click", () => {
      $$(".chip").forEach((c) => {
        c.classList.remove("active");
        c.setAttribute("aria-selected", "false");
      });

      chip.classList.add("active");
      chip.setAttribute("aria-selected", "true");
      applyActionFilter(chip.dataset.filter || "all");
    });
  });
}

/* -------- KPIs -------- */
function renderKPIsFromStats(stats = {}) {
  const kpis = [
    { label: "Estudiantes inscritos", value: stats?.inscritos_total ?? "—" },
    { label: "Estudiantes activos", value: stats?.activos_total ?? "—" }
  ];

  const sec = $("#kpisSection");
  const grid = $("#kpisGrid");
  if (!sec || !grid) return;

  grid.innerHTML = "";

  kpis.forEach((k) => {
    const el = document.createElement("div");
    el.className = "kpi";
    el.innerHTML = `
      <div class="value">${k.value}</div>
      <div class="label">${k.label}</div>
    `;
    grid.appendChild(el);
  });

  sec.hidden = false;
}

async function loadStatsAndRender() {
  if (!state.apiBase) return;

  try {
    const endpoint = getApiEndpoint("stats", "stats");
    const stats = await apiGet({ action: endpoint });
    renderKPIsFromStats(stats);
  } catch (e) {
    console.warn("No pude traer stats:", e?.message || e);
  }
}

/* -------- Modales -------- */
function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function showDialog(dialog, fallbackUrl = "") {
  if (!dialog) return;

  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else if (fallbackUrl) {
    window.open(fallbackUrl, "_blank", "noopener");
  } else {
    toast("Tu navegador no soporta modales nativos.", "error");
  }
}

function wireDialogCloseByBackdrop(dialog) {
  if (!dialog || dialog.dataset.backdropWired === "1") return;
  dialog.dataset.backdropWired = "1";

  dialog.addEventListener("click", (e) => {
    const rect = dialog.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;

    if (!inside) dialog.close();
  });
}

wireDialogCloseByBackdrop(imgModal);
wireDialogCloseByBackdrop(tableModal);
wireDialogCloseByBackdrop(addModal);
wireDialogCloseByBackdrop(billingModal);

$("#closeModal")?.addEventListener("click", () => closeDialog(imgModal));
$("#closeTableModal")?.addEventListener("click", () => closeDialog(tableModal));
$("#closeAddModal")?.addEventListener("click", () => closeDialog(addModal));
$("#closeBillingModal")?.addEventListener("click", () => closeDialog(billingModal));

/* -------- CSV: parser + tabla -------- */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += ch;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function removeStaticNote() {
  const noteEl = $("#staticNote");
  if (noteEl) {
    noteEl.textContent = "";
    noteEl.style.display = "none";
  }
}

function buildTable(headers, rows, columnsWanted) {
  const thead = $("#dataTable thead");
  const tbody = $("#dataTable tbody");
  if (!thead || !tbody) return;

  thead.innerHTML = "";
  tbody.innerHTML = "";

  let indices = headers.map((_, i) => i);
  let finalHeaders = headers;

  if (Array.isArray(columnsWanted) && columnsWanted.length) {
    const normal = (s) => String(s || "").trim().toLowerCase();
    const wanted = columnsWanted.map((c) => normal(c));

    const mapped = wanted.map((wc) => headers.findIndex((h) => normal(h) === wc));
    const filteredHeaders = [];
    const filteredIdx = [];

    mapped.forEach((idx, i) => {
      if (idx >= 0) {
        filteredHeaders.push(columnsWanted[i]);
        filteredIdx.push(idx);
      }
    });

    if (filteredHeaders.length) {
      finalHeaders = filteredHeaders;
      indices = filteredIdx;
    }
  }

  const trh = document.createElement("tr");
  finalHeaders.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    indices.forEach((idx) => {
      const td = document.createElement("td");
      td.textContent = r[idx] ?? "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function bindTableSearch() {
  const search = $("#tableSearch");
  const tbody = $("#dataTable tbody");
  const empty = $("#tableEmpty");

  if (!search || !tbody || !empty) return;

  const allRows = () => Array.from(tbody.querySelectorAll("tr"));

  function applyFilter() {
    const q = search.value.trim().toLowerCase();
    let visible = 0;

    allRows().forEach((tr) => {
      const match = tr.textContent.toLowerCase().includes(q);
      tr.style.display = match ? "" : "none";
      if (match) visible++;
    });

    empty.style.display = visible ? "none" : "block";
  }

  const debounce = (fn, t = 160) => {
    let id;
    return (...a) => {
      clearTimeout(id);
      id = window.setTimeout(() => fn(...a), t);
    };
  };

  search.oninput = debounce(applyFilter, 160);
  search.value = "";
  applyFilter();
}

async function openTableModal(title, src, columnsWanted) {
  setText("#tableModalTitle", title || "Datos");

  const dlBtn = $("#downloadCSV");
  if (dlBtn) {
    dlBtn.style.display = "";
    dlBtn.setAttribute("href", src);
  }

  removeStaticNote();
  setLoading(true, "Cargando tabla…");

  try {
    const res = await fetchWithTimeout(src, { cache: "no-store" }, 20000);
    if (!res.ok) throw new Error("No se pudo cargar el CSV");

    const text = await res.text();
    const rows = parseCSV(text).filter((r) => r.some((c) => c && String(c).trim() !== ""));
    if (!rows.length) throw new Error("CSV vacío");

    const headers = rows[0];
    const data = rows.slice(1);

    buildTable(headers, data, columnsWanted);
    bindTableSearch();
    showDialog(tableModal, src);
  } catch (e) {
    console.error(e);
    toast(`Error cargando la tabla: ${e?.message || e}`, "error", 5200);
  } finally {
    setLoading(false);
  }
}

/* -------- Static table -------- */
function openStaticTableModal(title, columns, rows, note = "") {
  setText("#tableModalTitle", title || "Datos");

  const dlBtn = $("#downloadCSV");
  if (dlBtn) {
    dlBtn.style.display = "none";
    dlBtn.removeAttribute("href");
  }

  const wrap = $("#dataTable")?.closest(".table-wrap");
  let noteEl = $("#staticNote");

  if (!noteEl && wrap) {
    noteEl = document.createElement("div");
    noteEl.id = "staticNote";
    noteEl.className = "static-note muted";
    wrap.prepend(noteEl);
  }

  if (noteEl) {
    noteEl.textContent = note ? String(note) : "";
    noteEl.style.display = note ? "" : "none";
  }

  const headers =
    Array.isArray(columns) && columns.length ? columns : ["Campo", "Valor"];

  const data = (Array.isArray(rows) ? rows : []).map((r) =>
    Array.isArray(r) ? r : [String(r)]
  );

  buildTable(headers, data, null);
  bindTableSearch();
  showDialog(tableModal);
}

/* -------- Agregar inscripción -------- */
function wireAddModalOnce() {
  if (state.addModalWired) return;
  state.addModalWired = true;

  const inpInscrito = $("#addNombreInscrito");
  const inpAsociado = $("#addNombreAsociado");
  const inpCurso = $("#addCurso");
  const inpTel = $("#addTelefono");

  if (!inpInscrito || !inpAsociado || !inpCurso || !inpTel) return;

  function clearDependentFields() {
    inpAsociado.value = "";
    inpCurso.value = "";
    inpTel.value = "";
  }

  function fillFromList() {
    const v = safeTrim(inpInscrito.value);
    if (!v) {
      clearDependentFields();
      return;
    }

    const s = state.studentsCache.find(
      (x) => normalizeText(x.nombreInscrito) === normalizeText(v)
    );

    if (s) {
      inpAsociado.value = s.nombreAsociado || "";
      inpCurso.value = s.curso || s.instrumento || "";
      inpTel.value = s.telefono || "";
    }
  }

  inpInscrito.addEventListener("change", fillFromList);
  inpInscrito.addEventListener("input", () => {
    if (!inpInscrito.value) clearDependentFields();
  });
}

async function openAddModal() {
  if (!requireApi()) return;

  setLoading(true, "Cargando estudiantes…");

  try {
    const endpoint = getApiEndpoint("students", "students");
    const res = await apiGet({ action: endpoint });
    state.studentsCache = Array.isArray(res?.data) ? res.data : [];

    const dl = $("#listaEstudiantes");
    if (dl) {
      dl.innerHTML = "";
      state.studentsCache.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.nombreInscrito || "";
        dl.appendChild(opt);
      });
    }

    const monthInput = $("#addMes");
    if (monthInput && !monthInput.value) {
      monthInput.value = normalizeMonthValue();
    }

    wireAddModalOnce();
    showDialog(addModal);
  } catch (e) {
    console.error(e);
    toast("No pude cargar la base de estudiantes.", "error", 4200);
  } finally {
    setLoading(false);
  }
}

addForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireApi()) return;

  const item = {
    nombreAsociado: safeTrim($("#addNombreAsociado")?.value),
    nombreInscrito: safeTrim($("#addNombreInscrito")?.value),
    curso: safeTrim($("#addCurso")?.value),
    telefono: safeTrim($("#addTelefono")?.value),
    mes: safeTrim($("#addMes")?.value)
  };

  if (!item.nombreInscrito || !item.nombreAsociado || !item.curso || !item.telefono || !item.mes) {
    toast("Completa todos los campos de la inscripción.", "error");
    return;
  }

  const found = state.studentsCache.find(
    (x) => normalizeText(x.nombreInscrito) === normalizeText(item.nombreInscrito)
  );

  if (!found) {
    toast("Selecciona un estudiante válido de la base oficial.", "error", 4200);
    return;
  }

  setLoading(true, "Guardando inscripción…");

  try {
    const endpoint = getEnrollmentEndpoint();
    const r = await apiPost({
      action: endpoint,
      item: JSON.stringify(item)
    });

    if (r?.ok) {
      toast("Inscripción guardada ✅", "success");
      closeDialog(addModal);
      addForm.reset();
      await loadStatsAndRender();
    } else {
      const reason = r?.error ? ` Motivo: ${r.error}` : "";
      toast("No pude guardar la inscripción." + reason, "error", 5200);
      console.error("API response:", r);
    }
  } catch (err) {
    console.error(err);
    toast("No pude guardar la inscripción. " + (err?.message || ""), "error", 5200);
  } finally {
    setLoading(false);
  }
});

/* -------- Facturación / contratos -------- */
function renderBillingRows(rows = [], cfg = {}) {
  if (!billingTableBody || !billingEmpty) return;

  billingTableBody.innerHTML = "";

  const normalized = Array.isArray(rows) ? rows : [];
  const hasRows = normalized.length > 0;
  billingEmpty.style.display = hasRows ? "none" : "block";

  normalized.forEach((item) => {
    const tr = document.createElement("tr");

    const values = [
      item.nombre_documento || item.documento || "",
      item.tipo_documento || item.tipo || "",
      item.periodo || "",
      item.estado || "",
      item.updated_at || item.ultima_actualizacion || item.created_at || "",
      item.nota || ""
    ];

    values.forEach((val, idx) => {
      const td = document.createElement("td");

      if (idx === 0 && item.archivo_url) {
        const a = document.createElement("a");
        a.href = item.archivo_url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = val || "Abrir documento";
        td.appendChild(a);
      } else {
        td.textContent = val ?? "";
      }

      tr.appendChild(td);
    });

    billingTableBody.appendChild(tr);
  });

  const modalTitle = cfg?.title || "Facturación / Contratos";
  setText("#billingModalTitle", modalTitle);
}

async function loadBillingList() {
  if (!requireApi()) return;

  const endpoint = getApiEndpoint("list_billing", "getBilling");
  const res = await apiGet({ action: endpoint });

  if (!res?.ok && !Array.isArray(res?.rows) && !Array.isArray(res?.data)) {
    throw new Error(res?.message || "No se pudo cargar la facturación.");
  }

  const rows = Array.isArray(res?.rows)
    ? res.rows
    : Array.isArray(res?.data)
      ? res.data
      : [];

  renderBillingRows(rows, getBillingConfig());
}

async function submitBillingForm(e) {
  e.preventDefault();
  if (!requireApi()) return;

  const payload = {
    periodo: safeTrim($("#billingPeriodo")?.value),
    tipo_documento: safeTrim($("#billingTipo")?.value),
    nombre_documento: safeTrim($("#billingNombre")?.value),
    estado: safeTrim($("#billingEstado")?.value),
    responsable: safeTrim($("#billingResponsable")?.value),
    archivo_url: safeTrim($("#billingArchivoUrl")?.value),
    nota: safeTrim($("#billingNota")?.value)
  };

  if (!payload.periodo || !payload.tipo_documento || !payload.nombre_documento || !payload.estado) {
    toast("Completa los campos obligatorios de facturación.", "error", 4200);
    return;
  }

  if (payload.archivo_url) {
    try {
      new URL(payload.archivo_url);
    } catch {
      toast("La URL del archivo no es válida.", "error", 4200);
      return;
    }
  }

  if (billingSubmitBtn) billingSubmitBtn.disabled = true;

  try {
    const endpoint = getApiEndpoint("add_billing", "addBilling");
    const res = await apiPost({
      action: endpoint,
      ...payload
    });

    if (!res?.ok) {
      throw new Error(res?.message || "No se pudo guardar el documento.");
    }

    toast("Documento guardado en Sheets ✅", "success", 3200);
    billingForm?.reset();

    const monthInput = $("#billingPeriodo");
    if (monthInput) monthInput.value = normalizeMonthValue();

    await loadBillingList();
  } catch (err) {
    console.error("submitBillingForm:", err);
    toast(err?.message || "Error guardando documento.", "error", 5200);
  } finally {
    if (billingSubmitBtn) billingSubmitBtn.disabled = false;
  }
}

function wireBillingModalOnce() {
  if (state.billingModalWired) return;
  state.billingModalWired = true;

  billingForm?.addEventListener("submit", submitBillingForm);

  billingRefreshBtn?.addEventListener("click", async () => {
    try {
      setLoading(true, "Actualizando facturación…");
      await loadBillingList();
    } catch (err) {
      console.error(err);
      toast(err?.message || "No pude actualizar la lista.", "error", 4200);
    } finally {
      setLoading(false);
    }
  });
}

async function openBillingModal() {
  if (!requireApi()) return;

  wireBillingModalOnce();

  const cfg = getBillingConfig();
  setText("#billingModalTitle", cfg?.title || "Facturación / Contratos");

  const periodo = $("#billingPeriodo");
  if (periodo && !periodo.value) {
    periodo.value = normalizeMonthValue();
  }

  showDialog(billingModal);

  try {
    setLoading(true, "Cargando facturación…");
    await loadBillingList();
  } catch (err) {
    console.error("openBillingModal:", err);
    toast(err?.message || "No pude cargar la facturación.", "error", 4200);
  } finally {
    setLoading(false);
  }
}

/* -------- Router de acciones -------- */
function handleAction(action) {
  if (!action) return;

  if (action.type === "link" && action.href) {
    const href = resolveActionUrl(action.href);
    if (!href) {
      toast("No se encontró el enlace.", "error");
      return;
    }

    if (action.download) {
      triggerFileOpen(href, {
        filename: action.filename,
        download: true
      });
      return;
    }

    window.open(href, "_blank", "noopener");
    return;
  }

  if (action.type === "download_file") {
    const url = action.url || action.href || action.src;
    if (!safeTrim(url)) {
      toast("No se encontró el archivo para descargar.", "error", 4200);
      return;
    }

    triggerFileOpen(url, {
      filename: action.filename,
      download: true
    });

    if (action.successMessage) {
      toast(action.successMessage, "success", 2600);
    }
    return;
  }

  if (action.type === "image_modal" && action.src) {
    setText("#imgModalTitle", action.title || "Vista");
    const img = $("#modalImage");
    if (img) {
      img.src = action.src;
      img.alt = action.title || "Vista";
    }
    showDialog(imgModal, action.src);
    return;
  }

  if (action.type === "csv_table") {
    let cfg = action;

    if (action.dataset && state.data?.datasets?.[action.dataset]) {
      const ds = state.data.datasets[action.dataset];
      cfg = {
        title: action.title || ds.title,
        src: ds.src,
        columns: ds.columns
      };
    }

    if (!cfg?.src) {
      toast("No se encontró la fuente CSV.", "error");
      return;
    }

    openTableModal(cfg.title || "Datos", cfg.src, cfg.columns);
    return;
  }

  if (action.type === "static_table") {
    openStaticTableModal(
      action.title || "Datos",
      action.columns || [],
      action.rows || [],
      action.note || ""
    );
    return;
  }

  if (action.type === "add_form") {
    openAddModal();
    return;
  }

  if (action.type === "billing_form") {
    openBillingModal();
    return;
  }

  toast("Acción no soportada aún.", "info");
}

/* -------- App protegida -------- */
async function bootApp() {
  if (state.appBooted) return;
  state.appBooted = true;

  setLoading(true, "Cargando tablero…");

  try {
    initChipsOnce();

    const data = await loadData();
    state.data = data;
    window.__data = data;

    setThemeColor(data?.meta?.themeColor);
    renderHeader(data?.meta || {});
    renderIntro(data?.intro || {});
    renderActions(data?.actions || []);

    await loadStatsAndRender();
  } catch (err) {
    console.error("Error bootApp:", err);
    toast("No pude cargar el tablero completo.", "error", 4200);
  } finally {
    setLoading(false);
  }
}

/* -------- Auth -------- */
async function handleEmailLogin(e) {
  e.preventDefault();

  const email = safeTrim(loginEmail?.value);
  const pass = loginPass?.value || "";

  if (!email || !pass) {
    setAuthMessage("Completa correo y contraseña.");
    return;
  }

  setLoading(true, "Ingresando…");
  clearAuthMessage();

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged se encarga del resto
  } catch (err) {
    console.error("Email sign-in error:", err);
    setLoading(false);

    const msg =
      prettyAuthError?.(err) ||
      "No se pudo ingresar. Revisa correo y contraseña.";

    setAuthMessage(msg);
    toast(msg, "error", 4800);
  }
}

async function handleGoogleLogin() {
  setLoading(true, "Abriendo Google…");
  clearAuthMessage();

  try {
    const res = await signInWithGoogle({
      preferRedirect: isStandaloneMode() || isMobileLike()
    });

    if (!res?.ok) {
      throw res?.error || new Error(res?.message || "No se pudo iniciar con Google.");
    }

    if (res.method === "redirect") {
      return;
    }

    // Si fue popup, onAuthStateChanged termina el flujo.
  } catch (err) {
    console.error("Google Sign-In error:", err);
    setLoading(false);

    const msg =
      prettyAuthError?.(err) ||
      err?.message ||
      "No se pudo ingresar con Google.";

    setAuthMessage(msg);
    toast(msg, "error", 5200);
  }
}

loginForm?.addEventListener("submit", handleEmailLogin);
btnGoogle?.addEventListener("click", handleGoogleLogin);

btnLogout?.addEventListener("click", async () => {
  setLoading(true, "Cerrando sesión…");

  try {
    await signOut(auth);
    resetProtectedUI();
  } catch (e) {
    console.error(e);
    toast("No pude cerrar sesión.", "error");
  } finally {
    setLoading(false);
  }
});

async function initAuthFlow() {
  showAuth("");

  try {
    const redirectInfo = await consumeRedirectResult();
    if (!redirectInfo?.ok && redirectInfo?.message) {
      console.warn("Redirect result:", redirectInfo.message);
    }
  } catch (err) {
    console.warn("consumeRedirectResult falló:", err);
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      showApp(user);
      await bootApp();
    } else {
      resetProtectedUI();
      showAuth("");
    }
  });
}

/* -------- Start -------- */
console.log(`[FESICOL] app.js build ${BUILD}`);
initAuthFlow();