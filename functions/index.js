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

// Pago consolidado en Clientes; RIP activa los planes Wix por inscripción.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { getFirestore } = require("firebase-admin/firestore");
const { createSynchronizer } = require("./fesicol-rip");
const ripApp = admin.initializeApp({ projectId: "rip-musicala" }, "rip");
const syncRipCycle = createSynchronizer({
  source: admin.firestore(), destination: getFirestore(ripApp),
  timestamp: () => admin.firestore.FieldValue.serverTimestamp(),
  today: () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
});

async function syncRipWithStatus(cicloId, options) {
  const status = admin.firestore().collection("ripSincronizaciones").doc(cicloId);
  try {
    const result = await syncRipCycle(cicloId, options);
    await status.set({ ...result, estado: "sincronizado", error: "", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return result;
  } catch (error) {
    console.error("FESICOL → RIP", cicloId, error);
    await status.set({ estado: "error", error: "No se pudo actualizar el pago en RIP. Revisa los datos y reintenta; si continúa, revisa los permisos de integración.", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
}

exports.sincronizarInscripcionRIP = onDocumentWritten({
  document: "inscripciones/{inscripcionId}", region: "us-central1", retry: true,
  timeoutSeconds: 120
}, async event => {
  const cycleIds = new Set([
    event.data?.before.data()?.cicloId, event.data?.after.data()?.cicloId
  ].filter(Boolean));
  // Al cambiar de ciclo se actualizan ambos pagos; al borrar, el anterior.
  const results = await Promise.allSettled([...cycleIds].map(id => syncRipWithStatus(id)));
  const failed = results.find(result => result.status === "rejected");
  if (failed) throw failed.reason;
});

exports.sincronizarCicloRIP = onCall({ region: "us-central1", timeoutSeconds: 120 }, async request => {
  const email = String(request.auth?.token?.email || "").toLowerCase();
  if (!request.auth || !(ADMIN_EMAILS.has(email) || email === "imusicala@gmail.com")) {
    throw new HttpsError("permission-denied", "Solo un administrador puede sincronizar pagos.");
  }
  const cicloId = String(request.data?.cicloId || "");
  if (!cicloId || cicloId.includes("/") || cicloId.length > 1500) {
    throw new HttpsError("invalid-argument", "Selecciona un ciclo válido.");
  }
  try { return await syncRipWithStatus(cicloId, { retryWix: true }); }
  catch (_) { throw new HttpsError("failed-precondition", "No se pudo sincronizar el pago. Revisa la configuración de RIP y vuelve a intentar."); }
});

exports.sincronizarEstudianteRIP = onDocumentWritten({
  document: "estudiantes/{estudianteId}", region: "us-central1", retry: true, timeoutSeconds: 120
}, async event => {
  const before = event.data?.before.data() || {};
  const after = event.data?.after.data() || {};
  if (["nombre", "wixEmail", "email", "correo"].every(key => before[key] === after[key])) return;
  const rows = await admin.firestore().collection("inscripciones")
    .where("estudianteId", "==", event.params.estudianteId).get();
  const cycleIds = new Set(rows.docs.map(doc => doc.data().cicloId).filter(Boolean));
  const results = await Promise.allSettled([...cycleIds].map(id => syncRipWithStatus(id)));
  const failed = results.find(result => result.status === "rejected");
  if (failed) throw failed.reason;
});

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
