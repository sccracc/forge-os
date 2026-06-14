-- ============================================================================
-- Forge OS — Supabase schema
-- ============================================================================
-- Run this ENTIRE file in the Supabase SQL Editor (it is idempotent — safe to
-- re-run). It has two sections:
--   SECTION 1 — the base schema, exactly as provided.
--   SECTION 2 — "Forge OS additions": the extra columns and tables the app
--               actually reads/writes. WITHOUT section 2, Forge Code (IDE,
--               build dock, checkpoints, publishing), large-file blobs, custom
--               agents, and chat branching will be missing columns and break.
-- The Firebase UID (a text string) is the primary key / foreign key everywhere.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — base schema
-- ============================================================================

create extension if not exists "uuid-ossp";

create table if not exists users (
  id text primary key,
  email text unique not null,
  name text,
  avatar_url text,
  plan text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_settings (
  user_id text primary key references users(id) on delete cascade,
  custom_instructions_about text,
  custom_instructions_style text,
  default_model text not null default 'spark-2.5',
  default_effort text not null default 'low',
  default_thinking boolean not null default false,
  theme text not null default 'light',
  updated_at timestamptz not null default now()
);

create table if not exists usage (
  user_id text primary key references users(id) on delete cascade,
  window_5h_forge_tokens bigint not null default 0,
  window_5h_opened_at timestamptz,
  weekly_forge_tokens bigint not null default 0,
  weekly_opened_at timestamptz,
  daily_forge_tokens bigint not null default 0,
  daily_reset_at timestamptz,
  -- numeric (not integer): a fallback from the premium image model counts as 0.5.
  images_this_month numeric not null default 0,
  vision_this_month integer not null default 0,
  searches_this_month integer not null default 0,
  documents_this_month integer not null default 0,
  voice_input_minutes_this_month numeric not null default 0,
  voice_output_chars_this_month integer not null default 0,
  code_executions_this_month integer not null default 0,
  month_reset_at timestamptz not null default
    (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC',
  updated_at timestamptz not null default now()
);

-- Migrate existing databases: image usage went from whole counts to numeric so a
-- premium-model fallback can count as half an image. Idempotent — re-runnable.
alter table usage alter column images_this_month type numeric;

create table if not exists conversations (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  project_id text,
  title text not null default 'New chat',
  is_incognito boolean not null default false,
  model text,
  effort text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null
    references conversations(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null,
  content text,
  thinking_content text,
  model text,
  effort text,
  thinking_enabled boolean default false,
  real_tokens_used integer,
  forge_tokens_deducted integer,
  multiplier_used integer,
  parent_id text references messages(id) on delete set null,
  attachments jsonb,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  description text,
  instructions text,
  type text not null default 'chat',
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists files (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  project_id text references projects(id) on delete set null,
  name text not null,
  path text not null,
  parent_id text references files(id) on delete cascade,
  type text,
  language text,
  size integer,
  storage_url text,
  content text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists skills (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  description text,
  instructions text,
  is_active boolean not null default true,
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists memory (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  content text not null,
  source_conversation_id text
    references conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_conversations_user_id
  on conversations(user_id);
create index if not exists idx_conversations_updated_at
  on conversations(updated_at desc);
create index if not exists idx_messages_conversation_id
  on messages(conversation_id);
create index if not exists idx_messages_created_at
  on messages(created_at);
create index if not exists idx_projects_user_id
  on projects(user_id);
create index if not exists idx_files_project_id
  on files(project_id);
create index if not exists idx_skills_user_id
  on skills(user_id);
create index if not exists idx_memory_user_id
  on memory(user_id);

alter table users enable row level security;
alter table user_settings enable row level security;
alter table usage enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table projects enable row level security;
alter table files enable row level security;
alter table skills enable row level security;
alter table memory enable row level security;

create or replace function deduct_forge_tokens(
  p_user_id text,
  p_forge_tokens bigint,
  p_is_free_plan boolean default false
) returns void as $$
declare
  v_now timestamptz := now();
  v_usage usage%rowtype;
begin
  select * into v_usage
    from usage where user_id = p_user_id for update;

  if not found then
    insert into usage (user_id) values (p_user_id);
    select * into v_usage
      from usage where user_id = p_user_id for update;
  end if;

  if p_is_free_plan then
    if v_usage.daily_reset_at is null
      or v_now >= v_usage.daily_reset_at then
      update usage set
        daily_forge_tokens = p_forge_tokens,
        daily_reset_at =
          (date_trunc('day', v_now at time zone 'UTC') + interval '1 day') at time zone 'UTC',
        updated_at = v_now
      where user_id = p_user_id;
    else
      update usage set
        daily_forge_tokens =
          daily_forge_tokens + p_forge_tokens,
        updated_at = v_now
      where user_id = p_user_id;
    end if;
  else
    if v_usage.window_5h_opened_at is null
      or v_now >=
        v_usage.window_5h_opened_at + interval '5 hours' then
      update usage set
        window_5h_forge_tokens = p_forge_tokens,
        window_5h_opened_at = v_now,
        updated_at = v_now
      where user_id = p_user_id;
    else
      update usage set
        window_5h_forge_tokens =
          window_5h_forge_tokens + p_forge_tokens,
        updated_at = v_now
      where user_id = p_user_id;
    end if;

    if v_usage.weekly_opened_at is null
      or v_now >=
        v_usage.weekly_opened_at + interval '7 days' then
      update usage set
        weekly_forge_tokens = p_forge_tokens,
        weekly_opened_at = v_now,
        updated_at = v_now
      where user_id = p_user_id;
    else
      update usage set
        weekly_forge_tokens =
          weekly_forge_tokens + p_forge_tokens,
        updated_at = v_now
      where user_id = p_user_id;
    end if;
  end if;

  if v_usage.month_reset_at is null
    or v_now >= v_usage.month_reset_at then
    update usage set
      images_this_month = 0,
      vision_this_month = 0,
      searches_this_month = 0,
      documents_this_month = 0,
      voice_input_minutes_this_month = 0,
      voice_output_chars_this_month = 0,
      code_executions_this_month = 0,
      month_reset_at =
        (date_trunc('month', v_now at time zone 'UTC') + interval '1 month') at time zone 'UTC',
      updated_at = v_now
    where user_id = p_user_id;
  end if;
end;
$$ language plpgsql;


-- ============================================================================
-- SECTION 2 — Forge OS additions (required by the app)
-- ============================================================================
-- All ALTERs use "if not exists" and all new tables use "create table if not
-- exists", so this section is safe to re-run.

-- ---- user_settings: the rest of the profile/preferences -------------------
alter table user_settings add column if not exists default_tools_enabled boolean not null default false;
alter table user_settings add column if not exists default_preview_mode text not null default 'auto';
alter table user_settings add column if not exists build_autonomy text not null default 'auto';
alter table user_settings add column if not exists memory_enabled boolean not null default true;
alter table user_settings add column if not exists search_chats_enabled boolean not null default true;
alter table user_settings add column if not exists memory_profile text;
alter table user_settings add column if not exists skills_seeded boolean not null default false;

-- ---- conversations: per-chat thinking toggle, active branch, pin, agent ----
alter table conversations add column if not exists thinking boolean not null default false;
alter table conversations add column if not exists active_leaf_id text;
alter table conversations add column if not exists pinned boolean;
alter table conversations add column if not exists agent_id text;

-- ---- messages: reasoning timing, display tokens, tool/error flags, refs ----
-- (app `reasoning` -> existing column `thinking_content`; app `thinking` ->
--  existing `thinking_enabled`.)
alter table messages add column if not exists reasoning_ms integer;
alter table messages add column if not exists tokens integer;
alter table messages add column if not exists had_tool_call boolean;
alter table messages add column if not exists error boolean;
alter table messages add column if not exists skills_used jsonb;
alter table messages add column if not exists agent_used jsonb;
alter table messages add column if not exists searches jsonb;

-- ---- projects: Forge Code scaffolding / preview / publish metadata ---------
alter table projects add column if not exists starter text;
alter table projects add column if not exists preview_mode text;
alter table projects add column if not exists gradient text[];
alter table projects add column if not exists file_count integer not null default 0;
alter table projects add column if not exists forge_md text;
alter table projects add column if not exists published jsonb;

-- ---- files: file/folder discriminator + categorization + blob fallback -----
-- (app `storagePath` -> existing column `storage_url`.)
alter table files add column if not exists kind text;
alter table files add column if not exists category text;
alter table files add column if not exists mime text;
alter table files add column if not exists chunked boolean;

-- ---- skills: slug + presentation + versioning + attached files ------------
-- (app `enabled` -> existing `is_active`; app `builtin` -> existing `is_builtin`.)
alter table skills add column if not exists slug text;
alter table skills add column if not exists icon text;
alter table skills add column if not exists category text;
alter table skills add column if not exists version integer not null default 1;
alter table skills add column if not exists files jsonb;
alter table skills add column if not exists favorite boolean;
alter table skills add column if not exists last_used_at timestamptz;
create index if not exists idx_skills_slug on skills(user_id, slug);

-- ---- agents: reusable AI personas (Forge) ---------------------------------
create table if not exists agents (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  description text,
  avatar text,
  system_prompt text,
  default_model text,
  default_effort text,
  default_thinking boolean,
  skill_slugs jsonb,
  allowed_tools jsonb,
  default_project_id text,
  enabled boolean not null default true,
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_agents_user_id on agents(user_id);
alter table agents enable row level security;

-- ---- checkpoints: project file-tree snapshots (version history) -----------
create table if not exists checkpoints (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  label text not null,
  kind text not null,
  at timestamptz not null default now(),
  file_count integer not null default 0,
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_checkpoints_project_id on checkpoints(project_id);
alter table checkpoints enable row level security;

-- ---- build_log: Forge Code build-dock transcript --------------------------
create table if not exists build_log (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  role text not null,
  content text,
  files jsonb,
  skills_used jsonb,
  agent_run jsonb,
  error boolean,
  created_at timestamptz not null default now()
);
create index if not exists idx_build_log_project_id on build_log(project_id);
-- Backfill the agent-run trace column on databases created before it existed.
alter table build_log add column if not exists agent_run jsonb;
alter table build_log enable row level security;

-- ---- file_chunks: base64 blob fallback when Firebase Storage is unavailable
-- (Firebase Storage stays the primary blob backend; this only mirrors the
--  previous Firestore-chunk fallback so nothing is lost.)
create table if not exists file_chunks (
  file_id text not null,
  user_id text not null references users(id) on delete cascade,
  idx integer not null,
  data text not null,
  primary key (file_id, idx)
);
create index if not exists idx_file_chunks_file_id on file_chunks(file_id);
alter table file_chunks enable row level security;

-- ---- published: public, shareable static project snapshots (/p/{id}) -------
create table if not exists published (
  id text primary key,
  owner text not null references users(id) on delete cascade,
  name text,
  html text,
  at timestamptz not null default now()
);
alter table published enable row level security;

-- ---- increment_usage: atomic per-feature monthly counters -------------------
-- Bumps the monthly feature counters (images/vision/searches/documents/voice/
-- code) atomically. Ensures the usage row exists and resets the monthly block
-- when due (mirrors deduct_forge_tokens), so a feature used without a chat turn
-- (e.g. code execution) still rolls the month correctly.
create or replace function increment_usage(
  p_user_id text,
  p_images numeric default 0,
  p_vision integer default 0,
  p_searches integer default 0,
  p_documents integer default 0,
  p_voice_input_minutes numeric default 0,
  p_voice_output_chars integer default 0,
  p_code_executions integer default 0
) returns void as $$
declare
  v_now timestamptz := now();
  v_usage usage%rowtype;
begin
  select * into v_usage from usage where user_id = p_user_id for update;

  if not found then
    insert into usage (user_id) values (p_user_id);
    select * into v_usage from usage where user_id = p_user_id for update;
  end if;

  if v_usage.month_reset_at is null or v_now >= v_usage.month_reset_at then
    update usage set
      images_this_month = 0,
      vision_this_month = 0,
      searches_this_month = 0,
      documents_this_month = 0,
      voice_input_minutes_this_month = 0,
      voice_output_chars_this_month = 0,
      code_executions_this_month = 0,
      month_reset_at = (date_trunc('month', v_now at time zone 'UTC') + interval '1 month') at time zone 'UTC',
      updated_at = v_now
    where user_id = p_user_id;
  end if;

  update usage set
    images_this_month = images_this_month + p_images,
    vision_this_month = vision_this_month + p_vision,
    searches_this_month = searches_this_month + p_searches,
    documents_this_month = documents_this_month + p_documents,
    voice_input_minutes_this_month = voice_input_minutes_this_month + p_voice_input_minutes,
    voice_output_chars_this_month = voice_output_chars_this_month + p_voice_output_chars,
    code_executions_this_month = code_executions_this_month + p_code_executions,
    updated_at = v_now
  where user_id = p_user_id;
end;
$$ language plpgsql;
