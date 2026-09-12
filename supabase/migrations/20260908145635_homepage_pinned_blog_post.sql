alter table public.blog_posts
add column if not exists is_pinned boolean not null default false;

create or replace function app_private.enforce_homepage_blog_pin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_pinned
    and (
      new.status <> 'published'
      or new.slug is null
      or new.published_at is null
    )
  then
    new.is_pinned := false;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_homepage_blog_pin on public.blog_posts;
create trigger enforce_homepage_blog_pin
before insert or update on public.blog_posts
for each row execute function app_private.enforce_homepage_blog_pin();

create unique index if not exists blog_posts_single_homepage_pin_idx
on public.blog_posts (is_pinned)
where is_pinned;

create or replace function public.admin_set_pinned_blog_post(
  p_post_id uuid,
  p_pinned boolean,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  post_row public.blog_posts%rowtype;
begin
  if actor_id is null or not app_private.current_user_has_role('administrator') then
    raise exception 'Administrator access required.';
  end if;

  if char_length(btrim(coalesce(p_note, ''))) not between 5 and 500 then
    raise exception 'An audit note of 5 to 500 characters is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('mrc-homepage-blog-pin'));

  select *
  into post_row
  from public.blog_posts
  where id = p_post_id
  for update;

  if post_row.id is null then
    raise exception 'Blog post not found.';
  end if;

  if p_pinned and (
    post_row.status <> 'published'
    or post_row.slug is null
    or post_row.published_at is null
  ) then
    raise exception 'Only a published blog post can be pinned to the homepage.';
  end if;

  if p_pinned then
    update public.blog_posts
    set is_pinned = false
    where is_pinned and id <> p_post_id;
  end if;

  update public.blog_posts
  set
    is_pinned = p_pinned,
    updated_at = now()
  where id = p_post_id
  returning * into post_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    case when p_pinned then 'blog_post_pinned' else 'blog_post_unpinned' end,
    'blog_post',
    post_row.id,
    jsonb_build_object(
      'title', post_row.title,
      'homepagePinned', post_row.is_pinned,
      'note', btrim(p_note)
    )
  );

  return jsonb_build_object(
    'id', post_row.id,
    'title', post_row.title,
    'isPinned', post_row.is_pinned
  );
end;
$$;

create or replace function public.get_pinned_blog_post()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', posts.id,
    'slug', posts.slug,
    'title', posts.title,
    'excerpt', posts.excerpt,
    'coverImagePath', posts.cover_image_path,
    'publishedAt', posts.published_at,
    'updatedAt', posts.updated_at,
    'author', tipsters.display_name,
    'authorSlug', case
      when tipsters.is_verified and tipsters.is_public then tipsters.slug
      else null
    end
  )
  from public.blog_posts posts
  join public.tipsters tipsters on tipsters.id = posts.tipster_id
  where posts.is_pinned
    and posts.status = 'published'
    and posts.slug is not null
  limit 1;
$$;

revoke all on function app_private.enforce_homepage_blog_pin() from public, anon, authenticated;

revoke all on function public.admin_set_pinned_blog_post(uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.admin_set_pinned_blog_post(uuid, boolean, text)
to authenticated;

revoke all on function public.get_pinned_blog_post()
from public, anon, authenticated;
grant execute on function public.get_pinned_blog_post()
to anon, authenticated;
