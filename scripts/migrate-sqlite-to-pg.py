#!/usr/bin/env python3
"""One-shot: copy rows from apps/api/prisma/dev.db (SQLite) into Postgres."""
import json
import os
import sqlite3
import subprocess
import sys
import urllib.request

SQLITE = "/Users/manish/AI/apps/api/prisma/dev.db"
PG = [
    "psql",
    "-h",
    "127.0.0.1",
    "-p",
    "5433",
    "-U",
    "vsa",
    "-d",
    "voice_sales_agent",
    "-v",
    "ON_ERROR_STOP=1",
]
ENV = {**os.environ, "PGPASSWORD": "vsa"}

TABLES = [
    "Agent",
    "AvailabilityRules",
    "Call",
    "Lead",
    "Callback",
    "BrainMutation",
    "ProspectMemory",
    "GlobalLearningVector",
]

JSON_COLS = {
    "Agent": {"skillsConfig", "realtimeS2sConfig"},
    "Call": {"transcript"},
    "GlobalLearningVector": {"embedding"},
}
BOOL_COLS = {
    "Agent": {"learningsEnabled", "generalKnowledgeEnabled"},
    "AvailabilityRules": {"enabled"},
}


def pg_run(sql: str) -> subprocess.CompletedProcess:
    return subprocess.run(PG, input=sql, capture_output=True, text=True, env=ENV)


def pg_query(sql: str) -> str:
    r = subprocess.run(PG + ["-tAc", sql], capture_output=True, text=True, env=ENV)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout


PG_COLS = {}
PG_TYPES = {}
for t in TABLES:
    out = pg_query(
        "SELECT column_name||'|'||data_type FROM information_schema.columns "
        f"WHERE table_name='{t}' ORDER BY ordinal_position"
    )
    cols, types = [], {}
    for line in out.strip().split("\n"):
        if not line:
            continue
        c, ty = line.split("|", 1)
        cols.append(c)
        types[c] = ty
    PG_COLS[t] = cols
    PG_TYPES[t] = types


def lit(val, col, table):
    if val is None:
        return "NULL"
    ty = PG_TYPES[table].get(col, "")
    if col in BOOL_COLS.get(table, set()) or ty == "boolean":
        return "TRUE" if val in (1, True, "1", "true", "TRUE") else "FALSE"
    if "timestamp" in ty:
        if isinstance(val, (int, float)):
            ms = float(val)
            if ms > 1e12:
                ms = ms / 1000.0
            return f"to_timestamp({ms})"
        s = str(val).replace("'", "''")
        return f"'{s}'::timestamp"
    if col in JSON_COLS.get(table, set()) or ty == "jsonb":
        if isinstance(val, (bytes, bytearray)):
            val = val.decode("utf-8")
        s = val if isinstance(val, str) else json.dumps(val)
        if not s or s == "null":
            return "NULL"
        json.loads(s)
        return "'" + s.replace("'", "''") + "'::jsonb"
    if isinstance(val, float):
        return repr(val)
    if isinstance(val, int):
        return str(val)
    return "'" + str(val).replace("'", "''") + "'"


def main() -> int:
    sq = sqlite3.connect(SQLITE)
    sq.row_factory = sqlite3.Row

    rev = list(reversed(TABLES))
    r = pg_run("TRUNCATE " + ", ".join(f'"{t}"' for t in rev) + " CASCADE;")
    if r.returncode:
        print(r.stderr)
        return 1
    print("truncate ok")

    for table in TABLES:
        cols = PG_COLS[table]
        rows = sq.execute(f'SELECT * FROM "{table}"').fetchall()
        print(f"{table}: {len(rows)}")
        if not rows:
            continue
        col_list = ", ".join(f'"{c}"' for c in cols)
        batch = []
        for row in rows:
            vals = [lit(row[c] if c in row.keys() else None, c, table) for c in cols]
            batch.append(f'INSERT INTO "{table}" ({col_list}) VALUES ({", ".join(vals)});')
        for i in range(0, len(batch), 40):
            r = pg_run("\n".join(batch[i : i + 40]))
            if r.returncode:
                print(f"FAIL {table} @{i}:", r.stderr[:2500])
                return 1

    print(
        pg_query(
            """
SELECT 'Agent|'||count(*) FROM "Agent"
UNION ALL SELECT 'Call|'||count(*) FROM "Call"
UNION ALL SELECT 'Lead|'||count(*) FROM "Lead"
UNION ALL SELECT 'Callback|'||count(*) FROM "Callback"
UNION ALL SELECT 'BrainMutation|'||count(*) FROM "BrainMutation"
UNION ALL SELECT 'ProspectMemory|'||count(*) FROM "ProspectMemory"
UNION ALL SELECT 'GlobalLearningVector|'||count(*) FROM "GlobalLearningVector"
UNION ALL SELECT 'AvailabilityRules|'||count(*) FROM "AvailabilityRules";
"""
        )
    )

    req = urllib.request.Request(
        "http://127.0.0.1:3001/api/agents",
        headers={"Authorization": "Bearer dev-local-token"},
    )
    with urllib.request.urlopen(req) as resp:
        body = resp.read().decode()
        data = json.loads(body)
        print(f"API agents={len(data)} status={resp.status}")

    sq.close()
    print("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
