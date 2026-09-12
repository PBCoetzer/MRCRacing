-- Tipster and editorial content may use ordinary horse-racing terminology.
-- Public marketing copy remains analysis-focused, but database publishing is not vocabulary-gated.

drop trigger if exists tip_cards_reject_restricted_language_insert on public.tip_cards;
drop trigger if exists tip_cards_reject_restricted_language_update on public.tip_cards;

drop trigger if exists race_tip_selections_reject_restricted_language_insert
on public.race_tip_selections;
drop trigger if exists race_tip_selections_reject_restricted_language_update
on public.race_tip_selections;

drop trigger if exists tip_card_multiples_reject_restricted_language_insert
on public.tip_card_multiples;
drop trigger if exists tip_card_multiples_reject_restricted_language_update
on public.tip_card_multiples;

drop trigger if exists tipsters_reject_restricted_language_insert on public.tipsters;
drop trigger if exists tipsters_reject_restricted_language_update on public.tipsters;

drop trigger if exists tipster_applications_reject_restricted_language_insert
on public.tipster_applications;
drop trigger if exists tipster_applications_reject_restricted_language_update
on public.tipster_applications;

drop trigger if exists tipster_packages_reject_restricted_language_insert
on public.tipster_packages;
drop trigger if exists tipster_packages_reject_restricted_language_update
on public.tipster_packages;

drop trigger if exists blog_posts_reject_restricted_language_insert on public.blog_posts;
drop trigger if exists blog_posts_reject_restricted_language_update on public.blog_posts;

update public.tip_cards as tip_card
set summary = archived.original_value
from app_private.restricted_publishing_content_archive as archived
where archived.table_name = 'tip_cards'
  and archived.field_name = 'summary'
  and archived.record_id = tip_card.id
  and tip_card.summary = 'Independent race analysis from this tipster.';

update public.race_tip_selections as selection
set comments = archived.original_value
from app_private.restricted_publishing_content_archive as archived
where archived.table_name = 'race_tip_selections'
  and archived.field_name = 'comments'
  and archived.record_id = selection.id
  and selection.comments = 'Tipster commentary updated to match MRC publishing standards.';

update public.tip_card_multiples as multiple
set comments = archived.original_value
from app_private.restricted_publishing_content_archive as archived
where archived.table_name = 'tip_card_multiples'
  and archived.field_name = 'comments'
  and archived.record_id = multiple.id
  and multiple.comments = 'Additional meeting commentary updated to match MRC publishing standards.';

update public.tipsters as tipster
set biography = archived.original_value
from app_private.restricted_publishing_content_archive as archived
where archived.table_name = 'tipsters'
  and archived.field_name = 'biography'
  and archived.record_id = tipster.id
  and tipster.biography = 'Independent South African horse-racing analysis on MRC Racing Tips.';

update public.tipster_applications as application
set biography = archived.original_value
from app_private.restricted_publishing_content_archive as archived
where archived.table_name = 'tipster_applications'
  and archived.field_name = 'biography'
  and archived.record_id = application.id
  and application.biography = 'Independent South African horse-racing analysis on MRC Racing Tips.';

update public.blog_posts as post
set title = archived.original_value
from app_private.restricted_publishing_content_archive as archived
where archived.table_name = 'blog_posts'
  and archived.field_name = 'title'
  and archived.record_id = post.id
  and post.title = 'MRC Racing analysis update';

update public.blog_posts as post
set excerpt = archived.original_value
from app_private.restricted_publishing_content_archive as archived
where archived.table_name = 'blog_posts'
  and archived.field_name = 'excerpt'
  and archived.record_id = post.id
  and post.excerpt = 'Independent horse-racing analysis and information from MRC Racing Tips.';

update public.blog_posts as post
set body_markdown = archived.original_value
from app_private.restricted_publishing_content_archive as archived
where archived.table_name = 'blog_posts'
  and archived.field_name = 'body_markdown'
  and archived.record_id = post.id
  and post.body_markdown = 'This article has been updated to match MRC Racing Tips publishing standards.';

drop function if exists app_private.reject_restricted_publishing_language();
drop function if exists app_private.contains_restricted_publishing_language(text);

comment on table app_private.restricted_publishing_content_archive is
  'Historical archive of content changed by the retired publishing terminology restriction.';
