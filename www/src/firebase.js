/**
 * firebase.js — Google Auth + Firestore cloud save for Weaver.
 *
 * Config lives in ./firebase-config.js (gitignored).
 * See firebase-config.example.js for the template.
 *
 * Authentication strategy:
 *  - On Android Capacitor: uses @codetrix-studio/capacitor-google-auth (native)
 *  - On web/browser: uses Firebase signInWithPopup
 *
 * Firebase Console setup:
 *  1. Authentication → Sign-in method → Enable "Google"
 *  2. Authentication → Authorized domains → add "localhost"
 *  3. Firestore Database → Create (test mode)
 *  4. Get your Web Client ID from Google Cloud Console → APIs & Services → Credentials
 *     and set "serverClientId" in capacitor.config.json
 */

// All new sign-ins receive a one-time welcome bonus
const BONUS_COINS = 200;

const FIREBASE_VER = '10.14.1';
// Use local copies bundled with the app (CDN fails in Capacitor WebView)
const CDN = './flib';

// Detect Capacitor native environment
const IS_NATIVE = typeof window !== 'undefined' &&
  typeof window.Capacitor !== 'undefined' &&
  (typeof window.Capacitor.isNativePlatform === 'function'
    ? window.Capacitor.isNativePlatform()
    : !!window.Capacitor.isNative);

// Lazy-loaded Firebase modules — cache the PROMISE so initializeApp is never called twice
let _s = null;
let _initPromise = null;

function _init() {
  if (_s) return Promise.resolve(_s);
  if (!_initPromise) _initPromise = _doInit();
  return _initPromise;
}

async function _doInit() {
  const { FIREBASE_CONFIG } = await import('./firebase-config.js');
  const [
    { initializeApp, getApp },
    { getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, onAuthStateChanged },
    { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot,
      collection, query, where, limit, getDocs, serverTimestamp },
  ] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  // Guard against "app already exists" if initializeApp was called before
  let app;
  try {
    app = initializeApp(FIREBASE_CONFIG);
  } catch (e) {
    app = getApp();
  }
  const auth = getAuth(app);
  const db   = getFirestore(app);
  _s = {
    auth, db,
    GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, onAuthStateChanged,
    doc, getDoc, setDoc, updateDoc, onSnapshot,
    collection, query, where, limit, getDocs, serverTimestamp,
  };
  return _s;
}

/**
 * Sign in with Google.
 * On native Android: uses Capacitor native plugin (no WebView restriction).
 * On web: uses Firebase popup.
 * Returns the Firebase UserCredential.
 */
export async function googleSignIn() {
  const s = await _init();

  if (IS_NATIVE) {
    // Native Capacitor plugin registered on the bridge — no JS import needed
    const GoogleAuth = window.Capacitor?.Plugins?.GoogleAuth;
    if (!GoogleAuth) {
      const pluginKeys = Object.keys(window.Capacitor?.Plugins ?? {}).join(',');
      throw new Error('GoogleAuth plugin not found. Available: ' + pluginKeys);
    }
    // initialize() must be called before signIn() to set up GoogleSignInClient
    await GoogleAuth.initialize({
      clientId: '81968395529-shv2jhlldjmk3g94eervp36e8r9n0g77.apps.googleusercontent.com',
      scopes: ['profile', 'email'],
      grantOfflineAccess: true,
    });
    const googleUser = await GoogleAuth.signIn();
    const credential = s.GoogleAuthProvider.credential(
      googleUser.authentication.idToken,
    );
    return s.signInWithCredential(s.auth, credential);
  } else {
    // Web fallback: popup
    const provider = new s.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return s.signInWithPopup(s.auth, provider);
  }
}

/** Sign out current user. */
export async function googleSignOut() {
  const s = await _init().catch(() => null);
  if (!s) return;
  if (IS_NATIVE) {
    try {
      const GoogleAuth = window.Capacitor?.Plugins?.GoogleAuth;
      if (GoogleAuth) {
        await GoogleAuth.initialize({
          clientId: '81968395529-shv2jhlldjmk3g94eervp36e8r9n0g77.apps.googleusercontent.com',
          scopes: ['profile', 'email'],
          grantOfflineAccess: true,
        }).catch(() => {});
        await GoogleAuth.signOut();
      }
    } catch (_) {}
  }
  try {
    return await s.signOut(s.auth);
  } catch (_) {
    return null;
  }
}

/**
 * Listen to auth state changes.
 * Calls cb(user | null) once immediately and on every change.
 * Returns an unsubscribe function.
 */
export function onAuthChange(cb) {
  let _unsub = () => {};
  _init()
    .then(s => { _unsub = s.onAuthStateChanged(s.auth, cb); })
    .catch(() => cb(null));
  return () => _unsub();
}

/** Load cloud save for uid. Returns data object or null. */
export async function loadCloudSave(uid) {
  const s = await _init();
  const snap = await s.getDoc(s.doc(s.db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Write current game progress to Firestore (merge).
 */
export async function saveCloudSave(uid, data) {
  const s = await _init();
  await s.setDoc(
    s.doc(s.db, 'users', uid),
    { ...data, updatedAt: s.serverTimestamp() },
    { merge: true },
  );
}

/**
 * Apply one-time welcome bonus for new sign-ins.
 * Returns bonus coin amount (0 if already given).
 */
export async function applyBonusIfNeeded(uid, email) {
  const s    = await _init();
  const ref  = s.doc(s.db, 'users', uid);
  const snap = await s.getDoc(ref);
  if (snap.exists() && snap.data().bonusApplied) return 0;
  await s.setDoc(ref, { bonusApplied: true }, { merge: true });
  return BONUS_COINS;
}

/**
 * Returns the initialized Firebase services object (for VS mode etc.).
 */
export async function getFirebaseServices() {
  return _init();
}
