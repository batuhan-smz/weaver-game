/**
 * firebase.js — Google Auth + Firestore cloud save for Weaver.
 *
 * SETUP (one-time, needs Firebase Console):
 *  1. https://console.firebase.google.com → New project (e.g. "weaver-game")
 *  2. Authentication → Sign-in method → Enable "Google"
 *  3. Firestore Database → Create database (start in test mode)
 *  4. Project Settings → Your apps → Add Web App → copy firebaseConfig below
 *  5. Authentication → Settings → Authorized domains → add your domain
 *
 * For Android (Capacitor):
 *  - Project Settings → Your apps → Add Android App (package: com.batuhan.weavergame)
 *  - Download google-services.json → place in android/app/
 *  - Add debug SHA-1 to Firebase (run: cd android && gradlew signingReport)
 */

// ─── Replace this block with your Firebase project config ────────────────────
const FIREBASE_CONFIG = {
  apiKey:            'YOUR_API_KEY',
  authDomain:        'YOUR_PROJECT.firebaseapp.com',
  projectId:         'YOUR_PROJECT_ID',
  storageBucket:     'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId:             'YOUR_APP_ID',
};
// ─────────────────────────────────────────────────────────────────────────────

// Accounts that receive a one-time welcome bonus
const BONUS_EMAILS = ['batuhansemiz15@gmail.com'];
const BONUS_COINS  = 10_000;

export const IS_CONFIGURED = !FIREBASE_CONFIG.apiKey.startsWith('YOUR_');

const FIREBASE_VER = '11.3.1';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VER}`;

// Lazy-loaded Firebase modules
let _s = null; // { auth, db, mods }

async function _init() {
  if (_s) return _s;
  const [
    { initializeApp },
    { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged },
    { getFirestore, doc, getDoc, setDoc, serverTimestamp },
  ] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  const app  = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db   = getFirestore(app);
  _s = {
    auth, db,
    GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
    doc, getDoc, setDoc, serverTimestamp,
  };
  return _s;
}

/** Open Google sign-in popup. Returns UserCredential. */
export async function googleSignIn() {
  const s = await _init();
  const provider = new s.GoogleAuthProvider();
  return s.signInWithPopup(s.auth, provider);
}

/** Sign out current user. */
export async function googleSignOut() {
  if (!_s) return;
  return _s.signOut(_s.auth);
}

/**
 * Listen to auth state changes.
 * Calls cb(user | null) immediately and on every change.
 * Returns an unsubscribe function.
 */
export function onAuthChange(cb) {
  if (!IS_CONFIGURED) { setTimeout(() => cb(null), 0); return () => {}; }
  let _unsub = () => {};
  _init().then(s => { _unsub = s.onAuthStateChanged(s.auth, cb); });
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
 * @param {string} uid
 * @param {{ coins: number, unlockedIds: string[], activeSkinId: string, bestScore: number }} data
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
 * Apply one-time welcome bonus for BONUS_EMAILS accounts.
 * Returns bonus coin amount (0 if already given or not eligible).
 */
export async function applyBonusIfNeeded(uid, email) {
  if (!BONUS_EMAILS.includes(email)) return 0;
  const s    = await _init();
  const ref  = s.doc(s.db, 'users', uid);
  const snap = await s.getDoc(ref);
  if (snap.exists() && snap.data().bonusApplied) return 0;
  await s.setDoc(ref, { bonusApplied: true }, { merge: true });
  return BONUS_COINS;
}
