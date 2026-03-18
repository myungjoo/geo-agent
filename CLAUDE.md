# GEO Agent System — 작업 기록 및 지침

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
- target-profile.ts — CompetitorEntry, LLMPriority, DeploymentConfig, TargetProfile, Create/Update
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
- better-sqlite3 `^12.8.0` 업그레이드 (Node 24 prebuilt 지원)
- drizzle-orm `^0.45.1`, drizzle-kit `^0.31.10` 업그레이드
- pino-pretty 런타임 의존성 추가
- core/dashboard package.json exports 필드 추가

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

#### 테스트 (vitest) — 581 tests, 12 files ✅
- packages/core/src/models/models.test.ts — 304 tests (18개 Zod 스키마 전체)
- packages/core/src/models/__tests__/schema-validation.test.ts — 15 tests (기존 버그 수정: GeoScore에 info_recognition_score 누락, PipelineState에 error_message 누락)
- packages/core/src/config/settings.test.ts — 15 tests
- packages/core/src/db/connection.test.ts — 13 tests (WAL, FK, 자동 테이블 생성 회귀 포함)
- packages/core/src/db/repositories/target-repository.test.ts — 32 tests
- packages/core/src/prompts/prompt-loader.test.ts — 33 tests
- packages/core/src/prompts/evaluation-templates/evaluation-templates.test.ts — 89 tests (신규: 평가 템플릿 시스템 전체)
- packages/core/src/bugs.test.ts — 17 tests (9개 버그 회귀 테스트)
- packages/dashboard/src/routes/targets.test.ts — 47 tests (CRUD + 버그 회귀 22개)
- packages/dashboard/src/routes/settings.test.ts — 22 tests
- packages/dashboard/src/server.test.ts — 1 test (EADDRINUSE)
- packages/skills/src/skills.test.ts — 8 tests

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

#### 테스트 (vitest) — 618 tests, 16 files ✅
- 기존 7파일 업데이트 (deployment_mode → site_type 마이그레이션)
- packages/core/src/pipeline/state-machine.test.ts — 62 tests (신규)
- packages/core/src/clone/clone-manager.test.ts — 32 tests (신규)
- packages/core/src/report/report-generator.test.ts — 28 tests (신규)
- packages/core/src/llm/provider-config.test.ts — 30 tests (신규)
- packages/skills/src/skills.test.ts — 10 tests (업데이트: bundled skills 포함)

---

## 다음 할 일 (우선순위 순)

1. **Dashboard 프론트엔드** — 현재 API만 구현, HTML/JS UI 구현 필요 (pi-web-ui 연동)
2. **LLM SDK 실제 연동** — OpenAI/Anthropic/Google SDK 연동 (현재 stub)
3. **에이전트 실행 로직** — Orchestrator가 파이프라인 스테이지를 실제로 구동
4. **Dual Crawl 스킬 구현** — Target URL 크롤링 + robots.txt + 구조화 데이터 수집
5. **GEO Scorer 스킬 구현** — S1~S7 실제 채점 로직
6. **OAuth 매니저** — oauth-manager.ts (Google/Microsoft OAuth 플로우)

## Known Issues / Post-MVP 개선 항목

### KI-001: 사이트 유형별 평가 항목 자동 지정 — 설계 완료, 구현 완료
- TemplateEngine + classifySite() 구현 완료
- 남은 작업: Analysis Agent 내 자동 분류 호출 통합

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
- **Cycle 제어**: 자동 중단 3조건 + 수동 중단 + 중간 결과 조회 (섹션 9-E.4)
- **Interactive Dashboard**: 10탭, 다크 테마, Chart.js, 단일 HTML (섹션 9-E.5)
