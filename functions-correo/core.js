const crypto = require("node:crypto");
const REMITENTE = "adminmusicala@gmail.com";
const PARA = ["asesorintegral1@fesicol.com", "jefeunidadfinanciera@fesicol.com"];
const CC = ["imusicala@gmail.com"];
const CLIENT_ID = "501861978891-732b04cfv8jbr2os91ch457d36e3lvqq.apps.googleusercontent.com";
const CALLBACK = "https://us-central1-manager-fesicol.cloudfunctions.net/fesicolGmailCallback";
const ZONA = "America/Bogota";
const CAMPOS = ["periodo", "cicloId", "ciclo", "items", "total", "estado", "confirmadoAt", "confirmadoPor", "facturadoA", "asociado", "documento", "telefono", "numeroPreFactura", "consolidada"];
function canonical(v) {
  if (v === undefined) return null;
  if (v === null || typeof v !== "object") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (Array.isArray(v)) return v.map(canonical);
  return Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonical(v[k])]));
}
function hash(v) { return crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(canonical(v))).digest("hex"); }
function datosPrefactura(p) { return Object.fromEntries(CAMPOS.filter(k => p[k] !== undefined).map(k => [k, p[k]])); }
function fechaEnvio(periodo) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(periodo || "")) throw new Error("La prefactura necesita un periodo válido.");
  return new Date(`${periodo}-20T10:00:00-05:00`);
}
function periodoColombia(fecha = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit" }).format(fecha).replace(/^(\d{2})\/(\d{4})$/, "$2-$1"); }
function fechaColombia(fecha) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ZONA, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit",hourCycle:"h23" }).formatToParts(fecha).map(x => [x.type,x.value]));
  return { periodo: `${parts.year}-${parts.month}`, dia: Number(parts.day), hora: Number(parts.hour) };
}
function validarContenido({ asunto, mensaje, pdfBase64, nombrePdf }) {
  if (typeof asunto !== "string" || !asunto.trim() || asunto.length > 200 || /[\r\n]/.test(asunto)) throw new Error("Revisa el asunto del correo.");
  if (typeof mensaje !== "string" || !mensaje.trim() || mensaje.length > 20000) throw new Error("Revisa el mensaje (máximo 20.000 caracteres).");
  if (!/^[A-Za-z0-9-]+\.pdf$/.test(nombrePdf || "")) throw new Error("El nombre del PDF es inválido.");
  if (typeof pdfBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)) throw new Error("El adjunto no es un PDF válido.");
  const pdf = Buffer.from(pdfBase64, "base64");
  if (pdf.length > 4 * 1024 * 1024 || pdf.subarray(0,5).toString() !== "%PDF-") throw new Error("El adjunto debe ser un PDF de máximo 4 MB.");
}
function cifrar(v, key) {
  const iv = crypto.randomBytes(12), clave = Buffer.from(key, "base64");
  if (clave.length !== 32) throw new Error("Clave de cifrado no configurada.");
  const cipher = crypto.createCipheriv("aes-256-gcm", clave, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(v), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}
function descifrar(v, key) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), Buffer.from(v.iv,"base64"));
  decipher.setAuthTag(Buffer.from(v.tag,"base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(v.data,"base64")),decipher.final()]).toString("utf8"));
}
function construirMime(datos, messageId) {
  validarContenido(datos);
  const b = `musicala_${crypto.randomUUID()}`, base = s => Buffer.from(s,"utf8").toString("base64"), lines = s => s.match(/.{1,76}/g).join("\r\n");
  return Buffer.from([
    `From: Musicala <${REMITENTE}>`, `To: ${PARA.join(", ")}`, `Cc: ${CC.join(", ")}`,
    `Message-ID: <${messageId}@manager-fesicol.web.app>`, `Subject: =?UTF-8?B?${base(datos.asunto)}?=`, "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${b}"`, "", `--${b}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", lines(base(datos.mensaje)),
    `--${b}`, `Content-Type: application/pdf; name="${datos.nombrePdf}"`, `Content-Disposition: attachment; filename="${datos.nombrePdf}"`, "Content-Transfer-Encoding: base64", "", lines(datos.pdfBase64), `--${b}--`, ""
  ].join("\r\n"),"utf8").toString("base64url");
}
function puedeEnviar(p, job, sourceHash, ahora = new Date()) {
  if (!p || p.estado !== "Confirmado" || !p.confirmadoAt) return "La prefactura no está confirmada.";
  if (p.enviadoAt || p.ultimoCorreoId) return "La prefactura ya tiene un envío registrado.";
  if (job.estado !== "programado") return "El envío no está programado o ya tiene un intento en curso.";
  if (fechaColombia(ahora).periodo !== p.periodo) return "La prefactura no corresponde al mes actual.";
  if (ahora < fechaEnvio(p.periodo)) return "Aún no llega la fecha de envío.";
  if (job.sourceHash !== sourceHash) return "Cambiaron los datos aprobados; requiere nueva revisión.";
  return "";
}

function validarInscritos(p, inscripciones, estudiantes) {
  const norm = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g," ");
  const activos = inscripciones.filter(i => ["Inscrito","Activo"].includes(i.estado || "Inscrito"));
  if (!activos.length || !Array.isArray(p.items) || p.items.length !== activos.length) throw new Error("La prefactura no coincide con los inscritos actuales. Actualiza los datos previos y confirma de nuevo.");
  const nombres = new Map(estudiantes.map(e => [e.id,e.datos?.nombre]));
  const firma = (nombre,modalidad,duracion,valor) => JSON.stringify([norm(nombre),norm(modalidad),norm(duracion),Number(valor || 0)]);
  const actual = activos.map(i=>firma(nombres.get(i.estudianteId)||i.estudianteNombre,i.modalidad,i.duracion,i.paqueteMusifamiliarId && !i.beneficiarioPrincipal?0:i.precio)).sort();
  const aprobado = p.items.map(i=>firma(i.estudiante,i.modalidad,i.duracion,i.valor)).sort();
  const total = activos.reduce((sum,i)=>sum+(i.paqueteMusifamiliarId && !i.beneficiarioPrincipal?0:Number(i.precio || 0)),0);
  if (!Number.isFinite(total) || !Number.isFinite(Number(p.total)) || JSON.stringify(actual)!==JSON.stringify(aprobado) || Math.abs(total-Number(p.total))>0.01) throw new Error("La prefactura no coincide con los inscritos o valores actuales. Actualiza los datos previos y confirma de nuevo.");
}

module.exports = { validarInscritos, REMITENTE, PARA, CC, CLIENT_ID, CALLBACK, ZONA, canonical, hash, datosPrefactura, fechaEnvio, fechaColombia, validarContenido, cifrar, descifrar, construirMime, puedeEnviar };
