/**
 * ads.js — AdMob rewarded ad wrapper for Capacitor.
 *
 * ⚠️  TEST IDs kullanılıyor. Play Store'a yüklemeden önce şunları değiştir:
 *   1. App ID   → AndroidManifest.xml içindeki "com.google.android.gms.ads.APPLICATION_ID"
 *   2. Unit ID  → aşağıdaki REWARDED_AD_ID
 *
 * AdMob Console: https://admob.google.com
 */

// Gerçek ID'ler — hesap onaylandıktan sonra çalışır
const REAL_APP_ID      = 'ca-app-pub-6143982813228060~4115428533';
const REAL_REWARDED_ID = 'ca-app-pub-6143982813228060/6473998564';

// Google test ID'leri — hesap onayı beklenirken kullan
const TEST_REWARDED_ID = 'ca-app-pub-3940256099942544/5224354917';

// Hesap onaylandığında TEST_MODE = false yap
const TEST_MODE = true;

const REWARDED_AD_ID = TEST_MODE ? TEST_REWARDED_ID : REAL_REWARDED_ID;

let _ready      = false;
let _loading    = false;
let _retryDelay = 10000; // ms — hata alınca kademeli artacak
let _listeners  = [];

function _plugin() {
  return window.Capacitor?.Plugins?.AdMob ?? null;
}

function _removeListeners() {
  _listeners.forEach(h => h?.remove?.());
  _listeners = [];
}

/** AdMob'u başlat ve ilk reklamı arka planda yükle */
export async function initAds() {
  const p = _plugin();
  if (!p) return; // web/browser — reklam yok
  try {
    await p.initialize({ requestTrackingAuthorization: false });
    _preload();
  } catch (e) {
    console.warn('[ads] init:', e?.message ?? e);
  }
}

async function _preload() {
  const p = _plugin();
  if (!p || _loading || _ready) return;
  _loading = true;
  _ready   = false;
  try {
    await p.prepareRewardVideoAd({ adId: REWARDED_AD_ID });
    _ready = true;
    _retryDelay = 10000; // başarıda sıfırla
  } catch (e) {
    console.warn('[ads] preload:', e?.message ?? e);
    // Kademeli backoff — "too many requests" hatasını önler
    setTimeout(() => { _loading = false; _preload(); }, _retryDelay);
    _retryDelay = Math.min(_retryDelay * 2, 5 * 60 * 1000); // max 5 dakika
    return; // _loading = false'u finally'de değil timeout'ta yapıyoruz
  }
  _loading = false;
}

/**
 * Reklamı göster.
 * Kullanıcı ödülü kazanırsa true, iptal ederse / hata olursa false döner.
 */
export function showRewardedAd() {
  return new Promise(async (resolve) => {
    const p = _plugin();
    if (!p) { resolve(false); return; }

    if (!_ready) {
      await _preload();
      if (!_ready) { resolve(false); return; }
    }

    _removeListeners();
    let earned = false;

    const finish = () => {
      _removeListeners();
      _ready = false;
      _preload(); // bir sonraki reklamı önceden yükle
      resolve(earned);
    };

    const h1 = await p.addListener('onRewardedVideoAdReward',        () => { earned = true; });
    const h2 = await p.addListener('onRewardedVideoAdDismissed',     finish);
    const h3 = await p.addListener('onRewardedVideoAdFailedToShow',  finish);
    _listeners = [h1, h2, h3];

    try {
      await p.showRewardVideoAd();
    } catch (e) {
      console.warn('[ads] show:', e?.message ?? e);
      finish();
    }
  });
}

/** Reklam hazır mı? (buton state güncellemek için) */
export function isAdReady() {
  return !!_plugin() && _ready;
}
