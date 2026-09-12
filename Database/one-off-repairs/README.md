# One-Off Production Repair Archive

Files in this directory are preserved for audit history and are not part of the canonical Supabase migration stream.

- `20260908070735_fix_tipster_skipped_race_revision_order.sql` was superseded by the live, more complete `harden_tip_card_revision_workflow` migration.
- `20260908071010_apply_fairview_20260909_late_changes.sql` is an environment-specific data repair. The live source-sync state must remain authoritative, so this script must not be replayed automatically.

Any future one-off repair must be idempotent, reviewed against current live data, executed only after explicit approval, and recorded separately from schema migrations.
