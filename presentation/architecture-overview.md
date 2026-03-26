# GEO Agent System — Architecture Overview

## System Purpose

**GEO (Generative Engine Optimization)** Agent System은 LLM 서비스(ChatGPT, Claude, Gemini, Perplexity 등)가 Target Web Page의 데이터를 우선적으로, 정확하게 참조하도록 콘텐츠를 최적화하는 에이전트 시스템이다.

---

## Agent Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GEO Agent System                            │
│                                                                     │
│                    ┌───────────────────┐                            │
│                    │   Orchestrator    │                            │
│                    │   (중앙 조율자)   │                            │
│                    └────────┬──────────┘                            │
│                             │                                       │
│              ┌──────────────┼──────────────┐                       │
│              │              │              │                        │
│              ▼              ▼              ▼                        │
│  ┌───────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │   Analysis    │ │   Strategy   │ │ Optimization │              │
│  │   Agent       │ │   Agent      │ │   Agent      │              │
│  │               │ │              │ │              │              │
│  │ 사이트 크롤링 │ │ 분석 결과 → │ │ 로컬 클론에  │              │
│  │ GEO 점수 산출 │ │ 우선순위별   │ │ 최적화 수정  │              │
│  │ 구조화 데이터 │ │ 개선 전략    │ │ 적용         │              │
│  │ 평가          │ │ 수립         │ │              │              │
│  └───────┬───────┘ └──────────────┘ └──────┬───────┘              │
│          │                                  │                      │
│          │         ┌──────────────┐         │                      │
│          │         │  Validation  │         │                      │
│          └────────▶│  Agent       │◀────────┘                      │
│                    │              │                                 │
│                    │ 최적화 결과  │                                 │
│                    │ 검증 + 점수  │     ┌──────────────┐           │
│                    │ 재산출       │     │  Monitoring   │           │
│                    └──────────────┘     │  Agent        │           │
│                                        │  (미구현)     │           │
│                                        │              │           │
│                                        │ 주기적 GEO  │           │
│                                        │ 추적 + 이상 │           │
│                                        │ 감지         │           │
│                                        └──────────────┘           │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   Shared Infrastructure                      │   │
│  │  GeoLLMClient │ Database │ Clone Store │ Probe Engine       │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │                        │                    │
         ▼                        ▼                    ▼
  ┌──────────────┐        ┌──────────────┐     ┌──────────────┐
  │ Target Web   │        │ LLM Services │     │   Dashboard  │
  │ Page(s)      │        │ (OpenAI,     │     │ (Report +    │
  │ ★ 읽기 전용  │        │  Anthropic,  │     │  Archive)    │
  └──────────────┘        │  Google ...) │     └──────────────┘
                          └──────────────┘
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
| **Monitoring Agent** | 주기적 GEO 추적 | 정기 재분석, 외부 변경 감지, 점수 하락 알림 | 미구현 |

---

## Pipeline Flow

```
INIT → ANALYZING → CLONING → STRATEGIZING → OPTIMIZING → VALIDATING → REPORTING → COMPLETED
                                    ↑                          │
                                    └── 목표 미달 시 재시도 ───┘
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
