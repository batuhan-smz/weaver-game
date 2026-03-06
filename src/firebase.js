/**
 * firebase.js — Google Auth + Firestore cloud save for Weaver.
 *
 * Config lives in ./firebase-config.js (gitignored).
 * See firebase-config.example.js for the template.
 *
 * Firebase Console setup:
 *  1. Authentication → Sign-in method → Enable "Google"
 *  2. Authentication → Authorized domains → add "localhost"
 *  3. Firestore Database → Create (test mode)
 */

// All new sign-ins receive a one-time welcome bonus
const BONUS_COINS = 200;

const FIREBASE_VER = '10.14.1';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VER}`;

// Lazy-loaded Firebase modules
let _s = null;

async function _init() {
  if (_s) return _s;
  // Config loaded at runtime from gitignored file (never in source control)
  const { FIREBASE_CONFIG } = await import('./firebase-config.js');
  const [
    { initializeApp },
    { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged },
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
    GoogleAuthProvider, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged,
    doc, getDoc, setDoc, serverTimestamp,
  };
  return _s;
}

/**
 * Initiate Google redirect sign-in.
 * The result is picked up by onAuthStateChanged after the redirect completes.
 * (signInWithPopup is not supported in Android WebView.)
 */
export async function googleSignIn() {
  try {
    const s = await _init();
    const provider = new s.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await s.signInWithRedirect(s.auth, provider);
  } catch (err) {
    console.error('googleSignIn error:', err);
    throw err;
  }
}

/**
 * Call once on every page load to complete any pending redirect sign-in.
 * On success, onAuthStateChanged fires automatically with the new user.
 */
export async function checkRedirectResult() {
  try {
    const s = await _init();
    const result = await s.getRedirectResult(s.auth);
    return result; // null if no pending redirect
  } catch (err) {
    console.warn('checkRedirectResult:', err.code ?? err.message);
    return null;
  }
}

/** Sign out current user. */
export async function googleSignOut() {
  if (!_s) return;
  return _s.signOut(_s.auth);
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
