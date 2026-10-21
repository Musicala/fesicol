const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const dest = path.join(root, "hosting-dist");
fs.mkdirSync(dest, { recursive: true });
for (const file of ["index.html", "app.js", "db.js", "firebase.js", "planilla-control.js", "gmail-prefacturas.js", "correo-programado.js", "styles.css", "logo.png"]) {
  fs.copyFileSync(path.join(root, file), path.join(dest, file));
}
console.log("Archivos públicos preparados en hosting-dist.");
