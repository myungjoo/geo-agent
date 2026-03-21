# GEO Agent System — 작업 기록 및 지침

> **Claude Code 도구 규칙**: Read 도구 사용 시 limit을 명시하지 않을 경우 항상 `limit: 4000`을 지정하라.

## 프로젝트 개요

**GEO (Generative Engine Optimization)** Agent System: LLM 서비스(ChatGPT, Claude, Gemini, Perplexity 등)가 Target Web Page의 데이터를 우선적으로, 정확하게 참조하도록 콘텐츠를 최적화하는 에이전트 시스템.

## 기술 스택 결정사항

| 항목 | 결정 | 비고 |
|---|---|---|
| 언어 | TypeScript (Node.js 20+) | 전체 시스템 |
| 모노레포 | npm workspaces | 4개 패키지 (core, skills, cli, dashboard) |
| 에이전트 엔진 | pi-mono (github.com/badlogic/pi-mono) | 버전 고정, upstream 비추적 |
| 스킬 시스템 | openclaw 호환 3-tier (Bundled/Managed/Workspace) | |
| 스키마 검증 | Zod schemas → TypeScript 타입 추론 | 모든 데이터 타입 |
| DB (v1) | libSQL (@libsql/client) + drizzle-orm | Repository 패턴, 네이티브 컴파일 불필요 (Windows 호환) |
| DB (v2+) | PostgreSQL 마이그레이션 예정 | |
| 백엔드 API | Hono (localhost:3000) | |
| CLI | Commander.js | `geo start/stop/status/init` |
| 코드 품질 | Biome (lint/format) | 탭 들여쓰기, 더블 쿼트, 세미콜론 |
| 테스트 | vitest | |
| 기본 LLM | GPT-4o (OpenAI) | 대시보드에서 변경 가능 |
| LLM 인증 | API Key + OAuth 모두 지원 | OpenAI/Anthropic/Google/Perplexity/Microsoft/Meta |

## GEO 점수 가중치 (확정)

- Citation Rate: 25%
- Citation Accuracy: 20%
- Info Recognition: 20%
- Coverage: 15%
- Rank Position: 10%
- Structured Score: 10%

## 파이프라인 상태 머신

```
INIT → ANALYZING → CLONING → STRATEGIZING → OPTIMIZING → VALIDATING → REPORTING → COMPLETED
                                   ↑                          │
                                   └── 목표 미달 ─────────────┘
                                                    FAILED / PARTIAL_FAILURE
```

## 읽기 전용 원칙 (핵심 설계 제약)

- Target Web Page에 대한 직접 수정 권한 없음
- 초기 분석만 원본 URL 크롤링 → 이후 로컬 클론에서만 작업
- 최적화 루프는 클론 대상으로만 수행
- 최종 결과: Before-After 비교 리포트 + 수정된 Archive 파일 제공
- 사용자가 수동으로 원본 사이트에 반영

## 완료된 작업

### Phase 0: 아키텍처 설계
- [x] ARCHITECTURE.md 작성 (2500+ 줄)
- [x] P0 버그 5건 수정 (섹션 번호, Python 잔재, CLI 정합성, 타입 표기)
- [x] P1 항목 모두 완료:
  - 4-C: 12+ 핵심 데이터 타입 정의
  - 4-A: 6개 에이전트 시스템 프롬프트 + 편집 UI
  - 9-A: 에러 핸들링 (재시도, 타임아웃, 롤백)
  - 9-B: LLM 추상화 (GPT-4o 기본, 멀티 프로바이더, API Key + OAuth)
  - 9-C: 클론 워크플로우 & 결과 전달 (Clone Manager + Report/Archive)
  - 9-D: SQLite 스키마 (7 테이블)

### Phase 1: 코드 구현 ✅

#### 모노레포 기반 설정 ✅
- root: package.json, tsconfig.json, biome.json
- packages/core: package.json, tsconfig.json
- packages/skills: package.json, tsconfig.json
- packages/dashboard: package.json, tsconfig.json
- packages/cli: package.json, tsconfig.json

#### Zod 스키마 모델 (packages/core/src/models/) ✅
- change-type.ts — ChangeType enum (10종)
- info-recognition.ts — InfoCategory, AccuracyLevel, InfoRecognitionPerLLM/Item/Score
- llm-probe.ts — QueryType, LLMProbe
- geo-score.ts — GeoScorePerLLM, GeoScore, GEO_SCORE_WEIGHTS
- target-profile.ts — CompetitorEntry, LLMPriority, TargetProfile (clone_base_path, site_type), Create/Update
- content-snapshot.ts — ContentSnapshot
- change-record.ts — ChangeRecord
- change-impact.ts — Verdict, ChangeImpact
- geo-time-series.ts — GeoTimeSeries
- analysis-report.ts — StructureQuality, CrawlerAccessResult, MachineReadability, ContentAnalysis, StructuredDataAudit, CompetitorGap, AnalysisReport
- optimization-plan.ts — OptimizationTask, OptimizationPlan
- validation-report.ts — ValidationLLMResult, ValidationReport
- effectiveness-index.ts — EffectivenessIndex
- semantic-change-record.ts — SemanticChangeRecord
- agent-prompt-config.ts — AgentId, ContextSlot, AgentPromptConfig
- error-event.ts — ErrorType, Severity, ErrorEvent
- llm-provider-config.ts — OAuthConfig, LLMAuthConfig, ModelRole, LLMModelConfig, LLMProviderConfig
- pipeline-state.ts — PipelineStage, PipelineState, RetryPolicy
- index.ts — barrel export

#### 코어 인프라 (packages/core/src/) ✅
- logger.ts — pino 기반 구조화 로깅
- config/settings.ts — AppSettings (workspace, DB path, port, 기본 모델) + GEO_WORKSPACE 환경변수 지원
- db/schema.ts — drizzle SQLite 테이블 7개 (targets, content_snapshots, change_records, change_impacts, geo_time_series, pipeline_runs, error_events)
- db/connection.ts — SQLite + drizzle 연결 (WAL mode) + 자동 테이블 생성 (ensureTables)
- db/repositories/target-repository.ts — CRUD Repository (JSON 직렬화 수정, 기본 알림 설정, delete 존재 여부 확인)
- prompts/defaults.ts — 6개 에이전트 기본 시스템 프롬프트
- prompts/prompt-loader.ts — load/save/reset + slot injection
- index.ts — 패키지 entry point

#### 대시보드 (packages/dashboard/src/) ✅
- server.ts — Hono 서버 (CORS, trimTrailingSlash, onError JSON 400, EADDRINUSE 처리)
- routes/targets.ts — Target CRUD REST API (initTargetsRouter로 공유 DB 주입)
- routes/settings.ts — Agent Prompt 관리 REST API

#### CLI (packages/cli/src/) ✅
- index.ts — `geo start/stop/status/init` 명령어

#### Skills (packages/skills/src/) ✅
- index.ts — SkillRegistry 인터페이스 + 기본 구현

### Phase 1.5: 빌드 수정, 버그 수정, 테스트 ✅

#### 빌드 수정 사항
- drizzle-orm `^0.35.0`, drizzle-kit `^0.25.0`
- pino-pretty devDependencies (graceful fallback — 없으면 plain JSON 로그)
- core/dashboard package.json exports 필드 추가
- better-sqlite3 완전 제거 (Phase 3.5에서 @libsql/client in-memory로 전환)

#### 발견 & 수정된 버그 9건

| # | 심각도 | 버그 | 수정 내용 |
|---|--------|------|-----------|
| 1 | P0 | JSON 이중 직렬화 (topics/competitors 등이 문자열로 반환) | JSON.stringify 제거, drizzle mode:"json"이 직렬화 처리 |
| 2 | P0 | notifications 미지정 시 null 반환 | DEFAULT_NOTIFICATIONS 객체로 폴백 |
| 3 | P0 | EADDRINUSE 시 프로세스 크래시 | server.on("error") + Promise reject 처리 |
| 4 | P0 | 잘못된 JSON body → 500 응답 | app.onError()에서 SyntaxError 캐치 → 400 |
| 5 | P0 | DB 테이블 자동 생성 안됨 | ensureTables() — CREATE TABLE IF NOT EXISTS 7개 |
| 6 | P1 | DELETE 존재하지 않는 대상에 200 반환 | findById 선확인 → false 반환 → 라우트에서 404 |
| 7 | P1 | 요청마다 새 DB 연결 생성 | initTargetsRouter(db) — 서버 시작 시 공유 DB 주입 |
| 8 | P1 | drizzle.config.ts 상대 경로 문제 | import.meta.url + path.resolve 절대 경로 |
| 9 | P1 | 후행 슬래시 /api/targets/ → 404 | trimTrailingSlash() 미들웨어 추가 → 301 리다이렉트 |

#### 테스트 (vitest) — 744 tests, 16 files ✅
- packages/core/src/models/models.test.ts — 304 tests (18개 Zod 스키마 전체)
- packages/core/src/models/__tests__/schema-validation.test.ts — 15 tests
- packages/core/src/config/settings.test.ts — 15 tests
- packages/core/src/db/connection.test.ts — 13 tests (WAL, FK, 자동 테이블 생성)
- packages/core/src/db/repositories/target-repository.test.ts — 32 tests
- packages/core/src/prompts/prompt-loader.test.ts — 33 tests
- packages/core/src/prompts/evaluation-templates/evaluation-templates.test.ts — 89 tests
- packages/core/src/bugs.test.ts — 12 tests (버그 회귀 테스트 + 5 skipped)
- packages/core/src/pipeline/state-machine.test.ts — 62 tests (신규)
- packages/core/src/clone/clone-manager.test.ts — 32 tests (신규)
- packages/core/src/report/report-generator.test.ts — 28 tests (신규)
- packages/core/src/llm/provider-config.test.ts — 30 tests (신규)
- packages/dashboard/src/routes/targets.test.ts — 47 tests
- packages/dashboard/src/routes/settings.test.ts — 22 tests
- packages/dashboard/src/server.test.ts — 1 test (EADDRINUSE)
- packages/skills/src/skills.test.ts — 10 tests (업데이트)

#### Smoke Test 통과 항목
- GET / — 서비스 정보 반환
- GET /health — ok + timestamp
- POST /api/targets — 전체 필드 생성, JSON 필드 정확한 타입 유지
- GET /api/targets/:id — 조회, JSON 필드 배열/객체 유지
- PUT /api/targets/:id — 부분 업데이트, updated_at 변경
- DELETE /api/targets/:id — 정상 삭제 200, 없는 대상 404
- POST 잘못된 JSON → 400
- 후행 슬래시 → 301 리다이렉트
- 기본 알림 설정 적용 확인
- GET /api/settings/agents/prompts — 6개 에이전트 프롬프트

### Phase 2: 평가 프롬프트 템플릿 시스템 설계 ✅

#### 평가 템플릿 3종 작성 ✅
- packages/core/src/prompts/evaluation-templates/manufacturer.md — 제조사 대표 Site (samsung.com 등)
- packages/core/src/prompts/evaluation-templates/research.md — 연구소 대표 Site (research.samsung.com 등)
- packages/core/src/prompts/evaluation-templates/generic.md — 기타 Site (뉴스, 교육, 서비스 등)

#### 템플릿 레지스트리 (TypeScript) ✅
- packages/core/src/prompts/evaluation-templates/index.ts
  - SiteType enum + SITE_TYPE_LABELS
  - ClassificationSignal 스키마 + CLASSIFICATION_SIGNALS (자동 분류 시그널)
  - ScoringDimension 스키마 + DEFAULT_SCORING_DIMENSIONS (유형별 7차원)
  - ProbeResult / EvaluationResult / CycleControl Zod 스키마
  - shouldStopCycle() — Cycle 자동 중단 판정 함수
  - TEMPLATE_REGISTRY — 유형별 템플릿 등록
  - calculateGrade() / calculateOverallScore() — 등급/점수 산출

#### ARCHITECTURE.md 섹션 9-E 추가 ✅
- 9-E.1 개요: 템플릿 시스템 구조
- 9-E.2 사이트 유형 분류: 자동 분류 시그널 + 수동 분류
- 9-E.3 평가 템플릿 구조: 공통 프레임워크 + 유형별 차별화
- 9-E.4 Cycle 제어: 자동 중단 조건 3종 + 수동 중단 + API 엔드포인트
- 9-E.5 Interactive Dashboard 출력 사양: 10탭, 다크 테마, Chart.js, 파일명 규칙

#### 핵심 설계 결정사항
- 가중치는 모든 유형 동일 (15/25/20/10/10/10/10) — 차원 이름과 프로브 내용만 유형별 차별화
- Phase 1~8 구조 동일 — Phase 2(콘텐츠 분석)와 Phase 4(프로브)만 유형별 내용 상이
- 자동 분류: Phase 1 크롤링 후 시그널 기반 판정 (confidence 포함)
- Cycle 중단: score_sufficient(≥80) / no_more_improvements(<2점) / max_cycles(10) / manual_stop
- Dashboard: 초기/중간/최종 결과 동일 HTML 포맷, 10번째 탭(사이클 이력)은 Cycle≥1 시에만 표시

### Phase 3: MVP 핵심 인프라 구현 ✅

#### TargetProfile 스키마 업데이트 ✅
- deployment_mode / deployment_config 제거 (읽기 전용 원칙)
- clone_base_path: string | null 추가 (로컬 클론 경로)
- site_type: SiteType 추가 (manufacturer/research/generic, 기본값 generic)
- DB 스키마, Repository, 기존 테스트 전체 동기화

#### Pipeline 인프라 ✅
- packages/core/src/pipeline/state-machine.ts — PipelineStateMachine 클래스
  - INIT → ANALYZING → CLONING → STRATEGIZING → OPTIMIZING → VALIDATING → REPORTING → COMPLETED
  - VALIDATING → STRATEGIZING 루프백, 모든 스테이지에서 FAILED 전이 가능
  - fail(), incrementRetry(), set*Ref(), fromState(), isTerminal(), getAllowedTransitions()
- packages/core/src/db/repositories/pipeline-repository.ts — PipelineRepository CRUD

#### Clone Manager ✅
- packages/core/src/clone/clone-manager.ts — CloneManager 클래스
  - createClone(): 원본 HTML + 추가 파일을 original/ + working/ 에 저장
  - readOriginalFile(), readWorkingFile(), writeWorkingFile()
  - listWorkingFiles(), getDiff(), incrementCycle()
  - archiveClone(), deleteClone()
  - CloneMetadataSchema (Zod)

#### Report & Archive 생성기 ✅
- packages/core/src/report/report-generator.ts — ReportBuilder, renderSimpleDiff
  - OptimizationReportSchema, ChangeEntrySchema, ScoreComparisonSchema
- packages/core/src/report/archive-builder.ts — ArchiveBuilder
  - report.json + original/ + optimized/ + diff/ 구조 패키징
- packages/core/src/report/dashboard-html-generator.ts — Interactive HTML Dashboard 생성
  - Chart.js CDN, 다크 테마, 10탭 (사이클 이력은 cycle≥1 시만)
  - Radar/Bar/Line 차트, 변경사항 목록, 점수 비교 테이블

#### 평가 템플릿 엔진 ✅
- packages/core/src/prompts/template-engine.ts — TemplateEngine + classifySite()
  - loadTemplate(), render() ({{변수}} 치환)
  - classifySite(): HTML+URL 분석 기반 사이트 유형 자동 분류 (confidence 포함)

#### Cycle 제어 API ✅
- packages/dashboard/src/routes/pipeline.ts — Pipeline & Cycle 라우트
  - GET/POST /api/targets/:id/pipeline — 파이프라인 목록/생성
  - GET /api/targets/:id/pipeline/latest — 최신 상태 조회
  - PUT /api/targets/:id/pipeline/:pipelineId/stage — 스테이지 변경
  - POST /api/targets/:id/cycle/stop — 수동 중단
  - GET /api/targets/:id/cycle/status — 현재 사이클 상태

#### LLM Provider 설정 API + 추상화 레이어 ✅
- packages/core/src/llm/provider-config.ts — ProviderConfigManager
  - 6개 프로바이더 (OpenAI/Anthropic/Google/Perplexity/Microsoft/Meta)
  - loadAll(), load(), save(), setEnabled(), getEnabled(), reset(), resetAll()
- packages/core/src/llm/geo-llm-client.ts — GeoLLMClient + CostTracker
  - selectProvider(), chat() (stub — 실제 SDK 연동은 후속)
  - CostTracker: record(), getTotalCost(), getCostByProvider()
- packages/dashboard/src/routes/settings.ts — LLM Provider REST API
  - GET/PUT /api/settings/llm-providers, enable/disable, reset

#### Bundled Skills ✅
- packages/skills/src/index.ts — 확장된 SkillRegistry
  - Skill, SkillExecutionContext, SkillResult 인터페이스
  - registerSkill(), executeSkill() 추가
  - 6개 Bundled Skills: dual-crawl, schema-builder, geo-scorer, content-optimizer, site-classifier, diff-generator

#### 테스트 (vitest) — 744 tests, 16 files ✅ (Phase 3 최종)
- 기존 7파일 업데이트 (deployment_mode → site_type 마이그레이션)
- packages/core/src/pipeline/state-machine.test.ts — 62 tests (신규)
- packages/core/src/clone/clone-manager.test.ts — 32 tests (신규)
- packages/core/src/report/report-generator.test.ts — 28 tests (신규)
- packages/core/src/llm/provider-config.test.ts — 30 tests (신규)
- packages/skills/src/skills.test.ts — 10 tests (업데이트: bundled skills 포함)

### Phase 3.5: CI 인프라 + 이식성 강화 ✅

#### 변경 사항
- better-sqlite3 완전 제거 → @libsql/client in-memory DB로 테스트 전환 (네이티브 컴파일 불필요)
- pino-pretty → devDependencies 이동 + graceful fallback (hasPinoPretty())
- logger.ts: 테스트 환경(VITEST) 감지 → transport 비활성화 + silent 로깅
- connection.ts: createDatabase()에 auto-table 생성 SQL 구현 + ensureTables() 헬퍼
- server.ts: EADDRINUSE Promise reject + trimTrailingSlash + onError 미들웨어 복원
- template-engine.ts: fileURLToPath() 사용 (Windows 경로 호환)
- biome.json: dist/node_modules/drizzle/.claude 제외, noNonNullAssertion off
- .gitignore: *.tsbuildinfo, .claude/settings.local.json 추가
- .nvmrc (Node 20) + .npmrc (engine-strict=true)
- package.json: pretest=build, ci 스크립트

#### GitHub Actions CI ✅
- .github/workflows/ci.yml
- 매 PR (main), daily (KST 09:00), manual trigger
- ubuntu-latest + windows-latest, Node 20 + 22 매트릭스 (4 jobs)
- lint job 별도 실행
- 전체 통과 확인 완료

### Phase 4: MVP 후속 구현 ✅

#### Dashboard 프론트엔드 ✅
- packages/dashboard/src/ui/dashboard.html — 단일 HTML SPA (다크 테마)
  - 4탭 (Targets, Pipelines, Agent Prompts, LLM Providers)
  - Target CRUD, Pipeline 시작/중단, 프롬프트 편집, Provider 토글
  - API 연동, 모달 UI, Toast 알림, Health check
- server.ts 업데이트: GET /dashboard 라우트 추가, HTML 서빙
- package.json: build 스크립트에 HTML 파일 복사 추가
- 테스트: dashboard-ui.test.ts — 13 tests

#### LLM SDK 실제 연동 ✅
- packages/core/src/llm/geo-llm-client.ts — 전면 재작성
  - OpenAI SDK (openai) 실제 연동
  - Anthropic SDK (@anthropic-ai/sdk) 실제 연동
  - Google Generative AI SDK (@google/generative-ai) 실제 연동
  - Perplexity: OpenAI-compatible API 경유
  - 프로바이더별 자동 라우팅 + 비용 추정 (PRICING 테이블)
  - API Key 미설정 시 명확한 에러 메시지
- 테스트: geo-llm-client.test.ts — 25 tests (SDK mock 기반)

#### Orchestrator 실행 엔진 ✅
- packages/core/src/pipeline/orchestrator.ts — Orchestrator 클래스
  - StageHandler 등록 + 순차 실행
  - OrchestratorConfig: maxRetries, timeoutMs, maxCycles
  - Cycle 루프백 (VALIDATING → STRATEGIZING), maxCycles 제한
  - 수동 중단 (stop()), 타임아웃, 에러 핸들링/재시도
  - onStateChange 콜백, 기존 상태 복원(resume)
- 테스트: orchestrator.test.ts — 21 tests

#### Dual Crawl 스킬 ✅
- packages/skills/src/dual-crawl.ts — crawlTarget() 실제 구현
  - HTML 페이지 + robots.txt + llms.txt + sitemap.xml 병렬 수집
  - 순수 파서: extractTitle, extractMetaTags, extractCanonical, extractJsonLd, extractLinks
  - 타임아웃 + User-Agent 설정
- 테스트: dual-crawl.test.ts — 25 tests

#### GEO Scorer 스킬 ✅
- packages/skills/src/geo-scorer.ts — scoreTarget() 실제 구현
  - S1: LLM 크롤링 접근성 (robots.txt, llms.txt, 응답속도, canonical, sitemap)
  - S2: 구조화 데이터 (JSON-LD, OG, Twitter Cards, meta description)
  - S3: 콘텐츠 기계가독성 (H1/H2, 시맨틱 HTML, 리스트/테이블, alt text, 단어수)
  - S4: 팩트 밀도 (숫자, 단위, 스펙테이블, 가격)
  - S5: 브랜드/조직 메시지 (브랜드 스키마, 소셜 링크, 법적 문서)
  - S6: AI 인프라 (llms.txt, AI 메타태그, RSS/Atom 피드)
  - S7: 콘텐츠 네비게이션 (breadcrumb, 내부링크, nav, sitemap, 앵커링크)
  - 차원별 상세 분석 결과 포함
- 테스트: geo-scorer.test.ts — 21 tests

#### OAuth 매니저 ✅
- packages/core/src/llm/oauth-manager.ts — OAuthManager 클래스
  - Google/Microsoft OAuth 2.0 Authorization Code 플로우
  - Credentials 설정/조회, Authorization URL 생성
  - Token 교환, 갱신, 취소, 자동 갱신 (5분 전)
  - 파일 기반 상태 저장 ({workspace}/auth/oauth-state.json)
  - Zod 스키마: OAuthProvider, OAuthCredentials, OAuthToken, OAuthState
- 테스트: oauth-manager.test.ts — 29 tests

#### 테스트 (vitest) — 1182 tests, 33 files ✅ (Phase 5 최종)
- Phase 4까지: 1078 tests, 27 files
- Phase 5 에이전트 테스트 7파일:
  - packages/core/src/agents/analysis-agent.test.ts — 28 tests
  - packages/core/src/agents/strategy-agent.test.ts — 23 tests
  - packages/core/src/agents/optimization-agent.test.ts — 12 tests
  - packages/core/src/agents/validation-agent.test.ts — 15 tests
  - packages/core/src/agents/pipeline-runner.test.ts — 9 tests (E2E)
  - packages/core/src/agents/synthetic-probes.test.ts — 17 tests
- 테스트 보강 5파일 (미테스트 소스 커버리지 확보):
  - packages/core/src/db/repositories/pipeline-repository.test.ts — 45 tests
  - packages/core/src/report/archive-builder.test.ts — 35+ tests
  - packages/core/src/report/dashboard-html-generator.test.ts — 25+ tests
  - packages/core/src/prompts/template-engine.test.ts — 35+ tests
  - packages/dashboard/src/routes/pipeline.test.ts — 30 tests
- 기존 테스트 에지케이스 보강:
  - report-generator.test.ts — CRLF, 공백차이, 대용량, 음수 before, 동일값, 빈 배열 등 10+ tests 추가

### Phase 5: 에이전트 구현 + Synthetic Probes + CLI ✅

#### 4개 Agent 구현 ✅
- packages/core/src/agents/analysis-agent.ts — 크롤링 + 사이트 분류 + GEO 채점 → AnalysisReport
- packages/core/src/agents/strategy-agent.ts — 규칙 기반 OptimizationPlan 생성 (9개 규칙) + LLM 강화 옵션
- packages/core/src/agents/optimization-agent.ts — Clone 파일에 METADATA/SCHEMA_MARKUP/LLMS_TXT/SEMANTIC_STRUCTURE 수정
- packages/core/src/agents/validation-agent.ts — Before-After 비교 + 사이클 제어 (score_sufficient, no_more_improvements, max_cycles)

#### Pipeline Runner (E2E) ✅
- packages/core/src/agents/pipeline-runner.ts — Orchestrator에 4 Agent 등록, 전체 파이프라인 실행
  - ANALYZING → CLONING → STRATEGIZING → OPTIMIZING → VALIDATING → REPORTING → COMPLETED
  - 사이클 루프백 (VALIDATING → STRATEGIZING)
  - Report + Dashboard HTML + Archive 자동 생성

#### Synthetic Probes (P-01~P-08) ✅
- packages/core/src/agents/synthetic-probes.ts — 8종 프로브
  - P-01 제품 스펙 / P-02 가격 / P-03 비교 / P-04 브랜드 / P-05 추천 / P-06 팩트 / P-07 최신 / P-08 문제 해결
  - Citation 감지 (도메인, 사이트명, 브랜드명)
  - Accuracy 추정 (키워드 매칭, 응답 길이)
  - PASS/PARTIAL/FAIL 판정 + Summary 통계

#### Azure OpenAI 지원 ✅
- packages/core/src/llm/geo-llm-client.ts — callAzureOpenAI() 추가
  - api-key 헤더 + deployment 기반 URL
  - microsoft 프로바이더로 라우팅

#### CLI 강화 ✅
- packages/cli/src/index.ts
  - `geo analyze <url>` — 빠른 정적 분석 (7차원 채점 + 바 차트)
  - `geo run <url>` — 전체 파이프라인 실행 (--api-key, --provider, --model 등)
  - `npm start` — Dashboard 서버 시작 (루트 package.json)

#### 버그 수정 ✅
- Dashboard UI: system_prompt → system_instruction 필드명 불일치 수정 (Agent Prompt 빈 표시 버그)

#### samsung.com 실제 테스트 결과
- GEO Score: 71/100 (Needs Improvement)
- 사이트 분류: manufacturer (confidence 0.50)
- Synthetic Probe: Citation Rate 25%, Avg Accuracy 43% (PASS 2, PARTIAL 2, FAIL 4)

### Phase 6: VisualizationSpec 시스템 + Dashboard 고도화 ✅

#### VisualizationSpec 3-계층 시각화 요구사항 시스템 ✅
- packages/core/src/prompts/evaluation-templates/viz-specs/ — 전체 신규 디렉토리
  - viz-spec-schema.ts: Zod 스키마 (SiteSubtype, VizElement 28종, TabSpec, ReferenceSpec, VisualizationSpec)
  - common-tabs.ts: 공통 8탭 + derivation 산출 공식 (LLM 접근성, 페이지별 점수 등)
  - manufacturer-tabs.ts / research-tabs.ts / generic-tabs.ts: 유형별 추가 탭 + 확장
  - references/manufacturer-electronics.ts: samsung.com 참조 스펙 (6개 제품유형별 인식항목, P-01~P-08 커스터마이징, 7개 실증 섹션, 품질 기준)
  - viz-spec-loader.ts: classifySubtype() + loadVisualizationSpec() 3-계층 병합 + validateQualityBar()
  - index.ts: barrel export
- 테스트: viz-spec-loader.test.ts — 51 tests

#### Pipeline 실행 상태 UI — 스테이지별 prompt/result ✅
- DB: stage_executions 테이블 추가 (id, pipeline_id, stage, cycle, status, prompt/result_summary, result_full, error_message, duration_ms)
- packages/core/src/db/repositories/stage-execution-repository.ts — CRUD Repository
- packages/core/src/agents/pipeline-runner.ts: StageCallbacks 인터페이스로 6개 스테이지 계측
- packages/dashboard/src/routes/pipeline.ts:
  - GET stages 엔드포인트 (목록/단건)
  - POST ?execute=true 시 runPipeline() 비동기 실행 (crawlTarget + scoreTarget + classifySite deps 연결)
  - GET /evaluation 엔드포인트 (stage_executions에서 점수 before/after 파싱)
  - cycle/status에 current_prompt, stage_count 추가
  - 이중 실행 방지 (runningPipelines Set)
- packages/dashboard/src/ui/dashboard.html:
  - 5탭 (Targets, Pipelines, Evaluation, Agent Prompts, LLM Providers)
  - Pipelines: 클릭 확장 가능한 카드 (collapsed: 스테이지+prompt 미리보기, expanded: 스테이지별 상세)
  - Re-run 버튼 (COMPLETED/FAILED 파이프라인 재실행)
  - Evaluation 탭: Target 선택 → 점수 게이지, 7차원 진행바, 페이지별 테이블, 스테이지 요약
- 테스트: stage-execution-repository.test.ts — 15 tests, pipeline.test.ts — 37 tests

#### 멀티 페이지 크롤링 ✅
- packages/skills/src/dual-crawl.ts:
  - crawlMultiplePages(): 홈페이지 내부 링크 자동 추출, 제품/카테고리 URL 우선, 최대 20페이지, 동시 5개 병렬
  - urlToFilename(): URL path → 안전한 파일명 변환
- packages/core/src/agents/types.ts: MultiPageCrawlResult, PageScoreResult, MultiPageAnalysisResult 인터페이스
- packages/core/src/agents/analysis-agent.ts:
  - manufacturer 사이트 자동 멀티 페이지 분석
  - 페이지별 점수 + 가중 집계 (홈 2x + 나머지 1x)
  - AnalysisOutput.multi_page, all_pages 필드 추가
- packages/core/src/agents/validation-agent.ts:
  - crawlClonePages로 모든 페이지 재채점
  - 페이지별 delta + 집계 점수 비교
  - after_page_scores, page_deltas 필드 추가
- packages/core/src/agents/pipeline-runner.ts:
  - ANALYZING: crawlMultiplePages deps 전달
  - CLONING: additionalFiles Map으로 전체 페이지 저장
  - VALIDATING: 클론의 모든 .html 재채점
  - stageCallbacks result_full에 multi_page 데이터 포함

#### GEO 평가 상세 데이터 추출 엔진 ✅
- packages/core/src/agents/geo-eval-extractor.ts — 신규 모듈
  - parseRobotsTxt(): AI 봇 8종별 허용/차단/부분/미명시 상태 파싱
  - extractSchemaCoverage(): Schema.org 12타입별 페이지 커버리지 매트릭스
  - extractMarketingClaims(): 마케팅 클레임 패턴 매칭 + 출처 검증 가능성 판정
  - analyzeJsDependency(): 스크립트 수, 프레임워크 감지, JS 의존도 추정
  - extractProductInfo(): JSON-LD에서 제품명/가격/스펙/평점 추출 + HTML 스펙 패턴
  - generateFindings(): 잘된점/취약점/기회 자동 분석 (봇, 스키마, JS, 클레임 기반)
  - analyzePathAccess(): robots.txt AI 봇 블록별 허용/차단 경로 상세 분석
  - generateImprovements(): 9종 규칙 기반 개선 권고 자동 생성 (impact/difficulty/sprint)
  - extractGeoEvaluationData(): 전체 통합 → GeoEvaluationData (봇 정책, 스키마, 클레임, JS, 제품, 개선안, 강점/약점/기회)
- analysis-agent.ts: AnalysisOutput.eval_data 필드 추가, runAnalysis()에서 자동 추출
- pipeline-runner.ts: ANALYZING stage result_full에 eval_data 전체 포함
- 테스트: geo-eval-extractor.test.ts — 19 tests

#### Evaluation 탭 10-서브탭 확장 (samsung_geo_dashboard.html 참조 수준) ✅
- dashboard.html Evaluation 탭 10개 서브탭:
  1. 📊 종합 개요 (점수 게이지 + 7차원 바 + Strengths/Weaknesses/Opportunities 3컬럼)
  2. 🤖 크롤링 접근성 (봇 정책 테이블 + 차단 경로 + llms.txt 3-카드 현황)
  3. 🏗️ 구조화 데이터 (스키마 매트릭스 + 구현율 요약 + JS 의존성 분석)
  4. 📦 제품 정보 인식 (페이지별 가격/평점/Schema 스펙/HTML 스펙 상세)
  5. 💬 브랜드 메시지 (마케팅 클레임 × 위치 × 출처 × 검증성 + 통계)
  6. 🔍 페이지별 분석 (멀티페이지 점수 테이블 + 집계 + 상태 태그)
  7. 🎯 개선 권고 (전체 항목 테이블 + 영향/난이도/Sprint/차원)
  8. 🔬 실증 데이터 (구현 vs 미구현 스키마 + 제품 데이터 추출 실증 매트릭스)
  9. 🗺️ 개선 로드맵 (Sprint 1/2/3별 그룹, impact 별점, difficulty 레이블)
  10. ⏱️ 실행 요약 (파이프라인 스테이지별 상태 + 소요시간)
- Re-run 데이터 격리 수정: 최신 pipeline_id 기준으로만 evaluation 표시 (이전 실행 결과 혼동 방지)
- Evaluation 탭에 파이프라인 상태 표시 (pipeline_id, 시작 시간, 현재 스테이지, 실행 중 경고)
- Refresh 버튼으로 최신 데이터 수동 갱신

#### Pipeline UX 3개 기능 추가 ✅
- **실시간 진행도**: 실행 중 3초 간격 auto-refresh, 스테이지 확장 시 항상 최신 데이터 로드 (캐시 제거), ⏳ Running... 애니메이션
- **삭제 버튼**: 완료/실패 파이프라인 🗑️ 버튼, stage_executions + pipeline 레코드 삭제, 실행 중 삭제 방지
  - StageExecutionRepository.deleteByPipelineId() + PipelineRepository.deleteById()
  - DELETE /api/targets/:id/pipeline/:pipelineId 엔드포인트
- **Evaluation pipeline instance 선택**: 타겟 선택 시 전체 파이프라인 목록 드롭다운, (Latest) 표시, 특정 실행 결과 조회 가능
- 테스트: deleteByPipelineId 3건 + deleteById 3건 = 6건 추가

#### Dashboard → Pipeline LLM 연동 ✅
- packages/dashboard/src/routes/pipeline.ts:
  - POST ?execute=true 시 GeoLLMClient 자동 생성, chatLLM 의존성 주입
  - API Key 미설정 시 graceful degradation → 규칙 기반 모드로 실행 (경고 로그)
  - LLM 초기화 실패 시에도 파이프라인 중단 없이 규칙 기반 폴백
  - 콘솔에 LLM 모드 표시 (LLM-enhanced / rule-based only)
- 테스트: pipeline.test.ts — 7건 추가 (key 없음/있음/잘못됨, selectProvider, completed_at 등)

#### 버그 수정 ✅
- startServer()에서 initPipelineRouter(db) 누락 → 파이프라인 API 503 에러 수정
- Pipeline 상태가 page reload 후 항상 완료로 보이는 문제 수정 (URL hash 탭 유지)
- 회귀 테스트 추가

#### 테스트 (vitest) — 1287+ tests ✅
- Phase 5까지: 1182 tests
- Phase 6 추가: viz-spec 51 + stage-execution 18 + pipeline-repo 48 + pipeline API 44 + regression 1 + geo-eval-extractor 19 = 105+ tests

---

## 다음 할 일 (우선순위 순)

1. **Synthetic Probes 파이프라인 통합** — runProbes()를 ANALYZING/VALIDATING에 연결, 8개 프로브 결과 DB 저장 + Evaluation 탭 표시
2. **Optimization Agent 멀티 페이지 대응** — 현재 index.html만 최적화 → 클론의 모든 .html 파일에 대해 최적화 적용
3. **Monitoring Agent 구현** — 주기적 GEO 추적 + 이상 감지
4. **Agent Memory** — EffectivenessIndex 쿼리, 유사 사례 검색 도구
5. **OAuth 콜백 API** — `/api/auth/callback` 엔드포인트 + Dashboard OAuth UI
6. **schema-builder / content-optimizer 스킬** — LLM 기반 JSON-LD 생성 + 콘텐츠 개선
7. **Dashboard WebSocket 실시간 업데이트** — 파이프라인 실행 중 스테이지 진행 자동 반영

## Known Issues / Post-MVP 개선 항목

### KI-001: 사이트 유형별 평가 항목 자동 지정 — 설계 완료, 구현 완료
- TemplateEngine + classifySite() 구현 완료
- Analysis Agent 내 자동 분류 호출 통합 완료

### KI-002: pipeline-repository findLatestByTargetId flaky test
- UUID 정렬 순서 문제로 간헐적 실패 (1/1260 확률)
- 근본 원인: started_at이 동일 시점일 때 UUID 기반 정렬이 비결정적

### KI-003: Optimization Agent가 index.html만 최적화
- 멀티 페이지 클론에서 sub-page는 저장/채점되지만 최적화 대상에서 제외
- optimization-agent.ts의 listFiles() → find first .html 로직 확장 필요

---

## 주요 아키텍처 참조

- ARCHITECTURE.md — 전체 시스템 설계서 (섹션 1~12 + 4-A/B/C, 9-A/B/C/D/E)
- **읽기 전용 원칙**: Target Web Page 직접 수정 불가 → 로컬 클론 기반 작업 (섹션 1.3)
- 에이전트 6종: Orchestrator, Analysis, Strategy, Optimization, Validation, Monitoring
- **Clone Manager**: 원본 → 로컬 클론 생성/관리 (섹션 9-C.1)
- **결과 전달**: Before-After Report + Archive .zip 다운로드 (섹션 9-C.3)
- **이중 트랙 검증**: 구조적 검증(클론) + LLM 기준선(원본) (섹션 4.5)
- InfoRecognition: 제품/가격/스펙 등 LLM 인식 정확도 검증 시스템
- Agent Memory: EffectivenessIndex (구조적) + SemanticChangeArchive (벡터 검색)
- CRAFT 프레임워크: Clarity, Relevance, Authority, Freshness, Traceability
- **평가 템플릿 시스템**: 3유형 (manufacturer/research/generic) + 자동 분류 (섹션 9-E)
- **VisualizationSpec 시스템**: 3-계층 병합 (common → site_type → reference/subtype) + 품질 검증
- **멀티 페이지 크롤링**: 홈페이지 링크 자동 추출, 최대 20페이지, 제품URL 우선, 사이클 재평가
- **Cycle 제어**: 자동 중단 3조건 + 수동 중단 + 중간 결과 조회 (섹션 9-E.4)
- **Interactive Dashboard**: 5탭 SPA (Targets, Pipelines, Evaluation, Agent Prompts, LLM Providers)
- **Pipeline 실행**: Dashboard Start/Re-run → 비동기 실행 → stage_executions DB 기록 → UI 확장 카드
- **GEO 평가 엔진**: geo-eval-extractor.ts — 봇 정책/스키마 커버리지/클레임/JS 의존성/제품 정보/개선 권고 자동 추출
- **개선 로드맵 자동 생성**: 9종 규칙 기반 (llms.txt, 봇 명시, 스키마 누락, 클레임 검증, JS 의존도, 스펙 구조화, 저점수 차원, sameAs, dateModified)
