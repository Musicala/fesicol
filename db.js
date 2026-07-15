/* =========================================================
   db.js · Capa de datos Firestore para el convenio FESICOL
   ---------------------------------------------------------
   Colecciones:
     ciclos        → periodos de inscripción (fechas)
     asociados     → empleados FESICOL (titulares)
     estudiantes   → inscritos (historial / seguimiento)
     inscripciones → inscripción de un estudiante en un ciclo
     planillas     → envíos mensuales de FESICOL
     facturas      → facturación, cuentas de cobro y soportes
     tarifas       → precios 2026 por servicio
========================================================= */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

let _db = null;
let _storage = null;

export function initDb(db, storage) {
  _db = db;
  _storage = storage;
}

/* ---------- Helpers ---------- */
const col = (name) => collection(_db, name);

function withId(snap) {
  return { id: snap.id, ...snap.data() };
}

function mapSnap(qsnap) {
  return qsnap.docs.map(withId);
}

/** "$ 1.502.000" → 1502000 (number) */
export function parsePrice(str) {
  if (typeof str === "number") return str;
  const digits = String(str ?? "").replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

/** 1502000 → "$ 1.502.000" */
export function formatCOP(value) {
  const n = Number(value) || 0;
  return "$ " + n.toLocaleString("es-CO");
}

/* =========================================================
   CICLOS  (fechas de inscripción)
========================================================= */
export async function getCiclos() {
  const qs = await getDocs(query(col("ciclos"), orderBy("orden", "asc")));
  return mapSnap(qs);
}

export function watchCiclos(cb) {
  return onSnapshot(query(col("ciclos"), orderBy("orden", "asc")), (qs) =>
    cb(mapSnap(qs))
  );
}

export async function saveCiclo(data, id = null) {
  const payload = { ...data, updatedAt: serverTimestamp() };
  if (id) {
    await updateDoc(doc(_db, "ciclos", id), payload);
    return id;
  }
  payload.createdAt = serverTimestamp();
  const r = await addDoc(col("ciclos"), payload);
  return r.id;
}

export async function deleteCiclo(id) {
  await deleteDoc(doc(_db, "ciclos", id));
}

/* =========================================================
   ASOCIADOS  (titulares FESICOL)
========================================================= */
export async function getAsociados() {
  const qs = await getDocs(query(col("asociados"), orderBy("nombre", "asc")));
  return mapSnap(qs);
}

export async function findAsociadoByDoc(documento) {
  const qs = await getDocs(
    query(col("asociados"), where("documento", "==", String(documento)), limit(1))
  );
  return qs.empty ? null : withId(qs.docs[0]);
}

export async function upsertAsociado(data) {
  // Usa el documento como id natural para evitar duplicados.
  const id = String(data.documento || "").trim();
  if (!id) {
    const r = await addDoc(col("asociados"), { ...data, createdAt: serverTimestamp() });
    return r.id;
  }
  await setDoc(
    doc(_db, "asociados", id),
    { ...data, documento: id, updatedAt: serverTimestamp() },
    { merge: true }
  );
  return id;
}

/* =========================================================
   ESTUDIANTES  (inscritos · historial)
========================================================= */
export async function getEstudiantes() {
  const qs = await getDocs(query(col("estudiantes"), orderBy("nombre", "asc")));
  return mapSnap(qs);
}

export function watchEstudiantes(cb) {
  return onSnapshot(query(col("estudiantes"), orderBy("nombre", "asc")), (qs) =>
    cb(mapSnap(qs))
  );
}

export async function getEstudiante(id) {
  const s = await getDoc(doc(_db, "estudiantes", id));
  return s.exists() ? withId(s) : null;
}

export async function saveEstudiante(data, id = null) {
  const payload = { ...data, updatedAt: serverTimestamp() };
  if (id) {
    await updateDoc(doc(_db, "estudiantes", id), payload);
    return id;
  }
  payload.createdAt = serverTimestamp();
  payload.activo = data.activo ?? true;
  const r = await addDoc(col("estudiantes"), payload);
  return r.id;
}

export async function deleteEstudiante(id) {
  await deleteDoc(doc(_db, "estudiantes", id));
}

/**
 * Fusiona varios estudiantes duplicados en uno solo.
 * Reasigna todas las inscripciones de los duplicados al estudiante principal
 * y elimina los duplicados. Devuelve cuántas inscripciones se movieron.
 */
export async function mergeEstudiantes(keepId, dropIds = []) {
  const dups = dropIds.filter((id) => id && id !== keepId);
  if (!dups.length) return { movidas: 0, eliminados: 0 };

  const keepSnap = await getDoc(doc(_db, "estudiantes", keepId));
  const keepData = keepSnap.exists() ? keepSnap.data() : {};
  const keepNombre = keepData.nombre || "";

  // Une asociados sin duplicar (por documento, o por nombre si no hay documento)
  const asocsDe = (d) => {
    if (Array.isArray(d?.asociados) && d.asociados.length) return d.asociados;
    if (d?.asociadoNombre || d?.asociadoDocumento)
      return [{ nombre: d.asociadoNombre || "", documento: d.asociadoDocumento || "", telefono: d.telefono || "", parentesco: d.parentesco || "" }];
    return [];
  };
  const vistos = new Set(); const asociados = [];
  const acumula = (arr) => arr.forEach((a) => {
    if (!a || (!a.documento && !a.nombre)) return;
    const k = a.documento ? "d:" + String(a.documento).trim() : "n:" + String(a.nombre).trim().toLowerCase();
    if (vistos.has(k)) return; vistos.add(k); asociados.push(a);
  });
  acumula(asocsDe(keepData));

  const batch = writeBatch(_db);
  let movidas = 0;

  for (const dupId of dups) {
    const dupSnap = await getDoc(doc(_db, "estudiantes", dupId));
    if (dupSnap.exists()) acumula(asocsDe(dupSnap.data()));
    const qs = await getDocs(
      query(col("inscripciones"), where("estudianteId", "==", dupId))
    );
    qs.forEach((d) => {
      batch.update(doc(_db, "inscripciones", d.id), {
        estudianteId: keepId,
        estudianteNombre: keepNombre,
        updatedAt: serverTimestamp()
      });
      movidas++;
    });
    batch.delete(doc(_db, "estudiantes", dupId));
  }

  // Guarda el conjunto unido de asociados en el estudiante conservado
  const principal = asociados[0] || {};
  batch.set(doc(_db, "estudiantes", keepId), {
    asociados,
    asociadoNombre: principal.nombre || keepData.asociadoNombre || "",
    asociadoDocumento: principal.documento || keepData.asociadoDocumento || "",
    updatedAt: serverTimestamp()
  }, { merge: true });

  await batch.commit();
  return { movidas, eliminados: dups.length };
}

/* =========================================================
   CONTACTOS  (base general: interesados, prospectos e inscritos)
   ---------------------------------------------------------
   Guarda a todo el que ha mostrado interés, aunque nunca haya
   tomado clase. Campos: nombre, telefono, email, asociado,
   interes (instrumento/servicio), estado, origen, notas.
========================================================= */
export async function getContactos() {
  const qs = await getDocs(query(col("contactos"), orderBy("nombre", "asc")));
  return mapSnap(qs);
}

export function watchContactos(cb) {
  return onSnapshot(query(col("contactos"), orderBy("nombre", "asc")), (qs) =>
    cb(mapSnap(qs))
  );
}

export async function saveContacto(data, id = null) {
  const payload = { ...data, updatedAt: serverTimestamp() };
  if (id) {
    await updateDoc(doc(_db, "contactos", id), payload);
    return id;
  }
  payload.createdAt = serverTimestamp();
  payload.origen = data.origen || "manual";
  const r = await addDoc(col("contactos"), payload);
  return r.id;
}

export async function deleteContacto(id) {
  await deleteDoc(doc(_db, "contactos", id));
}

/**
 * Importa contactos en lote (desde un .csv).
 * items: [{ nombre, telefono, email, asociado, interes, estado, notas }]
 * Reutiliza el id existente cuando se pasa `id`, si no crea uno nuevo.
 */
export async function importContactos(items) {
  const batch = writeBatch(_db);
  let nuevos = 0, actualizados = 0;
  items.forEach((it) => {
    const { id, ...campos } = it;
    if (id) {
      batch.set(doc(_db, "contactos", id),
        { ...campos, updatedAt: serverTimestamp() }, { merge: true });
      actualizados++;
    } else {
      const ref = doc(col("contactos"));
      batch.set(ref, { ...campos, origen: campos.origen || "csv", createdAt: serverTimestamp() });
      nuevos++;
    }
  });
  await batch.commit();
  return { nuevos, actualizados, total: items.length };
}

/* =========================================================
   INSCRIPCIONES  (estudiante + ciclo + precio)
========================================================= */
export async function getInscripciones() {
  const qs = await getDocs(query(col("inscripciones"), orderBy("createdAt", "desc")));
  return mapSnap(qs);
}

export function watchInscripciones(cb) {
  return onSnapshot(query(col("inscripciones"), orderBy("createdAt", "desc")), (qs) =>
    cb(mapSnap(qs))
  );
}

export async function getInscripcionesByCiclo(cicloId) {
  const qs = await getDocs(
    query(col("inscripciones"), where("cicloId", "==", cicloId))
  );
  return mapSnap(qs);
}

export async function getInscripcionesByEstudiante(estudianteId) {
  const qs = await getDocs(
    query(col("inscripciones"), where("estudianteId", "==", estudianteId))
  );
  return mapSnap(qs);
}

export async function saveInscripcion(data, id = null) {
  const payload = {
    ...data,
    precio: parsePrice(data.precio),
    updatedAt: serverTimestamp()
  };
  if (id) {
    await updateDoc(doc(_db, "inscripciones", id), payload);
    return id;
  }
  payload.createdAt = serverTimestamp();
  payload.estado = data.estado || "Inscrito";
  const r = await addDoc(col("inscripciones"), payload);
  return r.id;
}

/**
 * Guarda un único paquete Musifamiliar y una inscripción visible por cada
 * beneficiario. El valor pertenece al paquete, no se multiplica por persona.
 */
export async function savePaqueteMusifamiliar(data, beneficiarioIds, paqueteId = null) {
  const ids = [...new Set((beneficiarioIds || []).filter(Boolean))];
  if (!ids.length) throw new Error("Selecciona al menos un beneficiario.");
  const id = paqueteId || doc(col("inscripciones")).id;
  const existentes = paqueteId
    ? mapSnap(await getDocs(query(col("inscripciones"), where("paqueteMusifamiliarId", "==", paqueteId))))
    : [];
  const existentesPorEstudiante = new Map(existentes.map((x) => [x.estudianteId, x]));
  const batch = writeBatch(_db);

  existentes.filter((x) => !ids.includes(x.estudianteId)).forEach((x) =>
    batch.delete(doc(_db, "inscripciones", x.id))
  );
  ids.forEach((estudianteId, indice) => {
    const previo = existentesPorEstudiante.get(estudianteId);
    const ref = previo ? doc(_db, "inscripciones", previo.id) : doc(col("inscripciones"));
    batch.set(ref, {
      ...data,
      estudianteId,
      paqueteMusifamiliarId: id,
      beneficiarioPrincipal: indice === 0,
      precio: parsePrice(data.precio),
      estado: data.estado || "Inscrito",
      updatedAt: serverTimestamp(),
      ...(previo ? {} : { createdAt: serverTimestamp() })
    }, { merge: true });
  });
  await batch.commit();
  return id;
}

export async function deleteInscripcion(id) {
  const ref = doc(_db, "inscripciones", id);
  const snap = await getDoc(ref);
  const paqueteId = snap.data()?.paqueteMusifamiliarId;
  if (!paqueteId) return deleteDoc(ref);
  const miembros = await getDocs(query(col("inscripciones"), where("paqueteMusifamiliarId", "==", paqueteId)));
  const batch = writeBatch(_db);
  miembros.docs.forEach((m) => batch.delete(m.ref));
  await batch.commit();
}

/* =========================================================
   PLANILLAS  (envíos mensuales de FESICOL)
========================================================= */
export async function getPlanillas() {
  const qs = await getDocs(query(col("planillas"), orderBy("createdAt", "desc")));
  return mapSnap(qs);
}

export async function savePlanilla(data, id = null) {
  const payload = { ...data, updatedAt: serverTimestamp() };
  if (id) {
    await updateDoc(doc(_db, "planillas", id), payload);
    return id;
  }
  payload.createdAt = serverTimestamp();
  const r = await addDoc(col("planillas"), payload);
  return r.id;
}

/* =========================================================
   FACTURAS  (facturación, cuentas de cobro, soportes)
========================================================= */
export async function getFacturas() {
  const qs = await getDocs(query(col("facturas"), orderBy("createdAt", "desc")));
  return mapSnap(qs);
}

export function watchFacturas(cb) {
  return onSnapshot(query(col("facturas"), orderBy("createdAt", "desc")), (qs) =>
    cb(mapSnap(qs))
  );
}

export async function saveFactura(data, id = null) {
  const payload = {
    ...data,
    valor: parsePrice(data.valor),
    updatedAt: serverTimestamp()
  };
  if (id) {
    await updateDoc(doc(_db, "facturas", id), payload);
    return id;
  }
  payload.createdAt = serverTimestamp();
  const r = await addDoc(col("facturas"), payload);
  return r.id;
}

export async function deleteFactura(id) {
  await deleteDoc(doc(_db, "facturas", id));
}

/* =========================================================
   USUARIOS  (autorización · roles admin/lector)
   doc id = correo en minúscula
========================================================= */
export async function getUsuarios() {
  const qs = await getDocs(query(col("usuarios"), orderBy("email", "asc")));
  return mapSnap(qs);
}

export async function getUsuario(email) {
  const id = String(email || "").trim().toLowerCase();
  if (!id) return null;
  const s = await getDoc(doc(_db, "usuarios", id));
  return s.exists() ? withId(s) : null;
}

export async function saveUsuario(email, data) {
  const id = String(email || "").trim().toLowerCase();
  if (!id) throw new Error("Correo requerido.");
  await setDoc(
    doc(_db, "usuarios", id),
    { email: id, role: data.role || "lector", nombre: data.nombre || "", updatedAt: serverTimestamp() },
    { merge: true }
  );
  return id;
}

export async function deleteUsuario(email) {
  await deleteDoc(doc(_db, "usuarios", String(email).trim().toLowerCase()));
}

/* =========================================================
   TARIFAS  (precios 2026)
========================================================= */
export async function getTarifas() {
  const qs = await getDocs(query(col("tarifas"), orderBy("precio", "asc")));
  return mapSnap(qs);
}

/* =========================================================
   STORAGE  (archivos: planillas, facturas, soportes)
========================================================= */
export async function uploadArchivo(file, folder = "documentos") {
  if (!file) throw new Error("No hay archivo para subir.");
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${folder}/${Date.now()}_${safeName}`;
  const r = storageRef(_storage, path);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  return { url, path, name: file.name };
}

export async function deleteArchivo(path) {
  if (!path) return;
  try {
    await deleteObject(storageRef(_storage, path));
  } catch (e) {
    console.warn("No se pudo borrar archivo:", path, e?.code || e);
  }
}

/* =========================================================
   IMPORTAR PLANILLA  (carga masiva desde el Excel de FESICOL)
   items: [{ estudianteId?, estudiante:{...}, asociado:{...}, inscripcion:{...} }]
========================================================= */
export async function importPlanilla(items, planillaMeta = {}) {
  const batch = writeBatch(_db);
  let nuevosEst = 0, nuevasIns = 0;

  // Mismo inscrito puede venir en varias filas (p. ej. con papá y mamá como
  // asociados, cada uno adquiriendo un servicio). Reutilizamos el mismo
  // estudiante dentro del lote para no crear duplicados.
  const normNombre = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const nuevosPorNombre = new Map();

  items.forEach((it) => {
    // Asociado (id = documento)
    if (it.asociado?.documento) {
      const aRef = doc(_db, "asociados", String(it.asociado.documento));
      batch.set(aRef, { ...it.asociado, updatedAt: serverTimestamp() }, { merge: true });
    }

    // Estudiante: reutiliza si ya existe (en BD o en este mismo lote), si no, crea
    let estId = it.estudianteId;
    const clave = normNombre(it.estudiante?.nombre);
    if (!estId && clave && nuevosPorNombre.has(clave)) {
      estId = nuevosPorNombre.get(clave);
    }
    if (!estId) {
      const eRef = doc(col("estudiantes"));
      estId = eRef.id;
      batch.set(eRef, { ...it.estudiante, activo: true, createdAt: serverTimestamp() });
      if (clave) nuevosPorNombre.set(clave, estId);
      nuevosEst++;
    } else if (it.estudianteId && Array.isArray(it.estudiante?.asociados)) {
      // Estudiante ya existente: conecta los asociados de esta planilla (unión ya calculada).
      batch.set(doc(_db, "estudiantes", estId), {
        asociados: it.estudiante.asociados,
        asociadoNombre: it.estudiante.asociadoNombre || "",
        asociadoDocumento: it.estudiante.asociadoDocumento || "",
        telefono: it.estudiante.telefono || "",
        parentesco: it.estudiante.parentesco || "",
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    // Inscripción (si se pidió crear)
    if (it.inscripcion) {
      const iRef = doc(col("inscripciones"));
      batch.set(iRef, {
        ...it.inscripcion,
        estudianteId: estId,
        estudianteNombre: it.estudiante?.nombre || "",
        precio: parsePrice(it.inscripcion.precio),
        estado: it.inscripcion.estado || "Inscrito",
        createdAt: serverTimestamp()
      });
      nuevasIns++;
    }
  });

  // Registro de la planilla
  if (planillaMeta && Object.keys(planillaMeta).length) {
    const pRef = doc(col("planillas"));
    batch.set(pRef, { ...planillaMeta, registros: items.length, createdAt: serverTimestamp() });
  }

  await batch.commit();
  return { nuevosEst, nuevasIns, total: items.length };
}

/* =========================================================
   SEED  (cargar tarifas y ciclos iniciales una sola vez)
========================================================= */
export async function seedTarifas(rows) {
  const batch = writeBatch(_db);
  rows.forEach((r) => {
    const ref = doc(col("tarifas"));
    batch.set(ref, {
      servicio: r[0],
      precio: parsePrice(r[1]),
      createdAt: serverTimestamp()
    });
  });
  await batch.commit();
  return rows.length;
}

export async function tarifasCount() {
  const qs = await getDocs(query(col("tarifas"), limit(1)));
  return qs.size;
}

export async function seedCiclos(ciclos) {
  const batch = writeBatch(_db);
  ciclos.forEach((c, i) => {
    const ref = doc(col("ciclos"));
    batch.set(ref, { ...c, orden: c.orden ?? i + 1, createdAt: serverTimestamp() });
  });
  await batch.commit();
  return ciclos.length;
}

export async function ciclosCount() {
  const qs = await getDocs(query(col("ciclos"), limit(1)));
  return qs.size;
}
