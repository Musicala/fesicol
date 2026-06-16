# Panel FESICOL · Musicala — Puesta en marcha (Fase 1)

Migrado de Google Sheets → **Cloud Firestore + Firebase Storage**. Proyecto Firebase: `manager-fesicol`.

## 1. Activar Firestore (1 vez)
1. Entra a [Firebase Console](https://console.firebase.google.com/project/manager-fesicol/firestore).
2. **Crear base de datos** → modo **Producción** → región `nam5` (us-central) o `southamerica-east1`.
3. Pestaña **Reglas** → pega el contenido de `firestore.rules` → **Publicar**.

## 2. Activar Storage (1 vez)
1. Ve a **Build → Storage** → **Comenzar**.
2. Pestaña **Reglas** → pega `storage.rules` → **Publicar**.

## 3. Roles y usuarios
Habilita **Authentication → Sign-in method → Google**.

**Administradores (acceso total, fijos en el código y en las reglas):**
- alekcaballeromusic@gmail.com
- catalina.medina.leal@gmail.com
- imusicala@gmail.com
- musicalaasesor@gmail.com

**Lectores (solo ver):** se agregan desde el panel, sección **Usuarios** → *Agregar usuario*. Quedan guardados en la colección `usuarios`. Ese correo luego entra con **“Continuar con Google”** y verá la info sin botones de editar/crear/borrar.

> Si un correo no es admin ni está en `usuarios`, al intentar entrar se cierra la sesión con un aviso.

## 4. Dominios autorizados
En **Authentication → Settings → Authorized domains** agrega el dominio donde publiques (y `localhost` para pruebas).

## 5. Probar en local
El panel usa ES Modules + Firebase, así que **no funciona abriendo el HTML directo** (`file://`). Sírvelo:

```powershell
# desde la carpeta FESICOL
python -m http.server 5500
# abre http://localhost:5500
```

## Primera carga
Al entrar la primera vez, el panel **siembra solo**:
- Las **tarifas 2026** (desde `fesicol.json`).
- 5 **ciclos** base (edítalos en *Ciclos y fechas*).

## Estructura de datos (Firestore)
`ciclos`, `asociados`, `estudiantes`, `inscripciones`, `planillas`, `facturas`, `tarifas`.

## Importar planilla (Fase 2)
Sección **Importar planilla** (solo admin):
1. Elige el **ciclo** y el **mes**.
2. Sube el Excel que envía FESICOL (lee la hoja **FUENTE**).
3. Revisa la **vista previa** (marca estudiantes nuevos/existentes y el precio según tarifa).
4. **Confirmar e importar** → crea/actualiza estudiantes, asociados e inscripciones, y guarda el Excel original en Storage.

Si dejas el ciclo en blanco, solo carga/actualiza estudiantes (sin inscripción).

## Fase 3 (lista)
- **Gráfica de ingresos por mes** y **calendario de ciclos** (timeline con días restantes) en el Resumen.
- **Alertas de fechas:** banners automáticos para todo ciclo cuyo cierre de inscripción caiga dentro de los próximos 30 días (en rojo si faltan ≤7 días). Funcionan al abrir el panel.
- **Exportar a Excel** en Estudiantes, Inscripciones y Facturación (botón ⬇ Excel).

### Alertas por correo (opcional, requiere backend)
El aviso por **correo** automático (sin abrir el panel) necesita un backend, porque el navegador no puede enviar correos programados. Opciones:
- **Cloud Functions + Scheduler** (plan Blaze de Firebase) con una función diaria que revise `ciclos` y envíe correo vía SendGrid/Gmail API.
- O un **Apps Script con disparador por tiempo** que lea Firestore y mande el correo.

Si quieres, lo montamos como una mini Fase 3.1.

---
## Próximas ideas
- Renovación/retención por ciclo (cuántos estudiantes vuelven), reporte trimestral, recordatorios automáticos a estudiantes.
