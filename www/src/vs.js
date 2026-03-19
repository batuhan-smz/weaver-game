/**
 * vs.js — 1v1 VS mode: matchmaking, real-time sync, seeded block generation.
 *
 * Firestore structure:
 *   /matches/{matchId}
 *     status:      'waiting' | 'countdown' | 'active' | 'finished' | 'cancelled'
 *     seed:        number   — shared RNG seed
 *     visibility:  'public' | 'private'
 *     inviteCode:  string | null   — 6-char join code for private rooms
 *     createdAt:   timestamp
 *     host:        { uid, name }
 *     guest:       null | { uid, name }
 *     hostRankPoints: number
 *     guestRankPoints: number | null
 *     hostState:   { score, gameOver, board, lastMoveAt, updatedAt, loseReason }
 *     guestState:  null | { score, gameOver, board, lastMoveAt, updatedAt, loseReason }
 *     winner:      null | uid | 'tie'
 */

import { getFirebaseServices } from './firebase.js';
import { SHAPE_KEYS } from './blocks.js';
import { Block } from './blocks.js';
import { Grid } from './grid.js';

// ── Seeded PRNG (LCG) ─────────────────────────────────────────────────────────

export class SeededRng {
  constructor(seed) {
    this._s = (seed >>> 0) || 1;
  }
  next() {
    // Park-Miller LCG — good enough for game fairness
    this._s = ((Math.imul(1664525, this._s) + 1013904223) >>> 0);
    return this._s / 4294967296;
  }
  nextInt(max) { return Math.floor(this.next() * max); }
}

function _genGroupCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function _createUniqueGroupCode(s, maxAttempts = 12) {
  for (let i = 0; i < maxAttempts; i++) {
    const code = _genGroupCode(6);
    const q = s.query(
      s.collection(s.db, 'groups'),
      s.where('groupCodeNormalized', '==', code),
      s.limit(1),
    );
    const snap = await s.getDocs(q);
    if (snap.empty) return code;
  }
  return `${_genGroupCode(4)}${String(Date.now()).slice(-2)}`;
}

async function _resolveGroupIdFromInput(s, raw) {
  const input = String(raw || '').trim();
  if (!input) throw new Error('Group not found');

  const normalized = input.toUpperCase();
  if (/^[A-Z0-9]{5,8}$/.test(normalized)) {
    const q = s.query(
      s.collection(s.db, 'groups'),
      s.where('groupCodeNormalized', '==', normalized),
      s.limit(1),
    );
    const snap = await s.getDocs(q);
    if (!snap.empty) return snap.docs[0].id;
  }
  return input;
}

// ── Board serialization ───────────────────────────────────────────────────────

const _EMPTY_BOARD = '0'.repeat(Grid.SIZE * Grid.SIZE);

export function serializeBoard(grid) {
  let s = '';
  for (let r = 0; r < Grid.SIZE; r++)
    for (let c = 0; c < Grid.SIZE; c++) {
      const cell = grid.get(r, c);
      s += cell.isEmpty ? '0' : String(cell.colorID);
    }
  return s;
}

const _CELL_COLORS = [
  '#0d0d1a', // 0 empty
  '#ef4444', // 1 crimson
  '#f59e0b', // 2 amber
  '#84cc16', // 3 lime
  '#22d3ee', // 4 cyan
  '#a78bfa', // 5 violet
  '#f472b6', // 6 pink
  '#38bdf8', // 7 sky
  '#34d399', // 8 emerald
];

export function drawMiniBoard(ctx, boardStr, w, h) {
  const SIZE = Grid.SIZE;
  const cs   = Math.floor(Math.min(w, h) / SIZE);
  const ox   = Math.floor((w - cs * SIZE) / 2);
  const oy   = Math.floor((h - cs * SIZE) / 2);

  ctx.fillStyle = '#13132a';
  ctx.fillRect(0, 0, w, h);

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cid = Number(boardStr?.[r * SIZE + c] ?? 0);
      ctx.fillStyle = cid === 0 ? '#1c1c36' : _CELL_COLORS[cid] ?? '#888';
      const rx = ox + c * cs + 1;
      const ry = oy + r * cs + 1;
      const rw = Math.max(1, cs - 2);
      const rh = Math.max(1, cs - 2);
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, 1);
      ctx.fill();
    }
  }
}

// ── Seeded block generation ───────────────────────────────────────────────────

export function nextVsBlock(rng, colorCap) {
  const shapeKey = SHAPE_KEYS[rng.nextInt(SHAPE_KEYS.length)];
  const colorID  = 1 + rng.nextInt(colorCap);
  return new Block(shapeKey, colorID);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function _genSeed() { return (Math.random() * 0xFFFFFFFF) >>> 0; }
function _matchId()  { return `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
function _teamMatchId() { return `tm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

// ── Firestore operations ──────────────────────────────────────────────────────

/**
 * Create a new VS match as host. Returns { matchId, inviteCode, seed }.
 */
export async function createMatch(user, { visibility = 'private', rankPoints = 0 } = {}) {
  const s          = await getFirebaseServices();
  const inviteCode = visibility === 'private' ? _genCode() : null;
  const seed       = _genSeed();
  const matchId    = _matchId();
  const now        = Date.now();

  await s.setDoc(s.doc(s.db, 'matches', matchId), {
    status:     'waiting',
    visibility,
    seed,
    inviteCode,
    createdAt:  s.serverTimestamp(),
    host:       { uid: user.uid, name: user.displayName || user.email || 'Oyuncu 1' },
    guest:      null,
    hostRankPoints: Number(rankPoints ?? 0),
    guestRankPoints: null,
    hostState:  {
      score: 0,
      gameOver: false,
      board: _EMPTY_BOARD,
      lastMoveAt: now,
      updatedAt: now,
      loseReason: null,
    },
    guestState: null,
    winner:     null,
    rematchHost: 'pending',
    rematchGuest: 'pending',
  });
  return { matchId, inviteCode, seed };
}

export async function joinMatchByInvite(matchId, inviteCode, user, rankPoints = 0) {
  const s = await getFirebaseServices();
  const now = Date.now();
  const ref = s.doc(s.db, 'matches', matchId);
  const snap = await s.getDoc(ref);
  if (!snap.exists()) throw new Error('Mac bulunamadi.');

  const data = snap.data() || {};
  if (String(data.inviteCode || '').toUpperCase() !== String(inviteCode || '').toUpperCase()) {
    throw new Error('Davet kodu gecersiz.');
  }
  if (data.host?.uid === user.uid) throw new Error('Kendi odana katilamazsin.');

  if (data.status === 'countdown' || data.status === 'active') {
    if (data.guest?.uid === user.uid) {
      return { matchId, seed: data.seed, role: 'guest', alreadyJoined: true };
    }
    throw new Error('Mac dolu veya baslamis.');
  }

  if (data.status !== 'waiting') throw new Error('Mac uygun durumda degil.');
  if (data.guest?.uid && data.guest.uid !== user.uid) throw new Error('Bu davet artik kullanilamaz.');

  await s.updateDoc(ref, {
    status: 'countdown',
    guest: { uid: user.uid, name: user.displayName || user.email || 'Oyuncu 2' },
    guestRankPoints: Number(rankPoints ?? 0),
    guestState: {
      score: 0,
      gameOver: false,
      board: _EMPTY_BOARD,
      lastMoveAt: now,
      updatedAt: now,
      loseReason: null,
    },
    rematchHost: 'pending',
    rematchGuest: 'pending',
  });
  return { matchId, seed: data.seed, role: 'guest' };
}

/**
 * Join an existing match by 6-char invite code. Returns { matchId, seed }.
 */
export async function joinMatchByCode(code, user, rankPoints = 0) {
  const s = await getFirebaseServices();
  const now = Date.now();
  const q = s.query(
    s.collection(s.db, 'matches'),
    s.where('visibility', '==', 'private'),
    s.where('inviteCode', '==', code.toUpperCase()),
    s.where('status', '==', 'waiting'),
    s.limit(1),
  );
  const snap = await s.getDocs(q);
  if (snap.empty) throw new Error('Oda bulunamadı veya zaten doldu.');
  const docSnap = snap.docs[0];
  const data    = docSnap.data();
  if (data.host.uid === user.uid) throw new Error('Kendi odana katamazsın.');

  await s.updateDoc(docSnap.ref, {
    status:     'countdown',
    guest:      { uid: user.uid, name: user.displayName || user.email || 'Oyuncu 2' },
    guestRankPoints: Number(rankPoints ?? 0),
    guestState: {
      score: 0,
      gameOver: false,
      board: _EMPTY_BOARD,
      lastMoveAt: now,
      updatedAt: now,
      loseReason: null,
    },
    rematchHost: 'pending',
    rematchGuest: 'pending',
  });
  return { matchId: docSnap.id, seed: data.seed };
}

/**
 * Find and join a random waiting match, or create one if none found.
 * Returns { matchId, seed, role: 'host'|'guest' }.
 */
export async function quickMatch(user, rankPoints = 0) {
  const s = await getFirebaseServices();
  const now = Date.now();
  const q = s.query(
    s.collection(s.db, 'matches'),
    s.where('visibility', '==', 'public'),
    s.where('status', '==', 'waiting'),
    s.limit(10),
  );
  const snap = await s.getDocs(q);
  for (const d of snap.docs) {
    const data = d.data();
    if (data.host.uid === user.uid) continue;
    // Reject stale waiting rooms (> 3 minutes old)
    const age = data.createdAt?.toMillis ? (Date.now() - data.createdAt.toMillis()) : 0;
    if (age > 3 * 60 * 1000) continue;
    try {
      await s.updateDoc(d.ref, {
        status:     'countdown',
        guest:      { uid: user.uid, name: user.displayName || user.email || 'Oyuncu 2' },
        guestRankPoints: Number(rankPoints ?? 0),
        guestState: {
          score: 0,
          gameOver: false,
          board: _EMPTY_BOARD,
          lastMoveAt: now,
          updatedAt: now,
          loseReason: null,
        },
        rematchHost: 'pending',
        rematchGuest: 'pending',
      });
      return { matchId: d.id, seed: data.seed, role: 'guest' };
    } catch { /* race — another player joined first, try next */ }
  }
  // No match found — create one and wait
  const result = await createMatch(user, { visibility: 'public', rankPoints });
  return { ...result, role: 'host' };
}

/**
 * Push local game state to Firestore.
 */
export async function updatePlayerState(matchId, role, {
  score,
  gameOver,
  board,
  lastMoveAt,
  updatedAt,
  loseReason = null,
}) {
  const s     = await getFirebaseServices();
  const field = role === 'host' ? 'hostState' : 'guestState';
  await s.updateDoc(s.doc(s.db, 'matches', matchId), {
    [field]: {
      score,
      gameOver,
      board,
      lastMoveAt: lastMoveAt ?? Date.now(),
      updatedAt: updatedAt ?? Date.now(),
      loseReason,
    },
  });
}

/**
 * Mark match as finished with a winner uid (or 'tie').
 */
export async function finishMatch(matchId, winnerUid) {
  const s = await getFirebaseServices();
  await s.updateDoc(s.doc(s.db, 'matches', matchId), {
    status: 'finished',
    winner: winnerUid,
  });
}

export async function setRematchChoice(matchId, role, choice = 'pending') {
  const s = await getFirebaseServices();
  const field = role === 'host' ? 'rematchHost' : 'rematchGuest';
  await s.updateDoc(s.doc(s.db, 'matches', matchId), {
    [field]: choice,
    rematchUpdatedAt: Date.now(),
  });
}

export async function startRematch(matchId) {
  const s = await getFirebaseServices();
  const ref = s.doc(s.db, 'matches', matchId);
  const snap = await s.getDoc(ref);
  if (!snap.exists()) throw new Error('Mac bulunamadi.');

  const data = snap.data() || {};
  if (data.status !== 'finished') throw new Error('Mac yeniden baslatilamaz.');
  if (data.rematchHost !== 'ready' || data.rematchGuest !== 'ready') throw new Error('Iki oyuncu da hazir degil.');

  const now = Date.now();
  const seed = _genSeed();
  await s.updateDoc(ref, {
    status: 'countdown',
    winner: null,
    seed,
    activeAt: null,
    hostState: {
      score: 0,
      gameOver: false,
      board: _EMPTY_BOARD,
      lastMoveAt: now,
      updatedAt: now,
      loseReason: null,
    },
    guestState: {
      score: 0,
      gameOver: false,
      board: _EMPTY_BOARD,
      lastMoveAt: now,
      updatedAt: now,
      loseReason: null,
    },
    rematchHost: 'pending',
    rematchGuest: 'pending',
    rematchStartedAt: now,
  });
}

/**
 * Cancel/delete a match (host abandons before game starts).
 */
export async function cancelMatch(matchId) {
  const s = await getFirebaseServices();
  await s.updateDoc(s.doc(s.db, 'matches', matchId), { status: 'cancelled' });
}

/**
 * Listen to real-time match state changes.
 * Returns an unsubscribe function.
 */
export function subscribeMatch(matchId, cb) {
  let _unsub = () => {};
  getFirebaseServices().then(s => {
    _unsub = s.onSnapshot(s.doc(s.db, 'matches', matchId), snap => {
      if (snap.exists()) cb(snap.data());
    });
  });
  return () => _unsub();
}

// ── Voice signaling (WebRTC over Firestore) ─────────────────────────────────

function _voiceSignalRef(s, matchId) {
  return s.doc(s.db, 'matches', matchId, 'voice', 'signal');
}

function _voiceCandidatesCol(s, matchId) {
  return s.collection(s.db, 'matches', matchId, 'voiceCandidates');
}

export async function clearVoiceSignal(matchId) {
  const s = await getFirebaseServices();
  await s.setDoc(_voiceSignalRef(s, matchId), {
    offer: null,
    offerAt: 0,
    answer: null,
    answerAt: 0,
    hostMicEnabled: false,
    guestMicEnabled: false,
    updatedAt: Date.now(),
  }, { merge: true });
}

export async function publishVoiceOffer(matchId, sdp) {
  const s = await getFirebaseServices();
  await s.setDoc(_voiceSignalRef(s, matchId), {
    offer: sdp,
    offerAt: Date.now(),
    answer: null,
    answerAt: 0,
    updatedAt: Date.now(),
  }, { merge: true });
}

export async function publishVoiceAnswer(matchId, sdp) {
  const s = await getFirebaseServices();
  await s.setDoc(_voiceSignalRef(s, matchId), {
    answer: sdp,
    answerAt: Date.now(),
    updatedAt: Date.now(),
  }, { merge: true });
}

export async function setVoiceMicState(matchId, role, enabled) {
  const s = await getFirebaseServices();
  const field = role === 'host' ? 'hostMicEnabled' : 'guestMicEnabled';
  await s.setDoc(_voiceSignalRef(s, matchId), {
    [field]: !!enabled,
    updatedAt: Date.now(),
  }, { merge: true });
}

export function subscribeVoiceSignal(matchId, cb) {
  let _unsub = () => {};
  getFirebaseServices().then(s => {
    _unsub = s.onSnapshot(_voiceSignalRef(s, matchId), snap => {
      cb(snap.exists() ? (snap.data() || {}) : {});
    });
  });
  return () => _unsub();
}

export async function sendVoiceCandidate(matchId, role, candidate) {
  if (!candidate) return;
  const s = await getFirebaseServices();
  const col = _voiceCandidatesCol(s, matchId);
  const ref = s.doc(col);
  await s.setDoc(ref, {
    role,
    candidate,
    createdAt: Date.now(),
  });
}

export function subscribeVoiceCandidates(matchId, fromRole, cb) {
  let _unsub = () => {};
  getFirebaseServices().then(s => {
    _unsub = s.onSnapshot(_voiceCandidatesCol(s, matchId), snap => {
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() || {}) }))
        .filter(row => row.role === fromRole)
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      cb(rows);
    });
  });
  return () => _unsub();
}

// ── GROUP MANAGEMENT (Phase 2) ────────────────────────────────────────────────

/**
 * Create a new group.
 * Returns { groupId, timestamp }.
 * 
 * Firestore structure:
 *   /groups/{groupId}
 *     id: string,
 *     name: string,
 *     creatorUid: string,
 *     creatorName: string,
 *     creatorAvatar: string,
 *     maxPlayers: number (3, 4, etc),
 *     cost: number (50 coins per player),
 *     status: 'open' | 'closed' | 'in-match',
 *     members: [{ uid, name, avatar, joinedAt, status: 'joined' | 'ready' | 'playing', ranking: number }],
 *     createdAt: timestamp,
 *     updatedAt: timestamp,
 *     settings: { voiceEnabled, wagersEnabled, tournamentMode },
 */
export async function createGroup({ name, creatorUid, creatorName, creatorAvatar, maxPlayers = 3 }) {
  const s = await getFirebaseServices();
  const groupId = s.doc(s.collection(s.db, 'groups')).id;
  const groupCode = await _createUniqueGroupCode(s);
  
  await s.setDoc(s.doc(s.db, 'groups', groupId), {
    id: groupId,
    groupCode,
    groupCodeNormalized: String(groupCode).toUpperCase(),
    name,
    creatorUid,
    creatorName,
    creatorAvatar,
    maxPlayers,
    cost: 50,
    status: 'open',
    members: [{
      uid: creatorUid,
      name: creatorName,
      avatar: creatorAvatar,
      joinedAt: Date.now(),
      status: 'joined',
      ranking: 0,
    }],
    createdAt: s.serverTimestamp(),
    updatedAt: s.serverTimestamp(),
    settings: {
      voiceEnabled: true,
      wagersEnabled: true,
      tournamentMode: false,
      vsTargetScore: 5000,
      vsTimerSeconds: 60,
    },
  });
  
  // Add groupId to user's groupIds array
  const userRef = s.doc(s.db, 'users', creatorUid);
  await s.setDoc(userRef, {
    groupIds: s.arrayUnion(groupId),
  }, { merge: true });
  
  return { groupId, groupCode };
}

/**
 * Join an existing group.
 */
export async function joinGroup({ groupId, uid, name, avatar }) {
  const s = await getFirebaseServices();
  const resolvedGroupId = await _resolveGroupIdFromInput(s, groupId);
  const groupRef = s.doc(s.db, 'groups', resolvedGroupId);
  const groupSnap = await s.getDoc(groupRef);
  
  if (!groupSnap.exists()) throw new Error('Group not found');
  
  const groupData = groupSnap.data();
  if (groupData.members.some(m => m.uid === uid)) return;
  if (groupData.status !== 'open') throw new Error('Group is not open');
  if (groupData.members.length >= groupData.maxPlayers) throw new Error('Group is full');
  
  const newMember = {
    uid,
    name,
    avatar,
    joinedAt: Date.now(),
    status: 'joined',
    ranking: 0,
  };
  
  await s.updateDoc(groupRef, {
    members: [...groupData.members, newMember],
    updatedAt: s.serverTimestamp(),
  });
  
  // Add groupId to user's groupIds array
  const userRef = s.doc(s.db, 'users', uid);
  await s.setDoc(userRef, {
    groupIds: s.arrayUnion(resolvedGroupId),
  }, { merge: true });
}

/**
 * Leave a group.
 */
export async function leaveGroup({ groupId, uid }) {
  const s = await getFirebaseServices();
  const groupRef = s.doc(s.db, 'groups', groupId);
  const groupSnap = await s.getDoc(groupRef);
  
  if (!groupSnap.exists()) throw new Error('Group not found');
  
  const groupData = groupSnap.data();
  const updatedMembers = groupData.members.filter(m => m.uid !== uid);
  
  // If no members left, delete the group
  if (updatedMembers.length === 0) {
    await s.deleteDoc(groupRef);
  } else {
    // If creator left, assign new creator
    let newCreatorUid = groupData.creatorUid;
    if (groupData.creatorUid === uid && updatedMembers.length > 0) {
      newCreatorUid = updatedMembers[0].uid;
    }
    
    await s.updateDoc(groupRef, {
      members: updatedMembers,
      creatorUid: newCreatorUid,
      updatedAt: s.serverTimestamp(),
    });
  }
  
  // Remove groupId from user's groupIds array
  const userRef = s.doc(s.db, 'users', uid);
  await s.setDoc(userRef, {
    groupIds: s.arrayRemove(groupId),
  }, { merge: true });
}

/**
 * Get all groups for a user (as a member).
 * Requires that user doc has a 'groupIds' field with array of group IDs.
 */
export async function listMyGroups({ uid }) {
  const s = await getFirebaseServices();
  const userSnap = await s.getDoc(s.doc(s.db, 'users', uid));
  
  if (!userSnap.exists()) return [];
  
  const groupIds = userSnap.data()?.groupIds || [];
  if (groupIds.length === 0) return [];
  
  // Fetch each group doc
  const groups = await Promise.all(
    groupIds.map(gid => s.getDoc(s.doc(s.db, 'groups', gid)))
  );
  
  return groups
    .filter(snap => snap.exists())
    .map(snap => ({
      id: snap.id,
      ...snap.data(),
    }));
}

/**
 * Subscribe to real-time group updates.
 */
export function subscribeGroup(groupId, cb) {
  let _unsub = () => {};
  getFirebaseServices().then(s => {
    _unsub = s.onSnapshot(s.doc(s.db, 'groups', groupId), snap => {
      if (snap.exists()) {
        cb(snap.data());
      }
    });
  });
  return () => _unsub();
}

/**
 * Update group status or settings.
 */
export async function updateGroupStatus({ groupId, status, tournamentMode, voiceEnabled, wagersEnabled, vsTargetScore, vsTimerSeconds }) {
  const s = await getFirebaseServices();
  const groupRef = s.doc(s.db, 'groups', groupId);
  
  const updates = { updatedAt: s.serverTimestamp() };
  if (status !== undefined) updates.status = status;
  if (tournamentMode !== undefined) updates['settings.tournamentMode'] = tournamentMode;
  if (voiceEnabled !== undefined) updates['settings.voiceEnabled'] = !!voiceEnabled;
  if (wagersEnabled !== undefined) updates['settings.wagersEnabled'] = !!wagersEnabled;
  if (vsTargetScore !== undefined) updates['settings.vsTargetScore'] = Math.max(1000, Number(vsTargetScore || 5000));
  if (vsTimerSeconds !== undefined) updates['settings.vsTimerSeconds'] = Math.max(30, Number(vsTimerSeconds || 60));
  
  await s.updateDoc(groupRef, updates);
}

/**
 * Update a member's status within group (joined, ready, playing).
 */
export async function updateMemberStatus({ groupId, uid, memberStatus }) {
  const s = await getFirebaseServices();
  const groupRef = s.doc(s.db, 'groups', groupId);
  const groupSnap = await s.getDoc(groupRef);
  
  if (!groupSnap.exists()) throw new Error('Group not found');
  
  const groupData = groupSnap.data();
  const updatedMembers = groupData.members.map(m => 
    m.uid === uid ? { ...m, status: memberStatus } : m
  );
  
  await s.updateDoc(groupRef, {
    members: updatedMembers,
    updatedAt: s.serverTimestamp(),
  });
}

/**
 * Remove a member from group (creator only).
 */
export async function removeFromGroup({ groupId, uid, creatorUid }) {
  const s = await getFirebaseServices();
  const groupRef = s.doc(s.db, 'groups', groupId);
  const groupSnap = await s.getDoc(groupRef);
  
  if (!groupSnap.exists()) throw new Error('Group not found');
  
  const groupData = groupSnap.data();
  if (groupData.creatorUid !== creatorUid) throw new Error('Only creator can remove members');
  
  const updatedMembers = groupData.members.filter(m => m.uid !== uid);
  
  await s.updateDoc(groupRef, {
    members: updatedMembers,
    updatedAt: s.serverTimestamp(),
  });

  const userRef = s.doc(s.db, 'users', uid);
  await s.setDoc(userRef, {
    groupIds: s.arrayRemove(groupId),
  }, { merge: true }).catch(() => {});
}

export async function createGroupLiveMatch({ groupId, creatorUid, targetScore = 5000, moveTimeoutMs = 20_000 }) {
  const s = await getFirebaseServices();
  const groupRef = s.doc(s.db, 'groups', groupId);
  const groupSnap = await s.getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error('Group not found');

  const group = groupSnap.data() || {};
  if (group.creatorUid !== creatorUid) throw new Error('Only creator can start live match');
  if (group.status === 'in-match' && group.activeMatchId) throw new Error('Group already has active match');

  const maxPlayers = Number(group.maxPlayers || 0);
  if (maxPlayers !== 3 && maxPlayers !== 4) throw new Error('Only 3v3 or 4v4 supported');

  const readyMembers = (group.members || []).filter(m => m.status === 'ready' || m.uid === creatorUid);
  if (readyMembers.length < maxPlayers) throw new Error('All players must be ready');

  const players = readyMembers.slice(0, maxPlayers).map(m => ({
    uid: m.uid,
    name: m.name || 'Oyuncu',
    avatar: m.avatar || '',
    score: 0,
    board: _EMPTY_BOARD,
    gameOver: false,
    loseReason: null,
    lastMoveAt: 0,
  }));

  const seed = _genSeed();
  const matchId = _teamMatchId();
  const now = Date.now();

  await s.setDoc(s.doc(s.db, 'team_matches', matchId), {
    id: matchId,
    groupId,
    mode: `${maxPlayers}p`,
    status: 'active',
    seed,
    targetScore: Number(targetScore || 5000),
    moveTimeoutMs: Number(moveTimeoutMs || 20_000),
    players,
    turnIndex: 0,
    turnUid: players[0]?.uid || null,
    turnStartedAt: now,
    winnerUid: null,
    createdAt: s.serverTimestamp(),
    updatedAt: s.serverTimestamp(),
  });

  await s.updateDoc(groupRef, {
    status: 'in-match',
    activeMatchId: matchId,
    members: (group.members || []).map(m => ({
      ...m,
      status: players.some(p => p.uid === m.uid) ? 'playing' : m.status,
    })),
    updatedAt: s.serverTimestamp(),
  });

  return { matchId, seed, mode: `${maxPlayers}p` };
}

export async function submitGroupLiveTurn({ matchId, uid, score, board, gameOver = false, loseReason = null }) {
  const s = await getFirebaseServices();
  const ref = s.doc(s.db, 'team_matches', matchId);
  const snap = await s.getDoc(ref);
  if (!snap.exists()) throw new Error('Live match not found');

  const data = snap.data() || {};
  if (data.status !== 'active') throw new Error('Live match is not active');
  if (data.turnUid !== uid) throw new Error('Not your turn');

  const players = Array.isArray(data.players) ? data.players.map(p => ({ ...p })) : [];
  const idx = players.findIndex(p => p.uid === uid);
  if (idx < 0) throw new Error('Player not in match');

  players[idx].score = Math.max(0, Number(score || 0));
  if (typeof board === 'string' && board.length === _EMPTY_BOARD.length) players[idx].board = board;
  players[idx].gameOver = !!gameOver;
  players[idx].loseReason = loseReason || null;
  players[idx].lastMoveAt = Date.now();

  const now = Date.now();
  const alive = players.filter(p => !p.gameOver);
  const target = Number(data.targetScore || 5000);
  const targetWinner = players.find(p => Number(p.score || 0) >= target);
  const singleAliveWinner = alive.length === 1 ? alive[0] : null;
  const winner = targetWinner || singleAliveWinner;

  if (winner) {
    await s.updateDoc(ref, {
      players,
      status: 'finished',
      winnerUid: winner.uid,
      endedAt: now,
      updatedAt: s.serverTimestamp(),
    });

    const groupRef = s.doc(s.db, 'groups', data.groupId);
    const groupSnap = await s.getDoc(groupRef);
    if (groupSnap.exists()) {
      const group = groupSnap.data() || {};
      await s.updateDoc(groupRef, {
        status: 'open',
        activeMatchId: null,
        members: (group.members || []).map(m => ({ ...m, status: 'joined' })),
        updatedAt: s.serverTimestamp(),
      });
    }
    return { finished: true, winnerUid: winner.uid };
  }

  // Find next alive player turn.
  const currentTurnIndex = Number(data.turnIndex || 0);
  let nextIndex = currentTurnIndex;
  for (let i = 1; i <= players.length; i++) {
    const cand = (currentTurnIndex + i) % players.length;
    if (!players[cand].gameOver) {
      nextIndex = cand;
      break;
    }
  }

  await s.updateDoc(ref, {
    players,
    turnIndex: nextIndex,
    turnUid: players[nextIndex]?.uid || null,
    turnStartedAt: now,
    updatedAt: s.serverTimestamp(),
  });

  return { finished: false, nextTurnUid: players[nextIndex]?.uid || null };
}

export async function closeGroupLiveMatch(matchId, requesterUid) {
  const s = await getFirebaseServices();
  const ref = s.doc(s.db, 'team_matches', matchId);
  const snap = await s.getDoc(ref);
  if (!snap.exists()) throw new Error('Live match not found');
  const data = snap.data() || {};

  const groupRef = s.doc(s.db, 'groups', data.groupId);
  const groupSnap = await s.getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error('Group not found');
  const group = groupSnap.data() || {};
  if (group.creatorUid !== requesterUid) throw new Error('Only creator can close live match');

  await s.updateDoc(ref, {
    status: 'finished',
    winnerUid: null,
    endedAt: Date.now(),
    updatedAt: s.serverTimestamp(),
  });

  await s.updateDoc(groupRef, {
    status: 'open',
    activeMatchId: null,
    members: (group.members || []).map(m => ({ ...m, status: 'joined' })),
    updatedAt: s.serverTimestamp(),
  });
}

export function subscribeGroupLiveMatch(matchId, cb) {
  let _unsub = () => {};
  getFirebaseServices().then(s => {
    _unsub = s.onSnapshot(s.doc(s.db, 'team_matches', matchId), snap => {
      cb(snap.exists() ? (snap.data() || null) : null);
    });
  });
  return () => _unsub();
}

function _shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

function _makeRound(roundNo, entrants) {
  const matches = [];
  for (let i = 0; i < entrants.length; i += 2) {
    const p1 = entrants[i] || null;
    const p2 = entrants[i + 1] || null;
    const isBye = !!p1 && !p2;
    matches.push({
      id: `r${roundNo}m${Math.floor(i / 2) + 1}`,
      p1Uid: p1?.uid || null,
      p1Name: p1?.name || null,
      p2Uid: p2?.uid || null,
      p2Name: p2?.name || null,
      winnerUid: isBye ? p1.uid : null,
      status: isBye ? 'completed' : 'pending',
      isBye,
    });
  }
  return { round: roundNo, matches };
}

export async function createGroupTournament({ groupId, creatorUid, shuffle = true }) {
  const s = await getFirebaseServices();
  const groupRef = s.doc(s.db, 'groups', groupId);
  const groupSnap = await s.getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error('Group not found');

  const group = groupSnap.data() || {};
  if (group.creatorUid !== creatorUid) throw new Error('Only creator can start tournament');
  if (group.activeTournamentId) throw new Error('Tournament already active');
  if (!group.settings?.tournamentMode) throw new Error('Enable tournament mode first');

  const players = (group.members || []).filter(m => !!m.uid).map(m => ({ uid: m.uid, name: m.name || 'Oyuncu' }));
  if (players.length < 3) throw new Error('Tournament requires at least 3 players');

  const entrants = shuffle ? _shuffle(players) : players;
  const firstRound = _makeRound(1, entrants);
  const tournamentId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  await s.setDoc(s.doc(s.db, 'tournaments', tournamentId), {
    id: tournamentId,
    groupId,
    status: 'active',
    currentRound: 1,
    participants: entrants,
    rounds: [firstRound],
    winnerUid: null,
    createdAt: s.serverTimestamp(),
    updatedAt: s.serverTimestamp(),
  });

  await s.updateDoc(groupRef, {
    activeTournamentId: tournamentId,
    updatedAt: s.serverTimestamp(),
  });

  return { tournamentId };
}

export async function submitTournamentMatchResult({ tournamentId, roundNo, matchId, winnerUid, reporterUid }) {
  const s = await getFirebaseServices();
  const ref = s.doc(s.db, 'tournaments', tournamentId);
  const snap = await s.getDoc(ref);
  if (!snap.exists()) throw new Error('Tournament not found');

  const t = snap.data() || {};
  if (t.status !== 'active') throw new Error('Tournament not active');

  const groupRef = s.doc(s.db, 'groups', t.groupId);
  const groupSnap = await s.getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error('Group not found');
  const group = groupSnap.data() || {};
  if (group.creatorUid !== reporterUid) throw new Error('Only creator can report results');

  const rounds = Array.isArray(t.rounds) ? t.rounds.map(r => ({ ...r, matches: (r.matches || []).map(m => ({ ...m })) })) : [];
  const roundIndex = rounds.findIndex(r => Number(r.round) === Number(roundNo));
  if (roundIndex < 0) throw new Error('Round not found');
  const matchIndex = rounds[roundIndex].matches.findIndex(m => m.id === matchId);
  if (matchIndex < 0) throw new Error('Match not found');

  const match = rounds[roundIndex].matches[matchIndex];
  if (![match.p1Uid, match.p2Uid].includes(winnerUid)) throw new Error('Winner not in match');
  rounds[roundIndex].matches[matchIndex] = {
    ...match,
    winnerUid,
    status: 'completed',
    isBye: false,
  };

  const allDone = rounds[roundIndex].matches.every(m => m.status === 'completed');
  if (!allDone) {
    await s.updateDoc(ref, {
      rounds,
      updatedAt: s.serverTimestamp(),
    });
    return { completed: false, winnerUid: null };
  }

  const winners = rounds[roundIndex].matches
    .map(m => m.winnerUid)
    .filter(Boolean)
    .map(uid => {
      const p = (t.participants || []).find(x => x.uid === uid);
      return { uid, name: p?.name || 'Oyuncu' };
    });

  if (winners.length <= 1) {
    const tournamentWinnerUid = winners[0]?.uid || null;
    await s.updateDoc(ref, {
      rounds,
      status: 'finished',
      winnerUid: tournamentWinnerUid,
      endedAt: Date.now(),
      updatedAt: s.serverTimestamp(),
    });
    await s.updateDoc(groupRef, {
      activeTournamentId: null,
      updatedAt: s.serverTimestamp(),
    });
    return { completed: true, winnerUid: tournamentWinnerUid };
  }

  const nextRoundNo = Number(roundNo) + 1;
  rounds.push(_makeRound(nextRoundNo, winners));
  await s.updateDoc(ref, {
    rounds,
    currentRound: nextRoundNo,
    updatedAt: s.serverTimestamp(),
  });

  return { completed: false, winnerUid: null };
}

export function subscribeGroupTournament(tournamentId, cb) {
  let _unsub = () => {};
  getFirebaseServices().then(s => {
    _unsub = s.onSnapshot(s.doc(s.db, 'tournaments', tournamentId), snap => {
      cb(snap.exists() ? (snap.data() || null) : null);
    });
  });
  return () => _unsub();
}

function _groupChatCol(s, groupId) {
  return s.collection(s.db, 'groups', groupId, 'chat');
}

export async function sendGroupChatMessage(groupId, sender, text) {
  const s = await getFirebaseServices();
  const col = _groupChatCol(s, groupId);
  const msgRef = s.doc(col);
  const body = String(text || '').trim();
  if (!body) return;
  await s.setDoc(msgRef, {
    senderUid: sender.uid,
    senderName: sender.displayName || sender.email || 'Oyuncu',
    senderAvatar: sender.photoURL || '',
    text: body.slice(0, 320),
    createdAt: Date.now(),
  });
}

export function subscribeGroupChat(groupId, cb) {
  let _unsub = () => {};
  getFirebaseServices().then(s => {
    _unsub = s.onSnapshot(_groupChatCol(s, groupId), snap => {
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() || {}) }))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      cb(rows);
    });
  });
  return () => _unsub();
}

function _groupWagersCol(s, groupId) {
  return s.collection(s.db, 'groups', groupId, 'wagers');
}

export async function createGroupWagerRoom({ groupId, challengerUid, challengerName, opponentUid, opponentName, stake }) {
  const s = await getFirebaseServices();
  const safeStake = Math.max(10, Number(stake || 0));
  if (!opponentUid) throw new Error('Opponent required');
  if (challengerUid === opponentUid) throw new Error('You cannot challenge yourself');

  const groupRef = s.doc(s.db, 'groups', groupId);
  const groupSnap = await s.getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error('Group not found');
  const group = groupSnap.data() || {};
  if (!group.settings?.wagersEnabled) throw new Error('Wagers are disabled in this group');

  const col = _groupWagersCol(s, groupId);
  const ref = s.doc(col);
  await s.setDoc(ref, {
    id: ref.id,
    status: 'pending',
    stake: safeStake,
    challengerUid,
    challengerName: challengerName || 'Oyuncu',
    opponentUid,
    opponentName: opponentName || 'Oyuncu',
    winnerUid: null,
    resolvedByUid: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return { wagerId: ref.id };
}

export async function respondGroupWagerRoom({ groupId, wagerId, responderUid, accept }) {
  const s = await getFirebaseServices();
  const ref = s.doc(s.db, 'groups', groupId, 'wagers', wagerId);
  const snap = await s.getDoc(ref);
  if (!snap.exists()) throw new Error('Wager room not found');
  const row = snap.data() || {};
  if (row.status !== 'pending') throw new Error('Wager room no longer pending');
  if (row.opponentUid !== responderUid) throw new Error('Only invited opponent can respond');

  await s.updateDoc(ref, {
    status: accept ? 'accepted' : 'rejected',
    respondedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export async function resolveGroupWagerRoom({ groupId, wagerId, winnerUid, resolverUid }) {
  const s = await getFirebaseServices();
  const ref = s.doc(s.db, 'groups', groupId, 'wagers', wagerId);
  const snap = await s.getDoc(ref);
  if (!snap.exists()) throw new Error('Wager room not found');
  const row = snap.data() || {};
  if (row.status !== 'accepted') throw new Error('Wager room is not accepted');
  if (![row.challengerUid, row.opponentUid].includes(resolverUid)) throw new Error('Only participants can resolve wager');
  if (![row.challengerUid, row.opponentUid].includes(winnerUid)) throw new Error('Winner must be one of participants');

  await s.updateDoc(ref, {
    status: 'resolved',
    winnerUid,
    resolvedByUid: resolverUid,
    resolvedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export function subscribeGroupWagers(groupId, cb) {
  let _unsub = () => {};
  getFirebaseServices().then(s => {
    _unsub = s.onSnapshot(_groupWagersCol(s, groupId), snap => {
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() || {}) }))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      cb(rows);
    });
  });
  return () => _unsub();
}

function _groupVoiceChunksCol(s, groupId) {
  return s.collection(s.db, 'groups', groupId, 'voice_chunks');
}

function _groupVoiceMembersCol(s, groupId) {
  return s.collection(s.db, 'groups', groupId, 'voice_members');
}

export async function sendGroupVoiceChunk({ groupId, senderUid, senderName, seq, audioData }) {
  const s = await getFirebaseServices();
  if (!audioData || String(audioData).length < 16) return;
  const col = _groupVoiceChunksCol(s, groupId);
  const ref = s.doc(col);
  await s.setDoc(ref, {
    id: ref.id,
    senderUid,
    senderName: senderName || 'Oyuncu',
    seq: Number(seq || 0),
    audioData: String(audioData),
    createdAt: Date.now(),
  });
}

export function subscribeGroupVoiceChunks(groupId, cb) {
  let _unsub = () => {};
  getFirebaseServices().then(s => {
    _unsub = s.onSnapshot(_groupVoiceChunksCol(s, groupId), snap => {
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() || {}) }))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      cb(rows);
    });
  });
  return () => _unsub();
}

export async function setGroupVoiceMemberState({ groupId, uid, name, micEnabled }) {
  const s = await getFirebaseServices();
  const ref = s.doc(s.db, 'groups', groupId, 'voice_members', uid);
  await s.setDoc(ref, {
    uid,
    name: name || 'Oyuncu',
    micEnabled: !!micEnabled,
    updatedAt: Date.now(),
  }, { merge: true });
}

export function subscribeGroupVoiceMembers(groupId, cb) {
  let _unsub = () => {};
  getFirebaseServices().then(s => {
    _unsub = s.onSnapshot(_groupVoiceMembersCol(s, groupId), snap => {
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() || {}) }))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      cb(rows);
    });
  });
  return () => _unsub();
}
