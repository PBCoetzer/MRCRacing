create index if not exists user_account_controls_updated_by_idx
  on public.user_account_controls (updated_by);

create unique index if not exists user_account_controls_last_request_id_uidx
  on public.user_account_controls (last_request_id)
  where last_request_id is not null;

create index if not exists admin_user_notes_created_by_idx
  on public.admin_user_notes (created_by);;
