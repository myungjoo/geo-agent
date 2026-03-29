# GEO Agent System

> **Claude Code 도구 규칙**: Read 도구 사용 시 limit을 명시하지 않을 경우 항상 `limit: 4000`을 지정하라.

## 빌드 산출물 및 .gitignore 규칙

### 절대 생성/커밋하지 말 것

아래 패턴의 파일은 TypeScript 빌드 산출물이다. 소스 코드와 같은 디렉토리(`src/`)에 있더라도 **절대 새로 생성하거나 `git add`하지 말 것**.

| 패턴 | 설명 |
|------|------|
| `*.js` (src/ 내) | TypeScript 컴파일 결과. **소스는 반드시 `.ts`로만 작성** |
| `*.js.map` | JavaScript source map |
| `*.d.ts` (src/ 내) | TypeScript 선언 파일 (컴파일러가 생성) |
| `*.d.ts.map` | 선언 파일 source map |
| `*.tsbuildinfo` | TypeScript 증분 빌드 캐시 |
| `dist/` | 빌드 출력 디렉토리 |
| `coverage/` | 테스트 커버리지 리포트 |
| `node_modules/` | 의존성 |
| `run/` | 실행 테스트 환경 격리 디렉토리 |
| `*.db`, `*.sqlite` | 런타임 데이터베이스 파일 |

### 새 파일 작성 시 체크리스트

1. **소스 코드는 `.ts` 확장자만 사용** — `.js` 파일을 `src/` 내에 직접 작성하지 않는다
2. **`git add` 전 `git status`로 빌드 산출물 포함 여부 확인** — `.js`, `.d.ts`, `.map` 파일이 staging에 포함되면 제거
3. **`git add`는 파일명을 명시** — `git add .`이나 `git add -A` 사용 금지
4. **새 설정/데이터 파일 생성 시 `.gitignore` 패턴에 해당하는지 확인**

### 허용되는 예외

- `drizzle.config.ts` → 빌드 산출물인 `drizzle.config.js`가 존재하나, 이는 레거시 (향후 정리 예정)
- `drizzle/` 디렉토리 — 마이그레이션 SQL 및 메타데이터 (소스로 취급)

## 프로젝트 개요

**GEO (Generative Engine Optimization)** Agent System: LLM 서비스(ChatGPT, Claude, Gemini, Perplexity 등)가 Target Web Page의 데이터를 우선적으로, 정확하게 참조하도록 콘텐츠를 최적화하는 에이전트 시스템.

## 기술 스택

| 항목 | 결정 | 비고 |
|---|---|---|
| 언어 | TypeScript (Node.js 20+) | 전체 시스템 |
| 모노레포 | npm workspaces | 4개 패키지 (core, skills, cli, dashboard) |
| LLM 엔진 | @mariozechner/pi-ai | 유일한 LLM 호출 경로. 멀티 프로바이더 통합 |
| 스킬 시스템 | openclaw 호환 SKILL.md | 프롬프트 기반 스킬 정의 |
| 스키마 검증 | Zod + TypeBox (@sinclair/typebox via pi-ai) | 데이터 타입 + Tool 파라미터 |
| DB | libSQL + drizzle-orm | Repository 패턴. v2에서 PostgreSQL 마이그레이션 예정 |
| 백엔드 API | Hono (localhost:3000) | |
| CLI | Commander.js | `geo start/stop/status/init/analyze/run` |
| 코드 품질 | Biome (lint/format) | 탭 들여쓰기, 더블 쿼트, 세미콜론 |
| 테스트 | vitest | |

## 핵심 설계 제약

- **읽기 전용 원칙**: Target Web Page 직접 수정 불가 → 로컬 클론에서만 작업
- **LLM 필수**: API Key 없으면 파이프라인 실행 거부 (fallback 없음)
- **단일 LLM 경로**: GeoLLMClient → piAiModelFromProvider() → piAiComplete() → pi-ai complete()
- **4-D 사용성 원칙** (ARCHITECTURE.md 4-D):
  - LLM Provider 미동작 시 → 명확한 원인 보고 후 동작 정지 (silent fallback 금지)
  - LLM이 해야 할 판단을 hardcoded 코드로 대체하지 않음
  - **기계적 작업**(파싱, 카운트, 비율 계산)은 코드로, **판단 작업**(품질 평가, 인용 판정, 정확도 평가)은 LLM으로
  - 에러·경고·제한사항은 사용자에게 투명하게 전달 (에러를 숨기거나 빈 결과를 정상으로 반환 금지)

## UI-실행 데이터 일치 원칙 (Single Source of Truth)

Dashboard나 CLI가 사용자에게 **표시하는 데이터**는, 실제 파이프라인이 **실행에 사용하는 코드**와 반드시 **같은 출처(single source)**에서 읽어야 한다.

### 금지 패턴

| 위반 | 설명 | 예시 |
|------|------|------|
| **표시용 사본** | 실행 코드와 별도로 "보여주기용" 데이터를 유지하는 것 | API가 `defaults.ts`를 반환하지만 에이전트는 인라인 프롬프트 사용 |
| **Placeholder UI** | 미구현 기능을 "준비된 것처럼" 보이게 하는 하드코딩된 값 | 빈 배열을 정상 결과처럼 표시, 스텁 프롬프트 편집 UI |
| **Dead 설정** | UI에서 편집 가능하지만 실제 실행 경로에 연결되지 않은 설정 | 편집 모달이 있지만 저장 값을 아무 에이전트도 읽지 않음 |

### 준수 방법

1. **API 반환 데이터 → 실행 코드에서 직접 import** — 동일 상수/함수를 공유하거나, 실행 코드가 export한 것을 API가 import
2. **미구현 기능 → 숨기거나 "미구현" 명시** — 빈 결과를 정상으로 반환하지 않음 (4-D 원칙과 동일)
3. **읽기 전용인 경우 → UI에 명확히 표시** — 편집 불가한 데이터에 편집 UI를 제공하지 않음
4. **새 대시보드 탭/API 추가 시 → 아래 PR 체크리스트 필수 적용**

## GEO 점수 체계 (2-Level 계층)

### Level 1: GEO Score (최종 성과 — LLM 프로브 필요)
- Citation Rate: 25%
- Citation Accuracy: 20%
- Info Recognition: 20%
- Coverage: 15%
- Rank Position: 10%
- Structured Score: 10% ← Level 2 전체 점수 (S1~S7 가중 합산) 투입

### Level 2: GEO Readiness Score (사이트 준비도 — 정적 분석, API 불필요)
- S1 LLM 크롤링 접근성: 15%
- S2 구조화 데이터 품질: 25%
- S3 콘텐츠 기계가독성: 20%
- S4 콘텐츠 팩트 밀도: 10%
- S5 브랜드/조직 메시지: 10%
- S6 AI 친화적 인프라: 10%
- S7 콘텐츠 탐색 구조: 10%

> API Key 없으면 Level 2만 산출 (현재 동작). API Key 있으면 Level 1이 권위 점수.

## 파이프라인

```
INIT → ANALYZING → CLONING → STRATEGIZING → OPTIMIZING → VALIDATING → REPORTING → COMPLETED
                                   ↑                          │
                                   └── 목표 미달 ─────────────┘
```

## LLM 호출 흐름

```
Dashboard LLM Providers 설정 → llm-providers.json
    ↓
GeoLLMClient.chat(request) → selectProvider() → piAiModelFromProvider() → piAiComplete()
    ↓                                                                        ↓
pi-ai complete(model, context, options)  ← json_mode: onPayload 콜백 주입
    ↓
OpenAI (chat/completions 또는 responses) / Anthropic / Google / Azure / Perplexity
```

**Agent Loop** (LLM-driven analysis):
```
SKILL.md 프롬프트 → piAiAgentLoop() → [LLM → tool calls → handlers → results]* → final JSON
                                        9개 도구: crawl_page, crawl_multiple_pages, score_geo,
                                        classify_site, extract_evaluation_data, run_synthetic_probes,
                                        analyze_brand_message, analyze_product_recognition, collect_evidence
```

## 다음 할 일

### Analysis Agent 미구현 항목 (ARCHITECTURE.md 4.2 참조)

| # | 항목 | 심각도 | 현재 상태 | 관련 코드 |
|---|------|--------|-----------|----------|
| A-0 | **멀티 프로바이더 Web Search 프로브** | 높음 | 부분 구현. Multi 모드 병렬 실행 + 3-레이어 비교 + Dashboard UI 완료. **미완료**: 프로바이더별 web_search tool 활성화 | `probes/multi-provider-probes.ts`, `pipeline/pipeline-runner.ts` |
| A-1 | **Explicit 페이지 제공 LLM 추출 테스트** | 높음 | 미구현. 현재 Probes는 브랜드명 기반만 | `probes/synthetic-probes.ts`, `shared/llm-helpers.ts` (buildPageContext) |
| A-2 | **사이트 종류별 Probe 프롬프트** | 중간 | 모든 site_type에 동일 8개 프로브 | `probes/synthetic-probes.ts` (PROBE_DEFINITIONS) |
| A-3 | **Probe 프롬프트 사용자 커스터마이징** | 중간 | 하드코딩. Dashboard 편집/Reset UI 없음 | `llm/provider-config.ts` (패턴 참조) |
| A-4 | **경쟁사 격차 분석** | 중간 | `competitor_gaps: []` 빈 배열 | `analysis/analysis-agent.ts` |
| A-5 | **InfoRecognitionItem 자동 추출** | 중간 | `extracted_info_items: []` 빈 배열 | `analysis/geo-eval-extractor.ts` (extractProductInfo) |
| A-6 | **citation_excerpt, citation_position** | 낮음 | LLMProbe에 미포함 | `probes/synthetic-probes.ts` |
| A-7 | **Machine Readability Grade 종합 판정** | 낮음 | overall_score 기반 (JS+시맨틱+크롤러 미종합). 4-D 원칙: 정적 수집은 코드, 최종 등급 판정은 LLM | `analysis/analysis-agent.ts` |
| A-8 | **StructureQuality 필드 보완** | 낮음 | has_main_landmark 미구현 | `analysis/analysis-agent.ts` |
| A-9 | **AI 봇 목록 동기화** | 낮음 | Bytespider, cohere-ai 누락 | `analysis/geo-eval-extractor.ts` |
| A-10 | ~~멀티 페이지 크롤링 최대 30페이지~~ | 낮음 | 해결됨. `maxPages = 30` 적용 완료 | `skills/src/dual-crawl.ts` |

**A-0 남은 항목**: 프로바이더별 웹 검색 활성화 (OpenAI: web_search tool, Perplexity: 기본, Gemini: google_search_retrieval, Claude: web_search tool), `llm_priorities` 가중치 기반 합산 (현재 균등 평균)
**A-1 구현 방향**: `buildPageContext()`로 페이지 요약 → LLM context로 제공 → "이 페이지에서 X를 추출하세요" 형태 프로브
**A-2 구현 방향**: site_type별 `PROBE_DEFINITIONS` 맵 (manufacturer: 스펙/가격, research: 논문/결과, generic: 서비스/정보)
**A-3 구현 방향**: `ProviderConfigManager` 패턴으로 프로브 정의를 JSON 파일 저장 + Dashboard 편집/리셋 API
**A-4 구현 방향**: 경쟁사 URL 크롤 + 정적 채점(7차원)은 코드로, 격차 분석/전략적 해석은 LLM이 수행 (4-D 원칙)
**A-5 구현 방향**: `extractProductInfo()` 정적 추출은 코드로, LLM 인식 가능 여부(full/partial/none) 판정은 LLM이 수행 (4-D 원칙) + Dashboard 검토 UI

### 기타 미구현

- **Monitoring Agent** — 주기적 GEO 추적 + 이상 감지 (ARCHITECTURE.md 4.6)
- **Agent Memory** — EffectivenessIndex 쿼리, 유사 사례 검색 (ARCHITECTURE.md 7)
- **OAuth 콜백 API** — `/api/auth/callback` 엔드포인트 + Dashboard OAuth UI
- **pi-agent-core 적용 검토** — 도구 병렬 실행, Streaming, Abort/Cancel, Steering (현재 자체 piAiAgentLoop 사용 중)

### 개선 로드맵 요약

상세 내용은 GitHub Issue #4 + ARCHITECTURE.md 참조.

- **Probe 이중 트랙**: 정적 추출 가능성(Track A) + LLM 인용 확인(Track B) + RAG 시뮬레이션(Track C)
- **멀티사이트 비교**: 동시 N개 사이트 평가 + 비교 대시보드
- **실행 간 Diff**: 별도 pipeline 실행 간 점수/스키마/프로브 비교
- **LLM 프롬프트 품질**: Few-shot 예시, JSON mode 통일, 시스템 프롬프트 연결
- **Orchestrator 고도화**: 스테이지별 타임아웃, 모델 폴백, 토큰 예산 관리

## CI/CD LLM Integration

- **GitHub Secrets**: `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`
- **환경변수 Fallback**: `ProviderConfigManager.loadAll()`가 자동 감지 (파일 설정 우선)
- **`npm run test:llm`**: LLM 통합 테스트 (env var 없으면 skip)
- **CI llm-integration job**: schedule / workflow_dispatch / main push에서만 실행 (비용 절약)
- 지원 환경변수: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`, `PERPLEXITY_API_KEY`, `META_API_KEY`

## PR 리뷰 체크리스트

대시보드 UI, API 엔드포인트, 설정 화면을 변경하는 PR에서 반드시 확인할 항목.

### CL-1. 데이터 출처 일치 (Single Source of Truth)

- [ ] 이 PR에서 추가/변경한 API가 반환하는 데이터가, **실제 실행 경로의 코드에서 직접 읽히는가?**
  - 에이전트 프롬프트 → `runtime-prompts.ts` (에이전트 파일에서 export한 상수를 import)
  - LLM Provider 설정 → `ProviderConfigManager` (llm-providers.json)
  - Target 정보 → `TargetRepository` (DB)
- [ ] 실행 코드와 별도인 "표시용 사본" 파일(`defaults.ts` 패턴)을 새로 만들지 않았는가?

### CL-2. Placeholder / Dead Code 방지

- [ ] 미구현 기능을 "준비된 것처럼" 보이게 하는 하드코딩된 값(빈 배열, 스텁 JSON, 가짜 점수)이 UI에 노출되지 않는가?
- [ ] UI에서 편집(Edit/Save/Reset) 가능한 설정이 있다면, 해당 저장값을 **실제로 읽는 실행 코드**가 존재하는가?
- [ ] 미구현 기능이라면 "Coming soon" 또는 탭 자체를 숨기는 방식으로 처리했는가?

### CL-3. 읽기 전용 정합성

- [ ] 읽기 전용 데이터에 편집 UI(Edit 버튼, Save 버튼, textarea)가 붙어있지 않은가?
- [ ] 읽기 전용임이 사용자에게 **시각적으로 명확히** 전달되는가? (배지, 안내 텍스트 등)

### CL-4. API-UI 스키마 정합

- [ ] API 응답의 필드명/구조가 변경되었을 때, 프론트엔드가 이전 필드명을 참조하고 있지 않은가?
- [ ] API가 반환하는 데이터로 UI가 에러 없이 렌더링되는지 브라우저에서 확인했는가?
