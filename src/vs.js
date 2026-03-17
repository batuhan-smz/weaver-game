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
  });
  return { matchId, inviteCode, seed };
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
