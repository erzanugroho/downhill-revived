// The page's online lobby: the race server's public races, Quick Race, Create (public or private),
// Join with a code, and invite links (?join=CODE). It does nothing the game's own ONLINE menu
// (port/hle/online_menu.c) doesn't: it steers that menu as a player would, with the keyboard and
// the mouse, and types the name and the code into its text fields. It knows where the game is from
// the worker's messages: the menu screen (EE 0x0029DED8: 0 the title, 15 the main menu and ONLINE),
// the online menu's trace lines (DHD_ONLINE_MENU_TRACE: "view=V row=R") and its other log lines.

const VK = { left: 0x25, up: 0x26, right: 0x27, down: 0x28, cross: 0x20, triangle: 0x08 };
// online_menu.c's screens and HOME's rows
const VIEW = { HOME: 0, LIST: 1, NAME: 2, CODE: 3, ROOM: 4, QUICK: 5 };
const ROW = { name: 0, quick: 1, create_public: 3, create_private: 4, join: 5 };
const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;  // the server's join codes
const NAME_LETTERS = /[^A-Z0-9 -]/g, NAME_MAX = 12;     // settings_table.h's rider name
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

export function createLobby({ root, events, keys, mouse, canvas, typeText, isRunning, canStart, startGame, server, log }) {
  const $ = sel => root.querySelector(sel);
  const http = server.replace(/^ws/, 'http');
  const game = { menu: -1, view: -1, row: -1, traced: 0, typing: false, discOk: false, room: null, roomPublic: false,
    connecting: false, error: '', riding: false, version: '', tracks: null, name: '' };
  let busy = false, pending = null;

  // ---- what the game says ----
  events.addEventListener('menu', e => { game.menu = e.detail.menu; });
  events.addEventListener('text', e => { game.typing = e.detail.active; });
  events.addEventListener('tracks', e => { game.tracks = e.detail.names; renderList(); });
  events.addEventListener('status', e => { const riding = !!e.detail.riding;
    if (riding !== game.riding && game.room && !busy && !game.error)
      say(riding ? `Racing in room ${game.room}.` : `In room ${game.room}. READY for the next race, or LEAVE.`);
    game.riding = riding; });
  events.addEventListener('log', e => { for (const line of e.detail.text.split('\n')) heard(line); });
  function heard(line) {
    let m;
    if ((m = /online menu: view=(\d+) row=(-?\d+)/.exec(line))) { game.view = +m[1]; game.row = +m[2]; game.traced++; return; }
    if (/online menu: the disc image has the USA disc's game files/.test(line)) game.discOk = true;
    else if (/online menu: the disc image .*(different|can't)/.test(line)) fail("This disc image's game files aren't the USA disc's: it can't race online.");
    else if ((m = /online menu: creating a room \((public|private)\)/.exec(line))) { game.connecting = true; game.roomPublic = m[1] === 'public'; }
    else if ((m = /online menu: joining (\w+)/.exec(line))) { game.connecting = true; game.roomPublic = false; }
    else if ((m = /online menu: room (\w{6})[^,]*, version (.+)/.exec(line))) { game.room = m[1]; game.version = m[2].trim(); game.connecting = false; game.error = ''; renderRoom(); }
    else if ((m = /online menu: in room (\w{6})/.exec(line))) { game.room = m[1]; game.connecting = false; renderRoom(); }
    else if (/online menu: leaving the room/.test(line)) { game.room = null; renderRoom(); say('Left the room.'); }
    else if ((m = /online menu: (?:refused|can't [^:]+): (.+)/.exec(line))) { game.connecting = false; fail(m[1]); }
    else if (/online menu: quick race: no public race to join/.test(line)) fail('No public race to join right now: create one!');
    else if (/online menu: connecting given up/.test(line)) { game.connecting = false; fail('The server did not answer.'); }
  }

  // ---- the player's hands ----
  const hold = async (vk, ms = 110) => { Atomics.store(keys, vk, 1); await sleep(ms); Atomics.store(keys, vk, 0); await sleep(220); };
  // a left click at a fraction of the picture (HostMouse, main.js's layout)
  async function click(fx, fy) {
    Atomics.store(mouse, 0, Math.round(fx * 65536)); Atomics.store(mouse, 1, Math.round(fy * 65536));
    Atomics.store(mouse, 3, 1); Atomics.add(mouse, 4, 1); await sleep(250);
    Atomics.or(mouse, 2, 1); Atomics.add(mouse, 5, 1); await sleep(120); Atomics.and(mouse, 2, ~1); await sleep(300);
    Atomics.store(mouse, 0, -65536); Atomics.add(mouse, 4, 1);  // off the picture, so it hovers nothing
  }
  async function until(test, ms) { const end = performance.now() + ms; while (!test()) { if (performance.now() > end) return false; await sleep(80); } return true; }
  // a key press that moves the online menu's cursor: true once its trace line came
  async function step(vk) { const n = game.traced; await hold(vk); return until(() => game.traced !== n, 1500); }

  // To ONLINE's first screen from wherever the menus are. In the main menu ONLINE is the fourth row:
  // the mouse picks it whatever the cursor (the menus' rows are 4:3 at the picture's centre).
  async function toOnlineHome() {
    for (let tries = 0; tries < 24; tries++) {
      if (game.riding) throw Error('Finish or quit the race first.');
      if (game.room) throw Error('You are in a room: leave it in the game first (LEAVE in the room).');
      if (game.menu === 15 && game.view !== -1 && await step(VK.down)) {   // the online menu answered
        if (game.view === VIEW.HOME) return;
        await hold(VK.triangle); await sleep(600); continue;             // a list or a text field: back
      }
      if (game.menu === 15) {
        const wide = canvas.width / canvas.height, x = 0.5 + 0.248 * (4 / 3) / wide;
        await click(x, 0.665); await sleep(900);
        if (await step(VK.down) && game.view === VIEW.HOME) return;
        continue;
      }
      if (game.menu === 0 || game.menu === -1) { await hold(VK.cross); await sleep(1200); continue; }  // the title
      await hold(VK.triangle); await sleep(900);                          // another menu: back
    }
    throw Error("Couldn't reach the ONLINE menu: open it in the game.");
  }
  async function toRow(row) {
    for (let n = 0; n < 12 && game.row !== row; n++) if (!await step(game.row < row ? VK.down : VK.up)) await sleep(300);
    if (game.row !== row) throw Error('The online menu did not follow.');
  }
  async function typeInto(view, chars) {
    await hold(VK.cross);
    if (!await until(() => game.typing && game.view === view, 3000)) throw Error('The text field did not open.');
    typeText(chars); await until(() => !game.typing, 3000);
  }

  // ---- what the player asks for ----
  async function run(intent) {
    if (busy) return;
    if (!isRunning()) {
      pending = intent; renderPending();
      if (!canStart()) { say('Choose your .iso first: the lobby goes on once the game starts.'); return; }
      startGame(); return;
    }
    busy = true; game.error = ''; render();
    try {
      say('Opening ONLINE…');
      await toOnlineHome();
      if (!game.discOk) { say('Checking your disc image (once)…'); if (!await until(() => game.discOk || game.error, 120000)) throw Error('The disc check takes too long.'); }
      if (game.error) throw Error(game.error);
      const name = cleanName($('#lobbyName').value);
      if (name && name !== game.name) {  // the game keeps it in dhd.ini; typed once per game start
        say('Setting your rider name…'); await toRow(ROW.name);
        await typeInto(VIEW.NAME, [...Array(NAME_MAX + 1).fill(8), ...[...name].map(c => c.charCodeAt(0)), 13]);
        game.name = name; await sleep(400);
      }
      say(intent.join ? `Joining ${intent.join}…` : intent.quick ? 'Looking for a public race…' : 'Creating the room…');
      if (intent.join) { await toRow(ROW.join); await typeInto(VIEW.CODE, [...[...intent.join].map(c => c.charCodeAt(0)), 13]); }
      else { await toRow(intent.quick ? ROW.quick : intent.public ? ROW.create_public : ROW.create_private); await hold(VK.cross); }
      if (!await until(() => game.room || game.error, 20000)) throw Error('No answer from the server yet: see the game.');
      if (game.error) throw Error(game.error);
      say(`In room ${game.room}. Pick your rider in the game, then READY.`);
    } catch (e) { fail(e.message); }
    finally { busy = false; render(); }
  }
  const cleanName = s => s.toUpperCase().replace(NAME_LETTERS, '').slice(0, NAME_MAX).trim();
  function say(text) { $('#lobbyStatus').textContent = text; $('#lobbyStatus').classList.remove('bad'); }
  function fail(text) { game.error = text; $('#lobbyStatus').textContent = text; $('#lobbyStatus').classList.add('bad'); log?.(`lobby: ${text}`); }

  // ---- the page ----
  const invite = code => `${location.origin}${location.pathname}?join=${code}`;
  const copy = (text, button) => navigator.clipboard?.writeText(text).then(() => {
    const was = button.textContent; button.textContent = 'Copied'; setTimeout(() => { button.textContent = was; }, 1400); }).catch(() => prompt('Copy:', text));
  function render() {
    root.querySelectorAll('[data-act]').forEach(b => { b.disabled = busy; });
    renderRoom(); renderPending();
  }
  function renderRoom() {
    const box = $('#lobbyRoom'); box.hidden = !game.room;
    if (!game.room) return;
    $('#lobbyCode').textContent = game.room;
    $('#lobbyKind').textContent = game.roomPublic ? 'Public room' : 'Private room';
  }
  function renderPending() {
    const p = $('#lobbyPending');
    p.hidden = !pending || isRunning();
    if (pending) p.textContent = pending.join ? `Invited to room ${pending.join}: choose your .iso, then Start.` :
      'Choose your .iso, then Start: the lobby goes on by itself.';
  }

  // the public races, every 5 s while the page is shown
  let list = [], listFailed = false;
  const phase = r => r.phase === 'racing' || r.raceStartedAt ? 'racing' : r.phase === 'countdown' ? 'starting' : 'in the room';
  function renderList() {
    const ul = $('#lobbyList'); ul.replaceChildren();
    $('#lobbyCount').textContent = listFailed ? 'server not reachable' : list.length ? `${list.length} open` : 'none right now';
    for (const r of list) {
      const li = document.createElement('li'), other = game.version && r.version && r.version !== game.version;
      const full = r.full || r.players >= r.maxPlayers;
      const track = game.tracks?.[r.track] || (r.track !== undefined ? `Track ${r.track}` : '');
      li.innerHTML = `<div><strong></strong><small></small></div><button class="ghost" type="button" data-act><span>Join</span></button>`;
      li.querySelector('strong').textContent = r.roomName || r.hostName || r.code;
      li.querySelector('small').textContent = [`${r.players}/${r.maxPlayers}`, track, phase(r), r.region].filter(Boolean).join(' · ');
      const b = li.querySelector('button'); b.disabled = busy || full || other;
      if (full || other) b.querySelector('span').textContent = full ? 'Full' : 'Other version';
      b.onclick = () => run({ join: r.code });
      ul.append(li);
    }
  }
  async function refresh() {
    if (document.hidden) return;
    try { const r = await fetch(`${http}/v1/lobbies`, { cache: 'no-store' }); const j = await r.json(); list = j.lobbies || []; listFailed = false; }
    catch { listFailed = true; }
    renderList();
  }
  refresh(); setInterval(refresh, 5000);

  // controls
  const nameField = $('#lobbyName'); nameField.value = store.get('dhd-lobby-name') || '';
  nameField.oninput = () => { const v = cleanName(nameField.value); store.set('dhd-lobby-name', v); };
  nameField.onblur = () => { nameField.value = cleanName(nameField.value); };
  const codeField = $('#lobbyJoinCode');
  codeField.oninput = () => { codeField.value = codeField.value.toUpperCase().replace(/[^23456789A-HJ-NP-Z]/g, '').slice(0, 6); };
  $('#lobbyJoinForm').onsubmit = e => { e.preventDefault();
    if (!CODE.test(codeField.value)) { fail('A join code is 6 letters and digits.'); return; }
    run({ join: codeField.value }); };
  $('#lobbyQuick').onclick = () => run({ quick: true });
  $('#lobbyPublic').onclick = () => run({ public: true });
  $('#lobbyPrivate').onclick = () => run({ public: false });
  $('#lobbyCopyLink').onclick = e => copy(invite(game.room), e.currentTarget);
  $('#lobbyCopyCode').onclick = e => copy(game.room, e.currentTarget);

  // an invite link: ?join=CODE
  const invited = new URLSearchParams(location.search).get('join')?.toUpperCase();
  if (invited && CODE.test(invited)) { codeField.value = invited; pending = { join: invited }; root.classList.add('open'); }
  render();

  return {
    // main.js: the game is up (the worker said 'running'): a pending action goes on
    started() { renderPending(); if (pending) { const p = pending; pending = null; setTimeout(() => run(p), 500); } },
  };
}
