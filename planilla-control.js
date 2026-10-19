export function siguienteMes(mes) {
  const [y, m] = mes.split("-").map(Number);
  return `${y + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
}
export function validarPlanilla(meta, historial) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(meta.mes || "")) throw new Error("Selecciona un mes válido para la planilla.");
  if (!meta.huella) throw new Error("Vuelve a leer el archivo antes de importar.");
  if (historial.some(p => p.huella === meta.huella)) throw new Error("Este archivo ya fue importado, aunque tenga otro nombre.");
  const meses = historial.map(p => p.mes).filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || "")).sort();
  const ultimo = meses.at(-1);
  if (ultimo && (meta.mes < ultimo || meta.mes > siguienteMes(ultimo))) throw new Error(`Puedes importar una planilla de ${ultimo} o de ${siguienteMes(ultimo)}. No se permiten meses anteriores ni saltos de mes.`);
  if (meta.mesDetectado && meta.mesDetectado !== meta.mes) throw new Error(`El archivo corresponde a ${meta.mesDetectado}, pero seleccionaste ${meta.mes}.`);
}
export function detectarMes(texto) {
  const s = String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const encontrados = new Set();
  for (const m of s.matchAll(/\b(20\d{2})[-_ .\/](0?[1-9]|1[0-2])\b/g)) encontrados.add(`${m[1]}-${m[2].padStart(2, "0")}`);
  const nombres = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split(" ");
  for (const m of s.matchAll(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)[\s_.-]*(?:de[\s_.-]*)?(20\d{2})\b/g)) encontrados.add(`${m[2]}-${String(nombres.indexOf(m[1]) + 1).padStart(2, "0")}`);
  if (encontrados.size > 1) throw new Error("El archivo menciona varios periodos. Usa una planilla que identifique un único mes y año.");
  return [...encontrados][0] || "";
}
