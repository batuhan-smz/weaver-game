/**
 * social.js - Firestore-backed social layer for Weaver.
 *
 * Features:
 * - user profile sync (for friend discovery)
 * - friend requests
 * - real-time match chat
 * - in-match player reports
 */

import { getFirebaseServices } from './firebase.js';

function _friendDocId(a, b) {
  return [String(a || ''), String(b || '')].sort().join('__');
}

function _normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function _displayName(user) {
  return user?.displayName || user?.email || 'Player';
}

export async function upsertUserProfile(user, extra = {}) {
  if (!user?.uid) return;
  const s = await getFirebaseServices();
  await s.setDoc(
    s.doc(s.db, 'users', user.uid),
    {
      uid: user.uid,
      displayName: _displayName(user),
      email: user.email || null,
      emailNormalized: _normalizeEmail(user.email),
      photoURL: user.photoURL || null,
      ...extra,
      updatedAt: s.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateUserProfile(uid, patch = {}) {
  if (!uid) throw new Error('Sign-in required.');
  const s = await getFirebaseServices();
  await s.setDoc(
    s.doc(s.db, 'users', uid),
    {
      ...patch,
      updatedAt: s.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function sendFriendRequest(requesterUser, targetUid, context = {}) {
  const requesterUid = requesterUser?.uid;
  if (!requesterUid) throw new Error('Sign-in required.');
  if (!targetUid) throw new Error('Target player not found.');
  if (requesterUid === targetUid) throw new Error('You cannot add yourself.');
  const matchId = String(context?.matchId || '').trim() || null;

  const s = await getFirebaseServices();
  const ref = s.doc(s.db, 'friends', _friendDocId(requesterUid, targetUid));
  const snap = await s.getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    if (data.status === 'accepted') throw new Error('Already friends.');
    if (data.status === 'pending') throw new Error('Friend request already pending.');
    if (
      data.status === 'rejected'
      && matchId
      && data.rejectedMatchId
      && String(data.rejectedMatchId) === matchId
    ) {
      throw new Error('Bu mac icin istek zaten reddedildi. Yeni maca girmen gerekiyor.');
    }
  }

  await s.setDoc(ref, {
    members: [requesterUid, targetUid],
    requesterUid,
    addresseeUid: targetUid,
    requesterName: _displayName(requesterUser),
    status: 'pending',
    lastRequestMatchId: matchId,
    createdAt: s.serverTimestamp(),
    updatedAt: s.serverTimestamp(),
  }, { merge: true });
}

export async function sendFriendRequestByEmail(requesterUser, targetEmail) {
  const emailNormalized = _normalizeEmail(targetEmail);
  if (!emailNormalized) throw new Error('Enter an email first.');

  const s = await getFirebaseServices();
  const q = s.query(
    s.collection(s.db, 'users'),
    s.where('emailNormalized', '==', emailNormalized),
    s.limit(1),
  );
  const snap = await s.getDocs(q);
  if (snap.empty) throw new Error('User not found for this email.');

  const targetUid = snap.docs[0].id;
  await sendFriendRequest(requesterUser, targetUid);
  return { targetUid };
}

export async function sendMatchChatMessage(matchId, senderUser, text) {
  const uid = senderUser?.uid;
  const clean = String(text || '').trim();
  if (!uid) throw new Error('Sign-in required.');
  if (!matchId) throw new Error('Match not found.');
  if (!clean) return;

  const s = await getFirebaseServices();
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await s.setDoc(s.doc(s.db, 'matches', matchId, 'chat', msgId), {
    uid,
    name: _displayName(senderUser),
    text: clean.slice(0, 240),
    createdAt: Date.now(),
    createdAtServer: s.serverTimestamp(),
  });
}

export async function sendFriendChatMessage(friendUid, senderUser, text) {
  const uid = senderUser?.uid;
  const clean = String(text || '').trim();
  if (!uid) throw new Error('Sign-in required.');
  if (!friendUid) throw new Error('Friend not found.');
  if (!clean) return;

  const s = await getFirebaseServices();
  const chatId = _friendDocId(uid, friendUid);
  const msgId = `fmsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await s.setDoc(s.doc(s.db, 'friendChats', chatId, 'messages', msgId), {
    uid,
    name: _displayName(senderUser),
    text: clean.slice(0, 320),
    createdAt: Date.now(),
    createdAtServer: s.serverTimestamp(),
  });
}

export function subscribeFriendChat(myUid, friendUid, cb) {
  if (!myUid || !friendUid) return () => {};
  let _unsub = () => {};

  getFirebaseServices().then(s => {
    const chatId = _friendDocId(myUid, friendUid);
    _unsub = s.onSnapshot(s.collection(s.db, 'friendChats', chatId, 'messages'), snap => {
      const rows = snap.docs.map(d => {
        const data = d.data() || {};
        return {
          id: d.id,
          uid: data.uid || '',
          name: data.name || 'Player',
          text: data.text || '',
          createdAt: Number(data.createdAt || 0),
        };
      });
      rows.sort((a, b) => a.createdAt - b.createdAt);
      cb(rows.slice(-120));
    });
  }).catch(() => cb([]));

  return () => _unsub();
}

export function subscribeMatchChat(matchId, cb) {
  let _unsub = () => {};
  if (!matchId) return () => {};

  getFirebaseServices().then(s => {
    _unsub = s.onSnapshot(s.collection(s.db, 'matches', matchId, 'chat'), snap => {
      const rows = snap.docs.map(d => {
        const data = d.data() || {};
        return {
          id: d.id,
          uid: data.uid || '',
          name: data.name || 'Player',
          text: data.text || '',
          createdAt: Number(data.createdAt || 0),
        };
      });
      rows.sort((a, b) => a.createdAt - b.createdAt);
      cb(rows.slice(-60));
    });
  }).catch(() => {});

  return () => _unsub();
}

export async function submitPlayerReport({ matchId, reporterUid, reportedUid, reason, details = '' }) {
  if (!matchId || !reporterUid || !reportedUid) throw new Error('Missing report fields.');
  if (reporterUid === reportedUid) throw new Error('Invalid report target.');

  const s = await getFirebaseServices();
  const reportId = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await s.setDoc(s.doc(s.db, 'reports', reportId), {
    matchId,
    reporterUid,
    reportedUid,
    reason: String(reason || 'unspecified').slice(0, 80),
    details: String(details || '').slice(0, 500),
    createdAt: Date.now(),
    createdAtServer: s.serverTimestamp(),
  });
}

export async function setPresence(user, state = 'online') {
  if (!user?.uid) return;
  const s = await getFirebaseServices();
  await s.setDoc(
    s.doc(s.db, 'users', user.uid),
    {
      presenceState: state,
      lastSeenAt: Date.now(),
      lastSeenServer: s.serverTimestamp(),
      updatedAt: s.serverTimestamp(),
    },
    { merge: true },
  );
}

export function subscribeFriends(user, cb) {
  const uid = user?.uid;
  if (!uid) return () => {};

  let _unsubFriends = () => {};
  const _friendDocUnsubs = new Map();
  const _friendRows = new Map();

  function _emit() {
    const rows = [..._friendRows.values()].sort((a, b) => a.name.localeCompare(b.name));
    cb(rows);
  }

  getFirebaseServices().then(s => {
    const q = s.query(
      s.collection(s.db, 'friends'),
      s.where('members', 'array-contains', uid),
    );

    _unsubFriends = s.onSnapshot(q, snap => {
      const accepted = [];
      snap.docs.forEach(d => {
        const data = d.data() || {};
        if (data.status !== 'accepted') return;
        const members = Array.isArray(data.members) ? data.members : [];
        const otherUid = members.find(m => m !== uid);
        if (otherUid) accepted.push(otherUid);
      });

      const keep = new Set(accepted);
      for (const [otherUid, unsub] of _friendDocUnsubs.entries()) {
        if (keep.has(otherUid)) continue;
        unsub();
        _friendDocUnsubs.delete(otherUid);
        _friendRows.delete(otherUid);
      }

      accepted.forEach(otherUid => {
        if (_friendDocUnsubs.has(otherUid)) return;
        const unsub = s.onSnapshot(s.doc(s.db, 'users', otherUid), docSnap => {
          const data = docSnap.data() || {};
          _friendRows.set(otherUid, {
            uid: otherUid,
            name: data.displayName || data.email || 'Player',
            photoURL: data.photoURL || null,
            presenceState: data.presenceState || 'offline',
            lastSeenAt: Number(data.lastSeenAt || 0),
          });
          _emit();
        });
        _friendDocUnsubs.set(otherUid, unsub);
      });

      _emit();
    });
  }).catch(() => cb([]));

  return () => {
    _unsubFriends();
    for (const unsub of _friendDocUnsubs.values()) unsub();
    _friendDocUnsubs.clear();
    _friendRows.clear();
  };
}

export function subscribeFriendRequests(user, cb) {
  const uid = user?.uid;
  if (!uid) return () => {};

  let _unsub = () => {};
  const _profileUnsubs = new Map();
  const _rows = new Map();

  function _emit() {
    const rows = [..._rows.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    cb(rows);
  }

  getFirebaseServices().then(s => {
    const q = s.query(
      s.collection(s.db, 'friends'),
      s.where('addresseeUid', '==', uid),
      s.where('status', '==', 'pending'),
    );

    _unsub = s.onSnapshot(q, snap => {
      const keep = new Set();

      snap.docs.forEach(d => {
        const data = d.data() || {};
        const requesterUid = data.requesterUid;
        if (!requesterUid) return;
        keep.add(d.id);

        const prev = _rows.get(d.id) || {};
        _rows.set(d.id, {
          id: d.id,
          requesterUid,
          requesterName: data.requesterName || prev.requesterName || 'Player',
          requestMatchId: data.lastRequestMatchId || null,
          createdAt: Number(data.createdAt || prev.createdAt || 0),
        });

        if (_profileUnsubs.has(requesterUid)) return;
        const unsubProfile = s.onSnapshot(s.doc(s.db, 'users', requesterUid), userSnap => {
          const u = userSnap.data() || {};
          for (const [rowId, row] of _rows.entries()) {
            if (row.requesterUid !== requesterUid) continue;
            _rows.set(rowId, {
              ...row,
              requesterName: u.displayName || u.email || row.requesterName || 'Player',
            });
          }
          _emit();
        });
        _profileUnsubs.set(requesterUid, unsubProfile);
      });

      for (const rowId of [..._rows.keys()]) {
        if (!keep.has(rowId)) _rows.delete(rowId);
      }

      const activeRequesterUids = new Set([..._rows.values()].map(r => r.requesterUid));
      for (const [requesterUid, unsubProfile] of _profileUnsubs.entries()) {
        if (activeRequesterUids.has(requesterUid)) continue;
        unsubProfile();
        _profileUnsubs.delete(requesterUid);
      }

      _emit();
    });
  }).catch(() => cb([]));

  return () => {
    _unsub();
    for (const unsub of _profileUnsubs.values()) unsub();
    _profileUnsubs.clear();
    _rows.clear();
  };
}

export async function respondFriendRequest(addresseeUser, requestId, action, context = {}) {
  const uid = addresseeUser?.uid;
  if (!uid) throw new Error('Sign-in required.');
  if (!requestId) throw new Error('Request not found.');
  if (action !== 'accept' && action !== 'reject') throw new Error('Invalid action.');

  const s = await getFirebaseServices();
  const ref = s.doc(s.db, 'friends', requestId);
  const snap = await s.getDoc(ref);
  if (!snap.exists()) throw new Error('Friend request not found.');

  const data = snap.data() || {};
  if (data.addresseeUid !== uid) throw new Error('Not allowed.');
  if (data.status !== 'pending') throw new Error('Friend request is not pending.');

  if (action === 'accept') {
    await s.updateDoc(ref, {
      status: 'accepted',
      acceptedAt: s.serverTimestamp(),
      updatedAt: s.serverTimestamp(),
    });
    return;
  }

  const rejectedMatchId = String(context?.matchId || data.lastRequestMatchId || '').trim() || null;
  await s.updateDoc(ref, {
    status: 'rejected',
    rejectedByUid: uid,
    rejectedAt: s.serverTimestamp(),
    rejectedMatchId,
    updatedAt: s.serverTimestamp(),
  });
}

export async function sendVsInvite(senderUser, { targetUid, matchId, inviteCode }) {
  const senderUid = senderUser?.uid;
  if (!senderUid) throw new Error('Sign-in required.');
  if (!targetUid) throw new Error('Target player not found.');
  if (!matchId || !inviteCode) throw new Error('Match invite data missing.');

  const s = await getFirebaseServices();
  const inviteId = `inv_${matchId}_${senderUid}_${targetUid}`;
  await s.setDoc(
    s.doc(s.db, 'vsInvites', inviteId),
    {
      senderUid,
      senderName: _displayName(senderUser),
      targetUid,
      matchId,
      inviteCode,
      status: 'pending',
      createdAt: Date.now(),
      createdAtServer: s.serverTimestamp(),
      updatedAt: s.serverTimestamp(),
    },
    { merge: true },
  );
}

export function subscribeIncomingVsInvites(user, cb) {
  const uid = user?.uid;
  if (!uid) return () => {};

  let _unsub = () => {};
  getFirebaseServices().then(s => {
    const q = s.query(
      s.collection(s.db, 'vsInvites'),
      s.where('targetUid', '==', uid),
      s.where('status', '==', 'pending'),
    );

    _unsub = s.onSnapshot(q, snap => {
      const rows = snap.docs.map(d => {
        const data = d.data() || {};
        return {
          id: d.id,
          senderUid: data.senderUid || '',
          senderName: data.senderName || 'Player',
          targetUid: data.targetUid || uid,
          matchId: data.matchId || '',
          inviteCode: data.inviteCode || '',
          createdAt: Number(data.createdAt || 0),
        };
      }).sort((a, b) => b.createdAt - a.createdAt);
      cb(rows);
    });
  }).catch(() => cb([]));

  return () => _unsub();
}

export async function respondVsInvite(user, inviteId, action) {
  const uid = user?.uid;
  if (!uid) throw new Error('Sign-in required.');
  if (!inviteId) throw new Error('Invite not found.');
  if (action !== 'accept' && action !== 'reject') throw new Error('Invalid invite action.');

  const s = await getFirebaseServices();
  const ref = s.doc(s.db, 'vsInvites', inviteId);
  const snap = await s.getDoc(ref);
  if (!snap.exists()) throw new Error('Invite not found.');

  const data = snap.data() || {};
  if (data.targetUid !== uid) throw new Error('Not allowed.');
  if (data.status !== 'pending') throw new Error('Invite is no longer pending.');

  await s.updateDoc(ref, {
    status: action === 'accept' ? 'accepted' : 'rejected',
    respondedByUid: uid,
    respondedAt: Date.now(),
    respondedAtServer: s.serverTimestamp(),
    updatedAt: s.serverTimestamp(),
  });
}
