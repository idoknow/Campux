# Auto-moderation scheduling rollout

This migration is safe to retry after a partial apply: missing columns and the named index are created; existing objects are not dropped or rewritten. PostgreSQL still raises errors for missing prerequisite tables/columns or incompatible existing objects.

Before deploying to a database where this migration may have been run manually or interrupted, inspect `AiFeedback` and `PostAiAnalysis` and confirm existing columns have the expected types/defaults. `IF NOT EXISTS` cannot establish that a pre-existing same-named index has the expected definition. Resolve any mismatch explicitly before rollout; do not mark the migration applied until the schema is verified.

For SQLite, use the application’s canonical `applySqliteBaseline` migration runner. The sibling `sqlite.sql` is a standalone DDL reference, not the supported upgrade path for partially provisioned schemas (SQLite lacks portable `ADD COLUMN IF NOT EXISTS`). Back up the database before deployment and verify foreign keys after migration.
