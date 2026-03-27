# GEO Agent System — Architecture Overview

## System Purpose

**GEO (Generative Engine Optimization)** Agent System은 LLM 서비스(ChatGPT, Claude, Gemini, Perplexity 등)가 Target Web Page의 데이터를 우선적으로, 정확하게 참조하도록 콘텐츠를 최적화하는 에이전트 시스템이다.

---

## Agent Architecture (수정)

> **기존 다이어그램의 문제점**: Orchestrator에서 Analysis/Strategy/Optimization으로 동시에 화살표가 뻗어 병렬 실행처럼 오해할 수 있었고, Analysis→Validation, Optimization→Validation 직접 호출 화살표가 실제 코드와 불일치했다. 실제로는 **Orchestrator가 순차적으로** 각 Agent를 호출하며, Agent 간 직접 호출은 없다.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            GEO Agent System                                  │
│                                                                              │
│                      ┌───────────────────────┐                               │
│                      │     Orchestrator       │                               │
│                      │   (상태 머신 기반      │                               │
│                      │    순차 스테이지 제어)  │                               │
│                      └───────────┬───────────┘                               │
│                                  │                                            │
│       ┌──────────────────────────┼──────────────────────────┐                │
│       │ 순차 호출               │                          │                │
│       ▼                         ▼                          ▼                │
│  ┌─────────────┐         ┌─────────────┐           ┌─────────────┐         │
│  │  Analysis   │ ──①──▶ │  Strategy   │ ──②──▶   │Optimization │         │
│  │  Agent      │ 데이터  │  Agent      │ 태스크    │  Agent      │         │
│  │             │ 전달    │             │ 목록 전달  │             │         │
│  │ GEO 점수,  │         │ 규칙+LLM    │           │ 로컬 클론   │         │
│  │ 크롤링,    │         │ 기반 전략   │           │ 수정 적용   │         │
│  │ 10-탭 리포트│         │ 수립        │           │             │         │
│  └─────────────┘         └─────────────┘           └──────┬──────┘         │
│                                                           │ ③              │
│                   ┌───────────────────────┐                │                │
│            ④     │    Validation Agent    │◀───────────────┘                │
│       ┌─────────│                       │                                  │
│       │ 루프백   │ Before/After 점수 비교│                                  │
│       │ (목표    │ 재채점 + 판정         │                                  │
│       │  미달시) └───────────┬───────────┘                                  │
│       │                     │ ⑤                                            │
│       ▼                     ▼                                              │
│  ┌─────────────┐    ┌─────────────────┐       ┌──────────────┐            │
│  │ STRATEGIZING│    │ Reporting       │       │  Monitoring   │            │
│  │ 으로 재진입 │    │ (LLM Summary +  │       │  Agent        │            │
│  └─────────────┘    │  HTML Report)   │       │  (미구현)     │            │
│                     └─────────────────┘       └──────────────┘            │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     Shared Infrastructure                             │   │
│  │   GeoLLMClient │ Database │ Clone Store │ Probe Engine │ Skill Loader │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
         │                        │                    │
         ▼                        ▼                    ▼
  ┌──────────────┐        ┌──────────────┐     ┌──────────────┐
  │ Target Web   │        │ LLM Services │     │   Dashboard  │
  │ Page(s)      │        │ (OpenAI,     │     │ (Report +    │
  │ ★ 읽기 전용  │        │  Anthropic,  │     │  Archive)    │
  └──────────────┘        │  Google ...) │     └──────────────┘
                          └──────────────┘

  ※ 번호(①~⑤)는 데이터 흐름 순서. 실제 호출은 모두 Orchestrator가 수행.
     Agent끼리 직접 호출하지 않음 — Orchestrator가 이전 Agent의 결과를 다음 Agent에 주입.
```

---

## Agent별 역할 상세

| Agent | 역할 | 주요 동작 | 구현 상태 |
|-------|------|----------|----------|
| **Orchestrator** | 파이프라인 전체 조율 | 스테이지 순서 제어, 에이전트 호출, 상태 관리 | 구현 완료 |
| **Analysis Agent** | 사이트 분석 + GEO 점수 산출 | 크롤링 → 분류 → 정적 분석 → LLM 프로브 → 10-탭 리포트 생성 | 구현 완료 (일부 항목 미완) |
| **Strategy Agent** | 개선 전략 수립 | 분석 결과 기반 우선순위별 태스크 목록 생성 (LLM 판단) | 구현 완료 |
| **Optimization Agent** | 로컬 클론 최적화 | 메타데이터, Schema.org, llms.txt, 시맨틱 구조, 콘텐츠 밀도 개선 | 구현 완료 |
| **Validation Agent** | 최적화 결과 검증 | 클론 재분석 → Before/After 점수 비교 → 목표 미달 시 재시도 루프 | 구현 완료 |
| **Reporting** | 최종 보고서 생성 | Executive Summary, Recommendations, Dimension 해석 (LLM) + HTML/Archive | 구현 완료 |
| **Monitoring Agent** | 주기적 GEO 추적 | 정기 재분석, 외부 변경 감지, 점수 하락 알림 | 미구현 |

---

## Pipeline Flow — Orchestrator에 의한 순차 실행

Pipeline Flow 자체가 Orchestrator의 Action이다. `Orchestrator` 클래스는 상태 머신(`PipelineStateMachine`)을 내장하고 있으며, 등록된 `StageHandler`를 스테이지 순서대로 호출한다. `PipelineRunner`가 Orchestrator에 각 스테이지 핸들러를 등록하고, 각 핸들러 안에서 해당 Agent를 호출한다.

```
                           Orchestrator (상태 머신)
                                  │
    ┌─────────────────────────────┼─────────────────────────────┐
    │                             │                             │
    ▼                             ▼                             ▼
 ┌──────┐  ┌──────────┐  ┌────────┐  ┌────────────┐  ┌──────────┐
 │ INIT │─▶│ANALYZING │─▶│CLONING │─▶│STRATEGIZING│─▶│OPTIMIZING│
 └──────┘  └──────────┘  └────────┘  └────────────┘  └──────────┘
               │                           ▲                │
               │                           │                ▼
    Orchestrator가                   ④ ctx.setNextStage  ┌──────────┐
    runLLMAnalysis() 호출            ("STRATEGIZING")   │VALIDATING│
    + runMultiProviderProbes()           (루프백)         └────┬─────┘
               │                           │                │
               ▼                      목표 미달?            │ 목표 달성
    AnalysisOutput 저장               YES → 루프백          ▼
    (DB + 메모리)                     NO  → 다음       ┌──────────┐
                                                        │REPORTING │
                                                        └────┬─────┘
                                                             │
                                                             ▼
                                                       ┌──────────┐
                                                       │COMPLETED │
                                                       └──────────┘

  각 스테이지 핸들러:
  ┌────────────────────────────────────────────────────────────────────┐
  │ ANALYZING  → runLLMAnalysis(llm-analysis-agent) + probes          │
  │ CLONING    → CloneManager.createClone() [파일 복사, LLM 불필요]   │
  │ STRATEGIZING → runStrategy(strategy-agent) [규칙 + LLM]          │
  │ OPTIMIZING → runOptimization(optimization-agent) [규칙 + LLM]    │
  │ VALIDATING → runValidation(validation-agent) [재채점 + 판정]     │
  │ REPORTING  → ReportBuilder + piAiComplete() x 3 [LLM 요약 생성]  │
  └────────────────────────────────────────────────────────────────────┘
```

### Orchestrator 조율의 핵심 메커니즘

| 메커니즘 | 설명 | 코드 위치 |
|---------|------|----------|
| **StageHandler 등록** | `PipelineRunner`가 `orchestrator.registerHandler(stage, handler)`로 각 스테이지 핸들러 등록 | `pipeline-runner.ts` |
| **순차 실행** | `STAGE_ORDER` 배열 순서대로 `handler(ctx)` 호출, 각 핸들러는 해당 Agent 함수를 실행 | `orchestrator.ts:51-60` |
| **사이클 루프백** | Validation 핸들러가 `ctx.setNextStage("STRATEGIZING")` 호출 → Orchestrator가 `STRATEGIZING`으로 전이 (최대 10 사이클) | `orchestrator.ts:195-202` |
| **재시도** | 각 스테이지 실패 시 최대 3회 자동 재시도 | `orchestrator.ts:171-182` |
| **타임아웃** | 전체 파이프라인 30분 타임아웃 | `orchestrator.ts:116-120` |
| **데이터 전달** | Agent 간 직접 호출 없음. 이전 스테이지의 결과를 PipelineRunner가 메모리/DB에 저장 후 다음 핸들러에 주입 | `pipeline-runner.ts` |

### 실행 예시: samsung.com 분석

```
Pipeline Start
│
├─ INIT: 초기화, target_url="https://samsung.com", target_id 생성
│
├─ ANALYZING:
│   ├─ runLLMAnalysis() → SKILL.md 프롬프트 로드 → piAiAgentLoop(15회 반복)
│   │   ├─ LLM: crawl_page("https://samsung.com") 호출
│   │   ├─ LLM: classify_site() → "manufacturer"
│   │   ├─ LLM: score_geo() → total: 42/100
│   │   ├─ LLM: extract_evaluation_data() → 봇 정책, JS 의존도
│   │   ├─ LLM: analyze_brand_message() → 브랜드 감성 분석
│   │   ├─ LLM: run_synthetic_probes() → 8개 시나리오 인용 검증
│   │   └─ LLM: 최종 RichAnalysisReport (10-탭 JSON) 반환
│   └─ 결과를 DB에 저장, analysisOutput 변수에 보관
│
├─ CLONING: CloneManager로 로컬 클론 생성 (LLM 불필요)
│
├─ STRATEGIZING:
│   └─ runStrategy(analysisOutput) → 12개 규칙 적용 + LLM 전략 요약
│       → OptimizationPlan (8개 태스크) 생성
│
├─ OPTIMIZING:
│   └─ runOptimization(plan, clonePath) → 각 태스크별 optimizer 실행
│       → robots.txt 수정, JSON-LD 추가, llms.txt 생성 등
│
├─ VALIDATING:
│   └─ runValidation(beforeScore, clonePath)
│       → 클론 재채점: 42 → 67 (목표 80 미달)
│       → ctx.setNextStage("STRATEGIZING") ← Orchestrator가 루프백!
│
├─ STRATEGIZING (2차): 남은 개선점 기반 추가 태스크 생성
├─ OPTIMIZING (2차): 추가 최적화 적용
├─ VALIDATING (2차): 67 → 82 (목표 달성!)
│
├─ REPORTING:
│   ├─ ReportBuilder: HTML 리포트 구조 생성
│   ├─ piAiComplete(): Executive Summary JSON 생성
│   ├─ piAiComplete(): 5~8개 구조화 추천 생성
│   ├─ piAiComplete(): 7차원 점수 해석 생성
│   └─ ArchiveBuilder: ZIP 아카이브 생성
│
└─ COMPLETED: 최종 결과 반환
```

---

## Agent별 LLM / Hardcode 비율 및 프롬프트 유형

| Agent | LLM 비율 | Hardcode 비율 | LLM 필수? | 프롬프트 유형 | 프롬프트 설명 |
|-------|---------|-------------|----------|-------------|-------------|
| **Analysis (정적)** | 0% | 100% | NO | — | LLM 미사용. 크롤링·파싱·점수계산 모두 코드 |
| **Analysis (LLM)** | 80% | 20% | **YES** | **SKILL.md 파일** (외부 템플릿) | `geo-analysis.skill.md` 273줄. LLM이 도구 호출 순서·판단 주도. 도구 핸들러는 hardcoded extractor |
| **Strategy** | 40% | 60% | **YES** | **동적 생성** (Template Literal) | 코드에서 분석 결과를 Template Literal로 조합한 프롬프트 생성. 12개 규칙은 hardcoded |
| **Optimization** | 30% | 70% | **YES** | **Hardcoded 프롬프트** | 각 optimizer 내부에 고정 프롬프트. LLM은 콘텐츠 생성(meta description, JSON-LD 등)에만 사용 |
| **Validation** | 15% | 85% | NO | **Hardcoded 프롬프트** (Optional) | 재채점은 코드, 검증 verdict만 선택적 LLM 호출 |
| **Reporting** | 60% | 40% | **YES** | **Hardcoded 프롬프트** | 3개 LLM 호출(Executive Summary, Recommendations, Dimension Interpretations) 각각 고정 프롬프트 |
| **Probes** | 100% | 0% | **YES** | **Hardcoded 프롬프트** | 8개 소비자 시나리오가 `PROBE_DEFINITIONS` 상수에 고정 |

### 프롬프트 유형 상세 분류

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         프롬프트 유형 분포                               │
│                                                                         │
│  ┌─── SKILL.md (외부 파일 기반) ───┐                                   │
│  │                                  │                                   │
│  │  geo-analysis.skill.md (273줄)   │  ← 유일한 SKILL.md 프롬프트      │
│  │  - YAML frontmatter: 도구 선언  │     LLM Agent Loop의 시스템 프롬프트│
│  │  - Markdown body: 분석 지시사항 │     버전 관리, 수정 용이           │
│  │                                  │                                   │
│  └──────────────────────────────────┘                                   │
│                                                                         │
│  ┌─── 동적 생성 (Template Literal) ──┐                                 │
│  │                                    │                                 │
│  │  Strategy Agent                    │  ← 분석 결과(점수, 구조, 태스크)│
│  │  - 점수·구조·태스크 목록을         │     를 런타임에 프롬프트에 삽입  │
│  │    런타임에 프롬프트에 삽입         │                                 │
│  │  - system_instruction은 고정      │                                 │
│  │                                    │                                 │
│  └────────────────────────────────────┘                                 │
│                                                                         │
│  ┌─── Hardcoded 프롬프트 ────────────┐                                 │
│  │                                    │                                 │
│  │  Optimization Agent (각 optimizer) │  ← 코드 내 문자열 상수          │
│  │  Validation Agent (verdict)        │     수정 시 코드 변경 필요       │
│  │  Reporting (3개 요약 생성)         │                                 │
│  │  Probes (8개 시나리오 정의)        │                                 │
│  │                                    │                                 │
│  └────────────────────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4-D 원칙 준수 현황

| 작업 유형 | 담당 | 원칙 준수 |
|----------|------|----------|
| **기계적 작업** (파싱, 카운트, 점수 산출) | Hardcoded 코드 | ✅ 코드가 수행 |
| **판단 작업** (품질 평가, 인용 판정, 전략 수립) | LLM | ✅ LLM이 수행 |
| **LLM 실패** | 에러 전파, 파이프라인 중단 | ✅ Silent fallback 없음 |
| **빈 응답** | 에러로 보고 | ✅ 빈 결과를 정상 반환하지 않음 |

---

## Agent → Skill 호출 관계

현재 시스템에서 **SKILL.md 기반 Skill**을 사용하는 Agent는 **Analysis Agent(LLM 모드)** 하나뿐이다. 다른 Agent들은 Skill 시스템을 거치지 않고 직접 코드 호출 또는 인라인 프롬프트를 사용한다.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    Agent → Skill 호출 아키텍처                           │
│                                                                          │
│  ┌─────────────────┐          ┌────────────────────────────────────┐    │
│  │ Analysis Agent   │          │        Skill System                │    │
│  │ (LLM 모드)      │          │                                    │    │
│  │                  │  ──①──▶ │  loadBuiltinSkill("geo-analysis")  │    │
│  │ llm-analysis-   │          │         │                          │    │
│  │ agent.ts        │          │         ▼                          │    │
│  │                  │  ◀─②── │  ┌─────────────────────────┐      │    │
│  │                  │          │  │  geo-analysis.skill.md  │      │    │
│  └────────┬─────────┘          │  │                         │      │    │
│           │                    │  │  frontmatter:           │      │    │
│           │                    │  │   name: geo-analysis    │      │    │
│           │                    │  │   tools: [9개 도구]     │      │    │
│           │                    │  │                         │      │    │
│           │                    │  │  body:                  │      │    │
│           │                    │  │   273줄 분석 지시사항   │      │    │
│           │                    │  │   (= systemPrompt)      │      │    │
│           │                    │  └─────────────────────────┘      │    │
│           │                    └────────────────────────────────────┘    │
│           │                                                              │
│           │ ③ systemPrompt + 9개 도구 + userMessage                     │
│           ▼                                                              │
│  ┌────────────────────┐                                                 │
│  │  piAiAgentLoop()   │                                                 │
│  │                    │                                                 │
│  │  systemPrompt ←── SKILL.md body                                     │
│  │  tools ←────────── ANALYSIS_TOOLS (TypeBox 스키마 9개)               │
│  │  toolHandlers ←─── createAnalysisToolHandlers()                      │
│  │  maxIterations: 15 │                                                 │
│  │                    │                                                 │
│  │  [LLM이 도구 호출 순서를 자율 결정]                                  │
│  │   Turn 1: crawl_page → handler → 결과                               │
│  │   Turn 2: classify_site → handler → 결과                            │
│  │   Turn 3: score_geo → handler → 결과                                │
│  │   ...                                                                │
│  │   Turn N: 최종 RichAnalysisReport (10-탭 JSON) 반환                 │
│  └────────────────────┘                                                 │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════  │
│                                                                          │
│  ┌─────────────────┐          Skill 시스템을 사용하지 않는 Agent들       │
│  │ Strategy Agent   │ ──▶ 인라인 Template Literal 프롬프트               │
│  │                  │     + safeLLMCall(chatLLM, {prompt, ...})          │
│  └─────────────────┘                                                    │
│                                                                          │
│  ┌─────────────────┐          각 optimizer 내부에 고정 프롬프트          │
│  │ Optimization    │ ──▶ piAiComplete() 직접 호출                       │
│  │ Agent           │     (Skill 로더 미사용)                             │
│  └─────────────────┘                                                    │
│                                                                          │
│  ┌─────────────────┐          점수 비교 코드 + Optional LLM verdict     │
│  │ Validation      │ ──▶ piAiComplete() 직접 호출                       │
│  │ Agent           │     (Skill 로더 미사용)                             │
│  └─────────────────┘                                                    │
│                                                                          │
│  ┌─────────────────┐          3개 고정 프롬프트로 요약 생성              │
│  │ Reporting       │ ──▶ piAiComplete() x 3                             │
│  │                  │     (Skill 로더 미사용)                             │
│  └─────────────────┘                                                    │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════  │
│                                                                          │
│  코드 기반 Skill (TypeScript 함수로 직접 호출):                          │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  dual-crawl.ts ← crawl_page / crawl_multiple_pages 도구 핸들러     │ │
│  │  geo-scorer.ts ← score_geo 도구 핸들러                              │ │
│  │                                                                     │ │
│  │  이 함수들은 SKILL.md 프롬프트 도구의 "핸들러"로 호출됨             │ │
│  │  (Agent Loop에서 LLM이 도구 호출 → 핸들러가 이 함수들 실행)         │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘

  요약: SKILL.md → Skill Loader → systemPrompt 추출 → piAiAgentLoop 주입
        오직 Analysis Agent(LLM 모드)만 이 경로를 사용
        나머지 Agent는 코드 내 인라인 프롬프트 + piAiComplete() 직접 호출
```

---

## Analysis Agent 도구 (Tools) 관계도

Analysis Agent는 **geo-analysis** SKILL의 프롬프트에 따라 LLM이 도구를 호출하는 Agent Loop으로 동작한다.

```
                    ┌────────────────────┐
                    │  geo-analysis      │
                    │  SKILL.md 프롬프트 │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │  piAiAgentLoop()   │
                    │  (LLM ↔ Tool 루프)│
                    └─────────┬──────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
    Phase 1: 수집        Phase 1: 수집       Phase 1: 수집
          │                   │                   │
          ▼                   ▼                   ▼
  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐
  │ crawl_page   │  │crawl_multiple│  │  classify_site     │
  │              │  │_pages        │  │                    │
  │ 단일 페이지  │  │              │  │ 사이트 유형 분류   │
  │ 크롤링       │  │ 최대 30페이지│  │ (manufacturer/     │
  └──────────────┘  │ 멀티 크롤링  │  │  research/generic) │
                    └──────────────┘  └────────────────────┘
          │                   │                   │
          ▼                   ▼                   ▼
  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐
  │ score_geo    │  │extract_      │  │ analyze_brand_     │
  │              │  │evaluation_   │  │ message            │
  │ GEO 점수    │  │data          │  │                    │
  │ 산출 (7차원)│  │              │  │ 브랜드 메시지      │
  └──────────────┘  │ 봇 정책,    │  │ 감성/검증가능성    │
                    │ 스키마 커버리│  │ 분석               │
                    │ JS 의존도   │  └────────────────────┘
                    └──────────────┘
          │                   │
          ▼                   ▼
  ┌──────────────┐  ┌──────────────┐
  │analyze_      │  │collect_      │
  │product_      │  │evidence      │
  │recognition   │  │              │
  │              │  │ JSON-LD 스니 │
  │ 제품별 스펙  │  │ 펫, robots   │
  │ 인식률 평가  │  │ .txt 발췌 등 │
  └──────────────┘  │ 증거 수집    │
                    └──────────────┘
          │
          ▼
  ┌────────────────────┐
  │ run_synthetic_     │
  │ probes             │
  │                    │
  │ 8개 소비자 시나리오│
  │ LLM 프로브 실행   │
  │ (인용/정확도 검증) │
  └────────────────────┘
```

---

## GEO 점수 체계 (2-Level)

```
┌─ Level 1: GEO Score (최종 성과, LLM 프로브 필요) ──────────────┐
│                                                                   │
│  Citation Rate ·········· 25%   "얼마나 자주 인용되는가"        │
│  Citation Accuracy ······ 20%   "인용 내용이 정확한가"          │
│  Info Recognition ······· 20%   "정보가 인식되는가"             │
│  Coverage ················ 15%   "얼마나 많은 LLM이 아는가"     │
│  Rank Position ··········· 10%   "답변 내 노출 순위"            │
│  Structured Score ········ 10%  ◀── Level 2 전체 점수 투입      │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘

┌─ Level 2: GEO Readiness Score (사이트 준비도, 정적 분석) ──────┐
│                                                                   │
│  S1  LLM 크롤링 접근성 ········· 15%                            │
│  S2  구조화 데이터 품질 ········· 25%                            │
│  S3  콘텐츠 기계가독성 ········· 20%                            │
│  S4  콘텐츠 팩트 밀도 ··········· 10%                            │
│  S5  브랜드/조직 메시지 ········· 10%                            │
│  S6  AI 친화적 인프라 ··········· 10%                            │
│  S7  콘텐츠 탐색 구조 ··········· 10%                            │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

## LLM 호출 흐름

```
Dashboard LLM Providers 설정
         │
         ▼
    llm-providers.json
         │
         ▼
  GeoLLMClient.chat(request)
         │
         ├── selectProvider()
         │
         ▼
  piAiModelFromProvider()
         │
         ▼
  piAiComplete()  ←── json_mode: onPayload 콜백
         │
         ▼
  ┌──────────────────────────────────────────┐
  │  pi-ai complete()                        │
  │  (멀티 프로바이더 통합 라이브러리)       │
  ├──────────────────────────────────────────┤
  │  OpenAI  │ Anthropic │ Google │ Azure   │
  │  Perplexity │ Meta                      │
  └──────────────────────────────────────────┘
```

---

## Skill 목록

### 프롬프트 기반 Skill (SKILL.md)

| Skill 이름 | 버전 | 설명 | 사용 도구 |
|------------|------|------|----------|
| **geo-analysis** | v2.0.0 | 종합 GEO 평가 → 10-탭 대시보드 리포트 생성 | crawl_page, crawl_multiple_pages, score_geo, classify_site, extract_evaluation_data, run_synthetic_probes, analyze_brand_message, analyze_product_recognition, collect_evidence |

### 코드 기반 Skill (TypeScript 구현)

| 모듈 | 위치 | 설명 |
|------|------|------|
| **dual-crawl** | packages/skills/src/dual-crawl.ts | 정적 HTML + 렌더링 이중 크롤링 (최대 30페이지) |
| **geo-scorer** | packages/skills/src/geo-scorer.ts | GEO Readiness Score 계산 (7차원, S1~S7) |

---

## 기술 스택 요약

| 항목 | 선택 |
|------|------|
| 언어 | TypeScript (Node.js 20+) |
| 모노레포 | npm workspaces — core, skills, cli, dashboard |
| LLM 엔진 | @mariozechner/pi-ai (멀티 프로바이더) |
| DB | libSQL + drizzle-orm |
| 백엔드 API | Hono (localhost:3000) |
| CLI | Commander.js |
| 테스트 | vitest |
| 코드 품질 | Biome |
