# 144: Online races in the browser

Finding 143 turned online off in the browser: the official page's CSP (`connect-src 'self'`) blocks
the race server's socket, so it never worked there. This turns it back on for a page hosted with a
CSP that allows the server.

## What changed

- `port/web/www/net.js`: `ONLINE_OFFERED = true`. The core shows the ONLINE row; `online: false`
  still makes every connection refuse (`check_net.mjs` tests both).
- `port/web/www/worker.js`: `DHD_NET_SERVER` defaults to the official server (online_menu.c shows
  "No server" without it); `?env.DHD_NET_SERVER=` picks another. The disc image's online check,
  `host_service_disc_check_start` / `_poll`, which the browser lacked, runs `disc_check.js` in a
  worker of its own and answers as host_sdl.c's job does.
- `port/web/www/disc_check.js`: `port/render/disc/src/lib.rs` (`entries`, `record`, `hash`) in JS,
  each file's contents through `crypto.subtle` (the largest USA file is about 105 MB). The answer
  for a File (name, size, last write) is kept in IndexedDB (`dhd-disc-check`), as iso-check.txt
  natively. No `usa_files.bin`: the note for another image says only that its files differ.
- `port/web/www/_headers`: Cloudflare Pages headers, cross-origin isolation and the official CSP
  with `connect-src 'self' wss://dhd.skuza.app https://dhd.skuza.app`. `serve.mjs` sends the same.

## How it was checked

- `node --test port/web/check_net.mjs`: 3 pass.
- `filesHash` in node on a USA image: `c8c17bca...3476`, 2338 files, the value online_menu.c and
  the server take (4.5 s).
- `serve.mjs --iso` with the browser build of 0.7.8 and `?iso=test`: the main menu has ONLINE; the
  check logs "the disc image has the USA disc's game files ... checked now"; PUBLIC RACES lists
  the official server's rooms; CREATE A PRIVATE RACE made a room and reached the rider choice.
- A race between two browsers: below (the lobby). Not checked yet: a browser against a native game.

## Text fields in the browser

`host_service_text_input_begin` / `_end` were no-ops and `host_service_text_input_edit` was missing:
YOUR NAME or JOIN WITH A CODE stopped the browser game ("unsupported service"). `worker.js` now
keeps port/hle/text_input.c's field: the page sends what is typed while a field is open (`text` messages from
main.js; Enter 13, Escape 27, Backspace 8, Ctrl+V the clipboard's text), the field takes the
characters its alphabet allows, and the letter keys don't reach the pad meanwhile (the arrows still
work the letter picker). `host_service_clipboard_set` (COPY CODE in the room) goes to the page's
clipboard.

## The page's lobby (`www/lobby.js`)

Beside the picture (a panel behind a Lobby button in a narrow window): the rider name, Quick race,
Create public, Create private, Join with a code, the server's public races (`/v1/lobbies` every 5 s,
with the track's name from the game's own table in EE RAM, `trackNames()` in worker.js), and, in a
room, its code with Copy invite link (`?join=CODE`). An invite link opens the page with the code
filled in; once the disc is chosen and the game starts, it joins.

It adds no online code: it plays the game's ONLINE menu as a player would. The worker reports the
menu screen (EE 0x0029DED8: 0 the title, 15 the main menu and ONLINE) and the online menu runs with
`DHD_ONLINE_MENU_TRACE=1`, whose "view=V row=R" lines say its screen and cursor after every key. The
lobby presses Cross on the title, clicks ONLINE with the mouse (whatever the main menu's cursor),
answers with the arrows until the row is the one it wants, waits for the disc check, types the name
and the code into the text fields above, and reads the outcome from the menu's log lines (room,
refused, no public race). It won't steer during a race or while in a room (LEAVE first).

Checked in the browser (two tabs, the official server): Create private from the title reached the
room in 16 s; a second tab opened with `?join=CODE` joined it in 21 s; the room showed both riders
by their lobby names; both readied, the host's countdown started the race, and both rode it as puppet
riders of each other at 60 fields/s.

## Touch controls (`www/touch.js`)

Finding 141's touch controls are host C (`touch.c`, `touch_host.c`) and the Rust overlay, none of
which the browser modules have. The page gets its own on-screen PS2 pad instead, plain pad input
as the Classic pad preset: a stick (the left stick; in the menus, pushed past half way, the d-pad
too, by the worker's riding word), ✕ ○ □ △, L1/L2/R1/R2, SELECT and START, multi-touch with
slide-on between buttons, merged into player 1's pad with a gamepad's. It shows on a coarse
pointer (`?touch=1` / `?touch=0` decide instead); while the game runs the picture then fills the
screen letterboxed, the bars hide, ☰ opens the lobby and ⛶ takes the whole page fullscreen in
landscape. A tap on the picture stays the menus' pointer.

Checked in headless Chrome at 844x390 with touch emulation and real touch events
(`Input.dispatchTouchEvent`): ✕ left the title, three stick pushes moved the main menu to
ONLINE, ✕ opened it and △ came back. Not checked on a phone: a phone needs Chrome 137 or later
(JSPI) with WebGPU, and the speed of this build there is unknown (the Android APK is the phone
build).

## Speed in the browser (this PC: i5-13400F, RTX 3090, headless Chrome)

`check_browser.mjs` with race_compare's NAV, pad and seed; fields/s per phase from the page's
status, two runs each:

| phase | fields/s |
|---|---|
| title flyover (fields 500-1000) | 54.1, 54.2 (lowest 45) |
| menus (1000-2500) | 60.0, 60.0 |
| race countdown (3000-3600) | 58.9, 57.4 |
| race (3700-4600) | 59.0, 58.9 (one second at 45) |

Scale 1 instead of 2 changes nothing (59.9 in the race, 55 on the title): the CPU is the limit.
`check_browser.mjs --profile F S` now profiles every worker (the VU and GS workers are nested in
the game worker): on the title the VU worker is saturated, `run_micro` (VU1 interpreted) 73% of it,
while the game worker waits on it 89% of the time. In the race the game worker waits 30-36% and
the VU worker is about 64% busy. So the next speed step is VU1 (finding 089's items 4 and 10),
which needs the browser modules rebuilt (`build_graphics.py`, from the player's own `assets/`).

## Hosting

The page is `port/web/www` with `build/web` as its `build/` folder (`python port/web/build.py`, or
the same modules of the matching release's official page). `port/web/stage.mjs` copies both into
`build/pages`; on Cloudflare it is a Worker's static assets (`port/web/wrangler.jsonc`, no script),
which keep `_headers`, and static asset requests cost nothing on the free plan:

    node port/web/stage.mjs
    npx wrangler login
    npx wrangler deploy -c port/web/wrangler.jsonc

`wrangler pages project create` (wrangler 4.157) now hands new Pages projects to Workers and fails
for a folder like this one, hence the Worker. Checked on the deployed page: the headers above,
`crossOriginIsolated`, every module served (`application/wasm`), the lobby's list from the
official server, `?join=CODE` filled in. The site's own `/assets` (fonts, the evening backdrop,
favicon) aren't part of the page: it falls back to system fonts and the plain night colour.

The browser's speed (finding 087: about 25-45 fields/s) is unchanged; with `DHD_FPS_WALL=1`
(finding 139) a slow PC runs fewer, longer updates at the game's speed rather than slow motion.
