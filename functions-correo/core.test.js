const {test}=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const C=require("./core");
const p={periodo:"2026-11",estado:"Confirmado",confirmadoAt:"2026-11-18T10:00:00Z"};
const job={estado:"programado",sourceHash:"hash"};
const hoy=new Date("2026-11-20T15:00:00Z");
test("La programación es el día 20 a las 10 de Colombia",()=>{
 assert.equal(C.fechaEnvio("2026-11").toISOString(),"2026-11-20T15:00:00.000Z");
 assert.deepEqual(C.fechaColombia(hoy),{periodo:"2026-11",dia:20,hora:10});
 assert.equal(C.puedeEnviar(p,job,"hash",hoy),"");
 assert.throws(()=>C.fechaEnvio("2026-13"));
});
test("Solo envía documentos confirmados, del periodo, sin cambios ni envío anterior",()=>{
 for(const cambio of [{estado:"Pendiente"},{confirmadoAt:null},{enviadoAt:"2026-11-19"},{ultimoCorreoId:"gmail"},{periodo:"2026-10"}])assert(C.puedeEnviar({...p,...cambio},job,"hash",hoy));
 for(const estado of ["enviando","enviando_manual","enviado","incierto","cancelado","requiere_revision"])assert(C.puedeEnviar(p,{...job,estado},"hash",hoy));
 assert(C.puedeEnviar(p,job,"otro",hoy));
 assert(C.puedeEnviar(p,job,"hash",new Date("2026-11-20T14:59:59Z")));
});
test("Cifrado autenticado: no guarda credenciales en claro y detecta alteraciones",()=>{
 const key=crypto.randomBytes(32).toString("base64");
 const original={secreto:"secreto-privado",token:"token-privado"};const x=C.cifrar(original,key);
 assert(!JSON.stringify(x).includes("privado"));assert.deepEqual(C.descifrar(x,key),original);
 assert.throws(()=>C.descifrar({...x,tag:Buffer.alloc(16).toString("base64")},key));
});
test("MIME conserva el PDF y los tres destinatarios autorizados",()=>{
 const datos={asunto:"Prefactura – Música",mensaje:"Buen día,\nAdjuntamos la prefactura.",nombrePdf:"PF-202611-123ABC.pdf",pdfBase64:Buffer.from("%PDF-1.4\nprueba").toString("base64")};
 const raw=C.construirMime(datos,"intento-id"), mime=Buffer.from(raw,"base64url").toString();
 assert(mime.includes(`From: Musicala <${C.REMITENTE}>`));for(const email of [...C.PARA,...C.CC])assert(mime.includes(email));
 assert(mime.includes("Content-Type: application/pdf"));assert(mime.includes(datos.pdfBase64));
 assert.throws(()=>C.validarContenido({...datos,asunto:"Mal\r\nBcc: otro@correo.com"}));
 assert.throws(()=>C.validarContenido({...datos,pdfBase64:Buffer.from("no pdf").toString("base64")}));
 assert.throws(()=>C.validarContenido({...datos,mensaje:""}));
});
test("Hash estable y acotado a los datos revisados de la prefactura",()=>{
 assert.equal(C.hash({b:2,a:1}),C.hash({a:1,b:2}));
 assert.equal(C.hash(C.datosPrefactura(p)),C.hash(C.datosPrefactura({...p,updatedAt:"otro",correoAutomaticoEstado:"programado"})));
 assert.notEqual(C.hash(C.datosPrefactura(p)),C.hash(C.datosPrefactura({...p,total:20})));
});

test("La prefactura debe coincidir con estudiantes y valores actuales antes de aprobar",()=>{
 const ins=[{estudianteId:"a",precio:100,estado:"Inscrito",modalidad:"Hogar",duracion:"4 clases"}];
 const estudiantes=[{id:"a",datos:{nombre:"María"}}];
 const pf={items:[{estudiante:"María",valor:100,modalidad:"Hogar",duracion:"4 clases"}],total:100};
 C.validarInscritos(pf,ins,estudiantes);
 assert.throws(()=>C.validarInscritos({...pf,total:200},ins,estudiantes));
 assert.throws(()=>C.validarInscritos(pf,[{...ins[0],precio:200}],estudiantes));
 assert.throws(()=>C.validarInscritos(pf,ins,[{id:"a",datos:{nombre:"Otra persona"}}]));
 assert.throws(()=>C.validarInscritos(pf,[],estudiantes));
});
