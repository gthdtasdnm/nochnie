// Sprachen: Deutsch, Tuerkisch, Englisch.
//
// **Deutsch steht im HTML.** Diese Datei uebersetzt nur *darueber* – sie
// ersetzt Texte, wenn eine andere Sprache gewaehlt ist, und legt den deutschen
// Wortlaut vorher beiseite, um zurueckzukoennen. Das ist der ganze Trick und
// hat zwei Gruende:
//
//   1. Ohne JavaScript bleibt die Seite vollstaendig – auf /spiele/ ist das
//      eine ausdrueckliche Zusage (`doku/startseite.md`): die Uebersicht ist
//      der einzige Teil, der auch ohne JS etwas wert ist.
//   2. Es gibt keine zweite Fassung des deutschen Textes, die auseinander-
//      laufen koennte. Das Woerterbuch fuehrt nur `tr` und `en`.
//
// Kopiert, nicht importiert – wie alle Teile aus `gemeinsam/`. Jede Seite und
// jedes Spiel traegt seine eigene Kopie.
//
// ---------------------------------------------------------------------------
// Benutzung
//
//   <script type="module">
//     import { starteSprache } from "./sprache.js";
//     import { WOERTER } from "./texte.js";
//     starteSprache(WOERTER);
//   </script>
//
// Im Markup:
//
//   <p data-t="kachel.paare.kurz">Der deutsche Satz.</p>
//   <p data-t-html="fuss.text">Text mit <b>Auszeichnung</b>.</p>
//   <input data-t-attr="placeholder:suche.platz|aria-label:suche.label">
//
// Im JavaScript einer Seite (auch ausserhalb von Modulen, ueber
// `globalThis.sprache`):
//
//   sprache.t("suche.treffer", { n: 3 })   // "3 von 28 Spielen."
//   document.addEventListener("sprachwechsel", () => …)
//
// Das Ereignis ist wichtig fuer alles, was Text *gespeichert* hat – die Suche
// auf /spiele/ baut daraufhin ihren Index neu. Ohne das faende sie nach dem
// Umschalten weiter nur die deutschen Woerter.

export const SPRACHEN = ["de", "tr", "en"];

export const SPRACHNAMEN = { de: "Deutsch", tr: "Türkçe", en: "English" };

const SPEICHER = "spiele_sprache";

/** Woerterbuch: { tr: {schluessel: text}, en: {…} }. Deutsch steht im HTML. */
let woerter = { tr: {}, en: {} };

/** Der deutsche Wortlaut, so wie er beim ersten Anwenden dastand. */
const urtext = new WeakMap();

/** Schluessel, zu denen die gewaehlte Sprache nichts hergab. Die Probe liest das. */
const fehlend = new Set();

let jetzt = "de";

/**
 * Welche Sprache gilt? In dieser Reihenfolge:
 *
 *   1. `?lang=tr` in der Adresse – damit ein geteilter Link in der Sprache
 *      aufgeht, in der er weitergegeben wurde. Wird gleich mitgespeichert.
 *   2. was zuletzt gewaehlt wurde
 *   3. die Sprache des Browsers, wenn wir sie koennen
 *   4. Deutsch
 */
function ermitteln() {
  const ausUrl = new URLSearchParams(location.search).get("lang");
  if (SPRACHEN.includes(ausUrl)) {
    merken(ausUrl);
    return ausUrl;
  }
  try {
    const gemerkt = localStorage.getItem(SPEICHER);
    if (SPRACHEN.includes(gemerkt)) return gemerkt;
  } catch { /* Privatmodus – dann eben jedes Mal neu */ }
  for (const l of navigator.languages ?? [navigator.language ?? ""]) {
    const kurz = String(l).slice(0, 2).toLowerCase();
    if (SPRACHEN.includes(kurz)) return kurz;
  }
  return "de";
}

function merken(sprache) {
  try {
    localStorage.setItem(SPEICHER, sprache);
  } catch { /* egal */ }
}

/**
 * Ein Text in der gewaehlten Sprache. `ersatz` ist der deutsche Wortlaut –
 * bei `t()` aus dem Aufruf, bei den Elementen der Urtext aus dem HTML.
 * `werte` fuellt Platzhalter der Form {n}.
 */
export function t(schluessel, werte = {}, ersatz = "") {
  let text = jetzt === "de" ? ersatz : woerter[jetzt]?.[schluessel];
  if (text === undefined || text === null || text === "") {
    if (jetzt !== "de") fehlend.add(`${jetzt}:${schluessel}`);
    text = ersatz;
  }
  return String(text).replace(/\{(\w+)\}/g, (ganz, name) =>
    Object.hasOwn(werte, name) ? String(werte[name]) : ganz
  );
}

/** Den Urtext eines Elements holen – beim ersten Mal aus dem HTML. */
function ur(el, feld, lesen) {
  let merk = urtext.get(el);
  if (!merk) urtext.set(el, merk = {});
  if (!(feld in merk)) merk[feld] = lesen();
  return merk[feld];
}

function anwenden(wurzel = document) {
  for (const el of wurzel.querySelectorAll("[data-t]")) {
    const schluessel = el.dataset.t;
    el.textContent = t(schluessel, {}, ur(el, "text", () => el.textContent));
  }
  for (const el of wurzel.querySelectorAll("[data-t-html]")) {
    const schluessel = el.dataset.tHtml;
    // Die Texte stammen aus der eigenen `texte.js`, nicht von Nutzern – das
    // ist der einzige Grund, warum hier innerHTML stehen darf.
    el.innerHTML = t(schluessel, {}, ur(el, "html", () => el.innerHTML));
  }
  for (const el of wurzel.querySelectorAll("[data-t-attr]")) {
    // "placeholder:suche.platz|aria-label:suche.label"
    for (const paar of el.dataset.tAttr.split("|")) {
      const trenn = paar.indexOf(":");
      if (trenn < 0) continue;
      const attr = paar.slice(0, trenn).trim();
      const schluessel = paar.slice(trenn + 1).trim();
      const alt = ur(el, "attr:" + attr, () => el.getAttribute(attr) ?? "");
      el.setAttribute(attr, t(schluessel, {}, alt));
    }
  }
}

/** Umschalter bauen – ueberall dort, wo ein `[data-sprachwahl]` steht. */
function umschalterBauen() {
  for (const halter of document.querySelectorAll("[data-sprachwahl]")) {
    if (halter.dataset.gebaut) continue;
    halter.dataset.gebaut = "ja";
    halter.classList.add("sprachwahl");
    for (const s of SPRACHEN) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sprachknopf";
      b.dataset.sprache = s;
      b.textContent = s.toUpperCase();
      b.title = SPRACHNAMEN[s];
      b.setAttribute("aria-label", SPRACHNAMEN[s]);
      b.addEventListener("click", () => setzeSprache(s));
      halter.append(b);
    }
  }
}

function umschalterZeigen() {
  for (const b of document.querySelectorAll(".sprachknopf")) {
    const gewaehlt = b.dataset.sprache === jetzt;
    b.classList.toggle("sel", gewaehlt);
    b.setAttribute("aria-pressed", gewaehlt ? "true" : "false");
  }
}

/**
 * Umschalten. Setzt das `lang`-Attribut mit – daran haengen nicht nur
 * Vorleseprogramme, sondern auch die Silbentrennung des Browsers.
 */
export function setzeSprache(sprache) {
  if (!SPRACHEN.includes(sprache)) return;
  jetzt = sprache;
  merken(sprache);
  document.documentElement.lang = sprache;
  anwenden();
  umschalterZeigen();
  document.dispatchEvent(new CustomEvent("sprachwechsel", { detail: { sprache } }));
}

export const aktuelleSprache = () => jetzt;

/** Nachtraeglich eingefuegtes Markup uebersetzen (Dialoge, geklonte Vorlagen). */
export function uebersetze(wurzel) {
  anwenden(wurzel ?? document);
}

export function fehlendeSchluessel() {
  return [...fehlend];
}

export function starteSprache(neueWoerter) {
  woerter = { tr: {}, en: {}, ...(neueWoerter ?? {}) };
  umschalterBauen();
  setzeSprache(ermitteln());
  return jetzt;
}

// Auch fuer klassische Skripte erreichbar: die Uebersichtsseite hat ihr JS
// inline und nicht als Modul.
globalThis.sprache = {
  t,
  setzeSprache,
  uebersetze,
  fehlendeSchluessel,
  SPRACHEN,
  SPRACHNAMEN,
  get jetzt() {
    return jetzt;
  },
};
