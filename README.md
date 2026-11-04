# UCI Fantasy

Fantasy-Radsport mit echten UCI-Punkten: Auktions-Draft mit 100 Budgetpunkten, Waiver,
Tausch, frei setzbare Spieltage und Liga-Tabelle. Punkte = die UCI-Punkte, die
ProCyclingStats bei jedem Rennergebnis ausweist, solange der Fahrer im Kader steht.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `web/` | Die App (läuft im Browser, wird über GitHub Pages veröffentlicht) |
| `supabase/schema.sql` | Datenbank: Tabellen, Zugriffsrechte und die komplette Spiellogik (Auktion, Waiver, Tausch, Wertung) |
| `pcs_sync/` | Python-Skripte, die Fahrer und Ergebnisse von ProCyclingStats holen |
| `.github/workflows/` | Automatische Abläufe (siehe unten) |

Die Spielregeln werden in der Datenbank geprüft (Budget, 15-Sekunden-Uhr, Kadergröße,
Waiver-Reihenfolge …), nicht in der App – so kann niemand mogeln, auch nicht mit einem
manipulierten Browser.

## Automatische Abläufe

| Workflow | Wann | Was |
|---|---|---|
| PCS Ergebnisse abrufen | täglich 05:00 UTC | Ergebnisse aller Kaderfahrer holen, aberkannte entfernen, Stichtage abrechnen, Spieltage abschließen und 7 Tage danach einfrieren |
| Fahrerliste importieren | montags + per Knopfdruck | UCI-Ranking Männer/Frauen (je 600 Fahrer); neue Fahrer sind automatisch frei |
| App veröffentlichen | bei Änderungen in `web/` auf `main` | App auf GitHub Pages stellen |
| Datenbank einrichten | nur per Knopfdruck | `supabase/schema.sql` einspielen (optional, braucht `SUPABASE_DB_URL`) |

## Einrichtung (einmalig)

1. **Datenbank:** Inhalt von `supabase/schema.sql` im Supabase SQL-Editor einfügen und *Run*.
   Das Skript ersetzt die Ligatabellen des ersten Entwurfs (nur solange noch keine Liga existiert),
   behält `profiles`, `riders`, `races`, `results` und kann gefahrlos erneut ausgeführt werden.
2. **Secret `SUPABASE_ANON_KEY`** in GitHub anlegen (Repository → Settings → Secrets and variables → Actions).
   Wert: Supabase → Project Settings → API → *anon public*. Dieser Schlüssel darf öffentlich sein;
   `SUPABASE_URL` und `SUPABASE_SERVICE_KEY` sind schon vorhanden.
3. **GitHub Pages aktivieren:** Settings → Pages → Source: *GitHub Actions*.
4. **Fahrer laden:** Actions → *Fahrerliste importieren* → *Run workflow*.
5. **Auf `main` bringen** (Pull Request mergen) – dann veröffentlicht *App veröffentlichen* die App
   unter `https://<benutzer>.github.io/<repo>/`.
6. **Login-Weiterleitung:** Supabase → Authentication → URL Configuration → *Site URL* auf diese
   Adresse setzen (sonst führen Bestätigungs- und Magic-Links ins Leere).

## Lokal testen

`web/config.example.js` als `web/config.js` kopieren, URL und anon-Key eintragen, dann z. B.
`python3 -m http.server -d web` und `http://localhost:8000` öffnen.

## Hinweise

- ProCyclingStats hat keine offizielle API; die Abrufe sind bewusst sparsam (1× täglich, Pausen
  zwischen Anfragen). Nutzungsbedingungen vor dem Livebetrieb prüfen.
- Live-Updates im Draft-Raum laufen über Supabase Realtime; fällt das aus, fragt die App alle 1,5 s nach.
