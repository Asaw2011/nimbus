-- Optional: the remote "minimum supported version" switch for Nimbus.
--
-- Nimbus reads this table on launch. Until the table exists the check FAILS
-- OPEN (404 -> app runs normally), so nothing breaks by not running this.
--
-- Run it in the Supabase SQL editor for project oovgzakdweswenhohgwh.
--
-- ⚠ This can only ever affect builds that ALREADY contain the check
--   (0.1.5 built 2026-08-25 and later). Copies downloaded before that have no
--   code to read it and cannot be reached by anything.

create table if not exists public.nimbus_app (
  id          int primary key default 1,
  min_version text not null default '0.0.0',
  message     text,
  -- keeps the table to a single row
  constraint nimbus_app_singleton check (id = 1)
);

insert into public.nimbus_app (id, min_version, message)
values (1, '0.0.0', null)
on conflict (id) do nothing;

alter table public.nimbus_app enable row level security;

-- The app reads with the public publishable key, so anon needs SELECT.
-- Read-only: no insert/update/delete policy is granted to anon.
drop policy if exists "nimbus_app readable by anyone" on public.nimbus_app;
create policy "nimbus_app readable by anyone"
  on public.nimbus_app for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- To force everyone below a version to update:
--     update public.nimbus_app
--        set min_version = '0.2.0',
--            message     = 'Nimbus 0.2.0 is required. Grab it at nimbusdebate.com.'
--      where id = 1;
--
-- To switch the block back off:
--     update public.nimbus_app set min_version = '0.0.0', message = null where id = 1;
--
-- ⚠ A user who is OFFLINE is never blocked -- that is deliberate. Blocking on a
--   failed network call would lock people out of their own local flow files at a
--   tournament, which is worse than an old build staying alive.
-- ---------------------------------------------------------------------------
