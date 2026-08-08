// Spielt den ganzen Ablauf mit drei Clients durch: Raum, Warteraum, sechs
// Runden, Rausflug der Person, die dran ist, Endstand, Neustart.
//
// Kein Testrahmen, keine Abhängigkeit – das Skript wirft, wenn etwas nicht
// stimmt, und schreibt sonst mit, was passiert ist. Der Server muss dafür
// laufen:
//
//   deno task dev            (in einer zweiten Sitzung)
//   deno task probe
// Gegen die Live-Fassung statt gegen den lokalen Server:
//   WS_URL=wss://inf-zeus.de/nochnie/ws deno task probe
const PORT = Deno.env.get("PORT") ?? "8076";
const URL_WS = Deno.env.get("WS_URL") ?? `ws://127.0.0.1:${PORT}/ws`;

function client(name) {
  const c = {
    name, ws: new WebSocket(URL_WS), you: null, room: null, runde: null,
    final: null, fehler: [],
  };
  c.ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "joined") c.you = m.you;
    if (m.t === "room") c.room = m;
    if (m.t === "runde") c.runde = m;
    if (m.t === "final") c.final = m;
    if (m.t === "error") c.fehler.push(m.msg);
  };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.offen = new Promise((res) => { c.ws.onopen = res; });
  return c;
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function bis(bedingung, was, ms = 3000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return;
    await warte(25);
  }
  throw new Error("Zeitüberschreitung: " + was);
}

const A = client("Anna"), B = client("Ben"), C = client("Cem");
await Promise.all([A.offen, B.offen, C.offen]);

A.send({ t: "create", name: "Anna", isPublic: true, modus: "gemischt" });
await bis(() => A.room, "Raum angelegt");
const code = A.room.code;
console.log("Raum:", code, "| Modus:", A.room.settings.modus);

B.send({ t: "join", code, name: "Ben" });
C.send({ t: "join", code, name: "Cem" });
await bis(() => A.room.players.length === 3, "drei Spieler");

// Start muss ohne „bereit" scheitern.
A.send({ t: "start" });
await warte(150);
if (A.room.phase !== "lobby") throw new Error("Start ging ohne Bereit durch");
console.log("ok  Start blockiert, solange nicht alle bereit sind");

B.send({ t: "ready", value: true });
C.send({ t: "ready", value: true });
await bis(() => A.room.players.every((p) => p.ready || p.host), "alle bereit");

A.send({ t: "settings", rounds: 8, wahl: "zufall" });
await warte(100);
A.send({ t: "start" });
await bis(() => A.runde && A.room.phase === "playing", "Runde 1 läuft");

const alle = { [A.you]: A, [B.you]: B, [C.you]: C };
const dranFolge = [];
let karten = 0;

for (let runde = 1; runde <= 6; runde++) {
  await bis(() => A.runde?.n === runde && A.runde.schritt === "sagen", `Runde ${runde}`);
  const r = A.runde;
  const dran = alle[r.dranId];
  dranFolge.push(r.dranName);

  // Fremdzugriff: wer nicht dran ist, darf keine Karte ziehen.
  const anderer = [A, B, C].find((c) => c !== dran);
  anderer.send({ t: "karte" });
  await warte(80);
  if (A.runde.karte) throw new Error("Fremder konnte eine Karte ziehen");

  if (runde % 2 === 1) {
    dran.send({ t: "karte" });
    await bis(() => A.runde.karte, "Karte gezogen");
    karten++;
    console.log(`R${runde} ${r.dranName} zieht: „${A.runde.karte.text}"` +
      (A.runde.karte.ab18 ? " [18+]" : ""));
  } else {
    console.log(`R${runde} ${r.dranName} sagt frei`);
  }

  dran.send({ t: "gesagt" });
  await bis(() => A.runde.schritt === "abstimmen", "Abstimmung offen");

  // Wer dran ist, darf nicht mitstimmen.
  dran.send({ t: "stimme", gemacht: true });
  await warte(60);
  if (A.runde.stimmenAb !== 0) throw new Error("Der Dran-Spieler konnte abstimmen");

  const waehler = [A, B, C].filter((c) => c !== dran);
  waehler[0].send({ t: "stimme", gemacht: true });
  await bis(() => A.runde.stimmenAb === 1, "erste Stimme");
  if (A.runde.schritt !== "abstimmen") throw new Error("Zu früh aufgelöst");
  waehler[1].send({ t: "stimme", gemacht: false });

  await bis(() => A.runde.schritt === "aufloesung", "aufgelöst");
  const erwischt = A.runde.ergebnis.filter((e) => e.gemacht === true).map((e) => e.name);
  console.log(`   erwischt: ${erwischt.join(", ") || "niemand"}`);

  dran.send({ t: "weiter" });
}

console.log("\nDran-Reihenfolge:", dranFolge.join(" → "));
const ersteDrei = new Set(dranFolge.slice(0, 3));
if (ersteDrei.size !== 3) throw new Error("Beutel verteilt nicht auf alle: " + dranFolge);
const zweiteDrei = new Set(dranFolge.slice(3, 6));
if (zweiteDrei.size !== 3) throw new Error("Zweiter Durchlauf ungleich verteilt");
for (let i = 1; i < dranFolge.length; i++) {
  if (dranFolge[i] === dranFolge[i - 1]) throw new Error("zweimal hintereinander dieselbe Person");
}
console.log("ok  jeder kommt einmal pro Durchlauf dran, nie zweimal am Stück");
console.log("ok  Karten gezogen:", karten);

// Verbindungsverlust der Person, die dran ist: Runde muss neu vergeben werden.
await bis(() => A.runde.schritt === "sagen", "Runde 7");
// A beobachtet, darf also nicht selbst der Aussteiger sein – sonst bekommt er
// die Neuvergabe gar nicht mehr mit und die Probe misst sich selbst.
while (A.runde.dranId === A.you) {
  const vorher = A.runde.dranId;
  A.send({ t: "ueberspringen" });
  await bis(() => A.runde.dranId !== vorher, "übersprungen");
}
const dran7 = alle[A.runde.dranId];
const nr7 = A.runde.n;
dran7.send({ t: "leave" });
await bis(() => A.runde.dranId !== dran7.you, "Runde neu vergeben");
if (A.runde.n !== nr7) throw new Error("Übersprungene Runde wurde mitgezählt");
console.log("ok  wer dran ist und geht, blockiert die Runde nicht (Zähler bleibt bei", nr7 + ")");

A.send({ t: "ende" });
await bis(() => A.final, "Endstand");
console.log("\nEndstand nach", A.final.runden, "Runden:");
for (const p of A.final.tabelle) {
  console.log(`  ${p.name.padEnd(6)} ${p.erwischt}× erwischt, ${p.rein}× sauber, ${p.dran}× dran`);
}

const summe = A.final.tabelle.reduce((s, p) => s + p.erwischt + p.rein, 0);
if (summe === 0) throw new Error("Es wurde nichts gezählt");

A.send({ t: "again" });
await bis(() => A.room.phase === "lobby", "zurück im Warteraum");
if (A.room.players.some((p) => p.erwischt !== 0)) throw new Error("Zähler nicht zurückgesetzt");
console.log("ok  Nochmal setzt alles zurück");

if ([A, B, C].some((c) => c.fehler.length)) {
  throw new Error("Fehlermeldungen: " + JSON.stringify([A, B, C].map((c) => c.fehler)));
}
console.log("\nALLES GRÜN");
Deno.exit(0);
