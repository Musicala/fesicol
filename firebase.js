// firebase.js
// Firebase modular SDK (CDN) · ES Module
// Mejorado para:
// - Inicialización singleton segura
// - Persistencia controlada
// - Google Sign-In robusto (popup / redirect)
// - Mensajes de error más claros
// - Helpers reutilizables para app.js

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* =========================================================
   Singleton interno del módulo
========================================================= */
let __firebaseInstance = null;

/* =========================================================
   Utils
========================================================= */
function noop() {}

function safeCode(err) {
  return String(err?.code || "").trim();
}

function isFn(v) {
  return typeof v === "function";
}

function createLogger(debug = false) {
  return debug
    ? (...args) => console.log("[firebase]", ...args)
    : noop;
}

function resolvePersistence(mode = "local") {
  return mode === "session"
    ? browserSessionPersistence
    : browserLocalPersistence;
}

/* =========================================================
   Mensajes humanos de Firebase Auth
========================================================= */
function prettyAuthError(err) {
  const code = safeCode(err);

  const map = {
    // Generales
    "auth/invalid-email": "Ese correo no parece válido.",
    "auth/missing-password": "Escribe la contraseña.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/user-not-found": "No existe un usuario con ese correo.",
    "auth/invalid-credential": "Los datos de acceso no son válidos.",
    "auth/user-disabled": "Este usuario fue deshabilitado.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento y vuelve a probar.",
    "auth/network-request-failed": "Falló la conexión. Revisa internet e intenta otra vez.",
    "auth/internal-error": "Firebase devolvió un error interno. Intenta otra vez.",
    "auth/web-storage-unsupported": "Este navegador no permite el almacenamiento necesario para iniciar sesión.",
    "auth/timeout": "La operación tardó demasiado. Intenta otra vez.",

    // Google / popup / redirect
    "auth/popup-blocked": "El navegador bloqueó la ventana de Google.",
    "auth/popup-closed-by-user": "Se cerró la ventana de Google antes de terminar el acceso.",
    "auth/cancelled-popup-request": "Se canceló el intento de acceso anterior.",
    "auth/unauthorized-domain":
      "Este dominio no está autorizado en Firebase. Agrega localhost, 127.0.0.1 o tu dominio real en Authorized domains.",
    "auth/operation-not-allowed":
      "El acceso con Google no está habilitado en Firebase Authentication.",
    "auth/account-exists-with-different-credential":
      "Ese correo ya existe con otro método de acceso. Usa el método original.",
    "auth/redirect-cancelled-by-user": "Se canceló el proceso de redirección.",
    "auth/redirect-operation-pending": "Ya hay un proceso de acceso en curso.",
    "auth/invalid-action-code": "La acción de autenticación no es válida o ya expiró."
  };

  return map[code] || "No se pudo iniciar sesión. Intenta de nuevo.";
}

/* =========================================================
   Init principal
========================================================= */
/**
 * initFirebase(firebaseConfig, options?)
 *
 * @param {object} firebaseConfig
 * @param {object} [options]
 * @param {"local"|"session"} [options.persistence="local"]
 * @param {boolean} [options.debug=false]
 * @param {string} [options.googlePrompt="select_account"]
 * @param {boolean} [options.googleForceSelectAccount=true]
 */
export function initFirebase(firebaseConfig, options = {}) {
  if (__firebaseInstance) {
    return __firebaseInstance;
  }

  const opts = {
    persistence: "local",
    debug: false,
    googlePrompt: "select_account",
    googleForceSelectAccount: true,
    ...options
  };

  const log = createLogger(opts.debug);

  // App singleton segura
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);

  // Firestore + Storage (base de datos y archivos del convenio)
  const db = getFirestore(app);
  const storage = getStorage(app);

  /* =======================================================
     Persistencia
  ======================================================= */
  const persistenceMode = resolvePersistence(opts.persistence);

  const persistenceReady = setPersistence(auth, persistenceMode)
    .then(() => {
      log("Persistence set:", opts.persistence);
      return true;
    })
    .catch((err) => {
      // No tumbamos la app por esto. La vida ya es suficientemente fastidiosa.
      log("Persistence failed:", safeCode(err) || err);
      return false;
    });

  async function ensurePersistenceReady() {
    try {
      await persistenceReady;
    } catch (_) {
      // Ignorar. Ya se manejó arriba.
    }
  }

  /* =======================================================
     Google Provider
  ======================================================= */
  const googleProvider = new GoogleAuthProvider();

  if (opts.googleForceSelectAccount) {
    googleProvider.setCustomParameters({
      prompt: opts.googlePrompt || "select_account"
    });
  } else if (opts.googlePrompt) {
    googleProvider.setCustomParameters({
      prompt: opts.googlePrompt
    });
  }

  // Puedes añadir scopes si luego los necesitan:
  // googleProvider.addScope("email");
  // googleProvider.addScope("profile");

  /* =======================================================
     Wrappers mejorados
  ======================================================= */

  /**
   * Login con email/contraseña, esperando a que persistencia quede lista.
   */
  async function signInWithEmail(email, password) {
    await ensurePersistenceReady();
    return signInWithEmailAndPassword(auth, email, password);
  }

  /**
   * Define si tiene sentido hacer fallback automático a redirect.
   */
  function shouldFallbackToRedirect(err) {
    const code = safeCode(err);
    return (
      code === "auth/popup-blocked" ||
      code === "auth/web-storage-unsupported"
    );
  }

  /**
   * Inicia sesión con Google.
   *
   * @param {object} [cfg]
   * @param {boolean} [cfg.preferRedirect=false] - Si true, usa redirect desde el inicio
   * @param {boolean} [cfg.forceRedirect=false]  - Fuerza redirect
   * @param {boolean} [cfg.forcePopup=false]     - Fuerza popup
   *
   * @returns {Promise<{ok:boolean, method?:'popup'|'redirect', user?:any, credential?:any, error?:any, message?:string}>}
   */
  async function signInWithGoogle(cfg = {}) {
    const {
      preferRedirect = false,
      forceRedirect = false,
      forcePopup = false
    } = cfg || {};

    await ensurePersistenceReady();

    const useRedirect = forceRedirect || (preferRedirect && !forcePopup);

    try {
      if (useRedirect) {
        log("Google sign-in via redirect");
        await signInWithRedirect(auth, googleProvider);
        return { ok: true, method: "redirect" };
      }

      log("Google sign-in via popup");
      const result = await signInWithPopup(auth, googleProvider);

      return {
        ok: true,
        method: "popup",
        user: result?.user || null,
        credential: GoogleAuthProvider.credentialFromResult(result) || null,
        result
      };
    } catch (err) {
      const code = safeCode(err);
      log("Google sign-in error:", code || err, err);

      // Solo hacemos fallback cuando realmente tiene sentido.
      // Si el usuario cerró el popup, no lo mandamos a redirect por la fuerza.
      if (!useRedirect && shouldFallbackToRedirect(err)) {
        try {
          log("Popup falló, intentando redirect...");
          await signInWithRedirect(auth, googleProvider);
          return { ok: true, method: "redirect" };
        } catch (err2) {
          log("Redirect fallback failed:", safeCode(err2) || err2, err2);
          return {
            ok: false,
            error: err2,
            message: prettyAuthError(err2)
          };
        }
      }

      return {
        ok: false,
        error: err,
        message: prettyAuthError(err)
      };
    }
  }

  /**
   * Recupera el resultado de un redirect si existe.
   * No rompe nada si no había redirect pendiente.
   */
  async function consumeRedirectResult() {
    await ensurePersistenceReady();

    try {
      const result = await getRedirectResult(auth);

      if (!result) {
        log("No pending redirect result");
        return {
          ok: true,
          result: null,
          user: null,
          method: "redirect"
        };
      }

      const credential = GoogleAuthProvider.credentialFromResult(result) || null;
      const user = result?.user || null;

      log("Redirect result user:", user?.email || "—");

      return {
        ok: true,
        result,
        credential,
        user,
        method: "redirect"
      };
    } catch (err) {
      const code = safeCode(err);
      log("Redirect result error:", code || err, err);

      return {
        ok: false,
        error: err,
        message: prettyAuthError(err)
      };
    }
  }

  /**
   * Cierre de sesión seguro.
   */
  async function signOutSafe() {
    await signOut(auth);
    return true;
  }

  /**
   * Info útil para diagnóstico.
   */
  function getAuthDebugInfo() {
    return {
      appName: app?.name || "[DEFAULT]",
      projectId: app?.options?.projectId || "",
      authDomain: app?.options?.authDomain || "",
      persistence: opts.persistence,
      currentUser: auth?.currentUser
        ? {
            uid: auth.currentUser.uid,
            email: auth.currentUser.email || "",
            displayName: auth.currentUser.displayName || ""
          }
        : null
    };
  }

  /* =======================================================
     Instancia pública
  ======================================================= */
  __firebaseInstance = {
    app,
    auth,
    db,
    storage,

    // Eventos
    onAuthStateChanged,

    // Auth email/pass
    signInWithEmailAndPassword, // crudo, por compatibilidad
    signInWithEmail,            // wrapper recomendado
    signOut,                    // crudo, por compatibilidad
    signOutSafe,

    // Google
    GoogleAuthProvider,
    googleProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    signInWithGoogle,
    consumeRedirectResult,

    // Utils
    prettyAuthError,
    getAuthDebugInfo,
    persistenceReady
  };

  log("Firebase initialized:", {
    app: app?.name,
    projectId: app?.options?.projectId,
    persistence: opts.persistence
  });

  return __firebaseInstance;
}