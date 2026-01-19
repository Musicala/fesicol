/* ============================================================================
   Ajustador de Precios · Musicala — app.js (vPRO+CONFIG+CCFEE+AFFORD)
   - Config avanzada editable (reglas + catálogo) guardada en localStorage
   - UI avanzada inyectada en el <details> existente (sin tocar HTML)
   - Migración suave: v1 -> v2
   - ✅ Toggle recargo tarjeta +6% (ccFee) aplicado AL FINAL y re-redondeado
   - ✅ "Solo resultados filtrados" funciona (si off, muestra TODO ignorando filtros)
   - ✅ Loader robusto (hidden + display)
   - ✅ NUEVO: Modal "Análisis SMMLV" (% del ingreso para 1..3 SMMLV o más)
============================================================================ */

/* ================================
   Utilidades
================================ */
const qs  = (s, root=document) => root.querySelector(s);
const qsa = (s, root=document) => Array.from(root.querySelectorAll(s));

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function roundUp(value, step){
  step = Number(step) || 0;
  if(step <= 0) return value;
  return Math.ceil(value / step) * step;
}

function formatCOP(value){
  const n = Number(value) || 0;
  return n.toLocaleString("es-CO", { style:"currency", currency:"COP", maximumFractionDigits:0 });
}

function safeNumber(v, fallback=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatPct(n){
  const x = Number(n);
  if(!Number.isFinite(x)) return "—";
  // 1 decimal si es pequeño, entero si es grande
  const d = x < 10 ? 1 : 0;
  return `${x.toFixed(d)}%`;
}

function normalizeText(s){
  return (s||"")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ")
    .trim();
}

function deepClone(obj){
  return JSON.parse(JSON.stringify(obj));
}

/* ================================
   Defaults del motor (EDITABLES via Config)
================================ */

// Factor por modalidad/categoría (sobre base por-clase)
const FACTOR_BY_GROUP_DEFAULT = {
  "Sede Personalizado": 1.00,
  "Musifamiliar Sede Grupal": 0.85,
  "Sede Grupal": 0.75,
  "Ensambles": 0.70,

  "Hogar Personalizado": 1.35,
  "Hogar Musifamiliar Grupal": 1.15,

  "Virtual Personalizado": 0.85,
  "Virtual Grupal": 0.65,

  "Taller empresarial": 2.00,

  // Cursos: por ahora como "paquetes", se ajusta luego
  "Curso Preuniversitario": 0.90,
  "Curso de formación": 0.90,
  "Curso Vacacional": 0.95,

  // Suscripciones: fixed multipliers (sobre base por clase)
  "Musigym": 2.50,              // 1 mes
  "Plataforma Online": 1.20      // 1 mes
};

// Multiplicador por tipo dentro del grupo (sobre factor del grupo)
const TYPE_FACTOR_DEFAULT = {
  "Clase de prueba": 0.60,
  "Clase individual": 1.10,
  "Paquete": 1.00,
  "Mes": 1.00,
  "Otro": 1.00
};

// Descuento por volumen en paquetes (aplica a precio total)
const PACK_DISCOUNT_DEFAULT = {
  4:  1.00,
  8:  0.97,
  12: 0.95,
  16: 0.94,
  20: 0.93,
  24: 0.90
};

// Multiplicadores por duración (meses) para suscripciones
const MONTHS_MULT_DEFAULT = {
  1:  1.00,
  2:  1.85,
  3:  2.70,
  6:  4.80,
  12: 8.30
};

// Catálogo completo (según lista)
const SERVICE_NAMES_DEFAULT = [
  "Sede Personalizado Clase de prueba",
  "Sede Personalizado Clase individual",
  "Sede Personalizado Paquete de 4 clases",
  "Sede Personalizado Paquete de 8 clases",
  "Sede Personalizado Paquete de 12 clases",
  "Sede Personalizado Paquete de 24 clases",

  "Musifamiliar Sede Grupal Clase de prueba",
  "Musifamiliar Sede Grupal Clase Individual",
  "Musifamiliar Sede Grupal Paquete de 4 clases",
  "Musifamiliar Sede Grupal Paquete de 8 clases",
  "Musifamiliar Sede Grupal Paquete de 12 clases",
  "Musifamiliar Sede Grupal Paquete de 24 clases",

  "Sede Grupal Clase de prueba",
  "Sede Grupal Clase individual",
  "Sede Grupal Paquete de 4 clases",
  "Sede Grupal Paquete de 8 clases",
  "Sede Grupal Paquete de 12 clases",
  "Sede Grupal Paquete de 24 clases",

  "Ensambles Paquete de 4 clases",
  "Ensambles Paquete de 8 clases",
  "Ensambles Paquete de 12 clases",
  "Ensambles Paquete de 24 clases",

  "Musigym 1 mes",
  "Musigym 2 meses",
  "Musigym 3 meses",
  "Musigym 6 meses",

  "Hogar Personalizado Clase de prueba",
  "Hogar Personalizado Clase individual",
  "Hogar Personalizado Paquete de 4 clases",
  "Hogar Personalizado Paquete de 8 clases",
  "Hogar Personalizado Paquete de 12 clases",
  "Hogar Personalizado Paquete de 24 clases",

  "Hogar Musifamiliar Grupal Clase de prueba",
  "Hogar Musifamiliar Grupal Clase individual",
  "Hogar Musifamiliar Grupal Paquete de 4 clases",
  "Hogar Musifamiliar Grupal Paquete de 8 clases",
  "Hogar Musifamiliar Grupal Paquete de 12 clases",
  "Hogar Musifamiliar Grupal Paquete de 24 clases",

  "Virtual Personalizado Clase de prueba",
  "Virtual Personalizado Clase individual",
  "Virtual Personalizado Paquete de 4 clases",
  "Virtual Personalizado Paquete de 8 clases",
  "Virtual Personalizado Paquete de 12 clases",
  "Virtual Personalizado Paquete de 24 clases",

  "Virtual Grupal Clase de prueba",
  "Virtual Grupal Clase individual",
  "Virtual Grupal Paquete de 4 clases",
  "Virtual Grupal Paquete de 8 clases",
  "Virtual Grupal Paquete de 12 clases",
  "Virtual Grupal Paquete de 24 clases",

  "Plataforma Online 1 mes",
  "Plataforma Online 2 meses",
  "Plataforma Online 3 meses",
  "Plataforma Online 6 meses",
  "Plataforma Online 12 meses",

  "Curso Preuniversitario 3 meses",
  "Curso de formación 3 meses",
  "Curso Vacacional Paquete de 20 clases",
  "Curso Vacacional Paquete de 16 clases",

  "Taller empresarial Clase individual",
  "Taller empresarial Paquete de 4 clases",
  "Taller empresarial Paquete de 8 clases",
  "Taller empresarial Paquete de 12 clases",
  "Taller empresarial Paquete de 24 clases"
];

// Defaults UI
const DEFAULTS = {
  base: 50000,
  rounding: 1000,
  globalPct: 0,
  ccFee: false,
  view: "table",
  showOnlyVisible: true,
  compact: false,
  filters: { q:"", mod:"", type:"", classes:"" },

  // NUEVO: análisis SMMLV (usuario pone el valor)
  afford: {
    smmlv: "",     // string para permitir vacío
    max: 3,
    scope: "shown" // shown|all
  }
};

// Config default (lo que editas en modo avanzado)
const CONFIG_DEFAULT = {
  groupFactor: deepClone(FACTOR_BY_GROUP_DEFAULT),
  typeFactor: deepClone(TYPE_FACTOR_DEFAULT),
  packDiscount: deepClone(PACK_DISCOUNT_DEFAULT),
  monthsMult: deepClone(MONTHS_MULT_DEFAULT),
  serviceNames: deepClone(SERVICE_NAMES_DEFAULT)
};

/* ================================
   Parseo inteligente de servicio
================================ */
function parseServiceName(name, config){
  const raw = String(name || "").trim();

  // normaliza variaciones
  const nrm = raw
    .replace(/\bClase Individual\b/i, "Clase individual")
    .replace(/\bPaquete de\b/i, "Paquete de")
    .replace(/\s+/g, " ")
    .trim();

  // Tipo
  let type = "Otro";
  if(/clase de prueba/i.test(nrm)) type = "Clase de prueba";
  else if(/clase individual/i.test(nrm)) type = "Clase individual";
  else if(/paquete de/i.test(nrm)) type = "Pack";
  else if(/\bmes(es)?\b/i.test(nrm)) type = "Mes";
  else type = "Otro";

  // Clases / meses
  let classes = 0;
  let months = 0;

  const mCl = nrm.match(/paquete de\s*(\d+)\s*clases/i);
  if(mCl) classes = safeNumber(mCl[1], 0);

  if(/clase de prueba|clase individual/i.test(nrm)) classes = 1;

  const mMo = nrm.match(/(\d+)\s*mes(es)?/i);
  if(mMo) months = safeNumber(mMo[1], 0);

  // Grupo
  const gf = (config && config.groupFactor) ? config.groupFactor : FACTOR_BY_GROUP_DEFAULT;
  const GROUP_KEYS = Object.keys(gf).sort((a,b)=>b.length-a.length);
  let group = "";
  for(const g of GROUP_KEYS){
    const ng = normalizeText(g);
    if(normalizeText(nrm).includes(ng)){
      group = g;
      break;
    }
  }

  // Fallback por prefijos
  if(!group){
    if(/^sede personalizado/i.test(nrm)) group = "Sede Personalizado";
    else if(/^musifamiliar sede grupal/i.test(nrm)) group = "Musifamiliar Sede Grupal";
    else if(/^sede grupal/i.test(nrm)) group = "Sede Grupal";
    else if(/^ensambles/i.test(nrm)) group = "Ensambles";
    else if(/^hogar personalizado/i.test(nrm)) group = "Hogar Personalizado";
    else if(/^hogar musifamiliar grupal/i.test(nrm)) group = "Hogar Musifamiliar Grupal";
    else if(/^virtual personalizado/i.test(nrm)) group = "Virtual Personalizado";
    else if(/^virtual grupal/i.test(nrm)) group = "Virtual Grupal";
    else if(/^musigym/i.test(nrm)) group = "Musigym";
    else if(/^plataforma online/i.test(nrm)) group = "Plataforma Online";
    else if(/^curso preuniversitario/i.test(nrm)) group = "Curso Preuniversitario";
    else if(/^curso de formacion/i.test(normalizeText(nrm))) group = "Curso de formación";
    else if(/^curso vacacional/i.test(nrm)) group = "Curso Vacacional";
    else if(/^taller empresarial/i.test(nrm)) group = "Taller empresarial";
  }

  // Modalidad para filtro
  let modality = "";
  if(/^sede/i.test(nrm) || /sede/i.test(nrm)) modality = "Sede";
  if(/^hogar/i.test(nrm) || /hogar/i.test(nrm)) modality = "Hogar";
  if(/^virtual/i.test(nrm) || /virtual/i.test(nrm)) modality = "Virtual";
  if(/^musigym/i.test(nrm)) modality = "Musigym";
  if(/^plataforma online/i.test(nrm)) modality = "Online";
  if(/^ensambles/i.test(nrm)) modality = "Ensambles";
  if(/^taller empresarial/i.test(nrm)) modality = "Taller";
  if(/^curso/i.test(nrm)) modality = "Curso";

  // type label para filtro
  let typeLabel = "Otro";
  if(type === "Clase de prueba") typeLabel = "Prueba";
  else if(type === "Clase individual") typeLabel = "Individual";
  else if(type === "Pack") typeLabel = "Pack";
  else if(type === "Mes") typeLabel = "Mes";
  else typeLabel = "Otro";

  return {
    name: nrm,
    group,
    modality,
    typeLabel,
    classes,
    months,
    _search: normalizeText(nrm)
  };
}

/* ================================
   Estado + Persistencia
================================ */
const LS_KEY_V2 = "musicala_price_adjuster_v2";
const LS_KEY_V1 = "musicala_price_adjuster_v1";

let state = {
  base: DEFAULTS.base,
  rounding: DEFAULTS.rounding,
  globalPct: DEFAULTS.globalPct,
  ccFee: DEFAULTS.ccFee,
  view: DEFAULTS.view,
  showOnlyVisible: DEFAULTS.showOnlyVisible,
  compact: DEFAULTS.compact,
  filters: { ...DEFAULTS.filters },
  afford: { ...DEFAULTS.afford }, // ✅ nuevo
  config: deepClone(CONFIG_DEFAULT)
};

function normalizeConfig(cfg){
  const out = deepClone(CONFIG_DEFAULT);

  if(cfg && typeof cfg === "object"){
    if(cfg.groupFactor && typeof cfg.groupFactor === "object") out.groupFactor = { ...out.groupFactor, ...cfg.groupFactor };
    if(cfg.typeFactor && typeof cfg.typeFactor === "object") out.typeFactor = { ...out.typeFactor, ...cfg.typeFactor };
    if(cfg.packDiscount && typeof cfg.packDiscount === "object") out.packDiscount = { ...out.packDiscount, ...cfg.packDiscount };
    if(cfg.monthsMult && typeof cfg.monthsMult === "object") out.monthsMult = { ...out.monthsMult, ...cfg.monthsMult };
    if(Array.isArray(cfg.serviceNames)) out.serviceNames = cfg.serviceNames.slice();
  }

  // Limpieza: números válidos
  for(const k of Object.keys(out.groupFactor)) out.groupFactor[k] = safeNumber(out.groupFactor[k], 1);
  for(const k of Object.keys(out.typeFactor))  out.typeFactor[k]  = safeNumber(out.typeFactor[k], 1);
  for(const k of Object.keys(out.packDiscount)) out.packDiscount[k] = safeNumber(out.packDiscount[k], 1);
  for(const k of Object.keys(out.monthsMult))  out.monthsMult[k]  = safeNumber(out.monthsMult[k], 1);

  // Servicios: trim + remover vacíos + dedupe
  out.serviceNames = out.serviceNames
    .map(s => String(s||"").trim())
    .filter(Boolean);

  const seen = new Set();
  out.serviceNames = out.serviceNames.filter(s=>{
    const key = normalizeText(s);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return out;
}

function loadState(){
  const tryParse = (raw)=>{
    try{ return JSON.parse(raw); }catch(e){ return null; }
  };

  // 1) Intentar v2
  const raw2 = localStorage.getItem(LS_KEY_V2);
  if(raw2){
    const parsed = tryParse(raw2);
    if(parsed){
      state = {
        ...state,
        ...parsed,
        base: safeNumber(parsed.base, state.base),
        rounding: safeNumber(parsed.rounding, state.rounding),
        globalPct: safeNumber(parsed.globalPct, state.globalPct),
        ccFee: !!parsed.ccFee,
        showOnlyVisible: (parsed.showOnlyVisible == null) ? state.showOnlyVisible : !!parsed.showOnlyVisible,
        compact: !!parsed.compact,
        filters: { ...state.filters, ...(parsed.filters||{}) },
        afford: { ...state.afford, ...(parsed.afford||{}) },
        config: normalizeConfig(parsed.config)
      };

      // saneo afford
      state.afford.max = clamp(safeNumber(state.afford.max, 3), 1, 12);
      state.afford.scope = (state.afford.scope === "all") ? "all" : "shown";
      state.afford.smmlv = String(state.afford.smmlv ?? "").trim();

      return;
    }
  }

  // 2) Migrar desde v1 si existe
  const raw1 = localStorage.getItem(LS_KEY_V1);
  if(raw1){
    const parsed = tryParse(raw1);
    if(parsed){
      state = {
        ...state,
        ...parsed,
        base: safeNumber(parsed.base, state.base),
        rounding: safeNumber(parsed.rounding, state.rounding),
        globalPct: safeNumber(parsed.globalPct, state.globalPct),
        ccFee: false,
        filters: { ...state.filters, ...(parsed.filters||{}) },
        afford: { ...DEFAULTS.afford },
        config: deepClone(CONFIG_DEFAULT)
      };
      saveState(); // guarda ya en v2
    }
  }
}

function saveState(){
  try{
    localStorage.setItem(LS_KEY_V2, JSON.stringify(state));
  }catch(e){}
}

/* ================================
   Catálogo dinámico (depende de config)
================================ */
let SERVICES = [];

function rebuildServices(){
  const cfg = state.config || CONFIG_DEFAULT;
  SERVICES = (cfg.serviceNames || []).map(n => parseServiceName(n, cfg));
}

/* ================================
   Motor de cálculo (usa config)
   - ccFee: recargo tarjeta (+6%) al final y re-redondea
================================ */
function computePrice(service, base, rounding, globalPct, config, ccFee){
  const cfg = config || CONFIG_DEFAULT;

  const g = service.group || "";
  const groupFactor = safeNumber((cfg.groupFactor||{})[g], 1);

  // globalPct como multiplicador
  const globalMult = 1 + (safeNumber(globalPct, 0) / 100);

  let finalPrice = 0;

  // SUSCRIPCIONES (meses)
  if(service.typeLabel === "Mes" && service.months > 0){
    const oneMonth = base * groupFactor;
    const mm = cfg.monthsMult || {};
    const multMonths = (mm[service.months] != null)
      ? safeNumber(mm[service.months], service.months)
      : (service.months * 0.95);

    const raw = oneMonth * multMonths * globalMult;
    finalPrice = roundUp(raw, rounding);
  }else{
    // POR CLASES / PAQUETES
    const typeKey =
      service.typeLabel === "Prueba" ? "Clase de prueba" :
      service.typeLabel === "Individual" ? "Clase individual" :
      "Paquete";

    const tf = cfg.typeFactor || {};
    const typeFactor = safeNumber(tf[typeKey], 1);

    const classes = service.classes > 0 ? service.classes : 1;

    const pd = cfg.packDiscount || {};
    const packDisc = (pd[classes] != null) ? safeNumber(pd[classes], 1) : 1;

    // en prueba e individual no aplicamos descuento de paquete
    const isPack = (service.typeLabel === "Pack" || /paquete/i.test(service.name));
    const packMult = isPack ? packDisc : 1;

    const raw = base * groupFactor * typeFactor * classes * packMult * globalMult;
    finalPrice = roundUp(raw, rounding);
  }

  // ✅ Recargo tarjeta AL FINAL y vuelve a redondear
  if(ccFee){
    finalPrice = roundUp(finalPrice * 1.06, rounding);
  }

  return finalPrice;
}

/* ================================
   DOM refs (del index PRO)
================================ */
const $basePrice = qs("#basePrice");
const $rounding  = qs("#rounding");
const $globalPct = qs("#globalPct");
const $ccFee     = qs("#ccFee");

const $btnBaseDown = qs("#btnBaseDown");
const $btnBaseUp   = qs("#btnBaseUp");

const $q        = qs("#q");
const $btnClear = qs("#btnClear");
const $fMod     = qs("#fMod");
const $fType    = qs("#fType");
const $fClasses = qs("#fClasses");

const $viewTable = qs("#viewTable");
const $viewCards = qs("#viewCards");

const $showOnlyVisible = qs("#showOnlyVisible");
const $compactMode     = qs("#compactMode");

const $tableBody = qs("#priceTable");
const $tableWrap = qs("#tableWrap");
const $cardsWrap = qs("#cardsWrap");
const $empty     = qs("#emptyState");
const $btnEmptyReset = qs("#btnEmptyReset");

const $kpiTotal = qs("#kpiTotal");
const $kpiShown = qs("#kpiShown");
const $kpiBase  = qs("#kpiBase");
const $kpiRange = qs("#kpiRange");

const $btnCopy = qs("#btnCopy");
const $btnReset = qs("#btnReset");
const $btnSavePreset = qs("#btnSavePreset");
const $statusBadge = qs("#statusBadge");

const $loader = qs("#loader");

const $btnHelp = qs("#btnHelp");
const $helpModal = qs("#helpModal");

const $toast = qs("#toast");
const $toastMsg = qs("#toastMsg");

// NUEVO: afford modal
const $btnAfford    = qs("#btnAfford");
const $affordModal  = qs("#affordModal");
const $smmlvValue   = qs("#smmlvValue");
const $smmlvMax     = qs("#smmlvMax");
const $affordScope  = qs("#affordScope");
const $affordTable  = qs("#affordTable");

/* ================================
   UI: Modo avanzado (inyectado)
================================ */
let ADV = {
  root: null,
  taServices: null,
  taGroup: null,
  taType: null,
  taPack: null,
  taMonths: null,
  btnApply: null,
  btnReset: null,
  msg: null
};

function kvToText(obj){
  const lines = [];
  for(const k of Object.keys(obj || {})){
    lines.push(`${k} = ${obj[k]}`);
  }
  return lines.join("\n");
}

function textToKV(text, {keyType="string"} = {}){
  const out = {};
  const lines = String(text||"").split("\n");
  for(const lineRaw of lines){
    const line = lineRaw.trim();
    if(!line) continue;
    if(line.startsWith("#") || line.startsWith("//")) continue;

    // soporta "key = value" o "key: value"
    const m = line.match(/^(.+?)[=:]\s*(.+)$/);
    if(!m) continue;

    const keyRaw = String(m[1]||"").trim();
    const valRaw = String(m[2]||"").trim();

    const key = (keyType === "number") ? safeNumber(keyRaw, keyRaw) : keyRaw;
    const val = safeNumber(valRaw, NaN);

    if(!Number.isFinite(val)) continue;
    out[key] = val;
  }
  return out;
}

function ensureAdvancedUI(){
  const details = qs("aside.panel details.details");
  if(!details) return;

  const body = details.querySelector(".details-body");
  if(!body) return;

  // Si ya existe, no duplicar
  if(body.querySelector("[data-adv='1']")) return;

  // Limpia placeholder (si existe)
  const ph = body.querySelector(".placeholder");
  const p  = body.querySelector("p.muted");
  if(ph) ph.remove();
  if(p)  p.remove();

  const wrap = document.createElement("div");
  wrap.dataset.adv = "1";
  wrap.innerHTML = `
    <div class="field">
      <span class="label">Reglas editables</span>
      <span class="hint">Edita en formato: <code>Nombre = 0.95</code>. Líneas vacías se ignoran. Comentarios con # o //</span>
    </div>

    <label class="field">
      <span class="label">Factor por grupo (modalidad)</span>
      <textarea rows="10" class="adv-ta" id="advGroup"></textarea>
      <span class="hint">Ej: <code>Hogar Personalizado = 1.35</code></span>
    </label>

    <label class="field">
      <span class="label">Factor por tipo</span>
      <textarea rows="6" class="adv-ta" id="advType"></textarea>
      <span class="hint">Ej: <code>Clase de prueba = 0.60</code></span>
    </label>

    <label class="field">
      <span class="label">Descuento por paquete (clases)</span>
      <textarea rows="6" class="adv-ta" id="advPack"></textarea>
      <span class="hint">Ej: <code>12 = 0.95</code> (12 clases paga 95%)</span>
    </label>

    <label class="field">
      <span class="label">Multiplicador por meses (suscripciones)</span>
      <textarea rows="6" class="adv-ta" id="advMonths"></textarea>
      <span class="hint">Ej: <code>3 = 2.70</code></span>
    </label>

    <div class="divider"></div>

    <label class="field">
      <span class="label">Lista de servicios</span>
      <textarea rows="12" class="adv-ta" id="advServices" placeholder="1 servicio por línea…"></textarea>
      <span class="hint">1 línea = 1 servicio. Duplicados o vacíos se eliminan.</span>
    </label>

    <div class="btn-row" style="margin-top:12px">
      <button class="btn" type="button" id="advApply">Aplicar cambios</button>
      <button class="btn ghost" type="button" id="advReset">Restaurar defaults</button>
    </div>

    <div class="muted" id="advMsg" style="margin-top:10px"></div>
  `;

  body.appendChild(wrap);

  ADV.root = wrap;
  ADV.taGroup = qs("#advGroup", wrap);
  ADV.taType = qs("#advType", wrap);
  ADV.taPack = qs("#advPack", wrap);
  ADV.taMonths = qs("#advMonths", wrap);
  ADV.taServices = qs("#advServices", wrap);
  ADV.btnApply = qs("#advApply", wrap);
  ADV.btnReset = qs("#advReset", wrap);
  ADV.msg = qs("#advMsg", wrap);

  // Hidratar con config actual
  hydrateAdvancedUI();

  // Bind
  ADV.btnApply?.addEventListener("click", applyAdvancedChanges);
  ADV.btnReset?.addEventListener("click", resetAdvancedToDefaults);
}

function hydrateAdvancedUI(){
  if(!ADV.root) return;

  const cfg = state.config || CONFIG_DEFAULT;
  if(ADV.taGroup)  ADV.taGroup.value  = kvToText(cfg.groupFactor);
  if(ADV.taType)   ADV.taType.value   = kvToText(cfg.typeFactor);
  if(ADV.taPack)   ADV.taPack.value   = kvToText(cfg.packDiscount);
  if(ADV.taMonths) ADV.taMonths.value = kvToText(cfg.monthsMult);
  if(ADV.taServices) ADV.taServices.value = (cfg.serviceNames || []).join("\n");

  if(ADV.msg) ADV.msg.textContent = "Listo para editar. Si borras una regla, esa clave deja de existir.";
}

function applyAdvancedChanges(){
  try{
    const cfg = deepClone(state.config || CONFIG_DEFAULT);

    const newGF = textToKV(ADV.taGroup?.value,  {keyType:"string"});
    const newTF = textToKV(ADV.taType?.value,   {keyType:"string"});
    const newPD = textToKV(ADV.taPack?.value,   {keyType:"string"});
    const newMM = textToKV(ADV.taMonths?.value, {keyType:"string"});

    const newServices = String(ADV.taServices?.value || "")
      .split("\n")
      .map(s=>String(s||"").trim())
      .filter(Boolean);

    if(Object.keys(newGF).length) cfg.groupFactor = { ...cfg.groupFactor, ...newGF };
    if(Object.keys(newTF).length) cfg.typeFactor  = { ...cfg.typeFactor,  ...newTF };
    if(Object.keys(newPD).length) cfg.packDiscount = { ...cfg.packDiscount, ...newPD };
    if(Object.keys(newMM).length) cfg.monthsMult  = { ...cfg.monthsMult,  ...newMM };
    if(newServices.length) cfg.serviceNames = newServices;

    state.config = normalizeConfig(cfg);

    rebuildServices();
    saveState();
    recalc();

    if(ADV.msg) ADV.msg.textContent = "Cambios aplicados ✅";
    showToast("Config aplicada ✅");
  }catch(e){
    if(ADV.msg) ADV.msg.textContent = "No pude aplicar la config (formato raro).";
    showToast("Error aplicando config ❌");
  }
}

function resetAdvancedToDefaults(){
  state.config = deepClone(CONFIG_DEFAULT);
  rebuildServices();
  saveState();
  hydrateAdvancedUI();
  recalc();
  showToast("Defaults restaurados 🧼");
  if(ADV.msg) ADV.msg.textContent = "Defaults restaurados. Sin inventos.";
}

/* ================================
   Render general
================================ */
function setLoading(on){
  if(!$loader) return;
  $loader.hidden = !on;
  $loader.style.display = on ? "flex" : "none";
  $loader.setAttribute("aria-hidden", String(!on));
}

function setBadge(text, tone="ok"){
  if(!$statusBadge) return;
  $statusBadge.textContent = text;
  $statusBadge.dataset.tone = tone;
}

function applyView(){
  const isCards = state.view === "cards";
  if($tableWrap) $tableWrap.hidden = isCards;
  if($cardsWrap) $cardsWrap.hidden = !isCards;

  if($viewTable){
    $viewTable.classList.toggle("on", !isCards);
    $viewTable.setAttribute("aria-selected", String(!isCards));
  }
  if($viewCards){
    $viewCards.classList.toggle("on", isCards);
    $viewCards.setAttribute("aria-selected", String(isCards));
  }

  document.body.classList.toggle("compact", !!state.compact);
}

function getFiltered(){
  const nq = normalizeText(state.filters.q);
  const mod = state.filters.mod || "";
  const type = state.filters.type || "";
  const cls = state.filters.classes || "";

  return SERVICES.filter(s=>{
    if(nq && !s._search.includes(nq)) return false;
    if(mod && s.modality !== mod) return false;
    if(type && s.typeLabel !== type) return false;
    if(cls && String(s.classes || "") !== String(cls)) return false;
    return true;
  });
}

function getVisibleList(){
  return state.showOnlyVisible ? getFiltered() : SERVICES.slice();
}

function computeList(list){
  return list.map(s=>{
    const price = computePrice(s, state.base, state.rounding, state.globalPct, state.config, state.ccFee);
    return { ...s, price };
  });
}

function renderKPIs(allList, shown){
  if($kpiTotal) $kpiTotal.textContent = String(allList.length);
  if($kpiShown) $kpiShown.textContent = String(shown.length);
  if($kpiBase)  $kpiBase.textContent  = formatCOP(state.base);

  if(!$kpiRange) return;

  if(shown.length === 0){
    $kpiRange.textContent = "$0 – $0";
    return;
  }

  const prices = shown.map(x=>x.price).sort((a,b)=>a-b);
  $kpiRange.textContent = `${formatCOP(prices[0])} – ${formatCOP(prices[prices.length-1])}`;
}

function renderTable(rows){
  if(!$tableBody) return;
  $tableBody.innerHTML = "";

  rows.forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.name}</td>
      <td class="right">${formatCOP(r.price)}</td>
    `;
    $tableBody.appendChild(tr);
  });
}

function renderCards(rows){
  if(!$cardsWrap) return;
  $cardsWrap.innerHTML = "";

  rows.forEach(r=>{
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="card-top">
        <div class="card-title">${r.name}</div>
        <div class="card-price">${formatCOP(r.price)}</div>
      </div>
      <div class="card-meta">
        <span class="pill">${r.modality || "—"}</span>
        <span class="pill">${r.typeLabel || "Otro"}</span>
        ${r.classes ? `<span class="pill">${r.classes} clase${r.classes===1?"":"s"}</span>` : ""}
        ${r.months ? `<span class="pill">${r.months} mes${r.months===1?"":"es"}</span>` : ""}
      </div>
    `;
    $cardsWrap.appendChild(el);
  });
}

function renderEmpty(isEmpty){
  if(!$empty) return;
  $empty.hidden = !isEmpty;
}

/* ================================
   Análisis SMMLV
================================ */
function isDialogOpen(dlg){
  return !!dlg && dlg.hasAttribute("open");
}

function getAffordBaseList(){
  // scope = shown => lo que estás “viendo” (si showOnlyVisible OFF, igual se respeta esa lógica de "visible")
  // scope = all   => TODO el catálogo
  if(state.afford.scope === "all") return SERVICES.slice();
  return getVisibleList();
}

function renderAfford(){
  if(!$affordTable) return;

  const smmlv = safeNumber(state.afford.smmlv, 0);
  const max = clamp(safeNumber(state.afford.max, 3), 1, 12);

  $affordTable.innerHTML = "";

  if(!smmlv || smmlv <= 0){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td colspan="5" class="muted" style="padding:14px">
        Pon el valor del SMMLV en COP para calcular porcentajes. (Sí, toca escribirlo… la vida es dura).
      </td>
    `;
    $affordTable.appendChild(tr);
    return;
  }

  // el thead en HTML trae 1..3 fijo. Si el usuario sube max, igual mostramos 1..3 en tabla
  // (si quieres 1..N dinámico, lo hacemos luego cuando ajustemos CSS/HTML del modal).
  const baseList = getAffordBaseList();
  const rows = computeList(baseList);

  rows.forEach(r=>{
    const p1 = (r.price / (smmlv * 1)) * 100;
    const p2 = (r.price / (smmlv * 2)) * 100;
    const p3 = (r.price / (smmlv * 3)) * 100;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.name}</td>
      <td class="right">${formatCOP(r.price)}</td>
      <td class="right">${formatPct(p1)}</td>
      <td class="right">${formatPct(p2)}</td>
      <td class="right">${formatPct(p3)}</td>
    `;
    $affordTable.appendChild(tr);
  });

  // Si el usuario eligió max != 3, lo guardamos igual, pero la tabla aún es 1..3 por diseño del modal.
  // (Ya quedó listo para hacerlo dinámico cuando quieras.)
  void max;
}

function openAffordModal(){
  if(!$affordModal) return;

  // hidrata inputs
  if($smmlvValue) $smmlvValue.value = String(state.afford.smmlv || "");
  if($smmlvMax) $smmlvMax.value = String(state.afford.max || 3);
  if($affordScope) $affordScope.value = state.afford.scope || "shown";

  if($affordModal.showModal) $affordModal.showModal();
  else $affordModal.setAttribute("open","true");

  renderAfford();
}

/* ================================
   Cálculo + Render principal
================================ */
function recalc(){
  setLoading(true);

  const visibleBase = getVisibleList();
  const computed = computeList(visibleBase);

  renderKPIs(SERVICES, computed);

  if(state.view === "cards") renderCards(computed);
  else renderTable(computed);

  renderEmpty(state.showOnlyVisible && computed.length === 0);

  setBadge("Actualizado", "ok");
  setLoading(false);

  // si el modal está abierto, lo actualizamos con lo último (incluye ccFee y filtros)
  if(isDialogOpen($affordModal)) renderAfford();

  saveState();
}

/* ================================
   Copiar
================================ */
function toCopyText(){
  const list = getVisibleList();

  const rows = list.map(s=>{
    const price = computePrice(s, state.base, state.rounding, state.globalPct, state.config, state.ccFee);
    return `${s.name}\t${formatCOP(price)}`;
  });

  return [
    "Ajustador de precios · Musicala",
    `Base (clase pack 4 Sede Personalizado): ${formatCOP(state.base)}`,
    `Redondeo: ${state.rounding ? state.rounding : "Sin redondeo"}`,
    `Ajuste global: ${state.globalPct}%`,
    `Recargo tarjeta: ${state.ccFee ? "Sí (+6%)" : "No"}`,
    "",
    ...rows
  ].join("\n");
}

async function copyToClipboard(){
  const text = toCopyText();
  try{
    await navigator.clipboard.writeText(text);
    showToast("Copiado ✅");
  }catch(e){
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast("Copiado ✅");
  }
}

let toastTimer = null;
function showToast(msg){
  if(!$toast || !$toastMsg) return;
  $toastMsg.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ $toast.hidden = true; }, 1800);
}

/* ================================
   Eventos
================================ */
function bindEvents(){
  // Inputs base
  $basePrice?.addEventListener("input", ()=>{
    state.base = clamp(safeNumber($basePrice.value, DEFAULTS.base), 0, 99999999);
    recalc();
  });
  $rounding?.addEventListener("change", ()=>{
    state.rounding = safeNumber($rounding.value, DEFAULTS.rounding);
    recalc();
  });
  $globalPct?.addEventListener("input", ()=>{
    state.globalPct = clamp(safeNumber($globalPct.value, 0), -99, 300);
    recalc();
  });

  // Recargo tarjeta
  $ccFee?.addEventListener("change", ()=>{
    state.ccFee = !!$ccFee.checked;
    recalc();
  });

  // Botoncitos +/- base
  const STEP = 500;
  $btnBaseDown?.addEventListener("click", ()=>{
    state.base = Math.max(0, state.base - STEP);
    if($basePrice) $basePrice.value = String(state.base);
    recalc();
  });
  $btnBaseUp?.addEventListener("click", ()=>{
    state.base = state.base + STEP;
    if($basePrice) $basePrice.value = String(state.base);
    recalc();
  });

  // Search + filtros
  $q?.addEventListener("input", ()=>{
    state.filters.q = $q.value || "";
    recalc();
  });
  $btnClear?.addEventListener("click", ()=>{
    state.filters.q = "";
    if($q) $q.value = "";
    recalc();
  });
  $fMod?.addEventListener("change", ()=>{
    state.filters.mod = $fMod.value || "";
    recalc();
  });
  $fType?.addEventListener("change", ()=>{
    state.filters.type = $fType.value || "";
    recalc();
  });
  $fClasses?.addEventListener("change", ()=>{
    state.filters.classes = $fClasses.value || "";
    recalc();
  });

  // View
  $viewTable?.addEventListener("click", ()=>{
    state.view = "table";
    applyView();
    recalc();
  });
  $viewCards?.addEventListener("click", ()=>{
    state.view = "cards";
    applyView();
    recalc();
  });

  // Toggles
  $showOnlyVisible?.addEventListener("change", ()=>{
    state.showOnlyVisible = !!$showOnlyVisible.checked;
    recalc();
  });
  $compactMode?.addEventListener("change", ()=>{
    state.compact = !!$compactMode.checked;
    applyView();
    recalc();
  });

  // Copiar
  $btnCopy?.addEventListener("click", copyToClipboard);

  // Modal ayuda
  $btnHelp?.addEventListener("click", ()=>{
    if($helpModal?.showModal) $helpModal.showModal();
    else $helpModal?.setAttribute("open","true");
  });

  // NUEVO: Modal análisis SMMLV
  $btnAfford?.addEventListener("click", openAffordModal);

  $smmlvValue?.addEventListener("input", ()=>{
    state.afford.smmlv = String($smmlvValue.value || "").trim();
    saveState();
    renderAfford();
  });
  $smmlvMax?.addEventListener("change", ()=>{
    state.afford.max = clamp(safeNumber($smmlvMax.value, 3), 1, 12);
    saveState();
    // por ahora no cambia columnas (HTML fijo), pero sí guardamos la intención
    renderAfford();
  });
  $affordScope?.addEventListener("change", ()=>{
    state.afford.scope = ($affordScope.value === "all") ? "all" : "shown";
    saveState();
    renderAfford();
  });

  // Empty reset
  $btnEmptyReset?.addEventListener("click", ()=> resetFiltersOnly());

  // Reset
  $btnReset?.addEventListener("click", resetAll);

  // Preset (placeholder)
  $btnSavePreset?.addEventListener("click", ()=>{
    showToast("Preset (próximo paso) 🙂");
  });
}

function resetFiltersOnly(){
  state.filters = { ...DEFAULTS.filters };
  if($q) $q.value = "";
  if($fMod) $fMod.value = "";
  if($fType) $fType.value = "";
  if($fClasses) $fClasses.value = "";
  recalc();
}

function resetAll(){
  // Reset general mantiene config actual (para no borrarte reglas por accidente)
  const keepConfig = deepClone(state.config || CONFIG_DEFAULT);

  state = {
    ...deepClone(DEFAULTS),
    config: keepConfig
  };

  if($basePrice) $basePrice.value = String(state.base);
  if($rounding) $rounding.value = String(state.rounding);
  if($globalPct) $globalPct.value = String(state.globalPct);
  if($ccFee) $ccFee.checked = !!state.ccFee;

  if($showOnlyVisible) $showOnlyVisible.checked = !!state.showOnlyVisible;
  if($compactMode) $compactMode.checked = !!state.compact;

  // afford UI
  if($smmlvValue) $smmlvValue.value = String(state.afford.smmlv || "");
  if($smmlvMax) $smmlvMax.value = String(state.afford.max || 3);
  if($affordScope) $affordScope.value = state.afford.scope || "shown";

  resetFiltersOnly();
  applyView();
  showToast("Restablecido 🧼 (config avanzada se conserva)");
}

/* ================================
   Init
================================ */
function init(){
  loadState();

  // construir catálogo
  state.config = normalizeConfig(state.config);
  rebuildServices();

  // UI avanzada
  ensureAdvancedUI();

  // hidratar UI desde state
  if($basePrice) $basePrice.value = String(state.base);
  if($rounding) $rounding.value = String(state.rounding);
  if($globalPct) $globalPct.value = String(state.globalPct);
  if($ccFee) $ccFee.checked = !!state.ccFee;

  if($q) $q.value = String(state.filters.q || "");
  if($fMod) $fMod.value = String(state.filters.mod || "");
  if($fType) $fType.value = String(state.filters.type || "");
  if($fClasses) $fClasses.value = String(state.filters.classes || "");

  if($showOnlyVisible) $showOnlyVisible.checked = !!state.showOnlyVisible;
  if($compactMode) $compactMode.checked = !!state.compact;

  // afford inputs
  if($smmlvValue) $smmlvValue.value = String(state.afford.smmlv || "");
  if($smmlvMax) $smmlvMax.value = String(state.afford.max || 3);
  if($affordScope) $affordScope.value = state.afford.scope || "shown";

  applyView();
  bindEvents();

  setBadge("Listo", "ok");
  recalc();
}

init();
