-- Add one allowlisted external video to a tipster blog article. Videos remain
-- provider-hosted so the site does not proxy large files through Edge Functions.

alter table public.blog_posts
  add column if not exists video_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.blog_posts'::regclass
      and conname = 'blog_posts_video_url_check'
  ) then
    alter table public.blog_posts
      add constraint blog_posts_video_url_check check (
        video_url is null
        or (
          char_length(video_url) <= 500
          and video_url ~* '^https://((www\.)?(youtube\.com|youtu\.be|vimeo\.com)|m\.youtube\.com|player\.vimeo\.com|youtube-nocookie\.com)/[^[:space:]]+$'
        )
      );
  end if;
end;
$$;

drop function if exists public.save_blog_post(uuid, text, text, text, text);

create function public.save_blog_post(
  p_post_id uuid,
  p_title text,
  p_excerpt text,
  p_body_markdown text,
  p_cover_image_path text default null,
  p_video_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tipster_id_value uuid := app_private.current_blog_tipster_id();
  post_row public.blog_posts%rowtype;
  video_url_value text := nullif(btrim(coalesce(p_video_url, '')), '');
begin
  if tipster_id_value is null or not app_private.current_tipster_can_publish_blog() then
    raise exception 'Blog publishing permission is required to create or edit posts.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 5 and 160 then
    raise exception 'The post title must contain 5 to 160 characters.';
  end if;
  if char_length(btrim(coalesce(p_excerpt, ''))) not between 10 and 400 then
    raise exception 'The post excerpt must contain 10 to 400 characters.';
  end if;
  if not app_private.blog_markdown_is_safe(p_body_markdown) then
    raise exception 'The post body contains unsupported or unsafe content.';
  end if;
  if p_cover_image_path is not null
    and p_cover_image_path !~ ('^' || tipster_id_value::text || '/[0-9a-f-]{36}/cover-[0-9]+\.webp$')
  then
    raise exception 'The cover image path is invalid.';
  end if;
  if video_url_value is not null and video_url_value !~* '^https://((www\.)?(youtube\.com|youtu\.be|vimeo\.com)|m\.youtube\.com|player\.vimeo\.com|youtube-nocookie\.com)/[^[:space:]]+$' then
    raise exception 'Use a valid HTTPS YouTube or Vimeo video link.';
  end if;

  if p_post_id is null then
    insert into public.blog_posts (
      tipster_id, title, excerpt, body_markdown, cover_image_path, video_url
    ) values (
      tipster_id_value,
      btrim(p_title),
      btrim(p_excerpt),
      btrim(p_body_markdown),
      nullif(btrim(coalesce(p_cover_image_path, '')), ''),
      video_url_value
    ) returning * into post_row;
  else
    select * into post_row
    from public.blog_posts
    where id = p_post_id
    for update;

    if post_row.id is null or post_row.tipster_id <> tipster_id_value then
      raise exception 'Blog post not found.';
    end if;
    if post_row.status in ('hidden', 'archived') then
      raise exception 'This post cannot be edited in its current state.';
    end if;
    update public.blog_posts
    set
      title = btrim(p_title),
      excerpt = btrim(p_excerpt),
      body_markdown = btrim(p_body_markdown),
      cover_image_path = nullif(btrim(coalesce(p_cover_image_path, '')), ''),
      video_url = video_url_value
    where id = post_row.id
    returning * into post_row;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    case when p_post_id is null then 'blog_post_created' else 'blog_post_saved' end,
    'blog_post',
    post_row.id,
    jsonb_build_object('status', post_row.status, 'hasVideo', post_row.video_url is not null)
  );

  return to_jsonb(post_row);
end;
$$;

create or replace function public.list_public_blog_posts(p_limit integer default 24)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by item ->> 'publishedAt' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', posts.id,
      'slug', posts.slug,
      'title', posts.title,
      'excerpt', posts.excerpt,
      'coverImagePath', posts.cover_image_path,
      'videoUrl', posts.video_url,
      'publishedAt', posts.published_at,
      'updatedAt', posts.updated_at,
      'author', tipsters.display_name,
      'commentCount', (
        select count(*) from public.blog_comments comments
        where comments.post_id = posts.id and comments.status = 'visible'
      )
    ) as item
    from public.blog_posts posts
    join public.tipsters tipsters on tipsters.id = posts.tipster_id
    where posts.status = 'published'
    order by posts.published_at desc
    limit greatest(1, least(coalesce(p_limit, 24), 100))
  ) public_posts;
$$;

create or replace function public.get_public_blog_post(p_slug text)
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
    'bodyMarkdown', posts.body_markdown,
    'coverImagePath', posts.cover_image_path,
    'videoUrl', posts.video_url,
    'publishedAt', posts.published_at,
    'updatedAt', posts.updated_at,
    'author', tipsters.display_name,
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', comments.id,
        'body', comments.body,
        'author', coalesce(nullif(btrim(profiles.display_name), ''), 'MRC client'),
        'isMine', comments.user_id = (select auth.uid()),
        'createdAt', comments.created_at
      ) order by comments.created_at)
      from public.blog_comments comments
      left join public.profiles profiles on profiles.id = comments.user_id
      where comments.post_id = posts.id and comments.status = 'visible'
    ), '[]'::jsonb)
  )
  from public.blog_posts posts
  join public.tipsters tipsters on tipsters.id = posts.tipster_id
  where posts.status = 'published' and posts.slug = btrim(p_slug)
  limit 1;
$$;

create or replace function public.get_public_blog_article(p_slug text)
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
    'bodyMarkdown', posts.body_markdown,
    'coverImagePath', posts.cover_image_path,
    'videoUrl', posts.video_url,
    'publishedAt', posts.published_at,
    'updatedAt', posts.updated_at,
    'author', tipsters.display_name,
    'authorSlug', tipsters.slug,
    'authorPhotoPath', tipsters.photo_path
  )
  from public.blog_posts posts
  join public.tipsters tipsters on tipsters.id = posts.tipster_id
  where posts.status = 'published'
    and posts.slug = btrim(p_slug)
    and tipsters.is_verified
  limit 1;
$$;

revoke all on function public.save_blog_post(uuid, text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.save_blog_post(uuid, text, text, text, text, text)
to authenticated;

revoke all on function public.list_public_blog_posts(integer) from public;
grant execute on function public.list_public_blog_posts(integer) to anon, authenticated;
revoke all on function public.get_public_blog_post(text) from public;
grant execute on function public.get_public_blog_post(text) to anon, authenticated;
revoke all on function public.get_public_blog_article(text) from public;
grant execute on function public.get_public_blog_article(text) to anon, authenticated;

select app_private.queue_site_content_build('Blog video links enabled', 'migration', null);
