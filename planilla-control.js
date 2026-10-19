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

export function detectarCiclo(texto) {
  const numeros = [...String(texto).matchAll(/\bciclo[\s_:#-]*(\d+)\b/gi)].map(m => Number(m[1]));
  const unicos = [...new Set(numeros)];
  if (unicos.length > 1) throw new Error("El archivo identifica varios ciclos diferentes.");
  return unicos[0] ?? null;
}
export function reconocerPeriodo(nombre, encabezado, ciclo, mes) {
  const mesNombre = detectarMes(nombre), mesContenido = detectarMes(encabezado);
  if (mesNombre && mesContenido && mesNombre !== mesContenido) throw new Error("El mes del nombre y del contenido no coinciden.");
  const cicloNombre = detectarCiclo(nombre), cicloContenido = detectarCiclo(encabezado);
  if (cicloNombre !== null && cicloContenido !== null && cicloNombre !== cicloContenido) throw new Error("El ciclo del nombre y del contenido no coinciden.");
  const numero = cicloContenido ?? cicloNombre;
  if (numero !== null) {
    if (!ciclo) throw new Error(`El archivo corresponde al Ciclo ${numero}. Selecciona ese ciclo para continuar.`);
    if (detectarCiclo(ciclo.nombre) !== numero) throw new Error(`El archivo corresponde al Ciclo ${numero}, pero seleccionaste ${ciclo.nombre}.`);
  }
  const mesExplicito = mesContenido || mesNombre;
  const mesCiclo = numero !== null && /^\d{4}-\d{2}-\d{2}$/.test(ciclo?.fechaInicioClases || "") ? ciclo.fechaInicioClases.slice(0, 7) : "";
  const mesDetectado = mesExplicito || mesCiclo;
  if (!mesDetectado) throw new Error("No pude reconocer el periodo. Selecciona el ciclo indicado en el archivo o identifica el mes y año en su nombre.");
  if (mesDetectado !== mes) throw new Error(`El archivo corresponde a ${mesDetectado}. Revisa el mes seleccionado (${mes}).`);
  return { mesDetectado, cicloDetectado: numero, periodoPorCiclo: !mesExplicito && !!mesCiclo };
}
