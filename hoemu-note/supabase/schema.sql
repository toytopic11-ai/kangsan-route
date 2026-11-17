-- ═══════════════════════════════════════════════════════════════════
-- 회무노트 DB 스키마 (Supabase SQL Editor 에 통째로 붙여넣고 Run)
--  · 여러 번 실행해도 안전(if not exists / or replace)
--  · Lovable 크레딧을 쓰지 않고 DB를 한 번에 만드는 용도
--  · 모든 테이블: 본인(auth.uid())만 접근 (RLS)
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

-- ───────── 공통: updated_at 자동 갱신 ─────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ───────── 1. 분류(대·중·소) ─────────
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id uuid references public.categories(id) on delete cascade,
  level smallint not null check (level between 1 and 3),
  name text not null,
  org text not null default '공통' check (org in ('중앙회','경북도회','포항시회','공통')),
  color text,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists categories_parent_idx on public.categories (user_id, parent_id, sort_order);

-- ───────── 2. 문서 ─────────
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  org text not null default '공통' check (org in ('중앙회','경북도회','포항시회','공통')),
  title text not null,
  file_path text not null,                         -- Storage 'docs' 버킷 경로: {user_id}/{uuid}.pdf
  file_size bigint,
  page_count int,
  doc_date date,
  tags text[] not null default '{}',
  visibility text not null default '내부' check (visibility in ('내부','공개가능')),
  is_pinned boolean not null default false,
  sort_order double precision not null default 0,
  text_extracted boolean not null default false,
  last_opened_at timestamptz,
  last_page int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_cat_idx on public.documents (user_id, category_id, is_pinned desc, sort_order);
drop trigger if exists documents_touch on public.documents;
create trigger documents_touch before update on public.documents for each row execute function public.touch_updated_at();

-- ───────── 3. 페이지 본문(검색·AI용) ─────────
create table if not exists public.doc_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page_no int not null,
  content text not null default '',
  ocr boolean not null default false,
  unique (document_id, page_no)
);
create index if not exists doc_pages_trgm on public.doc_pages using gin (content gin_trgm_ops);

-- ───────── 4. 필기(페이지당 1행, 획 배열 JSON) ─────────
create table if not exists public.page_ink (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page_no int not null,
  data jsonb not null default '{"v":1,"strokes":[]}',
  -- 형광펜 아래 글자(색상별 모아보기·검색용): [{color, text}]
  highlights jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  unique (document_id, page_no)
);
drop trigger if exists page_ink_touch on public.page_ink;
create trigger page_ink_touch before update on public.page_ink for each row execute function public.touch_updated_at();

-- ───────── 5. 메모(포스트잇) ─────────
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page_no int not null,
  x real not null, y real not null,                 -- 페이지 가로폭 1000 기준 좌표
  color text not null default '#fef08a',
  content text not null default '',
  collapsed boolean not null default false,
  created_at timestamptz not null default now()
);

-- ───────── 6. 형광펜 범례 ─────────
create table if not exists public.highlight_legend (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  color text not null,
  meaning text not null,
  sort_order double precision not null default 0,
  unique (user_id, color)
);

-- ───────── 7. 스크랩북 ─────────
create table if not exists public.scraps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  page_no int,
  image_path text,
  text text not null default '',
  note text not null default '',
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);

-- ───────── 8. 회의·안건 ─────────
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  org text not null check (org in ('중앙회','경북도회','포항시회','공통')),
  title text not null,
  meeting_date timestamptz,
  place text,
  status text not null default '예정' check (status in ('예정','진행','종료')),
  memo text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.meeting_agendas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  agenda_no text,
  title text not null,
  document_id uuid references public.documents(id) on delete set null,
  page_no int,
  my_position text check (my_position in ('찬성','반대','질의','보류')),
  note text not null default '',
  spoke boolean not null default false,
  result text,
  sort_order double precision not null default 0
);

-- ───────── 9. 의결사항 ─────────
create table if not exists public.resolutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  org text not null check (org in ('중앙회','경북도회','포항시회','공통')),
  meeting_id uuid references public.meetings(id) on delete set null,
  meeting_name text,
  meeting_date date,
  agenda_no text,
  title text not null,
  decision text check (decision in ('원안가결','수정가결','부결','보류')),
  status text not null default '예정' check (status in ('예정','진행','완료','미이행')),
  due_date date,
  follow_up_note text not null default '',
  document_id uuid references public.documents(id) on delete set null,
  page_no int,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);

-- ───────── 10. 예산 ─────────
create table if not exists public.budget_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  org text not null check (org in ('중앙회','경북도회','포항시회')),
  fiscal_year int not null,
  kind text not null check (kind in ('예산','결산')),
  section text not null check (section in ('수입','지출')),
  category_l1 text, category_l2 text,
  item_name text not null,
  amount bigint not null default 0,                 -- 원 단위
  document_id uuid references public.documents(id) on delete set null,
  page_no int,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists budget_idx on public.budget_items (user_id, org, item_name, fiscal_year);

-- ───────── 11. 규정·개정 이력 ─────────
create table if not exists public.regulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  org text not null check (org in ('중앙회','경북도회','포항시회','공통')),
  name text not null,
  needs_review boolean not null default false,
  sort_order double precision not null default 0
);
create table if not exists public.regulation_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  regulation_id uuid not null references public.regulations(id) on delete cascade,
  version_label text not null,
  effective_date date,
  revised_at_meeting text,
  document_id uuid references public.documents(id) on delete set null,
  note text not null default ''
);
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  version_id uuid not null references public.regulation_versions(id) on delete cascade,
  article_no text not null,
  title text,
  content text not null,
  page_no int
);
create index if not exists articles_idx on public.articles (version_id, article_no);

-- ───────── 12. 작성기(발언문·질의서) ─────────
create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  org text check (org in ('중앙회','경북도회','포항시회','공통')),
  meeting_id uuid references public.meetings(id) on delete set null,
  type text not null check (type in ('발언문','질의서','건의서','보고서','리허설')),
  title text not null,
  content text not null default '',
  sources jsonb not null default '[]',
  status text not null default '초안' check (status in ('초안','완성')),
  updated_at timestamptz not null default now()
);
drop trigger if exists drafts_touch on public.drafts;
create trigger drafts_touch before update on public.drafts for each row execute function public.touch_updated_at();

-- ───────── 13. AI 질문 템플릿 ─────────
create table if not exists public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  icon text,
  prompt text not null,
  output_format text not null default '개조식' check (output_format in ('문장','표','개조식')),
  sort_order double precision not null default 0,
  use_count int not null default 0
);

-- ───────── 14. 회원 건의사항 ─────────
create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  org text not null default '포항시회' check (org in ('중앙회','경북도회','포항시회','공통')),
  received_date date not null default current_date,
  channel text check (channel in ('대면','전화','밴드','카톡','기타')),
  member_label text,                                 -- 실명 대신 별칭(개인정보 최소화)
  category text check (category in ('제도개선','교육','공제','지도단속','회비','친목','기타')),
  content text not null,
  my_opinion text not null default '',
  status text not null default '접수' check (status in ('접수','검토','안건상정','처리완료','회신완료','보류')),
  meeting_id uuid references public.meetings(id) on delete set null,
  result text,
  replied_at date,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);

-- ───────── 15. 활동 기록부 ─────────
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  org text check (org in ('중앙회','경북도회','포항시회','공통')),
  activity_date date not null default current_date,
  type text not null check (type in ('회의참석','발언','질의','건의전달','교육이수','행사참석','기타')),
  title text not null,
  detail text not null default '',
  outcome text check (outcome in ('반영','부분반영','미반영','대기')),
  ref_type text, ref_id uuid,
  created_at timestamptz not null default now()
);
-- 자동 기록 중복 방지
create unique index if not exists activities_ref_uq on public.activities (user_id, ref_type, ref_id, type) where ref_id is not null;

-- ───────── 16. 공개용 콘텐츠 ─────────
create table if not exists public.contents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  format text not null check (format in ('블로그','쇼츠자막','밴드공지','페이스북')),
  title text,
  body text not null,
  source_document_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ───────── 17. 법령 감시 ─────────
create table if not exists public.law_watch (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  law_name text not null,
  last_promulgation_date text,
  last_effective_date text,
  checked_at timestamptz,
  sort_order double precision not null default 0,
  unique (user_id, law_name)
);
create table if not exists public.law_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  law_name text not null,
  promulgation_date text,
  effective_date text,
  summary text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ───────── 18. 주간 리포트 · 리허설 ─────────
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,
  content text not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);
create table if not exists public.rehearsals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete set null,
  role text not null check (role in ('질의자','답변자')),
  question text not null,
  answer text not null default '',
  sources jsonb not null default '[]',
  practiced boolean not null default false,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);

-- ───────── 19. 앱 설정 · AI 사용량(비용 상한 관리) ─────────
create table if not exists public.app_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  ai_model text not null default 'claude-haiku-5-5',
  monthly_ai_limit_usd numeric(8,2) not null default 3.00,   -- 월 AI 비용 상한(약 4천원)
  last_law_check timestamptz,
  last_weekly_report date,
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_month on public.ai_usage (user_id, created_at);

-- ═══════════════ RLS: 모든 테이블 본인만 ═══════════════
do $$
declare t text;
begin
  foreach t in array array['categories','documents','doc_pages','page_ink','notes','highlight_legend','scraps',
    'meetings','meeting_agendas','resolutions','budget_items','regulations','regulation_versions','articles',
    'drafts','prompt_templates','suggestions','activities','contents','law_watch','law_changes',
    'weekly_reports','rehearsals','app_settings','ai_usage']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ═══════════════ 활동 기록 자동화 트리거 ═══════════════
create or replace function public.log_activity(p_user uuid, p_org text, p_type text, p_title text, p_ref_type text, p_ref_id uuid)
returns void language sql as $$
  insert into public.activities (user_id, org, type, title, ref_type, ref_id)
  values (p_user, p_org, p_type, p_title, p_ref_type, p_ref_id)
  on conflict (user_id, ref_type, ref_id, type) where ref_id is not null do nothing;
$$;

create or replace function public.trg_meeting_activity() returns trigger language plpgsql as $$
begin
  if new.status = '종료' and (tg_op = 'INSERT' or old.status is distinct from '종료') then
    perform public.log_activity(new.user_id, new.org, '회의참석', new.title, 'meeting', new.id);
  end if;
  return new;
end $$;
drop trigger if exists meeting_activity on public.meetings;
create trigger meeting_activity after insert or update of status on public.meetings for each row execute function public.trg_meeting_activity();

create or replace function public.trg_agenda_activity() returns trigger language plpgsql as $$
declare m record;
begin
  if new.spoke and (tg_op = 'INSERT' or not old.spoke) then
    select org, title into m from public.meetings where id = new.meeting_id;
    perform public.log_activity(new.user_id, m.org, '발언', coalesce(m.title,'') || ' - ' || new.title, 'agenda', new.id);
  end if;
  return new;
end $$;
drop trigger if exists agenda_activity on public.meeting_agendas;
create trigger agenda_activity after insert or update of spoke on public.meeting_agendas for each row execute function public.trg_agenda_activity();

create or replace function public.trg_draft_activity() returns trigger language plpgsql as $$
begin
  if new.type = '질의서' and new.status = '완성' and (tg_op = 'INSERT' or old.status is distinct from '완성') then
    perform public.log_activity(new.user_id, new.org, '질의', new.title, 'draft', new.id);
  end if;
  return new;
end $$;
drop trigger if exists draft_activity on public.drafts;
create trigger draft_activity after insert or update of status on public.drafts for each row execute function public.trg_draft_activity();

create or replace function public.trg_suggestion_activity() returns trigger language plpgsql as $$
begin
  if new.status = '안건상정' and (tg_op = 'INSERT' or old.status is distinct from '안건상정') then
    perform public.log_activity(new.user_id, new.org, '건의전달', left(new.content, 60), 'suggestion', new.id);
  end if;
  return new;
end $$;
drop trigger if exists suggestion_activity on public.suggestions;
create trigger suggestion_activity after insert or update of status on public.suggestions for each row execute function public.trg_suggestion_activity();

-- ═══════════════ 검색 함수 ═══════════════
-- 통합 검색: 본문·형광펜·메모·스크랩·의결·회의·초안·건의
create or replace function public.search_all(q text, p_org text default null, p_limit int default 60)
returns table (kind text, ref_id uuid, title text, snippet text, document_id uuid, page_no int, org text, at timestamptz)
language sql stable security invoker as $$
  with k as (select '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat)
  select * from (
    select '본문'::text, p.id, d.title, substr(p.content, greatest(1, strpos(lower(p.content), lower(trim(q))) - 40), 140), d.id, p.page_no, d.org, d.updated_at
      from public.doc_pages p join public.documents d on d.id = p.document_id, k
      where p.content ilike k.pat and (p_org is null or d.org = p_org)
    union all
    select '형광펜', i.id, d.title, h->>'text', d.id, i.page_no, d.org, i.updated_at
      from public.page_ink i join public.documents d on d.id = i.document_id
      cross join lateral jsonb_array_elements(i.highlights) h, k
      where h->>'text' ilike k.pat and (p_org is null or d.org = p_org)
    union all
    select '메모', n.id, d.title, n.content, d.id, n.page_no, d.org, n.created_at
      from public.notes n join public.documents d on d.id = n.document_id, k
      where n.content ilike k.pat and (p_org is null or d.org = p_org)
    union all
    select '스크랩', s.id, coalesce(d.title,'스크랩'), left(s.text || ' ' || s.note, 140), s.document_id, s.page_no, d.org, s.created_at
      from public.scraps s left join public.documents d on d.id = s.document_id, k
      where (s.text ilike k.pat or s.note ilike k.pat) and (p_org is null or d.org = p_org)
    union all
    select '의결', r.id, r.title, left(r.follow_up_note, 140), r.document_id, r.page_no, r.org, r.created_at
      from public.resolutions r, k
      where (r.title ilike k.pat or r.follow_up_note ilike k.pat) and (p_org is null or r.org = p_org)
    union all
    select '회의', m.id, m.title, left(m.memo, 140), null::uuid, null::int, m.org, m.created_at
      from public.meetings m, k
      where (m.title ilike k.pat or m.memo ilike k.pat) and (p_org is null or m.org = p_org)
    union all
    select '초안', dr.id, dr.title, left(dr.content, 140), null::uuid, null::int, dr.org, dr.updated_at
      from public.drafts dr, k
      where (dr.title ilike k.pat or dr.content ilike k.pat) and (p_org is null or dr.org = p_org)
    union all
    select '건의', sg.id, left(sg.content, 40), left(sg.content, 140), null::uuid, null::int, sg.org, sg.created_at
      from public.suggestions sg, k
      where (sg.content ilike k.pat or sg.my_opinion ilike k.pat) and (p_org is null or sg.org = p_org)
  ) x
  order by 8 desc nulls last
  limit p_limit;
$$;

-- AI 근거 페이지 찾기: 키워드 여러 개 중 많이 맞는 페이지 순
create or replace function public.match_pages(keywords text[], p_org text default null, p_category_ids uuid[] default null, p_limit int default 8)
returns table (document_id uuid, title text, page_no int, content text, score int)
language sql stable security invoker as $$
  select d.id, d.title, p.page_no, p.content,
         (select count(*)::int from unnest(keywords) kw where length(kw) >= 2 and p.content ilike '%' || kw || '%') as score
  from public.doc_pages p join public.documents d on d.id = p.document_id
  where (p_org is null or d.org = p_org)
    and (p_category_ids is null or d.category_id = any(p_category_ids))
    and exists (select 1 from unnest(keywords) kw where length(kw) >= 2 and p.content ilike '%' || kw || '%')
  order by score desc, d.updated_at desc
  limit p_limit;
$$;

-- 이번 달 AI 사용액
create or replace function public.ai_cost_this_month() returns numeric
language sql stable security invoker as $$
  select coalesce(sum(cost_usd), 0) from public.ai_usage
  where user_id = auth.uid() and created_at >= date_trunc('month', now());
$$;

-- ═══════════════ 첫 로그인 기본 데이터 ═══════════════
-- 앱 시작 시 supabase.rpc('init_user_data') 1회 호출(이미 있으면 아무것도 안 함)
create or replace function public.init_user_data() returns void
language plpgsql security invoker as $$
declare
  uid uuid := auth.uid();
  o text; m text; l1 uuid; l2 uuid; i int; j int;
  tree jsonb := '{
    "중앙회":   [["정관·규정",["정관","선거관리규정","회비규정"]],["정기총회·대의원총회",[]],["예산·결산",[]],["공문·지침",[]],["정책·제도",["중개보수","전자계약","법령개정"]]],
    "경북도회": [["운영위원회",[]],["대의원회",[]],["예산·결산",[]],["규정·지침",["도회 운영규정","지도단속"]],["교육·행사",["연수교육","체육대회"]]],
    "포항시회": [["정기총회",[]],["임원회의",[]],["예산·회계",[]],["지역현안",["북구","남구","개발사업"]],["회원·친목",[]]],
    "공통":     [["법령",["공인중개사법","시행령·시행규칙"]],["개인 메모",["발언문 초안","아이디어"]]]
  }';
  colors jsonb := '{"중앙회":"#1e3a8a","경북도회":"#15803d","포항시회":"#ea580c","공통":"#64748b"}';
  orgs text[] := array['중앙회','경북도회','포항시회','공통'];
begin
  if uid is null then raise exception '로그인이 필요합니다'; end if;
  insert into public.app_settings (user_id) values (uid) on conflict do nothing;

  if not exists (select 1 from public.categories where user_id = uid) then
    for i in 1..array_length(orgs, 1) loop
      o := orgs[i];
      insert into public.categories (user_id, parent_id, level, name, org, color, sort_order)
        values (uid, null, 1, o, o, colors->>o, i) returning id into l1;
      for j in 0..jsonb_array_length(tree->o) - 1 loop
        m := tree->o->j->>0;
        insert into public.categories (user_id, parent_id, level, name, org, sort_order)
          values (uid, l1, 2, m, o, j + 1) returning id into l2;
        insert into public.categories (user_id, parent_id, level, name, org, sort_order)
          select uid, l2, 3, s.v, o, s.n from jsonb_array_elements_text(tree->o->j->1) with ordinality s(v, n);
      end loop;
    end loop;
  end if;

  if not exists (select 1 from public.highlight_legend where user_id = uid) then
    insert into public.highlight_legend (user_id, color, meaning, sort_order) values
      (uid,'#fde047','핵심',1),(uid,'#f9a8d4','질의할 것',2),(uid,'#86efac','찬성 근거',3),
      (uid,'#7dd3fc','확인 필요',4),(uid,'#fdba74','반대·우려',5);
  end if;

  if not exists (select 1 from public.prompt_templates where user_id = uid) then
    insert into public.prompt_templates (user_id, name, icon, prompt, output_format, sort_order) values
      (uid,'안건 3줄 요약','📋','{회의}의 안건별 핵심을 3줄씩 요약','개조식',1),
      (uid,'예산 증감 TOP5','📊','{기관} {연도} 예산의 전년 대비 증감 상위 5개 항목과 사유','표',2),
      (uid,'질의 포인트','❓','{문서}에서 대의원이 질의할 만한 쟁점 5가지와 근거 조항','개조식',3),
      (uid,'신구조문 요약','📜','{문서}의 개정 조문을 현행/개정/의미 3열 표로','표',4),
      (uid,'내 표시 요약','🖍','{색상} 형광펜 표시 내용을 주제별로 묶어 요약','개조식',5),
      (uid,'이행 점검','✅','{기관}의 미이행 의결사항 목록과 점검 질의 문안','개조식',6);
  end if;

  if not exists (select 1 from public.law_watch where user_id = uid) then
    insert into public.law_watch (user_id, law_name, sort_order)
      select uid, v, n from unnest(array['공인중개사법','공인중개사법 시행령','공인중개사법 시행규칙',
        '부동산 거래신고 등에 관한 법률','주택임대차보호법','상가건물 임대차보호법','부동산등기법']) with ordinality u(v, n);
  end if;
end $$;

-- ═══════════════ Storage: 비공개 버킷 + 본인 폴더만 ═══════════════
insert into storage.buckets (id, name, public) values ('docs', 'docs', false) on conflict (id) do nothing;
drop policy if exists docs_own_select on storage.objects;
drop policy if exists docs_own_insert on storage.objects;
drop policy if exists docs_own_update on storage.objects;
drop policy if exists docs_own_delete on storage.objects;
create policy docs_own_select on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy docs_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy docs_own_update on storage.objects for update to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy docs_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
