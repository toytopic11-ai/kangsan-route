// ═══════════════════════════════════════════════════════════════════
// 회무노트 AI 서버 함수 (Supabase Edge Function, 하나로 모든 AI 기능 처리)
//  배포: Supabase 대시보드 → Edge Functions → Deploy new function → 이름 hoemu-ai → 이 파일 붙여넣기
//  비밀값(Edge Functions → Secrets): ANTHROPIC_API_KEY, (선택) LAW_API_OC
//  앱 호출: supabase.functions.invoke('hoemu-ai', { body: { action: 'ask', ... } })
//
//  비용 최소화
//   · 기본 모델 claude-haiku-5-5 (입력 $0.10 / 출력 $0.50 per 100만 토큰), effort 'low'
//   · 근거 페이지 최대 8개, 페이지당 2,500자로 제한
//   · 매 호출 사용량 기록 → 월 상한(app_settings.monthly_ai_limit_usd, 기본 $3) 넘으면 호출 차단
// ═══════════════════════════════════════════════════════════════════
import Anthropic from "npm:@anthropic-ai/sdk@1.9.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const PRICE: Record<string, [number, number]> = {
  // [입력, 출력] 달러 / 100만 토큰
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
};
const ALLOWED_MODELS = Object.keys(PRICE);
const MAX_PAGES = 8;
const MAX_PAGE_CHARS = 2500;

const BASE_RULES = `당신은 한국공인중개사협회 대의원(중앙회 대의원, 경북도회 대의원·운영위원, 포항시회 대의원)의 회무 비서입니다.
규칙:
- 반드시 제공된 [자료]에만 근거해 답한다. 자료에 없으면 "자료에서 확인되지 않음"이라고 쓴다.
- 근거를 쓴 문장 끝에 [문서명 p.N] 형식으로 출처를 붙인다.
- 한국어, 격식 있는 문체, 개조식 위주로 간결하게. 숫자·조항 번호는 원문 그대로.`;

const TASKS: Record<string, string> = {
  summary: "자료의 핵심을 개조식으로 요약하라.",
  compare: "두 자료의 차이점을 '항목 | 자료A | 자료B | 비고' 마크다운 표로 정리하라.",
  draft_speech: `대의원 발언문을 작성하라. 구조: 인사·서두 → 본론(근거 조항·수치 인용) → 요청사항 → 맺음. 지정된 분량(분)과 어조를 따른다.`,
  draft_inquiry: `질의서를 작성하라. '번호 | 질의 내용 | 근거 | 요청 답변 기한' 마크다운 표와 짧은 서문.`,
  draft_proposal: "건의서를 작성하라. 제목, 건의 배경, 건의 내용, 기대 효과, 근거.",
  activity_report: "대의원 활동보고서를 작성하라. 개요 / 주요 활동 / 질의·건의 성과 / 향후 계획.",
  reply_member: "회원에게 보낼 정중한 회신 문자(300자 이내)를 작성하라.",
  content_blog: `네이버 블로그 글: 제목 3안(검색 키워드 포함), 도입부, 소제목 3~5개, 본문 1,500~2,000자, 마무리, 태그 10개.
공인중개사 실무자 관점, 정확한 수치·시행일, 출처 기관 명시. 협회 내부 논의·의결 과정은 절대 언급하지 않는다.`,
  content_shorts: `쇼츠·릴스 자막 대본(내레이션 없음, 화면 고정 텍스트 오버레이). 마크다운 표:
'장면 | 표시시간(3~5초) | 큰 자막(15자 이내) | 보조 자막(25자 이내)'. 총 30~45초, 첫 장면은 강한 후킹 문구. 협회 내부 논의는 언급 금지.`,
  content_band: "네이버 밴드 회원 공지: 핵심 3줄 + 상세 안내. 협회 내부 논의는 언급 금지.",
  content_facebook: "페이스북 글 300자 내외 + 해시태그 5개. 협회 내부 논의는 언급 금지.",
  content_notice: `회원용 쉬운 안내문(존댓말, 600자 내외): 제목 / 3줄 요약 / 소제목 '무엇이 바뀌나요' '언제부터' '회원이 할 일' / 문의처 자리.
어려운 법률·회계 용어는 괄호로 쉽게 풀이. 협회 내부 논의·의결 과정은 언급 금지.`,
  explain_article: `정관·규정 조문을 해설하라. 마크다운 형식:
## 한 줄 요약
## 쉬운 풀이 (일반 회원 눈높이 3~5줄)
## 핵심 요건 (누가·무엇을·언제·어떻게, 개조식)
## 관련 조문 (함께 제공된 다른 조문과의 관계, 없으면 생략)
## 개정으로 달라진 점 (이전 조문이 제공된 경우만)
## 회의에서 짚을 점 (대의원·운영위원 입장 2~3개)
제공된 조문 밖의 내용은 추측하지 말고 "규정에 없음"이라고 쓴다.`,
  consistency: `두 자료(A·B) 사이에서 서로 어긋나거나 모순되는 부분을 찾는다:
숫자·금액 불일치, 규정과 다른 집행·절차, 날짜·명칭·기준 불일치, 한쪽에만 있는 의무·조건.
'구분 | A 내용 [문서 p.N] | B 내용 [문서 p.N] | 문제점 | 확인할 것' 마크다운 표로 쓰고, 표 아래 핵심 3줄.
원문 근거가 있는 것만 쓰고, 어긋남이 없으면 "확인된 불일치 없음"과 점검한 항목을 개조식으로 쓴다.`,
};

// 한국어 조사 떼기(검색 키워드 추출용, 외부 형태소 분석기 없이)
const JOSA =
  /(으로서|으로써|에서는|에게서|이라는|까지는|부터는|으로|에서|에게|까지|부터|이나|라고|하고|와는|과는|이란|란|은|는|이|가|을|를|에|의|와|과|도|만|로|나)$/;
const STOP = new Set([
  "무엇",
  "어떻게",
  "알려줘",
  "알려",
  "주세요",
  "해줘",
  "정리",
  "관련",
  "내용",
  "있는",
  "대한",
  "그리고",
  "어떤",
  "몇",
  "언제",
]);
function keywords(q: string): string[] {
  const out = new Set<string>();
  for (const raw of q.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)) {
    let w = raw.trim();
    if (w.length > 2) w = w.replace(JOSA, "");
    if (w.length >= 2 && !STOP.has(w)) out.add(w);
  }
  return [...out].slice(0, 8);
}

type Page = { document_id: string; title: string; page_no: number; content: string };
const pagesBlock = (pages: Page[]) =>
  pages
    .map(
      (p) =>
        `<자료 문서="${p.title}" 페이지="${p.page_no}">\n${p.content.slice(0, MAX_PAGE_CHARS)}\n</자료>`,
    )
    .join("\n\n");

class LimitError extends Error {}

/** 공개 키: 예전 방식(SUPABASE_ANON_KEY) 또는 새 방식(SUPABASE_PUBLISHABLE_KEYS) 모두 지원 */
function publicKey(): string {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try {
      const v = JSON.parse(raw) as Record<string, string> | string[];
      const first = Array.isArray(v) ? v[0] : (v["default"] ?? Object.values(v)[0]);
      if (first) return first;
    } catch {
      return raw;
    }
  }
  throw new Error("Supabase 공개 키를 찾을 수 없습니다");
}

async function callClaude(
  sb: SupabaseClient,
  userId: string,
  action: string,
  model: string,
  system: string,
  content: Anthropic.MessageParam["content"],
  maxTokens = 2000,
  effort: "low" | "medium" | "high" = "low",
) {
  // 월 상한 확인
  const [{ data: spent }, { data: setting }] = await Promise.all([
    sb.rpc("ai_cost_this_month"),
    sb.from("app_settings").select("monthly_ai_limit_usd").maybeSingle(),
  ]);
  const limit = Number(setting?.monthly_ai_limit_usd ?? 3);
  if (Number(spent ?? 0) >= limit)
    throw new LimitError(
      `이번 달 AI 사용 상한($${limit})에 도달했습니다. 설정에서 상한을 조정하세요.`,
    );

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort },
  });

  const [pi, po] = PRICE[model] ?? PRICE["claude-haiku-5-5"];
  const cost = (res.usage.input_tokens * pi + res.usage.output_tokens * po) / 1_000_000;
  await sb.from("ai_usage").insert({
    user_id: userId,
    action,
    model,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
    cost_usd: cost,
  });

  if (res.stop_reason === "refusal")
    return { text: "요청을 처리할 수 없습니다. 질문을 바꿔 다시 시도해 주세요.", cost };
  const text = res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
  return {
    text: res.stop_reason === "max_tokens" ? text + "\n\n(분량 제한으로 일부 생략됨)" : text,
    cost,
  };
}

/** 응답 안의 JSON 배열/객체만 안전하게 추출 */
function parseJson<T>(text: string, fallback: T): T {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (m ? m[1] : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) return fallback;
  try {
    return JSON.parse(body.slice(start));
  } catch {
    const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      return fallback;
    }
  }
}

async function findPages(
  sb: SupabaseClient,
  q: string,
  org?: string | null,
  categoryIds?: string[] | null,
): Promise<Page[]> {
  const kws = keywords(q);
  if (!kws.length) return [];
  const { data, error } = await sb.rpc("match_pages", {
    keywords: kws,
    p_org: org ?? null,
    p_category_ids: categoryIds?.length ? categoryIds : null,
    p_limit: MAX_PAGES,
  });
  if (error) throw error;
  return (data ?? []) as Page[];
}

// ───────── 질문 답변용 자료 모으기(선택 범위 우선, 넉넉하게) ─────────
const ASK_BUDGET = 60000; // AI 에게 보여 줄 본문 글자 수 상한(약 4만 토큰)
const ASK_PAGE_CHARS = 6000;
// 질문 끝말(…인가요, …했나, …해줘) 떼기
const ENDINGS =
  /(인가요|입니까|습니까|었나요|했나요|나요|가요|는지|은지|인지|었나|했나|했니|할까|이야|예요|이에요|에요|하나|해요|해줘|줘|야|요|니|냐|지)$/;
const STOP2 = new Set([
  ...STOP,
  "뭐",
  "뭐야",
  "무엇인가",
  "어디",
  "누구",
  "왜",
  "얼마",
  "얼마나",
  "있나",
  "있어",
  "없나",
  "설명",
  "대해",
  "대해서",
  "경우",
  "이번",
  "지금",
  "우리",
  "알려주세요",
  "해주세요",
  "궁금",
]);

/** 검색어와 가중치: 원래 단어(3) + 긴 한글 합성어의 2글자 조각(1) */
function askKeywords(q: string): [string, number][] {
  const out = new Map<string, number>();
  const add = (k: string, w: number) => {
    if (k.length >= 2 && !STOP2.has(k)) out.set(k, Math.max(out.get(k) ?? 0, w));
  };
  for (const raw of q.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)) {
    let w = raw.trim();
    for (let i = 0; i < 2; i++) {
      if (w.length > 2) w = w.replace(ENDINGS, "");
      if (w.length > 2) w = w.replace(JOSA, "");
    }
    add(w, 3);
    if (/^[가-힣]{4,}$/.test(w)) for (let i = 0; i + 2 <= w.length; i++) add(w.slice(i, i + 2), 1);
  }
  return [...out.entries()].slice(0, 16);
}

function scorePage(p: Page, kws: [string, number][]) {
  let s = 0;
  for (const [k, w] of kws) {
    let n = 0;
    let i = p.content.indexOf(k);
    while (i >= 0 && n < 6) {
      n++;
      i = p.content.indexOf(k, i + k.length);
    }
    s += n * w;
    if (p.title.includes(k)) s += w * 2;
  }
  return s;
}

/** AI 로 검색어 넓히기(동의어·공식 용어) — 아주 적은 비용 */
async function expandKeywords(sb: SupabaseClient, userId: string, q: string) {
  try {
    const r = await callClaude(
      sb,
      userId,
      "ask_keywords",
      "claude-haiku-5-5",
      "질문의 답을 협회 자료(정관·규정·예산서·회의록·공문)에서 찾기 위한 검색어를 JSON 문자열 배열로만 출력한다. 8개 이내, 2~6글자 명사 위주, 동의어·공식 용어 포함(예: 회비 → 회비, 연회비, 입회비, 회비규정).",
      q,
      200,
    );
    return parseJson(r.text, [] as unknown[])
      .map(String)
      .filter((k) => k.length >= 2)
      .slice(0, 8);
  } catch {
    return [];
  }
}

type AskScope = {
  org?: string | null;
  categoryIds?: string[] | null;
  documentIds?: string[] | null;
};

async function gatherForAsk(sb: SupabaseClient, userId: string, q: string, scope: AskScope) {
  let kws = askKeywords(q);
  const scoped = !!(scope.documentIds?.length || scope.categoryIds?.length);
  let dq = sb
    .from("documents")
    .select("id, title")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (scope.documentIds?.length) dq = dq.in("id", scope.documentIds);
  else if (scope.categoryIds?.length) dq = dq.in("category_id", scope.categoryIds);
  else if (scope.org) dq = dq.eq("org", scope.org);
  const { data: docs } = await dq;
  const titleOf = new Map(
    ((docs ?? []) as { id: string; title: string }[]).map((d) => [d.id, d.title]),
  );
  if (!titleOf.size) return { pages: [] as Page[], read: 0, docs: 0, mode: "none" as const };

  let rows: Page[] = [];
  if (scoped && titleOf.size <= 40) {
    // 고른 범위가 좁으면 그 자료의 모든 쪽을 직접 살핌(단어가 달라도 놓치지 않음)
    const { data } = await sb
      .from("doc_pages")
      .select("document_id, page_no, content")
      .in("document_id", [...titleOf.keys()])
      .order("page_no")
      .limit(1500);
    rows = ((data ?? []) as Omit<Page, "title">[]).map((r) => ({
      ...r,
      title: titleOf.get(r.document_id) ?? "",
    }));
  } else {
    const search = async (words: string[]) => {
      const { data } = await sb.rpc("match_pages", {
        keywords: words.slice(0, 16),
        p_org: scope.org ?? null,
        p_category_ids: scope.categoryIds?.length ? scope.categoryIds : null,
        p_limit: 60,
      });
      return (data ?? []) as Page[];
    };
    rows = await search(kws.map(([k]) => k));
    if (rows.length < 5) {
      // 찾은 쪽이 적으면 AI 로 검색어를 넓혀 한 번 더
      const more = await expandKeywords(sb, userId, q);
      if (more.length) {
        kws = [...kws, ...more.map((k): [string, number] => [k, 2])];
        const seen = new Set(rows.map((r) => `${r.document_id}:${r.page_no}`));
        for (const r of await search(more))
          if (!seen.has(`${r.document_id}:${r.page_no}`)) rows.push(r);
      }
    }
  }
  rows = rows.filter((r) => r.content?.trim());
  const docCount = new Set(rows.map((r) => r.document_id)).size;
  const total = rows.reduce((n, r) => n + Math.min(r.content.length, ASK_PAGE_CHARS), 0);
  if (total <= ASK_BUDGET)
    return { pages: rows, read: rows.length, docs: docCount, mode: "all" as const };

  // 많으면: 관련도 순으로 고르고, 상위 쪽의 앞뒤 쪽도 함께(문맥 이어짐)
  const scored = rows.map((p) => ({ p, s: scorePage(p, kws) })).sort((a, b) => b.s - a.s);
  const key = (p: Page) => `${p.document_id}:${p.page_no}`;
  const byKey = new Map(rows.map((p) => [key(p), p]));
  const picked: Page[] = [];
  const used = new Set<string>();
  let budget = ASK_BUDGET;
  const take = (p: Page | undefined) => {
    if (!p || used.has(key(p))) return;
    const len = Math.min(p.content.length, ASK_PAGE_CHARS);
    if (len > budget) return;
    used.add(key(p));
    picked.push(p);
    budget -= len;
  };
  const top = scored[0]?.s ? scored.filter((x) => x.s > 0) : scored; // 하나도 안 맞으면 앞쪽부터
  top.forEach((x, i) => {
    take(x.p);
    if (i < 3) {
      take(byKey.get(`${x.p.document_id}:${x.p.page_no - 1}`));
      take(byKey.get(`${x.p.document_id}:${x.p.page_no + 1}`));
    }
  });
  return { pages: picked, read: rows.length, docs: docCount, mode: "ranked" as const };
}

const askBlock = (pages: Page[]) =>
  pages
    .map(
      (p) =>
        `<자료 문서="${p.title}" 페이지="${p.page_no}">\n${p.content.slice(0, ASK_PAGE_CHARS)}\n</자료>`,
    )
    .join("\n\n");

const ASK_RULES = `
답변 방법:
- 첫 줄에 질문에 대한 결론을 1~2문장으로 쓴다.
- 이어서 근거를 개조식으로 쓴다. 조항·숫자·문장을 구체적으로 인용하고 끝에 [문서명 p.N] 을 붙인다.
- 질문과 똑같은 표현이 없어도 뜻이 같은 내용(다른 용어·조항·표)을 최대한 찾아 답한다.
- 직접 규정이 없으면 "직접 규정은 없으나 관련 내용은 다음과 같음"으로 구분해 관련 내용을 정리한다.
- 여러 자료에 걸쳐 있으면 모두 모아 종합·비교한다. 계산이 필요하면 계산 과정을 보인다.
- 정말 자료에 전혀 없을 때만 "자료에서 확인되지 않음"이라고 쓰고, 어떤 자료를 올리면 답할 수 있는지 한 줄로 제안한다.`;

const sources = (pages: Page[]) =>
  pages.map((p) => ({ document_id: p.document_id, title: p.title, page_no: p.page_no }));

function mondayOf(d: Date) {
  // 한국 시간 기준 그 주 월요일(월요일 새벽에도 이번 주로 계산)
  const k = new Date(d.getTime() + 9 * 3600e3);
  const x = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, publicKey(), {
      global: { headers: { Authorization: auth } },
    });
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return json({ error: "로그인이 필요합니다" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const model = ALLOWED_MODELS.includes(body.model) ? body.model : "claude-haiku-5-5";

    switch (action) {
      // ① 질문하기: 근거 페이지 검색 → 답변 + 출처
      case "ask": {
        const q = String(body.question ?? "").slice(0, 2000);
        if (!q) return json({ error: "질문이 비어 있습니다" }, 400);
        const ids = (v: unknown) =>
          Array.isArray(v)
            ? v
                .map(String)
                .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
                .slice(0, 300)
            : [];
        const found = await gatherForAsk(sb, user.id, q, {
          org: body.org ?? null,
          categoryIds: ids(body.category_ids),
          documentIds: ids(body.document_ids),
        });
        const scope = {
          docs: found.docs,
          pages: found.read,
          used: found.pages.length,
          mode: found.mode,
        };
        if (!found.pages.length)
          return json({
            answer:
              "고른 범위에서 읽을 수 있는 자료를 찾지 못했습니다. 범위를 '전체 자료'로 바꾸거나, 스캔본이면 글자 인식을 먼저 해 주세요.",
            sources: [],
            scope,
          });
        // 이어 묻기: 앞 대화 3개까지
        const hist = Array.isArray(body.history)
          ? (body.history as { q?: string; a?: string }[])
              .slice(-3)
              .map(
                (h) =>
                  `Q: ${String(h.q ?? "").slice(0, 300)}\nA: ${String(h.a ?? "").slice(0, 1200)}`,
              )
              .join("\n\n")
          : "";
        const fmt = body.output_format ? `\n출력 형식: ${body.output_format}` : "";
        const r = await callClaude(
          sb,
          user.id,
          "ask",
          model,
          BASE_RULES + ASK_RULES + fmt,
          `[자료]\n${askBlock(found.pages)}\n\n${hist ? `[앞 대화]\n${hist}\n\n` : ""}[질문]\n${q}`,
          3000,
          "medium",
        );
        // 답변에 실제로 인용된 쪽을 출처로(없으면 관련도 높은 쪽 6개)
        const cited = found.pages.filter((p) => r.text.includes(`${p.title} p.${p.page_no}`));
        return json({
          answer: r.text,
          sources: sources(cited.length ? cited : found.pages.slice(0, 6)),
          scope,
          cost_usd: r.cost,
        });
      }

      // ② 작성·요약·콘텐츠 변환: 앱이 고른 재료(materials)로 생성
      case "generate": {
        const task = String(body.task ?? "");
        if (!TASKS[task]) return json({ error: `알 수 없는 작업: ${task}` }, 400);
        const materials = String(body.materials ?? "").slice(0, 30000);
        const options = body.options ? `\n[옵션]\n${JSON.stringify(body.options)}` : "";
        const r = await callClaude(
          sb,
          user.id,
          task,
          model,
          `${BASE_RULES}\n\n작업: ${TASKS[task]}`,
          `[자료]\n${materials}${options}`,
          4000,
        );
        return json({ text: r.text, cost_usd: r.cost });
      }

      // ③ 글자 인식(스캔본·사진) — 이미지 1장씩
      case "ocr": {
        const media = String(body.media_type ?? "image/jpeg");
        if (!/^image\/(jpeg|png|webp)$/.test(media))
          return json({ error: "jpeg/png/webp 이미지만 가능합니다" }, 400);
        const r = await callClaude(
          sb,
          user.id,
          "ocr",
          "claude-haiku-5-5",
          "이미지 속 한국어 문서의 텍스트를 원문 그대로 추출한다. 표는 마크다운 표로. 설명·요약을 덧붙이지 않는다.",
          [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: media as "image/jpeg",
                data: String(body.image_base64 ?? ""),
              },
            },
            { type: "text", text: "텍스트만 추출" },
          ],
          4000,
        );
        return json({ text: r.text, cost_usd: r.cost });
      }

      // ④ 예산표 추출 → JSON
      case "extract_budget": {
        const r = await callClaude(
          sb,
          user.id,
          "extract_budget",
          "claude-haiku-5-5",
          `예산서 텍스트에서 항목을 추출해 JSON 배열만 출력한다. 형식:
[{"section":"수입|지출","category_l1":"관","category_l2":"항","item_name":"목","amount":원단위정수}]
천원 단위 표는 1000을 곱해 원 단위로. 합계·소계 행은 제외.`,
          String(body.text ?? "").slice(0, 30000),
          8000,
        );
        return json({ items: parseJson(r.text, [] as unknown[]), cost_usd: r.cost });
      }

      // ④-2 그래프마스터: 자료 속 표 → 차트용 숫자 표(JSON)
      case "extract_table": {
        const focus = String(body.focus ?? "").slice(0, 300);
        const r = await callClaude(
          sb,
          user.id,
          "extract_table",
          "claude-haiku-5-5",
          `문서 텍스트에서 차트로 그릴 핵심 숫자 표 1개를 찾아 JSON 객체만 출력한다. 형식:
{"title":"표 제목","unit":"천원|원|명|건|% 등","series":["계열1","계열2"],"rows":[{"label":"항목","values":[숫자,숫자]}]}
규칙: 숫자는 쉼표 없는 숫자(음수·△는 음수). 빈 칸은 null. series 는 열 머리글(예: 2025년, 2026년).
행은 최대 20개, 같은 수준의 항목만(관·항이 섞이면 상위 수준 우선). 합계·소계 행은 제외.
단위는 표에 적힌 단위 그대로. 원문에 없는 숫자를 만들지 않는다.${
            focus
              ? `
사용자 요청: ${focus}`
              : ""
          }`,
          String(body.text ?? "").slice(0, 30000),
          4000,
        );
        const t = parseJson(r.text, null as null | Record<string, unknown>);
        if (!t || !Array.isArray(t.rows) || !t.rows.length)
          return json(
            { error: "표를 찾지 못했습니다. 쪽 범위를 바꾸거나 붙여넣기로 입력해 주세요." },
            422,
          );
        return json({ table: t, cost_usd: r.cost });
      }

      // ④-3 AI 자료 가공: 1쪽 요약 카드(brief) · 질의 포인트(questions) — 결과 보관, 다시 보면 비용 0
      case "analyze_doc": {
        const kind =
          body.kind === "questions" ? "questions" : body.kind === "todos" ? "todos" : "brief";
        const docId = String(body.document_id ?? "");
        if (!docId) return json({ error: "자료를 지정해 주세요." }, 400);
        if (!body.refresh) {
          const { data: hit } = await sb
            .from("ai_outputs")
            .select("content, created_at")
            .eq("document_id", docId)
            .eq("kind", kind)
            .eq("ref", "")
            .maybeSingle();
          if (hit)
            return json({
              result: hit.content,
              cached: true,
              created_at: hit.created_at,
              cost_usd: 0,
            });
        }
        const { data: d } = await sb
          .from("documents")
          .select("title")
          .eq("id", docId)
          .maybeSingle();
        if (!d) return json({ error: "자료를 찾지 못했습니다." }, 404);
        const { data: pg } = await sb
          .from("doc_pages")
          .select("page_no, content")
          .eq("document_id", docId)
          .order("page_no")
          .limit(300);
        let text = "";
        for (const p of (pg ?? []) as { page_no: number; content: string }[]) {
          if (!p.content?.trim()) continue;
          const chunk = `[p.${p.page_no}]\n${p.content.trim()}\n\n`;
          if (text.length + chunk.length > 45000) break;
          text += chunk;
        }
        if (!text)
          return json(
            { error: "이 자료에는 읽을 글자가 없습니다(스캔본이면 먼저 글자 인식을 해 주세요)." },
            422,
          );
        const spec =
          kind === "todos"
            ? `회의록·공문·자료에서 의결사항과 후속 조치(할 일)를 뽑는다. JSON 배열만 출력:
[{"title":"할 일 또는 의결 내용(한 문장)","decision":"원안가결|수정가결|부결|보류|빈 문자열","owner":"담당(있으면)","due_date":"YYYY-MM-DD 또는 null","page":쪽번호,"note":"근거 요약 1문장"}]
최대 15개. '다음 회의까지'처럼 날짜가 상대 표현이면 due_date 는 null 로 두고 note 에 적는다. 할 일이 없으면 [].`
            : kind === "brief"
            ? `자료의 '1쪽 요약 카드'를 만든다. JSON 객체만 출력:
{"one_line":"자료 전체를 한 문장으로","summary":["핵심1","핵심2","핵심3"],"numbers":[{"label":"항목","value":"숫자와 단위 그대로","page":쪽번호}],"issues":[{"title":"쟁점","detail":"대의원이 주목할 이유 1~2문장","page":쪽번호}],"keywords":["키워드"]}
numbers 최대 6개(금액·인원·비율 등 핵심 숫자), issues 최대 4개, keywords 최대 6개. 쪽번호는 [p.N] 표시 기준 숫자.`
            : `대의원 입장에서 이 자료로 회의 때 물어볼 '질의 포인트' 10개를 뽑는다. JSON 배열만 출력:
[{"question":"집행부에 할 질의 문장(존댓말, 구체적으로)","why":"근거·이유 1문장","page":쪽번호,"priority":"상|중|하"}]
예산 증감이 큰 항목, 근거가 빠진 내용, 규정과 어긋날 수 있는 부분, 집행 실적을 우선. 우선순위 높은 순.`;
        const r = await callClaude(
          sb,
          user.id,
          `analyze_${kind}`,
          model,
          `${BASE_RULES}\n\n${spec}\n원문에 없는 숫자·사실을 만들지 않는다. 출처 표기는 page 값으로만 한다.`,
          `[자료: ${d.title}]\n${text}`,
          4000,
        );
        const result = parseJson(r.text, null as unknown);
        if (!result) return json({ error: "결과를 읽지 못했습니다. 다시 시도해 주세요." }, 502);
        // 보관(테이블이 아직 없으면 조용히 넘어감)
        await sb
          .from("ai_outputs")
          .upsert(
            {
              user_id: user.id,
              document_id: docId,
              kind,
              ref: "",
              content: result,
              cost_usd: r.cost,
            },
            { onConflict: "user_id,document_id,kind,ref" },
          )
          .then(
            () => undefined,
            () => undefined,
          );
        return json({
          result,
          cached: false,
          created_at: new Date().toISOString(),
          cost_usd: r.cost,
        });
      }

      // ④-4 전년 대비 비교표: 두 자료(쪽)의 같은 항목 숫자를 맞춰 JSON 으로(증감 계산은 앱에서)
      case "compare_table": {
        const aId = String(body.a_id ?? "");
        const bId = String(body.b_id ?? "");
        const ref = `${bId}:${body.a_page ?? ""}:${body.b_page ?? ""}`;
        if (aId && !body.refresh) {
          const { data: hit } = await sb
            .from("ai_outputs")
            .select("content, created_at")
            .eq("document_id", aId)
            .eq("kind", "compare_table")
            .eq("ref", ref)
            .maybeSingle();
          if (hit) return json({ table: hit.content, cached: true, cost_usd: 0 });
        }
        const r = await callClaude(
          sb,
          user.id,
          "compare_table",
          "claude-haiku-5-5",
          `두 자료(A=이전, B=이후)에서 같은 항목의 숫자를 짝지어 비교표를 만든다. JSON 객체만 출력:
{"title":"비교표 제목","unit":"천원 등","a_label":"A 시기 이름(예: 2025년)","b_label":"B 시기 이름(예: 2026년)","rows":[{"item":"항목","a":숫자|null,"b":숫자|null,"reason":"증감 이유(자료에 근거가 있을 때만, 없으면 빈 문자열)"}],"highlights":["핵심 변화 1","핵심 변화 2","핵심 변화 3"]}
규칙: 숫자는 쉼표 없는 숫자(△·괄호는 음수). 한쪽에만 있는 항목은 다른 쪽을 null(신설·폐지). 합계·소계 행은 제외.
행은 최대 25개. 이유를 지어내지 않는다. 증감 계산은 하지 않는다.`,
          `<A 문서="${String(body.a_title ?? "A")}">\n${String(body.a_text ?? "").slice(0, 12000)}\n</A>\n\n<B 문서="${String(body.b_title ?? "B")}">\n${String(body.b_text ?? "").slice(0, 12000)}\n</B>`,
          4000,
        );
        const t = parseJson(r.text, null as null | Record<string, unknown>);
        if (!t || !Array.isArray(t.rows) || !t.rows.length)
          return json(
            {
              error:
                "비교할 숫자 항목을 찾지 못했습니다. 두 자료의 같은 표가 있는 쪽을 펴고 다시 해 주세요.",
            },
            422,
          );
        if (aId)
          await sb
            .from("ai_outputs")
            .upsert(
              {
                user_id: user.id,
                document_id: aId,
                kind: "compare_table",
                ref,
                content: t,
                cost_usd: r.cost,
              },
              { onConflict: "user_id,document_id,kind,ref" },
            )
            .then(
              () => undefined,
              () => undefined,
            );
        return json({ table: t, cached: false, cost_usd: r.cost });
      }

      // ⑤ 규정 조문 분해 → JSON
      case "split_articles": {
        const r = await callClaude(
          sb,
          user.id,
          "split_articles",
          "claude-haiku-5-5",
          `규정 텍스트를 조문 단위로 나눠 JSON 배열만 출력한다. 형식:
[{"article_no":"제1조","title":"목적","content":"조문 전문"}] 부칙은 article_no를 "부칙"으로.`,
          String(body.text ?? "").slice(0, 40000),
          16000,
        );
        return json({ articles: parseJson(r.text, [] as unknown[]), cost_usd: r.cost });
      }

      // ⑥ 예상 질문·답변 리허설 (P)
      case "rehearsal": {
        const role = body.role === "답변자" ? "답변자" : "질의자";
        let topic = String(body.focus ?? "");
        if (body.meeting_id) {
          const { data: ag } = await sb
            .from("meeting_agendas")
            .select("title")
            .eq("meeting_id", body.meeting_id)
            .order("sort_order");
          topic += " " + (ag ?? []).map((a: { title: string }) => a.title).join(" ");
        }
        const pages = await findPages(sb, topic, body.org);
        if (!pages.length) return json({ error: "리허설에 쓸 관련 자료를 찾지 못했습니다." }, 404);
        const persona =
          role === "답변자"
            ? "경북도회 운영위원 입장에서, 대의원들이 회의에서 던질 날카로운 예상 질문과 근거 기반 모범 답변을 만든다."
            : "대의원 입장에서, 집행부에 할 효과적인 질의와 예상되는 집행부 답변, 그에 대한 재질의 포인트를 만든다.";
        const r = await callClaude(
          sb,
          user.id,
          "rehearsal",
          model,
          `${BASE_RULES}\n\n${persona}\nJSON 배열만 출력: [{"question":"...","answer":"... [문서명 p.N]"}] 8개.`,
          `[자료]\n${pagesBlock(pages)}\n\n[주제]\n${topic}`,
          4000,
        );
        const items = parseJson(r.text, [] as { question: string; answer: string }[]).filter(
          (x) => x?.question,
        );
        if (items.length) {
          await sb.from("rehearsals").insert(
            items.map((x, i) => ({
              user_id: user.id,
              meeting_id: body.meeting_id ?? null,
              role,
              question: x.question,
              answer: x.answer ?? "",
              sources: sources(pages),
              sort_order: i + 1,
            })),
          );
        }
        return json({ items, sources: sources(pages), cost_usd: r.cost });
      }

      // ⑦ 주간 회무 리포트 (Q) — 이번 주 리포트가 있으면 재사용(중복 비용 방지)
      case "weekly_report": {
        const week = mondayOf(new Date());
        if (!body.force) {
          const { data: ex } = await sb
            .from("weekly_reports")
            .select("content")
            .eq("week_start", week)
            .maybeSingle();
          if (ex) return json({ week_start: week, content: ex.content, cached: true });
        }
        const now = new Date();
        const ago = new Date(now.getTime() - 7 * 864e5).toISOString();
        const ahead = new Date(now.getTime() + 14 * 864e5).toISOString();
        const today = now.toISOString().slice(0, 10);
        const [act, meet, resol, sug, law] = await Promise.all([
          sb.from("activities").select("activity_date,type,title,org").gte("created_at", ago),
          sb
            .from("meetings")
            .select("meeting_date,title,org,place")
            .gte("meeting_date", now.toISOString())
            .lte("meeting_date", ahead)
            .order("meeting_date"),
          sb
            .from("resolutions")
            .select("title,org,status,due_date")
            .in("status", ["예정", "진행", "미이행"])
            .lte("due_date", today),
          sb
            .from("suggestions")
            .select("content,status,org")
            .in("status", ["접수", "검토", "처리완료"]),
          sb.from("law_changes").select("law_name,effective_date,summary").eq("is_read", false),
        ]);
        const facts = JSON.stringify({
          지난7일_활동: act.data,
          다가오는_회의_2주: meet.data,
          기한지난_의결사항: resol.data,
          미처리_건의_회신필요: sug.data,
          미확인_법령개정: law.data,
        });
        const r = await callClaude(
          sb,
          user.id,
          "weekly_report",
          "claude-haiku-5-5",
          `대의원 주간 회무 리포트를 작성한다. 섹션: 📌이번 주 할 일(우선순위 3개) / 🗓다가오는 회의(D-day) / ⚠️기한 지난 의결사항 / 💬회신 필요 건의 / ⚖️법령 개정 / ✅지난주 활동 요약.
항목이 없으면 '없음'. 데이터에 없는 내용은 만들지 않는다. 개조식, A4 반 장 이내.`,
          `[데이터]\n${facts}`,
          2000,
        );
        await sb
          .from("weekly_reports")
          .upsert(
            { user_id: user.id, week_start: week, content: r.text },
            { onConflict: "user_id,week_start" },
          );
        await sb.from("app_settings").update({ last_weekly_report: week }).eq("user_id", user.id);
        return json({ week_start: week, content: r.text, cost_usd: r.cost });
      }

      // ⑧ 법령 개정 확인 — 하루 1회만(앱 실행 시 호출해도 중복 조회 안 함)
      // ⑨ 국회 발의 법안(열린국회정보) — 키워드가 든 법안을 새로 찾으면 law_changes 에 '[국회 발의]'로 기록
      case "check_bills": {
        const key = Deno.env.get("ASSEMBLY_API_KEY");
        if (!key)
          return json(
            { error: "ASSEMBLY_API_KEY 비밀값이 없습니다(열린국회정보 인증키 신청 후 등록)." },
            400,
          );
        const words = ["공인중개사", "중개보수", "임대차", "전세사기", "부동산 거래신고"];
        const { data: prev } = await sb
          .from("law_changes")
          .select("law_name, promulgation_date")
          .like("summary", "[국회 발의]%");
        const seen = new Set(
          (prev ?? []).map(
            (p: { law_name: string; promulgation_date: string | null }) =>
              `${p.law_name}|${p.promulgation_date}`,
          ),
        );
        const found: {
          law_name: string;
          promulgation_date: string | null;
          effective_date: null;
          summary: string;
        }[] = [];
        for (const w of words) {
          const url = `https://open.assembly.go.kr/portal/openapi/nzmimeepazxkubdpn?KEY=${encodeURIComponent(key)}&Type=json&pIndex=1&pSize=30&AGE=22&BILL_NAME=${encodeURIComponent(w)}`;
          const res = await fetch(url);
          if (!res.ok) continue;
          const j = await res.json().catch(() => null);
          const blocks = (j?.nzmimeepazxkubdpn ?? []) as { row?: Record<string, string>[] }[];
          const rows = blocks.flatMap((b) => b.row ?? []);
          for (const r of rows) {
            const name = r["BILL_NAME"] ?? "";
            const date = r["PROPOSE_DT"] ?? null;
            const k = `${name}|${date}`;
            if (!name || seen.has(k)) continue;
            seen.add(k);
            found.push({
              law_name: name,
              promulgation_date: date,
              effective_date: null,
              summary: `[국회 발의] ${r["PROPOSER"] ?? ""} · ${r["COMMITTEE"] ?? "소관위 미정"} · 처리: ${r["PROC_RESULT"] ?? "계류"}${r["DETAIL_LINK"] ? `\n${r["DETAIL_LINK"]}` : ""}`,
            });
          }
        }
        // 처음 실행 때는 최근 것만(최근 90일) 알림으로 남김
        const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
        const fresh = (prev ?? []).length
          ? found
          : found.filter((f) => (f.promulgation_date ?? "") >= since);
        if (fresh.length)
          await sb.from("law_changes").insert(fresh.map((f) => ({ ...f, user_id: user.id })));
        return json({ checked: words.length, new_bills: fresh.length });
      }

      case "check_laws": {
        const oc = Deno.env.get("LAW_API_OC");
        if (!oc)
          return json(
            { error: "LAW_API_OC 비밀값이 없습니다(국가법령정보센터 Open API 신청 후 등록)." },
            400,
          );
        const { data: st } = await sb.from("app_settings").select("last_law_check").maybeSingle();
        if (
          !body.force &&
          st?.last_law_check &&
          Date.now() - new Date(st.last_law_check).getTime() < 20 * 3600e3
        ) {
          return json({ skipped: true, reason: "오늘 이미 확인함" });
        }
        const { data: watch } = await sb.from("law_watch").select("*").order("sort_order");
        const changes: { law_name: string; promulgation_date: string; effective_date: string }[] =
          [];
        for (const w of watch ?? []) {
          // 조례·자치규칙은 자치법규(ordin), 그 밖은 법령(law)
          const target = /조례|자치/.test(w.law_name) ? "ordin" : "law";
          const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=${target}&type=JSON&display=20&query=${encodeURIComponent(w.law_name)}`;
          const res = await fetch(url);
          if (!res.ok) continue;
          const j = await res.json().catch(() => null);
          const raw =
            target === "ordin" ? (j?.OrdinSearch?.law ?? j?.OrdinSearch?.ordin) : j?.LawSearch?.law;
          const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, string>[];
          const nameOf = (x: Record<string, string>) =>
            (x["법령명한글"] ?? x["자치법규명"] ?? "").replace(/\s/g, "");
          const hit = list.find((x) => nameOf(x) === w.law_name.replace(/\s/g, ""));
          if (!hit) continue;
          const prom = hit["공포일자"] ?? "";
          const eff = hit["시행일자"] ?? "";
          const isNew =
            !!w.last_promulgation_date &&
            (prom !== w.last_promulgation_date || eff !== w.last_effective_date);
          await sb
            .from("law_watch")
            .update({
              last_promulgation_date: prom,
              last_effective_date: eff,
              checked_at: new Date().toISOString(),
            })
            .eq("id", w.id);
          if (isNew)
            changes.push({ law_name: w.law_name, promulgation_date: prom, effective_date: eff });
        }
        if (changes.length) {
          await sb.from("law_changes").insert(changes.map((c) => ({ ...c, user_id: user.id })));
          await sb.from("regulations").update({ needs_review: true }).eq("user_id", user.id);
        }
        await sb
          .from("app_settings")
          .update({ last_law_check: new Date().toISOString() })
          .eq("user_id", user.id);
        return json({ checked: watch?.length ?? 0, changes });
      }

      default:
        return json({ error: `알 수 없는 action: ${action}` }, 400);
    }
  } catch (e) {
    if (e instanceof LimitError) return json({ error: e.message }, 429);
    if (e instanceof Anthropic.RateLimitError)
      return json({ error: "AI 요청이 많습니다. 잠시 후 다시 시도하세요." }, 429);
    if (e instanceof Anthropic.AuthenticationError)
      return json({ error: "ANTHROPIC_API_KEY 설정을 확인하세요." }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `AI 오류(${e.status})` }, 502);
    console.error(e);
    return json({ error: (e as Error)?.message ?? "서버 오류" }, 500);
  }
});
