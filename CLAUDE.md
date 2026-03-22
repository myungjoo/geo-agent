# GEO Agent System

> **Claude Code 도구 규칙**: Read 도구 사용 시 limit을 명시하지 않을 경우 항상 `limit: 4000`을 지정하라.

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
| 테스트 | vitest | 250 tests (agents), 11 files |

## 핵심 설계 제약

- **읽기 전용 원칙**: Target Web Page 직접 수정 불가 → 로컬 클론에서만 작업
- **LLM 필수**: API Key 없으면 파이프라인 실행 거부 (fallback 없음)
- **단일 LLM 경로**: GeoLLMClient → piAiModelFromProvider() → piAiComplete() → pi-ai complete()
- **4-D 사용성 원칙** (ARCHITECTURE.md 4-D):
  - LLM Provider 미동작 시 → 명확한 원인 보고 후 동작 정지 (silent fallback 금지)
  - LLM이 해야 할 판단을 hardcoded 코드로 대체하지 않음
  - **기계적 작업**(파싱, 카운트, 비율 계산)은 코드로, **판단 작업**(품질 평가, 인용 판정, 정확도 평가)은 LLM으로

## GEO 점수 체계 (2-Level 계층)

### Level 1: GEO Score (최종 성과 — LLM 프로브 필요)
- Citation Rate: 25%
- Citation Accuracy: 20%
- Info Recognition: 20%
- Coverage: 15%
- Rank Position: 10%
- Readiness Score: 10% ← Level 2 전체 점수 투입

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

## 코드 구조

```
packages/
  core/src/
    agents/
      analysis/     — analysis-agent, llm-analysis-agent, tools, geo-eval-extractor, rich-analysis-schema
      strategy/     — strategy-agent
      optimization/ — optimization-agent
      validation/   — validation-agent
      probes/       — synthetic-probes (P-01~P-08)
      pipeline/     — pipeline-runner (orchestrator에 모든 agent 등록)
      shared/       — types, llm-helpers, llm-response-schemas
    llm/
      geo-llm-client.ts    — pi-ai 래퍼 (CostTracker, selectProvider)
      pi-ai-bridge.ts      — piAiModelFromProvider, piAiComplete, piAiAgentLoop
      provider-config.ts   — LLM Provider 설정 관리 (llm-providers.json)
      oauth-manager.ts     — Google/Microsoft OAuth
    skills/
      skill-loader.ts      — SKILL.md 파서/로더
      geo-analysis.skill.md — GEO 분석 스킬 프롬프트 (v2, 10-tab)
    db/          — schema, connection, repositories (target, pipeline, stage-execution)
    pipeline/    — state-machine, orchestrator
    clone/       — clone-manager
    report/      — report-generator, archive-builder, dashboard-html-generator
    prompts/     — defaults, template-engine, evaluation-templates
    models/      — Zod schemas (18+ 타입)
  skills/src/    — dual-crawl, geo-scorer (7차원 S1-S7)
  dashboard/src/ — Hono server, routes (targets, settings, pipeline), UI (SPA)
  cli/src/       — Commander.js CLI
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

## 주요 인터페이스

- `LLMRequest` / `LLMResponse` — 모든 에이전트가 사용하는 LLM 호출 인터페이스
- `chatLLM: (req: LLMRequest) => Promise<LLMResponse>` — DI로 주입
- `trackedChatLLM` — pipeline-runner에서 모든 LLM 호출 인터셉트 (모델/토큰/에러 추적)
- `safeLLMCall()` — LLM 필수, 1회 retry 후 throw (4-D: fallback 없음, chatLLM undefined 시 즉시 throw)
- `RichAnalysisReport` — 10-tab 대시보드 보고서 (LLM agent loop 출력)

## GEO 점수 체계

**GEO Score 가중치**: Citation Rate 25%, Citation Accuracy 20%, Info Recognition 20%, Coverage 15%, Rank Position 10%, Structured Score 10%

**7차원 채점 (geo-scorer.ts)**: S1 크롤링 15%, S2 구조화 데이터 25%, S3 기계가독성 20%, S4 팩트 밀도 10%, S5 브랜드 메시지 10%, S6 AI 인프라 10%, S7 네비게이션 10%

## 4-D 원칙 적용 현황

### LLM 판정으로 전환 완료 (코드 → LLM)
| 함수 | 이전 (hardcoded) | 이후 (LLM) |
|------|-----------------|------------|
| `safeLLMCall()` | non-auth 에러 시 fallback 반환 | 1회 retry 후 throw, chatLLM undefined 시 즉시 throw |
| `checkCitation()` | 도메인/사이트명 문자열 매칭 | LLM이 인용 여부 판정 (간접 인용, 의역 탐지) |
| `estimateAccuracy()` | 가중치 공식 (cited 30%, topic 30%, ...) | LLM이 ProbeContext 대비 정확도 0~1 판정 |
| `extractMarketingClaims()` | regex 패턴 ("world's best", "#1") | LLM이 텍스트에서 마케팅 주장 추출 |
| Findings 생성 | 규칙 기반 (JSON-LD 있으면 strength 등) | LLM이 수집 데이터 종합 분석하여 생성 |
| `readability_level` | 평균 단어 길이 기반 | LLM이 텍스트 발췌로 가독성 판정 |
| `ContentQualityAssessment` | chatLLM optional, 없으면 skip | chatLLM 필수, 없으면 파이프라인 중단 |
| Schema quality 판정 | coverage 비율 임계값 | LLM이 JSON-LD snippet 기반 품질 평가 |
| JS LLM 접근 방해 판정 | (없었음) | LLM이 JS 메트릭 + 정적 HTML로 판정 |
| 프레임워크 감지 | `html.includes("react")` 전체 검색 | LLM이 script 태그 증거 기반 판정 + heuristic fallback 개선 |

### Hardcoded 유지 (기계적 작업)
- `parseRobotsTxt()` — 표준 규격 기반 파싱
- `extractSchemaCoverage()` 존재 확인 — JSON-LD 파싱
- `computeJsDependencyRatio()` — script 카운트/비율 계산
- `analyzeJsDependency()` 메트릭 수집 — script 태그, 텍스트 비율
- `computeContentAnalysis()` 수치 — word_count, content_density

---

## 다음 할 일

### Analysis Agent 미구현 항목 (ARCHITECTURE.md 4.2 참조)

| # | 항목 | 심각도 | 현재 상태 | 관련 코드 |
|---|------|--------|-----------|----------|
| A-0 | **멀티 프로바이더 Web Search 프로브** | 높음 | 미구현. 현재 단일 chatLLM만 사용, 웹 검색 비활성 | `probes/synthetic-probes.ts` (runProbes), `llm/geo-llm-client.ts` |
| A-1 | **Explicit 페이지 제공 LLM 추출 테스트** | 높음 | 미구현. 현재 Probes는 브랜드명 기반만 | `probes/synthetic-probes.ts`, `shared/llm-helpers.ts` (buildPageContext) |
| A-2 | **사이트 종류별 Probe 프롬프트** | 중간 | 모든 site_type에 동일 8개 프로브 | `probes/synthetic-probes.ts` (PROBE_DEFINITIONS) |
| A-3 | **Probe 프롬프트 사용자 커스터마이징** | 중간 | 하드코딩. Dashboard 편집/Reset UI 없음 | `llm/provider-config.ts` (패턴 참조) |
| A-4 | **경쟁사 격차 분석** | 중간 | `competitor_gaps: []` 빈 배열 | `analysis/analysis-agent.ts` |
| A-5 | **InfoRecognitionItem 자동 추출** | 중간 | `extracted_info_items: []` 빈 배열 | `analysis/geo-eval-extractor.ts` (extractProductInfo) |
| A-6 | **citation_excerpt, citation_position** | 낮음 | LLMProbe에 미포함 | `probes/synthetic-probes.ts` |
| A-7 | **Machine Readability Grade 종합 판정** | 낮음 | overall_score 기반 (JS+시맨틱+크롤러 미종합). 4-D 원칙: 정적 수집은 코드, 최종 등급 판정은 LLM | `analysis/analysis-agent.ts` |
| A-8 | **StructureQuality 필드 보완** | 낮음 | avg_div_depth, has_main_landmark 누락 | `analysis/analysis-agent.ts` |
| A-9 | **AI 봇 목록 동기화** | 낮음 | Bytespider, cohere-ai 누락 | `analysis/geo-eval-extractor.ts` |
| A-10 | **멀티 페이지 크롤링 최대 30페이지** | 낮음 | 현재 20페이지 | `skills/src/dual-crawl.ts` |

**A-0 구현 방향**: `runProbes()`가 모든 활성 프로바이더에 병렬 실행. 각 프로바이더별 웹 검색 활성화 (OpenAI: web_search tool, Perplexity: 기본, Gemini: google_search_retrieval, Claude: web_search tool). 결과를 `llm_priorities` 가중치로 합산하여 Coverage + 종합 점수 산출
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

## Known Issues (해결됨)

모든 Known Issues (KI-001~KI-004)는 해결되었습니다. 상세 내역은 git history 참조.
