const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { Resend } = require("resend");

admin.initializeApp();
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const ADMIN_EMAILS = new Set([
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com",
  "adminmusicala@gmail.com",
  "musicalaasesor@gmail.com"
]);
const DESTINATARIO_FESICOL = "asesorintegral1@fesicol.com";

function escapeHtml(value) {
  return String(value || "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
}

function requireAdmin(request) {
  const email = String(request.auth?.token?.email || "").trim().toLowerCase();
  if (!request.auth || !ADMIN_EMAILS.has(email)) {
    throw new HttpsError("permission-denied", "Solo un administrador puede enviar una prefactura.");
  }
  return email;
}

exports.enviarPreFactura = onCall({ region: "us-central1", secrets: [RESEND_API_KEY], timeoutSeconds: 60, memory: "512MiB" }, async (request) => {
  const emailAdmin = requireAdmin(request);
  const data = request.data || {};
  const preFacturaId = String(data.preFacturaId || "");
  const numeroPreFactura = String(data.numeroPreFactura || "");
  const pdfBase64 = String(data.pdfBase64 || "");
  if (!preFacturaId || !/^PF-[A-Z0-9-]{6,40}$/.test(numeroPreFactura) || !pdfBase64) {
    throw new HttpsError("invalid-argument", "La prefactura no tiene datos válidos para envío.");
  }
  if (Buffer.byteLength(pdfBase64, "base64") > 9 * 1024 * 1024) {
    throw new HttpsError("invalid-argument", "El PDF supera el tamaño permitido para correo.");
  }
  const ref = admin.firestore().collection("preFacturas").doc(preFacturaId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "La prefactura ya no existe.");
  const prefactura = snap.data();
  if (prefactura.estado !== "Confirmado") throw new HttpsError("failed-precondition", "Confirma los datos antes de enviar la prefactura.");
  if (prefactura.numeroPreFactura && prefactura.numeroPreFactura !== numeroPreFactura) {
    throw new HttpsError("failed-precondition", "El número de prefactura no coincide con el registro aprobado.");
  }
  const resend = new Resend(RESEND_API_KEY.value());
  const resultado = await resend.emails.send({
    from: "Musicala FESICOL <facturacion@musicala.co>",
    to: [DESTINATARIO_FESICOL],
    subject: `Prefactura ${numeroPreFactura} - ${prefactura.asociado || "FESICOL"}`,
    html: `<p>Hola,</p><p>Adjuntamos la prefactura <strong>${escapeHtml(numeroPreFactura)}</strong> correspondiente a <strong>${escapeHtml(prefactura.asociado || "FESICOL")}</strong>.</p><p>Este documento es informativo y previo a la factura electrónica DIAN.</p><p>Musicala</p>`,
    attachments: [{ filename: `${numeroPreFactura}.pdf`, content: pdfBase64 }]
  });
  if (resultado.error) throw new HttpsError("internal", "El proveedor de correo rechazó el envío.");
  await ref.update({
    enviadoAt: admin.firestore.FieldValue.serverTimestamp(), enviadoA: DESTINATARIO_FESICOL,
    enviadoPor: emailAdmin, ultimoCorreoId: resultado.data?.id || "", updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true, destinatario: DESTINATARIO_FESICOL, correoId: resultado.data?.id || "" };
});
