
// v5.5.2 – Anonymous can only CREATE results; all other writes admin-only.
// Admin is detected via UID/email; legacy password removed.
// IMPORTANT: Enforce "create only" for anonymous in Firestore SECURITY RULES.
const ADMIN_UIDS = ['BGNfBBwFqFN82v5nmjj7iqa4ljx2'];
const ADMIN_EMAILS = []; // optional: add specific admin emails

const db = firebase.firestore();
const auth = firebase.auth();

const MATCHES_COL = 'matches';
const RESULTS_COL = 'results';
const PLAYERS_COL = 'players';

let schedule = [];
let results = {};
let playersMap = {}; // { [playerName]: { phone } }

let unsubMatches = null, unsubResults = null, unsubPlayers = null;
let isAdmin = false;

window.addEventListener('DOMContentLoaded', () => {
  const enterSection = document.getElementById('enter');
  enterSection.querySelector('.collapsible-header').onclick = () => {
    enterSection.classList.toggle('open');
  };

  document.getElementById('uploadScheduleBtn').onclick = uploadScheduleToFirestore;
  document.getElementById('resetScheduleBtn').onclick = deleteAllResults;
  document.getElementById('saveScore').onclick = saveScore;
  document.getElementById('deleteResultBtn').onclick = deleteCurrentResult;

  document.getElementById('emailSignInBtn').onclick = emailSignIn;
  document.getElementById('emailSignOutBtn').onclick = emailSignOut;

  document.querySelector('#standingsTable tbody').addEventListener('click', onStandingsClick);
  document.querySelector('#standingsTable tbody').addEventListener('click', onStandingsPhoneClick);

  auth.onAuthStateChanged((user) => {
    updateAdminUI(user);
    startRealtime();
  });
});

function updateAdminUI(user) {
  const statusEl = document.getElementById('authStatus');

  if (user && !user.isAnonymous) {
    statusEl.textContent = `Signed in as ${user.email || user.uid}`;
  } else if (user && user.isAnonymous) {
    statusEl.textContent = 'Not signed in (anonymous viewer)';
  } else {
    statusEl.textContent = 'Not signed in';
  }

  const allowed = !!(user && ((ADMIN_UIDS.includes(user.uid)) ||
    (user.email && ADMIN_EMAILS.includes(user.email))));
  isAdmin = allowed;

  document.getElementById('adminPanel').style.display = isAdmin ? 'block' : 'none';
}

async function emailSignIn() {
  const email = (document.getElementById('adminEmail').value || '').trim();
  const pass = (document.getElementById('adminPassword').value || '').trim();
  if (!email || !pass) { alert('Enter email and password'); return; }
  try { await auth.signInWithEmailAndPassword(email, pass); }
  catch (e) { alert('Sign-in failed: ' + (e && e.message ? e.message : e)); }
}

async function emailSignOut() {
  try { await auth.signOut(); } catch (e) { console.warn(e); }
  try { await auth.signInAnonymously(); } catch (e) { console.warn(e); }
}

function startRealtime() {
  if (unsubMatches) unsubMatches();
  if (unsubResults) unsubResults();
  if (unsubPlayers) unsubPlayers();

  unsubMatches = db.collection(MATCHES_COL).orderBy('round').onSnapshot(snap => {
    schedule = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    populateMatchList();
    renderMatchesTable();
    recomputeStandings();
    renderStandings();
  });

  unsubResults = db.collection(RESULTS_COL).onSnapshot(snap => {
    results = {};
    snap.forEach(doc => { results[doc.id] = doc.data(); });
    renderMatchesTable();
    recomputeStandings();
    renderStandings();
    const idx = document.getElementById('matchSelect').value;
    if (idx) onSelectMatch();
  });

  unsubPlayers = db.collection(PLAYERS_COL).onSnapshot(snap => {
    playersMap = {};
    snap.forEach(doc => { playersMap[doc.id] = doc.data(); });
    renderStandings();
  });
}

function splitTeam(teamStr) {
  return (teamStr || '').split('&').map(x => x.trim()).filter(Boolean);
}
function joinTeam(players) { return players.join(' & '); }
function replacePlayerInTeam(teamStr, originalName, newName) {
  const arr = splitTeam(teamStr).map(p => (p === originalName ? newName : p));
  return joinTeam(arr);
}

function populateMatchList() {
  const select = document.getElementById('matchSelect');
  select.innerHTML = '<option value="">— Select a match —</option>';
  schedule.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `Round ${m.round ?? ''}: ${m.team1} vs ${m.team2}`;
    select.appendChild(opt);
  });
  select.onchange = onSelectMatch;
}

function onSelectMatch() {
  const matchId = document.getElementById('matchSelect').value;
  const inputs = document.getElementById('scoreInputs');
  const enter = document.getElementById('enter');
  enter.classList.add('open');

  if (!matchId) {
    inputs.classList.add('hidden');
    document.getElementById('previousResult').innerHTML = '';
    return;
  }

  const m = schedule.find(x => x.id === matchId);
  if (!m) return;

  document.getElementById('team1Label').textContent = m.team1;
  document.getElementById('team2Label').textContent = m.team2;
  inputs.classList.remove('hidden');

  const prev = document.getElementById('previousResult');
  const existing = results[matchId];
  if (existing) {
    prev.innerHTML = `Previously entered: <strong>${existing.set.team1}-${existing.set.team2}</strong>`;
    document.getElementById('team1Score').value = existing.set.team1;
    document.getElementById('team2Score').value = existing.set.team2;
  } else {
    prev.innerHTML = '';
    document.getElementById('team1Score').value = '';
    document.getElementById('team2Score').value = '';
  }
}

async function saveScore() {
  const matchId = document.getElementById('matchSelect').value;
  if (!matchId) return alert('Select a match');

  const s1 = Number(document.getElementById('team1Score').value);
  const s2 = Number(document.getElementById('team2Score').value);
  if (!Number.isFinite(s1) || !Number.isFinite(s2)) return alert('Enter valid numbers');
  if (s1 === s2) return alert('Scores cannot be tied');

  const ref = db.collection(RESULTS_COL).doc(matchId);
  const payload = {
    set: { team1: s1, team2: s2 },
    winnerTeam: s1 > s2 ? 'team1' : 'team2',
    submittedBy: (firebase.auth().currentUser?.uid) || 'anon',
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    if (isAdmin) {
      // Admins can create or overwrite
      await ref.set(payload, { merge: true });
      alert('Match saved (admin)');
    } else {
      // Anonymous viewers: attempt SET; rules must allow create and reject update
      await ref.set(payload, { merge: false });
      alert('Match submitted');
    }
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    if (
      !isAdmin &&
      (/already exists/i.test(msg) ||
        /PERMISSION_DENIED|Missing or insufficient permissions/i.test(msg))
    ) {
      alert('A result is already recorded for this match. Please contact an admin for corrections.');
    } else {
      alert('Save failed: ' + msg);
    }
  }
}

async function deleteCurrentResult() {
  const matchId = document.getElementById('matchSelect').value;
  if (!matchId) return alert('Select a match');
  if (!results[matchId]) return alert('No result to delete');
  if (!confirm('Delete this match result?')) return;
  await db.collection(RESULTS_COL).doc(matchId).delete();
}

function renderMatchesTable() {
  const tbody = document.querySelector('#matchesTable tbody');
  tbody.innerHTML = '';

  schedule.forEach(m => {
    const r = results[m.id];
    const isDone = !!r;
    const setText = isDone ? `${r.set.team1}-${r.set.team2}` : '-';
    const statusHTML = isDone
      ? `<span class="badge badge-success"><span class="dot"></span>Completed</span>`
      : `<span class="badge badge-muted"><span class="dot"></span>Not played</span>`;

    // Only admins see the Delete button
    const deleteBtn = isAdmin ? `clearDelete</button>` : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.round ?? ''}</td>
      <td>${m.team1} <span class="vs">vs</span> ${m.team2}</td>
      <td><strong>${setText}</strong></td>
      <td>${statusHTML}</td>
      <td>
        editEdit</button>
        ${deleteBtn}
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      document.getElementById('matchSelect').value = id;
      onSelectMatch();

      if (btn.getAttribute('data-action') === 'clear' && results[id]) {
        if (confirm('Delete this match result?')) {
          await db.collection(RESULTS_COL).doc(id).delete();
        }
      }
    };
  });
}

function recomputeStandings() {
  const s = {};
  function ensure(p) { if (!s[p]) s[p] = { Player: p, Pts: 0, MP: 0, W: 0, Raw: 0, L: 0 }; }

  schedule.forEach(m => {
    const t1 = splitTeam(m.team1);
    const t2 = splitTeam(m.team2);
    [...t1, ...t2].forEach(ensure);
  });

  Object.entries(results).forEach(([id, r]) => {
    const m = schedule.find(x => x.id === id);
    if (!m) return;

    const t1 = splitTeam(m.team1);
    const t2 = splitTeam(m.team2);

    [...t1, ...t2].forEach(p => s[p].MP += 1);

    const winners = r.winnerTeam === 'team1' ? t1 : t2;
    const losers = r.winnerTeam === 'team1' ? t2 : t1;
    winners.forEach(p => { s[p].W += 1; s[p].Pts += 1; });
    losers.forEach(p => { s[p].L += 1; });

    const gamesT1 = Number(r.set?.team1 || 0);
    const gamesT2 = Number(r.set?.team2 || 0);
    t1.forEach(p => { s[p].Raw += gamesT1; });
    t2.forEach(p => { s[p].Raw += gamesT2; });
  });

  window.___standings = s;
}

function renderStandings() {
  const s = window.___standings || {};
  const rows = Object.values(s).sort((a, b) =>
    (b.Pts - a.Pts) ||
    (b.W - a.W) ||
    a.Player.localeCompare(b.Player)
  );

  const tbody = document.querySelector('#standingsTable tbody');
  tbody.innerHTML = '';

  rows.forEach((r, i) => {
    const phoneRaw = playersMap[r.Player]?.phone || '';
    const digits = (phoneRaw.match(/\d+/g) || []).join('');
    const waLink = digits ? `https://wa.me/${digits}` : '';
    const phoneHTML = digits
      ? `${waLink}${phoneRaw}</a>`
      : (isAdmin ? `<button class="add-phone" data-player="${r.Player}">+ add</button>` : '');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="player-cell" data-orig="${r.Player}" title="${isAdmin ? 'Click to rename' : ''}" style="text-align:left; cursor:${isAdmin ? 'pointer' : 'default'}">${r.Player}</td>
      <td class="phone-cell" data-player="${r.Player}" style="text-align:left">${phoneHTML}</td>
      <td><strong>${r.Pts}</strong></td>
      <td>${r.MP}</td>
      <td>${r.W}</td>
      <td>${r.Raw}</td>
      <td>${r.L}</td>
    `;
    tbody.appendChild(tr);
  });
}

function onStandingsClick(e) {
  if (!isAdmin) return;
  const td = e.target.closest('td.player-cell');
  if (!td) return;

  const original = (td.getAttribute('data-orig') || '').trim();
  if (!original) return;

  const proposed = prompt(`Rename player "${original}" to:`, '');
  if (proposed == null) return;

  const newName = proposed.trim();
  if (!newName || newName === original) return;

  renamePlayerAcrossMatches(original, newName);
}

function onStandingsPhoneClick(e) {
  if (!isAdmin) return;

  const addBtn = e.target.closest('button.add-phone');
  if (addBtn) {
    const player = addBtn.getAttribute('data-player');
    return setOrEditPhone(player);
  }

  const td = e.target.closest('td.phone-cell');
  if (td && e.target.tagName !== 'A') {
    const player = td.getAttribute('data-player');
    if (player) return setOrEditPhone(player);
  }
}

async function setOrEditPhone(playerName) {
  const current = playersMap[playerName]?.phone || '';
  const promptMsg = `Enter ${playerName}'s phone in international format (digits only, e.g., 17135551234).\nLeave empty to remove.`;
  const input = prompt(promptMsg, current);
  if (input == null) return;

  const digits = (input.match(/\d+/g) || []).join('');
  const ref = db.collection(PLAYERS_COL).doc(playerName);

  if (!digits) {
    if (current && confirm(`Clear phone for ${playerName}?`)) await ref.delete();
    return;
  }

  await ref.set({ phone: digits, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

async function renamePlayerAcrossMatches(originalName, newName) {
  const affected = [];

  for (const m of schedule) {
    const t1 = splitTeam(m.team1);
    const t2 = splitTeam(m.team2);
    const hasInT1 = t1.includes(originalName);
    const hasInT2 = t2.includes(originalName);
    if (!hasInT1 && !hasInT2) continue;

    const newTeam1 = hasInT1 ? replacePlayerInTeam(m.team1, originalName, newName) : m.team1;
    const newTeam2 = hasInT2 ? replacePlayerInTeam(m.team2, originalName, newName) : m.team2;

    const dupInT1 = splitTeam(newTeam1).length !== new Set(splitTeam(newTeam1)).size;
    const dupInT2 = splitTeam(newTeam2).length !== new Set(splitTeam(newTeam2)).size;
    if ((dupInT1 || dupInT2) && !confirm(
      `Warning: renaming may create duplicate players in a team for match ${m.id}.\nProceed anyway?`
    )) { continue; }

    affected.push({ id: m.id, newTeam1, newTeam2 });
  }

  if (affected.length === 0) { alert(`No matches found with player "${originalName}".`); return; }
  if (!confirm(`Update ${affected.length} match(es) to rename "${originalName}" -> "${newName}"?`)) { return; }

  try {
    const CHUNK = 400;
    for (let i = 0; i < affected.length; i += CHUNK) {
      const batch = db.batch();
      const slice = affected.slice(i, i + CHUNK);
      slice.forEach(({ id, newTeam1, newTeam2 }) => {
        const ref = db.collection(MATCHES_COL).doc(String(id));
        batch.update(ref, { team1: newTeam1, team2: newTeam2 });
      });
      await batch.commit();
    }

    alert(`Renamed "${originalName}" to "${newName}" in ${affected.length} match(es).`);

    // Move phone mapping if exists
    try {
      const oldRef = db.collection(PLAYERS_COL).doc(originalName);
      const snap = await oldRef.get();
      if (snap.exists) {
        const data = snap.data() || {};
        const newRef = db.collection(PLAYERS_COL).doc(newName);
        await newRef.set(data, { merge: true });
        await oldRef.delete();
      }
    } catch (e) {
      console.warn('Phone mapping move failed:', e);
    }
  } catch (err) {
    console.error('Rename failed:', err);
    alert('Failed to rename: ' + (err && err.message ? err.message : err));
  }
}

async function uploadScheduleToFirestore() {
  const file = document.getElementById('scheduleUpload').files[0];
  if (!file) return alert('Choose a schedule .json file');

  const text = await file.text();
  let arr; try { arr = JSON.parse(text); } catch { return alert('Invalid JSON'); }
  if (!Array.isArray(arr)) return alert('Invalid format: expected an array');

  if (!confirm('This will overwrite the current matches collection and clear all results. Continue?')) return;

  const batchSize = 400;

  async function clearCollection(col) {
    const snap = await db.collection(col).get();
    const chunks = []; let cur = [];
    snap.forEach(d => { cur.push(d); if (cur.length >= batchSize) { chunks.push(cur); cur = []; } });
    if (cur.length) chunks.push(cur);
    for (const group of chunks) {
      const batch = db.batch();
      group.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  }

  await clearCollection(MATCHES_COL);
  await clearCollection(RESULTS_COL);

  const batch = db.batch();
  arr.forEach((m, idx) => {
    const id = String(idx);
    const ref = db.collection(MATCHES_COL).doc(id);
    batch.set(ref, { round: m.round, team1: m.team1, team2: m.team2 });
  });
  await batch.commit();

  alert('Schedule uploaded to Firestore');
}

async function deleteAllResults() {
  if (!confirm('Delete ALL results from Firestore?')) return;
  const snap = await db.collection(RESULTS_COL).get();
  const batch = db.batch();
  snap.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  alert('All results deleted');
}
