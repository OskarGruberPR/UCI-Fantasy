"""Kleine Hilfsfunktionen für den Zugriff auf Supabase (REST-Schnittstelle)."""
import os
import requests

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
}


def select(table, params):
    r = requests.get(f"{URL}/rest/v1/{table}", headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def upsert(table, rows, on_conflict):
    """Fügt Zeilen ein oder aktualisiert sie, falls schon vorhanden."""
    headers = {**HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"}
    for i in range(0, len(rows), 500):
        r = requests.post(
            f"{URL}/rest/v1/{table}",
            headers=headers,
            params={"on_conflict": on_conflict},
            json=rows[i:i + 500],
            timeout=60,
        )
        if not r.ok:
            raise RuntimeError(f"Upsert {table} fehlgeschlagen: {r.status_code} {r.text}")


def update(table, filters, values):
    headers = {**HEADERS, "Prefer": "return=minimal"}
    r = requests.patch(f"{URL}/rest/v1/{table}", headers=headers, params=filters, json=values, timeout=30)
    r.raise_for_status()
