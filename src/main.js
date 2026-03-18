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
  setSkipFileSfx,
} from './sounds.js';
import {
  googleSignIn, googleSignOut, onAuthChange,
  loadCloudSave, saveCloudSave, applyBonusIfNeeded, getFirebaseServices,
} from './firebase.js';
import {
  createMatch, joinMatchByCode, quickMatch,
  updatePlayerState, finishMatch, cancelMatch, subscribeMatch,
  clearVoiceSignal, publishVoiceOffer, publishVoiceAnswer,
  setVoiceMicState, subscribeVoiceSignal, sendVoiceCandidate, subscribeVoiceCandidates,
  serializeBoard, drawMiniBoard, nextVsBlock, SeededRng,
} from './vs.js';
import {
  upsertUserProfile,
  updateUserProfile,
  sendFriendRequest,
  sendFriendRequestByEmail,
  respondFriendRequest,
  sendFriendChatMessage,
  subscribeFriendChat,
  sendVsInvite,
  sendMatchChatMessage,
  subscribeFriendRequests,
  subscribeIncomingVsInvites,
  subscribeMatchChat,
  submitPlayerReport,
  respondVsInvite,
  setPresence,
  subscribeFriends,
} from './social.js';
import { t, setLang, getLang, AVAILABLE_LANGS } from './i18n.js';
import { initAds, showRewardedAd } from './ads.js';

const TRAY_SIZE      = 4;
const HARD_EVERY     = 5;
const SCORE_PER_COIN = 1000;
const TUTORIAL_KEY   = 'weaverTutorialDone';
const TUTORIAL_TOTAL_STEPS = 6;
const FTUE_KEY = 'weaverFtueDone';
const CHALLENGE_LOCAL_KEY = 'weaverChallengeLocal';
const CHALLENGE_GLOBAL_KEY = 'weaverChallengeGlobal';
const CHALLENGE_SEED_KEY = 'weaverChallengeSeed';
const CHALLENGE_ROWS = 6;
const CLEAN_BONUS_POINTS = 500;
const VS_STATE_SYNC_MS = 300;
const VS_MOVE_TIMEOUT_MS = 20_000;
const VS_START_GRACE_MS = 4_000;
const VS_RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};
const PRESENCE_STALE_MS = 25_000;
const FRIENDS_UI_REFRESH_MS = 10_000;
const GUEST_SNAPSHOT_KEY = 'weaverGuestSnapshot';
const MIC_PERMISSION_PROMPT_KEY = 'weaverMicPermissionPrompted';
const LOCATION_PERMISSION_PROMPT_KEY = 'weaverLocationPermissionPrompted';
const PROFILE_SETUP_DONE_PREFIX = 'weaverProfileSetupDone';
const AVATAR_CACHE_PREFIX = 'weaverAvatarCache';
const AVATAR_HISTORY_PREFIX = 'weaverAvatarHistory';
const MODERATION_BLOCK_PREFIX = 'weaverBlocked';
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

function _profileSetupDoneKey(uid) {
  return `${PROFILE_SETUP_DONE_PREFIX}_${uid}`;
}

function _avatarCacheKey(uid) {
  return `${AVATAR_CACHE_PREFIX}_${uid}`;
}

function _avatarHistoryKey(uid) {
  return `${AVATAR_HISTORY_PREFIX}_${uid}`;
}

function _blockKey(uid) {
  return `${MODERATION_BLOCK_PREFIX}_${uid}`;
}

function _readLocalAvatar(uid) {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(_avatarCacheKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function _writeLocalAvatar(uid, payload) {
  if (!uid || !payload) return;
  localStorage.setItem(_avatarCacheKey(uid), JSON.stringify(payload));
}

function _readAvatarHistory(uid) {
  if (!uid) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(_avatarHistoryKey(uid)) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function _pushAvatarHistory(uid, value) {
  if (!uid || !value) return;
  const list = _readAvatarHistory(uid).filter(v => v !== value);
  list.unshift(value);
  localStorage.setItem(_avatarHistoryKey(uid), JSON.stringify(list.slice(0, 12)));
}

function _isProfileComplete(data = {}) {
  return !!(data.profileCompleted && data.birthDate && data.gender);
}

async function _reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const json = await res.json();
    const addr = json?.address || {};
    const city = addr.city || addr.town || addr.village || addr.state || '';
    const country = addr.country || '';
    const text = [city, country].filter(Boolean).join(', ');
    return text || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

async function _runAvatarModeration({ fileName = '', dataUrl = '' } = {}) {
  const name = String(fileName || '').toLowerCase();
  const blockedWords = ['porn', 'nude', 'nudity', 'xxx', 'sex', 'gore', 'violent'];
  if (blockedWords.some(w => name.includes(w))) {
    return { safe: false, reason: 'unsafe_filename' };
  }

  const endpoint = window?.WEAVER_MODERATION_ENDPOINT;
  if (!endpoint) return { safe: true };
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    const json = await res.json().catch(() => ({}));
    if (json?.safe === false) return { safe: false, reason: json?.reason || 'unsafe_content' };
    return { safe: true };
  } catch {
    return { safe: true };
  }
}

function _setProfileError(msg = '') {
  const el = _el('profile-setup-error');
  if (!el) return;
  if (!msg) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function _requestMicPermissionOnFirstLaunch() {
  if (localStorage.getItem(MIC_PERMISSION_PROMPT_KEY) === '1') return;
  localStorage.setItem(MIC_PERMISSION_PROMPT_KEY, '1');
  if (!navigator?.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => {
      track.enabled = false;
      track.stop();
    });
  } catch {
    // Permission denied or unavailable; keep app flow uninterrupted.
  }
}

async function _requestLocationPermissionOnFirstLaunch() {
  if (localStorage.getItem(LOCATION_PERMISSION_PROMPT_KEY) === '1') return;
  localStorage.setItem(LOCATION_PERMISSION_PROMPT_KEY, '1');
  if (!navigator?.geolocation) return;
  navigator.geolocation.getCurrentPosition(() => {}, () => {}, {
    enableHighAccuracy: false,
    timeout: 7_000,
    maximumAge: 0,
  });
}

function _rankStorageKey(uid) {
  return uid ? `${RANK_KEY_PREFIX}_${uid}` : null;
}

function _getRankPoints(uid = _currentUser?.uid) {
  const key = _rankStorageKey(uid);
  if (!key) return 0;
  return Number(localStorage.getItem(key) ?? 0);
}

function _setRankPoints(points, uid = _currentUser?.uid) {
  const key = _rankStorageKey(uid);
  if (!key) return 0;
  const safe = Math.max(0, Math.round(points));
  localStorage.setItem(key, String(safe));
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
  const signedIn = !!uid;
  ['ss-rank-badge', 'ss-rank-summary', 'play-rank-pill', 'settings-rank-badge']
    .forEach(id => _setVisible(_el(id), signedIn));
  if (!signedIn) return;

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
  localStorage.removeItem(GUEST_SNAPSHOT_KEY);

  updateCoinDisplays();
  _updateStartScreen();
  renderSkinsPage();
  if (game) {
    game.renderer.setSkin(economy.getActiveSkin());
    game._renderTray();
  }
}

function _challengeDisplayName() {
  return _currentUser?.displayName || 'Guest';
}

function _loadBoard(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function _saveBoard(key, rows) {
  localStorage.setItem(key, JSON.stringify(rows.slice(0, CHALLENGE_ROWS)));
}

function _seedGlobalBoardIfNeeded() {
  const exists = _loadBoard(CHALLENGE_GLOBAL_KEY);
  if (exists.length) return;
  const bots = [
    { name: 'PixelFox', level: 8, score: 19420 },
    { name: 'GridMind', level: 7, score: 16650 },
    { name: 'LineStorm', level: 6, score: 13910 },
    { name: 'NeoBlock', level: 5, score: 11800 },
  ];
  _saveBoard(CHALLENGE_GLOBAL_KEY, bots);
}

function _submitChallengeScore({ level, score }) {
  const entry = {
    name: _challengeDisplayName(),
    level: Number(level || 1),
    score: Number(score || 0),
  };

  const rankSort = (a, b) => (b.level - a.level) || (b.score - a.score);

  const local = _loadBoard(CHALLENGE_LOCAL_KEY);
  local.push(entry);
  local.sort(rankSort);
  _saveBoard(CHALLENGE_LOCAL_KEY, local);

  _seedGlobalBoardIfNeeded();
  const global = _loadBoard(CHALLENGE_GLOBAL_KEY);
  global.push(entry);
  global.sort(rankSort);
  _saveBoard(CHALLENGE_GLOBAL_KEY, global);
}

function _renderChallengeBoardList(targetId, rows) {
  const root = _el(targetId);
  if (!root) return;
  root.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'challenge-board-empty';
    empty.textContent = 'Henüz kayıt yok';
    root.appendChild(empty);
    return;
  }
  rows.slice(0, CHALLENGE_ROWS).forEach((r, idx) => {
    const row = document.createElement('div');
    row.className = 'challenge-board-row';
    row.innerHTML = `<span>${idx + 1}. ${r.name}</span><span>L${r.level} • ${Number(r.score).toLocaleString()}</span>`;
    root.appendChild(row);
  });
}

function renderChallengeLeaderboards() {
  _seedGlobalBoardIfNeeded();
  _renderChallengeBoardList('challenge-local-board', _loadBoard(CHALLENGE_LOCAL_KEY));
  _renderChallengeBoardList('challenge-global-board', _loadBoard(CHALLENGE_GLOBAL_KEY));
}

function _presenceStatusToUi(row) {
  const lastSeenAt = Number(row?.lastSeenAt || 0);
  const isFresh = lastSeenAt > 0 && (Date.now() - lastSeenAt) <= PRESENCE_STALE_MS;
  if (!isFresh) return { key: 'offline', label: t('statusOffline'), cls: 'friend-status' };

  const state = row?.presenceState;
  if (state === 'in_game') return { key: 'in_game', label: t('statusInGame'), cls: 'friend-status friend-status--ingame' };
  if (state === 'online') return { key: 'online', label: t('statusOnline'), cls: 'friend-status friend-status--online' };
  return { key: 'offline', label: t('statusOffline'), cls: 'friend-status' };
}

function _renderFriendsPanel() {
  if (!friendsListEl) return;
  _renderFriendRequestsPanel();
  friendsListEl.innerHTML = '';

  if (!_friendsRows.length) {
    const empty = document.createElement('div');
    empty.className = 'friend-empty';
    empty.textContent = t('friendsEmpty');
    friendsListEl.appendChild(empty);
    return;
  }

  _friendsRows.forEach(row => {
    const status = _presenceStatusToUi(row);
    const item = document.createElement('div');
    item.className = 'friend-row';

    const main = document.createElement('div');
    main.className = 'friend-main';

    let avatarEl;
    if (row.photoURL) {
      avatarEl = document.createElement('img');
      avatarEl.className = 'friend-avatar';
      avatarEl.src = row.photoURL;
      avatarEl.alt = row.name || 'Player';
      avatarEl.referrerPolicy = 'no-referrer';
    } else {
      avatarEl = document.createElement('span');
      avatarEl.className = 'friend-avatar friend-avatar--fallback';
      avatarEl.textContent = (row.name || 'P').slice(0, 1).toUpperCase();
    }

    const name = document.createElement('span');
    name.className = 'friend-name';
    name.textContent = row.name || 'Player';
    main.append(avatarEl, name);

    const chip = document.createElement('span');
    chip.className = status.cls;
    chip.textContent = status.label;

    const controls = document.createElement('div');
    controls.className = 'friend-row-controls';
    controls.appendChild(chip);

    if (status.key === 'online') {
      const inviteBtn = document.createElement('button');
      inviteBtn.type = 'button';
      inviteBtn.className = 'friend-invite-btn';
      inviteBtn.textContent = 'VS Davet';
      inviteBtn.onclick = () => vsSession.inviteFriend(row);
      controls.appendChild(inviteBtn);
    }

    const chatBtn = document.createElement('button');
    chatBtn.type = 'button';
    chatBtn.className = 'friend-chat-btn';
    chatBtn.textContent = 'Sohbet';
    chatBtn.onclick = () => _openFriendChat(row);
    controls.appendChild(chatBtn);

    item.append(main, controls);
    friendsListEl.appendChild(item);
  });
}

function _renderFriendChatRows(rows = []) {
  if (!friendsChatMessagesEl) return;
  const me = _currentUser?.uid;
  friendsChatMessagesEl.innerHTML = '';
  rows.forEach(row => {
    const line = document.createElement('div');
    line.className = `friends-chat-row${row.uid === me ? ' friends-chat-row--me' : ''}`;
    line.textContent = row.text || '';
    friendsChatMessagesEl.appendChild(line);
  });
  friendsChatMessagesEl.scrollTop = friendsChatMessagesEl.scrollHeight;
}

function _closeFriendChat() {
  if (_unsubFriendChat) {
    _unsubFriendChat();
    _unsubFriendChat = null;
  }
  _activeFriendChat = null;
  if (friendsChatInputEl) friendsChatInputEl.value = '';
  _renderFriendChatRows([]);
  _setVisible(friendsChatPanelEl, false);
}

function _openFriendChat(row) {
  if (!_currentUser?.uid || !row?.uid) return;
  _activeFriendChat = row;
  if (friendsChatTitleEl) friendsChatTitleEl.textContent = row.name || 'Sohbet';
  _setVisible(friendsChatPanelEl, true);

  if (_unsubFriendChat) {
    _unsubFriendChat();
    _unsubFriendChat = null;
  }
  _unsubFriendChat = subscribeFriendChat(_currentUser.uid, row.uid, rows => _renderFriendChatRows(rows));
}

function _renderVsInviteNotice() {
  if (!vsInviteNoticeEl || !_incomingVsInvites.length) {
    _setVisible(vsInviteNoticeEl, false);
    return;
  }
  const invite = _incomingVsInvites[0];
  if (vsInviteTextEl) {
    vsInviteTextEl.textContent = `${invite.senderName || 'Arkadasin'} seni VS maca davet etti.`;
  }
  vsInviteNoticeEl.dataset.inviteId = invite.id;
  _setVisible(vsInviteNoticeEl, true);
}

function _renderFriendRequestsPanel() {
  if (!friendsRequestsEl) return;
  friendsRequestsEl.innerHTML = '';

  if (!_friendRequestRows.length) {
    friendsRequestsEl.classList.add('hidden');
    return;
  }

  friendsRequestsEl.classList.remove('hidden');

  const title = document.createElement('div');
  title.className = 'friends-requests-title';
  title.textContent = 'Arkadaslik Istekleri';
  friendsRequestsEl.appendChild(title);

  _friendRequestRows.forEach(row => {
    const item = document.createElement('div');
    item.className = 'friend-request-row';

    const name = document.createElement('span');
    name.className = 'friend-name';
    name.textContent = row.requesterName || 'Player';

    const actions = document.createElement('div');
    actions.className = 'friend-request-actions';

    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'friend-request-btn friend-request-btn--accept';
    acceptBtn.textContent = 'Kabul';
    acceptBtn.onclick = async () => {
      try {
        await respondFriendRequest(_currentUser, row.id, 'accept', { matchId: row.requestMatchId });
        showToast('Arkadaslik istegi kabul edildi.');
      } catch (err) {
        showToast(String(err?.message || err));
      }
    };

    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'friend-request-btn friend-request-btn--reject';
    rejectBtn.textContent = 'Reddet';
    rejectBtn.onclick = async () => {
      try {
        await respondFriendRequest(_currentUser, row.id, 'reject', { matchId: row.requestMatchId });
        showToast('Istek reddedildi. Bu eslesmede tekrar gonderilemez.');
      } catch (err) {
        showToast(String(err?.message || err));
      }
    };

    actions.append(acceptBtn, rejectBtn);
    item.append(name, actions);
    friendsRequestsEl.appendChild(item);
  });
}

function _presenceStateForCurrentGame() {
  return game?._vsMode ? 'in_game' : 'online';
}

function _updateMyPresence() {
  if (!_currentUser || !navigator.onLine) return;
  setPresence(_currentUser, _presenceStateForCurrentGame()).catch(() => {});
}

function _startPresenceHeartbeat() {
  if (_presenceHeartbeat) clearInterval(_presenceHeartbeat);
  _presenceHeartbeat = setInterval(_updateMyPresence, 10_000);
}

function _startFriendsUiRefresh() {
  if (_friendsUiRefreshTimer) clearInterval(_friendsUiRefreshTimer);
  _friendsUiRefreshTimer = setInterval(() => {
    if (_friendsRows.length) _renderFriendsPanel();
  }, FRIENDS_UI_REFRESH_MS);
}

function _stopPresenceHeartbeat() {
  if (_presenceHeartbeat) clearInterval(_presenceHeartbeat);
  _presenceHeartbeat = null;
}

function _stopFriendsUiRefresh() {
  if (_friendsUiRefreshTimer) clearInterval(_friendsUiRefreshTimer);
  _friendsUiRefreshTimer = null;
}

// ── Global state ────────────────────────────────────────────────────────────

const economy = new EconomyStore();
const market  = new MarketStore();
let game      = null;
let _currentUser = null;
let _unsubFriends = null;
let _unsubFriendRequests = null;
let _unsubVsInvites = null;
let _presenceHeartbeat = null;
let _friendsUiRefreshTimer = null;
let _unsubFriendChat = null;
let _friendsRows = [];
let _friendRequestRows = [];
let _incomingVsInvites = [];
let _activeFriendChat = null;
let _profileDocCache = null;
let _profileAvatarDraft = null;
let _profileLocationGeo = null;
let _locationSuggestTimer = null;

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
  // Use highly distinct families so the user can clearly see switching on Android/WebView.
  avenir: "Georgia, 'Times New Roman', serif",
  nunito: "'Nunito', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
  verdana: "Verdana, Geneva, 'Courier New', 'Roboto Mono', monospace",
};

function _getUiFontChoice() {
  const stored = localStorage.getItem(FONT_KEY) || 'verdana';
  return FONT_CHOICES[stored] ? stored : 'verdana';
}

function _applyUiFont(choice = _getUiFontChoice()) {
  const safe = FONT_CHOICES[choice] ? choice : 'verdana';
  const stack = FONT_CHOICES[safe];
  document.documentElement.style.setProperty('--ui-font', stack);
  document.documentElement.style.fontFamily = stack;
  if (document.body) document.body.style.fontFamily = stack;
  document.documentElement.setAttribute('data-ui-font', safe);
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
const tutorialProgressEl = _el('tutorial-progress');
const tutorialStepAnimEl = _el('tutorial-step-anim');
const rotateControls  = _el('rotate-controls');
const rotateLeftBtn   = _el('rotate-left-btn');
const rotateRightBtn  = _el('rotate-right-btn');
const rotateConfirmBtn= _el('rotate-confirm-btn');
const rotateLabelEl   = _el('rotate-controls-label');
const tutorialSkipBtn = _el('tutorial-skip-btn');
const bootLoaderEl    = _el('boot-loader');
const friendsBtn      = _el('ss-friends-btn');
const friendsPanel    = _el('friends-panel');
const friendsRequestsEl = _el('friends-requests');
const friendsListEl   = _el('friends-list');
const friendsChatPanelEl = _el('friends-chat-panel');
const friendsChatTitleEl = _el('friends-chat-title');
const friendsChatMessagesEl = _el('friends-chat-messages');
const friendsChatInputEl = _el('friends-chat-input');
const vsInviteNoticeEl = _el('vs-invite-notice');
const vsInviteTextEl = _el('vs-invite-text');
const profileSetupOverlayEl = _el('profile-setup-overlay');
const profileDisplayNameInputEl = _el('profile-display-name-input');
const profileBirthDateInputEl = _el('profile-birthdate-input');
const profileGenderSelectEl = _el('profile-gender-select');
const profileLocationInputEl = _el('profile-location-input');
const profileLocationSuggestionsEl = _el('profile-location-suggestions');
const profileLocationStatusEl = _el('profile-location-status');
const profileAvatarPreviewEl = _el('profile-avatar-preview');
const profileAvatarUploadInputEl = _el('profile-avatar-upload-input');
const profileAvatarGoogleBtnEl = _el('profile-avatar-google-btn');
const profileAvatarHistoryEl = _el('profile-avatar-history');

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
  set('vs-add-friend-label', 'socialAddFriend');
  set('vs-voice-label', 'socialVoiceChat');
  set('vs-report-label', 'socialReport');
  set('vs-chat-send-btn', 'socialSend');
  set('friends-panel-title', 'friendsTitle');
  const chatInput = _el('vs-chat-input');
  if (chatInput) chatInput.placeholder = t('socialChatPlaceholder');
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
  _renderFriendsPanel();
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

const _ftueSlides = [
  'Weaver\'a hoş geldin. Amaç: blokları yerleştir, çizgi ve renk patlamalarıyla puan topla.',
  'Meydan Okuma modunda hedefin ekranı tamamen temizlemek. Her seviye yeni bir bulmaca getirir.',
  'Market\'teki Undo gücü son hamleni geri alır. Zor anlarda kurtarıcıdır.',
];
let _ftueIdx = 0;
function _showFtueIfNeeded() {
  const overlay = _el('ftue-overlay');
  if (!overlay) return;
  // Interactive tutorial replaces text-based FTUE on first install.
  localStorage.setItem(FTUE_KEY, '1');
  _setVisible(overlay, false);
}
_showFtueIfNeeded();

let _bootLoaderGone = false;
function _hideBootLoader() {
  if (_bootLoaderGone) return;
  _bootLoaderGone = true;
  if (!bootLoaderEl) return;
  bootLoaderEl.classList.add('hidden');
  setTimeout(() => bootLoaderEl.remove(), 360);
  setTimeout(() => { _requestMicPermissionOnFirstLaunch(); }, 420);
  setTimeout(() => { _requestLocationPermissionOnFirstLaunch(); }, 520);
  
  // Check if tutorial should run on first launch
  if (localStorage.getItem(TUTORIAL_KEY) !== '1') {
    _startFirstLaunchTutorial();
  }
}

function _startFirstLaunchTutorial() {
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
  _syncNavForPage('play');
  _syncPlayHudVisibility('endless');
}
window.addEventListener('load', () => {
  setTimeout(_hideBootLoader, 520);
}, { once: true });
setTimeout(_hideBootLoader, 2200);

// ── Navigation ───────────────────────────────────────────────────────────────

const PAGES = { play: pagePlay, skins: pageSkins, market: pageMarket, settings: pageSettings };
const PAGE_ORDER = ['play', 'market', 'skins', 'settings'];
let _currentPage = 'market';
let _settingsReturnTarget = 'play';

function _syncNavForPage(pageName = _currentPage) {
  const nav = _el('bottom-nav');
  const hideForVs = !!game?._vsMode;
  if (nav) nav.classList.toggle('hidden', pageName === 'settings' || hideForVs);
}

function _syncPlayHudVisibility(mode = game?._mode) {
  const isVs = mode === 'vs';
  _setVisible(_el('coin-hud'), !isVs);
  _setVisible(_el('play-rank-pill'), !isVs);
  _setVisible(_el('vs-menu-toggle-btn'), isVs);
  document.body.classList.toggle('vs-active', isVs);
  if (!isVs) {
    _setVisible(_el('vs-chat-panel'), false);
    _setVisible(_el('vs-menu-panel'), false);
  }
  _updateMyPresence();
}

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
    _syncNavForPage(name);
    if (name === 'play') _syncPlayHudVisibility();
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
  _syncNavForPage(name);
  if (name === 'play') _syncPlayHudVisibility();
}

document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.page === 'settings') {
      _settingsReturnTarget = _currentPage === 'settings' ? 'play' : _currentPage;
    }
    if (btn.dataset.page === 'play') {
      if (!game) game = new Game({ mode: 'endless' });
      _syncPlayHudVisibility(game?._mode || 'endless');
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

friendsBtn?.addEventListener('click', () => {
  if (!navigator.onLine) { showToast(t('noInternet')); return; }
  if (!_currentUser) { showToast(t('signInRequired')); return; }
  if (friendsPanel?.classList.contains('hidden')) _closeFriendChat();
  _renderFriendsPanel();
  friendsPanel?.classList.toggle('hidden');
});

_el('friends-panel-close-btn')?.addEventListener('click', () => {
  _closeFriendChat();
  _setVisible(friendsPanel, false);
});

_el('friends-chat-back-btn')?.addEventListener('click', () => {
  _closeFriendChat();
});

const _sendFriendChat = async () => {
  if (!_currentUser || !_activeFriendChat?.uid) return;
  const text = String(friendsChatInputEl?.value || '').trim();
  if (!text) return;
  if (friendsChatInputEl) friendsChatInputEl.value = '';
  try {
    await sendFriendChatMessage(_activeFriendChat.uid, _currentUser, text);
  } catch (err) {
    showToast(String(err?.message || err));
  }
};

_el('friends-chat-send-btn')?.addEventListener('click', _sendFriendChat);
friendsChatInputEl?.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  _sendFriendChat();
});

window.addEventListener('online', () => {
  _updateModeSelectUI();
  if (_currentUser) {
    _updateMyPresence();
    _startPresenceHeartbeat();
    _startFriendsUiRefresh();
    if (_unsubFriends) _unsubFriends();
    if (_unsubFriendRequests) _unsubFriendRequests();
    if (_unsubVsInvites) _unsubVsInvites();
    _unsubFriends = subscribeFriends(_currentUser, rows => {
      _friendsRows = rows;
      _renderFriendsPanel();
    });
    _unsubFriendRequests = subscribeFriendRequests(_currentUser, rows => {
      _friendRequestRows = rows;
      _renderFriendsPanel();
      vsSession.onFriendRequestsChanged();
    });
    _unsubVsInvites = subscribeIncomingVsInvites(_currentUser, rows => {
      _incomingVsInvites = rows;
      _renderVsInviteNotice();
    });
  }
});

window.addEventListener('offline', () => {
  _updateModeSelectUI();
  _stopPresenceHeartbeat();
  _stopFriendsUiRefresh();
});

document.addEventListener('visibilitychange', () => {
  if (!_currentUser) return;
  if (document.hidden) {
    setPresence(_currentUser, 'offline').catch(() => {});
    return;
  }
  _updateMyPresence();
});

// ── Start button → show mode selection sheet ────────────────────────────────

function _updateModeSelectUI() {
  const vsBtn = _el('mode-vs-btn');
  const vsTag = _el('mode-vs-tag');
  if (!vsBtn || !vsTag) return;
  renderChallengeLeaderboards();
  const signedIn = !!_currentUser;
  const online = navigator.onLine;
  vsBtn.disabled = !signedIn || !online;
  if (!online) {
    vsTag.textContent = 'OFFLINE';
    vsTag.className = 'mode-card-tag mode-card-tag--locked';
  } else if (signedIn) {
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
  _syncPlayHudVisibility('endless');
  _syncNavForPage('play');
});

_el('mode-challenge-btn')?.addEventListener('click', () => {
  _el('mode-select-overlay').classList.add('hidden');
  _requestImmersiveMode();
  _setVisible(startScreen, false);
  _setVisible(mainApp, true);
  if (!game) game = new Game({ mode: 'challenge' });
  else if (game._mode !== 'challenge') game.restart({ mode: 'challenge' });
  Object.entries(PAGES).forEach(([key, el]) => el.classList.toggle('hidden', key !== 'play'));
  _currentPage = 'play';
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.page === 'play')
  );
  _syncPlayHudVisibility('challenge');
  _syncNavForPage('play');
});

// 1v1 VS mode
_el('mode-vs-btn').addEventListener('click', () => {
  if (!navigator.onLine) { showToast(t('noInternet')); return; }
  if (!_currentUser) { showToast(t('signInRequired')); return; }
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
  let _unsubChat = null;
  let _voiceStream = null;
  let _voicePeer = null;
  let _voiceRemoteAudio = null;
  let _voicePendingCandidates = [];
  let _voiceProcessedCandidateIds = new Set();
  let _lastOfferAt = 0;
  let _lastAnswerAt = 0;
  let _unsubVoiceSignal = null;
  let _unsubVoiceCandidates = null;
  let _voiceEnabled = false;
  const _dismissedVsRequestIds = new Set();

  const _overlay = () => _el('vs-overlay');
  const _screen  = id => _el(id);

  function _refreshVoiceButtonLabel() {
    const btn = _el('vs-voice-btn');
    if (!btn) return;
    const icon = btn.querySelector('.vs-menu-icon--mic');
    const label = _el('vs-voice-label');
    if (label) label.textContent = t('socialVoiceChat');
    if (!icon) return;
    icon.classList.toggle('is-muted', !_voiceEnabled);
  }

  function _getOrCreateRemoteAudio() {
    if (_voiceRemoteAudio) return _voiceRemoteAudio;
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    _voiceRemoteAudio = audio;
    return audio;
  }

  async function _ensureVoiceStream() {
    if (_voiceStream) return _voiceStream;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getAudioTracks().forEach(track => {
      track.enabled = _voiceEnabled;
    });
    _voiceStream = stream;
    return stream;
  }

  function _teardownVoicePeer() {
    if (_unsubVoiceSignal) {
      _unsubVoiceSignal();
      _unsubVoiceSignal = null;
    }
    if (_unsubVoiceCandidates) {
      _unsubVoiceCandidates();
      _unsubVoiceCandidates = null;
    }
    if (_voicePeer) {
      _voicePeer.onicecandidate = null;
      _voicePeer.ontrack = null;
      _voicePeer.onconnectionstatechange = null;
      _voicePeer.close();
      _voicePeer = null;
    }
    _voicePendingCandidates = [];
    _voiceProcessedCandidateIds = new Set();
    _lastOfferAt = 0;
    _lastAnswerAt = 0;
  }

  async function _flushPendingVoiceCandidates() {
    if (!_voicePeer?.remoteDescription) return;
    const pending = [..._voicePendingCandidates];
    _voicePendingCandidates = [];
    for (const cand of pending) {
      try {
        await _voicePeer.addIceCandidate(new RTCIceCandidate(cand));
      } catch {}
    }
  }

  async function _handleVoiceSignal(signal) {
    if (!_voicePeer || !_matchId || !_role || !signal) return;

    if (_role === 'guest' && signal.offer && Number(signal.offerAt || 0) > _lastOfferAt) {
      _lastOfferAt = Number(signal.offerAt || Date.now());
      await _voicePeer.setRemoteDescription(new RTCSessionDescription(signal.offer));
      const answer = await _voicePeer.createAnswer();
      await _voicePeer.setLocalDescription(answer);
      await publishVoiceAnswer(_matchId, answer);
      await _flushPendingVoiceCandidates();
    }

    if (_role === 'host' && signal.answer && Number(signal.answerAt || 0) > _lastAnswerAt) {
      _lastAnswerAt = Number(signal.answerAt || Date.now());
      await _voicePeer.setRemoteDescription(new RTCSessionDescription(signal.answer));
      await _flushPendingVoiceCandidates();
    }
  }

  async function _initVoiceTransport() {
    if (!_matchId || !_role || !navigator?.mediaDevices?.getUserMedia) return;

    _teardownVoicePeer();

    const peer = new RTCPeerConnection(VS_RTC_CONFIG);
    _voicePeer = peer;

    peer.ontrack = evt => {
      const [remoteStream] = evt.streams || [];
      if (!remoteStream) return;
      const audio = _getOrCreateRemoteAudio();
      audio.srcObject = remoteStream;
      audio.play?.().catch(() => {});
    };

    peer.onicecandidate = evt => {
      const candidate = evt.candidate?.toJSON?.() || null;
      if (!candidate || !_matchId || !_role) return;
      sendVoiceCandidate(_matchId, _role, candidate).catch(() => {});
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        showToast('Sesli sohbet baglantisi koptu.');
      }
    };

    try {
      const localStream = await _ensureVoiceStream();
      localStream.getAudioTracks().forEach(track => peer.addTrack(track, localStream));
    } catch {
      peer.addTransceiver('audio', { direction: 'recvonly' });
    }

    const remoteRole = _role === 'host' ? 'guest' : 'host';
    _unsubVoiceSignal = subscribeVoiceSignal(_matchId, signal => {
      _handleVoiceSignal(signal).catch(() => {});
    });
    _unsubVoiceCandidates = subscribeVoiceCandidates(_matchId, remoteRole, rows => {
      rows.forEach(row => {
        if (!row?.id || _voiceProcessedCandidateIds.has(row.id)) return;
        _voiceProcessedCandidateIds.add(row.id);
        if (_voicePeer?.remoteDescription) {
          _voicePeer.addIceCandidate(new RTCIceCandidate(row.candidate)).catch(() => {});
        } else {
          _voicePendingCandidates.push(row.candidate);
        }
      });
    });

    if (_role === 'host') {
      await clearVoiceSignal(_matchId).catch(() => {});
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await publishVoiceOffer(_matchId, offer);
    }
  }

  async function _setMicEnabled(enabled) {
    _voiceEnabled = !!enabled;
    try {
      const stream = await _ensureVoiceStream();
      stream.getAudioTracks().forEach(track => {
        track.enabled = _voiceEnabled;
      });
      if (_matchId && _role) {
        setVoiceMicState(_matchId, _role, _voiceEnabled).catch(() => {});
      }
      _refreshVoiceButtonLabel();
      showToast(_voiceEnabled ? t('socialMicOn') : t('socialMicOff'));
    } catch {
      _voiceEnabled = false;
      _refreshVoiceButtonLabel();
      showToast(t('socialMicDenied'));
    }
  }

  function _syncVsFriendRequestToast() {
    const toast = _el('vs-friend-request-toast');
    if (!toast) return;
    if (!_matchId || !game?._vsMode) {
      _setVisible(toast, false);
      return;
    }

    const oppUid = _getOpponentUid();
    if (!oppUid) {
      _setVisible(toast, false);
      return;
    }

    const req = _friendRequestRows.find(r => {
      if (!r || r.requesterUid !== oppUid) return false;
      if (_dismissedVsRequestIds.has(r.id)) return false;
      if (!r.requestMatchId) return true;
      return String(r.requestMatchId) === String(_matchId);
    });

    if (!req) {
      _setVisible(toast, false);
      return;
    }

    const nameEl = _el('vs-fr-name');
    if (nameEl) nameEl.textContent = `${req.requesterName || 'Rakip'} sana istek gonderdi`;
    toast.dataset.requestId = req.id;
    _setVisible(toast, true);
  }

  function _renderChatRows(rows = []) {
    const root = _el('vs-chat-messages');
    if (!root) return;
    const me = _currentUser?.uid;
    root.innerHTML = '';
    rows.forEach(row => {
      const line = document.createElement('div');
      line.className = `vs-chat-row${row.uid === me ? ' vs-chat-row--me' : ''}`;

      const author = document.createElement('div');
      author.className = 'vs-chat-author';
      author.textContent = row.uid === me ? 'SEN' : (row.name || 'Rakip');

      const text = document.createElement('div');
      text.className = 'vs-chat-text';
      text.textContent = row.text || '';

      line.append(author, text);
      root.appendChild(line);
    });
    root.scrollTop = root.scrollHeight;
  }

  function _startChatSubscription() {
    if (!_matchId) return;
    if (_unsubChat) {
      _unsubChat();
      _unsubChat = null;
    }
    _unsubChat = subscribeMatchChat(_matchId, rows => _renderChatRows(rows));
  }

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

  async function inviteFriend(friendRow) {
    if (!navigator.onLine) { showToast(t('noInternet')); return; }
    if (!_currentUser) { showToast(t('signInRequired')); return; }
    if (!friendRow?.uid) return;

    _overlay().classList.remove('hidden');
    _showScreen('vs-screen-waiting');
    _setWaitingScreen('private');

    try {
      _countdownStarted = false;
      _gameLaunched = false;
      if (_unsubMatch) { _unsubMatch(); _unsubMatch = null; }

      const result = await createMatch(_currentUser, {
        rankPoints: _getRankPoints(_currentUser.uid),
      });
      _matchId = result.matchId;
      _seed = result.seed;
      _role = 'host';

      _setWaitingScreen('private', result.inviteCode);
      _unsubMatch = subscribeMatch(_matchId, _onMatchSnapshot);

      await sendVsInvite(_currentUser, {
        targetUid: friendRow.uid,
        matchId: _matchId,
        inviteCode: result.inviteCode,
      });
      showToast('VS daveti gonderildi.');
    } catch (err) {
      showToast(String(err?.message || err));
      _showScreen('vs-screen-choose');
    }
  }

  async function acceptInviteCode(code) {
    const inviteCode = String(code || '').trim().toUpperCase();
    if (inviteCode.length < 6) {
      showToast('Davet kodu gecersiz.');
      return;
    }
    if (!navigator.onLine) { showToast(t('noInternet')); return; }
    if (!_currentUser) { showToast(t('signInRequired')); return; }

    _overlay().classList.remove('hidden');
    _showScreen('vs-screen-countdown');
    _el('vs-countdown-num').textContent = '...';

    try {
      _countdownStarted = false;
      _gameLaunched = false;
      if (_unsubMatch) { _unsubMatch(); _unsubMatch = null; }

      const result = await joinMatchByCode(inviteCode, _currentUser, _getRankPoints(_currentUser.uid));
      _matchId = result.matchId;
      _seed = result.seed;
      _role = 'guest';
      _unsubMatch = subscribeMatch(_matchId, _onMatchSnapshot);
    } catch (err) {
      showToast('Hata: ' + (err.message || String(err)));
      _showScreen('vs-screen-choose');
    }
  }

  function openLobby() {
    if (!navigator.onLine) { showToast(t('noInternet')); return; }
    if (!_currentUser) { showToast(t('signInRequired')); return; }
    _showScreen('vs-screen-choose');
    _overlay().classList.remove('hidden');
    _el('vs-code-input').value = '';
    _setWaitingScreen('private');
    _voiceEnabled = false;
    if (_voiceStream) {
      _voiceStream.getAudioTracks().forEach(track => { track.enabled = false; });
    }
    _dismissedVsRequestIds.clear();
    _refreshVoiceButtonLabel();
    _setVisible(_el('vs-chat-panel'), false);
    _setVisible(_el('vs-friend-request-toast'), false);
  }

  function _closeLobby() {
    _overlay().classList.add('hidden');
    _stopSync();
  }

  function _stopSync() {
    if (_matchId && _role) {
      setVoiceMicState(_matchId, _role, false).catch(() => {});
    }
    _teardownVoicePeer();
    if (_unsubMatch) { _unsubMatch(); _unsubMatch = null; }
    if (_unsubChat) { _unsubChat(); _unsubChat = null; }
    clearInterval(_syncInterval); _syncInterval = null;
    _countdownStarted = false;
    _gameLaunched = false;
    _finishRequested = false;
    _myLiveScore = 0;
    _oppLiveScore = 0;
    _voiceEnabled = false;
    _dismissedVsRequestIds.clear();
    if (_voiceStream) {
      _voiceStream.getTracks().forEach(tr => tr.stop());
      _voiceStream = null;
    }
    if (_voiceRemoteAudio) {
      _voiceRemoteAudio.srcObject = null;
    }
    _refreshVoiceButtonLabel();
    _setVisible(_el('vs-chat-panel'), false);
    _setVisible(_el('vs-menu-panel'), false);
    _setVisible(_el('vs-friend-request-toast'), false);
    _renderChatRows([]);
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

  function _isTimedOut(state, now, activeAt) {
    if (!state || state.gameOver) return false;
    if (!activeAt) return false;
    if ((now - activeAt) < VS_MOVE_TIMEOUT_MS) return false;
    const lastMoveAt = Number(state.lastMoveAt ?? 0);
    const anchor = Math.max(activeAt, lastMoveAt || 0);
    return now - anchor > VS_MOVE_TIMEOUT_MS;
  }

  function _deriveWinner(data) {
    const hostState = data?.hostState;
    const guestState = data?.guestState;
    if (!hostState || !guestState) return null;
    const activeAt = Number(data?.activeAt ?? 0);
    if (!activeAt || (Date.now() - activeAt) < VS_START_GRACE_MS) return null;

    const hostUid = data?.host?.uid;
    const guestUid = data?.guest?.uid;
    const hostScore = Number(hostState.score ?? 0);
    const guestScore = Number(guestState.score ?? 0);

    const now = Date.now();
    const hostTimedOut = _isTimedOut(hostState, now, activeAt);
    const guestTimedOut = _isTimedOut(guestState, now, activeAt);
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
    _syncVsFriendRequestToast();
    _startChatSubscription();
    _initVoiceTransport().catch(() => {});
    _el('vs-chat-input').value = '';
    _updateMyPresence();

    // Mark match as active so both players know it started
    if (_matchId) {
      const activeAt = Date.now();
      getFirebaseServices().then(s =>
        s.updateDoc(s.doc(s.db, 'matches', _matchId), {
          status: 'active',
          activeAt,
          'hostState.lastMoveAt': activeAt,
          'hostState.updatedAt': activeAt,
          'guestState.lastMoveAt': activeAt,
          'guestState.updatedAt': activeAt,
        })
      ).catch(() => {});
    }

    _lastLocalMoveAt = Date.now();
    _syncMyState({ gameOver: false, loseReason: null });

    // Start syncing my state rapidly for near realtime opponent tracking
    _syncInterval = setInterval(() => {
      if (!game || !_matchId) return;
      if (!game._isGameOver && (Date.now() - _lastLocalMoveAt) > VS_MOVE_TIMEOUT_MS) {
        game._gameOver({ reason: 'no_moves' });
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
      if (_currentUser) upsertUserProfile(_currentUser, { rankPoints: next }).catch(() => {});
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
    _setVisible(_el('vs-menu-toggle-btn'), false);
    _setVisible(_el('vs-menu-panel'), false);
    _setVisible(_el('vs-chat-panel'), false);
    document.body.classList.remove('vs-active');
    _setVisible(mainApp, false);
    _setVisible(startScreen, true);
    _updateStartScreen();
    if (game) { game._vsMode = false; game._isGameOver = false; }
    _updateMyPresence();
  }

  // ── Listeners ──────────────────────────────────────────────────────────────

  // Back button on choose screen
  _el('vs-back-btn').addEventListener('click', () => _closeLobby());

  // Quick match
  _el('vs-quick-btn').addEventListener('click', async () => {
    if (!navigator.onLine) { showToast(t('noInternet')); return; }
    if (!_currentUser) { showToast(t('signInRequired')); return; }
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
    if (!navigator.onLine) { showToast(t('noInternet')); return; }
    if (!_currentUser) { showToast(t('signInRequired')); return; }
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
    _el('vs-join-btn').disabled = true;
    await acceptInviteCode(code);
    _el('vs-join-btn').disabled = false;
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

  _el('vs-add-friend-btn')?.addEventListener('click', async () => {
    _setVisible(_el('vs-menu-panel'), false);
    if (!_currentUser) return;
    const oppUid = _getOpponentUid();
    if (!oppUid) {
      const email = window.prompt(t('socialEnterEmail'));
      if (!email) return;
      if (!email.includes('@')) { showToast(t('socialInvalidEmail')); return; }
      try {
        await sendFriendRequestByEmail(_currentUser, email);
        showToast(t('socialFriendRequestSent'));
      } catch (err) {
        showToast(String(err?.message || err));
      }
      return;
    }
    try {
      await sendFriendRequest(_currentUser, oppUid, { matchId: _matchId });
      showToast(t('socialFriendRequestSent'));
    } catch (err) {
      showToast(String(err?.message || err));
    }
  });

  async function _respondVsFriendRequest(action) {
    const toast = _el('vs-friend-request-toast');
    const requestId = toast?.dataset?.requestId;
    if (!requestId || !_currentUser) return;
    try {
      await respondFriendRequest(_currentUser, requestId, action, { matchId: _matchId });
      _dismissedVsRequestIds.add(requestId);
      _setVisible(toast, false);
      if (action === 'accept') {
        showToast('Arkadaslik istegi kabul edildi.');
      } else {
        showToast('Istek reddedildi. Bu maca ozel tekrar gonderilemez.');
      }
    } catch (err) {
      showToast(String(err?.message || err));
    }
  }

  _el('vs-fr-accept-btn')?.addEventListener('click', () => {
    _respondVsFriendRequest('accept');
  });

  _el('vs-fr-reject-btn')?.addEventListener('click', () => {
    _respondVsFriendRequest('reject');
  });

  _el('vs-voice-btn')?.addEventListener('click', async () => {
    _setVisible(_el('vs-menu-panel'), false);
    await _setMicEnabled(!_voiceEnabled);
  });

  _el('vs-report-btn')?.addEventListener('click', async () => {
    _setVisible(_el('vs-menu-panel'), false);
    const reportedUid = _getOpponentUid();
    if (!_matchId || !_currentUser?.uid || !reportedUid) return;
    const reason = window.prompt('Report reason (abuse, cheating, spam, other)') || 'other';
    const details = window.prompt('Optional details') || '';
    try {
      await submitPlayerReport({
        matchId: _matchId,
        reporterUid: _currentUser.uid,
        reportedUid,
        reason,
        details,
      });
      showToast(t('socialReportSent'));
    } catch (err) {
      showToast(String(err?.message || err));
    }
  });

  _el('vs-surrender-btn')?.addEventListener('click', async () => {
    _setVisible(_el('vs-menu-panel'), false);
    const opponentUid = _getOpponentUid();
    if (!_matchId || !_currentUser?.uid || !opponentUid) return;
    if (!window.confirm('Teslim olmak istiyor musun?')) return;

    _myFinalScore = game?.scoreSystem?.score ?? 0;
    _showLocalLoseImmediate(_myFinalScore);

    try {
      _finishRequested = true;
      await finishMatch(_matchId, opponentUid);
      showToast('Teslim oldun.');
    } catch (err) {
      _finishRequested = false;
      showToast(String(err?.message || err));
    }
  });

  _el('vs-menu-toggle-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const panel = _el('vs-menu-panel');
    if (!panel) return;
    panel.classList.toggle('hidden');
  });

  document.addEventListener('pointerdown', e => {
    const panel = _el('vs-menu-panel');
    const toggle = _el('vs-menu-toggle-btn');
    if (!panel || panel.classList.contains('hidden')) return;
    if (panel.contains(e.target) || toggle?.contains(e.target)) return;
    panel.classList.add('hidden');
  });

  const _sendVsChat = async () => {
    if (!_matchId || !_currentUser) return;
    const input = _el('vs-chat-input');
    const text = input?.value?.trim();
    if (!text) return;
    input.value = '';
    try {
      await sendMatchChatMessage(_matchId, _currentUser, text);
    } catch (err) {
      showToast(String(err?.message || err));
    }
  };

  _el('vs-chat-send-btn')?.addEventListener('click', _sendVsChat);
  _el('vs-chat-input')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    _sendVsChat();
  });

  function markLocalMove() {
    _lastLocalMoveAt = Date.now();
    _syncMyState({ gameOver: false, loseReason: null });
  }

  function updateMyLiveScore(score) {
    _myLiveScore = Number(score ?? 0);
    _updateDominanceBar();
  }

  function onFriendRequestsChanged() {
    _syncVsFriendRequestToast();
  }

  return {
    openLobby,
    reportGameOver,
    markLocalMove,
    updateMyLiveScore,
    onFriendRequestsChanged,
    inviteFriend,
    acceptInviteCode,
  };
})();

_el('vs-invite-accept-btn')?.addEventListener('click', async () => {
  const invite = _incomingVsInvites[0];
  if (!invite || !_currentUser) return;
  try {
    await respondVsInvite(_currentUser, invite.id, 'accept');
    _incomingVsInvites = _incomingVsInvites.filter(r => r.id !== invite.id);
    _renderVsInviteNotice();
    await vsSession.acceptInviteCode(invite.inviteCode);
  } catch (err) {
    showToast(String(err?.message || err));
  }
});

_el('vs-invite-reject-btn')?.addEventListener('click', async () => {
  const invite = _incomingVsInvites[0];
  if (!invite || !_currentUser) return;
  try {
    await respondVsInvite(_currentUser, invite.id, 'reject');
    _incomingVsInvites = _incomingVsInvites.filter(r => r.id !== invite.id);
    _renderVsInviteNotice();
    showToast('VS daveti reddedildi.');
  } catch (err) {
    showToast(String(err?.message || err));
  }
});

// ── Settings button ───────────────────────────────────────────────────────────

_el('ss-settings-btn').addEventListener('click', () => {
  _settingsReturnTarget = 'start';
  showPage('settings');
  _setVisible(startScreen, false);
  _setVisible(mainApp, true);
});

_el('settings-back-btn')?.addEventListener('click', () => {
  if (_settingsReturnTarget === 'start') {
    _setVisible(mainApp, false);
    _setVisible(startScreen, true);
    _updateStartScreen();
    _syncNavForPage('play');
    return;
  }
  showPage(_settingsReturnTarget || 'play');
});

// ── Restart ───────────────────────────────────────────────────────────────────

_el('restart-btn').addEventListener('click', () => {
  _requestImmersiveMode();
  overlayEl.classList.add('hidden');
  game.restart();
  showPage('play');
  _syncPlayHudVisibility(game?._mode);
});

_el('gameover-menu-btn')?.addEventListener('click', () => {
  overlayEl.classList.add('hidden');
  if (game?._isGameOver) {
    game.restart({ mode: game._mode });
  }
  _setVisible(mainApp, false);
  _setVisible(startScreen, true);
  _updateStartScreen();
  _syncNavForPage('play');
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

function _pickProfileAvatar(user, profileDoc = null) {
  const uid = user?.uid;
  const googlePhoto = _avatarUrl(user?.photoURL || '');
  const cached = _readLocalAvatar(uid);
  const docPhoto = _avatarUrl(profileDoc?.photoURL || '');

  if (cached?.googlePhoto && googlePhoto && cached.googlePhoto !== googlePhoto) {
    const next = { ...cached, googlePhoto, updatedAt: Date.now() };
    if (cached.source === 'google') next.value = googlePhoto;
    _writeLocalAvatar(uid, next);
    return next.value || googlePhoto || docPhoto;
  }

  if (cached?.value) return cached.value;
  if (docPhoto) return docPhoto;
  return googlePhoto;
}

async function _banCurrentUser(reason = 'unsafe_avatar') {
  if (!_currentUser?.uid) return;
  const uid = _currentUser.uid;
  localStorage.setItem(_blockKey(uid), '1');
  await updateUserProfile(uid, {
    accountBlocked: true,
    blockReason: reason,
    blockedAt: Date.now(),
  }).catch(() => {});
  showToast('Hesap guvenlik nedeniyle engellendi.');
  await googleSignOut().catch(() => {});
}

async function _loadUserDoc(uid) {
  if (!uid) return null;
  const s = await getFirebaseServices();
  const snap = await s.getDoc(s.doc(s.db, 'users', uid));
  return snap.exists() ? (snap.data() || null) : null;
}

async function _autofillLocation() {
  if (!profileLocationStatusEl) return;
  if (!navigator?.geolocation) {
    profileLocationStatusEl.textContent = 'Konum desteklenmiyor.';
    return;
  }

  profileLocationStatusEl.textContent = 'Konum aliniyor...';
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = Number(pos.coords?.latitude || 0);
    const lng = Number(pos.coords?.longitude || 0);
    const text = await _reverseGeocode(lat, lng);
    if (profileLocationInputEl) profileLocationInputEl.value = text;
    _profileLocationGeo = { lat, lng, source: 'gps' };
    profileLocationStatusEl.textContent = 'Konum otomatik dolduruldu.';
  }, () => {
    _profileLocationGeo = null;
    profileLocationStatusEl.textContent = 'Izin verilmedi, elle girilebilir.';
  }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
}

async function _fetchLocationSuggestions(queryText) {
  const q = String(queryText || '').trim();
  if (q.length < 2) return [];
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.map(r => ({
      text: String(r.display_name || '').slice(0, 120),
      lat: Number(r.lat || 0),
      lng: Number(r.lon || 0),
    })).filter(r => r.text);
  } catch {
    return [];
  }
}

function _renderLocationSuggestions(rows = []) {
  if (!profileLocationSuggestionsEl) return;
  profileLocationSuggestionsEl.innerHTML = '';
  rows.forEach(row => {
    const option = document.createElement('option');
    option.value = row.text;
    option.dataset.lat = String(row.lat || 0);
    option.dataset.lng = String(row.lng || 0);
    profileLocationSuggestionsEl.appendChild(option);
  });
}

async function _resolveLocationGeo(locationText) {
  const text = String(locationText || '').trim();
  if (!text) return null;
  const options = [...(profileLocationSuggestionsEl?.options || [])];
  const picked = options.find(o => o.value === text);
  if (picked) {
    return {
      lat: Number(picked.dataset.lat || 0),
      lng: Number(picked.dataset.lng || 0),
      source: 'suggestion',
    };
  }

  const rows = await _fetchLocationSuggestions(text);
  const top = rows[0];
  if (!top) return null;
  return { lat: top.lat, lng: top.lng, source: 'search' };
}

function _renderAvatarHistoryOptions() {
  if (!profileAvatarHistoryEl || !_currentUser?.uid) return;
  const rows = _readAvatarHistory(_currentUser.uid);
  profileAvatarHistoryEl.innerHTML = '';
  rows.forEach(value => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'profile-avatar-history-btn';
    btn.title = 'Kayitli avatar';
    const img = document.createElement('img');
    img.src = value;
    img.alt = 'Kayitli avatar';
    btn.appendChild(img);
    btn.onclick = () => {
      _profileAvatarDraft = { source: 'history', value };
      if (profileAvatarPreviewEl) profileAvatarPreviewEl.src = value;
      _setProfileError('');
    };
    profileAvatarHistoryEl.appendChild(btn);
  });
}

async function _handleAvatarUpload(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    _setProfileError('Sadece gorsel dosya yuklenebilir.');
    return;
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  }).catch(() => '');

  if (!dataUrl) {
    _setProfileError('Fotograf okunamadi.');
    return;
  }

  const moderation = await _runAvatarModeration({ fileName: file.name, dataUrl });
  if (!moderation.safe) {
    await _banCurrentUser(moderation.reason || 'unsafe_avatar');
    return;
  }

  _profileAvatarDraft = { source: 'upload', value: dataUrl };
  _pushAvatarHistory(_currentUser?.uid, dataUrl);
  if (profileAvatarPreviewEl) profileAvatarPreviewEl.src = dataUrl;
  _renderAvatarHistoryOptions();
  _setProfileError('');
}

async function _openProfileSetup({ force = false } = {}) {
  if (!_currentUser?.uid || !profileSetupOverlayEl) return;
  const uid = _currentUser.uid;
  const profileDoc = await _loadUserDoc(uid).catch(() => null);
  _profileDocCache = profileDoc;
  if (profileDoc?.accountBlocked || localStorage.getItem(_blockKey(uid)) === '1') {
    await _banCurrentUser(profileDoc?.blockReason || 'blocked');
    return;
  }

  const done = localStorage.getItem(_profileSetupDoneKey(uid)) === '1';
  if (!force && done && _isProfileComplete(profileDoc || {})) return;

  const cachedAvatar = _readLocalAvatar(uid);
  const avatar = _pickProfileAvatar(_currentUser, profileDoc || {});
  _profileAvatarDraft = avatar ? { source: cachedAvatar?.source || 'google', value: avatar } : null;

  if (profileDisplayNameInputEl) profileDisplayNameInputEl.value = profileDoc?.displayName || _currentUser.displayName || '';
  if (profileBirthDateInputEl) profileBirthDateInputEl.value = profileDoc?.birthDate || '';
  if (profileGenderSelectEl) profileGenderSelectEl.value = profileDoc?.gender || '';
  if (profileLocationInputEl) profileLocationInputEl.value = profileDoc?.locationText || '';
  _profileLocationGeo = profileDoc?.locationGeo || null;
  if (profileAvatarPreviewEl) profileAvatarPreviewEl.src = avatar || '';
  if (profileLocationStatusEl) profileLocationStatusEl.textContent = '';
  _setProfileError('');
  _renderAvatarHistoryOptions();

  _setVisible(profileSetupOverlayEl, true);
}

async function _saveProfileSetup() {
  if (!_currentUser?.uid) return;
  const uid = _currentUser.uid;
  const displayName = String(profileDisplayNameInputEl?.value || '').trim();
  const birthDate = String(profileBirthDateInputEl?.value || '').trim();
  const gender = String(profileGenderSelectEl?.value || '').trim();
  const locationText = String(profileLocationInputEl?.value || '').trim();

  if (!displayName) return _setProfileError('Gorunen ad zorunludur.');
  if (!birthDate) return _setProfileError('Dogum tarihi zorunludur.');
  if (!gender) return _setProfileError('Cinsiyet seciniz.');

  if (locationText && !_profileLocationGeo) {
    _profileLocationGeo = await _resolveLocationGeo(locationText);
  }

  const avatar = _profileAvatarDraft?.value || _pickProfileAvatar(_currentUser, _profileDocCache || {}) || '';
  const googlePhoto = _avatarUrl(_currentUser.photoURL || '');
  const avatarSource = _profileAvatarDraft?.source || 'google';

  await updateUserProfile(uid, {
    displayName,
    birthDate,
    gender,
    locationText: locationText || null,
    locationGeo: _profileLocationGeo || null,
    profileCompleted: true,
    photoURL: avatar || null,
    avatarSource,
    googlePhotoURL: googlePhoto || null,
  });

  _writeLocalAvatar(uid, {
    source: avatarSource,
    value: avatar,
    googlePhoto,
    updatedAt: Date.now(),
  });
  _pushAvatarHistory(uid, avatar);

  localStorage.setItem(_profileSetupDoneKey(uid), '1');
  _setVisible(profileSetupOverlayEl, false);

  const patchedUser = {
    ..._currentUser,
    displayName,
    photoURL: avatar || _currentUser.photoURL,
  };
  _applyAuthUI(patchedUser);
  _renderFriendsPanel();
}

/** Sync all UI elements that reflect sign-in state. */
function _applyAuthUI(user) {
  _currentUser = user;
  const signedIn = !!user;
  if (!signedIn) {
    // Legacy guest rank key cleanup: guests no longer have rank.
    localStorage.removeItem(RANK_KEY_PREFIX);
  }
  _setVisible(friendsBtn, signedIn);
  if (!signedIn) _setVisible(friendsPanel, false);

  // Start screen
  _setVisible(_el('ss-profile'),    signedIn);
  _setVisible(_el('ss-signin-btn'), !signedIn);
  if (signedIn) {
    const avatar = _pickProfileAvatar(user, _profileDocCache || {});
    _el('ss-avatar').src              = avatar || _avatarUrl(user.photoURL);
    _el('ss-username').textContent    = (_profileDocCache?.displayName || user.displayName || user.email || 'Player');
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
    const avatar = _pickProfileAvatar(user, _profileDocCache || {});
    _el('settings-avatar').src              = avatar || _avatarUrl(user.photoURL);
    _el('settings-username').textContent    = (_profileDocCache?.displayName || user.displayName || '');
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
    if (_currentUser) await setPresence(_currentUser, 'offline').catch(() => {});
    await googleSignOut();
  } catch (err) {
    _applyAuthUI(null);
  } finally {
    if (startBtn) startBtn.disabled = false;
    if (settingsBtn) settingsBtn.disabled = false;
  }
}

window.addEventListener('beforeunload', () => {
  if (_currentUser) setPresence(_currentUser, 'offline').catch(() => {});
});

_el('ss-signin-btn').addEventListener('click', _handleSignIn);
_el('ss-signout-btn').addEventListener('click', _handleSignOut);
_el('settings-edit-profile-btn')?.addEventListener('click', () => {
  _openProfileSetup({ force: true }).catch(() => {});
});
_el('profile-setup-save-btn')?.addEventListener('click', () => {
  _saveProfileSetup().catch(err => _setProfileError(String(err?.message || err)));
});
_el('profile-detect-location-btn')?.addEventListener('click', () => {
  _autofillLocation();
});
profileLocationInputEl?.addEventListener('input', () => {
  _profileLocationGeo = null;
  const q = String(profileLocationInputEl.value || '').trim();
  if (profileLocationStatusEl) profileLocationStatusEl.textContent = '';
  if (_locationSuggestTimer) clearTimeout(_locationSuggestTimer);
  _locationSuggestTimer = setTimeout(async () => {
    const rows = await _fetchLocationSuggestions(q);
    _renderLocationSuggestions(rows);
  }, 260);
});
profileLocationInputEl?.addEventListener('change', async () => {
  const text = String(profileLocationInputEl.value || '').trim();
  if (!text) {
    _profileLocationGeo = null;
    return;
  }
  _profileLocationGeo = await _resolveLocationGeo(text);
});
profileAvatarGoogleBtnEl?.addEventListener('click', () => {
  const google = _avatarUrl(_currentUser?.photoURL || '');
  if (!google) {
    _setProfileError('Google avatar bulunamadi.');
    return;
  }
  _profileAvatarDraft = { source: 'google', value: google };
  if (profileAvatarPreviewEl) profileAvatarPreviewEl.src = google;
  _setProfileError('');
});
profileAvatarUploadInputEl?.addEventListener('change', e => {
  const file = e.target?.files?.[0];
  _handleAvatarUpload(file).catch(() => _setProfileError('Fotograf islenemedi.'));
  e.target.value = '';
});
document.querySelectorAll('.profile-avatar-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = String(btn.dataset.avatar || '').trim();
    if (!emoji) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="100%" height="100%" rx="36" fill="#0f172a"/><text x="50%" y="58%" font-size="148" text-anchor="middle">${emoji}</text></svg>`;
    const data = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    _profileAvatarDraft = { source: 'preset', value: data };
    if (profileAvatarPreviewEl) profileAvatarPreviewEl.src = data;
    _setProfileError('');
  });
});

// Auth state listener
let _lastAuthUid = null;
onAuthChange(async user => {
  const prevUid = _lastAuthUid;
  _lastAuthUid = user?.uid ?? null;
  _applyAuthUI(user);
  _updateModeSelectUI();

  if (user && !prevUid) _captureGuestSnapshot();
  if (!user && prevUid) {
    _restoreGuestSnapshot();
    if (_unsubFriends) { _unsubFriends(); _unsubFriends = null; }
    if (_unsubFriendRequests) { _unsubFriendRequests(); _unsubFriendRequests = null; }
    if (_unsubVsInvites) { _unsubVsInvites(); _unsubVsInvites = null; }
    _friendsRows = [];
    _friendRequestRows = [];
    _incomingVsInvites = [];
    _profileDocCache = null;
    _setVisible(profileSetupOverlayEl, false);
    _closeFriendChat();
    _renderFriendsPanel();
    _renderVsInviteNotice();
    _stopPresenceHeartbeat();
    _stopFriendsUiRefresh();
    return;
  }

  if (user) {
    _profileDocCache = await _loadUserDoc(user.uid).catch(() => null);
    if (_profileDocCache?.accountBlocked || localStorage.getItem(_blockKey(user.uid)) === '1') {
      await _banCurrentUser(_profileDocCache?.blockReason || 'blocked');
      return;
    }

    const googlePhoto = _avatarUrl(user.photoURL || '');
    const avatarCache = _readLocalAvatar(user.uid);
    if (!avatarCache) {
      _writeLocalAvatar(user.uid, {
        source: 'google',
        value: googlePhoto,
        googlePhoto,
        updatedAt: Date.now(),
      });
    } else if (avatarCache.googlePhoto !== googlePhoto) {
      const next = { ...avatarCache, googlePhoto, updatedAt: Date.now() };
      if (avatarCache.source === 'google') next.value = googlePhoto;
      _writeLocalAvatar(user.uid, next);
      if (avatarCache.source === 'google') {
        await updateUserProfile(user.uid, { photoURL: googlePhoto || null, googlePhotoURL: googlePhoto || null }).catch(() => {});
      }
    }

    _applyAuthUI(user);

    if (_unsubFriends) _unsubFriends();
    if (_unsubFriendRequests) _unsubFriendRequests();
    if (_unsubVsInvites) _unsubVsInvites();
    if (navigator.onLine) {
      _unsubFriends = subscribeFriends(user, rows => {
        _friendsRows = rows;
        _renderFriendsPanel();
      });
      _unsubFriendRequests = subscribeFriendRequests(user, rows => {
        _friendRequestRows = rows;
        _renderFriendsPanel();
        vsSession.onFriendRequestsChanged();
      });
      _unsubVsInvites = subscribeIncomingVsInvites(user, rows => {
        _incomingVsInvites = rows;
        _renderVsInviteNotice();
      });
      _updateMyPresence();
      _startPresenceHeartbeat();
      _startFriendsUiRefresh();
    }
    upsertUserProfile(user, {
      rankPoints: _getRankPoints(user.uid),
      photoURL: _pickProfileAvatar(user, _profileDocCache || {}),
    }).catch(() => {});
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

      _profileDocCache = await _loadUserDoc(user.uid).catch(() => _profileDocCache);
      _applyAuthUI(user);
      await _openProfileSetup({ force: false });
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
          setTimeout(() => game._gameOver({ reason: 'no_moves' }), 400);
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
  const puName = t(pu.nameKey || pu.id);
  const puDesc = t(pu.descKey || `${pu.id}_desc`);
  const item = document.createElement('div');
  item.className = 'market-item';

  const icon = document.createElement('div');
  icon.className = 'market-item-icon'; icon.textContent = pu.icon;

  const info = document.createElement('div');
  info.className = 'market-item-info';
  info.innerHTML = `<div class="market-item-name">${puName}</div><div class="market-item-desc">${puDesc}</div>`;

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
    showToast(`${t('got')} ${puName}!`);
  });

  const useBtn = document.createElement('button');
  useBtn.className = 'market-use-btn';
  useBtn.textContent = t('use');
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
    this._challengeMode = mode === 'challenge';
    this._challengeLevel = 1;
    this._mementoHistory = [];
    this._mementoLimit = 24;

    this._tutorial = {
      active: mode === 'endless' && localStorage.getItem(TUTORIAL_KEY) !== '1',
      step: 0,
      target: null,
      expectedShape: '',
      expectedColor: 0,
      expectedClear: 'place',
    };
    this._rotateMode = {
      active: false,
      selectedIdx: -1,
    };

    // UI refs
    this.scoreEl = _el('score-display');
    this.bestEl  = _el('best-display');
    this.comboEl = _el('combo-display');
    this.gameContainerEl = _el('game-container');

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
    if (tutorialSkipBtn) {
      tutorialSkipBtn.onclick = () => this._skipTutorial();
    }

    // Handle orientation / resize
    window.addEventListener('resize', () => this._handleResize());

    if (this._challengeMode) this._startChallengeLevel(1);
    else if (this._tutorial.active) this._startTutorial();
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

  _createMemento() {
    const filled = [];
    for (let r = 0; r < Grid.SIZE; r++) {
      for (let c = 0; c < Grid.SIZE; c++) {
        const cell = this.grid.get(r, c);
        if (!cell || cell.isEmpty) continue;
        filled.push({ row: r, col: c, colorID: cell.colorID, blockID: cell.blockID });
      }
    }
    return {
      filled,
      tray: this.tray.map(b => {
        if (!b) return null;
        return {
          id: b.id,
          shapeKey: b.shapeKey,
          colorID: b.colorID,
          cells: b.cells.map(([r, c]) => [r, c]),
          size: b.size,
        };
      }),
      usedMask: [...this.usedMask],
      placements: this.placements,
      coinMilestone: this._coinMilestone,
      score: this.scoreSystem.score,
      combo: this.scoreSystem.comboMultiplier,
      colorCap: this._colorCap,
      challengeLevel: this._challengeLevel,
    };
  }

  _restoreMemento(m) {
    if (!m) return;
    this.grid.reset();
    for (const p of m.filled) {
      this.grid.fill(p.row, p.col, p.colorID, p.blockID || 'undo');
    }
    const dirty = this.grid.drainDirty();
    this.grid._emit(dirty);

    this.tray = (m.tray || []).map(item => {
      if (!item) return null;
      if (!item.shapeKey.endsWith('_rot')) return new Block(item.shapeKey, item.colorID);
      return _makeRotatedBlock(new Block('DOT', item.colorID), item.cells);
    });
    this.usedMask = [...(m.usedMask || [])];
    this.placements = Number(m.placements || 0);
    this._coinMilestone = Number(m.coinMilestone || 0);
    this._colorCap = Number(m.colorCap || this._colorCap);
    this._challengeLevel = Number(m.challengeLevel || this._challengeLevel || 1);
    this.scoreSystem.score = Number(m.score || 0);
    this.scoreSystem.comboMultiplier = Number(m.combo || 1);
    this.scoreSystem._emit();
    this._renderTray();
    this.renderer._drawGrid();
  }

  _pushMemento() {
    this._mementoHistory.push(this._createMemento());
    if (this._mementoHistory.length > this._mementoLimit)
      this._mementoHistory.shift();
  }

  _startChallengeLevel(level = 1, { preserveProgress = false } = {}) {
    this._challengeMode = true;
    this._challengeLevel = Math.max(1, Number(level || 1));
    this._mementoHistory = [];
    this.grid.reset();
    if (!preserveProgress) {
      this.scoreSystem.reset();
      this._coinMilestone = 0;
    }
    this.placements = 0;
    const seed = Number(localStorage.getItem(CHALLENGE_SEED_KEY) || Date.now());
    localStorage.setItem(CHALLENGE_SEED_KEY, String(seed + this._challengeLevel * 7919));
    const rnd = () => {
      const x = Math.sin((seed + this._challengeLevel * 97 + this.placements) * 0.00091) * 10000;
      return x - Math.floor(x);
    };
    const density = Math.min(0.22 + this._challengeLevel * 0.04, 0.52);
    const fillCount = Math.floor(Grid.SIZE * Grid.SIZE * density);
    for (let i = 0; i < fillCount; i++) {
      const row = Math.floor(rnd() * Grid.SIZE);
      const col = Math.floor(rnd() * Grid.SIZE);
      if (!this.grid.isEmpty(row, col)) continue;
      const colorID = 1 + Math.floor(rnd() * Math.min(8, this._colorCap + 1));
      this.grid.fill(row, col, colorID, `challenge_seed_${this._challengeLevel}`);
    }
    const dirty = this.grid.drainDirty();
    this.grid._emit(dirty);
    this._dealTray();
    showToast(`Meydan Okuma Seviye ${this._challengeLevel}`);
  }

  _updateColorCap(score) {
    const nextCap = _colorCapForScore(score);
    if (nextCap <= this._colorCap) return;
    this._colorCap = nextCap;
    showToast(`Yeni renk açıldı! Artık ${nextCap} renk aktif.`);
  }

  _setTutorialUI(step, text) {
    _setVisible(tutorialOverlay, true);
    if (tutorialStepEl) tutorialStepEl.textContent = `EGITICI ${step}/${TUTORIAL_TOTAL_STEPS}`;
    if (text) {
      let descEl = _el('tutorial-desc');
      if (!descEl) {
        descEl = document.createElement('div');
        descEl.id = 'tutorial-desc';
        const card = _el('tutorial-card');
        if (card) card.appendChild(descEl);
      }
      descEl.textContent = text;
    }
    this._renderTutorialProgress(step);
  }

  _renderTutorialProgress(step) {
    if (!tutorialProgressEl) return;
    if (!tutorialProgressEl.childElementCount) {
      for (let i = 1; i <= TUTORIAL_TOTAL_STEPS; i++) {
        const dot = document.createElement('span');
        dot.className = 'tutorial-dot';
        tutorialProgressEl.appendChild(dot);
      }
    }
    [...tutorialProgressEl.children].forEach((el, idx) => {
      el.classList.toggle('active', idx + 1 <= step);
    });
  }

  _animateTutorialStepTransition() {
    const card = _el('tutorial-card');
    if (!card) return;
    card.classList.remove('step-transition');
    void card.offsetWidth;
    card.classList.add('step-transition');
    setTimeout(() => card.classList.remove('step-transition'), 560);
    if (tutorialStepAnimEl) {
      tutorialStepAnimEl.classList.remove('run');
      void tutorialStepAnimEl.offsetWidth;
    }
  }

  _startTutorial() {
    setSkipFileSfx(true);
    document.body.classList.add('tutorial-focus');
    this.grid.reset();
    this.scoreSystem.reset();
    this.particles._particles = [];
    this.placements = 0;
    this._challengeMode = false;
    this._tutorial.active = true;
    this._setupTutorialStep1();
  }

  _setupTutorialStep1() {
    this._tutorial.step = 1;
    this._tutorial.target = { row: 7, col: 0 };
    this._tutorial.expectedShape = 'DOT';
    this._tutorial.expectedColor = 1;
    this._tutorial.expectedClear = 'place';
    this._setTutorialUI(1, 'Küçük bloğu kırmızı kutuya sürükle ve bırak');

    this.grid.reset();
    this.tray = [new Block('DOT', 1), null, null, null];
    this.usedMask = [false, true, true, true];
    _el('tray').classList.add('tutorial-mode');
    this._renderTray();
  }

  _setupTutorialStep2() {
    this._tutorial.step = 2;
    this._tutorial.target = { row: 3, col: 3 };
    this._tutorial.expectedShape = 'DOT';
    this._tutorial.expectedColor = 1;
    this._tutorial.expectedClear = 'cluster10';
    this._setTutorialUI(2, 'Bloğu ortadaki gri bölgeye koy. 10+ aynı renkli blok oluştur');

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
    _el('tray').classList.add('tutorial-mode');
    this._renderTray();
  }

  _setupTutorialStep3() {
    this._tutorial.step = 3;
    this._tutorial.target = { row: 5, col: 4 };
    this._tutorial.expectedShape = 'DOT';
    this._tutorial.expectedColor = 2;
    this._tutorial.expectedClear = 'row';
    this._setTutorialUI(3, 'Satırı tamamla: Renkli bloğu kalan boş yere yerleştir');

    this.grid.reset();
    const rowCells = [];
    for (let c = 0; c < Grid.SIZE; c++) {
      if (c === 4) continue;
      const color = (c % 4) + 1;
      rowCells.push({ row: 5, col: c, color });
    }
    for (const rc of rowCells)
      this.grid.fillMany([{ row: rc.row, col: rc.col }], rc.color, 'tutorial_seed_row');

    this.tray = [new Block('DOT', 2), null, null, null];
    this.usedMask = [false, true, true, true];
    _el('tray').classList.add('tutorial-mode');
    this._renderTray();
  }

  _setupTutorialStep4() {
    this._tutorial.step = 4;
    this._tutorial.target = { row: 4, col: 2 };
    this._tutorial.expectedShape = 'DOT';
    this._tutorial.expectedColor = 3;
    this._tutorial.expectedClear = 'col';
    this._setTutorialUI(4, 'Sütunu tamamla: Dikey olarak boş alanı doldur');

    this.grid.reset();
    const colCells = [];
    for (let r = 0; r < Grid.SIZE; r++) {
      if (r === 4) continue;
      const color = ((r + 1) % 4) + 1;
      colCells.push({ row: r, col: 2, color });
    }
    for (const rc of colCells)
      this.grid.fillMany([{ row: rc.row, col: rc.col }], rc.color, 'tutorial_seed_col');

    this.tray = [new Block('DOT', 3), null, null, null];
    this.usedMask = [false, true, true, true];
    _el('tray').classList.add('tutorial-mode');
    this._renderTray();
  }

  _setupTutorialStep5() {
    this._tutorial.step = 5;
    this._tutorial.target = { row: 1, col: 2 };
    this._tutorial.expectedShape = 'H3';
    this._tutorial.expectedColor = 4;
    this._tutorial.expectedClear = 'any_clear';
    this._setTutorialUI(5, '3 bloğu yan yana yerleştir. Harika! Ödül bloğun seni cezalandırabilir');

    this.grid.reset();
    const seed = [
      { row: 1, col: 0, color: 2 },
      { row: 1, col: 1, color: 3 },
      { row: 1, col: 5, color: 1 },
      { row: 1, col: 6, color: 2 },
      { row: 1, col: 7, color: 3 },
      { row: 4, col: 4, color: 4 },
      { row: 5, col: 5, color: 1 },
    ];
    for (const rc of seed)
      this.grid.fillMany([{ row: rc.row, col: rc.col }], rc.color, 'tutorial_seed_lucky');

    this.tray = [new Block('H3', 4), null, null, null];
    this.usedMask = [false, true, true, true];
    _el('tray').classList.add('tutorial-mode');
    this._renderTray();
    showToast('BONUS! 🍀 3 bloğu yan yana koy.');
  }

  _setupTutorialStep6() {
    this._tutorial.step = 6;
    this._tutorial.target = { row: 0, col: 2 };
    this._tutorial.expectedShape = 'DOT';
    this._tutorial.expectedColor = 1;
    this._tutorial.expectedClear = 'clean';
    this._setTutorialUI(6, 'Oyunu tamamen temizle! Son adım için bloğu yerleştir');

    this.grid.reset();
    const seed = [];
    for (let c = 0; c < Grid.SIZE; c++) {
      if (c === 2) continue;
      seed.push({ row: 0, col: c, color: (c % 4) + 1 });
    }
    for (const p of seed) {
      this.grid.fillMany([{ row: p.row, col: p.col }], p.color, 'tutorial_seed_clean');
    }
    this.tray = [new Block('DOT', 1), null, null, null];
    this.usedMask = [false, true, true, true];
    _el('tray').classList.add('tutorial-mode');
    this._renderTray();
  }

  _setupTutorialStep(step) {
    if (step === 1) return this._setupTutorialStep1();
    if (step === 2) return this._setupTutorialStep2();
    if (step === 3) return this._setupTutorialStep3();
    if (step === 4) return this._setupTutorialStep4();
    if (step === 5) return this._setupTutorialStep5();
    if (step === 6) return this._setupTutorialStep6();
    this._finishTutorial();
  }

  _skipTutorial() {
    if (!this._tutorial.active) return;
    this._finishTutorial({ skipped: true });
  }

  _finishTutorial({ skipped = false } = {}) {
    setSkipFileSfx(false);
    document.body.classList.remove('tutorial-focus');
    this._tutorial.active = false;
    _el('tray')?.classList.remove('tutorial-mode');
    this._tutorial.step = 0;
    this._tutorial.target = null;
    _setVisible(tutorialOverlay, false);
    localStorage.setItem(TUTORIAL_KEY, '1');
    
    if (!skipped) {
      const completionMsg = _el('tutorial-completion-msg');
      if (completionMsg) {
        _setVisible(completionMsg, true);
        setTimeout(() => {
          _setVisible(completionMsg, false);
          setTimeout(() => this._returnToStartScreen(), 300);
        }, 2200);
      } else {
        this._returnToStartScreen();
      }
    } else {
      this._returnToStartScreen();
    }
  }

  _returnToStartScreen() {
    game = null;
    _setVisible(mainApp, true);
    _setVisible(startScreen, true);
    if (_currentPage !== 'play') {
      Object.entries(PAGES).forEach(([key, el]) => el.classList.toggle('hidden', key !== 'play'));
      _currentPage = 'play';
    }
  }

  _drawTutorialTarget(now) {
    if (!this._tutorial.active || !this._tutorial.target) return;
    const { row, col } = this._tutorial.target;
    const block = this.tray[0];
    const positions = block ? block.getAbsolutePositions(row, col) : [{row, col}];
    
    const ctx = this.renderer.fxCtx;
    const pulse = 0.55 + (Math.sin(now / 180) + 1) * 0.2;
    
    ctx.save();
    ctx.strokeStyle = `rgba(196,181,253,${pulse})`;
    ctx.lineWidth = 3;
    ctx.fillStyle = `rgba(196,181,253,${0.15 + pulse * 0.12})`;
    
    // Draw all affected cells
    for (const pos of positions) {
      const x = this.renderer.PADDING + pos.col * (this.renderer.CELL + this.renderer.GAP);
      const y = this.renderer.PADDING + pos.row * (this.renderer.CELL + this.renderer.GAP);
      const sz = this.renderer.CELL;
      ctx.strokeRect(x - 2, y - 2, sz + 4, sz + 4);
      ctx.fillRect(x, y, sz, sz);
    }
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

  _handleTutorialAfterClear(result, didClean) {
    if (!this._tutorial.active) return;
    const expected = this._tutorial.expectedClear;
    const success = expected === 'place'
      || (expected === 'cluster10' && result.colorClusters.some(cl => cl.length >= 10))
      || (expected === 'row' && result.clearedRows.length > 0)
      || (expected === 'col' && result.clearedCols.length > 0)
      || (expected === 'any_clear' && result.totalCleared > 0)
      || (expected === 'clean' && didClean);

    if (!success) {
      showToast('Bu adimda hedeflenen sonucu olusturmadin, tekrar deneyelim.');
      const current = this._tutorial.step;
      setTimeout(() => this._setupTutorialStep(current), 520);
      return;
    }

    if (this._tutorial.step >= TUTORIAL_TOTAL_STEPS) {
      setTimeout(() => this._finishTutorial(), 650);
      return;
    }

    const nextStep = this._tutorial.step + 1;
    this._animateTutorialStepTransition();
    setTimeout(() => this._setupTutorialStep(nextStep), 520);
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
    if (this.gameContainerEl) {
      this.gameContainerEl.style.setProperty('--combo-bloom-color', color);
      this.gameContainerEl.classList.toggle('combo-bloom-active', m >= 2);
      if (m < 2) this.gameContainerEl.classList.remove('combo-bloom-pulse');
    }
  }

  _triggerComboFire() {
    this.comboEl.classList.remove('combo-fired');
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add('combo-fired');
    if (this.gameContainerEl) {
      this.gameContainerEl.classList.remove('combo-bloom-pulse');
      void this.gameContainerEl.offsetWidth;
      this.gameContainerEl.classList.add('combo-bloom-pulse');
    }
  }

  // ── Tray ───────────────────────────────────────────────────────────────────

  _smartAggressionForCurrentMode() {
    if (this._vsMode) return 0.08;
    if (this._challengeMode) return 0.78;
    if (this._tutorial.active) return 1;
    if (this.scoreSystem.score < 2200 || this.placements < 10) return 0.92;
    return 0.62;
  }

  _dealTray() {
    if (!this._tutorial.active) _el('tray')?.classList.remove('tutorial-mode');
    if (this._vsMode && this._vsRng) {
      // VS mode: use shared seeded RNG — same block sequence for both players, no Lucky
      this.tray = Array.from({ length: TRAY_SIZE }, () =>
        nextVsBlock(this._vsRng, this._colorCap));
      this.usedMask = new Array(TRAY_SIZE).fill(false);
      this._renderTray();
      if (isGameOver(this.tray.filter(Boolean), this.grid))
        setTimeout(() => this._gameOver({ reason: 'no_moves' }), 400);
      return;
    }
    const hard   = this.placements > 0 && this.placements % HARD_EVERY === 0;
    const smartProfile = this._challengeMode
      ? 'hard'
      : (this.placements < 10 || this.scoreSystem.score < 2200 ? 'early' : 'normal');
    const smartAggression = this._smartAggressionForCurrentMode();
    this.tray = generateTray(this.grid, TRAY_SIZE, hard, this._colorCap, {
      smartProfile,
      smartAggression,
    });
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
      setTimeout(() => this._gameOver({ reason: 'no_moves' }), 400);
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
    if (this._isGameOver) return;
    if (this._rotateMode.active) return;
    if (!this._isTutorialDropValid(block, row, col)) return;

    const positions = block.getAbsolutePositions(row, col);
    if (!this.grid.canPlace(positions)) return;

    this._pushMemento();

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
    let didClean = false;
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
        didClean = true;
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

    this._handleTutorialAfterClear(result, didClean);

    if (this._challengeMode && this.grid.getFilledCells().length === 0) {
      const nextLevel = this._challengeLevel + 1;
      const bonus = Math.round(250 * Math.max(1, nextLevel * 0.75));
      this.scoreSystem.score += bonus;
      this.scoreSystem._emit();
      showToast(`Seviye Temizlendi! +${bonus}  •  Sonraki: ${nextLevel}`);
      setTimeout(() => this._startChallengeLevel(nextLevel, { preserveProgress: true }), 550);
      return;
    }

    if (this.tray.filter(Boolean).length > 0 && isGameOver(this.tray.filter(Boolean), this.grid))
      setTimeout(() => this._gameOver({ reason: 'no_moves' }), 400);
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

  _gameOver({ reason = 'unknown' } = {}) {
    if (this._isGameOver) return;
    this._isGameOver = true;
    this._finishRotateMode();
    this.renderer.setDragEnabled(false);

    if (this.gameContainerEl) {
      this.gameContainerEl.classList.remove('game-container--shake');
      void this.gameContainerEl.offsetWidth;
      this.gameContainerEl.classList.add('game-container--shake');
      setTimeout(() => {
        this.gameContainerEl?.classList.remove('game-container--shake');
      }, 260);
    }

    if (reason === 'no_moves') {
      showToast('Yapilacak hamle kalmadi!');
    }

    const filled = this.grid.getFilledCells();
    const overlayDelay = filled.length ? 320 : 0;
    if (filled.length) {
      const snap = this._buildSnap();
      this.particles.burstCells(filled, PALETTE, snap);
      playMega();
      setTimeout(() => {
        if (!this._isGameOver) return;
        this.grid.reset();
        const dirty = this.grid.drainDirty();
        this.grid._emit(dirty);
      }, 220);
    }

    // VS mode: report to opponent, show overlay after brief delay, skip normal game-over UI
    if (this._vsMode) {
      vsSession.reportGameOver(this.scoreSystem.score);
      return;
    }

    if (this._challengeMode) {
      _submitChallengeScore({
        level: this._challengeLevel,
        score: this.scoreSystem.score,
      });
      renderChallengeLeaderboards();
    }

    const earned = this._coinMilestone; // only gameplay-earned coins, not purchases
    _el('final-score').textContent = this.scoreSystem.score.toLocaleString();
    _el('final-coins').textContent = `+${earned} \uD83E\uDE99`;
    setTimeout(() => {
      if (!this._isGameOver) return;
      overlayEl.classList.remove('hidden');
    }, overlayDelay);
    // Auto-save progress to cloud
    if (_currentUser) saveCloudSave(_currentUser.uid, _cloudSavePayload()).catch(() => {});
  }

  // ── Restart ────────────────────────────────────────────────────────────────

  restart({ mode = this._mode } = {}) {
    this._finishRotateMode();
    this._mode       = mode;
    this._challengeMode = mode === 'challenge';
    this._challengeLevel = 1;
    this._vsMode     = mode === 'vs';
    this._vsRole     = null;
    this._vsRng      = null;
    this._isGameOver = false;
    this.renderer.setDragEnabled(true);
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
    this._mementoHistory = [];
    this.renderer.setSkin(economy.getActiveSkin());
    if (this._challengeMode) {
      _setVisible(tutorialOverlay, false);
      this._startChallengeLevel(1);
    } else if (this._tutorial.active) this._startTutorial();
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

    if (id === 'undo_move') {
      const m = this._mementoHistory.pop();
      if (!m) {
        market._inv[id] = (market._inv[id] ?? 0) + 1;
        market._save();
        showToast('Geri alinacak hamle yok.');
        return;
      }
      this._restoreMemento(m);
      showToast('Son hamle geri alindi.');
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
