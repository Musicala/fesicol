const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("node:crypto");
const C = require("./core");
admin.initializeApp();
const db = admin.firestore();
const KEY = defineSecret("FESICOL_CORREO_CIFRADO");
const opciones = { region: "us-central1", secrets: [KEY], timeoutSeconds: 120, memory: "512MiB", cors: ["https://manager-fesicol.web.app", "https://manager-fesicol.firebaseapp.com"] };
const ADMINS = new Set(["alekcaballeromusic@gmail.com", "catalina.medina.leal@gmail.com", "adminmusicala@gmail.com", "imusicala@gmail.com", "musicalaasesor@gmail.com"]);
const stamp = () => admin.firestore.FieldValue.serverTimestamp();
const configRef = db.doc("fesicolCorreoConfig/gmail");
const jobRef = id => db.doc(`fesicolCorreoEnvios/${C.hash(id)}`);
function requireAdmin(req) {
  const email = req.auth?.token?.email?.toLowerCase();
  if (!req.auth || !ADMINS.has(email)) throw new HttpsError("permission-denied", "Solo administradores de Musicala pueden configurar envíos.");
  return email;
}
function idValido(id) { if (typeof id !== "string" || !id || id.length > 300 || id.includes("/")) throw new HttpsError("invalid-argument", "Prefactura inválida."); return id; }
async function lectura(read, ref) {
  const s = await read(ref);
  if (!s.exists) throw new HttpsError("not-found", "La prefactura no existe.");
  const p = s.data();
  const ins = await read(db.collection("inscripciones").where("cicloId", "==", p.cicloId || ""));
  const inscripciones = ins.docs.filter(d => d.data().mes === p.periodo).map(d => ({ id: d.id, ...d.data() }));
  const plans = await read(db.collection("planillas").where("mes", "==", p.periodo || ""));
  const planillas = plans.docs.filter(d => !d.data().tipo && (!d.data().cicloId || d.data().cicloId === p.cicloId)).map(d => ({id:d.id,...d.data()}));
  const ids = [...new Set(inscripciones.flatMap(i => [i.estudianteId,...(i.beneficiarios || []).map(b => b.estudianteId)]).filter(id => typeof id === "string" && !id.includes("/")))].sort();
  const estudiantes = [];
  for (const id of ids) { const e = await read(db.doc(`estudiantes/${id}`)); estudiantes.push({id,datos:e.exists?e.data():null}); }
  let ciclo = null;
  if (p.cicloId) { const c = await read(db.doc(`ciclos/${p.cicloId}`)); ciclo = c.exists ? c.data() : null; }
  const sourceHash = C.hash({ prefactura:C.datosPrefactura(p), inscripciones:inscripciones.sort((a,b)=>a.id.localeCompare(b.id)), planillas:planillas.sort((a,b)=>a.id.localeCompare(b.id)), estudiantes, ciclo });
  return { p, sourceHash, inscritos:inscripciones.length, planillas:planillas.length, inscripciones, estudiantes };
}
async function estadoPrefactura(id) { return lectura(ref => ref.get(), db.doc(`preFacturas/${id}`)); }
function esConfirmada(p) {
  if (p.estado !== "Confirmado" || !p.confirmadoAt) throw new HttpsError("failed-precondition", "Primero confirma la prefactura y revisa los inscritos y la planilla.");
  if (p.enviadoAt || p.ultimoCorreoId) throw new HttpsError("failed-precondition", "La prefactura ya fue enviada. No se programará un segundo envío.");
}
async function guardarEstado(id, estado, extra = {}) {
  const prefRef=db.doc(`preFacturas/${id}`);
  await db.runTransaction(async tx=>{
    const p=await tx.get(prefRef);
    tx.set(jobRef(id),{estado,...extra,updatedAt:stamp()},{merge:true});
    if(p.exists)tx.update(prefRef,{correoAutomaticoEstado:estado,...(extra.mensaje?{correoAutomaticoAviso:extra.mensaje}:{}),updatedAt:stamp()});
  });
}

exports.fesicolCorreoEstado = onCall(opciones, async req => {
  requireAdmin(req);
  const conf = await configRef.get();
  const conexion = conf.exists && conf.data().conectado === true;
  let prefactura = null;
  if (req.data?.preFacturaId) {
    const id = idValido(req.data.preFacturaId), data = await estadoPrefactura(id), snap = await jobRef(id).get();
    const job = snap.exists ? snap.data() : {};
    prefactura = { sourceHash:data.sourceHash, hashPrefactura:C.hash(C.datosPrefactura(data.p)), inscritos:data.inscritos, planillas:data.planillas, estado:job.estado || "sin_programar", fecha:job.fecha || null, aviso:job.mensaje || "" };
    if (job.estado === "programado" && (job.sourceHash !== data.sourceHash || data.p.estado !== "Confirmado")) {
      await guardarEstado(id,"requiere_revision",{mensaje:"Cambiaron los datos aprobados. Revisa y programa nuevamente."});
      prefactura.estado="requiere_revision";prefactura.aviso="Cambiaron los datos aprobados. Revisa y programa nuevamente.";
    }
    if (req.data.incluirContenido === true && prefactura.estado === "programado") {
      const [buffer] = await admin.storage().bucket("manager-fesicol.firebasestorage.app").file(job.path).download();
      const correo = C.descifrar(JSON.parse(buffer.toString()),KEY.value());
      if (C.hash(correo) !== job.correoHash) throw new HttpsError("failed-precondition","La copia aprobada no coincide. Cancela y revisa la programación.");
      prefactura.correo = correo;
    }
  }
  return { conectado:conexion, remitente:C.REMITENTE, configurado:!!conf.data()?.secret, error:conf.data()?.error || "", horario:"Día 20 · 10:00 a. m. · Colombia", callback:C.CALLBACK, prefactura };
});
exports.fesicolGmailIniciar = onCall(opciones, async req => {
  const email = requireAdmin(req);
  const conf = await configRef.get();
  let secret = conf.data()?.secret;
  if (req.data?.clientSecret) {
    const value = String(req.data.clientSecret).trim();
    if (value.length < 15 || value.length > 500 || /\s/.test(value)) throw new HttpsError("invalid-argument", "Archivo de secreto inválido.");
    secret = C.cifrar(value,KEY.value());
  }
  if (!secret) throw new HttpsError("failed-precondition", "Carga el archivo del secreto OAuth para configurar Gmail automático.");
  const state = crypto.randomBytes(32).toString("base64url");
  await db.doc(`fesicolCorreoOAuth/${C.hash(state)}`).set({ email,uid:req.auth.uid,expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+10*60*1000),secret,used:false });
  const params = new URLSearchParams({client_id:C.CLIENT_ID,redirect_uri:C.CALLBACK,response_type:"code",scope:"openid email https://www.googleapis.com/auth/gmail.send",access_type:"offline",prompt:"consent select_account",login_hint:C.REMITENTE,state});
  return { url:`https://accounts.google.com/o/oauth2/v2/auth?${params}` };
});
exports.fesicolGmailCallback = onRequest({ ...opciones, cors:false, invoker:"public" }, async (req,res) => {
  res.set("Cache-Control","no-store");res.set("Referrer-Policy","no-referrer");
  try {
    if (req.method !== "GET") return res.status(405).send("Método no permitido.");
    const state = String(req.query.state || "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error("Autorización inválida. Vuelve a conectar desde FESICOL.");
    const ref = db.doc(`fesicolCorreoOAuth/${C.hash(state)}`);
    const sesion = await db.runTransaction(async tx => {
      const s = await tx.get(ref);
      if (!s.exists || s.data().used || s.data().expiresAt.toMillis() < Date.now()) throw new Error("La autorización expiró. Vuelve a conectar desde FESICOL.");
      tx.update(ref,{used:true});return s.data();
    });
    if (req.query.error || !req.query.code) throw new Error("No se concedió la autorización de Google.");
    const clientSecret = C.descifrar(sesion.secret,KEY.value());
    const oauth = new OAuth2Client(C.CLIENT_ID,clientSecret,C.CALLBACK);
    const {tokens} = await oauth.getToken(String(req.query.code));
    if (!tokens.id_token || !tokens.refresh_token || !String(tokens.scope || "").split(" ").includes("https://www.googleapis.com/auth/gmail.send")) throw new Error("Falta la autorización de envío sin conexión. Conecta de nuevo y acepta el permiso.");
    const ticket = await oauth.verifyIdToken({idToken:tokens.id_token,audience:C.CLIENT_ID});
    const cuenta = ticket.getPayload();
    if (cuenta.email !== C.REMITENTE || cuenta.email_verified !== true) throw new Error(`Debes autorizar ${C.REMITENTE}.`);
    await configRef.set({secret:sesion.secret,refresh:C.cifrar(tokens.refresh_token,KEY.value()),conectado:true,remitente:C.REMITENTE,conectadoPor:sesion.email,updatedAt:stamp(),error:""});
    await ref.delete();
    res.status(200).send('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Gmail conectado</title><body style="font-family:system-ui;padding:32px"><h1 style="color:#166534">✓ Gmail automático conectado</h1><p>adminmusicala@gmail.com ya permite enviar las prefacturas aprobadas con FESICOL cerrado.</p><p>No se ha enviado ningún correo.</p><a href="https://manager-fesicol.web.app/">Volver a FESICOL</a></body></html>');
  } catch (error) {
    logger.warn("No se completó la conexión OAuth de FESICOL",{tipo:error.constructor.name});
    // No exponer errores de Google que puedan contener códigos o credenciales.
    res.status(400).send('<!doctype html><html lang="es"><meta charset="utf-8"><body style="font-family:system-ui;padding:32px"><h1>No se completó la conexión</h1><p>Vuelve a FESICOL y autoriza adminmusicala@gmail.com con el permiso de envío. Verifica la URI de retorno configurada en Google Cloud.</p><a href="https://manager-fesicol.web.app/">Volver a FESICOL</a></body></html>');
  }
});
exports.fesicolProgramarPrefactura = onCall(opciones,async req => {
  const email=requireAdmin(req), id=idValido(req.data?.preFacturaId), datos=req.data?.correo;
  if (req.data?.revisionConfirmada !== true) throw new HttpsError("failed-precondition","Confirma que revisaste planilla, inscritos, mensaje y PDF.");
  try { C.validarContenido(datos || {}); } catch(e) { throw new HttpsError("invalid-argument",e.message); }
  const conf=await configRef.get();
  if (!conf.data()?.conectado) throw new HttpsError("failed-precondition","Primero conecta Gmail automático.");
  const version=crypto.randomUUID(), path=`fesicol-correo-aprobado/${C.hash(id)}/${version}.json`;
  const cifrado=C.cifrar(datos,KEY.value());
  await admin.storage().bucket("manager-fesicol.firebasestorage.app").file(path).save(JSON.stringify(cifrado),{contentType:"application/json",resumable:false});
  let fecha;
  try {
    await db.runTransaction(async tx=>{
      const actual=await lectura(ref=>tx.get(ref),db.doc(`preFacturas/${id}`));
      const previo=await tx.get(jobRef(id));
      esConfirmada(actual.p);
      try { C.validarInscritos(actual.p,actual.inscripciones,actual.estudiantes); }
      catch(e) { throw new HttpsError("failed-precondition",e.message); }
      if (["enviando","enviando_manual","incierto"].includes(previo.data()?.estado)) throw new HttpsError("failed-precondition","Hay un intento de envío pendiente. Revisa Gmail antes de modificarlo.");
      if (actual.sourceHash !== req.data.sourceHash || C.hash(C.datosPrefactura(actual.p)) !== req.data.hashPrefactura) throw new HttpsError("failed-precondition","Los datos cambiaron. Cierra, recarga y revisa la prefactura de nuevo.");
      if (datos.nombrePdf !== `${actual.p.numeroPreFactura}.pdf`) throw new HttpsError("failed-precondition","El PDF no corresponde al número de prefactura confirmado.");
      fecha=C.fechaEnvio(actual.p.periodo);
      if (fecha <= new Date()) throw new HttpsError("failed-precondition","La fecha del día 20 a las 10:00 ya pasó para este periodo. Envía esta prefactura manualmente.");
      tx.set(jobRef(id),{preFacturaId:id,estado:"programado",sourceHash:actual.sourceHash,correoHash:C.hash(datos),path,version,fecha:fecha.toISOString(),periodo:actual.p.periodo,aprobadoPor:email,aprobadoAt:stamp(),mensaje:"",updatedAt:stamp()});
      tx.update(db.doc(`preFacturas/${id}`),{correoAutomaticoEstado:"programado",correoAutomaticoFecha:fecha.toISOString(),correoAutomaticoAprobadoPor:email,correoAutomaticoAviso:"",updatedAt:stamp()});
    });
  } catch(e) { await admin.storage().bucket("manager-fesicol.firebasestorage.app").file(path).delete().catch(()=>{});throw e; }
  return {ok:true,fecha:fecha.toISOString()};
});
exports.fesicolCancelarProgramacion = onCall(opciones,async req=>{
  requireAdmin(req);const id=idValido(req.data?.preFacturaId);
  await db.runTransaction(async tx=>{
    const s=await tx.get(jobRef(id));
    if (["enviando","enviando_manual","incierto"].includes(s.data()?.estado)) throw new HttpsError("failed-precondition","Existe un intento de envío en curso o sin confirmar. Revisa Gmail.");
    tx.set(jobRef(id),{estado:"cancelado",updatedAt:stamp()},{merge:true});
    tx.update(db.doc(`preFacturas/${id}`),{correoAutomaticoEstado:"cancelado",correoAutomaticoAviso:"Programación cancelada por un administrador.",updatedAt:stamp()});
  });return {ok:true};
});
// Reserva compartida por el botón manual y el planificador. Nunca vence automáticamente.
exports.fesicolReservarEnvioManual=onCall(opciones,async req=>{
  const email=requireAdmin(req),id=idValido(req.data?.preFacturaId),intento=crypto.randomUUID();
  await db.runTransaction(async tx=>{
    const p=await tx.get(db.doc(`preFacturas/${id}`)),j=await tx.get(jobRef(id));
    if (!p.exists || p.data().estado!=="Confirmado") throw new HttpsError("failed-precondition","Confirma la prefactura antes de enviar.");
    if (["enviando","enviando_manual","incierto"].includes(j.data()?.estado)) throw new HttpsError("failed-precondition","Ya hay un envío en curso o pendiente de verificar. Revisa Enviados en Gmail.");
    if ((p.data().enviadoAt || j.data()?.estado==="enviado") && req.data?.reenviar!==true) throw new HttpsError("failed-precondition","Ya se envió esta prefactura.");
    tx.set(jobRef(id),{preFacturaId:id,estado:"enviando_manual",intento,manualPor:email,updatedAt:stamp()},{merge:true});
  });return {intento};
});
exports.fesicolFinalizarEnvioManual=onCall(opciones,async req=>{
  const email=requireAdmin(req),id=idValido(req.data?.preFacturaId);
  const registro=req.data?.registro;
  await db.runTransaction(async tx=>{
    const j=await tx.get(jobRef(id));
    if (j.data()?.intento!==req.data.intento || j.data()?.manualPor!==email || j.data()?.estado!=="enviando_manual") throw new HttpsError("failed-precondition","La reserva de envío no coincide.");
    if (registro?.ultimoCorreoId) {
      if (!/^[a-zA-Z0-9_-]{5,150}$/.test(registro.ultimoCorreoId)) throw new HttpsError("invalid-argument","Confirmación Gmail inválida.");
      tx.set(jobRef(id),{estado:"enviado",correoId:registro.ultimoCorreoId,enviadoAt:stamp(),updatedAt:stamp()},{merge:true});
      tx.update(db.doc(`preFacturas/${id}`),{enviadoAt:stamp(),enviadoA:[...C.PARA,...C.CC].join(", "),remitente:C.REMITENTE,enviadoPor:email,ultimoCorreoId:registro.ultimoCorreoId,correoAsunto:String(registro.correoAsunto||"").slice(0,200),correoMensaje:String(registro.correoMensaje||"").slice(0,20000),correoAutomaticoEstado:"enviado",updatedAt:stamp()});
    } else {
      // Solo se permite liberar cuando Gmail rechazó explícitamente con un 4xx.
      const seguro=Number.isInteger(req.data.httpStatus) && req.data.httpStatus>=400 && req.data.httpStatus<500;
      tx.set(jobRef(id),{estado:seguro?"error":"incierto",mensaje:seguro?"Gmail rechazó el intento manual.":"Resultado manual sin confirmar. Revisa Enviados antes de reenviar.",updatedAt:stamp()},{merge:true});
      tx.update(db.doc(`preFacturas/${id}`),{correoAutomaticoEstado:seguro?"error":"incierto",correoAutomaticoAviso:seguro?"Gmail rechazó el intento manual.":"Revisa Enviados antes de reenviar.",updatedAt:stamp()});
    }
  });return {ok:true};
});
async function accesoGmail() {
  const s=await configRef.get(), conf=s.data();
  if (!conf?.conectado || !conf.refresh || !conf.secret) throw new Error("Gmail automático no está conectado.");
  const oauth=new OAuth2Client(C.CLIENT_ID,C.descifrar(conf.secret,KEY.value()),C.CALLBACK);
  oauth.setCredentials({refresh_token:C.descifrar(conf.refresh,KEY.value())});
  const {token}=await oauth.getAccessToken();if (!token) throw new Error("No se pudo renovar la conexión de Gmail.");return token;
}
async function ejecutarProgramado(id, ahora) {
  const ref=jobRef(id), intento=crypto.randomUUID();
  const reserva=await db.runTransaction(async tx=>{
    const actual=await lectura(r=>tx.get(r),db.doc(`preFacturas/${id}`)),snap=await tx.get(ref);
    if (!snap.exists || snap.data().estado!=="programado") return null;
    const job=snap.data(), motivo=C.puedeEnviar(actual.p,job,actual.sourceHash,ahora);
    if (motivo) {
      const estado=actual.p.enviadoAt?"enviado":"requiere_revision";
      tx.update(ref,{estado,mensaje:motivo,updatedAt:stamp()});tx.update(db.doc(`preFacturas/${id}`),{correoAutomaticoEstado:estado,correoAutomaticoAviso:motivo,updatedAt:stamp()});return null;
    }
    tx.update(ref,{estado:"enviando",intento,updatedAt:stamp()});return {...job,intento};
  });
  if (!reserva) return;
  let peticionIniciada=false, correoId=null;
  try {
    const [buffer]=await admin.storage().bucket("manager-fesicol.firebasestorage.app").file(reserva.path).download();
    const correo=C.descifrar(JSON.parse(buffer.toString()),KEY.value());
    if (C.hash(correo)!==reserva.correoHash) throw new Error("El mensaje o adjunto aprobado cambió.");
    const token=await accesoGmail();
    // Revisión final tras renovar la conexión y cargar el PDF.
    const ultima=await estadoPrefactura(id);
    if (ultima.p.estado!=="Confirmado" || ultima.p.enviadoAt || ultima.sourceHash!==reserva.sourceHash) throw new Error("Cambiaron los datos antes de enviar. Requiere nueva aprobación.");
    const raw=C.construirMime(correo,`fesicol-${C.hash(id)}-${reserva.version}`);
    peticionIniciada=true;
    const r=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({raw}),signal:AbortSignal.timeout(60000)});
    if (!r.ok) { if(r.status>=400 && r.status<500)peticionIniciada=false;throw new Error(`Gmail devolvió HTTP ${r.status}.`); }
    const respuesta=await r.json();
    if (!respuesta.id) throw new Error("Gmail no confirmó el envío.");
    correoId=respuesta.id;
    const batch=db.batch();
    batch.update(ref,{estado:"enviado",correoId,enviadoAt:stamp(),mensaje:"",updatedAt:stamp()});
    batch.update(db.doc(`preFacturas/${id}`),{enviadoAt:stamp(),enviadoA:[...C.PARA,...C.CC].join(", "),remitente:C.REMITENTE,enviadoPor:"automatico-dia-20",ultimoCorreoId:correoId,correoAsunto:correo.asunto,correoMensaje:correo.mensaje,correoAutomaticoEstado:"enviado",correoAutomaticoAviso:"",updatedAt:stamp()});
    await batch.commit();logger.info("Prefactura automática aceptada por Gmail",{preFacturaId:id,correoId});
  } catch(e) {
    const estado=peticionIniciada?"incierto":"requiere_revision";
    const mensaje=correoId?`Gmail aceptó el mensaje ${correoId}, pero falló el registro. No reenviar.`:peticionIniciada?"Resultado sin confirmar. Revisa Enviados en Gmail antes de reenviar.":"No se envió: revisa los datos y la conexión de Gmail antes de programar nuevamente.";
    await guardarEstado(id,estado,{mensaje,...(correoId?{correoId}:{} )});
    logger.error("Envío programado requiere revisión",{preFacturaId:id,estado,tipo:e.constructor.name});
  }
}
exports.fesicolEnviarDia20=onSchedule({schedule:"0 10 20 * *",timeZone:C.ZONA,region:"us-central1",secrets:[KEY],memory:"512MiB",timeoutSeconds:540,maxInstances:1,retryCount:0},async event=>{
  const ahora=new Date(),fecha=C.fechaColombia(ahora);
  if (fecha.dia!==20 || fecha.hora<10) return;
  const jobs=await db.collection("fesicolCorreoEnvios").where("estado","==","programado").get();
  let procesadas=0;
  for(const doc of jobs.docs){
    const job=doc.data();
    if(job.periodo!==fecha.periodo){if(job.periodo<fecha.periodo)await guardarEstado(job.preFacturaId,"requiere_revision",{mensaje:"El periodo programado venció sin envío confirmado."});continue;}
    if(procesadas++>=25){await guardarEstado(job.preFacturaId,"requiere_revision",{mensaje:"Límite operativo del envío mensual. Revisa esta prefactura manualmente."});continue;}
    try { await ejecutarProgramado(job.preFacturaId,ahora); }
    catch(e) {
      await guardarEstado(job.preFacturaId,"requiere_revision",{mensaje:"No se pudo validar esta prefactura o sus registros. Revisa la programación."});
      logger.error("No se pudo validar un envío mensual",{preFacturaId:job.preFacturaId,tipo:e.constructor.name});
    }
  }
  await configRef.set({ultimaEjecucion:stamp(),ultimoPeriodo:fecha.periodo},{merge:true});
});
