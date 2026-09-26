create or replace function app_private.queue_blog_post_registered_user_emails(
  target_post_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_row record;
  recipient record;
  eligible_user_count integer := 0;
  newly_queued_count integer := 0;
  blog_url text;
begin
  select
    posts.id,
    posts.slug,
    posts.title,
    posts.excerpt,
    posts.status,
    posts.published_at,
    tipsters.display_name as author_name
  into post_row
  from public.blog_posts posts
  join public.tipsters tipsters on tipsters.id = posts.tipster_id
  where posts.id = target_post_id;

  if post_row.id is null
    or post_row.status <> 'published'
    or post_row.published_at is null
    or nullif(btrim(post_row.slug), '') is null
  then
    raise exception 'Published blog post not found.';
  end if;

  select count(*)::integer
  into eligible_user_count
  from auth.users users
  join public.profiles profiles on profiles.id = users.id
  where users.deleted_at is null
    and users.email_confirmed_at is not null
    and nullif(btrim(users.email), '') is not null
    and (users.banned_until is null or users.banned_until <= now())
    and app_private.account_is_active(users.id)
    and profiles.email_notifications_enabled = true
    and profiles.email_marketing_consented_at is not null
    and (
      profiles.email_marketing_withdrawn_at is null
      or profiles.email_marketing_withdrawn_at < profiles.email_marketing_consented_at
    );

  blog_url := 'https://www.mrcracing.co.za/blog/' || post_row.slug || '/';

  for recipient in
    select users.id as user_id
    from auth.users users
    join public.profiles profiles on profiles.id = users.id
    where users.deleted_at is null
      and users.email_confirmed_at is not null
      and nullif(btrim(users.email), '') is not null
      and (users.banned_until is null or users.banned_until <= now())
      and app_private.account_is_active(users.id)
      and profiles.email_notifications_enabled = true
      and profiles.email_marketing_consented_at is not null
      and (
        profiles.email_marketing_withdrawn_at is null
        or profiles.email_marketing_withdrawn_at < profiles.email_marketing_consented_at
      )
      and not exists (
        select 1
        from public.notification_outbox outbox
        where outbox.user_id = users.id
          and outbox.channel = 'email'
          and outbox.event_type = 'blog_post_published_announcement'
          and outbox.payload ->> 'blogPostId' = post_row.id::text
      )
  loop
    perform app_private.enqueue_notification(
      recipient.user_id,
      'blog_post_published_announcement',
      'blog-post-announcement:' || post_row.id::text ||
        ':user:' || recipient.user_id::text || ':email',
      jsonb_build_object(
        'template', 'blog_post_published_announcement',
        'notificationAudience', 'marketing_consented_registered_users',
        'blogPostId', post_row.id,
        'blogTitle', post_row.title,
        'blogExcerpt', post_row.excerpt,
        'blogUrl', blog_url,
        'authorName', post_row.author_name,
        'publishedAt', post_row.published_at,
        'preferenceUrl', 'https://www.mrcracing.co.za/client/#email-announcements'
      )
    );

    newly_queued_count := newly_queued_count + 1;
  end loop;

  return jsonb_build_object(
    'eligibleUserCount', eligible_user_count,
    'newlyQueuedCount', newly_queued_count,
    'alreadyQueuedCount', eligible_user_count - newly_queued_count
  );
end;
$$;

revoke all on function app_private.queue_blog_post_registered_user_emails(uuid)
from public, anon, authenticated, service_role;

comment on function app_private.queue_blog_post_registered_user_emails(uuid) is
  'Queues one deduplicated blog announcement email for every active, confirmed registered user with current explicit email-announcement consent.';

create or replace function public.publish_blog_post(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tipster_id_value uuid := app_private.current_blog_tipster_id();
  post_row public.blog_posts%rowtype;
  was_already_published boolean := false;
  notification_summary jsonb := jsonb_build_object(
    'eligibleUserCount', 0,
    'newlyQueuedCount', 0,
    'alreadyQueuedCount', 0
  );
begin
  if tipster_id_value is null or not app_private.current_tipster_can_publish_blog() then
    raise exception 'Blog publishing permission is required.';
  end if;

  select * into post_row
  from public.blog_posts
  where id = p_post_id
  for update;

  if post_row.id is null or post_row.tipster_id <> tipster_id_value then
    raise exception 'Blog post not found.';
  end if;
  if post_row.status not in ('draft', 'published') then
    raise exception 'This post cannot be published in its current state.';
  end if;
  if not app_private.blog_markdown_is_safe(post_row.body_markdown) then
    raise exception 'The post body contains unsupported or unsafe content.';
  end if;

  was_already_published := post_row.status = 'published'
    and post_row.published_at is not null;

  update public.blog_posts
  set
    slug = coalesce(slug, app_private.blog_slug(title, id)),
    status = 'published',
    published_at = coalesce(published_at, now()),
    hidden_at = null,
    hidden_by = null,
    moderation_note = null
  where id = post_row.id
  returning * into post_row;

  if not was_already_published then
    notification_summary := app_private.queue_blog_post_registered_user_emails(
      post_row.id
    );
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    'blog_post_published',
    'blog_post',
    post_row.id,
    jsonb_build_object(
      'slug', post_row.slug,
      'firstPublication', not was_already_published,
      'notificationAudience', 'active_confirmed_registered_users_with_current_email_announcement_consent',
      'deliveryChannel', 'email',
      'queueSummary', notification_summary
    )
  );

  return to_jsonb(post_row) || jsonb_build_object(
    'notificationWasFirstPublication', not was_already_published,
    'notificationAudienceCount',
      (notification_summary ->> 'eligibleUserCount')::integer,
    'notificationNewlyQueuedCount',
      (notification_summary ->> 'newlyQueuedCount')::integer,
    'notificationAlreadyQueuedCount',
      (notification_summary ->> 'alreadyQueuedCount')::integer
  );
end;
$$;

revoke all on function public.publish_blog_post(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.publish_blog_post(uuid)
to authenticated;

comment on function public.publish_blog_post(uuid) is
  'Publishes an approved author article and queues deduplicated consent-aware email announcements only on its first publication.';

