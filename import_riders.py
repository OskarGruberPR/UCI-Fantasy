"""
Fahrerliste mit UCI-Rang aus ProCyclingStats in die Tabelle riders laden.
Der Rang wird als prev_year_rank gespeichert und bestimmt die Draft-Reihenfolge.

Am besten kurz vor dem Draft (z. B. im Dezember) einmal manuell starten.
"""
import time
from datetime import datetime, timezone

from procyclingstats import Ranking

import db

RANKINGS = {"men": "me", "women": "we"}   # PCS-Kürzel: me = Männer, we = Frauen
MAX_RIDERS = 600                           # reicht für 10 Teams à 30 Fahrer mit Puffer
PAUSE = 1.5                                # Sekunden zwischen Abrufen (PCS schonen)


def ranking_rows(prefix):
    base = f"rankings/{prefix}/uci-individual"
    first = Ranking(base)
    rows = first.individual_ranking()
    try:
        pages = [p["value"] for p in first.pages_select()]
    except Exception:
        pages = []
    for value in pages[1:]:
        if len(rows) >= MAX_RIDERS:
            break
        time.sleep(PAUSE)
        try:
            rows += Ranking(value).individual_ranking()
        except Exception as e:
            print(f"  Seite {value} übersprungen: {e}")
    return rows[:MAX_RIDERS]


def main():
    now = datetime.now(timezone.utc).isoformat()
    for gender, prefix in RANKINGS.items():
        print(f"Lade UCI-Ranking {gender} …")
        rows = ranking_rows(prefix)
        riders = [
            {
                "pcs_slug": r["rider_url"].removeprefix("rider/"),
                "name": r["rider_name"],
                "gender": gender,
                "nation": r.get("nationality"),
                "team": r.get("team_name"),
                "prev_year_rank": r.get("rank"),
                "updated_at": now,
            }
            for r in rows if r.get("rider_url")
        ]
        db.upsert("riders", riders, "pcs_slug")
        print(f"  {len(riders)} Fahrer gespeichert.")
        time.sleep(PAUSE)


if __name__ == "__main__":
    main()
