-- Stash accounts with encrypted sync (prototype). See ACCOUNTS.md.
--
-- The server only ever holds data the user's device has already encrypted. It never sees the wallet
-- key: the key is generated on the device, kept there, and uploaded only after being locked with the
-- user's recovery code. Row-level security means every signed-in user can touch only their own rows.

-- The wallet key, locked with the user's recovery code (AES-GCM, key derived with HKDF from the code).
create table public.key_wraps (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  wrapped_key text not null, -- base64 AES-GCM ciphertext of the 32-byte wallet key
  iv text not null,          -- base64 12-byte nonce
  salt text not null,        -- base64 16-byte HKDF salt
  version int not null default 1,
  updated_at timestamptz not null default now()
);

-- One encrypted record per synced wallet entry. item_id names the entry (e.g. one localStorage key).
create table public.wallet_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id text not null check (char_length(item_id) between 1 and 100),
  ciphertext text not null check (char_length(ciphertext) <= 2000000),
  iv text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.key_wraps enable row level security;
alter table public.wallet_items enable row level security;

create policy "own key wrap" on public.key_wraps
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own wallet items" on public.wallet_items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Nobody signed out can read or write anything.
revoke all on public.key_wraps from anon;
revoke all on public.wallet_items from anon;
grant select, insert, update, delete on public.key_wraps to authenticated;
grant select, insert, update, delete on public.wallet_items to authenticated;

-- "Delete my account": removes the signed-in user, and with them (cascade) every stored row.
-- security definer so it can delete from auth.users, but it only ever deletes the caller.
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
