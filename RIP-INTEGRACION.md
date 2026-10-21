# Pago consolidado FESICOL en Clientes de RIP

Cada ciclo genera un documento estable en `rip-musicala/clientesB2C`:
`fesicol_<SHA256 del ciclo, primeros 32 caracteres>`. Incluye todos los
beneficiarios activos, sus servicios y precios, con medio de pago Fesicol.
Musifamiliar conserva cada beneficiario pero suma el paquete una sola vez.
Las inscripciones retiradas se excluyen. Altas, cambios y bajas recalculan
el mismo pago; al cambiar de ciclo se recalculan los dos ciclos.

El pago aparece en Clientes para asociar factura y activa el plan Wix de
cada beneficiario. El trigger `syncFesicolRegistro` crea además un movimiento
individual de Pago por inscripción en `registro`, vinculado al mismo pago
consolidado y a la identidad oficial de la ficha RIP. Nunca usa IDs locales
de estudiantes Fesicol como identidades oficiales RIP.
En Estudiantes de Fesicol se puede completar el **Correo del miembro Wix**;
si está vacío, RIP intenta resolver una única ficha por su nombre exacto.
Los casos sin identidad o sin un plan coincidente quedan bloqueados y visibles
en Clientes → Editar → Planes Wix de Fesicol.

Las actualizaciones preservan FEVM, factura y cualquier otro campo no
administrado por la integración, incluyendo comentario, fecha y ajustes.
La lista de beneficiarios y sus precios se administra desde Fesicol; editar
esos datos en RIP será reemplazado al siguiente cambio de inscripción.
Si se retiran todos, se conserva el pago en cero y la factura asociada.

## Archivos en los dos proyectos

En Fesicol: `functions/fesicol-rip.js`, `functions/index.js`, `app.js`,
`db.js`, `index.html`. En la copia local de RIP, en
`../RIP 2026/RIP + Programación (Firebase id diferente)/`:

- `functions/index.js` y `functions/fesicol-wix.js`: el trigger nuevo
  `activateFesicolWixSubscriptions` atiende altas y actualizaciones, con
  una activación persistente por inscripción. El trigger general delega
  los pagos Fesicol al nuevo para evitar una doble activación.
- `functions/fesicol-registro.js` y `functions/rip-calculations.js`:
  sincronizan los pagos individuales con los cálculos publicados de RIP.
  Un ID estable por inscripción evita duplicados. Los paquetes repetidos
  de persona/servicio/mes requieren confirmación explícita mediante
  `fesicolInscripcionesConfirmadas` en el pago; no se elimina ningún pago
  manual coincidente, que se conserva para revisión.
- `rip.repository.js`: permitir editar FEVM y otros datos del consolidado
  preservando los identificadores y correos de inscripción; los usuarios
  del pago se administran desde Fesicol.
- `app.js` e `index.html`: mostrar resultados de activación por beneficiario
  en Clientes y refrescar versiones de caché.

**El cambio de RIP debe desplegarse primero**. El trigger general solo
atiende la creación: el nuevo también cubre las inscripciones añadidas al
mismo pago y evita recomprar los planes de los beneficiarios anteriores.
La copia de RIP contiene otros cambios previos del usuario; revisarlos
antes de publicar sus archivos completos.

## Activación

Activado el 20 de octubre de 2026, con autorización del usuario:

- `manager-fesicol` quedó con facturación activa usando la misma cuenta de RIP.
- Las tres funciones de sincronización Fesicol y las dos de activación Wix
  están desplegadas y `ACTIVE`, con Node.js 22.
- La cuenta de ejecución `501861978891-compute@developer.gserviceaccount.com`
  tiene acceso Firestore en ambos proyectos y recepción de eventos en Fesicol.
- Frontend actualizado: https://manager-fesicol.web.app.
- Comprobación real de los disparadores de alta y borrado completada con
  una inscripción temporal retirada: se confirmó sincronización vacía en
  ambos eventos y ausencia de pago en RIP. El registro temporal y su estado
  se eliminaron por completo. No se crearon pagos ni órdenes Wix de prueba.
- RIP conserva los archivos publicados previamente, con tres archivos de
  interfaz actualizados para Fesicol (sin publicar otros cambios locales).
- GitHub rechazó la escritura del repositorio (`Resource not accessible by
  integration`). El enlace de GitHub Pages conserva su versión anterior;
  usar el enlace Firebase para la versión integrada.

El despliegue inicial de las tres funciones Fesicol se hizo desde
`tmp/deploy-fesicol`, aislando sus exportaciones para no desplegar ni exigir
el secreto RESEND_API_KEY de la función de correo que ya existía en el código.
La configuración raíz ya incluye Hosting para publicaciones posteriores.

1. Desplegar en RIP las funciones `activateWixSubscriptions` y
   `activateFesicolWixSubscriptions` juntas y publicar `rip.repository.js`,
   `app.js` e `index.html`. Se reutiliza el secreto `WIX_API_KEY` existente.
   El archivo nuevo `functions/fesicol-wix.js` debe incluirse en el despliegue.
   También desplegar `syncFesicolRegistro` cuando se actualice la sincronización
   individual. Se puede reconstruir Registro sin comprar planes mediante
   un cambio en `fesicolRegistroRetryToken`, sin modificar `fesicolWixRetryToken`.
2. En Firebase/GCP obtener la cuenta de servicio de ejecución de las nuevas
   funciones de `manager-fesicol`. Otorgarle en **rip-musicala** el rol
   `roles/datastore.user`; no se deben abrir las reglas a accesos públicos.
   La función usa credenciales del entorno, sin llaves privadas en archivos.
3. Instalar dependencias con `npm install` dentro de `functions/`.
4. Desplegar desde Fesicol:

   ```powershell
   firebase deploy --project manager-fesicol --only functions:sincronizarInscripcionRIP,functions:sincronizarCicloRIP,functions:sincronizarEstudianteRIP
   ```

   Requiere acceso a ambos proyectos y los servicios/plan necesarios para
   Cloud Functions y Eventarc. No desplegar reglas ni otras funciones.
5. Publicar los archivos frontend de Fesicol. No es necesario cambiar
   reglas Firestore: `ripSincronizaciones` usa las reglas de lectura existentes.
6. Abrir un ciclo en Fesicol y usar **Sincronizar pago y planes** para sus inscripciones
   existentes. Los eventos automáticos cubren las nuevas y sus modificaciones.
7. Verificar en RIP → Clientes el documento `fesicol_…`, medio Fesicol,
   beneficiarios y total. Completar FEVM/factura y agregar otra inscripción:
   debe actualizarse el mismo documento conservando la información de factura.
   Verificar además los resultados Wix por beneficiario. Musifamiliar suma
   un único precio en Clientes y activa el plan de cada beneficiario,
   incluyendo los que figuran con precio contable cero.

## Activación Wix y reintentos

Se utiliza el flujo existente de RIP: miembro por correo, plan por mapeo
`wixPlanMappings` o nombre exacto, orden offline pagada y verificación de
miembro, plan y suscripción. Contrato comprobado con la documentación
oficial de [Create Offline Order](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/create-offline-order).

La colección de backend `fesicolWixActivations` conserva una operación por
ID de inscripción. Un evento repetido, un cambio de factura o mover la
inscripción de ciclo no vuelve a comprar el plan. Si cambia servicio/correo
después de la activación, se marca revisión del plan existente.
Retirar una inscripción actualiza Clientes; no cancela planes Wix existentes.

Un fallo de validación anterior al envío queda `blocked`: corregir el correo
en Fesicol o el mapeo en RIP y pulsar **Sincronizar pago y planes** permite
reintentar solo los bloqueados. Un timeout después de solicitar la compra
queda `review` y requiere revisar la orden antes de otra compra; nunca se
reintenta automáticamente una solicitud que podría haber creado un plan.
La reserva persistente se realiza antes de enviar la petición. Una caída
del proceso que deje `processing` o `requesting` requiere revisar esa operación
en la colección y Wix antes de restablecerla manualmente.

En el detalle del ciclo se observa el resultado o el error de sincronización.
El backend reintenta eventos fallidos; el botón permite reintentar manualmente.
Un evento duplicado no genera otro pago ni otra entrada de auditoría.
Los cambios de nombre y correo del estudiante se sincronizan automáticamente.
Tras corregir el nombre del ciclo, usar **Sincronizar pago y planes**.

## Verificación local

```powershell
node --test functions/test/fesicol-rip.test.js
node --check functions/index.js
node --check app.js
node --test "../RIP 2026/RIP + Programación (Firebase id diferente)/functions/test/fesicol-wix.test.js"
```

Pruebas sin escribir registros reales: múltiples beneficiarios, Musifamiliar,
retiros, eventos repetidos y simultáneos, totales, conservación de factura,
ciclos vacíos, activación incremental, fallos previos a compra y respuestas
inciertas de Wix. Las pruebas usan dobles de Wix, sin activar planes reales.
