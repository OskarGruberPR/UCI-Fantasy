# Datenbank-Module

Die SQL-Quellen liegen unter `sql/`, gegliedert nach technischer Aufgabe und fachlichem Bereich.
`schema.sql` wird daraus erzeugt und bleibt das vollständige, wiederholbar ausführbare Skript
für den Supabase SQL-Editor und den Workflow „Datenbank einrichten“.

## Zuordnung

| Pfad | Aufgabe | Beispiele |
|---|---|---|
| `sql/00_*.sql` | Einführung und grundlegende Erweiterungen | pgcrypto, btree_gist |
| `sql/10_tables/` | Tabellen, Indizes und zugehörige idempotente Spaltenergänzungen | Stammdaten, Ligen, Draft, Kader, Spieltage, Transfers, Wertung, Feedback |
| `sql/20_compatibility/` | Historische Strukturwechsel und gezielte Nachrüstungen | erster Schemaentwurf, Draft-Modi, vorläufige Rennen |
| `sql/30_internal/` | Hilfsfunktionen und interne fachliche Verarbeitung | Berechtigungsprüfungen, Kaderplätze, Draft-Zuschläge, Waiver-Auswertung, Punkteberechnung |
| `sql/40_api/` | Von der App aufgerufene Funktionen (RPC) | Liga verwalten, Gebote, Aufstellung, Tabelle, Tauschangebote, Feedback |
| `sql/50_jobs/` | Automatische Verarbeitung und Diagnose | Ergebnisse zuordnen, Saisonstatistiken, Wartung, Wochenbericht, Zeitplaner |
| `sql/60_access/` | Zugriffsregeln und Realtime | Row Level Security, Funktionsrechte, Draft-Publication |
| `sql/70_data_updates/` | Datenkorrekturen und Nachberechnungen beim Einspielen | Ländercodes, alte Fristen, Saisonwerte, Spieltage 2027 |

Die Dateinamen innerhalb einer Kategorie benennen den Fachbereich. Größere Bereiche haben mehrere
Module, etwa `draft_start.sql`, `draft_auction.sql`, `draft_snake.sql` und `draft_offline.sql`.
Die Ordner beschreiben die Aufgabe; welche Funktionen tatsächlich aufgerufen werden dürfen,
bestimmen weiterhin die bestehenden Prüfungen und SQL-Rechte. Die Aufteilung ändert diese Rechte nicht.

## Ausführungsreihenfolge

**Allein `schema.modules.json` bestimmt die Reihenfolge.** Die Nummern der Ordner dienen der Orientierung;
die Dateien werden weder nach Namen sortiert noch kategorieweise ausgeführt.

Die anfängliche Modulliste erhält die Reihenfolge des bisherigen Gesamtskripts vollständig.
Deshalb stehen einzelne Tabellen, Nachrüstungen und Datenkorrekturen auch zwischen Funktionsmodulen.
Beispielsweise wird der Namensindex erst nach `norm_name()` angelegt; Rückbefüllungen laufen erst,
wenn ihre Funktionen definiert sind. Erweiterungen für Namensabgleich und Zeitplaner bleiben ebenfalls
an ihren bisherigen Stellen in den jeweiligen Funktionsmodulen.

Spaltenergänzungen, die bisher direkt an einer Tabellendefinition standen, bleiben bei dieser Tabelle.
Alte Funktionssignaturen werden weiterhin direkt vor der jeweiligen API-Definition entfernt.
So bleibt auch das Verhalten beim erneuten Einspielen in eine vorhandene Datenbank erhalten.

`70_data_updates` ist **kein Migrationsregister**: Auch dort als „einmalig“ kommentierte Blöcke werden
wie bisher bei jedem vollständigen Einspielen ausgeführt und durch ihre bestehenden Bedingungen begrenzt.
Der Build führt kein SQL aus und merkt sich keine bereits ausgeführten Schritte.

## Änderungen vornehmen

Voraussetzung: Node.js ab Version 22; es sind keine zusätzlichen Pakete nötig.

1. Das passende Modul unter `sql/` bearbeiten. Für neue Dateien einen Eintrag an der benötigten Stelle
   in `schema.modules.json` ergänzen. Abhängigkeiten zu Tabellen, Funktionen und Datenkorrekturen beachten.
2. `node supabase/build-schema.mjs` im Repository ausführen.
3. Module, Modulliste und erzeugte `supabase/schema.sql` gemeinsam einchecken.

`schema.sql` nicht direkt bearbeiten. Der Build ergänzt einen Hinweis und für jedes Modul einen
Quellpfad-Kommentar; diese Kommentare erleichtern die Zuordnung in der erzeugten Datei.
SQL-Inhalte werden ansonsten nur mit einheitlichen LF-Zeilenumbrüchen zusammengesetzt.
Module müssen vollständige SQL-Anweisungen enthalten; Funktionskörper und `DO`-Blöcke nicht aufteilen.

## Prüfen und einspielen

```sh
node --test supabase/build-schema.test.mjs
node supabase/build-schema.mjs --check
psql -v ON_ERROR_STOP=1 -f supabase/schema.sql
```

`--check` verändert keine Datei. Die Prüfung schlägt fehl, wenn `schema.sql` fehlt oder veraltet ist,
ein Modul fehlt, leer oder doppelt eingetragen ist oder eine SQL-Datei unter `sql/` nicht in der
Modulliste steht. Der Build ist unabhängig vom aktuellen Arbeitsverzeichnis.

Der Workflow prüft Tests und erzeugtes Schema bereits im Pull Request, ohne Datenbankzugang.
Auf `main` und bei manuellem Start wird erst nach erfolgreicher Prüfung das Schema eingespielt.
Der Build prüft keine SQL-Syntax und ersetzt keine Datenbanktests. Für lokale Postgres-Tests sind
weiterhin Supabase-Platzhalter nötig, insbesondere für `auth.uid()`, `auth.role()` und die Auth-Rollen.
