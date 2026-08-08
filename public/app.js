// Client: Verbindung, Warteraum, Rundenschleife, Auflösung.

const $ = (id) => document.getElementById(id);

// Sitzplatz-Tierchen. Gleiche Liste und gleiche Ableitung wie in den anderen
// Spielen, damit dieselbe Person überall dasselbe Zeichen bekommt. Bei acht
// Leuten am Tisch doppelt sich eins – der Name steht daneben.
const AVATARS = ["🦊", "🐙", "🦅", "🐺", "🦁", "🐉"];
const avatarFor = (id) =>
  AVATARS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];

const MODUS_TEXT = {
  harmlos: "Harmlos",
  gemischt: "Gemischt",
  ab18: "Nur 18+",
};

const state = {
  you: null,
  code: null,
  room: null,
  runde: null,
  pendingIntent: null,
  visibility: "public",
  modus: "harmlos",
  gate: null,        // offene 18+-Abfrage: { typ, modus }
};

// ---------------------------------------------------------------------------
// Verbindung
// ---------------------------------------------------------------------------

let sock = null;
let retryIn = 500;

function session() {
  try {
    return JSON.parse(sessionStorage.getItem("nochnie") ?? "null");
  } catch {
    return null;
  }
}

function saveSession(data) {
  try {
    sessionStorage.setItem("nochnie", JSON.stringify(data));
  } catch { /* Privatmodus – dann eben ohne Wiedereinstieg */ }
}

function send(msg) {
  if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
}

function connect() {
  // Muss aus dem Basispfad kommen: das Spiel läuft in Produktion unter
  // /nochnie/, ein festes "/ws" landet auf der Domainwurzel.
  const url = new URL("ws", document.baseURI);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  sock = new WebSocket(url);

  sock.onopen = () => {
    retryIn = 500;
    setStatus("");
    const s = session();
    if (state.pendingIntent) {
      send(state.pendingIntent);
      state.pendingIntent = null;
    } else if (s && s.code && s.token) {
      send({ t: "join", code: s.code, token: s.token, name: s.name });
    } else {
      send({ t: "browse" });
    }
  };

  sock.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    onMessage(msg);
  };

  sock.onclose = () => {
    setStatus("Verbindung weg – neuer Versuch …");
    setTimeout(connect, retryIn);
    retryIn = Math.min(retryIn * 1.8, 8000);
  };
}

// ---------------------------------------------------------------------------
// Bildschirme
// ---------------------------------------------------------------------------

function show(name) {
  for (const s of document.querySelectorAll(".screen")) {
    s.classList.toggle("active", s.id === `screen-${name}`);
  }
  if (name === "home") send({ t: "browse" });
}

function setStatus(text) {
  $("status").textContent = text;
  $("status").classList.toggle("show", !!text);
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast._id);
  toast._id = setTimeout(() => t.classList.remove("show"), 2600);
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// ---------------------------------------------------------------------------
// 18+
// ---------------------------------------------------------------------------

const AB18_KEY = "nochnie_ab18";
const ab18Bestaetigt = () => {
  try {
    return localStorage.getItem(AB18_KEY) === "ja";
  } catch {
    return false;
  }
};

function merkeAb18() {
  try {
    localStorage.setItem(AB18_KEY, "ja");
  } catch { /* dann eben jedes Mal fragen */ }
}

/**
 * Alles, was in den 18+-Stapel führt, kommt hier durch. Zwei Fälle: man stellt
 * den Modus selbst ein („wahl") oder man ist in einem Raum gelandet, in dem er
 * schon eingestellt war („beitritt"). Der zweite Fall ist der wichtigere – da
 * hat man die Entscheidung nicht selbst getroffen.
 */
function mitAb18(typ, modus, dann, sonst) {
  if (modus === "harmlos" || ab18Bestaetigt()) return dann();
  state.gate = { typ, modus, dann, sonst };
  $("ab18Text").textContent = typ === "beitritt"
    ? "In diesem Raum wird mit Karten rund um Alkohol, Feiern und Sex gespielt. Nur weiterspielen, wenn alle am Tisch volljährig sind und Lust darauf haben."
    : "Dieser Modus enthält Karten rund um Alkohol, Feiern und Sex. Nur weiterspielen, wenn alle am Tisch volljährig sind und Lust darauf haben.";
  $("ab18Nein").textContent = typ === "beitritt" ? "Raum verlassen" : "Lieber harmlos";
  $("ab18Gate").hidden = false;
}

$("ab18Ja").addEventListener("click", () => {
  const g = state.gate;
  state.gate = null;
  $("ab18Gate").hidden = true;
  merkeAb18();
  g?.dann?.();
});

$("ab18Nein").addEventListener("click", () => {
  const g = state.gate;
  state.gate = null;
  $("ab18Gate").hidden = true;
  if (g?.sonst) g.sonst();
  else if (g?.typ === "beitritt") verlassen();
});

// ---------------------------------------------------------------------------
// Nachrichten vom Server
// ---------------------------------------------------------------------------

function onMessage(msg) {
  switch (msg.t) {
    case "rooms":
      renderRooms(msg.rooms);
      break;

    case "joined":
      state.you = msg.you;
      state.code = msg.code;
      saveSession({ code: msg.code, token: msg.token, name: $("name").value.trim() });
      location.hash = msg.code;
      break;

    case "room":
      state.room = msg;
      if (msg.phase !== "playing") state.runde = null;
      renderRoom();
      break;

    case "runde":
      state.runde = msg;
      renderRunde();
      break;

    case "final":
      renderFinal(msg);
      break;

    case "error":
      toast(msg.msg);
      show("home");
      break;
  }
}

// ---------------------------------------------------------------------------
// Offene Räume
// ---------------------------------------------------------------------------

function renderRooms(list) {
  const box = $("roomList");
  $("roomsCount").textContent = list.length ? `(${list.length})` : "";
  if (!list.length) {
    box.innerHTML = `<p class="rooms-empty">Gerade ist kein Raum offen.
      Eröffne einen – er erscheint dann bei den anderen in der Liste.</p>`;
    return;
  }
  box.innerHTML = list.map((r) => `
    <button class="roomrow" data-code="${escapeHtml(r.code)}" data-modus="${escapeHtml(r.modus)}">
      <span class="roomrow-name">${escapeHtml(r.host)}</span>
      <span class="roomrow-meta">${r.modus === "harmlos" ? "harmlos" : "18+"}</span>
      <span class="roomrow-count">${r.count}/${r.max}</span>
    </button>`).join("");

  for (const b of box.querySelectorAll(".roomrow")) {
    b.addEventListener("click", () => {
      // Vor dem Beitritt fragen, nicht danach – sonst sitzt man schon drin.
      mitAb18("beitritt", b.dataset.modus, () => joinCode(b.dataset.code), () => {});
    });
  }
}

// Gemeinsam mit den anderen Spielen: wer bei einem seinen Namen eintippt,
// findet ihn beim nächsten schon vor.
const NAME_KEY = "spiele_name";

function meinName() {
  return $("name").value.trim();
}

function joinCode(code) {
  try {
    localStorage.setItem(NAME_KEY, meinName());
  } catch { /* egal */ }
  state.pendingIntent = { t: "join", code, name: meinName() };
  if (sock?.readyState === WebSocket.OPEN) {
    send(state.pendingIntent);
    state.pendingIntent = null;
  }
}

function verlassen() {
  send({ t: "leave" });
  saveSession(null);
  state.room = null;
  state.runde = null;
  state.you = null;
  location.hash = "";
  show("home");
}

// ---------------------------------------------------------------------------
// Startseite
// ---------------------------------------------------------------------------

function setModus(m) {
  state.modus = m;
  for (const b of document.querySelectorAll("[data-modus]")) {
    b.classList.toggle("sel", b.dataset.modus === m);
  }
}

for (const b of document.querySelectorAll("[data-modus]")) {
  b.addEventListener("click", () => {
    mitAb18(
      "wahl",
      b.dataset.modus,
      () => setModus(b.dataset.modus),
      () => setModus("harmlos"),
    );
  });
}

for (const b of document.querySelectorAll("[data-vis]")) {
  b.addEventListener("click", () => {
    state.visibility = b.dataset.vis;
    for (const x of document.querySelectorAll("[data-vis]")) {
      x.classList.toggle("sel", x === b);
    }
  });
}

$("createBtn").addEventListener("click", () => {
  try {
    localStorage.setItem(NAME_KEY, meinName());
  } catch { /* egal */ }
  state.pendingIntent = {
    t: "create",
    name: meinName(),
    isPublic: state.visibility === "public",
    modus: state.modus,
  };
  if (sock?.readyState === WebSocket.OPEN) {
    send(state.pendingIntent);
    state.pendingIntent = null;
  }
});

$("joinBtn").addEventListener("click", () => {
  const code = $("codeInput").value.toUpperCase().trim();
  if (code.length < 3) return toast("Bitte den vierstelligen Code eingeben");
  joinCode(code);
});

$("codeInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("joinBtn").click();
});

$("helpBtn").addEventListener("click", () => { $("help").hidden = false; });
$("helpClose").addEventListener("click", () => { $("help").hidden = true; });

// ---------------------------------------------------------------------------
// Warteraum
// ---------------------------------------------------------------------------

function renderRoom() {
  const r = state.room;
  if (!r) return;

  if (r.phase === "final") return; // das Endbild steht schon
  if (r.phase === "playing") {
    renderPunktleiste();
    return;                        // den Spielbildschirm zeichnet renderRunde()
  }

  show("lobby");

  // In einem 18+-Raum gelandet, ohne je bestätigt zu haben? Dann jetzt fragen.
  if (r.settings.modus !== "harmlos" && !ab18Bestaetigt() && !state.gate) {
    mitAb18("beitritt", r.settings.modus, () => {});
  }

  $("roomCode").textContent = r.code;
  const da = r.players.filter((p) => p.connected).length;
  $("lobbyCount").textContent = `${da}/${r.maxPlayers}`;
  $("roomVis").textContent =
    (r.isPublic ? "Öffentlich – steht in der Liste" : "Privat – nur mit Code") +
    " · " + MODUS_TEXT[r.settings.modus];

  const list = $("playerList");
  list.textContent = "";
  const plaetze = Math.max(r.players.length + 1, 4);
  for (let i = 0; i < Math.min(plaetze, r.maxPlayers); i++) {
    const p = r.players[i];
    const card = document.createElement("div");
    card.className = "seat" + (p ? "" : " empty") +
      (p?.ready ? " ready" : "") + (p && !p.connected ? " off" : "");
    if (!p) {
      card.innerHTML =
        `<div class="av">🪑</div><div class="nm">frei</div><div class="st">wartet</div>`;
    } else {
      card.innerHTML = `
        <div class="av">${avatarFor(p.id)}</div>
        <div class="nm">${escapeHtml(p.name)}${p.id === state.you ? " (du)" : ""}</div>
        <div class="st">${
        !p.connected ? "weg" : p.host ? "startet" : p.ready ? "✓ bereit" : "wartet"
      }</div>
        ${p.host ? '<div class="host">HOST</div>' : ""}`;
    }
    list.append(card);
  }

  const isHost = r.hostId === state.you;
  const me = r.players.find((p) => p.id === state.you);
  $("hostControls").hidden = !isHost;
  $("guestControls").hidden = isHost;

  for (const b of document.querySelectorAll("[data-lobbymodus]")) {
    b.classList.toggle("sel", b.dataset.lobbymodus === r.settings.modus);
  }
  for (const b of document.querySelectorAll("[data-wahl]")) {
    b.classList.toggle("sel", b.dataset.wahl === r.settings.wahl);
  }
  for (const b of document.querySelectorAll("[data-rounds]")) {
    b.classList.toggle("sel", Number(b.dataset.rounds) === r.settings.rounds);
  }
  for (const b of document.querySelectorAll("[data-lobbyvis]")) {
    b.classList.toggle("sel", (b.dataset.lobbyvis === "public") === r.isPublic);
  }

  // Wer gerade weg ist, zählt nicht mit – sonst blockiert er den Start.
  const here = r.players.filter((p) => p.connected);
  const others = here.filter((p) => p.id !== r.hostId);
  const allReady = others.every((p) => p.ready);
  $("startBtn").disabled = here.length < 2 || !allReady;
  $("startHint").textContent = here.length < 2
    ? "Zu zweit geht es los – allein hat niemand etwas zu gestehen."
    : allReady
    ? "Alle bereit!"
    : "Warten auf die anderen …";

  $("readyBtn").textContent = me?.ready ? "Doch nicht bereit" : "Bereit!";
  $("readyBtn").classList.toggle("on", !!me?.ready);
}

$("readyBtn").addEventListener("click", () => {
  const me = state.room?.players.find((p) => p.id === state.you);
  send({ t: "ready", value: !me?.ready });
});

$("startBtn").addEventListener("click", () => send({ t: "start" }));
$("leaveBtn").addEventListener("click", verlassen);

for (const b of document.querySelectorAll("[data-lobbymodus]")) {
  b.addEventListener("click", () => {
    mitAb18(
      "wahl",
      b.dataset.lobbymodus,
      () => send({ t: "settings", modus: b.dataset.lobbymodus }),
      () => send({ t: "settings", modus: "harmlos" }),
    );
  });
}
for (const b of document.querySelectorAll("[data-wahl]")) {
  b.addEventListener("click", () => send({ t: "settings", wahl: b.dataset.wahl }));
}
for (const b of document.querySelectorAll("[data-rounds]")) {
  b.addEventListener("click", () => send({ t: "settings", rounds: Number(b.dataset.rounds) }));
}
for (const b of document.querySelectorAll("[data-lobbyvis]")) {
  b.addEventListener("click", () =>
    send({ t: "settings", isPublic: b.dataset.lobbyvis === "public" })
  );
}

$("copyBtn").addEventListener("click", async () => {
  const link = location.origin + location.pathname + "#" + (state.code ?? "");
  try {
    await navigator.clipboard.writeText(link);
    toast("Link kopiert");
  } catch {
    // Ohne Zwischenablage (http, altes Handy) bleibt nur Vorlesen.
    toast(link);
  }
});

// ---------------------------------------------------------------------------
// Spielbildschirm
// ---------------------------------------------------------------------------

function knopf(label, cls, fn) {
  const b = document.createElement("button");
  b.className = "btn " + cls;
  b.textContent = label;
  b.addEventListener("click", fn);
  return b;
}

function renderRunde() {
  const r = state.runde;
  if (!r || state.room?.phase !== "playing") return;
  show("game");

  const isHost = state.room.hostId === state.you;
  const binDran = r.dranId === state.you;

  $("rundeNo").textContent = String(r.n);
  $("rundeTotal").textContent = r.total ? ` / ${r.total}` : "";
  $("modusTag").textContent = MODUS_TEXT[state.room.settings.modus];
  $("modusTag").className = "tb-modus" +
    (state.room.settings.modus === "harmlos" ? "" : " heiss");
  $("endeBtn").hidden = !isHost;

  $("dranAv").textContent = avatarFor(r.dranId);
  $("dranName").textContent = binDran ? "Du" : r.dranName;
  $("dranRolle").textContent = !r.dranDa
    ? "ist gerade weg"
    : r.schritt === "sagen"
    ? (binDran ? "bist dran" : "ist dran")
    : (binDran ? "hast gestanden" : "hat gestanden");

  // --- Karte ---------------------------------------------------------------
  const karte = $("karte");
  if (r.karte) {
    karte.classList.remove("leer");
    $("karteText").textContent = r.karte.text;
    $("karteTag").hidden = !r.karte.ab18;
  } else {
    karte.classList.add("leer");
    $("karteText").textContent = binDran
      ? "Sag laut etwas, das du noch nie gemacht hast."
      : `${r.dranName} überlegt …`;
    $("karteTag").hidden = true;
  }

  // --- Stimmenzähler und Auflösung ----------------------------------------
  const zahl = $("stimmenZahl");
  zahl.textContent = r.schritt === "abstimmen"
    ? `${r.stimmenAb} von ${r.stimmenGesamt} haben abgestimmt`
    : "";

  const liste = $("ergebnisListe");
  liste.textContent = "";
  if (r.schritt === "aufloesung" && r.ergebnis) {
    const erwischt = r.ergebnis.filter((e) => e.gemacht === true);
    for (const e of r.ergebnis) {
      const li = document.createElement("li");
      li.className = "erg" +
        (e.gemacht === true ? " ja" : e.gemacht === false ? " nein" : " leer");
      li.innerHTML = `<span class="erg-av">${avatarFor(e.id)}</span>
        <span class="erg-name">${escapeHtml(e.name)}</span>
        <span class="erg-tag">${
        e.gemacht === true ? "hat’s gemacht" : e.gemacht === false ? "noch nie" : "keine Antwort"
      }</span>`;
      liste.append(li);
    }
    const kopf = document.createElement("li");
    kopf.className = "erg-kopf";
    kopf.textContent = erwischt.length === 0
      ? "Niemand erwischt."
      : erwischt.length === 1
      ? `${erwischt[0].name} trinkt.`
      : `${erwischt.length} erwischt.`;
    liste.prepend(kopf);
  }

  // --- Knöpfe --------------------------------------------------------------
  const box = $("aktionen");
  box.textContent = "";
  let hint = "";

  if (r.schritt === "sagen") {
    if (binDran) {
      box.append(knopf(
        r.gezogen ? "Anderer Vorschlag" : "Mir fällt nichts ein",
        "",
        () => send({ t: "karte" }),
      ));
      box.append(knopf("Gesagt – abstimmen", "primary big", () => send({ t: "gesagt" })));
      hint = "Sag den Satz laut. Der Vorschlag ist nur für den Fall, dass dir nichts einfällt.";
    } else {
      hint = r.dranDa
        ? `${r.dranName} ist dran. Gleich wird abgestimmt.`
        : `${r.dranName} ist gerade weg.`;
      if (isHost || !r.dranDa) {
        box.append(knopf("Überspringen", "ghost sm", () => send({ t: "ueberspringen" })));
      }
    }
  } else if (r.schritt === "abstimmen") {
    if (binDran) {
      hint = "Warte, bis alle gedrückt haben – oder lös auf.";
      box.append(knopf("Auflösen", "primary", () => send({ t: "aufloesen" })));
    } else if (r.meineStimme === null) {
      box.append(knopf("Hab ich schon", "wahl ja", () => send({ t: "stimme", gemacht: true })));
      box.append(knopf("Noch nie", "wahl nein", () => send({ t: "stimme", gemacht: false })));
      hint = "Aufgedeckt wird erst, wenn alle gedrückt haben.";
    } else {
      hint = r.meineStimme
        ? "„Hab ich schon“ – warte auf die anderen …"
        : "„Noch nie“ – warte auf die anderen …";
    }
  } else if (r.schritt === "aufloesung") {
    if (binDran || isHost) {
      box.append(knopf("Weiter", "primary big", () => send({ t: "weiter" })));
      hint = r.total && r.n >= r.total ? "Das war die letzte Runde." : "";
    } else {
      hint = `Weiter geht's, sobald ${r.dranName} drückt.`;
    }
  }

  $("rundenHint").textContent = hint;
  renderPunktleiste();
}

function renderPunktleiste() {
  const r = state.room;
  if (!r) return;
  const bar = $("punktleiste");
  bar.textContent = "";
  const sorted = r.players.slice().sort((a, b) => b.erwischt - a.erwischt);
  for (const p of sorted) {
    const chip = document.createElement("div");
    chip.className = "chip" + (p.id === state.you ? " me" : "") +
      (p.connected ? "" : " gone") +
      (state.runde && p.id === state.runde.dranId ? " amzug" : "");
    chip.innerHTML = `
      <span class="chip-av">${avatarFor(p.id)}</span>
      <span class="chip-name">${escapeHtml(p.name)}</span>
      <span class="chip-zahl">${p.erwischt}</span>`;
    bar.append(chip);
  }
}

$("endeBtn").addEventListener("click", () => send({ t: "ende" }));

// ---------------------------------------------------------------------------
// Endstand
// ---------------------------------------------------------------------------

function renderFinal(msg) {
  show("final");
  const t = msg.tabelle;
  $("finalSub").textContent = `${msg.runden} Runde${msg.runden === 1 ? "" : "n"} gespielt`;

  const ol = $("podium");
  ol.textContent = "";
  const maxErwischt = Math.max(...t.map((p) => p.erwischt), 0);
  for (const p of t) {
    const li = document.createElement("li");
    li.className = "podest" + (p.id === state.you ? " me" : "");
    const titel = maxErwischt > 0 && p.erwischt === maxErwischt
      ? "hat am meisten erlebt"
      : p.erwischt === 0
      ? "blütenweiß"
      : "";
    li.innerHTML = `
      <span class="podest-av">${avatarFor(p.id)}</span>
      <span class="podest-name">${escapeHtml(p.name)}
        ${titel ? `<small>${titel}</small>` : ""}</span>
      <span class="podest-zahl">${p.erwischt}<small>× erwischt</small></span>`;
    ol.append(li);
  }

  const isHost = state.room?.hostId === state.you;
  $("againBtn").hidden = !isHost;
  $("againHint").textContent = isHost
    ? "Zurück in den Warteraum – dort könnt ihr die Karten umstellen."
    : "Der Host holt alle zurück in den Warteraum.";
}

$("againBtn").addEventListener("click", () => send({ t: "again" }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

try {
  const gemerkt = localStorage.getItem(NAME_KEY);
  if (gemerkt) $("name").value = gemerkt;
} catch { /* egal */ }

// Geteilter Link mit #CODE: Code eintragen und – wenn der Name schon feststeht –
// direkt beitreten.
const hash = location.hash.replace("#", "").toUpperCase().trim();
if (hash.length >= 3 && hash.length <= 5) {
  $("codeInput").value = hash;
  if (!session()?.token && $("name").value.trim()) {
    state.pendingIntent = { t: "join", code: hash, name: meinName() };
  }
}

setModus("harmlos");
connect();
