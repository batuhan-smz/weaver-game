/**
 * main.js - Game orchestrator with start menu, economy, skins, and bottom nav.
 */

import { Grid }                        from './grid.js';
import { generateTray, Block, SHAPES, COLORS as PALETTE } from './blocks.js';
import { Renderer }          from './renderer.js';
import { runClearingLogic }  from './clearing.js';
import { ScoreSystem }       from './score.js';
import { ParticleSystem }    from './particles.js';
import { isGameOver }        from './gameover.js';
import { SKINS, EconomyStore } from './skins.js';
import { POWERUPS, MarketStore } from './market.js';
import {
  playPlace, playClear, playCluster, playMega, playClean,
  setMasterVolume, getMasterVolume,
  setSfxVolume, getSfxVolume,
  setMusicVolume, getMusicVolume,
  prepareBackgroundMusic, resumeAudio,
} from './sounds.js';
import {
  googleSignIn, googleSignOut, onAuthChange,
  loadCloudSave, saveCloudSave, applyBonusIfNeeded, getFirebaseServices,
} from './firebase.js';
import {
  createMatch, joinMatchByCode, quickMatch,
  updatePlayerState, finishMatch, cancelMatch, subscribeMatch,
  serializeBoard, drawMiniBoard, nextVsBlock, SeededRng,
} from './vs.js';
import { t, setLang, getLang, AVAILABLE_LANGS } from './i18n.js';
import { initAds, showRewardedAd } from './ads.js';

const TRAY_SIZE      = 4;
const HARD_EVERY     = 5;
const SCORE_PER_COIN = 1000;
const TUTORIAL_KEY   = 'weaverTutorialDone';
const TUTORIAL_TOTAL_STEPS = 4;
const CLEAN_BONUS_POINTS = 500;
const VS_STATE_SYNC_MS = 300;
const VS_MOVE_TIMEOUT_MS = 20_000;
const GUEST_SNAPSHOT_KEY = 'weaverGuestSnapshot';
const RANK_KEY_PREFIX = 'weaverRankPoints';
const RANK_TIERS = [
  { key: 'bronze',  label: 'BRONZ', threshold: 0,    gapToWin: 1000 },
  { key: 'silver',  label: 'GUMUS', threshold: 1000, gapToWin: 2000 },
  { key: 'gold',    label: 'ALTIN', threshold: 2000, gapToWin: 3000 },
  { key: 'diamond', label: 'ELMAS', threshold: 3000, gapToWin: 4000 },
];

const COLOR_STEPS = [
  { maxScore: 2000, colors: 4 },
  { maxScore: 5000, colors: 5 },
  { maxScore: 9000, colors: 6 },
  { maxScore: 14000, colors: 7 },
  { maxScore: Infinity, colors: 8 },
];

// ── Layout ──────────────────────────────────────────────────────────────────

const LAYOUT = { NAV: 56, HEADER: 56, TRAY: 126, PAD: 14 };

function _measuredHeight(id, fallback) {
  const el = document.getElementById(id);
  if (!el || el.classList.contains('hidden')) return fallback;
  return Math.max(0, Math.round(el.getBoundingClientRect().height)) || fallback;
}

function computeGridSize() {
  const { PAD } = LAYOUT;
  const area = document.getElementById('game-area');
  const hasMeasuredArea = !!area && area.clientWidth > 0 && area.clientHeight > 0;

  // Preferred: use real available space of the game area.
  const aw = hasMeasuredArea ? (area.clientWidth - PAD * 2) : (window.innerWidth - PAD * 2);
  const ah = hasMeasuredArea
    ? (area.clientHeight - PAD * 2)
    : (() => {
        const NAV = _measuredHeight('bottom-nav', LAYOUT.NAV);
        const HEADER = _measuredHeight('play-header', LAYOUT.HEADER);
        const trayH = _measuredHeight('tray', LAYOUT.TRAY);
        const rotateH = _measuredHeight('rotate-controls', 0);
        // Tray and rotate controls are stacked, so their heights are additive.
        const bottomStack = trayH + rotateH;
        return window.innerHeight - NAV - HEADER - bottomStack - PAD * 2;
      })();

  return Math.max(160, Math.floor(Math.min(aw, ah) / 10) * 10);
}

function computeTraySize(gridSize) {
  return Math.max(52, Math.floor((Math.min(window.innerWidth - 24, gridSize) - 8 * 3) / 4));
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

const _el = id => document.getElementById(id);

function _setVisible(el, visible) {
  el?.classList.toggle('hidden', !visible);
}

function _rankStorageKey(uid) {
  return uid ? `${RANK_KEY_PREFIX}_${uid}` : RANK_KEY_PREFIX;
}

function _getRankPoints(uid = _currentUser?.uid) {
  return Number(localStorage.getItem(_rankStorageKey(uid)) ?? 0);
}

function _setRankPoints(points, uid = _currentUser?.uid) {
  const safe = Math.max(0, Math.round(points));
  localStorage.setItem(_rankStorageKey(uid), String(safe));
  return safe;
}

function _tierForRankPoints(points) {
  let tier = RANK_TIERS[0];
  for (const t of RANK_TIERS) {
    if (points >= t.threshold) tier = t;
  }
  return tier;
}

function _gapTargetByRanks(hostRankPoints, guestRankPoints) {
  const hostTier = _tierForRankPoints(Number(hostRankPoints ?? 0));
  const guestTier = _tierForRankPoints(Number(guestRankPoints ?? 0));
  return Math.max(hostTier.gapToWin, guestTier.gapToWin);
}

function _rankDeltaForResult(myRank, oppRank, isWin, isTie) {
  if (isTie) return 0;
  const diff = Math.abs(myRank - oppRank);
  const w = Math.min(1, diff / 200);
  const lowerWinGain = Math.round(40 + 10 * w);
  const higherWinGain = Math.round(40 - 10 * w);
  const meLower = myRank < oppRank;

  if (isWin) return meLower ? lowerWinGain : higherWinGain;
  return meLower ? -higherWinGain : -lowerWinGain;
}

function _formatRankText(points) {
  const tier = _tierForRankPoints(points);
  return `${tier.label} • ${Number(points ?? 0).toLocaleString()} RP`;
}

function _updateRankBadges(uid = _currentUser?.uid) {
  const points = _getRankPoints(uid);
  const text = _formatRankText(points);
  ['ss-rank-badge', 'ss-rank-summary', 'play-rank-pill', 'settings-rank-badge']
    .forEach(id => {
      const el = _el(id);
      if (el) el.textContent = text;
    });
}

function _captureGuestSnapshot() {
  const snapshot = {
    coins: economy.coins,
    unlockedIds: [...economy.unlockedIds],
    activeSkinId: economy.activeSkinId,
    bestScore: Number(localStorage.getItem('weaverBest') ?? 0),
    rankPoints: _getRankPoints(),
  };
  localStorage.setItem(GUEST_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

function _restoreGuestSnapshot() {
  let snapshot = null;
  try {
    snapshot = JSON.parse(localStorage.getItem(GUEST_SNAPSHOT_KEY) || 'null');
  } catch {}
  if (!snapshot) return;

  economy.coins = Number(snapshot.coins ?? economy.coins ?? 0);
  economy.unlockedIds = new Set(snapshot.unlockedIds ?? [...economy.unlockedIds]);
  economy.unlockedIds.add('classic');
  economy.activeSkinId = snapshot.activeSkinId ?? economy.activeSkinId ?? 'classic';
  economy._save();

  localStorage.setItem('weaverBest', String(Number(snapshot.bestScore ?? 0)));
  _setRankPoints(Number(snapshot.rankPoints ?? 0));
  localStorage.removeItem(GUEST_SNAPSHOT_KEY);

  updateCoinDisplays();
  _updateStartScreen();
  renderSkinsPage();
  if (game) {
    game.renderer.setSkin(economy.getActiveSkin());
    game._renderTray();
  }
}

// ── Global state ────────────────────────────────────────────────────────────

const economy = new EconomyStore();
const market  = new MarketStore();
let game      = null;
let _currentUser = null;

// ── Animation preference ──────────────────────────────────────────────────────
const ANIM_KEY       = 'weaverAnimations';
const _getAnimEnabled = () => localStorage.getItem(ANIM_KEY) !== 'false';
const _setAnimEnabled = v  => localStorage.setItem(ANIM_KEY, String(v));
const HAND_KEY = 'weaverHandMode';
const _normalizeHandMode = v => (v === 'left' || v === 'right') ? v : 'center';
const _getHandMode = () => _normalizeHandMode(localStorage.getItem(HAND_KEY));
const _setHandMode = v => localStorage.setItem(HAND_KEY, _normalizeHandMode(v));
const FONT_KEY = 'weaverUIFont';
const FONT_CHOICES = {
  // Keep options clearly distinct even when Nunito webfont is unavailable.
  avenir: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  nunito: "'Nunito', Georgia, 'Times New Roman', serif",
  verdana: "'Roboto Mono', 'Courier New', 'Lucida Console', monospace",
};

function _getUiFontChoice() {
  const stored = localStorage.getItem(FONT_KEY) || 'nunito';
  return FONT_CHOICES[stored] ? stored : 'nunito';
}

function _applyUiFont(choice = _getUiFontChoice()) {
  const safe = FONT_CHOICES[choice] ? choice : 'nunito';
  document.documentElement.style.setProperty('--ui-font', FONT_CHOICES[safe]);
  localStorage.setItem(FONT_KEY, safe);
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const startScreen  = _el('start-screen');
const mainApp      = _el('main-app');
const pagePlay     = _el('page-play');
const pageSkins    = _el('page-skins');
const pageMarket   = _el('page-market');
const pageSettings = _el('page-settings');
const overlayEl    = _el('gameover-overlay');
const toastEl      = _el('feedback-toast');
const buyRandomBtn = _el('buy-random-btn');
const skinsGrid    = _el('skins-grid');
const marketGrid   = _el('market-grid');
const powerupHint  = _el('powerup-hint');
const tutorialOverlay = _el('tutorial-overlay');
const tutorialStepEl  = _el('tutorial-step');
const tutorialTextEl  = _el('tutorial-text');
const rotateControls  = _el('rotate-controls');
const rotateLeftBtn   = _el('rotate-left-btn');
const rotateRightBtn  = _el('rotate-right-btn');
const rotateConfirmBtn= _el('rotate-confirm-btn');
const rotateLabelEl   = _el('rotate-controls-label');

// Reveal overlay elements
const _revealOverlay = _el('skin-reveal-overlay');
const _reelCanvas    = _el('skin-reveal-reel');
const _revealCanvas  = _el('skin-reveal-canvas');
const _revealName    = _el('skin-reveal-name');
const _revealTitle   = _el('skin-reveal-title');
const _revealResult  = _el('skin-reveal-result');
const _revealClose   = _el('skin-reveal-close');

function _requestImmersiveMode() {
  const root = document.documentElement;
  if (document.fullscreenElement || !root?.requestFullscreen) return;
  root.requestFullscreen().catch(() => {});
}

// Apply i18n to static labels
function applyTranslations() {
  const set = (id, key) => { const el = _el(id); if (el) el.textContent = t(key); };
  const setHtml = (id, key) => { const el = _el(id); if (el) el.innerHTML = t(key); };
  set('start-btn',          'play');
  set('ss-settings-btn',    'startSettings');
  set('ss-signin-label',    'signIn');
  set('ss-bonus-badge',     'bonusBadge');
  set('restart-btn',        'playAgain');
  set('market-page-title',  'market');
  set('skins-page-title',   'skins');
  set('settings-page-title','settingsTitle');
  set('settings-sound-title', 'soundTitle');
  set('settings-master-label', 'masterVolume');
  set('settings-sfx-label', 'soundEffects');
  set('settings-music-label', 'musicVolume');
  set('settings-gameplay-title', 'gameplayTitle');
  set('settings-ui-title', 'interfaceTitle');
  set('settings-font-label', 'fontLabel');
  set('settings-hand-label', 'handMode');
  set('settings-account-title', 'account');
  set('settings-lang-title','language');
  set('settings-signin-hint', 'signInHint');
  setHtml('settings-bonus-hint', 'bonusHint');
  set('settings-signin-label', 'signIn');
  set('settings-version', 'version');
  set('buy-random-btn', 'buyRandomSkin');
  set('ss-buy-coins-note', 'buyCoinsHint');
  const settingsSignOut = _el('settings-signout-btn');
  if (settingsSignOut) settingsSignOut.textContent = `✕ ${t('signOut')}`;
  const bestLabel = document.querySelector('#start-stats .ss-box:first-child .ss-label');
  if (bestLabel) bestLabel.textContent = t('best');
  const coinsLabel = document.querySelector('#start-stats .ss-box:last-child .ss-label');
  if (coinsLabel) coinsLabel.textContent = t('coins');
  const handSelect = _el('hand-mode-select');
  if (handSelect?.options?.length >= 3) {
    handSelect.options[0].textContent = t('handRight');
    handSelect.options[1].textContent = t('handCenter');
    handSelect.options[2].textContent = t('handLeft');
  }
  const fontSelect = _el('font-select');
  if (fontSelect?.options?.length >= 3) {
    fontSelect.options[0].textContent = t('fontAvenir');
    fontSelect.options[1].textContent = t('fontNunito');
    fontSelect.options[2].textContent = t('fontVerdana');
  }
  const gameOverTitle = document.querySelector('#gameover-box h2');
  if (gameOverTitle) gameOverTitle.textContent = t('gameOver');
  const goLabels = document.querySelectorAll('#gameover-box .go-label');
  if (goLabels[0]) goLabels[0].textContent = t('score');
  if (goLabels[1]) goLabels[1].textContent = t('coinsEarned');
  document.querySelectorAll('.nav-label').forEach(el => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
}
applyTranslations();
initAds(); // Reklam sistemini başlat — native cihazda ilk reklamı arka planda yükler
window.addEventListener('pointerdown', () => { resumeAudio(); }, { once: true });
window.addEventListener('keydown', () => { resumeAudio(); }, { once: true });

function _updateStartScreen() {
  _el('ss-best').textContent  = Number(localStorage.getItem('weaverBest') ?? 0).toLocaleString();
  _el('ss-coins').textContent = economy.coins;
  _updateRankBadges();
}
_updateStartScreen();
_applyUiFont();
prepareBackgroundMusic().catch(() => {});

// ── Navigation ───────────────────────────────────────────────────────────────

const PAGES = { play: pagePlay, skins: pageSkins, market: pageMarket, settings: pageSettings };
const PAGE_ORDER = ['play', 'market', 'skins', 'settings'];
let _currentPage = 'market';

function showPage(name) {
  if (name === _currentPage) {
    const currentEl = PAGES[name];

    if (name === 'skins')    renderSkinsPage();
    if (name === 'market')   renderMarketPage();
    if (name === 'settings') renderSettingsPage();

    if (currentEl?.classList.contains('hidden')) {
      currentEl.classList.remove('hidden');
    }

    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.page === name)
    );
    return;
  }

  const fromEl = PAGES[_currentPage];
  const toEl   = PAGES[name];
  const fromIdx = PAGE_ORDER.indexOf(_currentPage);
  const toIdx   = PAGE_ORDER.indexOf(name);
  const goRight = toIdx > fromIdx;

  // Render content before showing
  if (name === 'skins')    renderSkinsPage();
  if (name === 'market')   renderMarketPage();
  if (name === 'settings') renderSettingsPage();

  Object.entries(PAGES).forEach(([key, el]) => {
    if (key === _currentPage || key === name) return;
    el.classList.add('hidden');
    el.classList.remove('page--enter-right', 'page--enter-left', 'page--exit-left', 'page--exit-right');
  });

  // Settings animasyonunu durdur çıkarken
  if (_currentPage === 'settings' && _settingsBgRaf) {
    cancelAnimationFrame(_settingsBgRaf);
    _settingsBgRaf = null;
  }

  // Animate out the current page
  if (fromEl && !fromEl.classList.contains('hidden')) {
    fromEl.classList.add(goRight ? 'page--exit-left' : 'page--exit-right');
    fromEl.addEventListener('animationend', () => {
      fromEl.classList.add('hidden');
      fromEl.classList.remove('page--exit-left', 'page--exit-right');
    }, { once: true });
  }

  // Animate in the new page
  toEl.classList.remove('hidden');
  toEl.classList.remove('page--enter-right', 'page--enter-left');
  void toEl.offsetWidth; // force reflow
  toEl.classList.add(goRight ? 'page--enter-right' : 'page--enter-left');
  toEl.addEventListener('animationend', () => {
    toEl.classList.remove('page--enter-right', 'page--enter-left');
  }, { once: true });

  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.page === name)
  );
  _currentPage = name;
}

document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.page === 'play') {
      if (!game) game = new Game({ mode: 'endless' });
      else if (game._mode !== 'endless') game.restart({ mode: 'endless' });
    }
    if (btn.dataset.page === 'play') _requestImmersiveMode();
    showPage(btn.dataset.page);
  });
});

// ── Menu button ───────────────────────────────────────────────────────────────

_el('nav-menu-btn').addEventListener('click', () => {
  _setVisible(mainApp, false);
  _setVisible(startScreen, true);
  _updateStartScreen();
});

// ── Start button → show mode selection sheet ────────────────────────────────

function _updateModeSelectUI() {
  const vsBtn = _el('mode-vs-btn');
  const vsTag = _el('mode-vs-tag');
  if (!vsBtn || !vsTag) return;
  const signedIn = !!_currentUser;
  vsBtn.disabled = !signedIn;
  if (signedIn) {
    vsTag.textContent = 'ONLINE';
    vsTag.className = 'mode-card-tag';
  } else {
    vsTag.textContent = 'GİRİŞ YAP';
    vsTag.className = 'mode-card-tag mode-card-tag--locked';
  }
}

_el('start-btn').addEventListener('click', () => {
  _updateModeSelectUI();
  _el('mode-select-overlay').classList.remove('hidden');
});

// Close sheet on backdrop tap
_el('mode-select-backdrop').addEventListener('click', () => {
  _el('mode-select-overlay').classList.add('hidden');
});

// Endless mode
_el('mode-endless-btn').addEventListener('click', () => {
  _el('mode-select-overlay').classList.add('hidden');
  _requestImmersiveMode();
  _setVisible(startScreen, false);
  _setVisible(mainApp, true);
  if (!game) game = new Game({ mode: 'endless' });
  else if (game._mode !== 'endless') game.restart({ mode: 'endless' });
  Object.entries(PAGES).forEach(([key, el]) => el.classList.toggle('hidden', key !== 'play'));
  _currentPage = 'play';
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.page === 'play')
  );
});

// 1v1 VS mode
_el('mode-vs-btn').addEventListener('click', () => {
  _el('mode-select-overlay').classList.add('hidden');
  vsSession.openLobby();
});

// ── VS Session ───────────────────────────────────────────────────────────────

const vsSession = (() => {
  let _matchId   = null;
  let _role      = null;   // 'host' | 'guest'
  let _seed      = null;
  let _rng       = null;
  let _unsubMatch = null;
  let _syncInterval = null;
  let _matchData = null;
  let _oppName   = 'Rakip';
  let _myFinalScore = 0;
  let _countdownStarted = false;
  let _gameLaunched = false;
  let _lastLocalMoveAt = Date.now();
  let _finishRequested = false;
  let _dragBound = false;
  let _dragState = null;
  let _myRankAtMatch = 0;
  let _oppRankAtMatch = 0;
  let _myLiveScore = 0;
  let _oppLiveScore = 0;
  let _rankAppliedForMatch = null;

  const _overlay = () => _el('vs-overlay');
  const _screen  = id => _el(id);

  function _showScreen(id) {
    ['vs-screen-choose','vs-screen-waiting','vs-screen-countdown','vs-screen-result']
      .forEach(s => _el(s).classList.toggle('hidden', s !== id));
  }

  function _setWaitingScreen(mode, inviteCode = '') {
    const labelEl = _el('vs-invite-code-label');
    const codeEl  = _el('vs-invite-code');
    const copyEl  = _el('vs-copy-code-btn');
    const hintEl  = _el('vs-wait-hint');
    const isPrivate = mode === 'private';

    labelEl?.classList.toggle('hidden', !isPrivate);
    codeEl?.classList.toggle('hidden', !isPrivate);
    copyEl?.classList.toggle('hidden', !isPrivate);

    if (isPrivate) {
      if (codeEl) codeEl.textContent = inviteCode || '------';
      if (hintEl) hintEl.textContent = 'Arkadaşın katılınca oyun başlayacak';
    } else {
      if (hintEl) hintEl.textContent = 'Uygun rakip aranıyor. Biri bulununca oyun başlayacak';
    }
  }

  function openLobby() {
    _showScreen('vs-screen-choose');
    _overlay().classList.remove('hidden');
    _el('vs-code-input').value = '';
    _setWaitingScreen('private');
  }

  function _closeLobby() {
    _overlay().classList.add('hidden');
    _stopSync();
  }

  function _stopSync() {
    if (_unsubMatch) { _unsubMatch(); _unsubMatch = null; }
    clearInterval(_syncInterval); _syncInterval = null;
    _countdownStarted = false;
    _gameLaunched = false;
    _finishRequested = false;
    _myLiveScore = 0;
    _oppLiveScore = 0;
  }

  function _setDominanceVisible(visible) {
    _el('vs-dominance')?.classList.toggle('hidden', !visible);
  }

  function _updateDominanceBar() {
    const bar = _el('vs-dominance');
    if (!bar || !game?._vsMode) return;

    const diff = _myLiveScore - _oppLiveScore;
    const abs = Math.abs(diff);
    const gapTarget = _gapTargetByRanks(_matchData?.hostRankPoints, _matchData?.guestRankPoints);
    const ratio = Math.max(0, Math.min(1, abs / Math.max(1, gapTarget)));

    let myWidth = 50;
    if (diff > 0) myWidth = 50 + ratio * 50;
    else if (diff < 0) myWidth = 50 - ratio * 50;
    const oppWidth = 100 - myWidth;

    const myTier = _tierForRankPoints(_myRankAtMatch);
    _el('vs-dom-blue').style.width = `${myWidth.toFixed(2)}%`;
    _el('vs-dom-red').style.width = `${oppWidth.toFixed(2)}%`;
    _el('vs-dom-blue-val').textContent = `SEN ${_myLiveScore.toLocaleString()}`;
    _el('vs-dom-red-val').textContent = `RAKIP ${_oppLiveScore.toLocaleString()}`;

    const leadText = diff === 0
      ? 'DENGEDE'
      : diff > 0
      ? `SEN +${abs.toLocaleString()}`
      : `RAKIP +${abs.toLocaleString()}`;
    _el('vs-dom-center').textContent = `${myTier.label} HEDEF ${gapTarget.toLocaleString()} | ${leadText}`;
  }

  function _getOpponentUid() {
    return _role === 'host' ? _matchData?.guest?.uid : _matchData?.host?.uid;
  }

  function _statePayload({ gameOver = false, loseReason = null } = {}) {
    const board = game ? serializeBoard(game.grid) : '0'.repeat(64);
    return {
      score: game?.scoreSystem?.score ?? _myFinalScore ?? 0,
      gameOver,
      board,
      lastMoveAt: _lastLocalMoveAt,
      updatedAt: Date.now(),
      loseReason,
    };
  }

  function _syncMyState(opts = {}) {
    if (!_matchId || !_role) return;
    updatePlayerState(_matchId, _role, _statePayload(opts)).catch(() => {});
  }

  function _setOpponentPanelDefaults() {
    const panel = _el('vs-opp-panel');
    if (!panel) return;
    panel.style.top = '58px';
    panel.style.right = '8px';
    panel.style.left = '';
    panel.style.bottom = '';
  }

  function _bindOpponentPanelDrag() {
    if (_dragBound) return;
    _dragBound = true;
    const panel = _el('vs-opp-panel');
    const area = _el('game-area');
    if (!panel || !area) return;

    panel.addEventListener('pointerdown', e => {
      const panelRect = panel.getBoundingClientRect();
      _dragState = {
        dx: e.clientX - panelRect.left,
        dy: e.clientY - panelRect.top,
      };
      panel.setPointerCapture?.(e.pointerId);
      panel.classList.add('vs-opp-panel--dragging');
    });

    panel.addEventListener('pointermove', e => {
      if (!_dragState) return;
      e.preventDefault();
      const areaRect = area.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const maxLeft = Math.max(0, areaRect.width - panelRect.width);
      const maxTop = Math.max(0, areaRect.height - panelRect.height);
      const nextLeft = Math.max(0, Math.min(maxLeft, e.clientX - areaRect.left - _dragState.dx));
      const nextTop = Math.max(0, Math.min(maxTop, e.clientY - areaRect.top - _dragState.dy));
      panel.style.left = `${Math.round(nextLeft)}px`;
      panel.style.top = `${Math.round(nextTop)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    const endDrag = e => {
      if (!_dragState) return;
      _dragState = null;
      panel.classList.remove('vs-opp-panel--dragging');
      panel.releasePointerCapture?.(e.pointerId);
    };

    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
  }

  function _isTimedOut(state, now) {
    if (!state || state.gameOver) return false;
    const lastMoveAt = Number(state.lastMoveAt ?? 0);
    if (!lastMoveAt) return false;
    return now - lastMoveAt > VS_MOVE_TIMEOUT_MS;
  }

  function _deriveWinner(data) {
    const hostState = data?.hostState;
    const guestState = data?.guestState;
    if (!hostState || !guestState) return null;

    const hostUid = data?.host?.uid;
    const guestUid = data?.guest?.uid;
    const hostScore = Number(hostState.score ?? 0);
    const guestScore = Number(guestState.score ?? 0);

    const now = Date.now();
    const hostTimedOut = _isTimedOut(hostState, now);
    const guestTimedOut = _isTimedOut(guestState, now);
    if (hostTimedOut && !guestTimedOut) return guestUid;
    if (guestTimedOut && !hostTimedOut) return hostUid;
    if (hostTimedOut && guestTimedOut) return hostScore === guestScore ? 'tie' : (hostScore > guestScore ? hostUid : guestUid);

    if (hostState.gameOver && !guestState.gameOver) return guestUid;
    if (guestState.gameOver && !hostState.gameOver) return hostUid;

    const gap = Math.abs(hostScore - guestScore);
    const gapToWin = _gapTargetByRanks(data?.hostRankPoints, data?.guestRankPoints);
    if (gap >= gapToWin) return hostScore > guestScore ? hostUid : guestUid;

    if (hostState.gameOver && guestState.gameOver) {
      if (hostScore === guestScore) return 'tie';
      return hostScore > guestScore ? hostUid : guestUid;
    }
    return null;
  }

  function _maybeFinishByRules(data) {
    if (!data || data.status !== 'active' || _finishRequested || data.winner) return;
    const winner = _deriveWinner(data);
    if (!winner || !_matchId) return;
    _finishRequested = true;
    finishMatch(_matchId, winner).catch(() => {
      _finishRequested = false;
    });
  }

  function _showLocalLoseImmediate(myScore) {
    const liveOppScore = Number(_el('vs-opp-panel-score')?.textContent?.replace(/[^\d]/g, '') || 0);
    _el('vs-result-icon').textContent  = '😢';
    _el('vs-result-title').textContent = 'KAYBETTİN!';
    _el('vs-my-final-score').textContent  = Number(myScore ?? 0).toLocaleString();
    _el('vs-opp-final-score').textContent = liveOppScore.toLocaleString();
    _overlay().classList.remove('hidden');
    _showScreen('vs-screen-result');
  }

  // ── Countdown then launch ──────────────────────────────────────────────────

  function _startCountdown(matchData) {
    if (_countdownStarted) return;
    _countdownStarted = true;
    _matchData = matchData;
    const isHost = _role === 'host';
    const me     = matchData.host;
    const opp    = matchData.guest;
    _oppName = (isHost ? opp?.name : me?.name) || 'Rakip';

    _el('vs-my-name').textContent  = _currentUser.displayName || 'Sen';
    _el('vs-opp-name').textContent = _oppName;
    _showScreen('vs-screen-countdown');
    _lastLocalMoveAt = Date.now();
    _myRankAtMatch = Number(_role === 'host' ? matchData?.hostRankPoints : matchData?.guestRankPoints) || _getRankPoints(_currentUser?.uid);
    _oppRankAtMatch = Number(_role === 'host' ? matchData?.guestRankPoints : matchData?.hostRankPoints) || 0;

    let n = 3;
    const _tick = () => {
      const el = _el('vs-countdown-num');
      el.textContent = n > 0 ? String(n) : 'GO!';
      // Re-trigger animation by clone trick
      const clone = el.cloneNode(true);
      el.parentNode.replaceChild(clone, el);
      if (n > 0) { n--; setTimeout(_tick, 900); }
      else setTimeout(_launchVsGame, 700);
    };
    _tick();
  }

  // ── Launch VS game ─────────────────────────────────────────────────────────

  function _launchVsGame() {
    if (_gameLaunched) return;
    _gameLaunched = true;
    _overlay().classList.add('hidden');
    _requestImmersiveMode();
    _setVisible(startScreen, false);
    _setVisible(mainApp, true);

    _rng = new SeededRng(_seed);

    if (!game) game = new Game({ mode: 'vs' });
    else game.restart({ mode: 'vs' });

    // Enable VS mode on the game
    game._vsMode = true;
    game._vsRole = _role;
    game._vsRng  = _rng;

    // Show opponent panel
    const oppPanel = _el('vs-opp-panel');
    _el('vs-opp-panel-name').textContent  = _oppName;
    _el('vs-opp-panel-score').textContent = '0';
    _el('vs-opp-gameover').classList.add('hidden');
    _setOpponentPanelDefaults();
    _bindOpponentPanelDrag();
    oppPanel.classList.remove('hidden');

    // Draw empty mini board
    const oc = _el('vs-opp-canvas');
    drawMiniBoard(oc.getContext('2d'), '0'.repeat(64), oc.width, oc.height);
    _myLiveScore = 0;
    _oppLiveScore = 0;
    _el('vs-rank-result').textContent = '';
    _setDominanceVisible(true);
    _updateDominanceBar();

    showPage('play');

    // Mark match as active so both players know it started
    if (_matchId) {
      getFirebaseServices().then(s =>
        s.updateDoc(s.doc(s.db, 'matches', _matchId), { status: 'active' })
      ).catch(() => {});
    }

    _lastLocalMoveAt = Date.now();
    _syncMyState({ gameOver: false, loseReason: null });

    // Start syncing my state rapidly for near realtime opponent tracking
    _syncInterval = setInterval(() => {
      if (!game || !_matchId) return;
      if (!game._isGameOver && (Date.now() - _lastLocalMoveAt) > VS_MOVE_TIMEOUT_MS) {
        game._gameOver();
        return;
      }
      _syncMyState({ gameOver: game._isGameOver ?? false });
    }, VS_STATE_SYNC_MS);
  }

  // ── Handle incoming match snapshot ────────────────────────────────────────

  function _onMatchSnapshot(data) {
    _matchData = data;
    if (_role) {
      _myRankAtMatch = Number(_role === 'host' ? data?.hostRankPoints : data?.guestRankPoints) || _myRankAtMatch || _getRankPoints(_currentUser?.uid);
      _oppRankAtMatch = Number(_role === 'host' ? data?.guestRankPoints : data?.hostRankPoints) || _oppRankAtMatch || 0;
    }

    if (data.status === 'countdown') {
      _startCountdown(data);
    }

    if (data.status === 'active' && !_gameLaunched) {
      _launchVsGame();
    }

    if (data.status === 'cancelled') {
      _stopSync();
      _overlay().classList.add('hidden');
      showToast('Rakip bağlantıyı kesti.');
      _exitToMenu();
      return;
    }

    // Update opponent panel during game
    if (data.status === 'active' || data.status === 'countdown') {
      const oppState = _role === 'host' ? data.guestState : data.hostState;
      if (oppState) {
        _oppLiveScore = Number(oppState.score ?? 0);
        _el('vs-opp-panel-score').textContent = _oppLiveScore.toLocaleString();
        const oc = _el('vs-opp-canvas');
        if (oc && oppState.board) drawMiniBoard(oc.getContext('2d'), oppState.board, oc.width, oc.height);
        if (oppState.gameOver) _el('vs-opp-gameover').classList.remove('hidden');
      }
      _myLiveScore = Number(game?.scoreSystem?.score ?? _myLiveScore ?? 0);
      _updateDominanceBar();
    }

    _maybeFinishByRules(data);

    // Both game-over → show result
    if (data.status === 'finished') {
      _stopSync();
      _showResult(data);
    }
  }

  // ── Report local game over ─────────────────────────────────────────────────

  function reportGameOver(myScore) {
    _myFinalScore = myScore;
    if (!_matchId) return;
    _syncMyState({ gameOver: true, loseReason: 'no_moves' });

    // No-move defeat is immediate for the local player.
    _showLocalLoseImmediate(myScore);

    const opponentUid = _getOpponentUid();
    if (!opponentUid) return;
    _finishRequested = true;
    finishMatch(_matchId, opponentUid).catch(() => {
      _finishRequested = false;
    });
  }

  // ── Show result screen ─────────────────────────────────────────────────────

  function _showResult(data) {
    _el('vs-opp-panel').classList.add('hidden');
    _setDominanceVisible(false);
    const myUid  = _currentUser?.uid;
    const isWin  = data.winner === myUid;
    const isTie  = data.winner === 'tie';

    _el('vs-result-icon').textContent  = isTie ? '🤝' : isWin ? '🏆' : '😢';
    _el('vs-result-title').textContent = isTie ? 'BERABERLIK' : isWin ? 'KAZANDIN!' : 'KAYBETTİN!';

    const myState  = _role === 'host' ? data.hostState  : data.guestState;
    const oppState = _role === 'host' ? data.guestState : data.hostState;
    _el('vs-my-final-score').textContent  = (myState?.score  ?? 0).toLocaleString();
    _el('vs-opp-final-score').textContent = (oppState?.score ?? 0).toLocaleString();

    if (_rankAppliedForMatch !== _matchId) {
      _rankAppliedForMatch = _matchId;
      const myRank = _getRankPoints(_currentUser?.uid);
      const delta = _rankDeltaForResult(myRank, _oppRankAtMatch, isWin, isTie);
      const next = _setRankPoints(myRank + delta, _currentUser?.uid);
      _updateRankBadges(_currentUser?.uid);
      const tier = _tierForRankPoints(next);
      const sign = delta > 0 ? '+' : '';
      _el('vs-rank-result').textContent = `RANK: ${myRank} ${sign}${delta} = ${next} (${tier.label})`;
      if (_currentUser) saveCloudSave(_currentUser.uid, _cloudSavePayload()).catch(() => {});
    } else {
      const current = _getRankPoints(_currentUser?.uid);
      _updateRankBadges(_currentUser?.uid);
      const tier = _tierForRankPoints(current);
      _el('vs-rank-result').textContent = `RANK: ${current} (${tier.label})`;
    }

    _overlay().classList.remove('hidden');
    _showScreen('vs-screen-result');
  }

  function _exitToMenu() {
    _el('vs-opp-panel').classList.add('hidden');
    _setDominanceVisible(false);
    _setVisible(mainApp, false);
    _setVisible(startScreen, true);
    _updateStartScreen();
    if (game) { game._vsMode = false; game._isGameOver = false; }
  }

  // ── Listeners ──────────────────────────────────────────────────────────────

  // Back button on choose screen
  _el('vs-back-btn').addEventListener('click', () => _closeLobby());

  // Quick match
  _el('vs-quick-btn').addEventListener('click', async () => {
    if (!_currentUser) return;
    _el('vs-quick-btn').disabled = true;
    try {
      _countdownStarted = false;
      _gameLaunched = false;
      const result = await quickMatch(_currentUser, _getRankPoints(_currentUser.uid));
      _matchId = result.matchId;
      _seed    = result.seed;
      _role    = result.role;

      _unsubMatch = subscribeMatch(_matchId, _onMatchSnapshot);

      if (_role === 'guest') {
        _showScreen('vs-screen-countdown');
        _el('vs-countdown-num').textContent = '...';
      } else {
        _setWaitingScreen('public');
        _showScreen('vs-screen-waiting');
      }
    } catch (err) {
      showToast('Hata: ' + (err.message || String(err)));
    } finally {
      _el('vs-quick-btn').disabled = false;
    }
  });

  // Create match (invite code)
  _el('vs-create-btn').addEventListener('click', async () => {
    if (!_currentUser) return;
    _el('vs-create-btn').disabled = true;
    try {
      _countdownStarted = false;
      _gameLaunched = false;
      const result = await createMatch(_currentUser, {
        rankPoints: _getRankPoints(_currentUser.uid),
      });
      _matchId = result.matchId;
      _seed    = result.seed;
      _role    = 'host';

      _setWaitingScreen('private', result.inviteCode);
      _showScreen('vs-screen-waiting');

      _unsubMatch = subscribeMatch(_matchId, _onMatchSnapshot);
    } catch (err) {
      showToast('Hata: ' + (err.message || String(err)));
    } finally {
      _el('vs-create-btn').disabled = false;
    }
  });

  // Cancel waiting
  _el('vs-cancel-wait-btn').addEventListener('click', async () => {
    if (_matchId) await cancelMatch(_matchId).catch(() => {});
    _stopSync();
    _matchId = null;
    _showScreen('vs-screen-choose');
  });

  // Copy invite code
  _el('vs-copy-code-btn').addEventListener('click', () => {
    const code = _el('vs-invite-code').textContent;
    navigator.clipboard?.writeText(code).catch(() => {});
    showToast('Kod kopyalandı!');
  });

  // Join by code
  _el('vs-join-btn').addEventListener('click', async () => {
    const code = _el('vs-code-input').value.trim().toUpperCase();
    if (code.length < 6) { showToast('6 karakterli kod gir.'); return; }
    if (!_currentUser) return;
    _el('vs-join-btn').disabled = true;
    try {
      _countdownStarted = false;
      _gameLaunched = false;
      const result = await joinMatchByCode(code, _currentUser, _getRankPoints(_currentUser.uid));
      _matchId = result.matchId;
      _seed    = result.seed;
      _role    = 'guest';
      _unsubMatch = subscribeMatch(_matchId, _onMatchSnapshot);
      _showScreen('vs-screen-countdown');
      _el('vs-countdown-num').textContent = '...';
    } catch (err) {
      showToast('Hata: ' + (err.message || String(err)));
    } finally {
      _el('vs-join-btn').disabled = false;
    }
  });

  // Rematch
  _el('vs-rematch-btn').addEventListener('click', () => {
    _overlay().classList.add('hidden');
    _stopSync();
    _matchId = null;
    openLobby();
  });

  // Exit to main menu
  _el('vs-exit-btn').addEventListener('click', () => {
    _closeLobby();
    _exitToMenu();
  });

  function markLocalMove() {
    _lastLocalMoveAt = Date.now();
    _syncMyState({ gameOver: false, loseReason: null });
  }

  function updateMyLiveScore(score) {
    _myLiveScore = Number(score ?? 0);
    _updateDominanceBar();
  }

  return { openLobby, reportGameOver, markLocalMove, updateMyLiveScore };
})();

// ── Settings button ───────────────────────────────────────────────────────────

_el('ss-settings-btn').addEventListener('click', () => {
  showPage('settings');
  _setVisible(startScreen, false);
  _setVisible(mainApp, true);
});

// ── Restart ───────────────────────────────────────────────────────────────────

_el('restart-btn').addEventListener('click', () => {
  _requestImmersiveMode();
  overlayEl.classList.add('hidden');
  game.restart();
  showPage('play');
});

// ── Watch Ad (simulated) ──────────────────────────────────────────────────────

const AD_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes between ads
let _lastAdTime = -Infinity;
let _adCooldownInterval = null;

function _updateAdBtn() {
  const btn    = _el('ss-watch-ad-btn');
  const reward = btn?.querySelector('.earn-reward');
  if (!btn || !reward) return;
  const remaining = Math.ceil((AD_COOLDOWN_MS - (Date.now() - _lastAdTime)) / 1000);
  if (remaining > 0) {
    btn.disabled = true;
    const m = Math.floor(remaining / 60), s = remaining % 60;
    reward.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  } else {
    btn.disabled = false;
    reward.textContent = '+50 \uD83E\uDE99';
    clearInterval(_adCooldownInterval);
    _adCooldownInterval = null;
  }
}

_el('ss-watch-ad-btn')?.addEventListener('click', async () => {
  const btn = _el('ss-watch-ad-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('watching');

  const earned = await showRewardedAd();

  btn.classList.remove('watching');
  if (earned) {
    _lastAdTime = Date.now();
    economy.addCoins(50);
    updateCoinDisplays();
    _updateStartScreen();
    showToast('+50 \uD83E\uDE99 Reklam \u00f6d\u00fcl\u00fc!');
    _adCooldownInterval = setInterval(_updateAdBtn, 1000);
    _updateAdBtn();
  } else {
    btn.disabled = false; // reklam yoksa/iptal edildiyse tekrar aç
  }
});

// ── Buy Coins button → open market page ──────────────────────────────────────

_el('ss-buy-coins-btn')?.addEventListener('click', () => {
  showPage('market');
  _setVisible(startScreen, false);
  _setVisible(mainApp, true);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

// Strip size suffix from Google photo URLs and force =s96-c for consistent rendering
function _avatarUrl(url) {
  return url ? url.replace(/=s\d+(-c)?$/, '=s96-c') : '';
}

/** Sync all UI elements that reflect sign-in state. */
function _applyAuthUI(user) {
  _currentUser = user;
  const signedIn = !!user;

  // Start screen
  _setVisible(_el('ss-profile'),    signedIn);
  _setVisible(_el('ss-signin-btn'), !signedIn);
  if (signedIn) {
    _el('ss-avatar').src              = _avatarUrl(user.photoURL);
    _el('ss-username').textContent    = user.displayName || user.email;
  }
  _updateRankBadges(user?.uid);

  // Mode select sheet VS button state
  _updateModeSelectUI();

  // Settings panel
  const out = _el('settings-signed-out');
  const ind = _el('settings-signed-in');
  if (!out || !ind) return;
  _setVisible(out, !signedIn);
  _setVisible(ind,  signedIn);
  if (signedIn) {
    _el('settings-avatar').src              = _avatarUrl(user.photoURL);
    _el('settings-username').textContent    = user.displayName || '';
    _el('settings-email').textContent       = user.email || '';
  }
}

async function _handleSignIn() {
  if (!navigator.onLine) { showToast(t('noInternet')); return; }
  const btn      = _el('ss-signin-btn');
  const label    = _el('ss-signin-label');
  const origText = label?.textContent;
  try {
    if (btn)   btn.disabled    = true;
    if (label) label.textContent = '...';
    await googleSignIn();
  } catch (err) {
    const msg = err?.message ?? err?.code ?? String(err) ?? 'unknown';
    showToast('HATA:\n' + msg.substring(0, 200), { error: true });
  } finally {
    if (btn)   btn.disabled    = false;
    if (label) label.textContent = origText;
  }
}

async function _handleSignOut(e) {
  e?.preventDefault();
  e?.stopPropagation();
  const startBtn = _el('ss-signout-btn');
  const settingsBtn = _el('settings-signout-btn');
  try {
    if (startBtn) startBtn.disabled = true;
    if (settingsBtn) settingsBtn.disabled = true;
    await googleSignOut();
  } catch (err) {
    _applyAuthUI(null);
  } finally {
    if (startBtn) startBtn.disabled = false;
    if (settingsBtn) settingsBtn.disabled = false;
  }
}

_el('ss-signin-btn').addEventListener('click', _handleSignIn);
_el('ss-signout-btn').addEventListener('click', _handleSignOut);

// Auth state listener
let _lastAuthUid = null;
onAuthChange(async user => {
  const prevUid = _lastAuthUid;
  _lastAuthUid = user?.uid ?? null;
  _applyAuthUI(user);

  if (user && !prevUid) _captureGuestSnapshot();
  if (!user && prevUid) {
    _restoreGuestSnapshot();
    return;
  }

  if (user) {
    // Load cloud save and apply account state for signed-in user.
    try {
      const cloud = await loadCloudSave(user.uid);
      if (cloud) {
        if (typeof cloud.coins === 'number') economy.coins = Math.max(0, cloud.coins);
        if (Array.isArray(cloud.unlockedIds)) economy.unlockedIds = new Set(cloud.unlockedIds);
        economy.unlockedIds.add('classic');
        if (cloud.activeSkinId && economy.unlockedIds.has(cloud.activeSkinId)) {
          economy.activeSkinId = cloud.activeSkinId;
        }
        economy._save();
        if (typeof cloud.bestScore === 'number') localStorage.setItem('weaverBest', String(cloud.bestScore));
        if (typeof cloud.rankPoints === 'number') {
          _setRankPoints(cloud.rankPoints, user.uid);
          _updateRankBadges(user.uid);
        }
        if (game) {
          game.renderer.setSkin(economy.getActiveSkin());
          game._renderTray();
        }
        updateCoinDisplays();
      }
      // One-time welcome bonus — local flag prevents re-application on every sign-in
      const bonusKey = `weaverBonus_${user.uid}`;
      if (!localStorage.getItem(bonusKey)) {
        const bonus = await applyBonusIfNeeded(user.uid, user.email);
        if (bonus > 0) {
          localStorage.setItem(bonusKey, '1');
          economy.addCoins(bonus);
          updateCoinDisplays();
          showToast(t('welcome'));
        } else {
          // Firestore confirms bonus already given — cache locally
          localStorage.setItem(bonusKey, '1');
        }
      }
      // Save current state to cloud
      saveCloudSave(user.uid, _cloudSavePayload()).catch(() => {});
    } catch (e) {
      // cloud sync error — silent in production
    }
  }
});

// ── Cloud save payload ────────────────────────────────────────────────────────

function _cloudSavePayload() {
  return {
    coins:        economy.coins,
    unlockedIds:  [...economy.unlockedIds],
    activeSkinId: economy.activeSkinId,
    bestScore:    Number(localStorage.getItem('weaverBest') ?? 0),
    rankPoints:   _getRankPoints(_currentUser?.uid),
  };
}

// ── Settings page ─────────────────────────────────────────────────────────────

function renderSettingsPage() {
  const bindVolumeSlider = (sliderId, labelId, getter, setter) => {
    const slider = _el(sliderId);
    const label = _el(labelId);
    if (!slider || !label) return;
    const value = Math.round(getter() * 100);
    slider.value = value;
    label.textContent = `${value}%`;
    slider.oninput = () => {
      const pct = Number(slider.value);
      label.textContent = `${pct}%`;
      setter(pct / 100);
    };
  };

  bindVolumeSlider('master-volume-slider', 'master-volume-val', getMasterVolume, setMasterVolume);
  bindVolumeSlider('sfx-volume-slider', 'sfx-volume-val', getSfxVolume, setSfxVolume);
  bindVolumeSlider('music-volume-slider', 'music-volume-val', getMusicVolume, setMusicVolume);

  // Language grid
  const langGrid = _el('settings-lang-grid');
  if (langGrid) {
    langGrid.innerHTML = '';
    for (const lang of AVAILABLE_LANGS) {
      const btn = document.createElement('button');
      btn.className = 'lang-btn' + (getLang() === lang.code ? ' lang-btn--active' : '');
      btn.textContent = lang.label;
      btn.addEventListener('click', () => {
        setLang(lang.code);
        applyTranslations();
        renderSettingsPage();
      });
      langGrid.appendChild(btn);
    }
  }

  // Settings sign-in/sign-out buttons
  const siBtn = _el('settings-signin-btn');
  const soBtn = _el('settings-signout-btn');
  if (siBtn) siBtn.onclick = _handleSignIn;
  if (soBtn) soBtn.onclick = _handleSignOut;

  // Animation toggle
  const animToggle = _el('anim-toggle');
  if (animToggle) {
    animToggle.checked  = _getAnimEnabled();
    animToggle.onchange = () => _setAnimEnabled(animToggle.checked);
  }

  const handSelect = _el('hand-mode-select');
  if (handSelect) {
    handSelect.value = _getHandMode();
    handSelect.onchange = () => {
      _setHandMode(handSelect.value);
      if (game?.renderer) game.renderer.setHandedness(_getHandMode());
    };
  }

  const fontSelect = _el('font-select');
  if (fontSelect) {
    fontSelect.value = _getUiFontChoice();
    fontSelect.onchange = () => {
      _applyUiFont(fontSelect.value);
    };
  }

  _applyAuthUI(_currentUser);
  _startSettingsBgAnimation();
}

// ── Settings background floating-blocks animation ─────────────────────────────
let _settingsBgRaf = null;

function _startSettingsBgAnimation() {
  const canvas = _el('settings-bg-canvas');
  if (!canvas) return;
  if (_settingsBgRaf) return; // already running

  const W = canvas.offsetWidth  || 360;
  const H = canvas.offsetHeight || 700;
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const COLORS = ['#a78bfa','#60a5fa','#34d399','#f59e0b','#f472b6','#818cf8'];
  const SHAPES = [
    [[0,0],[0,1],[1,0],[1,1]],           // 2x2
    [[0,0],[0,1],[0,2]],                  // I-3
    [[0,0],[1,0],[1,1],[2,1]],            // S
    [[0,1],[1,0],[1,1],[2,0]],            // Z
    [[0,0],[1,0],[2,0],[2,1]],            // L
    [[0,0],[0,1],[1,1],[2,1]],            // J
    [[0,0],[1,0],[1,1],[1,2]],            // T-ish
  ];
  const CS = 16, GAP = 2;
  const count = 14;
  const pieces = Array.from({ length: count }, () => {
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const rows  = Math.max(...shape.map(c => c[0])) + 1;
    const cols  = Math.max(...shape.map(c => c[1])) + 1;
    return {
      shape, color,
      x: Math.random() * (W - cols * (CS + GAP)),
      y: Math.random() * H,
      vy: 0.3 + Math.random() * 0.5,
      vx: (Math.random() - 0.5) * 0.3,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.008,
      rows, cols,
      alpha: 0.5 + Math.random() * 0.5,
    };
  });

  const tick = () => {
    if (!_el('settings-bg-canvas')) { _settingsBgRaf = null; return; }
    ctx.clearRect(0, 0, W, H);
    for (const p of pieces) {
      p.x   += p.vx;
      p.y   += p.vy;
      p.rot += p.vrot;
      if (p.y > H + 60)  p.y = -60;
      if (p.x < -60)     p.x = W + 20;
      if (p.x > W + 60)  p.x = -20;

      ctx.save();
      ctx.globalAlpha = p.alpha;
      const cx = p.x + p.cols * (CS + GAP) / 2;
      const cy = p.y + p.rows * (CS + GAP) / 2;
      ctx.translate(cx, cy);
      ctx.rotate(p.rot);
      ctx.translate(-cx, -cy);
      ctx.fillStyle = p.color;
      for (const [dr, dc] of p.shape) {
        const rx = p.x + dc * (CS + GAP);
        const ry = p.y + dr * (CS + GAP);
        ctx.beginPath();
        ctx.roundRect(rx, ry, CS, CS, 3);
        ctx.fill();
      }
      ctx.restore();
    }
    _settingsBgRaf = requestAnimationFrame(tick);
  };
  tick();
}

// ── Skin reveal slot-machine animation ───────────────────────────────────────

const REVEAL_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#fb923c'];

function _animateBuyReveal(wonSkin) {
  return new Promise(resolve => {
    _setVisible(_revealOverlay, true);
    _revealResult.classList.add('hidden');
    _revealTitle.textContent = '🎰 Çark Dönüyor...';

    const ctx = _reelCanvas.getContext('2d');
    const W   = _reelCanvas.width;   // 260
    const H   = _reelCanvas.height;  // 90
    const sz  = H - 14;              // cell size ≈ 76

    // Spin schedule: fast → medium → slow → stop
    const FAST_STEPS = 18;   // 60ms each  → 1080ms
    const MID_STEPS  = 8;    // 120ms each → 960ms
    const SLOW_STEPS = 6;    // 155…330ms  → ~1350ms

    const TOTAL = FAST_STEPS + MID_STEPS + SLOW_STEPS;

    // Pre-build spin sequence; guarantee it ends on wonSkin
    const seq = [];
    for (let i = 0; i < TOTAL - 1; i++)
      seq.push(SKINS[Math.floor(Math.random() * SKINS.length)]);
    seq.push(wonSkin);

    let step = 0;

    function drawStep(i) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0d0d1e';
      ctx.fillRect(0, 0, W, H);

      // Draw 3 cells: left (dim), center (bright), right (dim)
      for (let off = -1; off <= 1; off++) {
        const si   = Math.max(0, Math.min(seq.length - 1, i + off));
        const skin = seq[si];
        const cx   = W / 2 + off * (sz + 10) - sz / 2;
        const cy   = (H - sz) / 2;
        ctx.globalAlpha = off === 0 ? 1 : 0.3;
        skin.drawCell(ctx, cx, cy, sz, REVEAL_COLORS[si % REVEAL_COLORS.length], 10);
      }
      ctx.globalAlpha = 1;

      // Highlight box around center cell
      const cx = W / 2 - sz / 2;
      const cy = (H - sz) / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(200,160,255,0.8)';
      ctx.lineWidth   = 2.5;
      ctx.shadowColor = '#a78bfa';
      ctx.shadowBlur  = 10;
      ctx.strokeRect(cx - 2, cy - 2, sz + 4, sz + 4);
      ctx.restore();
    }

    function nextStep() {
      drawStep(step);
      step++;

      if (step > TOTAL) {
        // Spinning done — show the result panel
        setTimeout(() => {
          _revealTitle.textContent = '🎉 Yeni Skin!';
          _revealResult.classList.remove('hidden');
          const rc = _revealCanvas.getContext('2d');
          rc.fillStyle = '#13132a';
          rc.fillRect(0, 0, 90, 90);
          wonSkin.drawCell(rc, 4, 4, 82, '#a78bfa', 12);
          _revealName.textContent = wonSkin.name;
        }, 150);
        return;
      }

      let delay;
      if (step <= FAST_STEPS) {
        delay = 60;
      } else if (step <= FAST_STEPS + MID_STEPS) {
        delay = 120;
      } else {
        const p = step - FAST_STEPS - MID_STEPS; // 1..SLOW_STEPS
        delay = 120 + p * 35;                     // 155, 190, 225, 260, 295, 330
      }
      setTimeout(nextStep, delay);
    }

    nextStep();

    _revealClose.onclick = () => {
      _setVisible(_revealOverlay, false);
      resolve();
    };
  });
}

buyRandomBtn.addEventListener('click', async () => {
  const result = economy.buyRandom();
  if (result.type === 'noCoins')       showToast(t('needCoins'));
  else if (result.type === 'allOwned') showToast(t('allOwned'));
  else {
    updateCoinDisplays();
    if (_getAnimEnabled()) {
      await _animateBuyReveal(result.skin);
    } else {
      showToast(`${t('got')} ${result.skin.name}!`);
    }
    renderSkinsPage();
    if (game) { game.renderer.setSkin(result.skin); game._renderTray(); }
  }
});

// ── Skins page ───────────────────────────────────────────────────────────────

const PREVIEW_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#f59e0b'];

function _makeSkinPreview(skin) {
  const cvs = document.createElement('canvas');
  cvs.width = 84; cvs.height = 84;
  cvs.className = 'skin-preview-canvas';
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#13132a'; ctx.fillRect(0, 0, 84, 84);
  const cs = 30, gap = 4;
  const ox = Math.round((84 - 2 * cs - gap) / 2); // = 10, centered
  const oy = Math.round((84 - 2 * cs - gap) / 2);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++)
      skin.drawCell(ctx, ox + c * (cs + gap), oy + r * (cs + gap), cs, PREVIEW_COLORS[r * 2 + c], 4);
  return cvs;
}

function _makeSkinCard(skin) {
  const owned    = economy.unlockedIds.has(skin.id);
  const isActive = economy.activeSkinId === skin.id;

  const card = document.createElement('div');
  const cardClass = isActive ? 'skin-card active-card' : owned ? 'skin-card owned-card' : 'skin-card locked';
  card.className = cardClass;

  const badge = document.createElement('span');
  badge.className = 'skin-badge ' + (isActive ? 'activeb' : owned ? 'owned' : 'price');
  badge.textContent = isActive ? 'ACTIVE' : owned ? 'OWNED' : `${skin.price}\uD83E\uDE99`;

  const name = document.createElement('span');
  name.className = 'skin-name'; name.textContent = skin.name;
  const desc = document.createElement('span');
  desc.className = 'skin-desc'; desc.textContent = skin.desc;

  card.append(_makeSkinPreview(skin), badge, name, desc);

  if (owned && !isActive) {
    card.addEventListener('click', () => {
      economy.setActive(skin.id);
      if (game) {
        game.renderer.setSkin(skin);
        game._renderTray();
        if (isGameOver(game.tray.filter(Boolean), game.grid))
          setTimeout(() => game._gameOver(), 400);
      }
      renderSkinsPage();
    });
  }
  return card;
}

function renderSkinsPage() {
  _el('skins-coin-display').textContent = economy.coins;
  const locked = SKINS.filter(s => s.price > 0 && !economy.unlockedIds.has(s.id));
  buyRandomBtn.disabled = locked.length === 0 || economy.coins < 100;
  skinsGrid.innerHTML = '';
  SKINS.forEach(skin => skinsGrid.appendChild(_makeSkinCard(skin)));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function updateCoinDisplays() {
  const c = economy.coins;
  ['coin-display', 'skins-coin-display', 'market-coin-display'].forEach(id => {
    const el = _el(id); if (el) el.textContent = c;
  });
}

let _toastTimer = null;
const _isDebugToastMode = () => {
  try {
    if (new URLSearchParams(window.location.search).get('debugToasts') === '1') return true;
  } catch {}
  return localStorage.getItem('weaverDebugToasts') === 'true';
};

function showToast(msg, { error = false } = {}) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('toast--error', error);
  toastEl.classList.toggle('toast--debug-error', error && _isDebugToastMode());
  toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    toastEl.classList.remove('toast--error');
    toastEl.classList.remove('toast--debug-error');
  }, error ? 4000 : 1500);
}

function showGainFloat({ scoreDelta = 0, coins = 0 }) {
  if (!scoreDelta && !coins) return;
  const layer = _el('float-layer');
  if (!layer) return;

  const el = document.createElement('div');
  el.className = 'reward-gain-float';

  const scorePart = document.createElement('span');
  scorePart.className = 'reward-score';
  scorePart.textContent = `+${Math.round(scoreDelta).toLocaleString()}`;
  el.appendChild(scorePart);

  if (coins > 0) {
    const coinPart = document.createElement('span');
    coinPart.className = 'reward-coins';
    coinPart.textContent = `+${coins} 🪙`;
    el.appendChild(coinPart);
  }

  el.style.left = '50%';
  el.style.top = '52%';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1250);
}

// ── Market page ───────────────────────────────────────────────────────────────

function _makeMarketItem(pu) {
  const item = document.createElement('div');
  item.className = 'market-item';

  const icon = document.createElement('div');
  icon.className = 'market-item-icon'; icon.textContent = pu.icon;

  const info = document.createElement('div');
  info.className = 'market-item-info';
  info.innerHTML = `<div class="market-item-name">${pu.name}</div><div class="market-item-desc">${pu.desc}</div>`;

  const cnt = document.createElement('span');
  cnt.className = 'market-count';
  cnt.textContent = `x${market.count(pu.id)}`;

  const buyBtn = document.createElement('button');
  buyBtn.className = 'market-buy-btn';
  buyBtn.textContent = `${pu.price} 🪙`;
  buyBtn.disabled = economy.coins < pu.price;
  buyBtn.addEventListener('click', () => {
    const r = market.buy(pu.id, economy);
    if (r.type === 'noCoins') { showToast(t('needMoreCoins')); return; }
    updateCoinDisplays();
    renderMarketPage();
    showToast(`${t('got')} ${pu.name}!`);
  });

  const useBtn = document.createElement('button');
  useBtn.className = 'market-use-btn';
  useBtn.textContent = 'USE';
  useBtn.disabled = market.count(pu.id) === 0 || !game;
  useBtn.addEventListener('click', () => {
    if (!game) { showToast(t('noGame')); return; }
    game.activatePowerup(pu.id);
    showPage('play');
  });

  const actions = document.createElement('div');
  actions.className = 'market-item-actions';
  actions.append(cnt, buyBtn, useBtn);
  item.append(icon, info, actions);
  return item;
}

function renderMarketPage() {
  _el('market-coin-display').textContent = economy.coins;
  marketGrid.innerHTML = '';
  POWERUPS.forEach(pu => marketGrid.appendChild(_makeMarketItem(pu)));
  _renderCoinPacks();
}

// ── Coin packs ────────────────────────────────────────────────────────────────

const COIN_PACKS = [
  { id: 'pack_sm',  coins: 200,  price: '₺9,99',  icon: '🪙',  label: '200 Altın' },
  { id: 'pack_md',  coins: 600,  price: '₺24,99', icon: '💰',  label: '600 Altın', best: true },
  { id: 'pack_lg',  coins: 1500, price: '₺49,99', icon: '💎',  label: '1500 Altın' },
];

function _makeCoinPack(pack) {
  const el = document.createElement('div');
  el.className = 'coin-pack' + (pack.best ? ' best-value' : '');
  el.innerHTML = `
    <span class="coin-pack-icon">${pack.icon}</span>
    <span class="coin-pack-coins">${pack.label}</span>
    <span class="coin-pack-price">${pack.price}</span>
    ${pack.best ? '<span class="coin-pack-badge">EN İYİ</span>' : ''}
  `;
  el.addEventListener('click', () => {
    // Simulate IAP — award coins instantly (placeholder until payment SDK integrated)
    economy.addCoins(pack.coins);
    updateCoinDisplays();
    _updateStartScreen();
    renderMarketPage();
    showToast(`+${pack.coins} 🪙 Teşekkürler!`);
  });
  return el;
}

function _renderCoinPacks() {
  const grid = _el('coin-packs-grid');
  if (!grid) return;
  grid.innerHTML = '';
  COIN_PACKS.forEach(pack => grid.appendChild(_makeCoinPack(pack)));
}

function _colorCapForScore(score) {
  for (const step of COLOR_STEPS)
    if (score <= step.maxScore) return step.colors;
  return 8;
}

function _luckyChanceForScore(score) {
  if (score < 1500) return 0.09;
  if (score < 4500) return 0.14;
  if (score < 9000) return 0.19;
  if (score < 15000) return 0.24;
  return 0.28;
}

function _fitsShapeAt(grid, shapeCells, row, col) {
  const positions = shapeCells.map(([dr, dc]) => ({ row: row + dr, col: col + dc }));
  return grid.canPlace(positions) ? positions : null;
}

function _chooseLuckyColor(grid, positions, maxColor) {
  const counts = new Map();
  for (const { row, col } of positions) {
    const neigh = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr, dc] of neigh) {
      const r = row + dr, c = col + dc;
      if (!grid.isInBounds(r, c)) continue;
      const cell = grid.get(r, c);
      if (cell?.isEmpty) continue;
      if (cell.colorID <= maxColor)
        counts.set(cell.colorID, (counts.get(cell.colorID) ?? 0) + 1);
    }
  }
  let best = 1, bestCount = -1;
  for (const [cid, cnt] of counts) {
    if (cnt > bestCount) { bestCount = cnt; best = cid; }
  }
  if (bestCount >= 0) return best;
  return 1 + Math.floor(Math.random() * maxColor);
}

function _evaluateLuckyPlacement(grid, positions) {
  const rows = new Set();
  const cols = new Set();
  for (const p of positions) { rows.add(p.row); cols.add(p.col); }
  let nearLine = 0;
  for (const r of rows) {
    let filled = 0;
    for (let c = 0; c < Grid.SIZE; c++) {
      const willFill = positions.some(p => p.row === r && p.col === c);
      const occupied = willFill || !grid.get(r, c).isEmpty;
      if (occupied) filled++;
    }
    if (filled === Grid.SIZE) nearLine += 16;
    else nearLine += filled;
  }
  for (const c of cols) {
    let filled = 0;
    for (let r = 0; r < Grid.SIZE; r++) {
      const willFill = positions.some(p => p.row === r && p.col === c);
      const occupied = willFill || !grid.get(r, c).isEmpty;
      if (occupied) filled++;
    }
    if (filled === Grid.SIZE) nearLine += 16;
    else nearLine += filled;
  }
  return nearLine + positions.length * 1.4;
}

function _findLuckyBlock(grid, maxColor) {
  let best = null;
  const entries = Object.entries(SHAPES);
  for (const [shapeKey, shape] of entries) {
    if (shape.size > 5) continue;
    for (let row = 0; row < Grid.SIZE; row++) {
      for (let col = 0; col < Grid.SIZE; col++) {
        const positions = _fitsShapeAt(grid, shape.cells, row, col);
        if (!positions) continue;
        const score = _evaluateLuckyPlacement(grid, positions);
        if (!best || score > best.score) {
          best = { shapeKey, positions, score };
        }
      }
    }
  }
  if (!best) return null;
  const colorID = _chooseLuckyColor(grid, best.positions, maxColor);
  return new Block(best.shapeKey, colorID);
}

function _normalizeCells(cells) {
  const minR = Math.min(...cells.map(c => c[0]));
  const minC = Math.min(...cells.map(c => c[1]));
  return cells.map(([r, c]) => [r - minR, c - minC]);
}

function _rotateCells(cells, dir = 'cw') {
  const maxR = Math.max(...cells.map(c => c[0]));
  const maxC = Math.max(...cells.map(c => c[1]));
  const rotated = dir === 'ccw'
    ? cells.map(([r, c]) => [maxC - c, r])
    : cells.map(([r, c]) => [c, maxR - r]);
  return _normalizeCells(rotated);
}

function _makeRotatedBlock(base, cells) {
  const norm = _normalizeCells(cells);
  const size = norm.length;
  return {
    id: base.id,
    shapeKey: `${base.shapeKey}_rot`,
    colorID: base.colorID,
    cells: norm,
    size,
    getAbsolutePositions(anchorRow, anchorCol) {
      return this.cells.map(([dr, dc]) => ({ row: anchorRow + dr, col: anchorCol + dc }));
    },
    getBoundingBox() {
      const rows = this.cells.map(([r]) => r);
      const cols = this.cells.map(([, c]) => c);
      return {
        rows: Math.max(...rows) + 1,
        cols: Math.max(...cols) + 1,
      };
    }
  };
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Game                                                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

class Game {
  constructor({ mode = 'endless' } = {}) {
    this.grid        = new Grid();
    this.scoreSystem = new ScoreSystem();
    this.particles   = new ParticleSystem();

    // Size canvases to fit screen
    const size   = computeGridSize();
    const prevSz = computeTraySize(size);
    const gridCanvas = _el('grid-canvas');
    const fxCanvas   = _el('fx-canvas');
    gridCanvas.width  = gridCanvas.height = size;
    fxCanvas.width    = fxCanvas.height   = size;
    document.querySelectorAll('.block-preview').forEach(el => {
      el.width = el.height = prevSz;
    });

    this.renderer = new Renderer(this.grid, gridCanvas, fxCanvas);
    this.renderer.setHandedness(_getHandMode());
    this.renderer.setSkin(economy.getActiveSkin());
    this._syncCellMetrics();

    this.tray       = [];
    this.usedMask   = [];
    this.placements = 0;
    this._coinMilestone    = 0;
    this._coinsAtGameStart = economy.coins;
    this._colorCap = _colorCapForScore(0);
    this._mode = mode;

    // VS mode state
    this._vsMode     = mode === 'vs';
    this._vsRole     = null;
    this._vsRng      = null;
    this._isGameOver = false;

    this._tutorial = {
      active: mode === 'endless' && localStorage.getItem(TUTORIAL_KEY) !== '1',
      step: 0,
      target: null,
      expectedShape: '',
      expectedColor: 0,
    };
    this._rotateMode = {
      active: false,
      selectedIdx: -1,
    };

    // UI refs
    this.scoreEl = _el('score-display');
    this.bestEl  = _el('best-display');
    this.comboEl = _el('combo-display');

    // Wire observers
    this.grid.onChange(cells => this.renderer.redrawCells(cells));

    this.scoreSystem.onChange(ss => {
      this.scoreEl.textContent = ss.score.toLocaleString();
      this.bestEl.textContent  = ss.best.toLocaleString();
      this.comboEl.textContent = `x${ss.comboMultiplier}`;
      this._updateComboVisual(ss.comboMultiplier);
      this._updateColorCap(ss.score);
      if (this._vsMode) vsSession.updateMyLiveScore(ss.score);
    });
    this._updateComboVisual(1);

    this.renderer.onDrop = (block, el, row, col) => this._handleDrop(block, el, row, col);
    this.renderer.setBlockProvider(idx => this.tray[idx] ?? null);

    if (rotateLeftBtn) {
      rotateLeftBtn.onclick = () => this._rotateSelectedBlock('ccw');
    }
    if (rotateRightBtn) {
      rotateRightBtn.onclick = () => this._rotateSelectedBlock('cw');
    }
    if (rotateConfirmBtn) {
      rotateConfirmBtn.onclick = () => this._finishRotateMode();
    }

    // Handle orientation / resize
    window.addEventListener('resize', () => this._handleResize());

    if (this._tutorial.active) this._startTutorial();
    else this._dealTray();
    this._loop(performance.now());
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _syncCellMetrics() {
    this.particles.cellMetrics = {
      cell:    this.renderer.CELL,
      gap:     this.renderer.GAP,
      padding: this.renderer.PADDING,
    };
  }

  _buildSnap(extraPositions = []) {
    const snap = {};
    for (let r = 0; r < Grid.SIZE; r++)
      for (let c = 0; c < Grid.SIZE; c++) {
        const cell = this.grid.get(r, c);
        if (!cell.isEmpty) snap[`${r},${c}`] = cell.colorID;
      }
    for (const { row: r, col: c, colorID } of extraPositions)
      snap[`${r},${c}`] = colorID;
    return snap;
  }

  _updateColorCap(score) {
    const nextCap = _colorCapForScore(score);
    if (nextCap <= this._colorCap) return;
    this._colorCap = nextCap;
    showToast(`Yeni renk açıldı! Artık ${nextCap} renk aktif.`);
  }

  _setTutorialUI(step, text) {
    _setVisible(tutorialOverlay, true);
    if (tutorialStepEl) tutorialStepEl.textContent = `ADIM ${step}/${TUTORIAL_TOTAL_STEPS}`;
    if (tutorialTextEl) tutorialTextEl.textContent = text;
  }

  _startTutorial() {
    this.grid.reset();
    this.scoreSystem.reset();
    this.particles._particles = [];
    this.placements = 0;
    this._setupTutorialStep1();
  }

  _setupTutorialStep1() {
    this._tutorial.active = true;
    this._tutorial.step = 1;
    this._tutorial.target = { row: 3, col: 3 };
    this._tutorial.expectedShape = 'DOT';
    this._tutorial.expectedColor = 1;
    this._setTutorialUI(1, 'Kirmizi tekli blogu isaretli hucreye birak. Renk birikimi ile patlama olur.');

    this.grid.reset();
    const cells = [
      { row: 2, col: 2 }, { row: 2, col: 3 }, { row: 2, col: 4 },
      { row: 3, col: 2 },                     { row: 3, col: 4 },
      { row: 4, col: 2 }, { row: 4, col: 3 }, { row: 4, col: 4 },
      { row: 1, col: 3 },
    ];
    this.grid.fillMany(cells, 1, 'tutorial_seed_cluster');

    this.tray = [new Block('DOT', 1), null, null, null];
    this.usedMask = [false, true, true, true];
    this._renderTray();
  }

  _setupTutorialStep2() {
    this._tutorial.step = 2;
    this._tutorial.target = { row: 5, col: 4 };
    this._tutorial.expectedShape = 'DOT';
    this._tutorial.expectedColor = 2;
    this._setTutorialUI(2, 'Bu kez satiri tamamla. Isaretli bosluga birak ve line clear yap.');

    this.grid.reset();
    const rowCells = [];
    for (let c = 0; c < Grid.SIZE; c++) {
      if (c === 4) continue;
      const color = (c % 4) + 1;
      rowCells.push({ row: 5, col: c, color });
    }
    for (const rc of rowCells)
      this.grid.fillMany([{ row: rc.row, col: rc.col }], rc.color, 'tutorial_seed_line');

    this.tray = [new Block('DOT', 2), null, null, null];
    this.usedMask = [false, true, true, true];
    this._renderTray();
  }

  _finishTutorial() {
    this._tutorial.active = false;
    this._tutorial.step = 0;
    this._tutorial.target = null;
    _setVisible(tutorialOverlay, false);
    localStorage.setItem(TUTORIAL_KEY, '1');
    showToast('Harika! Artik normal oyundasin.');
    this._dealTray();
  }

  _drawTutorialTarget(now) {
    if (!this._tutorial.active || !this._tutorial.target) return;
    const { row, col } = this._tutorial.target;
    const x = this.renderer.PADDING + col * (this.renderer.CELL + this.renderer.GAP);
    const y = this.renderer.PADDING + row * (this.renderer.CELL + this.renderer.GAP);
    const sz = this.renderer.CELL;
    const ctx = this.renderer.fxCtx;
    const pulse = 0.55 + (Math.sin(now / 180) + 1) * 0.2;

    ctx.save();
    ctx.strokeStyle = `rgba(196,181,253,${pulse})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 2, y - 2, sz + 4, sz + 4);
    ctx.fillStyle = `rgba(196,181,253,${0.15 + pulse * 0.12})`;
    ctx.fillRect(x, y, sz, sz);
    ctx.restore();
  }

  _isTutorialDropValid(block, row, col) {
    if (!this._tutorial.active) return true;
    const target = this._tutorial.target;
    const okCell = target && row === target.row && col === target.col;
    const okShape = block.shapeKey === this._tutorial.expectedShape;
    const okColor = block.colorID === this._tutorial.expectedColor;
    if (!okCell || !okShape || !okColor) {
      showToast('Bu adim icin isaretli yere birakmalisin.');
      return false;
    }
    return true;
  }

  _handleTutorialAfterClear(result) {
    if (!this._tutorial.active) return;
    if (this._tutorial.step === 1) {
      if (result.colorClusters.length > 0) {
        showToast('Super! Simdi satir temizleme adimi.');
        setTimeout(() => this._setupTutorialStep2(), 450);
      }
      return;
    }
    if (this._tutorial.step === 2) {
      if (result.clearedRows.length > 0 || result.clearedCols.length > 0) {
        this._tutorial.step = 3;
        this._setTutorialUI(3, 'Bazen sansli bir blok gelir. Ekranda LUCKY gorursen tabloya en faydali sekil gelmistir.');
        setTimeout(() => {
          if (!this._tutorial.active) return;
          this._tutorial.step = 4;
          this._setTutorialUI(4, 'Tek bir hamlede tum tablo temizlenirse CLEAN olur, ekstra puan kazanirsin.');
          setTimeout(() => this._finishTutorial(), 2200);
        }, 2200);
      }
    }
  }

  _enterRotateMode() {
    const first = this.tray.findIndex(Boolean);
    if (first === -1) {
      // No block to rotate: refund one charge.
      market._inv.rotate_block = (market._inv.rotate_block ?? 0) + 1;
      market._save();
      showToast('Elde blok yok. Hak iade edildi.');
      return;
    }

    this._rotateMode.active = true;
    this._rotateMode.selectedIdx = first;
    this.renderer.setDragEnabled(false);
    _setVisible(rotateControls, true);
    if (rotateLabelEl) rotateLabelEl.textContent = 'Blok sec, saga/sola dondur, onayla';
    powerupHint.textContent = '🔄 Donusturulecek blok sec';
    powerupHint.classList.remove('hidden');
    this._renderTray();
  }

  _finishRotateMode() {
    if (!this._rotateMode.active) return;
    this._rotateMode.active = false;
    this._rotateMode.selectedIdx = -1;
    this.renderer.setDragEnabled(true);
    _setVisible(rotateControls, false);
    powerupHint.classList.add('hidden');
    this._renderTray();
  }

  _selectRotateTarget(idx) {
    if (!this._rotateMode.active) return;
    if (!this.tray[idx]) return;
    this._rotateMode.selectedIdx = idx;
    this._renderTray();
  }

  _rotateSelectedBlock(dir = 'cw') {
    if (!this._rotateMode.active) return;
    const idx = this._rotateMode.selectedIdx;
    const block = this.tray[idx];
    if (!block) return;
    if (block.cells.length <= 1) {
      showToast('Tekli blok donmez.');
      return;
    }
    const nextCells = _rotateCells(block.cells, dir);
    this.tray[idx] = _makeRotatedBlock(block, nextCells);
    this._renderTray();
  }

  // ── Coin earning ──────────────────────────────────────────────────────────

  _checkCoins(score) {
    const milestone = Math.floor(score / SCORE_PER_COIN);
    const earned    = milestone - this._coinMilestone;
    if (earned > 0) {
      this._coinMilestone = milestone;
      economy.addCoins(earned);
      updateCoinDisplays();
    }
    return Math.max(0, earned);
  }

  _updateComboVisual(mult) {
    const m = Math.max(1, Math.min(10, mult));
    let color = '#22c55e'; // x1 green
    if (m === 2) color = '#facc15'; // x2 yellow
    else if (m === 3) color = '#ef4444'; // x3 red
    else if (m >= 4) color = '#a855f7'; // x4+ purple
    this.comboEl.style.setProperty('--combo-color', color);
    this.comboEl.classList.toggle('combo-active', m >= 2);
  }

  _triggerComboFire() {
    this.comboEl.classList.remove('combo-fired');
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add('combo-fired');
  }

  // ── Tray ───────────────────────────────────────────────────────────────────

  _dealTray() {
    if (this._vsMode && this._vsRng) {
      // VS mode: use shared seeded RNG — same block sequence for both players, no Lucky
      this.tray = Array.from({ length: TRAY_SIZE }, () =>
        nextVsBlock(this._vsRng, this._colorCap));
      this.usedMask = new Array(TRAY_SIZE).fill(false);
      this._renderTray();
      if (isGameOver(this.tray.filter(Boolean), this.grid))
        setTimeout(() => this._gameOver(), 400);
      return;
    }
    const hard   = this.placements > 0 && this.placements % HARD_EVERY === 0;
    this.tray     = generateTray(this.grid, TRAY_SIZE, hard, this._colorCap);
    const luckyChance = _luckyChanceForScore(this.scoreSystem.score);
    if (!this._tutorial.active && this.placements > 0 && Math.random() < luckyChance) {
      const lucky = _findLuckyBlock(this.grid, this._colorCap);
      if (lucky) {
        const pick = Math.floor(Math.random() * this.tray.length);
        this.tray[pick] = lucky;
        showToast('LUCKY! 🍀');
      }
    }
    this.usedMask = new Array(TRAY_SIZE).fill(false);
    this._renderTray();
    if (isGameOver(this.tray.filter(Boolean), this.grid))
      setTimeout(() => this._gameOver(), 400);
  }

  _renderTray() {
    for (let i = 0; i < this.tray.length; i++) {
      const el = _el(`block${i}`);
      if (!el) continue;
      el.classList.remove('used', 'dragging', 'rotate-selected');
      el.onclick = null;
      if (this._rotateMode.active && this.tray[i]) {
        el.onclick = () => this._selectRotateTarget(i);
        if (this._rotateMode.selectedIdx === i) el.classList.add('rotate-selected');
      }
      this.renderer.drawBlockPreview(el, this.tray[i]);
    }
  }

  _markUsed(idx) {
    this.usedMask[idx] = true;
    _el(`block${idx}`).classList.add('used');
    this.tray[idx] = null;
    if (this.tray.every(b => b === null) && !this._tutorial.active)
      setTimeout(() => this._dealTray(), 300);
  }

  // ── Drop ───────────────────────────────────────────────────────────────────

  _handleDrop(block, el, row, col) {
    if (this._rotateMode.active) return;
    if (!this._isTutorialDropValid(block, row, col)) return;

    const positions = block.getAbsolutePositions(row, col);
    if (!this.grid.canPlace(positions)) return;

    // Snapshot colors before placement (for particles)
    const snap = this._buildSnap();

    this.grid.fillMany(positions, block.colorID, block.id);
    for (const { row: r, col: c } of positions) snap[`${r},${c}`] = block.colorID;
    this.placements++;
    playPlace();
    if (this._vsMode) vsSession.markLocalMove();

    const idx = this.tray.findIndex(b => b?.id === block.id);
    if (idx !== -1) this._markUsed(idx);

    const result = runClearingLogic(this.grid, positions);
    if (result.totalCleared > 0) {
      this.particles.burstCells(result.cleared, PALETTE, snap);
      const { delta, label } = this.scoreSystem.record({
        deletedBlocks: result.totalCleared,
        clearedRows:   result.clearedRows.length,
        clearedCols:   result.clearedCols.length,
        colorClusters: result.colorClusters.length,
        now:           performance.now(),
      });
      let totalGain = delta;
      this.particles.spawnScoreFloat(result.cleared, delta, label, PALETTE, snap);
      // pick sound based on how impressive the clear is
      const hasMega = result.clearedRows.length > 0 && result.clearedCols.length > 0 && result.colorClusters.length > 0;
      if (hasMega)                             playMega();
      else if (result.colorClusters.length)    playCluster();
      else                                     playClear();

      // CLEAN: single placement ended with a fully empty board
      if (this.grid.getFilledCells().length === 0) {
        this.scoreSystem.score += CLEAN_BONUS_POINTS;
        totalGain += CLEAN_BONUS_POINTS;
        if (this.scoreSystem.score > this.scoreSystem.best) {
          this.scoreSystem.best = this.scoreSystem.score;
          localStorage.setItem('weaverBest', this.scoreSystem.best);
        }
        this.scoreSystem._emit();
        this.particles.spawnScoreFloat(result.cleared, CLEAN_BONUS_POINTS, 'CLEAN!', PALETTE, snap);
        playClean();
        showToast('CLEAN! ✨');
      }

      const coinsEarned = this._checkCoins(this.scoreSystem.score);
      showGainFloat({ scoreDelta: totalGain, coins: coinsEarned });
      this._triggerComboFire();
    } else {
      this.scoreSystem.breakCombo();
    }

    this._handleTutorialAfterClear(result);

    if (this.tray.filter(Boolean).length > 0 && isGameOver(this.tray.filter(Boolean), this.grid))
      setTimeout(() => this._gameOver(), 400);
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  _loop(last) {
    const now = performance.now();
    const dt  = Math.min((now - last) / 1000, 0.05);
    this.renderer.tickTweens(dt);
    // Clear fxCtx each frame, then redraw particles + ghost
    this.renderer.fxCtx.clearRect(0, 0, this.renderer.fxCanvas.width, this.renderer.fxCanvas.height);
    if (this.particles.hasParticles) {
      this.particles.tick(dt, this.renderer.fxCtx);
    }
    this.renderer.redrawGhost();
    this._drawTutorialTarget(now);
    requestAnimationFrame(t => this._loop(t));
  }

  // ── Game over ──────────────────────────────────────────────────────────────

  _gameOver() {
    this._isGameOver = true;
    this._finishRotateMode();

    // VS mode: report to opponent, show overlay after brief delay, skip normal game-over UI
    if (this._vsMode) {
      vsSession.reportGameOver(this.scoreSystem.score);
      return;
    }

    const earned = this._coinMilestone; // only gameplay-earned coins, not purchases
    _el('final-score').textContent = this.scoreSystem.score.toLocaleString();
    _el('final-coins').textContent = `+${earned} \uD83E\uDE99`;
    overlayEl.classList.remove('hidden');
    // Auto-save progress to cloud
    if (_currentUser) saveCloudSave(_currentUser.uid, _cloudSavePayload()).catch(() => {});
  }

  // ── Restart ────────────────────────────────────────────────────────────────

  restart({ mode = this._mode } = {}) {
    this._finishRotateMode();
    this._mode       = mode;
    this._vsMode     = mode === 'vs';
    this._vsRole     = null;
    this._vsRng      = null;
    this._isGameOver = false;
    this.grid.reset();
    this.scoreSystem.reset();
    this.particles._particles = [];
    this.placements      = 0;
    this._coinMilestone  = 0;
    this._coinsAtGameStart = economy.coins;
    this._colorCap = _colorCapForScore(0);
    this._tutorial.active = mode === 'endless' && localStorage.getItem(TUTORIAL_KEY) !== '1';
    this._tutorial.step = 0;
    this._tutorial.target = null;
    this.renderer.setSkin(economy.getActiveSkin());
    if (this._tutorial.active) this._startTutorial();
    else {
      _setVisible(tutorialOverlay, false);
      this._dealTray();
    }
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  _handleResize() {
    const size   = computeGridSize();
    const prevSz = computeTraySize(size);
    const gc = _el('grid-canvas');
    const fc = _el('fx-canvas');
    if (gc.width === size) return;
    gc.width = gc.height = size;
    fc.width = fc.height = size;
    document.querySelectorAll('.block-preview').forEach(el => {
      el.width = el.height = prevSz;
    });
    this.renderer.resize();
    this._syncCellMetrics();
    this._renderTray();
  }

  // ── Power-ups ──────────────────────────────────────────────────────────────

  activatePowerup(id) {
    if (!market.use(id)) { showToast('No power-up left!'); return; }
    updateCoinDisplays();

    if (id !== 'rotate_block') this._finishRotateMode();

    if (id === 'rotate_block') {
      this._enterRotateMode();
      return;
    }

    if (id === 'color_bomb') {
      // No targeting needed — find most frequent color and clear it
      const counts = Array(9).fill(0);
      for (let r = 0; r < Grid.SIZE; r++)
        for (let c = 0; c < Grid.SIZE; c++) {
          const cell = this.grid.get(r, c);
          if (!cell.isEmpty) counts[cell.colorID]++;
        }
      const topColor = counts.reduce((best, cnt, idx) => cnt > counts[best] ? idx : best, 1);
      const positions = [];
      for (let r = 0; r < Grid.SIZE; r++)
        for (let c = 0; c < Grid.SIZE; c++) {
          const cell = this.grid.get(r, c);
          if (!cell.isEmpty && cell.colorID === topColor) positions.push({ row: r, col: c });
        }
      this._executeClear(positions, 'Color Bomb! 🌈');
      return;
    }

    if (id === 'extra_block') {
      // Kullanıcı grid üzerine istediği kareye tek blok yerleştirir
      const colorID = Math.ceil(Math.random() * 8);
      this._pendingExtraBlock = new Block('DOT', colorID);
      powerupHint.textContent = '➕ İstediğin kareye dokun — tekli blok yerleştir';
      powerupHint.classList.remove('hidden');
      _el('game-container').classList.add('powerup-target');

      const onTap = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pt = e.touches ? e.touches[0] : e;
        const { row, col } = this.renderer._screenToGrid(pt.clientX, pt.clientY);

        powerupHint.classList.add('hidden');
        _el('game-container').classList.remove('powerup-target');
        gcEl.removeEventListener('pointerdown', onTap);
        gcEl.removeEventListener('touchstart',  onTap);

        if (row < 0) {
          market._inv[id] = (market._inv[id] ?? 0) + 1;
          market._save();
          this._pendingExtraBlock = null;
          showToast('İptal edildi.');
          return;
        }
        const pos = [{ row, col }];
        if (!this.grid.canPlace(pos)) {
          // Dolu kare — iade et
          market._inv[id] = (market._inv[id] ?? 0) + 1;
          market._save();
          this._pendingExtraBlock = null;
          showToast('Bu kare dolu, iptal edildi.');
          return;
        }
        this.grid.fillMany(pos, this._pendingExtraBlock.colorID, this._pendingExtraBlock.id);
        this._pendingExtraBlock = null;
        showToast('Blok yerleştirildi! ➕');
      };

      const gcEl = _el('grid-canvas');
      gcEl.addEventListener('pointerdown', onTap, { once: true });
      gcEl.addEventListener('touchstart',  onTap, { once: true, passive: false });
      return;
    }

    // Targeted power-ups: wait for user to tap a cell
    this._pendingPowerup = id;
    powerupHint.textContent = id === 'smash'
      ? '💥 Yok etmek istediğin hücreye dokun'
      : id === 'blast_right'
      ? '➡️ Patlatmak istediğin satıra dokun'
      : '⬅️ Patlatmak istediğin satıra dokun';
    powerupHint.classList.remove('hidden');
    _el('game-container').classList.add('powerup-target');

    const onTap = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pt = e.touches ? e.touches[0] : e;
      const { row, col } = this.renderer._screenToGrid(pt.clientX, pt.clientY);

      powerupHint.classList.add('hidden');
      _el('game-container').classList.remove('powerup-target');
      gcEl.removeEventListener('pointerdown', onTap);
      gcEl.removeEventListener('touchstart',  onTap);

      if (row < 0) {
        // Grid dışına tıklandı — power-up iade et
        market._inv[id] = (market._inv[id] ?? 0) + 1;
        market._save();
        showToast('İptal edildi.');
        this._pendingPowerup = null;
        return;
      }
      const pending = this._pendingPowerup;
      this._pendingPowerup = null;
      this._applyTargetedPowerup(pending, row, col);
    };

    const gcEl = _el('grid-canvas');
    gcEl.addEventListener('pointerdown', onTap, { once: true });
    gcEl.addEventListener('touchstart',  onTap, { once: true, passive: false });
  }

  _applyTargetedPowerup(id, row, col) {
    if (id === 'smash') {
      const cell = this.grid.get(row, col);
      if (!cell || cell.isEmpty) { showToast('Pick a filled cell!'); return; }
      this._executeClear([{ row, col }], 'Smashed! 💥');
    } else if (id === 'blast_right') {
      const positions = [];
      for (let c = col; c < Grid.SIZE; c++) {
        if (!this.grid.get(row, c).isEmpty) positions.push({ row, col: c });
      }
      if (!positions.length) { showToast('Nothing to blast!'); return; }
      this._executeClear(positions, 'Right Blast! ➡️');
    } else if (id === 'blast_left') {
      const positions = [];
      for (let c = col; c >= 0; c--) {
        if (!this.grid.get(row, c).isEmpty) positions.push({ row, col: c });
      }
      if (!positions.length) { showToast('Nothing to blast!'); return; }
      this._executeClear(positions, 'Left Blast! ⬅️');
    }
  }

  _executeClear(positions, label) {
    if (!positions.length) return;
    const snap = this._buildSnap();
    this.grid.clearMany(positions);
    this.particles.burstCells(positions, PALETTE, snap);
    const { delta } = this.scoreSystem.record({
      deletedBlocks: positions.length,
      clearedRows: [], clearedCols: [], colorClusters: [],
      now: performance.now(),
    });
    const coinsEarned = this._checkCoins(this.scoreSystem.score);
    showGainFloat({ scoreDelta: delta, coins: coinsEarned });
    this.particles.spawnScoreFloat(positions, delta, label, PALETTE, snap);
    playCluster();
    updateCoinDisplays();
  }
}
