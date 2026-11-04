"""
Täglicher Abruf: holt für alle Fahrer, die in einem Fantasy-Kader stehen,
die Saisonergebnisse von ProCyclingStats und speichert jedes Ergebnis
mit seinen UCI-Punkten in der Tabelle results.
Ergebnisse, die PCS nicht mehr ausweist (z. B. aberkannt), werden gelöscht –
eingefrorene Spieltage bleiben davon unberührt.
Danach rechnet die Datenbank Stichtage ab und schließt/friert Spieltage ein.
"""
import time
from datetime import date, timedelta

from procyclingstats import Race, Rider

import db

PAUSE = 1.5          # Sekunden zwischen Abrufen (PCS schonen)
NACHLAUF_TAGE = 14   # abgegebene Fahrer noch so lange prüfen (späte Korrekturen)


def owned_riders(today):
    since = (today - timedelta(days=NACHLAUF_TAGE)).isoformat()
    rows = db.select("roster_entries", {
        "select": "rider_slug",
        "or": f"(released_on.is.null,released_on.gte.{since})",
    })
    return sorted({r["rider_slug"] for r in rows})


def split_stage_url(stage_url):
    # z. B. 'race/tour-de-france/2026/stage-5' -> ('tour-de-france/2026', 'stage-5')
    parts = stage_url.strip("/").split("/")
    race_slug = "/".join(parts[1:3])
    label = "/".join(parts[3:]) or "result"
    return race_slug, label


def main():
    today = date.today()
    year = today.year
    slugs = owned_riders(today)
    print(f"{len(slugs)} Fahrer in Kadern.")
    if not slugs:
        db.rpc("run_maintenance")
        return

    genders = {r["pcs_slug"]: r["gender"] for r in db.select(
        "riders", {"select": "pcs_slug,gender", "pcs_slug": f"in.({','.join(slugs)})"})}
    known_races = {r["pcs_slug"] for r in db.select("races", {"select": "pcs_slug"})}

    races, results, race_info = {}, [], {}
    fetched_ok = set()   # Fahrer, deren Ergebnisliste vollständig geladen wurde

    def race_details(race_slug):
        """Start-/Enddatum eines Rennens (nur für neue Rennen abgerufen)."""
        if race_slug not in race_info:
            time.sleep(PAUSE)
            try:
                rc = Race(f"race/{race_slug}")
                race_info[race_slug] = (rc.name(), rc.startdate(), rc.enddate())
            except Exception as e:
                print(f"  Rennen {race_slug} nicht lesbar: {e}")
                race_info[race_slug] = (None, None, None)
        return race_info[race_slug]

    for slug in slugs:
        time.sleep(PAUSE)
        try:
            rows = Rider(f"rider/{slug}/{year}").season_results(
                "stage_url", "stage_name", "date", "result", "uci_points")
        except Exception as e:
            print(f"  {slug}: Fehler beim Abruf – {e}")
            continue
        fetched_ok.add(slug)

        for row in rows:
            try:
                points = float(row.get("uci_points") or 0)
            except (TypeError, ValueError):
                points = 0
            if points <= 0 or not row.get("stage_url"):
                continue

            race_slug, label = split_stage_url(row["stage_url"])
            result_date = row.get("date")

            if race_slug not in known_races and race_slug not in races:
                name, start, end = race_details(race_slug)
                races[race_slug] = {
                    "pcs_slug": race_slug,
                    "name": name or (row.get("stage_name") or race_slug).split("|")[0].strip(),
                    "gender": genders.get(slug, "men"),
                    "start_date": start,
                    "end_date": end,
                }
            if not result_date:
                # Gesamt- und Trikotwertungen haben kein Datum -> letzter Renntag
                result_date = race_details(race_slug)[2]
            if not result_date:
                print(f"  {slug}: kein Datum für {row['stage_url']}, übersprungen")
                continue

            rank = row.get("result")
            results.append({
                "rider_slug": slug,
                "race_slug": race_slug,
                "label": label,
                "result_date": result_date,
                "rank": rank if isinstance(rank, int) else None,
                "uci_points": points,
            })

    db.upsert("races", list(races.values()), "pcs_slug")
    db.upsert("results", results, "rider_slug,race_slug,label")
    print(f"{len(races)} neue Rennen, {len(results)} Ergebnisse gespeichert.")

    # Delta-Korrektur: Ergebnisse dieser Saison, die bei PCS nicht mehr auftauchen
    current = {(r["rider_slug"], r["race_slug"], r["label"]) for r in results}
    stale = []
    for chunk in (sorted(fetched_ok)[i:i + 100] for i in range(0, len(fetched_ok), 100)):
        for row in db.select("results", {
            "select": "id,rider_slug,race_slug,label",
            "rider_slug": f"in.({','.join(chunk)})",
            "result_date": f"gte.{year}-01-01",
        }):
            if (row["rider_slug"], row["race_slug"], row["label"]) not in current:
                stale.append(row["id"])
    for i in range(0, len(stale), 200):
        db.delete("results", {"id": f"in.({','.join(map(str, stale[i:i + 200]))})"})
    if stale:
        print(f"{len(stale)} nicht mehr gültige Ergebnisse entfernt.")

    # Stichtage, Spieltags-Status, Einfrieren nach 7 Tagen
    db.rpc("run_maintenance")
    print("Spieltage aktualisiert.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        try:
            db.update("sync_status", {"id": "eq.1"}, {"ok": False, "message": str(e)[:500]})
        finally:
            raise
