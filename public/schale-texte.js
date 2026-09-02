// Türkisch und Englisch für alles, was in **jedem** Schalenspiel gleich
// dasteht: Warteraum, Raumliste, Bereit-Knopf, Endstand, Hilfe-Rahmen.
//
// Kopiert, nicht importiert – wie `schale.js` selbst. Das Spiel führt die
// beiden Wörterbücher in seiner eigenen `texte.js` zusammen:
//
//   import { SCHALE_WOERTER } from "./schale-texte.js";
//   export const WOERTER = {
//     tr: { ...SCHALE_WOERTER.tr, ...EIGEN.tr },
//     en: { ...SCHALE_WOERTER.en, ...EIGEN.en },
//   };
//
// Damit kostet das nächste Spiel nur noch seine eigenen Sätze. Deutsch steht
// wie überall im HTML und fehlt hier deshalb.
//
// Zwei Sorten Schlüssel stecken darin:
//
//   im Markup   `data-t="schale.…"` in `public/index.html` – jedes Spiel hat
//               denselben Warteraum, deshalb auch dieselben Schlüssel
//   im Code     die paar Texte, die `schale.js` selbst erzeugt (Raumliste,
//               Sitzzustand, Starthinweis, Toast)

export const SCHALE_WOERTER = {
  tr: {
    // --- Startbildschirm ---
    "schale.deinName": "Adın",
    "schale.namePlatz": "örn. Mo",
    "schale.sichtbar": "Görünürlük",
    "schale.oeffentlichKnopf": "Herkese açık",
    "schale.privatKnopf": "Gizli",
    "schale.raumAuf": "Oda aç",
    "schale.oder": "ya da katıl",
    "schale.offeneRaeume": "Açık odalar",
    "schale.codePlatz": "KOD",
    "schale.mitCode": "Kodla",
    "schale.wieGeht": "Nasıl oynanır?",
    "schale.alleSpiele": "← Bütün oyunlar",

    // --- Warteraum ---
    "schale.raumcode": "Oda kodu",
    "schale.linkKopieren": "Bağlantıyı kopyala",
    "schale.spielerKopf": "Oyuncular",
    "schale.starten": "Turu başlat",
    "schale.bereitKnopf": "Hazırım!",
    "schale.hostStartet": "Herkes hazır olunca oda sahibi başlatır.",
    "schale.verlassen": "Odadan çık",

    // --- Spielbildschirm und Endstand ---
    "schale.beenden": "Bitir",
    "schale.raus": "Çık",
    "schale.endstand": "Sonuç",
    "schale.nochmal": "Bir daha!",
    "schale.zurueckWarteraum": "Oda sahibi herkesi bekleme odasına geri alır.",
    "schale.soLaeuft": "Nasıl işler",
    "schale.allesKlar": "Anlaşıldı",

    // --- Was schale.js selbst schreibt ---
    "schale.spieler": "Oyuncu",
    "schale.weg": "Bağlantı koptu – yeniden bağlanılıyor …",
    "schale.keineRaeume": "Şu anda açık oda yok.",
    "schale.oeffentlich": "herkese açık",
    "schale.privat": "gizli",
    "schale.bereit": "hazır",
    "schale.wartet": "bekliyor",
    "schale.fort": "yok",
    "schale.host": "Oda sahibi",
    "schale.mindestens": "En az {min} kişi – siz {da} kişisiniz.",
    "schale.allein": "Tek başınasın – hemen başlayabilirsin.",
    "schale.nichtBereit": "Henüz herkes hazır değil.",
    "schale.kopiert": "Bağlantı kopyalandı",

    // --- Die Spiele mit eigener Klempnerei (Gruppe C) ---
    // Sie tragen Verbindung und Warteraum von Hand im app.js, mit eigenem
    // Wortlaut - untereinander aber demselben. Deshalb hier und nicht je Spiel.
    "c.weg": "Bağlantı koptu – yeniden deneniyor …",
    "c.keinRaum": "Şu anda açık oda yok. Sen bir tane aç – diğerlerinin listesinde görünür.",
    "c.codeBitte": "Lütfen dört haneli kodu gir",
    "c.oeffentlich": "Herkese açık – listede görünür",
    "c.privat": "Gizli – yalnızca kodla",
    "c.frei": "boş",
    "c.wartet": "bekliyor",
    "c.kommtWieder": "geri gelecek",
    "c.teiltAus": "dağıtıyor",
    "c.dabei": "oyunda",
    "c.host": "ODA SAHİBİ",
    "c.linkKopiert": "Bağlantı kopyalandı",
    "c.abGehtLos": "{n} kişiden başlar.",
    "c.alleBereit": "Herkes hazır!",
    "c.du": " (sen)",
  },

  en: {
    // --- Startbildschirm ---
    "schale.deinName": "Your name",
    "schale.namePlatz": "e.g. Mo",
    "schale.sichtbar": "Visibility",
    "schale.oeffentlichKnopf": "Public",
    "schale.privatKnopf": "Private",
    "schale.raumAuf": "Open a room",
    "schale.oder": "or join one",
    "schale.offeneRaeume": "Open rooms",
    "schale.codePlatz": "CODE",
    "schale.mitCode": "With code",
    "schale.wieGeht": "How does this work?",
    "schale.alleSpiele": "← All games",

    // --- Warteraum ---
    "schale.raumcode": "Room code",
    "schale.linkKopieren": "Copy link",
    "schale.spielerKopf": "Players",
    "schale.starten": "Start the round",
    "schale.bereitKnopf": "Ready!",
    "schale.hostStartet": "The host starts as soon as everyone is ready.",
    "schale.verlassen": "Leave the room",

    // --- Spielbildschirm und Endstand ---
    "schale.beenden": "End",
    "schale.raus": "Leave",
    "schale.endstand": "Final score",
    "schale.nochmal": "Again!",
    "schale.zurueckWarteraum": "The host brings everyone back to the waiting room.",
    "schale.soLaeuft": "How it goes",
    "schale.allesKlar": "Got it",

    // --- Was schale.js selbst schreibt ---
    "schale.spieler": "Player",
    "schale.weg": "Connection lost – reconnecting …",
    "schale.keineRaeume": "No open rooms right now.",
    "schale.oeffentlich": "public",
    "schale.privat": "private",
    "schale.bereit": "ready",
    "schale.wartet": "waiting",
    "schale.fort": "away",
    "schale.host": "Host",
    "schale.mindestens": "At least {min} people – there are {da} of you.",
    "schale.allein": "On your own – you can start right away.",
    "schale.nichtBereit": "Not everyone is ready yet.",
    "schale.kopiert": "Link copied",

    // --- Die Spiele mit eigener Klempnerei (Gruppe C) ---
    "c.weg": "Connection lost – trying again …",
    "c.keinRaum": "No room is open right now. Open one – it will show up in everyone else's list.",
    "c.codeBitte": "Please enter the four-letter code",
    "c.oeffentlich": "Public – shown in the list",
    "c.privat": "Private – code only",
    "c.frei": "free",
    "c.wartet": "waiting",
    "c.kommtWieder": "coming back",
    "c.teiltAus": "deals",
    "c.dabei": "in",
    "c.host": "HOST",
    "c.linkKopiert": "Link copied",
    "c.abGehtLos": "It starts at {n}.",
    "c.alleBereit": "Everyone is ready!",
    "c.du": " (you)",
  },
};
