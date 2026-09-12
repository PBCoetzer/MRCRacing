-- Preserves named racing products while keeping public editorial copy analysis-focused.
create table if not exists app_private.restricted_publishing_content_archive (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid not null,
  field_name text not null,
  original_value text not null,
  archived_at timestamptz not null default now(),
  unique (table_name, record_id, field_name)
);

revoke all on table app_private.restricted_publishing_content_archive
from public, anon, authenticated;

create or replace function app_private.contains_restricted_publishing_language(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(value, '') ~*
    '\m(gamble|gambles|gambled|gambling|gambler|gamblers|bookmaker|bookmakers|bet|bets|betted|betting|odds|winnings|dividend|dividends)\M';
$$;

revoke all on function app_private.contains_restricted_publishing_language(text)
from public, anon, authenticated;

insert into app_private.restricted_publishing_content_archive (
  table_name,
  record_id,
  field_name,
  original_value
)
select 'tip_cards', id, 'summary', summary
from public.tip_cards
where app_private.contains_restricted_publishing_language(summary)
on conflict (table_name, record_id, field_name) do nothing;

update public.tip_cards
set summary = 'Independent race analysis from this tipster.'
where app_private.contains_restricted_publishing_language(summary);

insert into app_private.restricted_publishing_content_archive (
  table_name,
  record_id,
  field_name,
  original_value
)
select 'race_tip_selections', id, 'comments', comments
from public.race_tip_selections
where app_private.contains_restricted_publishing_language(comments)
on conflict (table_name, record_id, field_name) do nothing;

update public.race_tip_selections
set comments = 'Tipster commentary updated to match MRC publishing standards.'
where app_private.contains_restricted_publishing_language(comments);

insert into app_private.restricted_publishing_content_archive (
  table_name,
  record_id,
  field_name,
  original_value
)
select 'tip_card_multiples', id, 'comments', comments
from public.tip_card_multiples
where app_private.contains_restricted_publishing_language(comments)
on conflict (table_name, record_id, field_name) do nothing;

update public.tip_card_multiples
set comments = 'Additional meeting commentary updated to match MRC publishing standards.'
where app_private.contains_restricted_publishing_language(comments);

insert into app_private.restricted_publishing_content_archive (
  table_name,
  record_id,
  field_name,
  original_value
)
select 'tipsters', id, 'biography', biography
from public.tipsters
where app_private.contains_restricted_publishing_language(biography)
on conflict (table_name, record_id, field_name) do nothing;

update public.tipsters
set biography = 'Independent South African horse-racing analysis on MRC Racing Tips.'
where app_private.contains_restricted_publishing_language(biography);

insert into app_private.restricted_publishing_content_archive (
  table_name,
  record_id,
  field_name,
  original_value
)
select 'tipster_applications', id, 'biography', biography
from public.tipster_applications
where app_private.contains_restricted_publishing_language(biography)
on conflict (table_name, record_id, field_name) do nothing;

update public.tipster_applications
set biography = 'Independent South African horse-racing analysis on MRC Racing Tips.'
where app_private.contains_restricted_publishing_language(biography);

insert into app_private.restricted_publishing_content_archive (
  table_name,
  record_id,
  field_name,
  original_value
)
select 'tipster_packages', id, 'name', name
from public.tipster_packages
where app_private.contains_restricted_publishing_language(name)
on conflict (table_name, record_id, field_name) do nothing;

insert into app_private.restricted_publishing_content_archive (
  table_name,
  record_id,
  field_name,
  original_value
)
select 'blog_posts', id, 'title', title
from public.blog_posts
where app_private.contains_restricted_publishing_language(title)
on conflict (table_name, record_id, field_name) do nothing;

insert into app_private.restricted_publishing_content_archive (
  table_name,
  record_id,
  field_name,
  original_value
)
select 'blog_posts', id, 'excerpt', excerpt
from public.blog_posts
where app_private.contains_restricted_publishing_language(excerpt)
on conflict (table_name, record_id, field_name) do nothing;

insert into app_private.restricted_publishing_content_archive (
  table_name,
  record_id,
  field_name,
  original_value
)
select 'blog_posts', id, 'body_markdown', body_markdown
from public.blog_posts
where app_private.contains_restricted_publishing_language(body_markdown)
on conflict (table_name, record_id, field_name) do nothing;

update public.blog_posts
set
  title = case
    when app_private.contains_restricted_publishing_language(title)
      then 'MRC Racing analysis update'
    else title
  end,
  excerpt = case
    when app_private.contains_restricted_publishing_language(excerpt)
      then 'Independent horse-racing analysis and information from MRC Racing Tips.'
    else excerpt
  end,
  body_markdown = case
    when app_private.contains_restricted_publishing_language(body_markdown)
      then 'This article has been updated to match MRC Racing Tips publishing standards.'
    else body_markdown
  end
where app_private.contains_restricted_publishing_language(title)
   or app_private.contains_restricted_publishing_language(excerpt)
   or app_private.contains_restricted_publishing_language(body_markdown);

create or replace function app_private.reject_restricted_publishing_language()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
  submitted_text text;
begin
  submitted_text := case tg_table_name
    when 'tip_cards' then row_data ->> 'summary'
    when 'race_tip_selections' then row_data ->> 'comments'
    when 'tip_card_multiples' then row_data ->> 'comments'
    when 'tipsters' then row_data ->> 'biography'
    when 'tipster_applications' then row_data ->> 'biography'
    when 'tipster_packages' then row_data ->> 'name'
    when 'blog_posts' then concat_ws(
      ' ',
      row_data ->> 'title',
      row_data ->> 'excerpt',
      row_data ->> 'body_markdown'
    )
    else null
  end;

  if app_private.contains_restricted_publishing_language(submitted_text) then
    raise exception using
      errcode = '22023',
      message = 'Published MRC content contains restricted terminology. Rephrase it as racing analysis before saving.';
  end if;

  return new;
end;
$$;

revoke all on function app_private.reject_restricted_publishing_language()
from public, anon, authenticated;

drop trigger if exists tip_cards_reject_restricted_language_insert on public.tip_cards;
create trigger tip_cards_reject_restricted_language_insert
before insert on public.tip_cards
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists tip_cards_reject_restricted_language_update on public.tip_cards;
create trigger tip_cards_reject_restricted_language_update
before update of summary on public.tip_cards
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists race_tip_selections_reject_restricted_language_insert
on public.race_tip_selections;
create trigger race_tip_selections_reject_restricted_language_insert
before insert on public.race_tip_selections
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists race_tip_selections_reject_restricted_language_update
on public.race_tip_selections;
create trigger race_tip_selections_reject_restricted_language_update
before update of comments on public.race_tip_selections
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists tip_card_multiples_reject_restricted_language_insert
on public.tip_card_multiples;
create trigger tip_card_multiples_reject_restricted_language_insert
before insert on public.tip_card_multiples
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists tip_card_multiples_reject_restricted_language_update
on public.tip_card_multiples;
create trigger tip_card_multiples_reject_restricted_language_update
before update of comments on public.tip_card_multiples
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists tipsters_reject_restricted_language_insert on public.tipsters;
create trigger tipsters_reject_restricted_language_insert
before insert on public.tipsters
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists tipsters_reject_restricted_language_update on public.tipsters;
create trigger tipsters_reject_restricted_language_update
before update of biography on public.tipsters
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists tipster_applications_reject_restricted_language_insert
on public.tipster_applications;
create trigger tipster_applications_reject_restricted_language_insert
before insert on public.tipster_applications
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists tipster_applications_reject_restricted_language_update
on public.tipster_applications;
create trigger tipster_applications_reject_restricted_language_update
before update of biography on public.tipster_applications
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists tipster_packages_reject_restricted_language_insert
on public.tipster_packages;
create trigger tipster_packages_reject_restricted_language_insert
before insert on public.tipster_packages
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists tipster_packages_reject_restricted_language_update
on public.tipster_packages;
create trigger tipster_packages_reject_restricted_language_update
before update of name on public.tipster_packages
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists blog_posts_reject_restricted_language_insert on public.blog_posts;
create trigger blog_posts_reject_restricted_language_insert
before insert on public.blog_posts
for each row execute function app_private.reject_restricted_publishing_language();

drop trigger if exists blog_posts_reject_restricted_language_update on public.blog_posts;
create trigger blog_posts_reject_restricted_language_update
before update of title, excerpt, body_markdown on public.blog_posts
for each row execute function app_private.reject_restricted_publishing_language();
