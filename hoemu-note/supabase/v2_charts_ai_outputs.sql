-- 회무노트 v2 추가 테이블 (그래프마스터 · AI 가공 결과 보관)
-- Supabase → SQL Editor → New query 에 전체를 붙여넣고 Run. 여러 번 실행해도 안전합니다.

-- ① 그래프마스터: 저장한 차트
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
create trigger charts_touch before update on public.charts for each row execute function public.touch_updated_at();

-- ② AI 가공 결과(요약 카드·질의 포인트·비교표 등): 자료별·종류별 1건 보관 → 다시 볼 때 비용 0
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

-- 본인 행만 접근
do $$
declare t text;
begin
  foreach t in array array['charts','ai_outputs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
