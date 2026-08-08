// ══════════════ Gemeinsame Bremse ══════════════ Anfang ═══════════════════
// ERZEUGT - NICHT HIER AENDERN. Quelle: /var/www/html/gemeinsam/bremse.js
// Aendern, dann `node werkzeug/verteilen.mjs` - das schreibt die Datei in
// jedes Spiel. `--pruefen` meldet, wo sie abgewichen ist. Kein Build-Schritt,
// keine Abhaengigkeit: jedes Spiel behaelt seine eigene vollstaendige Kopie
// und laeuft ohne diesen Ordner weiter.
//
// Zweck: verhindern, dass eine einzelne Gegenstelle den Server mit
// Verbindungen oder Raeumen zumuellt. Das ist kein Schutz gegen einen echten
// verteilten Angriff - dafuer braeuchte es etwas vor Apache. Es macht die
// billige Variante (ein Skript, eine Leitung) aber wirkungslos.
// ──────────────────────────────────────────────────────────────────────────

/** Gleichzeitig offene Verbindungen je IP. Vier Leute an einem Anschluss
 *  plus Neuladen und ein zweiter Tab passen bequem hinein. */
const MAX_GLEICHZEITIG = 12;

/** Neue Verbindungen je IP und Minute. Wiederverbinden nach Netzwechsel
 *  darf nicht dagegenlaufen, Dauerfeuer schon. */
const MAX_NEU = 40;
const FENSTER_NEU = 60 * 1000;

/** Neu geoeffnete Raeume je IP. Raeume halten Speicher, deshalb enger. */
const MAX_RAEUME = 12;
const FENSTER_RAEUME = 10 * 60 * 1000;

const offen = new Map();      // ip -> Anzahl offener Verbindungen
const neu = new Map();        // ip -> Zeitstempel der letzten Verbindungen
const raeume = new Map();     // ip -> Zeitstempel der letzten Raumgruendungen

/** Zeitstempel innerhalb des Fensters behalten und zurueckgeben. */
function frisch(map, ip, fenster) {
  const jetzt = Date.now();
  const liste = (map.get(ip) ?? []).filter((t) => jetzt - t < fenster);
  if (liste.length) map.set(ip, liste);
  else map.delete(ip);
  return liste;
}

/**
 * Absender-IP einer Anfrage.
 *
 * Hinter Apache kommt jede Verbindung von 127.0.0.1 - die echte Adresse steht
 * nur in X-Forwarded-For. Entscheidend ist der **letzte** Eintrag: einen
 * vorhandenen Header schreibt Apache nicht neu, sondern haengt die tatsaechlich
 * verbundene Adresse hinten an. Wer selbst ein X-Forwarded-For mitschickt,
 * schiebt seine Wunschadresse also nach vorne - der letzte Eintrag stammt
 * immer von unserem eigenen Proxy und ist der einzige, dem man glauben darf.
 */
export function absender(req, info) {
  const fwd = req?.headers?.get?.("x-forwarded-for");
  if (fwd) {
    const teile = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (teile.length) return teile[teile.length - 1];
  }
  return info?.remoteAddr?.hostname ?? "unbekannt";
}

/** Darf diese IP noch eine Verbindung aufmachen? */
export function darfVerbinden(ip) {
  if ((offen.get(ip) ?? 0) >= MAX_GLEICHZEITIG) return false;
  return frisch(neu, ip, FENSTER_NEU).length < MAX_NEU;
}

/** Nach dem Zustandekommen der Verbindung aufrufen. */
export function verbindungAuf(ip) {
  offen.set(ip, (offen.get(ip) ?? 0) + 1);
  neu.set(ip, [...(neu.get(ip) ?? []), Date.now()]);
}

/** Beim Schliessen aufrufen - sonst laeuft das Konto voll und die IP sperrt
 *  sich selbst aus. */
export function verbindungZu(ip) {
  const n = (offen.get(ip) ?? 0) - 1;
  if (n > 0) offen.set(ip, n);
  else offen.delete(ip);
}

/** Darf diese IP noch einen Raum aufmachen? */
export function darfRaumOeffnen(ip) {
  return frisch(raeume, ip, FENSTER_RAEUME).length < MAX_RAEUME;
}

/** Erst nach dem erfolgreichen Anlegen zaehlen - ein abgelehnter Versuch
 *  soll nicht auf das Kontingent gehen. */
export function raumVermerkt(ip) {
  raeume.set(ip, [...(raeume.get(ip) ?? []), Date.now()]);
}

// Aufraeumen, damit die Maps nicht endlos wachsen. Ohne das waere die Bremse
// selbst der Speicherfresser, den sie verhindern soll.
setInterval(() => {
  for (const ip of [...neu.keys()]) frisch(neu, ip, FENSTER_NEU);
  for (const ip of [...raeume.keys()]) frisch(raeume, ip, FENSTER_RAEUME);
}, FENSTER_NEU);

// ══════════════ Gemeinsame Bremse ══════════════ Ende ═════════════════════
