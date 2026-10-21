export const REMITENTE = "adminmusicala@gmail.com";
export const PARA = ["asesorintegral1@fesicol.com", "jefeunidadfinanciera@fesicol.com"];
export const COPIA = ["imusicala@gmail.com"];
const CLIENT_ID = "501861978891-732b04cfv8jbr2os91ch457d36e3lvqq.apps.googleusercontent.com";
let conexion = null;
let carga = null;
export function cargarGmail() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (carga) return carga;
  carga = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = resolve;
    script.onerror = () => { carga = null; reject(new Error("No se pudo cargar la conexión de Google. Revisa tu conexión y vuelve a abrir la vista previa.")); };
    document.head.appendChild(script);
  });
  return carga;
}
export function gmailConectado() { return !!conexion && conexion.expira > Date.now() + 60000; }
export function conectarGmail() {
  return new Promise((resolve, reject) => {
    const cliente = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: "openid email https://www.googleapis.com/auth/gmail.send",
      include_granted_scopes: false,
      hint: REMITENTE,
      error_callback: () => reject(new Error("No se completó la autorización de Gmail. Permite la ventana de Google e inténtalo otra vez.")),
      callback: async respuesta => {
        conexion = null;
        try {
          if (respuesta.error || !respuesta.access_token) throw new Error("No se autorizó el envío de correo.");
          if (!google.accounts.oauth2.hasGrantedAllScopes(respuesta, "https://www.googleapis.com/auth/gmail.send")) throw new Error("Debes autorizar el permiso para enviar correos.");
          const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${respuesta.access_token}` } });
          if (!r.ok) throw new Error("No se pudo verificar la cuenta autorizada.");
          const cuenta = await r.json();
          if (cuenta.email?.toLowerCase() !== REMITENTE || !cuenta.email_verified) throw new Error(`Selecciona ${REMITENTE}; la cuenta elegida no corresponde al remitente.`);
          conexion = { token: respuesta.access_token, expira: Date.now() + Number(respuesta.expires_in || 3600) * 1000 };
          resolve();
        } catch (e) { reject(e); }
      }
    });
    cliente.requestAccessToken({ prompt: "select_account" });
  });
}
function base64Texto(texto) {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  for (let i = 0; i < bytes.length; i += 8192) binario += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binario);
}
export function construirCorreo({ asunto, mensaje, pdfBase64, nombrePdf }) {
  if (!asunto.trim() || /[\r\n]/.test(asunto) || asunto.length > 200) throw new Error("Revisa el asunto (máximo 200 caracteres, sin saltos de línea).");
  if (!mensaje.trim()) throw new Error("Escribe el mensaje del correo.");
  if (!/^[A-Za-z0-9+/=]+$/.test(pdfBase64 || "")) throw new Error("No se pudo preparar el PDF adjunto.");
  if (!/^[A-Za-z0-9-]+\.pdf$/.test(nombrePdf)) throw new Error("Nombre de adjunto inválido.");
  const boundary = `musicala_${crypto.randomUUID()}`;
  const lineas = s => s.match(/.{1,76}/g)?.join("\r\n") || "";
  const mime = [
    `From: Musicala <${REMITENTE}>`, `To: ${PARA.join(", ")}`, `Cc: ${COPIA.join(", ")}`,
    `Subject: =?UTF-8?B?${base64Texto(asunto)}?=`, "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", lineas(base64Texto(mensaje)),
    `--${boundary}`, `Content-Type: application/pdf; name="${nombrePdf}"`,
    `Content-Disposition: attachment; filename="${nombrePdf}"`, "Content-Transfer-Encoding: base64", "", lineas(pdfBase64), `--${boundary}--`, ""
  ].join("\r\n");
  return base64Texto(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function enviarCorreoGmail(datos) {
  if (!gmailConectado()) throw new Error("Conecta de nuevo adminmusicala@gmail.com antes de enviar.");
  let r;
  try {
    r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", headers: { Authorization: `Bearer ${conexion.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: construirCorreo(datos) })
    });
  } catch (_) { throw new Error("No se pudo confirmar el resultado. Revisa Enviados en Gmail antes de volver a intentar, para evitar duplicados."); }
  const resultado = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) conexion = null;
    const error = new Error(resultado.error?.message || "Gmail rechazó el envío.");
    error.httpStatus = r.status;
    throw error;
  }
  if (!resultado.id) throw new Error("Gmail no devolvió confirmación. Revisa Enviados antes de intentar nuevamente.");
  return resultado.id;
}
