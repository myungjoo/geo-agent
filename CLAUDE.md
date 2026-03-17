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
| DB (v1) | SQLite + drizzle-orm | Repository 패턴 |
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
INIT → ANALYZING → STRATEGIZING → OPTIMIZING → VALIDATING → COMPLETED
                                                              │
                                                    FAILED / PARTIAL_FAILURE
```

## 완료된 작업

### Phase 0: 아키텍처 설계
- [x] ARCHITECTURE.md 작성 (2500+ 줄)
- [x] P0 버그 5건 수정 (섹션 번호, Python 잔재, CLI 정합성, 타입 표기)
- [x] P1 항목 모두 완료:
  - 4-C: 12+ 핵심 데이터 타입 정의
  - 4-A: 6개 에이전트 시스템 프롬프트 + 편집 UI
  - 9-A: 에러 핸들링 (재시도, 타임아웃, 롤백)
  - 9-B: LLM 추상화 (GPT-4o 기본, 멀티 프로바이더, API Key + OAuth)
  - 9-C: 배포 흐름 (direct/cms_api/suggestion_only)
  - 9-D: SQLite 스키마 (7 테이블)

### Phase 1: 코드 구현 (진행 중)

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
- config/settings.ts — AppSettings (workspace, DB path, port, 기본 모델)
- db/schema.ts — drizzle SQLite 테이블 7개 (targets, content_snapshots, change_records, change_impacts, geo_time_series, pipeline_runs, error_events)
- db/connection.ts — SQLite + drizzle 연결 (WAL mode)
- db/repositories/target-repository.ts — CRUD Repository
- prompts/defaults.ts — 6개 에이전트 기본 시스템 프롬프트
- prompts/prompt-loader.ts — load/save/reset + slot injection
- index.ts — 패키지 entry point

#### 대시보드 (packages/dashboard/src/) ✅
- server.ts — Hono 서버 (CORS, health check)
- routes/targets.ts — Target CRUD REST API
- routes/settings.ts — Agent Prompt 관리 REST API

#### CLI (packages/cli/src/) ✅
- index.ts — `geo start/stop/status/init` 명령어

#### Skills (packages/skills/src/) ✅
- index.ts — SkillRegistry 인터페이스 + 기본 구현

## 다음 할 일 (우선순위 순)

1. **Node.js 환경 확인 및 npm install** — 현재 환경에 Node.js가 설치되어 있지 않거나 PATH에 없음
2. **TypeScript 빌드 검증** — `npm run build` 로 모든 패키지 컴파일 확인
3. **drizzle-kit 마이그레이션** — `drizzle-kit generate` 로 SQLite 마이그레이션 생성
4. **Dashboard 프론트엔드** — 현재 API만 구현, HTML/JS UI 구현 필요 (pi-web-ui 연동)
5. **LLM Provider 설정 API** — `/api/settings/llm-providers` 라우트 구현
6. **LLM 추상화 레이어** — provider-config.ts, geo-llm-client.ts, oauth-manager.ts, cost-tracker.ts
7. **파이프라인 인프라** — state-machine.ts, error-handler.ts, rollback.ts
8. **Bundled Skills 구현** — dual-crawl, schema-builder, geo-scorer 등 핵심 스킬
9. **테스트 작성** — 모델 파싱, Repository CRUD, API 엔드포인트 테스트
10. **Git commit** — Phase 1 MVP 코드 커밋

## 주요 아키텍처 참조

- ARCHITECTURE.md — 전체 시스템 설계서 (섹션 1~12 + 4-A/B/C, 9-A/B/C/D)
- 에이전트 6종: Orchestrator, Analysis, Strategy, Optimization, Validation, Monitoring
- 배포 모드 3종: direct, cms_api, suggestion_only
- InfoRecognition: 제품/가격/스펙 등 LLM 인식 정확도 검증 시스템
- Agent Memory: EffectivenessIndex (구조적) + SemanticChangeArchive (벡터 검색)
- CRAFT 프레임워크: Clarity, Relevance, Authority, Freshness, Traceability
