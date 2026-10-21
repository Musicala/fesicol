import { getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-functions.js";
export const CALLBACK = "https://us-central1-manager-fesicol.cloudfunctions.net/fesicolGmailCallback";
export const CAMPOS = ["periodo", "cicloId", "ciclo", "items", "total", "estado", "confirmadoAt", "confirmadoPor", "facturadoA", "asociado", "documento", "telefono", "numeroPreFactura", "consolidada"];
function canonical(v) {
  if (v === undefined) return null;
  if (v === null || typeof v !== "object") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (Array.isArray(v)) return v.map(canonical);
  return Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonical(v[k])]));
}
export async function hashPrefactura(p) {
  const datos = Object.fromEntries(CAMPOS.filter(k => p[k] !== undefined).map(k => [k,p[k]]));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(datos)))))].map(b => b.toString(16).padStart(2,"0")).join("");
}
export async function llamar(nombre, data = {}) {
  const r = await httpsCallable(getFunctions(getApp(), "us-central1"), nombre, { timeout:120000 })(data);
  return r.data;
}
export function textoError(e) { return e?.message || "No fue posible conectar con el servicio de programación."; }
export async function conectar(file) {
  let clientSecret;
  if (file) {
    if (file.size > 20000) throw new Error("Selecciona el archivo de texto o JSON del secreto OAuth.");
    const text = (await file.text()).trim();
    if (text.startsWith("{")) {
      const j = JSON.parse(text); const conf = j.web || j.installed || j;
      if (conf.client_id && conf.client_id !== "501861978891-732b04cfv8jbr2os91ch457d36e3lvqq.apps.googleusercontent.com") throw new Error("El archivo pertenece a otro cliente OAuth.");
      clientSecret = conf.client_secret;
    } else clientSecret = text;
    if (!clientSecret) throw new Error("No se encontró el secreto del cliente en el archivo.");
  }
  const r = await llamar("fesicolGmailIniciar", clientSecret ? {clientSecret} : {});
  window.location.assign(r.url);
}
