// ICH HAB NOCH NIE – Deno-Server: statische Dateien + WebSocket + Rundenlogik.
// Keine Abhängigkeiten, kein Build-Schritt. `deno task dev` oder direkt:
//   deno run --allow-net --allow-read --allow-env --allow-sys server.js

import { MODI, stapelFuer } from "./karten.js";
import {
  absender,
  darfRaumOeffnen,
  darfVerbinden,
  raumVermerkt,
  verbindungAuf,
  verbindungZu,
} from "./bremse.js";

const PORT = Number(Deno.env.get("PORT") ?? 8076);
const HOST = Deno.env.get("HOST") ?? "0.0.0.0";

const PUBLIC = new URL("./public/", import.meta.url);

// ---------------------------------------------------------------------------
// Spielkonstanten
// ---------------------------------------------------------------------------

// Acht statt vier wie in den anderen Spielen: hier sitzt niemand vor einer
// Spielfläche, sondern alle um einen Tisch. Zu viert ist eine Runde in zwei
// Minuten durch.
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

// Gleiche Werte und gleiche Regel wie in den anderen vier Spielen:
// ROOM_IDLE_MS ist der Puffer fürs Link-Teilen (dafür muss man den Tab
// verlassen, und auf dem Handy stirbt dabei der Socket), SEAT_GRACE_MS hält
// einen Platz nur während einer laufenden Partie frei.
const ROOM_IDLE_MS = 5 * 60_000;
const SEAT_GRACE_MS = 60_000;

const RUNDEN_OPTIONEN = [8, 12, 20, 0]; // 0 = ohne festes Ende

// ---------------------------------------------------------------------------
// Räume
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rooms = new Map();

// Sockets, die gerade auf der Startseite stehen und die Raumliste sehen wollen.
const browsing = new Set();

function newCode() {
  for (let i = 0; i < 500; i++) {
    let c = "";
    for (let k = 0; k < 4; k++) {
      c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(c)) return c;
  }
  return "R" + Date.now().toString(36).slice(-3).toUpperCase();
}

const token = () => crypto.randomUUID();

/** Einmal anlegen, nicht bei jedem Namen neu - das Ding ist teuer. */
const ZEICHEN = new Intl.Segmenter("de", { granularity: "grapheme" });

function cleanName(raw) {
  // Steuerzeichen raus, sonst zerlegt ein Zeilenumbruch im Namen das Layout.
  const s = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  // Nach *Zeichen* kuerzen, nicht nach Code-Einheiten. `s.slice(0, 12)` zaehlt
  // UTF-16-Einheiten, und ein Emoji besteht aus zweien: abgeschnitten wurde
  // mitten im Zeichen, und im Raum stand ein Ersatzzeichen. Zweite Grenze bei
  // 48 Code-Einheiten gegen gestapelte Kombinationszeichen - abgebrochen wird
  // zwischen zwei Zeichen, nie mittendrin. Gleiche Fassung wie in raum.js.
  let kurz = "";
  for (const z of [...ZEICHEN.segment(s)].slice(0, 12)) {
    if (kurz.length + z.segment.length > 48) break;
    kurz += z.segment;
  }
  return kurz || "Spieler";
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function createRoom(isPublic) {
  const room = {
    code: newCode(),
    isPublic: !!isPublic,
    phase: "lobby",
    hostId: null,
    players: new Map(),
    settings: { rounds: 12, modus: "gemischt", wahl: "zufall" },
    deck: [],          // Reststapel, wird bei Bedarf neu gemischt
    beutel: [],        // wer in diesem Durchlauf noch nicht dran war
    letzterDran: null,
    rundeNr: 0,
    aktuell: null,
    timers: new Set(),
    idleTimer: null,
    lastActivity: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

/**
 * Ein Raum, in dem niemand mehr sitzt, wird nicht sofort abgeräumt – sonst wäre
 * er genau dann weg, wenn man gerade den Link verschickt.
 */
function scheduleIdleClose(room) {
  if (room.idleTimer) clearTimeout(room.idleTimer);
  room.idleTimer = setTimeout(() => {
    if (room.players.size === 0) destroyRoom(room);
  }, ROOM_IDLE_MS);
}

function cancelIdleClose(room) {
  if (room.idleTimer) { clearTimeout(room.idleTimer); room.idleTimer = null; }
}

function clearTimers(room) {
  for (const id of room.timers) clearTimeout(id);
  room.timers.clear();
}

function destroyRoom(room) {
  clearTimers(room);
  cancelIdleClose(room);
  for (const p of room.players.values()) {
    if (p.dropTimer) clearTimeout(p.dropTimer);
  }
  rooms.delete(room.code);
  pushRoomList();
}

/**
 * Der Host ist immer jemand, der auch da ist. Geht er raus oder ist seine
 * Verbindung weg, rückt der nächste Anwesende nach.
 */
function ensureHost(room) {
  const current = room.players.get(room.hostId);
  if (current?.connected) return;
  const all = [...room.players.values()];
  const next = all.find((p) => p.connected) ?? all[0];
  room.hostId = next ? next.id : null;
}

const anwesende = (room) => [...room.players.values()].filter((p) => p.connected);

// ---------------------------------------------------------------------------
// Senden
// ---------------------------------------------------------------------------

function send(player, msg) {
  const ws = player.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* Verbindung stirbt gleich sowieso */ }
  }
}

function raw(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* egal */ }
  }
}

function broadcast(room, msg) {
  for (const p of room.players.values()) send(p, msg);
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    erwischt: p.erwischt,
    rein: p.rein,
    ready: p.ready,
    connected: p.connected,
    host: p.id === room.hostId,
  }));
}

function roomState(room) {
  return {
    t: "room",
    code: room.code,
    isPublic: room.isPublic,
    phase: room.phase,
    hostId: room.hostId,
    settings: room.settings,
    players: publicPlayers(room),
    rundeNr: room.rundeNr,
    maxPlayers: MAX_PLAYERS,
  };
}

function pushState(room) {
  broadcast(room, roomState(room));
  if (room.isPublic) pushRoomList();
}

// Offene Räume für die Startseite.
function roomList() {
  // Gezählt und gefiltert wird nach *verbundenen* Spielern – sonst steht ein
  // Raum, dessen Leute alle weg sind, noch mit „0/8" in der Liste.
  return [...rooms.values()]
    .map((r) => ({ room: r, count: anwesende(r).length }))
    .filter(({ room, count }) =>
      room.isPublic && room.phase === "lobby" &&
      count > 0 && room.players.size < MAX_PLAYERS
    )
    .map(({ room, count }) => ({
      code: room.code,
      host: room.players.get(room.hostId)?.name ?? "?",
      count,
      max: MAX_PLAYERS,
      modus: room.settings.modus,
    }))
    .sort((a, b) => b.count - a.count);
}

function pushRoomList() {
  const msg = { t: "rooms", rooms: roomList() };
  for (const ws of browsing) raw(ws, msg);
}

// ---------------------------------------------------------------------------
// Kartenstapel
// ---------------------------------------------------------------------------

/**
 * Zieht eine Karte. Innerhalb einer Partie wiederholt sich nichts, bis der
 * Stapel durch ist – das ist der ganze Grund, warum die Karte vom Server kommt
 * und nicht jeder Client selbst würfelt.
 */
function zieheKarte(room) {
  if (!room.deck.length) room.deck = shuffle(stapelFuer(room.settings.modus));
  return room.deck.pop() ?? null;
}

// ---------------------------------------------------------------------------
// Wer ist dran?
// ---------------------------------------------------------------------------

/**
 * Zwei Verfahren, beide mit derselben Zusicherung: niemand kommt zweimal dran,
 * bevor nicht alle einmal dran waren. Bei „zufall" macht das der Beutel – ohne
 * ihn trifft es an einem Abend erfahrungsgemäß dreimal dieselbe Person und
 * einmal niemanden.
 */
function waehleDran(room) {
  const da = anwesende(room);
  if (!da.length) return null;
  if (da.length === 1) return da[0].id;

  if (room.settings.wahl === "reihum") {
    const ids = da.map((p) => p.id);
    const i = ids.indexOf(room.letzterDran);
    return ids[(i + 1) % ids.length];
  }

  room.beutel = room.beutel.filter((id) => room.players.get(id)?.connected);
  if (!room.beutel.length) {
    room.beutel = shuffle(da.map((p) => p.id));
    // Nicht zweimal hintereinander dieselbe Person, nur weil der Beutel
    // gerade neu befüllt wurde.
    if (room.beutel.length > 1 && room.beutel.at(-1) === room.letzterDran) {
      room.beutel.unshift(room.beutel.pop());
    }
  }
  return room.beutel.pop();
}

// ---------------------------------------------------------------------------
// Spielablauf
// ---------------------------------------------------------------------------

function startGame(room) {
  clearTimers(room);
  room.phase = "playing";
  room.rundeNr = 0;
  room.deck = shuffle(stapelFuer(room.settings.modus));
  room.beutel = [];
  room.letzterDran = null;
  for (const p of room.players.values()) {
    p.erwischt = 0;
    p.rein = 0;
    p.dranCount = 0;
    p.ready = false;
  }
  pushState(room);
  naechsteRunde(room);
  pushRoomList();
}

function naechsteRunde(room) {
  clearTimers(room);
  const rounds = room.settings.rounds;
  if (rounds > 0 && room.rundeNr >= rounds) return finishGame(room);

  const dranId = waehleDran(room);
  if (!dranId) {
    // Niemand mehr da – der Raum fällt zurück in die Lobby, sobald der letzte
    // Platz freigegeben wird. Bis dahin nichts tun.
    room.aktuell = null;
    return;
  }

  room.rundeNr++;
  room.letzterDran = dranId;
  room.aktuell = {
    dranId,
    schritt: "sagen",
    karte: null,
    gezogen: 0,
    stimmen: new Map(),   // Spieler-Id -> true (hab ich schon) / false (noch nie)
    ergebnis: null,
  };
  pushRunde(room);
}

/** Der Rundenzustand geht an jeden einzeln – „meine Stimme" ist pro Spieler. */
function pushRunde(room) {
  const cur = room.aktuell;
  if (!cur) return;
  const dran = room.players.get(cur.dranId);
  const waehler = anwesende(room).filter((p) => p.id !== cur.dranId);

  for (const p of room.players.values()) {
    send(p, {
      t: "runde",
      n: room.rundeNr,
      total: room.settings.rounds,
      dranId: cur.dranId,
      dranName: dran?.name ?? "?",
      dranDa: !!dran?.connected,
      schritt: cur.schritt,
      karte: cur.karte,
      gezogen: cur.gezogen,
      stimmenAb: cur.stimmen.size,
      stimmenGesamt: waehler.length,
      meineStimme: cur.stimmen.has(p.id) ? cur.stimmen.get(p.id) : null,
      ergebnis: cur.ergebnis,
    });
  }
}

/** Alle, die abstimmen dürfen, haben abgestimmt? Dann sofort auflösen. */
function pruefeStimmen(room) {
  const cur = room.aktuell;
  if (!cur || cur.schritt !== "abstimmen") return;
  const waehler = anwesende(room).filter((p) => p.id !== cur.dranId);
  if (waehler.length && waehler.every((p) => cur.stimmen.has(p.id))) {
    aufloesen(room);
  } else {
    pushRunde(room);
  }
}

function aufloesen(room) {
  const cur = room.aktuell;
  if (!cur || cur.schritt === "aufloesung") return;
  clearTimers(room);

  const dran = room.players.get(cur.dranId);
  if (dran) dran.dranCount++;

  const ergebnis = [];
  for (const p of room.players.values()) {
    if (p.id === cur.dranId) continue;
    if (!cur.stimmen.has(p.id)) {
      // Nicht abgestimmt (weggegangen oder Verbindung weg) – taucht auf,
      // zählt aber nicht.
      if (p.connected) ergebnis.push({ id: p.id, name: p.name, gemacht: null });
      continue;
    }
    const gemacht = cur.stimmen.get(p.id);
    if (gemacht) p.erwischt++;
    else p.rein++;
    ergebnis.push({ id: p.id, name: p.name, gemacht });
  }

  // Erwischte zuerst – das ist die Zeile, auf die alle schauen.
  ergebnis.sort((a, b) => Number(b.gemacht === true) - Number(a.gemacht === true));
  cur.ergebnis = ergebnis;
  cur.schritt = "aufloesung";
  pushRunde(room);
  pushState(room);
}

function finishGame(room) {
  clearTimers(room);
  room.phase = "final";
  // Beendet der Host mitten in einer Runde, ist die angefangene noch nicht
  // gespielt – sonst steht im Endstand eine Runde mehr, als es Auflösungen gab.
  const gespielt = room.aktuell && room.aktuell.schritt !== "aufloesung"
    ? room.rundeNr - 1
    : room.rundeNr;
  room.aktuell = null;
  const tabelle = [...room.players.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      erwischt: p.erwischt,
      rein: p.rein,
      dran: p.dranCount,
    }))
    .sort((a, b) => b.erwischt - a.erwischt || a.rein - b.rein);
  for (const p of room.players.values()) p.ready = false;
  broadcast(room, { t: "final", tabelle, runden: Math.max(gespielt, 0) });
  pushState(room);
  pushRoomList();
}

function backToLobby(room) {
  clearTimers(room);
  room.phase = "lobby";
  room.aktuell = null;
  room.rundeNr = 0;
  room.beutel = [];
  room.letzterDran = null;
  for (const p of room.players.values()) {
    p.ready = false;
    p.erwischt = 0;
    p.rein = 0;
    p.dranCount = 0;
  }
  pushState(room);
}

// ---------------------------------------------------------------------------
// Nachrichten
// ---------------------------------------------------------------------------

function attach(ws, room, player) {
  browsing.delete(ws);
  cancelIdleClose(room);
  if (player.dropTimer) { clearTimeout(player.dropTimer); player.dropTimer = null; }
  ws._room = room;
  ws._player = player;
  player.ws = ws;
  player.connected = true;
  player.lastSeen = Date.now();
  ensureHost(room);
  send(player, {
    t: "joined",
    you: player.id,
    token: player.token,
    code: room.code,
  });
  send(player, roomState(room));
  if (room.phase === "playing" && room.aktuell) pushRunde(room);
}

function makePlayer(name, ready) {
  return {
    id: token(),
    token: token(),
    name: cleanName(name),
    ws: null,
    dropTimer: null,
    erwischt: 0,
    rein: 0,
    dranCount: 0,
    ready,
    connected: true,
    lastSeen: Date.now(),
  };
}

function handle(ws, msg) {
  const room = ws._room;
  const player = ws._player;

  if (msg.t === "ping") {
    raw(ws, { t: "pong", c: msg.c, s: Date.now() });
    return;
  }

  // Startseite: Raumliste abonnieren.
  if (msg.t === "browse") {
    if (!ws._room) {
      browsing.add(ws);
      raw(ws, { t: "rooms", rooms: roomList() });
    }
    return;
  }

  if (msg.t === "create") {
    if (room) return;
    if (!darfRaumOeffnen(ws._ip)) {
      return raw(ws, { t: "error", msg: "Zu viele Räume in kurzer Zeit. Warte kurz." });
    }
    raumVermerkt(ws._ip);
    const r = createRoom(msg.isPublic);
    if (MODI.includes(msg.modus)) r.settings.modus = msg.modus;
    const p = makePlayer(msg.name, true);
    r.hostId = p.id;
    r.players.set(p.id, p);
    attach(ws, r, p);
    pushState(r);
    pushRoomList();
    return;
  }

  if (msg.t === "join") {
    if (room) return;
    const r = rooms.get(String(msg.code ?? "").toUpperCase().trim());
    if (!r) return raw(ws, { t: "error", msg: "Diesen Raum gibt es nicht" });

    // Wiedereinstieg mit bekanntem Token?
    if (msg.token) {
      const back = [...r.players.values()].find((p) => p.token === msg.token);
      if (back) {
        if (back.ws && back.ws !== ws && back.ws.readyState === WebSocket.OPEN) {
          try { back.ws.close(4001, "woanders geöffnet"); } catch { /* egal */ }
        }
        attach(ws, r, back);
        pushState(r);
        return;
      }
    }

    if (r.players.size >= MAX_PLAYERS) {
      return raw(ws, { t: "error", msg: `Der Raum ist voll (${MAX_PLAYERS} Spieler)` });
    }
    if (r.phase !== "lobby") {
      return raw(ws, { t: "error", msg: "Die Runde läuft schon" });
    }
    const p = makePlayer(msg.name, false);
    r.players.set(p.id, p);
    attach(ws, r, p);
    pushState(r);
    return;
  }

  if (!room || !player) return;
  room.lastActivity = Date.now();

  switch (msg.t) {
    case "name":
      player.name = cleanName(msg.name);
      pushState(room);
      if (room.aktuell) pushRunde(room);
      break;

    case "ready":
      player.ready = !!msg.value;
      pushState(room);
      break;

    case "settings": {
      if (player.id !== room.hostId || room.phase !== "lobby") break;
      if (RUNDEN_OPTIONEN.includes(msg.rounds)) room.settings.rounds = msg.rounds;
      if (MODI.includes(msg.modus)) room.settings.modus = msg.modus;
      if (msg.wahl === "zufall" || msg.wahl === "reihum") room.settings.wahl = msg.wahl;
      if (typeof msg.isPublic === "boolean") room.isPublic = msg.isPublic;
      pushState(room);
      pushRoomList();
      break;
    }

    case "start": {
      if (player.id !== room.hostId || room.phase !== "lobby") break;
      const da = anwesende(room);
      if (da.length < MIN_PLAYERS) break;
      if (!da.every((p) => p.ready || p.id === room.hostId)) break;
      startGame(room);
      break;
    }

    // Der Knopf für „mir fällt nichts ein". Nur wer dran ist, darf ziehen –
    // sonst wechselt die Karte, während der Rest sie gerade liest.
    case "karte": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "sagen") break;
      if (player.id !== cur.dranId) break;
      cur.karte = zieheKarte(room);
      cur.gezogen++;
      pushRunde(room);
      break;
    }

    // Gesagt ist gesagt – ab zur Abstimmung.
    case "gesagt": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "sagen") break;
      if (player.id !== cur.dranId && player.id !== room.hostId) break;
      cur.schritt = "abstimmen";
      pushRunde(room);
      // Sitzt niemand außer dem, der dran ist, im Raum, gibt es nichts
      // abzustimmen.
      pruefeStimmen(room);
      break;
    }

    case "stimme": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "abstimmen") break;
      if (player.id === cur.dranId) break;
      if (typeof msg.gemacht !== "boolean") break;
      cur.stimmen.set(player.id, msg.gemacht);
      pruefeStimmen(room);
      break;
    }

    // Auflösen, ohne auf die Letzten zu warten.
    case "aufloesen": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "abstimmen") break;
      if (player.id !== cur.dranId && player.id !== room.hostId) break;
      aufloesen(room);
      break;
    }

    case "weiter": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "aufloesung") break;
      if (player.id !== cur.dranId && player.id !== room.hostId) break;
      naechsteRunde(room);
      break;
    }

    // Wer dran ist, ist weg oder will nicht: Runde neu vergeben, ohne dass sie
    // zählt.
    case "ueberspringen": {
      const cur = room.aktuell;
      if (!cur || cur.schritt === "aufloesung") break;
      if (player.id !== cur.dranId && player.id !== room.hostId) break;
      room.rundeNr--;
      naechsteRunde(room);
      break;
    }

    case "ende":
      if (player.id !== room.hostId || room.phase !== "playing") break;
      finishGame(room);
      break;

    case "again":
      if (player.id !== room.hostId || room.phase !== "final") break;
      backToLobby(room);
      break;

    case "leave":
      dropPlayer(ws, { immediate: true });
      break;
  }
}

/**
 * Verbindung weg oder Knopf gedrückt. „Raum verlassen" ist eine Entscheidung
 * und wirkt sofort, ein Verbindungsabbruch bekommt eine Karenzzeit – auch in
 * der Lobby, denn wer den Raumlink verschickt, ist dabei kurz aus dem Tab raus.
 */
function dropPlayer(ws, { immediate = false } = {}) {
  const room = ws._room;
  const player = ws._player;
  browsing.delete(ws);
  if (!room || !player) return;
  ws._room = null;
  ws._player = null;

  player.connected = false;
  player.ws = null;
  player.ready = false;

  if (immediate || room.phase === "lobby") {
    releaseSeat(room, player.id);
    return;
  }

  if (player.dropTimer) clearTimeout(player.dropTimer);
  // Nicht über later(): die Rundentimer werden bei jedem Übergang geleert,
  // dieser hier darf das nicht mitmachen.
  player.dropTimer = setTimeout(() => releaseSeat(room, player.id), SEAT_GRACE_MS);

  ensureHost(room);
  pushState(room);
  // Wer weg ist, stimmt nicht mehr ab – sonst wartet die Runde ewig auf ihn.
  pruefeStimmen(room);
  if (room.aktuell) pushRunde(room);
  pushRoomList();
}

/** Platz endgültig freigeben – nach Ablauf der Karenzzeit oder auf Knopfdruck. */
function releaseSeat(room, id) {
  const player = room.players.get(id);
  if (!player) return;
  if (player.dropTimer) { clearTimeout(player.dropTimer); player.dropTimer = null; }
  room.players.delete(id);
  room.beutel = room.beutel.filter((x) => x !== id);
  ensureHost(room);

  if (room.players.size === 0) {
    backToLobby(room);
    scheduleIdleClose(room);
    pushRoomList();
    return;
  }

  // War die Person dran, hängt die Runde – dann neu vergeben.
  const cur = room.aktuell;
  if (cur && cur.dranId === id && cur.schritt !== "aufloesung") {
    room.rundeNr--;
    naechsteRunde(room);
  } else {
    pruefeStimmen(room);
    if (room.aktuell) pushRunde(room);
  }

  pushState(room);
  pushRoomList();
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

async function serveStatic(pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  // Kein Ausbruch aus public/.
  if (rel.split("/").some((seg) => seg === "..")) {
    return new Response("Nope", { status: 400 });
  }
  const url = new URL(rel, PUBLIC);
  if (!url.href.startsWith(PUBLIC.href)) {
    return new Response("Nope", { status: 400 });
  }
  try {
    const body = await Deno.readFile(url);
    const ext = rel.slice(rel.lastIndexOf("."));
    return new Response(body, {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": "no-cache",
      },
    });
  } catch {
    return new Response("Nicht gefunden", { status: 404 });
  }
}

Deno.serve({ port: PORT, hostname: HOST }, (req, info) => {
  const url = new URL(req.url);

  if (url.pathname === "/ws" || url.pathname.endsWith("/ws")) {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket erwartet", { status: 400 });
    }
    const ip = absender(req, info);
    if (!darfVerbinden(ip)) {
      return new Response("Zu viele Verbindungen", { status: 429 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket._ip = ip;
    // Erst zählen, wenn die Verbindung wirklich steht, und genau einmal wieder
    // freigeben – sonst sperrt sich die IP mit der Zeit selbst aus.
    let gezaehlt = false;
    const abmelden = () => {
      if (!gezaehlt) return;
      gezaehlt = false;
      verbindungZu(ip);
    };
    socket.onopen = () => { gezaehlt = true; verbindungAuf(ip); };
    socket.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg && typeof msg.t === "string") {
        // Lebenszeichen fuer die Geisterwache weiter unten.
        if (socket._player) socket._player.lastSeen = Date.now();
        try {
          handle(socket, msg);
        } catch (err) {
          console.error("Fehler beim Verarbeiten:", err);
        }
      }
    };
    socket.onclose = () => { abmelden(); dropPlayer(socket); };
    socket.onerror = () => { abmelden(); dropPlayer(socket); };
    return response;
  }

  return serveStatic(url.pathname);
});

// Verwaiste Räume aufräumen.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!anwesende(room).length && now - room.lastActivity > 10 * 60_000) {
      destroyRoom(room);
    }
  }
}, 60_000);


/**
 * Die Geisterwache. Gleiche Regel wie in `gemeinsam/raum.js`, hier von Hand:
 * ein Socket, der offen aussieht und keiner mehr ist, ist auf dem Handy der
 * Normalfall - wer wegwischt oder den Bildschirm sperrt, schickt kein FIN.
 * Steht so ein Geist auf dem Hostplatz, wartet die ganze Lobby auf einen
 * Startknopf, den niemand mehr druecken kann (Bugreport 4).
 *
 * `connected` allein ist deshalb kein Nachweis. Der Client meldet sich alle
 * 25 s mit `ping`, auch wenn niemand spielt; jede eingehende Nachricht
 * stempelt `lastSeen`. Wer zwei Pings lang schweigt, wird behandelt wie einer,
 * dessen Verbindung ordentlich zuging.
 */
const GEIST_MS = (() => {
  const n = Number(Deno.env.get("GEIST_MS"));
  return Number.isFinite(n) && n >= 1000 ? n : 65_000;
})();

setInterval(() => {
  const jetzt = Date.now();
  for (const room of [...rooms.values()]) {
    for (const player of [...room.players.values()]) {
      if (!player.connected || !player.ws) continue;
      if (jetzt - (player.lastSeen ?? jetzt) <= GEIST_MS) continue;
      const ws = player.ws;
      try { ws.close(4002, "stumm"); } catch { /* war ja schon tot */ }
      dropPlayer(ws);
    }
  }
}, Math.max(5_000, Math.floor(GEIST_MS / 4)));

console.log(`ICH HAB NOCH NIE läuft auf http://${HOST}:${PORT}/`);
