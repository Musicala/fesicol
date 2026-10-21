"use strict";

const { createHash, randomUUID } = require("node:crypto");
const hash = value => createHash("sha256").update(value).digest("hex");
const paymentId = cicloId => `fesicol_${hash(cicloId).slice(0, 32)}`;

// Un documento de Clientes por ciclo. Los identificadores locales nunca se
// presentan como studentId canónico de RIP.
function buildPayment(cicloId, ciclo, inscripciones, estudiantes) {
  const active = inscripciones.filter(i => i.estado !== "Retirado")
    .sort((a, b) => a.id.localeCompare(b.id));
  const packages = new Map();
  for (const i of active) {
    if (!i.paqueteMusifamiliarId) continue;
    const previous = packages.get(i.paqueteMusifamiliarId);
    if (!previous || (i.beneficiarioPrincipal && !previous.beneficiarioPrincipal)) {
      packages.set(i.paqueteMusifamiliarId, i);
    }
  }
  const usuarios = active.map((i, index) => {
    const student = estudiantes.get(i.estudianteId) || {};
    const estudiante = String(student.nombre || i.estudianteNombre || "").trim();
    const servicio = String(i.servicio || i.modalidad || "").trim();
    const price = Number(i.precio);
    if (!estudiante || !servicio || !Number.isFinite(price) || price < 0) {
      throw new Error(`Revisa estudiante, servicio y precio de la inscripción ${i.id}.`);
    }
    return {
      index: index + 1, estudiante, servicio,
      precio: i.paqueteMusifamiliarId && packages.get(i.paqueteMusifamiliarId).id !== i.id ? 0 : price,
      ciclo: String(ciclo.nombre || cicloId), mes: String(i.mes || ""),
      fesicolInscripcionId: i.id, fesicolEstudianteId: i.estudianteId || "",
      paqueteMusifamiliarId: i.paqueteMusifamiliarId || "",
      correo: String(student.wixEmail || student.email || student.correo || "").trim().toLowerCase()
    };
  });
  const source = { cicloId, cicloNombre: ciclo.nombre || cicloId, usuarios };
  return { ...source, subtotal: usuarios.reduce((sum, u) => sum + u.precio, 0), sourceHash: hash(JSON.stringify(source)) };
}

// Lee nuevamente Fesicol dentro de cada intento de la transacción. El pago
// funciona como punto de contención para eventos simultáneos o fuera de orden.
function createSynchronizer({ source, destination, timestamp, today }) {
  return async function syncCycle(cicloId, { retryWix = false } = {}) {
    const id = paymentId(cicloId);
    const ref = destination.collection("clientesB2C").doc(id);
    return destination.runTransaction(async tx => {
      const existing = await tx.get(ref);
      const before = existing.exists ? existing.data() : null;
      if (before && (before.sourceSystem !== "fesicol" || before.fesicolCicloId !== cicloId)) {
        throw new Error("El identificador del pago está ocupado por otro registro.");
      }
      const [cycle, inscriptions] = await Promise.all([
        source.collection("ciclos").doc(cicloId).get(),
        source.collection("inscripciones").where("cicloId", "==", cicloId).get()
      ]);
      const rows = inscriptions.docs.map(d => ({ ...d.data(), id: d.id }));
      const studentIds = [...new Set(rows.map(i => i.estudianteId).filter(Boolean))];
      const students = new Map();
      // getAll admite lotes acotados; no carga el directorio completo.
      for (let offset = 0; offset < studentIds.length; offset += 100) {
        const snaps = await source.getAll(...studentIds.slice(offset, offset + 100)
          .map(studentId => source.collection("estudiantes").doc(studentId)));
        snaps.forEach(s => { if (s.exists) students.set(s.id, s.data()); });
      }
      const data = buildPayment(cicloId, cycle.exists ? cycle.data() : {}, rows, students);
      if (!before && !data.usuarios.length) return { id, total: 0, usuarios: 0, empty: true };
      const total = data.subtotal + (Number(before?.recargo) || 0) - (Number(before?.descuento) || 0);
      if (before?.fesicolSourceHash === data.sourceHash && !retryWix) return { id, total, usuarios: data.usuarios.length, unchanged: true };
      const date = before?.fecha || today();
      const after = {
        sourceSystem: "fesicol", source: "firebase", importedFrom: "Inscripciones FESICOL",
        fesicolCicloId: cicloId, fesicolCicloNombre: data.cicloNombre,
        fesicolSourceHash: data.sourceHash, usuarios: data.usuarios, total,
        updatedAt: timestamp(), updatedBy: "fesicol-sync",
        ...(retryWix ? { fesicolWixRetryToken: randomUUID() } : {}),
        // No se sobreescriben FEVM, factura, comentario, fecha ni ajustes.
        ...(!before ? {
          fecha: date, fechaTs: Date.parse(`${date}T00:00:00-05:00`),
          tipoEstudiante: "Fesicol", medioPago: "Fesicol", recargo: 0,
          descuento: 0, FEVM: 0, comentario: `FESICOL · ${data.cicloNombre}`,
          createdAt: timestamp(), createdBy: "fesicol-sync"
        } : {})
      };
      tx.set(ref, after, { merge: true });
      tx.set(destination.collection("auditLog").doc(), {
        entity: "clientesB2C", entityId: id, action: before ? "update" : "create",
        userEmail: "fesicol-sync", createdAt: timestamp(),
        sourceSystem: "fesicol", summary: { cicloId, total, usuarios: data.usuarios.length }
      });
      return { id, total, usuarios: data.usuarios.length };
    });
  };
}

module.exports = { buildPayment, paymentId, createSynchronizer };
