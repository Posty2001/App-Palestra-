-- APP PALESTRA — schema iniziale
-- Tutte le date/ore in timestamptz (UTC). Gli id delle entità create offline
-- (sedute, serie, check) sono UUID generati dal client: rendono idempotente la sincronizzazione.

create extension if not exists citext;

create table users (
  id                  uuid primary key default gen_random_uuid(),
  email               citext not null unique,
  password_hash       text not null,
  display_name        text not null check (char_length(display_name) between 1 and 80),
  role                text not null check (role in ('coach', 'athlete')),
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  password_changed_at timestamptz not null default now()
);

create table auth_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   bytea not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  user_agent   text
);
create index auth_sessions_user_idx on auth_sessions(user_id);

create table password_resets (
  token_hash bytea primary key,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create table invites (
  id           uuid primary key default gen_random_uuid(),
  coach_id     uuid not null references users(id) on delete cascade,
  token_hash   bytea not null unique,
  athlete_name text not null check (char_length(athlete_name) between 1 and 80),
  email        citext,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by      uuid references users(id) on delete set null,
  revoked_at   timestamptz
);
create index invites_coach_idx on invites(coach_id, created_at desc);

-- Collegamento coach–atleta. Un atleta ha al massimo un coach attivo.
create table coach_links (
  coach_id      uuid not null references users(id) on delete cascade,
  athlete_id    uuid not null references users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz,
  check_weekday smallint check (check_weekday between 0 and 6), -- 0 = domenica (Date.getDay)
  key_exercises text[] not null default '{}',
  primary key (coach_id, athlete_id),
  check (coach_id <> athlete_id)
);
create unique index coach_links_one_active on coach_links(athlete_id) where ended_at is null;

create table programs (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references users(id) on delete cascade,
  created_by             uuid not null references users(id) on delete cascade,
  name                   text not null check (char_length(name) between 1 and 80),
  start_date             date,
  end_date               date,
  current_version_id     uuid,
  draft                  jsonb,          -- {name,startDate,endDate,content}
  draft_updated_at       timestamptz,
  next_day_index         int not null default 0 check (next_day_index >= 0),
  owner_seen_version_no  int not null default 1,
  source_program_id      uuid references programs(id) on delete set null,
  expiry_reviewed_at     timestamptz,
  archived_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index programs_owner_idx on programs(owner_id) where archived_at is null;

create table program_versions (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references programs(id) on delete cascade,
  version_no     int not null,
  content        jsonb not null,
  change_summary text,
  published_by   uuid references users(id) on delete set null,
  published_at   timestamptz not null default now(),
  unique (program_id, version_no)
);
alter table programs
  add constraint programs_current_version_fk foreign key (current_version_id)
  references program_versions(id) deferrable initially deferred;

create table workouts (
  id                 uuid primary key,
  athlete_id         uuid not null references users(id) on delete cascade,
  program_id         uuid references programs(id) on delete set null,
  program_version_id uuid references program_versions(id) on delete set null,
  version_no         int,
  program_name       text,
  day_index          int not null check (day_index >= 0),
  day_snapshot       jsonb not null,   -- giorno esattamente eseguito (immutabile)
  status             text not null check (status in ('in_progress', 'completed', 'discarded')),
  started_at         timestamptz not null,
  ended_at           timestamptz,
  athlete_note       text check (char_length(athlete_note) <= 2000),
  exercise_states    jsonb not null default '{}'::jsonb,
  coach_reviewed_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index workouts_one_in_progress on workouts(athlete_id) where status = 'in_progress';
create index workouts_athlete_idx on workouts(athlete_id, started_at desc);

create table workout_sets (
  id            uuid primary key,
  workout_id    uuid not null references workouts(id) on delete cascade,
  athlete_id    uuid not null references users(id) on delete cascade,
  exercise_slot text not null,
  exercise_key  text not null,
  exercise_name text not null,
  kind          text not null check (kind in ('warmup', 'work')),
  set_index     int not null check (set_index between 0 and 50),
  weight_kg     numeric(6, 2) check (weight_kg between 0 and 1000),
  reps          int check (reps between 0 and 200),
  rir           smallint check (rir between 0 and 10),
  completed_at  timestamptz not null,
  updated_at    timestamptz not null default now()
);
create index workout_sets_workout_idx on workout_sets(workout_id);
create index workout_sets_progress_idx on workout_sets(athlete_id, exercise_key, completed_at desc);

create table exercise_notes (
  user_id       uuid not null references users(id) on delete cascade,
  exercise_key  text not null,
  machine_setup text check (char_length(machine_setup) <= 300),
  updated_at    timestamptz not null default now(),
  primary key (user_id, exercise_key)
);

create table exercise_feedback (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references users(id) on delete cascade,
  coach_id      uuid not null references users(id) on delete cascade,
  exercise_key  text not null,
  exercise_name text not null,
  body          text not null check (char_length(body) between 1 and 2000),
  created_at    timestamptz not null default now()
);
create index exercise_feedback_idx on exercise_feedback(athlete_id, exercise_key, created_at desc);

create table questions (
  id            uuid primary key,
  athlete_id    uuid not null references users(id) on delete cascade,
  coach_id      uuid references users(id) on delete set null,
  exercise_key  text not null,
  exercise_name text not null,
  body          text not null check (char_length(body) between 1 and 500),
  context       jsonb,
  answer        text check (char_length(answer) <= 2000),
  answered_at   timestamptz,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index questions_athlete_idx on questions(athlete_id, exercise_key);
create index questions_coach_open_idx on questions(coach_id) where reviewed_at is null;

create table body_checks (
  id           uuid primary key,
  athlete_id   uuid not null references users(id) on delete cascade,
  check_date   date not null,
  weight_kg    numeric(5, 2) check (weight_kg between 20 and 400),
  biceps_cm    numeric(5, 1) check (biceps_cm between 10 and 100),
  chest_cm     numeric(5, 1) check (chest_cm between 40 and 250),
  thigh_cm     numeric(5, 1) check (thigh_cm between 20 and 150),
  waist_cm     numeric(5, 1) check (waist_cm between 30 and 250),
  note         text check (char_length(note) <= 2000),
  share_photos boolean not null default false,  -- foto private per impostazione iniziale
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index body_checks_athlete_idx on body_checks(athlete_id, check_date desc);

create table check_photos (
  id          uuid primary key default gen_random_uuid(),
  check_id    uuid not null references body_checks(id) on delete cascade,
  athlete_id  uuid not null references users(id) on delete cascade,
  pose        text not null check (pose in ('front', 'side', 'back')),
  storage_key text not null unique,
  mime        text not null,
  bytes       int not null,
  width       int not null,
  height      int not null,
  created_at  timestamptz not null default now(),
  unique (check_id, pose)
);

create table check_feedback (
  id         uuid primary key default gen_random_uuid(),
  check_id   uuid not null references body_checks(id) on delete cascade,
  coach_id   uuid not null references users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table weight_entries (
  id          uuid primary key,
  athlete_id  uuid not null references users(id) on delete cascade,
  measured_on date not null,
  weight_kg   numeric(5, 2) not null check (weight_kg between 20 and 400),
  created_at  timestamptz not null default now()
);
create index weight_entries_idx on weight_entries(athlete_id, measured_on desc);

-- File da eliminare dall'archivio (scritti in transazione, svuotati dopo il commit).
create table storage_gc (
  storage_key text primary key,
  queued_at   timestamptz not null default now()
);

-- Qualsiasi eliminazione di foto (diretta o a cascata da check/utente) accoda il file.
create function check_photos_gc() returns trigger language plpgsql as $$
begin
  insert into storage_gc(storage_key) values (old.storage_key) on conflict do nothing;
  return old;
end $$;
create trigger check_photos_gc_trg after delete on check_photos
  for each row execute function check_photos_gc();
