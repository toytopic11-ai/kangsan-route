# 회무노트 · Lovable 단계별 지시문 (0~25단계, 검증판)

> **사용 원칙: 크레딧 절약과 오류 예방**
> - **한 번에 한 단계만** 붙여 넣으세요. 결과를 확인하고 다음 단계로 넘어갑니다.
> - DB, 필기 엔진, AI 서버는 **이미 완성본이 있습니다**(README 참고). Lovable이 새로 만들지 않게 하는 것이 크레딧을 가장 크게 아끼는 방법입니다.
> - 같은 오류가 **2번 반복되면 중단**하고, 오류 화면을 Claude Code에 넘기세요.
> - 각 단계 끝의 ✅ 확인 항목을 직접 눌러 보고 다음 단계로 진행합니다.

진행 체크: `[ ]`를 `[x]`로 바꿔 가며 쓰세요.

---

## [ ] 0단계: 프로젝트 지침 (Project Settings → Knowledge, 최초 1회)

```
[회무노트 프로젝트 지침]
- 용도: 한국공인중개사협회 대의원 1인 전용 회무자료 관리 앱. 외부 공유·회원가입 기능 금지.
- 소속: 중앙회 대의원, 경북도회 대의원·운영위원, 포항시회 대의원.
- 기술: React + TypeScript + Vite + Tailwind + shadcn/ui + Supabase(외부 프로젝트 연결).
- ★ DB 테이블·RLS·함수는 이미 supabase/schema.sql 로 생성되어 있음. 테이블을 새로 만들거나 마이그레이션을 생성하지 말 것. 필요하면 먼저 물어볼 것.
- ★ AI는 Edge Function 'hoemu-ai' 가 이미 배포되어 있음. supabase.functions.invoke('hoemu-ai', { body: { action, ... } }) 로만 호출. 새 Edge Function 만들지 말 것. API 키를 프론트 코드에 넣지 말 것.
- ★ 필기 엔진은 src/ink/ (inkEngine.ts, InkLayer.tsx, PenToolbar.tsx, penSettings.ts) 완성본 사용. 이 4개 파일은 수정하지 말고 가져다 쓰기만 할 것.
- 기기: 갤럭시 탭 S8(S펜), 안드로이드 폰, PC 크롬. 반응형, 터치 영역 최소 44px.
- 디자인: 흰 바탕, 남색(#1e3a8a) 포인트, 본문 16px 이상, 한글 UI, 아이콘에 한글 라벨 병기.
- 기관 색: 중앙회 #1e3a8a, 경북도회 #15803d, 포항시회 #ea580c, 공통 #64748b.
- 순서 변경: sort_order(double) = 앞뒤 항목 평균값, 이동한 1건만 update.
- 코드는 기능별 폴더(features/tree, features/viewer, features/ai …)로 분리.
- 기존 기능을 깨지 말고, 작업 끝에 변경 파일 목록을 요약할 것.
```

---

## [ ] 1단계: 뼈대 + 로그인

```
1단계:
1) Supabase 이메일+비밀번호 로그인 화면(회원가입 버튼 없음). 로그인 후 supabase.rpc('init_user_data') 를 1회 호출(기본 분류·템플릿 생성, 중복 실행 안전).
2) 3단 레이아웃: 좌측 분류 트리 / 중앙 문서 영역 / 우측 AI 패널(접기 가능).
   768px 미만은 하단 탭 [서재][보기][AI][스크랩] 전환.
3) 상단: 기관 탭 [전체][중앙회][경북도회][포항시회][공통] + 검색창 자리 + [✏️ 정리] 버튼 자리.
4) src/integrations/supabase 의 타입을 현재 DB 기준으로 생성/갱신.
PDF·필기 기능은 아직 넣지 마.
```
✅ 로그인 후 새로고침해도 로그인 유지 / 폰 화면에서 하단 탭 전환

> 사용자 계정은 Supabase 대시보드 → Authentication → Users → **Add user**로 본인 것 1개만 만드세요. 그다음 Authentication → Sign In / Providers에서 **Allow new users to sign up을 끄면** 외부인이 가입할 수 없습니다.

---

## [ ] 2단계: 대·중·소 분류 트리 + 순서 변경

```
2단계: 분류 트리(categories 테이블: parent_id, level 1~3, org, sort_order).
1) 트리: 펼치기/접기(상태는 localStorage 기억), 분류명 옆 문서 수, 선택 경로 브레드크럼.
2) 분류 ⋯ 메뉴: 하위 분류 추가(level 3까지만), 이름 변경, 색 변경, 삭제(하위·문서 이동 경고 확인창).
3) [✏️ 정리] 켰을 때만 ⠿ 손잡이 표시 → @dnd-kit/sortable 로 같은 부모 안 순서 변경.
   - PointerSensor activationConstraint { delay: 200, tolerance: 6 } (S펜·손가락 오작동 방지)
   - 768px 미만은 끌기 대신 ▲▼ 버튼.
4) 상단 기관 탭 선택 시 해당 org 대분류만 표시.
```
✅ 순서를 바꾸고 새로고침해도 유지 / 폰에서 ▲▼ 동작

---

## [ ] 3단계: PDF 업로드 + 뷰어 + 텍스트 추출

```
3단계:
1) 업로드: 선택한 분류에 PDF 여러 개(끌어놓기 지원). Storage 버킷 'docs', 경로 `${user.id}/${crypto.randomUUID()}.pdf`.
   documents 행 생성(org 는 분류의 org, file_size, page_count).
2) 텍스트 추출은 브라우저에서: pdfjs-dist@4.10.38 사용.
   - 워커 설정(반드시 이 방식): import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'; GlobalWorkerOptions.workerSrc = workerUrl;
   - 페이지별 getTextContent → doc_pages upsert(onConflict 'document_id,page_no'), 완료 시 documents.text_extracted=true.
   - 글자가 거의 없는 페이지(20자 미만)는 '스캔본' 표시만 해 둘 것(글자 인식은 12단계).
3) 문서 목록: is_pinned 먼저, 그다음 sort_order. 정렬 전환(직접/날짜/이름/최근열람). [✏️ 정리] 모드에서 끌어 순서 변경, 좌측 트리로 끌어 분류 이동. 폰은 ⋯ > 이동, ▲▼.
4) 뷰어: Storage createSignedUrl(600초)로 열기. 페이지는 세로 스크롤, 화면에 보이는 페이지만 렌더(IntersectionObserver, 앞뒤 1페이지 미리).
   각 페이지 = position:relative 래퍼 안에 [PDF canvas] + [텍스트 레이어(글자 선택 복사용)].
   확대/축소 50~300%, 썸네일 사이드바, 페이지 이동. 마지막 페이지를 documents.last_page 에 저장해 '이어 읽기'.
5) 상단 검색: supabase.rpc('search_all', { q, p_org }) 결과 클릭 시 문서·페이지 이동(16단계에서 확장).
```
✅ 50쪽 이상 PDF도 끊김 없이 스크롤 / 글자 드래그 복사 / 검색 결과에서 페이지 이동

---

## [ ] 4단계: S펜 필기 (완성본 연결)

> 사전 준비: `hoemu-note/src/ink/` 폴더의 4개 파일을 Lovable 프로젝트 GitHub 저장소의 `src/ink/`에 업로드하세요(README 2번). 패키지는 `perfect-freehand@1.2.2` 하나만 필요합니다.

```
4단계: src/ink 의 완성된 필기 엔진을 뷰어에 연결해줘. src/ink 4개 파일은 수정 금지.
1) npm 패키지 perfect-freehand@1.2.2 설치.
2) 각 PDF 페이지 래퍼 안, PDF canvas·텍스트 레이어 위에 <InkLayer> 를 겹쳐 배치(래퍼는 position:relative, 페이지 크기와 동일).
   - data: page_ink 테이블에서 (document_id, page_no) 로 읽은 data
   - onChange: 800ms 디바운스로 page_ink upsert(onConflict 'document_id,page_no')
   - settings: penSettings.ts 의 loadSettings()/saveSettings() 로 기기별 기억, 모든 페이지가 같은 settings 공유
   - onHistoryChange: 현재 보고 있는 페이지 기준으로 실행취소/다시실행 버튼 활성화
   - onPinch: 뷰어 확대 배율 변경(0.5~3)
3) 뷰어 상단에 <PenToolbar> 고정. onUndo/onRedo/onClearPage 는 현재 페이지 InkLayer ref 호출.
4) 도구가 '보기(none)'일 때는 기존처럼 글자 선택·스크롤 가능해야 함(엔진이 자동 처리).
5) 형광펜 글자 저장: page_ink 저장 시 kind==='highlighter' 획의 경계상자(좌표는 페이지 가로폭 1000 기준)와
   겹치는 텍스트 레이어 글자를 모아 highlights = [{color, text}] 로 함께 저장.
6) 키보드(PC): Ctrl+Z 실행취소, Ctrl+Y 다시실행, P 펜, H 형광펜, E 지우개, V 보기.
```
✅ 탭 S8 확인 목록:
- S펜으로 부드럽게 그려지고 필압에 따라 굵기가 변함
- 손가락으로는 스크롤·확대만 됨
- S펜 버튼을 누른 채 문지르면 지움
- 긋고 잠시 멈추면 직선
- 형광펜이 글자를 가리지 않음
- 확대·축소해도 필기 위치가 그대로이고, PC에서 열어도 같음

---

## [ ] 5단계: 메모 · 영역 복사 · 스크랩북 · 내보내기

```
5단계:
1) 메모: 툴바에 [📝메모] 추가 → 페이지 탭 위치에 포스트잇(notes 테이블, x·y 는 페이지 가로폭 1000 기준). 접기/펼치기, 색상, 끌어서 이동.
2) 영역 복사: [✂️영역] → 사각형 드래그 → (PDF canvas + InkLayer.renderTo)로 그 영역 이미지 생성, 영역 내 텍스트 레이어 글자 추출
   → Storage docs/{user.id}/scraps/{uuid}.png + scraps 행 생성.
3) 스크랩북 화면: 카드 목록(끌어서 순서), 카드 클릭 시 원본 페이지로 이동, 출처 자동 표기, 여러 장 선택 → 텍스트 일괄 복사.
4) '필기 모아보기': 문서의 page_ink.highlights + notes 를 페이지순으로.
5) '필기 포함 PDF 내보내기': pdf-lib@1.17.1 로 원본 PDF 각 페이지에 [InkLayer.renderTo 로 그린 PNG(가로 1600px)]를 페이지 크기로 덮어 저장·다운로드.
```
✅ 내보낸 PDF를 다른 앱에서 열었을 때 필기가 보임

---

## [ ] 6단계: AI 패널

```
6단계: AI 패널(우측). Edge Function 'hoemu-ai' 호출만 사용.
1) 질문 입력 + 검색 범위 선택(기관, 분류 다중선택).
   invoke('hoemu-ai', { body: { action:'ask', question, org, category_ids, output_format } })
   → { answer, sources:[{document_id,title,page_no}], cost_usd }
2) 답변은 마크다운 렌더(react-markdown + remark-gfm, 표 지원). [문서명 p.N] 및 sources 칩 클릭 시 해당 페이지로 이동.
3) 오류 처리: 응답 error 문자열을 토스트로 표시(429 는 '월 상한 도달' 안내 + 설정 화면 링크).
4) 설정 화면: app_settings.ai_model ('claude-haiku-5-5' 기본 / 'claude-sonnet-5-5' 고급), monthly_ai_limit_usd(월 상한), rpc('ai_cost_this_month') 로 이번 달 사용액 표시(원화 환산 ×1,400 대략).
5) 대화 기록은 화면 상태로만 유지(저장 안 함 → 비용·용량 절약). 답변 [복사] [스크랩에 저장] 버튼.
```
✅ 질문하면 출처 칩이 붙어 나옴 / 이번 달 사용액이 늘어남

---

## [ ] 7단계: 앱 설치(PWA)

```
7단계: PWA. vite-plugin-pwa@0.21.1 사용, strategies 'injectManifest', srcDir 'src', filename 'sw.ts'.
1) manifest: name '회무노트', short_name '회무노트', theme_color '#1e3a8a', background_color '#ffffff', display 'standalone', start_url '/', 아이콘 192/512(남색 바탕 흰 '회' 글자).
2) 서비스워커 등록은 반드시 조건부: if (import.meta.env.PROD && window.self === window.top) — Lovable 미리보기(iframe)에서 오류 방지.
3) 서비스워커: 앱 화면 파일 precache, 최근 연 PDF 20개를 Cache Storage 에 보관(오프라인 열람).
4) 설치 안내 배너(beforeinstallprompt), 새 버전 있으면 '새로고침' 토스트.
```
✅ 탭·폰 크롬에서 '홈 화면에 추가' 후 앱처럼 실행됨

> PWA 기능은 **게시(Publish)한 주소**에서만 동작합니다. Lovable 미리보기 창에서는 동작하지 않는 것이 정상입니다.

---

## [ ] 8단계: 형광펜 색상별 의미

```
8단계:
1) 설정 > 형광펜 범례: highlight_legend(color, meaning) 편집.
2) PenToolbar 위에 작은 범례 띠 표시(색 점 + 의미). 형광펜 색 버튼과 같은 색을 사용(#fde047 노랑 #86efac 초록 #f9a8d4 분홍 #7dd3fc 하늘 #fdba74 주황).
3) '필기 모아보기'에 색상(의미) 필터, 전체 문서 대상 '분홍(질의할 것)만 보기'.
4) AI 패널 [표시 모아 요약]: 선택 색 highlights 텍스트를 모아 invoke action:'generate', task:'summary', materials.
```

## [ ] 9단계: 의결사항 추적

```
9단계: resolutions 테이블 화면.
1) 기관 탭 필터 + 상태 칸반(예정/진행/완료/미이행) ↔ 표 보기 전환, 카드 끌어서 상태 변경.
2) 뷰어에서 글자 선택 → '의결사항으로 등록' → document_id·page_no 자동 연결.
3) due_date 지났는데 완료 아님 → 빨간 배지.
4) [이행 점검 질의 만들기] → 미이행·지연 항목을 materials 로 action:'generate', task:'draft_inquiry'.
```

## [ ] 10단계: 회의 모드

```
10단계: meetings / meeting_agendas 화면 + 회의 모드.
1) 기관별 회의 목록, 안건 등록(끌어서 순서), 안건마다 문서·페이지 연결, my_position(찬성/반대/질의/보류).
2) [회의 모드 시작] → meetings.status='진행', 전체 화면(탭 가로 최적화):
   좌: 안건 목록 / 중: 연결된 PDF 해당 페이지(필기 가능) / 우: 내 입장, 분홍 표시 목록, 빠른 메모
   상단: 현재 시각, 경과 시간, [발언 완료] 버튼(meeting_agendas.spoke=true)
3) 화면 꺼짐 방지: navigator.wakeLock.request('screen') (미지원 기기는 무시).
4) [회의 종료] → status='종료', 안건별 결과 입력 → 결과를 resolutions 에 등록.
   (활동 기록부의 회의참석·발언 기록은 DB 트리거가 자동 생성하므로 앱에서 따로 넣지 말 것)
```

## [ ] 11단계: 두 문서 나란히 보기

```
11단계: 문서 ⋯ > [다른 문서와 비교] → 좌우 분할(폰은 상하), 분할 바 끌기, '스크롤 동기화' 토글,
양쪽 필기 가능(InkLayer 재사용). [AI 차이점 분석] → 양쪽 현재 페이지 텍스트를 materials 로 action:'generate', task:'compare'.
```

## [ ] 12단계: 사진 → PDF + 글자 인식

```
12단계:
1) [📷 스캔]: <input type="file" accept="image/*" capture="environment" multiple> + 갤러리 선택.
2) 편집: 자르기(react-easy-crop), 회전, 흑백·선명(canvas 필터), 순서 변경.
3) 이미지 가로 1600px 이하·JPEG 품질 0.8 로 축소(용량·AI 비용 절약) → pdf-lib 로 한 PDF 로 합쳐 업로드.
4) 글자 인식: 각 페이지 이미지를 base64 로 invoke action:'ocr', media_type:'image/jpeg', image_base64
   → doc_pages upsert(ocr=true). 한 장씩 순서대로 호출하고 진행률 표시.
5) 3단계에서 '스캔본' 표시된 기존 PDF는 [글자 인식 실행] 버튼 → pdf.js 로 페이지를 이미지로 렌더 후 같은 방식.
```

## [ ] 13단계: 예산 추이 대시보드

```
13단계: budget_items 화면.
1) 예산서 PDF 에서 페이지 선택 → [예산표 추출] → 해당 doc_pages.content 를 invoke action:'extract_budget', text
   → items 를 '확인 표'(편집 가능)로 보여주고 사용자가 저장(verified=true, org·fiscal_year·kind 선택).
2) 대시보드(recharts@2.15.0): 기관 탭 + 연도 범위, 카드(총수입·총지출·전년 대비), 항목별 연도 추이 꺾은선(다중 선택),
   증감률 상위 10 표(±20% 이상 강조), 예산 vs 결산 집행률 막대. verified=false 값은 점선.
3) 항목 클릭 → 근거 페이지. 금액 천원 콤마 / 백만원 단위 토글.
4) [질의 포인트] → 증감 큰 항목을 materials 로 task:'draft_inquiry' → 15단계 작성기로 보내기.
```

## [ ] 14단계: 정관·규정 개정 이력

```
14단계: regulations / regulation_versions / articles 화면.
1) 규정 PDF → [조문 분해] → 페이지 텍스트를 이어 붙여 invoke action:'split_articles' → 확인 화면에서 수정 후 저장.
2) 새 버전 등록 시 이전 버전과 article_no 기준 비교: 신설/개정/삭제/변경없음(diff 라이브러리 'diff@7.0.0' 의 diffWords 로 변경 부분 강조).
3) 타임라인: 규정 선택 → 버전 세로 타임라인. 조문 검색('제12조' 또는 키워드) → 버전별 변천.
4) [신구조문 대비표] 두 버전 선택 → 변경 조문만 3열 표(현행/개정안/비고) → 복사·인쇄.
5) needs_review=true 인 규정에 '법령 개정 검토 필요' 배지(21단계와 연동).
```

## [ ] 15단계: 발언문·질의서 작성기

```
15단계: drafts 화면 3단.
좌: 재료함(스크랩, 분홍 형광펜, 미이행 의결, 예산 질의 포인트 — 체크 선택)
중: 편집기(마크다운 textarea + 미리보기), 옵션: 종류(발언문/질의서/건의서), 분량(1·3·5분), 어조(정중·단호·건의형)
우: 선택 재료 출처(클릭 시 원문 페이지)
[AI 초안] → task: 발언문 'draft_speech' / 질의서 'draft_inquiry' / 건의서 'draft_proposal', options:{분량, 어조}.
저장·상태(초안/완성). 회의 연결(meeting_id). [낭독 보기]: 큰 글씨 전체 화면. 내보내기: 복사, PDF 인쇄(window.print 전용 CSS).
(질의서를 '완성'으로 바꾸면 활동 기록이 DB 트리거로 자동 생성됨)
```

## [ ] 16단계: 통합 검색

```
16단계: 상단 검색 완성.
supabase.rpc('search_all', { q, p_org, p_limit: 60 }) → kind 별 그룹(본문/형광펜/메모/스크랩/의결/회의/초안/건의), 검색어 강조,
기간·유형 필터(클라이언트), 최근 검색어 10개(localStorage), Ctrl+K 열기, 300ms 디바운스, 2글자 미만은 검색 안 함.
결과 클릭 시 해당 화면·문서·페이지로 이동. [AI에게 묻기] → 검색어로 6단계 ask 호출.
```

## [ ] 17단계: 자주 쓰는 AI 질문

```
17단계: prompt_templates 를 AI 패널 상단 가로 버튼 줄로. 변수 {기관}{회의}{문서}{연도}{색상} 은 실행 시 선택창으로 채움.
끌어서 순서, use_count 증가, 답변 하단 [이 질문 저장] → 템플릿 추가. output_format 을 ask 에 전달.
```

## [ ] 18단계: 회원 건의사항 수첩

```
18단계: suggestions 화면. 상태 칸반 ↔ 표, 기관·분류·기간 필터.
폰 하단 [+] 빠른 등록(내용만 필수). member_label 입력칸에 '실명·전화번호 입력 금지(별칭 사용)' 안내.
[안건으로 올리기] → 회의 선택 → meeting_agendas 추가 + status='안건상정'.
처리완료인데 replied_at 없음 → '회신 필요' 배지, [회신 문안] → task:'reply_member'.
분기별 분류 통계 막대그래프.
```

## [ ] 19단계: 대의원 활동 기록부

```
19단계: activities 화면(자동 기록은 DB 트리거가 이미 처리 — 앱에서 중복 insert 금지, 수동 추가만 구현).
연도·기관 선택, 요약 카드(회의참석·발언·질의·건의전달 건수), 월별 달력 히트맵, 타임라인(원본으로 이동),
outcome(반영/부분반영/미반영/대기) 편집 → 반영률 표시.
[활동보고서 생성] → 기간 내 activities 를 materials 로 task:'activity_report' → 편집 후 인쇄/PDF.
```

## [ ] 20단계: 공개 여부 + 공개용 콘텐츠 변환

```
20단계:
1) documents.visibility('내부' 기본/'공개가능') 배지 🔒/🌐, ⋯ 메뉴에서 변경.
2) [콘텐츠] 화면: visibility='공개가능' 문서와 그 형광펜·스크랩만 재료로 표시(내부 문서는 목록에도 표시 금지).
3) 형식: 블로그 content_blog / 쇼츠 자막 content_shorts / 밴드 content_band / 페이스북 content_facebook.
   생성 전 확인창 '공개 가능한 자료인지 확인하셨습니까?'. 결과 편집, [복사], contents 테이블에 이력 저장.
```

## [ ] 21단계: 법령 개정 알림

```
21단계: 앱 실행 시(로그인 후 1회) invoke action:'check_laws' 호출(서버가 하루 1회만 실제 조회 — 중복 호출 안전).
[법령] 화면: law_watch 목록 관리(추가·삭제·순서), law_changes 타임라인, 시행일 D-day, 미확인 빨간 점, 읽음 처리.
홈 상단 '새 법령 개정 N건' 알림 띠. 오류(LAW_API_OC 없음)면 설정 화면 안내만 하고 앱은 정상 동작.
```

---

## [ ] 22단계: 카카오톡 → 회무노트 바로 저장 (O)

```
22단계: Web Share Target(7단계 PWA 위에).
1) manifest 에 추가:
   share_target: { action: '/share-target', method: 'POST', enctype: 'multipart/form-data',
     params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'files', accept: ['application/pdf', 'image/*'] }] } }
2) src/sw.ts 에 fetch 핸들러: POST + pathname '/share-target' 일 때
   formData 의 files 를 Cache Storage('share-inbox')에 '/share-inbox/{n}' 키로 저장 → Response.redirect('/share?n=개수', 303).
3) /share 페이지: share-inbox 의 파일 목록 표시 → 분류 선택(최근 사용 분류 상단) → 업로드(PDF는 3단계와 동일 처리, 이미지는 12단계처럼 PDF 변환 선택) → 처리 후 캐시 삭제.
   text/url 만 공유된 경우(기사 링크 등)는 스크랩(scraps.note)으로 저장.
4) 로그인 안 된 상태면 로그인 후 /share 로 복귀.
```
✅ 카톡에서 PDF 열기 → 공유 → **회무노트** 선택 → 분류 고르고 저장

> - 공유 목록에 '회무노트'가 보이려면 **크롬에서 홈 화면에 설치**한 상태여야 합니다(삼성 인터넷이 아닌 크롬 권장).
> - 카톡 파일은 먼저 **파일 열기 → 공유(또는 다른 앱으로 보내기)** 순서로 보내세요.

## [ ] 23단계: 잠금 화면 (Y)

```
23단계: 앱 잠금.
1) 설정에서 PIN(4~6자리) 등록: crypto.subtle SHA-256(salt + PIN) 해시만 localStorage 저장(PIN 원문 저장 금지).
2) 잠금 조건: 앱 시작 시, 백그라운드 전환(visibilitychange hidden) 후 N분(기본 3분, 설정 가능) 지나 복귀 시.
3) 잠금 화면: 큰 숫자 키패드(버튼 64px), 남색 배경, 화면 내용 완전히 가림(blur 아님, 렌더 자체 차단).
4) 5회 연속 실패 → supabase.auth.signOut() 후 로그인 화면.
5) PIN 분실: 로그인 비밀번호 재입력으로 초기화.
```
✅ 홈 버튼을 눌렀다가 3분 뒤 돌아오면 잠김

> 잠금 화면은 폰 분실 대비 보조 장치입니다. 실제 자료 보호는 Supabase 로그인과 RLS(본인 데이터만 접근)가 담당합니다.

## [ ] 24단계: 주간 회무 리포트 (Q)

```
24단계:
1) 홈 화면 최상단 '이번 주 회무' 카드: invoke action:'weekly_report' → 서버가 이번 주 리포트가 있으면 그대로 반환(추가 비용 0), 없을 때만 생성.
   마크다운 렌더, [다시 생성](force:true, 확인창) 버튼.
2) 앱을 처음 여는 시점에 자동 호출(별도 예약 작업 없음 → 서버 비용 0).
3) [지난 리포트] 목록: weekly_reports 최신순.
```

## [ ] 25단계: 예상 질문·답변 리허설 (P)

```
25단계: 회의 화면에 [🎤 리허설].
1) 역할 선택: '질의자(대의원)' / '답변자(운영위원)', 주제 입력(선택), 회의 선택(안건 제목 자동 반영).
   invoke action:'rehearsal', { role, meeting_id, org, focus } → items[{question, answer}] (서버가 rehearsals 테이블에 저장)
2) 연습 화면: 질문 카드만 먼저 보이고 [답 보기]로 모범 답변 펼침, practiced 체크, 끌어서 순서.
3) 내가 쓴 답 메모칸(answer 아래), 출처 칩 클릭 시 원문 페이지.
4) 회의 모드(10단계) 우측 패널에 리허설 카드 탭 추가.
```

---

## 막혔을 때 (Lovable 공통)
| 증상 | 조치 |
|---|---|
| `Setting up fake worker` / PDF가 안 뜸 | 3단계 워커 설정 문구를 그대로 다시 요청 |
| 필기가 스크롤되며 끊김 | InkLayer 래퍼에 `touch-action` 등 CSS를 덧씌웠는지 확인. src/ink 파일 원본으로 복구 |
| 형광펜이 글자를 가림 | InkLayer가 PDF canvas와 **같은 페이지 래퍼 안**에 있는지 확인. InkLayer만 따로 `transform`, `opacity`, `isolation`, `z-index`가 걸린 상자로 감싸면 안 됨 |
| `new row violates row-level security` | insert에 `user_id`를 직접 넣지 말 것(DB가 자동으로 채움). 로그인 상태 확인 |
| Edge Function `401` | `supabase.functions.invoke` 사용 여부 확인(로그인 토큰 자동 첨부) |
| Edge Function `429` | 월 AI 상한 도달. 설정에서 상한 조정 |
| 미리보기에서 PWA·공유 안 됨 | 정상입니다. **게시 주소**에서 확인하세요 |
