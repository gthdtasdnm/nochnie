# Ich hab noch nie 🙈

Das Partyspiel für die Runde am Tisch, im Browser. Jede Runde wird eine Person
ausgesucht; sie sagt laut einen Satz, der mit „Ich hab noch nie …" anfängt und
für sie stimmt. Alle anderen gestehen per Knopfdruck, ob sie es doch schon
getan haben.

Läuft auf **Deno**, ohne eine einzige externe Abhängigkeit. Kein Build-Schritt,
kein `node_modules`, ein Prozess.

---

## Starten

```bash
deno task dev          # http://localhost:8076/
PORT=9000 deno task dev
deno task check        # Typprüfung
```

Zum Ausprobieren allein: die Seite in **mehreren Browserfenstern** öffnen. Jedes
Fenster ist ein eigener Spieler (die Sitzung hängt am `sessionStorage`, ein
zweiter Tab im selben Fenster wäre dieselbe Person).

## An den Tisch kommen

Wie bei den anderen Spielen: Name eintippen, **Raum eröffnen** oder über die
Liste bzw. den vierstelligen **Code** beitreten. Der geteilte Link mit `#CODE`
führt direkt hinein. Wer den Raum eröffnet, ist **Host** und stellt ein, was
gespielt wird. **Zwei bis acht** Leute – acht statt vier wie sonst, weil hier
niemand vor einer Spielfläche sitzt, sondern alle um einen Tisch.

## Eine Runde

1. Der Server sucht aus, **wer dran ist**. Diese Person sieht groß „Du bist
   dran", alle anderen sehen ihren Namen.
2. Sie sagt den Satz **laut** – gesprochen, nicht getippt. Fällt ihr nichts
   ein, drückt sie **„Mir fällt nichts ein"** und bekommt eine Karte vom
   Stapel; die sehen dann alle. „Anderer Vorschlag" zieht die nächste.
3. **„Gesagt – abstimmen"** öffnet die Abstimmung. Alle außer der Person, die
   dran ist, wählen **„Hab ich schon"** oder **„Noch nie"**.
4. Aufgedeckt wird **erst, wenn alle gedrückt haben** – niemand schielt beim
   Nachbarn ab. Wer nicht warten will, löst vorzeitig auf.
5. Auflösung: wer erwischt wurde, steht rot in der Liste. Was daraus folgt –
   ein Schluck, die Geschichte dazu oder nichts – entscheidet die Runde selbst.
   Das Spiel zählt nur mit.

Am Ende: wer am häufigsten ertappt wurde, steht oben. Wer bei null steht, ist
**blütenweiß**.

### Warum getippt wird nichts

Der Satz wird gesprochen, nicht ins Handy geschrieben. Das spart nicht nur die
Eingabemaske – es hält die Köpfe oben und macht aus dem Spiel keinen Kanal, über
den beliebiger fremder Text auf die Bildschirme aller anderen kommt.

## Wer dran ist

Zwei Verfahren, beide mit derselben Zusicherung: **niemand kommt zweimal dran,
bevor nicht alle einmal dran waren.**

- **Zufall** – ein Beutel mit allen Namen, aus dem gezogen wird, bis er leer ist;
  dann wird neu befüllt. Auch über die Nahtstelle hinweg trifft es nicht zweimal
  hintereinander dieselbe Person.
- **Reihum** – der Reihe nach in Beitrittsreihenfolge.

Wer dran ist und dabei rausfliegt, blockiert nichts: die Runde wird neu
vergeben, ohne dass sie zählt. Host und die dran befindliche Person können auch
von Hand **überspringen**.

## Die Karten

`karten.js` hat zwei getrennte Stapel:

| Stapel | Inhalt |
|---|---|
| `HARMLOS` | ~80 Karten, die man an einem Familientisch vorlesen kann |
| `AB18` | ~58 Karten rund um Alkohol, Feiern und Sex |

Drei Modi: **Harmlos** (nur der erste Stapel), **Gemischt** (beide), **Nur 18+**
(nur der zweite). Innerhalb einer Partie wiederholt sich keine Karte, bis der
Stapel durch ist – deshalb zieht der **Server** und nicht jeder Client für sich.

Alle Texte sind selbst geschrieben, aus keiner Anleitung und keiner App
abgetippt. Regeln sind frei, fremde Kartentexte nicht.

### 18+

Vor allem, was in den 18+-Stapel führt, steht eine Abfrage – **auch für Gäste,
die einem fertigen Raum beitreten**, denn die haben die Entscheidung nicht
selbst getroffen. Die Bestätigung merkt sich der Browser (`localStorage`).

Das ist keine echte Altersprüfung und soll auch keine sein. Es ist der
Unterschied zwischen „aus Versehen" und „bewusst" – und die Möglichkeit,
mit einem Klick in den harmlosen Stapel zurückzugehen.

## Dateien

| Datei | Was |
|---|---|
| `server.js` | statische Dateien, WebSocket, Räume, Rundenlogik |
| `karten.js` | die beiden Kartenstapel |
| `bremse.js` | gemeinsames Rate-Limiting, **wortgleich in allen Spielen** |
| `public/index.html` | alle vier Bildschirme plus die beiden Überlagerungen |
| `public/style.css` | oben der gemeinsame Lobby-Block, darunter das Eigene |
| `public/app.js` | Verbindung, Warteraum, Rundenschleife |

`bremse.js` und der CSS-Block bis `══ Gemeinsame Lobby-Basis ══ Ende ══` sind in
allen Spielen identisch und werden **von Hand** synchron gehalten. Wer dort
etwas ändert, ändert es überall.

## Was noch fehlt

Das Spiel läuft, ist aber noch nicht veröffentlicht. Offen:

- Apache-`Location` für `/nochnie/` samt WebSocket-`RewriteRule` (Muster: der
  `/keep/`-Block in `inf-zeus.conf`)
- Dienst einrichten, der `server.js` als `www-data` startet
- Kachel auf `/spiele/` – dort steht noch „Vier Browserspiele" im Text
- eigenes Git-Repo, wie bei den anderen vier
