begin;

insert into public.profiles (
  id,
  display_name,
  phone
)
select
  u.id,
  nullif(u.raw_user_meta_data ->> 'display_name', ''),
  nullif(u.raw_user_meta_data ->> 'phone', '')
from auth.users u
on conflict (id) do nothing;

commit;
