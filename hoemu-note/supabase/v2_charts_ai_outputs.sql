-- 회무노트 v2 추가 테이블 (그래프마스터 · AI 가공 결과 보관)
-- 순서: ① 테이블 → ② 권한(grant) → ③ RLS 켜기 → ④ 정책. 여러 번 실행해도 안전합니다.

-- ① 테이블
create table if not exists public.charts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '새 차트',
  document_id uuid references public.documents(id) on delete set null,
  pages text,
  data jsonb not null default '{}',
  spec jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists charts_user_updated on public.charts (user_id, updated_at desc);
drop trigger if exists charts_touch on public.charts;
create trigger charts_touch before update on public.charts
  for each row execute function public.touch_updated_at();

create table if not exists public.ai_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  kind text not null,
  ref text not null default '',
  content jsonb not null default '{}',
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, document_id, kind, ref)
);

-- ② 권한: 로그인 사용자만(비로그인 anon 은 권한 없음)
grant select, insert, update, delete on public.charts to authenticated;
grant select, insert, update, delete on public.ai_outputs to authenticated;

-- ③ RLS 켜기
alter table public.charts enable row level security;
alter table public.ai_outputs enable row level security;

-- ④ 정책: 본인 행만
drop policy if exists own_rows on public.charts;
create policy own_rows on public.charts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_rows on public.ai_outputs;
create policy own_rows on public.ai_outputs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
