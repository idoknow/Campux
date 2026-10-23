import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
# The current generated baseline reflects the new schema. Remove the four newly
# introduced AI tables first to emulate a database before the migration.
db.executescript((root / "packages/db/prisma/sqlite-baseline.sql").read_text())
for table in ("AiFeedback", "PostAiAnalysis", "SchoolModelSnapshot", "SchoolEntity"):
    db.execute(f'DROP TABLE "{table}"')
db.executescript((root / "packages/db/prisma/migrations/20261023120000_restore_ai_review_stage1/sqlite.sql").read_text())
tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
expected = {"SchoolEntity", "SchoolModelSnapshot", "PostAiAnalysis", "AiFeedback"}
assert expected <= tables, f"missing tables: {expected - tables}"
print("SQLite schema migration OK:", ", ".join(sorted(expected)))
