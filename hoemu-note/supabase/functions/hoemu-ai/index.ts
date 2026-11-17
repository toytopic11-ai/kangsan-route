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
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

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
};

// 한국어 조사 떼기(검색 키워드 추출용, 외부 형태소 분석기 없이)
const JOSA = /(으로서|으로써|에서는|에게서|이라는|까지는|부터는|으로|에서|에게|까지|부터|이나|라고|하고|와는|과는|이란|란|은|는|이|가|을|를|에|의|와|과|도|만|로|나)$/;
const STOP = new Set(["무엇", "어떻게", "알려줘", "알려", "주세요", "해줘", "정리", "관련", "내용", "있는", "대한", "그리고", "어떤", "몇", "언제"]);
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
  pages.map((p) => `<자료 문서="${p.title}" 페이지="${p.page_no}">\n${p.content.slice(0, MAX_PAGE_CHARS)}\n</자료>`).join("\n\n");

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
  sb: SupabaseClient, userId: string, action: string, model: string,
  system: string, content: Anthropic.MessageParam["content"], maxTokens = 2000,
) {
  // 월 상한 확인
  const [{ data: spent }, { data: setting }] = await Promise.all([
    sb.rpc("ai_cost_this_month"),
    sb.from("app_settings").select("monthly_ai_limit_usd").maybeSingle(),
  ]);
  const limit = Number(setting?.monthly_ai_limit_usd ?? 3);
  if (Number(spent ?? 0) >= limit) throw new LimitError(`이번 달 AI 사용 상한($${limit})에 도달했습니다. 설정에서 상한을 조정하세요.`);

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort: "low" },
  });

  const [pi, po] = PRICE[model] ?? PRICE["claude-haiku-5-5"];
  const cost = (res.usage.input_tokens * pi + res.usage.output_tokens * po) / 1_000_000;
  await sb.from("ai_usage").insert({
    user_id: userId, action, model,
    input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, cost_usd: cost,
  });

  if (res.stop_reason === "refusal") return { text: "요청을 처리할 수 없습니다. 질문을 바꿔 다시 시도해 주세요.", cost };
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
  return { text: res.stop_reason === "max_tokens" ? text + "\n\n(분량 제한으로 일부 생략됨)" : text, cost };
}

/** 응답 안의 JSON 배열/객체만 안전하게 추출 */
function parseJson<T>(text: string, fallback: T): T {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (m ? m[1] : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) return fallback;
  try { return JSON.parse(body.slice(start)); } catch {
    const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
    try { return JSON.parse(body.slice(start, end + 1)); } catch { return fallback; }
  }
}

async function findPages(sb: SupabaseClient, q: string, org?: string | null, categoryIds?: string[] | null): Promise<Page[]> {
  const kws = keywords(q);
  if (!kws.length) return [];
  const { data, error } = await sb.rpc("match_pages", {
    keywords: kws, p_org: org ?? null, p_category_ids: categoryIds?.length ? categoryIds : null, p_limit: MAX_PAGES,
  });
  if (error) throw error;
  return (data ?? []) as Page[];
}

const sources = (pages: Page[]) => pages.map((p) => ({ document_id: p.document_id, title: p.title, page_no: p.page_no }));

function mondayOf(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, publicKey(), {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "로그인이 필요합니다" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const model = ALLOWED_MODELS.includes(body.model) ? body.model : "claude-haiku-5-5";

    switch (action) {
      // ① 질문하기: 근거 페이지 검색 → 답변 + 출처
      case "ask": {
        const q = String(body.question ?? "").slice(0, 2000);
        if (!q) return json({ error: "질문이 비어 있습니다" }, 400);
        const pages = await findPages(sb, q, body.org, body.category_ids);
        if (!pages.length) return json({ answer: "관련 자료를 찾지 못했습니다. 검색 범위나 단어를 바꿔 보세요.", sources: [] });
        const fmt = body.output_format ? `\n출력 형식: ${body.output_format}` : "";
        const r = await callClaude(sb, user.id, "ask", model, BASE_RULES + fmt, `[자료]\n${pagesBlock(pages)}\n\n[질문]\n${q}`);
        return json({ answer: r.text, sources: sources(pages), cost_usd: r.cost });
      }

      // ② 작성·요약·콘텐츠 변환: 앱이 고른 재료(materials)로 생성
      case "generate": {
        const task = String(body.task ?? "");
        if (!TASKS[task]) return json({ error: `알 수 없는 작업: ${task}` }, 400);
        const materials = String(body.materials ?? "").slice(0, 30000);
        const options = body.options ? `\n[옵션]\n${JSON.stringify(body.options)}` : "";
        const r = await callClaude(sb, user.id, task, model, `${BASE_RULES}\n\n작업: ${TASKS[task]}`, `[자료]\n${materials}${options}`, 4000);
        return json({ text: r.text, cost_usd: r.cost });
      }

      // ③ 글자 인식(스캔본·사진) — 이미지 1장씩
      case "ocr": {
        const media = String(body.media_type ?? "image/jpeg");
        if (!/^image\/(jpeg|png|webp)$/.test(media)) return json({ error: "jpeg/png/webp 이미지만 가능합니다" }, 400);
        const r = await callClaude(sb, user.id, "ocr", "claude-haiku-5-5",
          "이미지 속 한국어 문서의 텍스트를 원문 그대로 추출한다. 표는 마크다운 표로. 설명·요약을 덧붙이지 않는다.",
          [
            { type: "image", source: { type: "base64", media_type: media as "image/jpeg", data: String(body.image_base64 ?? "") } },
            { type: "text", text: "텍스트만 추출" },
          ], 4000);
        return json({ text: r.text, cost_usd: r.cost });
      }

      // ④ 예산표 추출 → JSON
      case "extract_budget": {
        const r = await callClaude(sb, user.id, "extract_budget", "claude-haiku-5-5",
          `예산서 텍스트에서 항목을 추출해 JSON 배열만 출력한다. 형식:
[{"section":"수입|지출","category_l1":"관","category_l2":"항","item_name":"목","amount":원단위정수}]
천원 단위 표는 1000을 곱해 원 단위로. 합계·소계 행은 제외.`,
          String(body.text ?? "").slice(0, 30000), 8000);
        return json({ items: parseJson(r.text, [] as unknown[]), cost_usd: r.cost });
      }

      // ⑤ 규정 조문 분해 → JSON
      case "split_articles": {
        const r = await callClaude(sb, user.id, "split_articles", "claude-haiku-5-5",
          `규정 텍스트를 조문 단위로 나눠 JSON 배열만 출력한다. 형식:
[{"article_no":"제1조","title":"목적","content":"조문 전문"}] 부칙은 article_no를 "부칙"으로.`,
          String(body.text ?? "").slice(0, 40000), 16000);
        return json({ articles: parseJson(r.text, [] as unknown[]), cost_usd: r.cost });
      }

      // ⑥ 예상 질문·답변 리허설 (P)
      case "rehearsal": {
        const role = body.role === "답변자" ? "답변자" : "질의자";
        let topic = String(body.focus ?? "");
        if (body.meeting_id) {
          const { data: ag } = await sb.from("meeting_agendas").select("title").eq("meeting_id", body.meeting_id).order("sort_order");
          topic += " " + (ag ?? []).map((a: { title: string }) => a.title).join(" ");
        }
        const pages = await findPages(sb, topic, body.org);
        if (!pages.length) return json({ error: "리허설에 쓸 관련 자료를 찾지 못했습니다." }, 404);
        const persona = role === "답변자"
          ? "경북도회 운영위원 입장에서, 대의원들이 회의에서 던질 날카로운 예상 질문과 근거 기반 모범 답변을 만든다."
          : "대의원 입장에서, 집행부에 할 효과적인 질의와 예상되는 집행부 답변, 그에 대한 재질의 포인트를 만든다.";
        const r = await callClaude(sb, user.id, "rehearsal", model,
          `${BASE_RULES}\n\n${persona}\nJSON 배열만 출력: [{"question":"...","answer":"... [문서명 p.N]"}] 8개.`,
          `[자료]\n${pagesBlock(pages)}\n\n[주제]\n${topic}`, 4000);
        const items = parseJson(r.text, [] as { question: string; answer: string }[]).filter((x) => x?.question);
        if (items.length) {
          await sb.from("rehearsals").insert(items.map((x, i) => ({
            user_id: user.id, meeting_id: body.meeting_id ?? null, role, question: x.question, answer: x.answer ?? "",
            sources: sources(pages), sort_order: i + 1,
          })));
        }
        return json({ items, sources: sources(pages), cost_usd: r.cost });
      }

      // ⑦ 주간 회무 리포트 (Q) — 이번 주 리포트가 있으면 재사용(중복 비용 방지)
      case "weekly_report": {
        const week = mondayOf(new Date());
        if (!body.force) {
          const { data: ex } = await sb.from("weekly_reports").select("content").eq("week_start", week).maybeSingle();
          if (ex) return json({ week_start: week, content: ex.content, cached: true });
        }
        const now = new Date();
        const ago = new Date(now.getTime() - 7 * 864e5).toISOString();
        const ahead = new Date(now.getTime() + 14 * 864e5).toISOString();
        const today = now.toISOString().slice(0, 10);
        const [act, meet, resol, sug, law] = await Promise.all([
          sb.from("activities").select("activity_date,type,title,org").gte("created_at", ago),
          sb.from("meetings").select("meeting_date,title,org,place").gte("meeting_date", now.toISOString()).lte("meeting_date", ahead).order("meeting_date"),
          sb.from("resolutions").select("title,org,status,due_date").in("status", ["예정", "진행", "미이행"]).lte("due_date", today),
          sb.from("suggestions").select("content,status,org").in("status", ["접수", "검토", "처리완료"]),
          sb.from("law_changes").select("law_name,effective_date,summary").eq("is_read", false),
        ]);
        const facts = JSON.stringify({
          지난7일_활동: act.data, 다가오는_회의_2주: meet.data, 기한지난_의결사항: resol.data,
          미처리_건의_회신필요: sug.data, 미확인_법령개정: law.data,
        });
        const r = await callClaude(sb, user.id, "weekly_report", "claude-haiku-5-5",
          `대의원 주간 회무 리포트를 작성한다. 섹션: 📌이번 주 할 일(우선순위 3개) / 🗓다가오는 회의(D-day) / ⚠️기한 지난 의결사항 / 💬회신 필요 건의 / ⚖️법령 개정 / ✅지난주 활동 요약.
항목이 없으면 '없음'. 데이터에 없는 내용은 만들지 않는다. 개조식, A4 반 장 이내.`,
          `[데이터]\n${facts}`, 2000);
        await sb.from("weekly_reports").upsert({ user_id: user.id, week_start: week, content: r.text }, { onConflict: "user_id,week_start" });
        await sb.from("app_settings").update({ last_weekly_report: week }).eq("user_id", user.id);
        return json({ week_start: week, content: r.text, cost_usd: r.cost });
      }

      // ⑧ 법령 개정 확인 — 하루 1회만(앱 실행 시 호출해도 중복 조회 안 함)
      case "check_laws": {
        const oc = Deno.env.get("LAW_API_OC");
        if (!oc) return json({ error: "LAW_API_OC 비밀값이 없습니다(국가법령정보센터 Open API 신청 후 등록)." }, 400);
        const { data: st } = await sb.from("app_settings").select("last_law_check").maybeSingle();
        if (!body.force && st?.last_law_check && Date.now() - new Date(st.last_law_check).getTime() < 20 * 3600e3) {
          return json({ skipped: true, reason: "오늘 이미 확인함" });
        }
        const { data: watch } = await sb.from("law_watch").select("*").order("sort_order");
        const changes: { law_name: string; promulgation_date: string; effective_date: string }[] = [];
        for (const w of watch ?? []) {
          const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&display=20&query=${encodeURIComponent(w.law_name)}`;
          const res = await fetch(url);
          if (!res.ok) continue;
          const j = await res.json().catch(() => null);
          const raw = j?.LawSearch?.law;
          const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, string>[];
          const hit = list.find((x) => (x["법령명한글"] ?? "").replace(/\s/g, "") === w.law_name.replace(/\s/g, ""));
          if (!hit) continue;
          const prom = hit["공포일자"] ?? "";
          const eff = hit["시행일자"] ?? "";
          const isNew = !!w.last_promulgation_date && (prom !== w.last_promulgation_date || eff !== w.last_effective_date);
          await sb.from("law_watch").update({ last_promulgation_date: prom, last_effective_date: eff, checked_at: new Date().toISOString() }).eq("id", w.id);
          if (isNew) changes.push({ law_name: w.law_name, promulgation_date: prom, effective_date: eff });
        }
        if (changes.length) {
          await sb.from("law_changes").insert(changes.map((c) => ({ ...c, user_id: user.id })));
          await sb.from("regulations").update({ needs_review: true }).eq("user_id", user.id);
        }
        await sb.from("app_settings").update({ last_law_check: new Date().toISOString() }).eq("user_id", user.id);
        return json({ checked: watch?.length ?? 0, changes });
      }

      default:
        return json({ error: `알 수 없는 action: ${action}` }, 400);
    }
  } catch (e) {
    if (e instanceof LimitError) return json({ error: e.message }, 429);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "AI 요청이 많습니다. 잠시 후 다시 시도하세요." }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY 설정을 확인하세요." }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `AI 오류(${e.status})` }, 502);
    console.error(e);
    return json({ error: (e as Error)?.message ?? "서버 오류" }, 500);
  }
});
