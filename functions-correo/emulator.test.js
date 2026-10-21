const {test,after}=require("node:test");
const assert=require("node:assert/strict"),crypto=require("node:crypto");
if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.GCLOUD_PROJECT!=="demo-fesicol-correo")throw new Error("Estas pruebas requieren exclusivamente emuladores del proyecto demo.");
process.env.FESICOL_CORREO_CIFRADO=crypto.randomBytes(32).toString("base64");
const F=require("./index"),C=require("./core"),admin=require("firebase-admin");
const db=admin.firestore(),bucket=admin.storage().bucket("manager-fesicol.firebasestorage.app");
const {OAuth2Client}=require("google-auth-library");OAuth2Client.prototype.getAccessToken=async()=>({token:"token-falso-sin-acceso"});
const auth={uid:"admin-prueba",token:{email:"imusicala@gmail.com"}};
const run=(nombre,data)=>F[nombre].run({auth,data});
let numero=0,envios=0,modo="ok";
const fetchOriginal=global.fetch;
global.fetch=async(url,options)=>{
 if(!String(url).startsWith("https://gmail.googleapis.com/"))throw new Error("Red externa prohibida en estas pruebas");
 envios++;if(modo==="incierto")throw new Error("corte de red simulado");
 if(modo==="rechazo")return {ok:false,status:401};
 const mime=Buffer.from(JSON.parse(options.body).raw,"base64url").toString();assert(mime.includes(C.REMITENTE));
 return {ok:true,status:200,json:async()=>({id:`gmail-prueba-${envios}`})};
};
const RealDate=Date;
async function scheduler(){
 global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:["2026-11-20T15:00:00Z"]));}static now(){return new RealDate("2026-11-20T15:00:00Z").getTime();}};
 try{await F.fesicolEnviarDia20.run({});}finally{global.Date=RealDate;}
}
async function seed(){
 const id=`prueba-${++numero}`, cicloId=`ciclo-${id}`;
 const p={periodo:"2026-11",cicloId,ciclo:"Ciclo 10",estado:"Confirmado",confirmadoAt:"2026-10-21T10:00:00Z",numeroPreFactura:`PF-202611-PR${numero}XXX`,items:[{estudiante:"Alumno",valor:100}],total:100};
 await db.doc(`preFacturas/${id}`).set(p);
 await db.doc(`ciclos/${cicloId}`).set({nombre:"Ciclo 10"});
 await db.doc(`inscripciones/${id}`).set({cicloId,mes:p.periodo,estudianteId:id,precio:100});
 await db.doc(`estudiantes/${id}`).set({nombre:"Alumno"});
 await db.doc(`planillas/${id}`).set({mes:p.periodo,cicloId,nombre:"planilla.xlsx"});
 const estado=await run("fesicolCorreoEstado",{preFacturaId:id});
 const correo={asunto:"Prefactura prueba",mensaje:"Mensaje revisado.",pdfBase64:Buffer.from("%PDF-1.4\nprueba").toString("base64"),nombrePdf:`${p.numeroPreFactura}.pdf`};
 const data={preFacturaId:id,correo,revisionConfirmada:true,sourceHash:estado.prefactura.sourceHash,hashPrefactura:estado.prefactura.hashPrefactura};
 return {id,p,data,job:db.doc(`fesicolCorreoEnvios/${C.hash(id)}`)};
}
async function configurar(){await db.doc("fesicolCorreoConfig/gmail").set({conectado:true,refresh:C.cifrar("token-falso",process.env.FESICOL_CORREO_CIFRADO),secret:C.cifrar("secreto-falso",process.env.FESICOL_CORREO_CIFRADO)});}
after(async()=>{global.fetch=fetchOriginal;await admin.app().delete();});
test("Integración con Firestore y Storage locales",async t=>{
 await configurar();
 await t.test("Niega acceso sin identidad administradora",async()=>{await assert.rejects(F.fesicolCorreoEstado.run({data:{}}));});
 await t.test("La aprobación requiere revisión explícita y guarda el PDF cifrado",async()=>{
  const x=await seed();await assert.rejects(run("fesicolProgramarPrefactura",{...x.data,revisionConfirmada:false}));
  await run("fesicolProgramarPrefactura",x.data);const j=(await x.job.get()).data();assert.equal(j.estado,"programado");
  const recuperado=await run("fesicolCorreoEstado",{preFacturaId:x.id,incluirContenido:true});assert.deepEqual(recuperado.prefactura.correo,x.data.correo);
  const [file]=await bucket.file(j.path).download();assert(!file.toString().includes("Mensaje revisado"));assert.equal(C.descifrar(JSON.parse(file.toString()),process.env.FESICOL_CORREO_CIFRADO).pdfBase64,x.data.correo.pdfBase64);
  await run("fesicolCancelarProgramacion",{preFacturaId:x.id});
 });
 await t.test("Cambios posteriores en inscritos, estudiantes, planilla o prefactura cancelan el envío",async()=>{
  for(const campo of ["inscripciones","estudiantes","planillas","preFacturas"]){
   const x=await seed();await run("fesicolProgramarPrefactura",x.data);
   await db.doc(`${campo}/${x.id}`).set({cambioPosterior:true},{merge:true});
   // La prefactura usa campos de negocio: cambiar total debe invalidar.
   if(campo==="preFacturas")await db.doc(`preFacturas/${x.id}`).update({total:101});
   const antes=envios;await scheduler();assert.equal(envios,antes);assert.equal((await x.job.get()).data().estado,"requiere_revision");
  }
 });
 await t.test("Una reserva manual bloquea al programador y otro administrador",async()=>{
  const x=await seed();await run("fesicolProgramarPrefactura",x.data);
  const reserva=await run("fesicolReservarEnvioManual",{preFacturaId:x.id});
  await assert.rejects(run("fesicolReservarEnvioManual",{preFacturaId:x.id}));
  const antes=envios;await scheduler();assert.equal(envios,antes);
  await run("fesicolFinalizarEnvioManual",{preFacturaId:x.id,intento:reserva.intento,registro:{ultimoCorreoId:"gmail-manual-prueba",correoAsunto:"Prueba",correoMensaje:"Mensaje"}});
  assert.equal((await x.job.get()).data().estado,"enviado");await assert.rejects(run("fesicolProgramarPrefactura",x.data));
 });
 await t.test("Envía una sola vez aunque el planificador se ejecute nuevamente",async()=>{
  const x=await seed();await run("fesicolProgramarPrefactura",x.data);const antes=envios;modo="ok";
  await scheduler();await scheduler();assert.equal(envios,antes+1);assert.equal((await x.job.get()).data().estado,"enviado");
  assert((await db.doc(`preFacturas/${x.id}`).get()).data().ultimoCorreoId);
 });
 await t.test("Resultado incierto queda bloqueado y no se reintenta",async()=>{
  const x=await seed();await run("fesicolProgramarPrefactura",x.data);const antes=envios;modo="incierto";
  await scheduler();await scheduler();assert.equal(envios,antes+1);assert.equal((await x.job.get()).data().estado,"incierto");
  await assert.rejects(run("fesicolReservarEnvioManual",{preFacturaId:x.id}));modo="ok";
 });
 await t.test("Gmail rechazado deja aviso y exige revisión",async()=>{
  const x=await seed();await run("fesicolProgramarPrefactura",x.data);modo="rechazo";await scheduler();
  assert.equal((await x.job.get()).data().estado,"requiere_revision");modo="ok";
 });
 await t.test("No aprueba una prefactura que quedó desactualizada antes de revisarla",async()=>{
  const x=await seed();await db.doc(`inscripciones/${x.id}`).update({precio:200});
  const estado=await run("fesicolCorreoEstado",{preFacturaId:x.id});
  await assert.rejects(run("fesicolProgramarPrefactura",{...x.data,sourceHash:estado.prefactura.sourceHash}));
 });
 await t.test("Si se elimina una prefactura, pide revisión sin detener los demás trabajos",async()=>{
  const x=await seed();await run("fesicolProgramarPrefactura",x.data);await db.doc(`preFacturas/${x.id}`).delete();
  const antes=envios;await scheduler();assert.equal(envios,antes);assert.equal((await x.job.get()).data().estado,"requiere_revision");
  assert.equal((await db.doc(`preFacturas/${x.id}`).get()).exists,false);
 });
 await t.test("Dos aprobaciones no pueden reservar simultáneamente el envío",async()=>{
  const x=await seed();await run("fesicolProgramarPrefactura",x.data);
  const results=await Promise.allSettled([run("fesicolReservarEnvioManual",{preFacturaId:x.id}),run("fesicolReservarEnvioManual",{preFacturaId:x.id})]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
 });
});
