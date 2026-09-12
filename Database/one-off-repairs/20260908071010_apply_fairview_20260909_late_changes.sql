do $$
declare
  target_meeting public.race_meetings%rowtype;
  target_fixture public.fixtures%rowtype;
  target_entry public.race_entries%rowtype;
  target_run_id uuid;
  target_source_id uuid;
  before_values jsonb;
  after_values jsonb;
begin
  select *
  into target_meeting
  from public.race_meetings
  where lower(venue) = 'fairview'
    and meeting_date = date '2026-09-09'
  order by created_at desc
  limit 1;

  if target_meeting.id is null then
    return;
  end if;

  select proposal.run_id, proposal.source_id
  into target_run_id, target_source_id
  from public.race_feed_proposals proposal
  where proposal.meeting_key = 'fairview:2026-09-09'
  order by proposal.created_at desc
  limit 1;

  if target_run_id is null or target_source_id is null then
    raise exception 'The Fairview 09 September 2026 race-feed audit source is unavailable.';
  end if;

  select *
  into target_fixture
  from public.fixtures
  where meeting_id = target_meeting.id
    and race_number = 1;

  select *
  into target_entry
  from public.race_entries
  where fixture_id = target_fixture.id
    and lower(horse_name) = 'indestructable';

  if target_entry.id is not null and target_entry.jockey_name is distinct from 'Jockey' then
    before_values := jsonb_build_object(
      'saddleNumber', target_entry.saddle_number,
      'horseName', target_entry.horse_name,
      'jockeyName', target_entry.jockey_name,
      'trainerName', target_entry.trainer_name,
      'draw', target_entry.draw,
      'carriedWeight', target_entry.carried_weight,
      'status', target_entry.status,
      'resultPosition', target_entry.result_position
    );

    update public.race_entries
    set
      jockey_name = 'Jockey',
      source_updated_at = now(),
      updated_at = now()
    where id = target_entry.id
    returning * into target_entry;

    after_values := jsonb_build_object(
      'saddleNumber', target_entry.saddle_number,
      'horseName', target_entry.horse_name,
      'jockeyName', target_entry.jockey_name,
      'trainerName', target_entry.trainer_name,
      'draw', target_entry.draw,
      'carriedWeight', target_entry.carried_weight,
      'status', target_entry.status,
      'resultPosition', target_entry.result_position
    );

    perform app_private.record_race_change(
      target_run_id,
      target_source_id,
      target_meeting.id,
      target_fixture.id,
      target_entry.id,
      'runner',
      'updated',
      array['jockeyName']::text[],
      before_values,
      after_values,
      'INDESTRUCTABLE changed in Fairview Race 1: jockeyName.',
      now(),
      true
    );
  end if;

  select *
  into target_fixture
  from public.fixtures
  where meeting_id = target_meeting.id
    and race_number = 8;

  select *
  into target_entry
  from public.race_entries
  where fixture_id = target_fixture.id
    and lower(horse_name) = 'remind me of you';

  if target_entry.id is not null and target_entry.status is distinct from 'scratched' then
    before_values := jsonb_build_object(
      'saddleNumber', target_entry.saddle_number,
      'horseName', target_entry.horse_name,
      'jockeyName', target_entry.jockey_name,
      'trainerName', target_entry.trainer_name,
      'draw', target_entry.draw,
      'carriedWeight', target_entry.carried_weight,
      'status', target_entry.status,
      'resultPosition', target_entry.result_position
    );

    update public.race_entries
    set
      status = 'scratched',
      source_updated_at = now(),
      updated_at = now()
    where id = target_entry.id
    returning * into target_entry;

    after_values := jsonb_build_object(
      'saddleNumber', target_entry.saddle_number,
      'horseName', target_entry.horse_name,
      'jockeyName', target_entry.jockey_name,
      'trainerName', target_entry.trainer_name,
      'draw', target_entry.draw,
      'carriedWeight', target_entry.carried_weight,
      'status', target_entry.status,
      'resultPosition', target_entry.result_position
    );

    perform app_private.record_race_change(
      target_run_id,
      target_source_id,
      target_meeting.id,
      target_fixture.id,
      target_entry.id,
      'runner',
      'updated',
      array['status']::text[],
      before_values,
      after_values,
      'REMIND ME OF YOU changed in Fairview Race 8: status.',
      now(),
      true
    );
  end if;
end;
$$;
