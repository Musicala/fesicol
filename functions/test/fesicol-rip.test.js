const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPayment, paymentId, createSynchronizer } = require("../fesicol-rip");
const enrollment = (id, extra = {}) => ({ id, estudianteId: id, estudianteNombre: id,
  servicio: "Sede Personalizado Paquete de 4 clases", precio: 200000, estado: "Inscrito", ...extra });
const build = rows => buildPayment("ciclo1", { nombre: "Ciclo 1" }, rows, new Map());

test("incluye más de tres beneficiarios en Clientes", () => {
  const data = build(Array.from({ length: 8 }, (_, i) => enrollment(String(i))));
  assert.equal(data.usuarios.length, 8);
  assert.equal(data.subtotal, 1600000);
  assert.equal(data.usuarios[0].studentId, undefined);
});
test("envía correo Wix del estudiante sin usar IDs locales como identidad RIP", () => {
  const data = buildPayment("ciclo1", {}, [enrollment("a")], new Map([
    ["a", { nombre: "Ana", wixEmail: " Ana@Example.COM ", email: "otro@example.com" }]
  ]));
  assert.equal(data.usuarios[0].correo, "ana@example.com");
  assert.equal(data.usuarios[0].estudiante, "Ana");
  assert.equal(data.usuarios[0].studentId, undefined);
});
test("Musifamiliar conserva beneficiarios y cobra una sola vez", () => {
  const data = build([
    enrollment("a", { paqueteMusifamiliarId: "mf", beneficiarioPrincipal: false }),
    enrollment("b", { paqueteMusifamiliarId: "mf", beneficiarioPrincipal: true }),
    enrollment("c", { paqueteMusifamiliarId: "otro" })
  ]);
  assert.deepEqual(data.usuarios.map(u => u.precio), [0, 200000, 200000]);
  assert.equal(data.subtotal, 400000);
});
test("elige respaldo al retirar el principal de un paquete", () => {
  const data = build([
    enrollment("a", { estado: "Retirado", paqueteMusifamiliarId: "mf", beneficiarioPrincipal: true }),
    enrollment("b", { paqueteMusifamiliarId: "mf" })
  ]);
  assert.equal(data.subtotal, 200000);
  assert.equal(data.usuarios.length, 1);
});
test("hash estable ante eventos fuera de orden", () => {
  const rows = [enrollment("a"), enrollment("b")];
  assert.equal(build(rows).sourceHash, build([...rows].reverse()).sourceHash);
  assert.notEqual(build(rows).sourceHash, build([enrollment("a", { precio: 1 })]).sourceHash);
  assert.notEqual(paymentId("ciclo1"), paymentId("ciclo2"));
});
test("rechaza datos incompletos antes de guardar", () => {
  for (const extra of [{ servicio: "" }, { precio: -1 }, { precio: NaN }, { estudianteNombre: "" }]) {
    assert.throws(() => build([enrollment("a", extra)]), /Revisa/);
  }
});

function harness(initial = null) {
  let rows = [enrollment("a")], payment = initial, writes = 0, reads = 0;
  const source = {
    collection: name => ({
      doc: id => ({ get: async () => ({ exists: true, data: () => ({ nombre: "Ciclo 1" }) }) }),
      where: () => ({ get: async () => { reads++; return { docs: rows.map(i => ({ id: i.id, data: () => i })) }; } })
    }), getAll: async () => []
  };
  const destination = {
    collection: name => ({ doc: id => ({ name, id }) }),
    runTransaction: async cb => cb({
      get: async () => ({ exists: Boolean(payment), data: () => payment }),
      set: (ref, data) => { if (ref.name === "clientesB2C") { payment = { ...payment, ...data }; writes++; } }
    })
  };
  return {
    sync: createSynchronizer({ source, destination, timestamp: () => "stamp", today: () => "2026-10-20" }),
    get payment() { return payment; }, get writes() { return writes; }, get reads() { return reads; },
    setRows(value) { rows = value; }
  };
}
test("reintentar no duplica; nuevas inscripciones actualizan el mismo pago", async () => {
  const h = harness();
  const first = await h.sync("ciclo1");
  assert.equal(h.payment.medioPago, "Fesicol");
  assert.equal((await h.sync("ciclo1")).unchanged, true);
  assert.equal(h.writes, 1);
  h.setRows([enrollment("a"), enrollment("b")]);
  assert.equal((await h.sync("ciclo1")).id, first.id);
  assert.equal(h.payment.total, 400000);
  assert.equal(h.reads, 3);
});
test("el reintento manual solicita planes bloqueados sin duplicar el pago", async () => {
  const h = harness();
  const first = await h.sync("ciclo1");
  const second = await h.sync("ciclo1", { retryWix: true });
  assert.equal(first.id, second.id);
  assert.ok(h.payment.fesicolWixRetryToken);
  assert.equal(h.payment.total, 200000);
});
test("preserva factura, FEVM, comentario y fecha; aplica ajustes", async () => {
  const h = harness({ sourceSystem: "fesicol", fesicolCicloId: "ciclo1", facturaId: "FAC-123",
    FEVM: 80000, comentario: "Factura asociada", fecha: "2026-10-15", recargo: 500, descuento: 100 });
  await h.sync("ciclo1");
  assert.equal(h.payment.facturaId, "FAC-123");
  assert.equal(h.payment.FEVM, 80000);
  assert.equal(h.payment.comentario, "Factura asociada");
  assert.equal(h.payment.fecha, "2026-10-15");
  assert.equal(h.payment.total, 200400);
});
test("no crea ciclos vacíos; eliminar todos conserva pago en cero", async () => {
  const h = harness(); h.setRows([]);
  assert.equal((await h.sync("ciclo1")).empty, true);
  assert.equal(h.writes, 0);
  h.setRows([enrollment("a")]); await h.sync("ciclo1");
  h.setRows([]); await h.sync("ciclo1");
  assert.equal(h.payment.total, 0);
  assert.deepEqual(h.payment.usuarios, []);
});
test("no modifica pagos ajenos", async () => {
  const h = harness({ sourceSystem: "manual" });
  await assert.rejects(h.sync("ciclo1"), /ocupado/);
  assert.equal(h.writes, 0);
});
