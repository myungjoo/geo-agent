# GEO Agent System Architecture

> **GEO (Generative Engine Optimization)**: LLM 서비스 및 AI 에이전트들이 Target Web Page의 데이터를 우선적으로, 정확하게 참조하도록 콘텐츠를 최적화하는 에이전트 시스템

---

## 1. 시스템 개요

### 1.1 목적

기존 SEO(Search Engine Optimization)가 검색 크롤러를 대상으로 했다면, GEO는 다음 대상을 위한 최적화를 목표로 한다:

- **LLM 서비스**: ChatGPT, Claude, Gemini, Perplexity, Copilot 등
- **AI 에이전트**: LLM API를 활용한 자동화 에이전트, RAG 파이프라인, Tool-use 에이전트 등
- **AI 검색**: Perplexity, Bing AI, Google AI Overview 등

### 1.2 핵심 가치

```
Target Web Page의 콘텐츠가 LLM이 질의에 응답할 때
  → 높은 빈도로 인용(Citation)되고
  → 정확하게 해석되며
  → 신뢰할 수 있는 출처로 참조되는 것
```

### 1.3 읽기 전용 원칙 (Read-Only Constraint)

> **본 시스템은 Target Web Page에 대한 직접 수정 권한이 없다.**

```
┌─ GEO 시스템의 접근 범위 ──────────────────────────────────────────┐
│                                                                     │
│  Target Web Page (원본)     → 읽기 전용 (Read-Only)                │
│    ├─ 초기 크롤링 및 분석만 수행                                     │
│    └─ 어떠한 경우에도 직접 수정하지 않음                              │
│                                                                     │
│  Local Clone (복제본)       → 읽기/쓰기 (Read-Write)               │
│    ├─ 원본을 로컬에 클론하여 작업 사본 생성                          │
│    ├─ 모든 최적화 수정은 클론에만 적용                               │
│    ├─ 재평가/재수정 루프는 클론 대상으로만 수행                      │
│    └─ 최종 결과: Before-After 리포트 + 수정된 Archive 파일 제공     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

이 원칙에 따라 시스템의 최적화 사이클은 다음과 같이 동작한다:

1. **초기 분석**: 원본 URL을 직접 크롤링하여 현재 상태 분석 및 GEO 점수 산출
2. **클론 생성**: 원본 페이지를 로컬 파일시스템에 클론 (Clone Manager)
3. **최적화 루프**: 클론에 대해 수정 → 재평가 → 재수정 반복
4. **결과 전달**: Before-After 비교 리포트 + 수정된 페이지 Archive 파일을 사용자에게 제공
5. **적용**: 사용자가 리포트를 검토한 뒤 원본 사이트에 수동 반영

---

## 2. 전체 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────────────┐
│                        GEO Agent System                              │
│                                                                      │
│  ┌─────────────────┐     ┌──────────────────────────────────────┐   │
│  │  Orchestrator   │────▶│           Agent Pipeline             │   │
│  │  (중앙 조율)    │     │                                      │   │
│  └─────────────────┘     │  1. Analysis Agent (분석)            │   │
│          │               │  2. Clone Manager (클론 생성)        │   │
│          │               │  3. Strategy Agent (전략 수립)       │   │
│          │               │  4. Optimization Agent (클론 수정)   │   │
│          │               │  5. Validation Agent (클론 검증)     │   │
│          │               │  6. Monitoring Agent (모니터링)      │   │
│          │               └──────────────────────────────────────┘   │
│          │                                                           │
│  ┌───────▼──────────────────────────────────────────────────────┐   │
│  │                    Shared Infrastructure                      │   │
│  │  Vector DB │ Knowledge Base │ Task Queue │ Metrics Store     │   │
│  │                                                               │   │
│  │  ┌─────────────────────────────────────────────────────┐    │   │
│  │  │         Change Tracking Store  (★ 핵심)              │    │   │
│  │  │  Content Snapshots │ Change Diffs │ GEO Time-series  │    │   │
│  │  └─────────────────────────────────────────────────────┘    │   │
│  │                                                               │   │
│  │  ┌─────────────────────────────────────────────────────┐    │   │
│  │  │         Local Clone Store  (★ 작업 사본)             │    │   │
│  │  │  Cloned HTML │ Modified Pages │ Result Archives      │    │   │
│  │  └─────────────────────────────────────────────────────┘    │   │
│  └───────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
          │                          │                    │
          ▼                          ▼                    ▼
  ┌───────────────┐          ┌───────────────────┐  ┌──────────────┐
  │  Target Web   │          │   LLM Services    │  │  사용자에게  │
  │  Page(s)      │          │  (테스트 대상)    │  │  결과 전달   │
  │  ★ 읽기 전용  │          └───────────────────┘  │  (Report +   │
  └───────────────┘                                  │   Archive)   │
                                                     └──────────────┘
```

---

## 3. Target Profile (대상 페이지 설정)

> 모든 Target 설정은 **localhost 웹 대시보드**에서 수행한다. CLI는 서비스 시작/중지만 담당한다.

### 3.0.1 Target Profile 스키마

사용자가 대시보드에서 입력하는 Target 정보의 구조:

```typescript
TargetProfile {
  // === 필수 입력 ===
  id              : UUID                     // 자동 생성
  url             : string                   // Target Web Page URL
  name            : string                   // 사용자 식별용 이름 (예: "메인 랜딩 페이지")

  // === 비즈니스 컨텍스트 (웹 UI에서 입력) ===
  description     : string                   // 이 페이지가 무엇인지 간략 설명
  brand           : string                   // 브랜드/조직명 (빈 문자열 기본)
  topics          : string[]                 // 핵심 주제/키워드 (예: ["클라우드 보안", "제로트러스트"])
  target_queries  : string[]                 // 이 페이지가 인용되길 원하는 LLM 질의 예시
                                             // (예: ["클라우드 보안 솔루션 추천해줘",
                                             //       "제로트러스트 구현 방법"])
  audience        : string                   // 타겟 오디언스 (예: "IT 보안 담당자")
  competitors     : CompetitorEntry[]        // 경쟁 페이지 목록 (아래 참조)
  business_goal   : string                   // 비즈니스 목표 자유 기술
                                             // (예: "B2B 리드 생성 랜딩 페이지로서 신뢰도 확보")
  target_score    : number | null            // 목표 GEO 점수 (0~100, null이면 미설정)
  site_type       : 'manufacturer'           // 사이트 유형 (Probe 프롬프트 선택 등에 활용)
                  | 'research'               // 기본값: 'generic'
                  | 'generic'

  // === LLM 설정 ===
  llm_priorities  : LLMPriority[]            // LLM별 중요도 (아래 참조)

  // === 클론 작업 경로 (시스템 자동 관리) ===
  clone_base_path : string | null            // 로컬 클론 저장 경로 (자동 설정)
                                             // 예: "workspace/clones/{target_id}/"
                                             // null이면 아직 클론 미생성

  // === 알림 설정 ===
  notifications   : {
    on_score_drop  : boolean                 // GEO 점수 하락 시 알림
    on_external_change: boolean              // 외부 변경 감지 시 알림
    on_optimization_complete: boolean        // 최적화 완료 시 알림
    channels       : ('dashboard' | 'email' | 'slack')[]
  }

  // === 자동 관리 ===
  created_at      : datetime
  updated_at      : datetime
  status          : 'active' | 'paused' | 'archived'
  monitoring_interval: string                // cron 표현식 또는 '6h', '12h', '24h'
}
```

**CompetitorEntry**:

```typescript
CompetitorEntry {
  url         : string           // 경쟁 페이지 URL
  name        : string           // 식별용 이름 (예: "B사 보안 솔루션 페이지")
  relationship: 'direct'         // 직접 경쟁
              | 'indirect'       // 간접 경쟁 (유사 주제, 다른 제품)
              | 'reference'      // 참고 대상 (벤치마킹)
}
```

**LLMPriority**:

```typescript
LLMPriority {
  llm_service : string           // 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | ...
  priority    : 'critical'       // 반드시 인용되어야 함
              | 'important'      // 인용 우선 대상
              | 'nice_to_have'   // 가능하면 인용
              | 'monitor_only'   // 모니터링만 (최적화 대상에서 제외)
}
```

### 3.0.2 대시보드 Target 설정 화면

```
┌──────────────────────────────────────────────────────────┐
│  localhost:3000/targets                                    │
│                                                           │
│  ┌─ Target 목록 ──────────────────────────────────────┐  │
│  │  [+ 새 Target 추가]                                │  │
│  │                                                     │  │
│  │  ● 메인 랜딩 페이지         GEO: 67  ▲+5  active  │  │
│  │    https://example.com/solutions                    │  │
│  │                                                     │  │
│  │  ● 기술 블로그 포스트        GEO: 42  ▼-3  active  │  │
│  │    https://example.com/blog/zero-trust              │  │
│  │                                                     │  │
│  │  ○ 이전 캠페인 페이지        GEO: 31      paused   │  │
│  │    https://example.com/campaign/2025                │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─ Target 상세 설정 (선택 시) ───────────────────────┐  │
│  │                                                     │  │
│  │  기본 정보          비즈니스 컨텍스트               │  │
│  │  ├ URL              ├ 핵심 주제/키워드               │  │
│  │  ├ 이름             ├ 타겟 질의 예시                 │  │
│  │  └ 설명             ├ 타겟 오디언스                  │  │
│  │                     └ 비즈니스 목표                  │  │
│  │                                                     │  │
│  │  경쟁 페이지         LLM 우선순위                   │  │
│  │  ├ [+ 추가]         ├ ChatGPT    [critical ▼]      │  │
│  │  ├ B사: direct      ├ Claude     [important ▼]     │  │
│  │  └ C사: indirect    ├ Gemini     [important ▼]     │  │
│  │                     ├ Perplexity [critical ▼]      │  │
│  │                     └ Copilot    [nice_to_have ▼]  │  │
│  │                                                     │  │
│  │  클론/결과 상태       알림 설정                      │  │
│  │  ├ 클론: [생성됨✅]  ├ ☑ 점수 하락                  │  │
│  │  ├ 경로: workspace/  ├ ☑ 외부 변경 감지             │  │
│  │  │  clones/{id}/     ├ ☑ 최적화 완료                │  │
│  │  └ [결과 다운로드]   └ 채널: [dashboard, slack]      │  │
│  │                                                     │  │
│  │  모니터링: [매 6시간 ▼]                             │  │
│  │                                                     │  │
│  │  [저장]  [분석 시작]  [최적화 실행]  [일시정지]     │  │
│  │  [정보 인식 항목 관리]  ← 자동 추출된 항목 검토/추가  │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 3.0.3 Target Profile의 에이전트 활용

Target Profile은 각 에이전트의 컨텍스트에 주입되어 전략 결정에 활용된다:

```
TargetProfile
    │
    ├─▶ Analysis Agent
    │     topics, url → 분석 범위 결정
    │     competitors → 경쟁 페이지 병행 분석
    │
    ├─▶ Strategy Agent
    │     target_queries → 질의 설계의 기반
    │     llm_priorities → 최적화 우선순위 LLM 결정
    │     business_goal → 전략 방향 설정
    │     audience → 콘텐츠 톤/수준 결정
    │
    ├─▶ Optimization Agent
    │     clone_base_path → 수정 대상 로컬 클론 경로
    │     topics → 강화할 키워드/주제 영역
    │
    ├─▶ Validation Agent
    │     target_queries → 테스트 질의 세트의 시드
    │     llm_priorities → 테스트 대상 LLM 및 가중치
    │     competitors → 비교 측정 대상
    │
    └─▶ Monitoring Agent
          monitoring_interval → 체크 주기
          notifications → 알림 트리거 조건
          competitors → 경쟁 변화 감시 대상
```

### 3.0.4 REST API

```
# ── Target CRUD ──
POST   /api/targets                                  # 새 Target 생성
GET    /api/targets                                  # Target 목록 조회
GET    /api/targets/{id}                             # Target 상세 조회
PUT    /api/targets/{id}                             # Target 수정
DELETE /api/targets/{id}                             # Target 삭제

# ── Pipeline 실행 (Target 하위) ──
GET    /api/targets/{id}/pipeline                    # 파이프라인 목록
POST   /api/targets/{id}/pipeline                    # 파이프라인 생성 (?execute=true&probe_mode=single|multi)
GET    /api/targets/{id}/pipeline/latest             # 최신 파이프라인 조회
GET    /api/targets/{id}/pipeline/{pid}              # 특정 파이프라인 조회
DELETE /api/targets/{id}/pipeline/{pid}              # 파이프라인 삭제
PUT    /api/targets/{id}/pipeline/{pid}/stage        # 스테이지 변경

# ── Stage Executions ──
GET    /api/targets/{id}/pipeline/{pid}/stages       # 스테이지 실행 목록
GET    /api/targets/{id}/pipeline/{pid}/stages/{sid} # 스테이지 실행 상세
GET    /api/targets/{id}/pipeline/{pid}/evaluation   # 평가 데이터 (점수/차원/페이지별)
GET    /api/targets/{id}/pipeline/{pid}/llm-log     # LLM 호출 전체 로그

# ── Cycle 제어 ──
POST   /api/targets/{id}/cycle/stop                  # 수동 중단
GET    /api/targets/{id}/cycle/status                # 현재 사이클 상태

# ── Agent Prompts ──
GET    /api/settings/agents/prompts                  # 전체 에이전트 프롬프트
GET    /api/settings/agents/prompts/{agent_id}       # 특정 에이전트 프롬프트
PUT    /api/settings/agents/prompts/{agent_id}       # 프롬프트 수정
POST   /api/settings/agents/prompts/{agent_id}/reset # 기본값 복원
POST   /api/settings/agents/prompts/reset-all        # 전체 기본값 복원
GET    /api/settings/agents/prompts/{agent_id}/default # 기본 프롬프트 조회

# ── LLM Provider 설정 ──
GET    /api/settings/llm-providers                   # 전체 프로바이더 목록
GET    /api/settings/llm-providers/{provider_id}     # 특정 프로바이더 조회
PUT    /api/settings/llm-providers/{provider_id}     # 프로바이더 설정 수정
POST   /api/settings/llm-providers/{provider_id}/enable   # 활성화
POST   /api/settings/llm-providers/{provider_id}/disable  # 비활성화
POST   /api/settings/llm-providers/{provider_id}/reset    # 기본값 복원
POST   /api/settings/llm-providers/reset-all              # 전체 기본값 복원

# ── [미구현] Change Tracking, OAuth — 섹션 4-B.7, 9-B.3 참조 ──

# ── 시스템 ──
POST   /api/shutdown                                 # 서버 종료
GET    /api/version                                  # 버전 정보 (git SHA)

# ── Dashboard UI ──
GET    /dashboard                                    # HTML SPA 서빙
GET    /health                                       # 헬스 체크
```

---

## 4. 에이전트 구성 및 역할

### 4.1 Orchestrator

- 전체 파이프라인의 실행 순서와 상태를 관리
- 각 에이전트에 태스크를 분배하고 결과를 수집
- **TargetProfile을 로드하여 각 에이전트 컨텍스트에 주입**
- **초기 분석 후 Clone Manager를 통해 원본 페이지를 로컬에 클론**
- **반복(iteration) 루프는 클론 대상으로만 수행** (원본 URL 접근 금지)
- 최적화 완료 시 Before-After 비교 리포트 + Archive 생성을 트리거
- 긴급 롤백 및 에러 핸들링 담당 (클론에 대한 롤백)

### 4.2 Analysis Agent (분석 에이전트)

**목적**: Target Web Page의 현재 상태를 다각도로 분석하여 GEO 점수를 산출한다. 두 가지 모드로 동작한다.

| 모드 | 호출 시점 | 입력 소스 | 설명 |
|---|---|---|---|
| **초기 분석** (URL 모드) | 파이프라인 ANALYZING 스테이지 | 원본 URL (HTTP 크롤링) | 최초 1회 전체 분석 |
| **클론 분석** (Clone 모드) | Validation Agent 호출 시 | 로컬 클론 파일 (fs 읽기) | 최적화 후 재평가 |

**클론 모드 입력 인터페이스**: `AnalysisDeps.crawlTarget`을 호출자(Validation Agent)가 로컬 파일 리더 함수로 교체 주입한다. `AnalysisInput`에 `mode: 'url' | 'clone'` 플래그를 추가하여 모드를 구분하고, Pipeline이 `clone_base_path`를 DB에 저장하여 Validation Agent가 이를 읽어 deps를 구성한다. Analysis Agent 내부 로직은 모드에 무관하게 동일한 분석 파이프라인을 실행한다.

#### 수행 작업

**(1) 정적 분석** (두 모드 공통):
- 페이지 크롤링 및 콘텐츠 추출 (HTML, 구조화 데이터, 메타데이터)
- Schema.org / JSON-LD 마크업 감사
- 콘텐츠 밀도, 명확성, 인용 가능성 점수 산출
- 경쟁 페이지 대비 GEO 격차 분석
- LLM별 인덱싱 현황 파악 (`robots.txt`, `llms.txt`, `sitemap.xml`)
  - Clone 모드에서 해당 파일이 클론에 없으면 원본 URL에서 fetch
- **기계 가독성 감사 (Machine Readability Audit)** — 아래 4.2-A 참조
- **핵심 정보 자동 추출**: JSON-LD + 본문에서 제품/가격/스펙/정책 등 자동 추출 → `InfoRecognitionItem[]` 생성
- 제조사 사이트의 경우 제품 페이지를 탐색하여 크롤링 대상에 포함

**(2) LLM Probe 테스트** (두 모드 공통, Available한 모든 LLM 사용):

> **Web Search 원칙**: 프로브는 실제 소비자가 LLM 서비스를 사용하는 환경을 재현한다.
> 각 LLM에 **웹 검색(Web Search) 기능을 활성화**한 상태로 질의하여,
> LLM이 Target 사이트를 실시간 조회하고 정보를 가져다 쓸 수 있는지를 직접 측정한다.
>
> | Provider | Web Search 활성화 방식 |
> |----------|----------------------|
> | OpenAI (ChatGPT) | `web_search` tool 활성화 |
> | Perplexity | 기본 동작 (항상 웹 검색) |
> | Google (Gemini) | `google_search_retrieval` grounding |
> | Anthropic (Claude) | `web_search` tool 활성화 |
> | Microsoft (Azure) | Bing grounding (가용 시) |
>
> Web Search를 지원하지 않는 Provider/모델은 학습 데이터 기반으로 fallback하되,
> 결과에 `web_search_used: false`를 명시하여 해석 시 구분한다.

- **멀티 프로바이더 실행**: API Key가 설정된 **모든 활성 프로바이더**에 동일 프로브를 병렬 실행하고, 서비스별 결과를 개별 기록한다. Dashboard에서 `probe_mode`를 `single`(단일 프로바이더) 또는 `multi`(전체 활성 프로바이더 병렬, 3-레이어 비교) 중 선택 가능하며, 기본값은 `single`이다
- **페이지 정보 추출 프로브**: 대상 페이지의 HTML 핵심 구조(JSON-LD + meta + heading + 본문 요약)를 LLM 프롬프트에 직접 포함하여, LLM이 주요 정보를 정확히 추출하는지 테스트
- **Entity 프로브**: 브랜드/회사/Entity 이름으로 질의 (예: "삼성전자에 대해 알려줘"). 이때 대상 페이지의 HTML 요약을 함께 제공하여 LLM이 참조할 수 있도록 한다. 프로브 결과에서 **"제공된 HTML에서 인용한 정보"**와 **"LLM 자체 지식에서 온 정보"**를 구분 태깅하여, 최적화 전후 HTML 변경이 LLM 응답에 미치는 영향을 정밀 측정한다
- 프로브는 사이트 종류별로 8건 이상 수행. 프롬프트는 실제 사용자가 해당 페이지에 관해 물어볼 만한 질문으로 구성
- 프로브 프롬프트는 사이트 종류별 기본값이 제공되며, 사용자가 커스터마이징 가능 (Reset으로 기본값 복원)
- **서비스별 점수 합산**: 각 프로바이더의 프로브 결과를 `llm_priorities` 가중치에 따라 합산하여 Coverage 점수 및 종합 GEO Score를 산출한다

**(3) 결과 저장**:
- 모든 평가 결과는 `pipeline_id` + `stage` + `cycle` 기준으로 DB에 별도 저장
- 여러 사이클에서 반복 수행되므로, 각 수행 간 결과를 독립 보관하여 단계별 변화 추적 가능
- LLM probe의 prompt input/output도 저장 (길이 초과 시 truncation 허용)
- Evaluation 탭에서 전체 상세 조회 가능

#### 프로브 프롬프트 관리

```
기본값 저장:  evaluation-templates/probes/{site_type}-probes.json
              (manufacturer-probes.json, research-probes.json, generic-probes.json)

사용자 커스텀: DB 테이블에 오버라이드 저장 (site_type + probe_id 키)

로딩 우선순위: DB 커스텀 > 파일 기본값
Reset 동작:   DB 오버라이드 삭제 → 파일 기본값 복원
```

**출력**:
- `RichAnalysisReport` (10-tab 구조화 보고서, `rich-analysis-schema.ts`) — overview, crawlability, structured_data, products, brand, pages, recommendations, evidence, probes, roadmap
- LLM probe input/output 로그 (DB 저장)
- 크롤링된 페이지 목록 (URL 또는 클론 파일 경로)

#### 4.2-A. 기계 가독성 감사 (Machine Readability Audit)

Target Page가 과도한 `<div>` 중첩이나 JavaScript 의존으로 인해 LLM 크롤러가 콘텐츠를 제대로 수집하지 못하는 경우, 이후의 모든 GEO 최적화는 무의미하다. 따라서 Analysis Agent는 **최적화에 앞서** 기계 가독성을 진단한다.

**(1) 크롤링 및 JS 의존도 분석**

Node.js 내장 fetch로 정적 HTML을 크롤링하고, HTML + robots.txt + llms.txt + sitemap.xml을 병렬 수집한다. 멀티 페이지 크롤링(`crawlMultiplePages()`)은 depth 1~3으로 탐색하며, 제품/카테고리 URL을 우선하여 최대 30페이지까지 수집한다.

```
크롤링: Node.js fetch (정적 HTML, JS 미실행)
  → LLM 크롤러(GPTBot, ClaudeBot 등)가 보는 것에 근사

멀티 페이지 크롤링:
  depth=1: 홈페이지에서 넓은 탐색 (최대 maxPages)
  depth=2: 제품/카테고리 페이지에서 2-3개 하위 링크 (PDP 도달)
  depth=3: JSON-LD 있는 페이지에서 1-2개 상세 링크
  동시 5개 병렬 처리, 제품 URL 패턴 우선

JS 의존도 추정:
  js_dependency_ratio = analyzeJsDependency(html)
  → script 태그 수/크기 비율 + 외부 스크립트 수 기반 추정
  → 0에 가까울수록 양호, 0.5 이상이면 위험
```

> **향후 확장**: Playwright 기반 JS 실행 크롤링을 추가하여, 정적 크롤링(현재)과 풀 렌더링 크롤링을 비교하는 이중 크롤링 모드를 구현할 예정. 이를 통해 `js_dependency_ratio = 1 - (len(text_static) / len(text_rendered))`로 정밀 산출이 가능해진다.

**(2) DOM 구조 품질 점수 (Structure Quality Score)**

```
StructureQuality {
  semantic_tag_ratio     : number    // 시맨틱 태그 / 전체 태그 비율 (0~1)
                                     // <article>, <section>, <main>, <nav>,
                                     // <header>, <footer>, <aside>, <figure>
                                     // 0.3 이상 양호, 0.1 미만 불량

  div_nesting_depth      : number    // 최대 div 중첩 깊이 (정수)
                                     // 15 이상이면 파싱 위험

  text_to_markup_ratio   : number    // 순수 텍스트 / HTML 전체 크기
                                     // 0.3 이상 양호, 0.1 미만 불량

  heading_hierarchy_valid: boolean   // H1→H2 계층 존재 여부
}
```

**(3) AI 크롤러 접근성 테스트**

robots.txt를 정적 파싱하여 주요 AI 크롤러의 허용/차단 상태를 분석한다 (`parseRobotsTxt()`, `analyzePathAccess()`).

```
테스트 대상 User-Agent:
  - GPTBot           (OpenAI — ChatGPT)
  - OAI-SearchBot    (OpenAI — ChatGPT Search)
  - ChatGPT-User     (OpenAI — ChatGPT 브라우징)
  - ClaudeBot        (Anthropic)
  - Google-Extended   (Google — Gemini / AI Overview)
  - PerplexityBot    (Perplexity AI)
  - Applebot         (Apple Intelligence)
  - Meta-ExternalAgent (Meta AI)

확인 항목:
  - robots.txt에서 해당 봇의 Disallow/Allow 규칙
  - 봇별 허용/차단/부분/미명시 상태 판정
  - 차단 경로 상세 분석 (analyzePathAccess)
  - llms.txt 존재 여부 및 내용
  - sitemap.xml 존재 여부
```

**(4) 기계 가독성 종합 등급**

```
MachineReadabilityGrade:
  A: JS 의존도 낮음 + 시맨틱 구조 양호 + 크롤러 미차단
  B: 일부 개선 필요하나 핵심 콘텐츠는 접근 가능
  C: JS 의존도 높거나 시맨틱 구조 불량 — 최적화 전 구조 개선 필요
  F: SPA + 크롤러 차단 — GEO 최적화 불가, 근본 해결 선행 필수
```

등급이 C 이하인 경우, Strategy Agent는 콘텐츠 최적화보다 **구조 개선을 우선 태스크**로 배치한다.

### 4.3 Strategy Agent (전략 수립 에이전트)

**목적**: 분석 결과를 바탕으로 GEO 최적화 전략을 수립

**수행 작업**:
- GEO 점수 기반 우선순위 태스크 도출
- 타겟 LLM 서비스별 특성에 맞는 전략 커스터마이징
- 콘텐츠 수정, 구조 변경, 메타데이터 추가 계획 수립
- A/B 테스트 시나리오 설계
- ROI 예측 및 실행 로드맵 생성

**전략 수립 제약**:

| 규칙 | 설명 |
|------|------|
| **데이터 우선** | 과거에 효과가 입증된 변경 유형을 우선 채택 |
| **실패 회피** | Agent Memory의 negative patterns에 해당하는 유형은 명시적 사유 없이 채택 금지 |
| **LLM 우선순위 반영** | `llm_priorities`에서 critical/important인 LLM을 우선 고려 |
| **정보 인식 개선** | InfoRecognition에서 missing/hallucinated 항목은 우선 최적화 대상 |

**출력**: `OptimizationPlan` (우선순위 정렬된 태스크 목록)

### 4.4 Optimization Agent (최적화 실행 에이전트)

**목적**: 전략에 따라 **로컬 클론**의 콘텐츠를 최적화

> **읽기 전용 원칙**: 원본 Target Web Page는 절대 수정하지 않는다. 모든 수정은 `clone_base_path`의 로컬 클론에만 적용한다.

**실행 제약**:

| 규칙 | 설명 |
|------|------|
| **정보 정확성 보존** | 기존 정확한 정보(가격, 스펙, 연락처 등)를 변경하지 않는다 |
| **1태스크 1변경** | 각 OptimizationTask마다 별도의 ChangeRecord를 생성 |
| **diff 필수** | 모든 변경은 before/after diff를 명시적으로 기록 |

**수행 작업**:

| 최적화 영역 | 세부 작업 |
|---|---|
| **기계 가독성 개선** (등급 C 이하 시 최우선) | 아래 4.4-A 참조 |
| 구조화 데이터 | Schema.org JSON-LD 생성/수정, FAQ/HowTo/Article 마크업 |
| 콘텐츠 강화 | 팩트 밀도 향상, 인용 가능한 통계·수치 삽입, 권위 있는 출처 연결 |
| 시맨틱 구조 | 명확한 H1-H6 계층, 논리적 단락 구조, 핵심 개념 강조 |
| AI 접근성 | AI 크롤러 허용 `robots.txt` 설정, `llms.txt` 생성 (실험적 — 아래 주의사항 참조) |
| 메타데이터 | OG 태그, 메타 설명, 캐노니컬 URL 최적화 |
| 콘텐츠 청킹 | LLM 컨텍스트 윈도우에 맞는 정보 단위 구조화 |
| 신뢰 시그널 | 저자 정보(E-E-A-T), 날짜/업데이트 명시, 출처 인용 강화 |

**출력**: 로컬 클론에 적용된 수정 HTML/콘텐츠 패치, 구조화 데이터 파일, ChangeRecord

#### 4.4-A. 기계 가독성 개선 (Machine Readability Remediation)

Analysis Agent의 기계 가독성 등급이 C 이하인 경우, 콘텐츠 최적화에 앞서 구조 개선을 우선 실행한다. 등급별 대응 전략:

**등급 C (JS 의존도 높거나 시맨틱 구조 불량)**:

| 대응 | 설명 |
|---|---|
| div → 시맨틱 태그 전환 | `<div class="article">` → `<article>`, `<div class="nav">` → `<nav>` 등 매핑 규칙 기반 패치 생성 |
| heading 계층 정규화 | H1→H2→H3 순서 교정, 장식용 heading 제거 |
| `<main>` 랜드마크 추가 | 본문 영역을 `<main>`으로 감싸서 크롤러가 핵심 콘텐츠를 식별하도록 함 |
| JSON-LD 구조화 데이터 추가 | 구조 개선이 완료되기 전에도 핵심 정보를 기계 가독 형태로 즉시 제공 |
| llms.txt 병행 생성 (보조) | 저비용으로 클린 텍스트 버전 생성 — 단, 효과 미검증이므로 보조 수단으로만 취급 |

**등급 F (SPA + 크롤러 차단)**:

| 대응 | 설명 |
|---|---|
| SSR/Pre-rendering 권고 | 직접 적용 불가 시 권고 리포트 생성 (Next.js SSR, Prerender.io 등 구체적 방안 포함) |
| Dynamic Rendering 권고 | AI 크롤러 User-Agent 감지 시 pre-rendered HTML 제공하는 서버 설정 가이드 |
| robots.txt 차단 해제 | GPTBot, ClaudeBot 등이 차단되어 있는 경우 해제 패치 생성 |
| JSON-LD 우회 전략 | 페이지 본문이 JS 종속이더라도 JSON-LD는 초기 HTML에 포함 가능 — 핵심 정보를 구조화 데이터로 전달 |
| llms.txt 병행 생성 (보조) | 저비용으로 생성하되, 효과 미검증이므로 JSON-LD와 SSR/Pre-rendering을 우선 |
| 콘텐츠 API 엔드포인트 권고 | Tool-use 에이전트 대상으로 구조화된 API 제공 권고 |

**우선순위 원칙**: 기계 가독성 등급이 C 이하이면, `ChangeType.SEMANTIC_STRUCTURE` 태스크가 다른 모든 최적화 태스크보다 우선한다. 콘텐츠를 읽을 수 없는 상태에서 콘텐츠 품질을 개선하는 것은 무의미하기 때문이다.

#### 4.4-B. llms.txt에 대한 주의사항

> **현황 (2026-03 기준)**: llms.txt는 2024년 제안된 규격으로, LLM 서비스에게 사이트의 구조와 핵심 콘텐츠를 알려주기 위한 표준 파일이다. 그러나 주요 LLM 서비스(ChatGPT, Claude, Gemini, Perplexity 등)가 이를 실제로 크롤링하고 활용한다는 **공개된 증거가 없다.**

본 시스템에서 llms.txt의 취급 원칙:

| 원칙 | 설명 |
|---|---|
| **보조 수단으로만 취급** | llms.txt를 주요 최적화 전략으로 의존하지 않는다 |
| **낮은 비용으로 적용** | 생성 자체는 저비용이므로 "있으면 좋은 것" 수준으로 적용 |
| **효과 측정 대상** | Change Tracking에서 llms.txt 추가의 실제 효과를 데이터로 검증 |
| **검증된 수단 우선** | robots.txt, JSON-LD, 시맨틱 HTML, 메타데이터 등 효과가 입증된 기술을 항상 우선 |

llms.txt의 채택 현황은 Monitoring Agent가 주기적으로 확인하며, 주요 LLM 서비스에서 실제 활용이 확인되면 전략 우선순위를 상향 조정한다.

### 4.5 Validation Agent (검증 에이전트)

**목적**: 최적화된 로컬 클론의 품질을 **Analysis Agent를 호출하여** 초기 분석과 동일한 수준으로 재평가하고, Before-After 비교를 통해 추가 사이클 필요 여부를 판정한다.

> **핵심 설계**: Validation Agent는 자체적으로 분석하지 않는다. Analysis Agent를 **Clone 모드**로 호출하여 full analysis를 위임하고, 그 결과를 초기 분석(baseline)과 비교하는 **오케스트레이션 역할**에 집중한다.

**수행 작업**:

**(1) Analysis Agent 호출 (Clone 모드)**:
- Pipeline DB에서 `clone_base_path`를 읽어 `AnalysisDeps.crawlTarget`을 로컬 파일 리더로 교체 주입
- Analysis Agent를 `mode: 'clone'`으로 호출하여 초기 분석과 동일한 전체 분석 수행:
  - 정적 분석 (DOM 구조, JSON-LD, 콘텐츠 밀도, 기계 가독성 등급)
  - LLM Probe 테스트 (페이지 정보 추출 + Entity 프로브)
  - 멀티 페이지 재채점 (해당 시)
- 클론에 없는 파일 (robots.txt, llms.txt 등)은 Analysis Agent가 원본 URL에서 자동 fetch

**(2) Before-After 비교**:
- 초기 분석(baseline) `AnalysisReport`와 클론 분석 `AnalysisReport`를 대조
- 차원별 점수 delta 산출 (7차원 각각)
- LLM Probe 결과 비교: 동일 프로브 프롬프트의 초기/클론 응답 대조
  - 인용 정확도 변화, 정보 추출률 변화, HTML 인용 비율 변화 등
- `ContentSnapshot(after)` + `ChangeImpact` 저장

**(3) 사이클 제어 판정**:
- 자동 중단 조건:
  - `score_sufficient`: 점수 ≥ 목표 (기본 80)
  - `no_more_improvements`: delta < 2점 (사이클 > 0)
  - `max_cycles`: 최대 사이클 도달 (기본 10)
  - `llm_verdict_worse`: LLM 품질 평가에서 악화 판정 (confidence ≥ 0.7)
- 수동 중단: Dashboard에서 사용자가 트리거

**(4) 예측 효과 산출**:
- 구조적 개선 수치를 기반으로 LLM 인용률 개선 예측치 산출
- Agent Memory의 과거 ChangeImpact 데이터 참조하여 예측 신뢰도 보강

**(5) 결과 저장**:
- 모든 결과는 `pipeline_id` + `cycle` 기준으로 DB에 독립 저장
- 각 사이클별 full AnalysisReport가 보관되므로, Evaluation 탭에서 사이클 간 변화 추이 조회 가능

**출력**: `ValidationReport` (Before-After AnalysisReport 비교, 차원별 delta, LLM Probe 비교, 사이클 판정, 예측 효과)

### 4.6 Monitoring Agent (모니터링 에이전트)

**목적**: 지속적으로 GEO 성과를 추적하고 이상 감지

**수행 작업**:
- 주기적 LLM 질의를 통한 인용률 트래킹
- LLM 서비스 업데이트 감지 및 영향 분석
- 경쟁 페이지의 GEO 변화 모니터링
- 알람 및 자동 재최적화 트리거

---

## 4-A. 에이전트 시스템 프롬프트 (System Instruction)

> 각 에이전트의 시스템 프롬프트는 **추천 기본값(default)**이 내장되어 있으며,
> 사용자가 대시보드에서 자유롭게 수정할 수 있다. **[Reset to Default]** 버튼으로 언제든 초기값 복원 가능.

### 4-A.1 설계 원칙

```
┌─ System Instruction 관리 구조 ─────────────────────────────────┐
│                                                                 │
│  코드 내장 (immutable)         사용자 커스텀 (mutable)           │
│  ┌──────────────────┐         ┌──────────────────┐             │
│  │ DEFAULT_PROMPTS  │ ──────▶ │ workspace/       │             │
│  │ (packages/core/  │  초기   │  prompts/        │             │
│  │  prompts/*.ts)   │  복사   │  {agent}.json    │             │
│  └──────────────────┘         └──────────────────┘             │
│         │                            │                          │
│   [Reset to Default]           [대시보드 편집]                   │
│   버튼 클릭 시                  저장 시 즉시 반영                 │
│   DEFAULT → workspace 덮어쓰기                                  │
│                                                                 │
│  에이전트 실행 시 로드 순서:                                      │
│   1. workspace/prompts/{agent}.json 존재 → 사용                 │
│   2. 없으면 → DEFAULT_PROMPTS fallback                          │
└─────────────────────────────────────────────────────────────────┘
```

### 4-A.2 시스템 프롬프트 저장 스키마

```typescript
AgentPromptConfig {
  agent_id           : string          // 'orchestrator' | 'analysis' | 'strategy'
                                       // | 'optimization' | 'validation' | 'monitoring'
  display_name       : string          // UI 표시용 이름
  system_instruction : string          // 시스템 프롬프트 본문
  context_slots      : ContextSlot[]   // 동적 주입 슬롯 목록
  model_preference   : string | null   // 에이전트별 모델 선호 (null이면 시스템 기본값)
  temperature        : number          // 0~1, 기본값 0.3
  is_customized      : boolean         // 사용자가 수정했는가 (Reset 버튼 표시용)
  last_modified      : string          // ISO 8601 datetime
}

ContextSlot {
  slot_name          : string          // 예: '{{TARGET_PROFILE}}'
  description        : string          // 슬롯 설명
  source             : string          // 데이터 소스 (예: 'TargetProfile JSON')
  required           : boolean
}
```

### 4-A.3 기본 시스템 프롬프트 (Default Prompts)

6개 에이전트(Orchestrator, Analysis, Strategy, Optimization, Validation, Monitoring)의 기본 프롬프트는 `packages/core/src/prompts/defaults.ts`에 정의되어 있다. 각 프롬프트의 구조:

- **역할 정의**: 에이전트의 목적과 책임
- **컨텍스트 슬롯**: `{{TARGET_PROFILE}}`, `{{PIPELINE_STATE}}` 등 실행 시 동적 주입
- **행동 규칙**: 에이전트별 판단 기준과 제약
- **출력 형식**: 해당 데이터 타입 참조 (4-C 섹션)

### 4-A.4 컨텍스트 슬롯 (Context Slot) 정의

에이전트 실행 시 시스템 프롬프트의 `{{슬롯}}`에 실제 데이터가 주입된다.

| 슬롯 | 주입 데이터 | 사용 에이전트 |
|---|---|---|
| `{{TARGET_PROFILE}}` | TargetProfile JSON (섹션 3) | 전체 |
| `{{PIPELINE_STATE}}` | 현재 파이프라인 진행 상태 | Orchestrator |
| `{{CLONE_INFO}}` | 클론 경로, 클론 생성 시각, 원본 URL 매핑 | Optimization, Validation |
| `{{ANALYSIS_REPORT}}` | AnalysisReport JSON (4-C.5) | Strategy |
| `{{ANALYSIS_HISTORY}}` | 이전 분석 결과 요약 | Analysis |
| `{{OPTIMIZATION_PLAN}}` | OptimizationPlan JSON (4-C.6) | Optimization |
| `{{CURRENT_SNAPSHOT}}` | ContentSnapshot — 클론의 현재 상태 (4-B.2) | Optimization |
| `{{CHANGE_RECORDS}}` | ChangeRecord[] (4-B.3) | Validation |
| `{{SCORE_BEFORE}}` | 변경 전 GeoScore 기준선 (4-C.2) | Validation |
| `{{ACTIVE_TARGETS}}` | 모니터링 대상 TargetProfile[] | Monitoring |
| `{{AVAILABLE_TOOLS}}` | 에이전트별 사용 가능 Tool 목록 | 전체 |

---

## 4-B. Change Tracking 시스템 (변경 효과 추적)

> **핵심 질문**: "어떤 콘텐츠 변경이 GEO 점수를 얼마나 바꿨는가?"

### 4-B.1 설계 원칙

```
변경(Change)  →  측정(Measure)  →  귀인(Attribution)  →  학습(Learn)
     │                │                   │                    │
  무엇을             얼마나             왜 바뀌었는가          다음 전략에
  바꿨는가          바뀌었는가                                   반영
```

모든 콘텐츠 변경은 **명시적 실험(experiment)** 단위로 관리된다.
변경 → 측정 → 귀인의 인과관계를 데이터로 추적하여, 어떤 유형의 변경이 어떤 LLM에서 얼마나 효과적인지 학습한다.

### 4-B.2 Content Snapshot (콘텐츠 스냅샷)

변경 전/후 페이지 상태를 버전으로 저장한다.

```
ContentSnapshot {
  snapshot_id     : string              // UUID
  url             : string
  captured_at     : string              // ISO 8601 datetime
  html_hash       : string              // 변경 감지용 해시
  content_text    : string              // 순수 텍스트 추출본
  structured_data : Record<string, unknown>  // JSON-LD, 메타데이터
  geo_score       : GeoScore            // 해당 시점 GEO 점수
  llm_responses   : LLMProbe[]          // 해당 시점 LLM 질의 결과
}
```

### 4-B.3 Change Record (변경 기록)

Optimization Agent가 변경을 적용할 때 반드시 Change Record를 생성한다.

```
ChangeRecord {
  change_id       : string              // UUID
  experiment_id   : string              // UUID, 연관 실험 묶음
  url             : string
  target_id       : string | null       // Target UUID (nullable — 하위 호환)
  changed_at      : string              // ISO 8601 datetime
  change_type     : ChangeType          // 아래 분류 참고
  change_summary  : string              // 변경 내용 자연어 요약
  diff            : string              // unified diff 형식 텍스트
  snapshot_before : string              // snapshot_id (UUID)
  snapshot_after  : string | null       // snapshot_id, 측정 완료 후 채워짐
  triggered_by    : 'auto' | 'manual' | 'scheduled'
  strategy_ref    : string              // optimization_plan_id (UUID)
}
```

**ChangeType 분류**:

| 코드 | 설명 |
|---|---|
| `CONTENT_DENSITY` | 팩트·통계·수치 추가 |
| `SEMANTIC_STRUCTURE` | 제목 계층, 단락 구조 변경 |
| `SCHEMA_MARKUP` | JSON-LD / Schema.org 추가·수정 |
| `LLMS_TXT` | llms.txt 생성·수정 (실험적 — 효과 검증 목적으로 추적) |
| `FAQ_ADDITION` | FAQ 섹션 추가 |
| `AUTHORITY_SIGNAL` | 저자·날짜·출처 신뢰 시그널 강화 |
| `METADATA` | OG 태그, 메타 설명 변경 |
| `CONTENT_CHUNKING` | 단락 분절 구조 변경 |
| `EXTERNAL` | 시스템 외부에서 발생한 변경 (감지됨) |

### 4-B.4 GEO Time-Series (시계열 추적)

```
GeoTimeSeries {
  url           : string
  llm_service   : string          // 'chatgpt' | 'claude' | 'gemini' | ...
  measured_at   : string          // ISO 8601 datetime
  geo_score     : number
  citation_rate : number
  citation_rank : number | null
  change_id     : string | null   // UUID, 직전 변경과 연결
  delta_score   : number          // 직전 측정 대비 점수 변화
}
```

이 시계열 데이터로 다음을 도출한다:

- **변경 직후 효과**: 변경 전 N회 평균 vs 변경 후 N회 평균
- **지연 효과**: LLM 인덱스 갱신 지연(lag)을 고려한 시차 분석
- **지속성**: 효과가 얼마나 오래 유지되는지 (감쇠 곡선)

### 4-B.5 Impact Attribution (효과 귀인)

각 Change Record에 대해 Validation Agent가 Before-After AnalysisReport 비교를 통해 다음을 산출한다.

```
ChangeImpact {
  change_id          : string              // UUID
  measured_at        : string              // ISO 8601 datetime
  score_before       : number              // 변경 전 GEO 점수 (3회 평균)
  score_after        : number              // 변경 후 GEO 점수 (3회 평균)
  delta              : number              // score_after - score_before
  delta_pct          : number              // 변화율 (%)
  per_llm_impact     : Record<string, number>  // LLM 서비스별 점수 변화
  confidence         : number              // 통계적 신뢰도 (0~1)
  confounders        : string[]            // 동시 발생 변경 등 교란 요인
  verdict            : 'positive' | 'negative' | 'neutral'
}
```

**신뢰도(confidence) 산출 방식**:
- 측정 횟수가 많을수록 높음
- 동시에 다른 변경이 없을수록 높음 (단일 변수 원칙)
- 결과의 분산이 낮을수록 높음

### 4-B.6 외부 변경 감지 (External Change Detection)

시스템이 적용하지 않은 변경도 감지하여 추적한다.

- Monitoring Agent가 주기적으로 페이지 해시를 체크
- 해시 변경 감지 시 → 자동으로 `ChangeType.EXTERNAL` 레코드 생성
- 변경 diff 추출 후 Impact 측정 파이프라인 트리거
- 관리자에게 알림 발송 (의도치 않은 GEO 저하 조기 경보)

### 4-B.7 Change History API

```
# Target ID 기반 접근 (권장 — Target Profile과 연동)
GET  /targets/{target_id}/tracking/history          # 전체 변경 이력 목록
GET  /targets/{target_id}/tracking/history/{id}     # 특정 변경 상세 (diff 포함)
GET  /targets/{target_id}/tracking/timeline         # GEO 점수 시계열 그래프 데이터
GET  /targets/{target_id}/tracking/impact-summary   # 변경 유형별 평균 효과 요약
GET  /targets/{target_id}/tracking/best-changes     # 효과 상위 변경 TOP-N
GET  /tracking/insights                              # 전체 Target 대상 변경 효과 인사이트
```

### 4-B.8 Agent Memory Layer (에이전트 기억 계층)

> **핵심 질문**: "에이전트가 다음 액션 결정 시 과거 효과를 실제로 어떻게 참조하는가?"

현재 ChangeImpact 데이터가 존재해도, 에이전트가 그것을 **어떤 형태로 쿼리하고 컨텍스트에 주입하는지**가 없으면 학습이 일어나지 않는다. 이를 위해 **Agent Memory Layer**를 별도로 정의한다.

#### (1) 구조적 기억: EffectivenessIndex

ChangeImpact를 집계하여 에이전트가 빠르게 조회할 수 있는 인덱스를 유지한다.

```
EffectivenessIndex {
  // 조회 키
  url           : string               // URL 특정 기록
  change_type   : ChangeType           // 변경 유형별 통계
  llm_service   : string | null        // LLM 서비스 특정 기록

  // 집계 지표
  sample_count  : number               // 누적 측정 횟수
  avg_delta     : number               // 평균 점수 변화
  success_rate  : number               // 'positive' 판정 비율
  best_delta    : number               // 최고 기록
  worst_delta   : number               // 최저 기록
  last_updated  : string               // ISO 8601 datetime
}
```

이 인덱스는 ChangeImpact가 저장될 때마다 자동 갱신된다(upsert).

#### (2) 의미 기억: Semantic Change Archive

구조적 인덱스로 찾기 어려운 **"이번과 유사한 상황"**을 벡터 검색으로 찾는다.

```
SemanticChangeRecord {
  change_id      : string            // UUID
  embedding      : number[]          // 1536차원 벡터 (변경 상황 임베딩)
                                     // = url 특성 + change_summary + 분석 컨텍스트
  change_summary : string            // 변경 내용 자연어 요약
  impact_verdict : 'positive' | 'negative' | 'neutral'
  delta          : number            // 실제 점수 변화
  lesson         : string            // LLM이 생성한 교훈 한 줄 요약
                                     // 예: "FAQ는 모바일 커머스 페이지에서 효과 없음"
}
```

Strategy Agent는 현재 분석 상황을 임베딩하여 **유사 과거 케이스 TOP-K**를 검색한다.

#### (3) 에이전트 도구(Tool)로의 노출

에이전트가 직접 호출할 수 있는 Tool 형태로 제공한다.

```typescript
// Strategy Agent가 사용할 수 있는 Tool 목록 (pi-agent-core Tool 형식)

const queryEffectiveness = defineTool({
  name: "query-effectiveness",
  description: "이 URL에서 특정 변경 유형의 과거 효과 통계를 조회한다",
  schema: {
    url: z.string(),
    changeType: z.nativeEnum(ChangeType).optional(),
    llmService: z.string().optional(),
  },
  async execute({ url, changeType, llmService }): Promise<EffectivenessIndex> { ... },
});

const findSimilarCases = defineTool({
  name: "find-similar-cases",
  description: "현재 상황과 유사한 과거 변경 사례를 시맨틱 검색으로 반환한다",
  schema: {
    context: z.string(),           // 현재 분석 상황 텍스트
    verdictFilter: z.string().optional(),  // 'positive'만 보기 등
    topK: z.number().default(5),
  },
  async execute({ context, verdictFilter, topK }): Promise<SemanticChangeRecord[]> { ... },
});

const getNegativePatterns = defineTool({
  name: "get-negative-patterns",
  description: "이 URL에서 효과가 없었거나 역효과가 난 변경 패턴을 반환한다",
  schema: { url: z.string() },
  async execute({ url }): Promise<string[]> { ... },
});

const getCrossUrlInsights = defineTool({
  name: "get-cross-url-insights",
  description: "전체 URL을 대상으로 특정 변경 유형의 효과 인사이트를 요약해 반환한다",
  schema: { changeType: z.nativeEnum(ChangeType) },
  async execute({ changeType }): Promise<string> { ... },
});
```

#### (4) Strategy Agent의 실제 활용 흐름

```
[Strategy Agent 실행 시]
        │
        ├─ query_effectiveness(url, change_type=FAQ_ADDITION)
        │      → "FAQ: 평균 +8.3점, 성공률 72%, 샘플 11건"
        │
        ├─ find_similar_cases(context=현재_분석_요약, verdict_filter='positive')
        │      → 유사 과거 케이스 5건 + 각 케이스의 lesson
        │
        ├─ get_negative_patterns(url)
        │      → ["METADATA 변경은 3회 시도 모두 neutral",
        │          "CONTENT_CHUNKING은 Gemini에서 역효과 (-4.1점)"]
        │
        └─ [위 정보를 LLM 프롬프트 컨텍스트에 주입]
              → 근거 있는 OptimizationPlan 생성
                 "SCHEMA_MARKUP 우선 (ChatGPT +12.1점 실적),
                  CONTENT_CHUNKING 제외 (Gemini 역효과 기록)"
```

#### (5) 기억의 신선도(Freshness) 관리

과거 기록이 무조건 신뢰되지 않도록 가중치를 적용한다.

| 상황 | 처리 방식 |
|---|---|
| 6개월 이상 된 기록 | `stale` 플래그, 신뢰도 가중치 0.5× 적용 |
| LLM 서비스 메이저 업데이트 감지 후 | 해당 LLM의 기존 기록 전체 `invalidated` 표시 |
| 샘플 수 3 미만 기록 | `low_confidence` 표시, 참고용으로만 제시 |

---

## 4-C. 핵심 데이터 타입 정의

> 각 에이전트의 입출력 및 파이프라인 간 교환되는 핵심 타입을 정의한다.
> 모든 타입은 `packages/core/src/models/`에 Zod 스키마로 구현한다.

### 4-C.1 ChangeType (변경 유형 열거)

```typescript
enum ChangeType {
  CONTENT_DENSITY    = 'CONTENT_DENSITY',     // 팩트·통계·수치 추가
  SEMANTIC_STRUCTURE = 'SEMANTIC_STRUCTURE',   // 제목 계층, 단락 구조 변경
  SCHEMA_MARKUP      = 'SCHEMA_MARKUP',       // JSON-LD / Schema.org 추가·수정
  LLMS_TXT           = 'LLMS_TXT',            // llms.txt 생성·수정 (실험적)
  FAQ_ADDITION       = 'FAQ_ADDITION',        // FAQ 섹션 추가
  AUTHORITY_SIGNAL   = 'AUTHORITY_SIGNAL',     // 저자·날짜·출처 신뢰 시그널 강화
  METADATA           = 'METADATA',            // OG 태그, 메타 설명 변경
  CONTENT_CHUNKING   = 'CONTENT_CHUNKING',    // 단락 분절 구조 변경
  READABILITY_FIX    = 'READABILITY_FIX',     // 기계 가독성 구조 개선 (div→시맨틱 등)
  EXTERNAL           = 'EXTERNAL',            // 시스템 외부에서 발생한 변경 (감지됨)
}
```

### 4-C.2 GeoScore (GEO 종합 점수) — Level 1

> **2-Level 체계**: GeoScore(Level 1)는 LLM 프로브 기반 최종 성과 점수이며,
> GeoReadinessScore(Level 2)는 정적 분석 기반 사이트 준비도 점수다. → 섹션 8 참조

```typescript
GeoScore {
  total              : number          // 0~100, 가중 합산 점수

  // 세부 지표 (각 0~100) — Level 1
  citation_rate      : number          // LLM 응답에서 인용된 빈도 (가중치 25%)
  citation_accuracy  : number          // 인용 내용의 정확도 vs 원문 (20%)
  coverage           : number          // 타겟 LLM 서비스 커버리지 (15%)
                                       // Probe 실행 후 반영 (초기값 0)
  rank_position      : number          // 복수 출처 응답 시 인용 순위 (10%)
  structured_score   : number          // Level 2 GEO Readiness Score (10%)
                                       // geo-scorer의 overall_score (S1~S7 가중 합산)

  // 정보 인식 검증 (Information Recognition)
  info_recognition   : InfoRecognitionScore    // 아래 4-C.3 참조

  // 메타
  measured_at        : string          // ISO 8601 datetime
  llm_breakdown      : Record<string, GeoScorePerLLM>  // LLM별 세부 점수
}

GeoScorePerLLM {
  llm_service        : string          // 'chatgpt' | 'claude' | 'gemini' | ...
  citation_rate      : number
  citation_accuracy  : number
  rank_position      : number | null
  info_recognition   : InfoRecognitionResult  // LLM별 정보 인식 결과
}

// Level 2 — GEO Readiness Score (정적 분석 기반)
GeoReadinessScore {
  overall_score      : number          // 0~100, S1~S7 가중 합산
  grade              : string          // 'A' | 'B' | 'C' | 'D' | 'F'
  dimensions         : DimensionScore[]   // S1~S7 각 차원별 점수

  DimensionScore {
    id               : string          // "S1" ~ "S7"
    label            : string          // 차원 이름 (사이트 유형별 상이)
    score            : number          // 0~100
    weight           : number          // 0~1
    details          : string[]        // 채점 근거
  }
}
```

### 4-C.3 InfoRecognitionScore (정보 인식 검증)

> Target Web Page의 핵심 정보(제품 목록, 제품 상세, 가격, 스펙 등)를
> LLM이 정확히 인식하고 있는지를 별도로 평가한다.

```typescript
InfoRecognitionScore {
  overall            : number          // 0~100, 정보 인식 종합 점수
  items              : InfoRecognitionItem[]   // 개별 정보 항목별 결과
  coverage_rate      : number          // 전체 항목 중 인식된 비율 (0~1)
  accuracy_rate      : number          // 인식된 항목 중 정확한 비율 (0~1)
}

InfoRecognitionItem {
  info_id            : string          // 고유 식별자
  category           : InfoCategory    // 정보 유형 분류 (아래 참조)
  label              : string          // 사람이 읽을 수 있는 항목명
                                       // 예: "RTX 5090 가격", "프리미엄 요금제 기능 목록"
  expected_value     : string          // Target Page에서 추출한 기대 정보
                                       // 예: "$1,999", "무제한 스토리지, 24시간 지원"
  llm_results        : InfoRecognitionPerLLM[]  // LLM별 인식 결과
}

InfoRecognitionPerLLM {
  llm_service        : string
  recognized         : boolean         // 해당 정보를 언급했는가
  llm_answer         : string | null   // LLM이 실제 답한 내용
  accuracy           : 'exact'         // 정확히 일치
                     | 'approximate'   // 대략 맞음 (단위 차이, 반올림 등)
                     | 'outdated'      // 과거 정보를 답함
                     | 'hallucinated'  // 존재하지 않는 정보를 답함
                     | 'missing'       // 아예 언급 안 함
  detail             : string | null   // 정확도 판정에 대한 근거 설명
}

enum InfoCategory {
  PRODUCT_LIST       = 'PRODUCT_LIST',       // 제품/서비스 목록
  PRODUCT_DETAIL     = 'PRODUCT_DETAIL',     // 개별 제품 상세 스펙
  PRICING            = 'PRICING',            // 가격, 요금제
  FEATURE            = 'FEATURE',            // 기능, 특징
  AVAILABILITY       = 'AVAILABILITY',       // 재고, 출시일, 지원 지역
  CONTACT            = 'CONTACT',            // 연락처, 위치
  POLICY             = 'POLICY',             // 정책 (반품, 보증, SLA 등)
  STAT               = 'STAT',              // 수치, 통계, 벤치마크
  COMPARISON         = 'COMPARISON',         // 경쟁사 대비 비교 정보
  CUSTOM             = 'CUSTOM',             // 사용자 정의
}
```

**검증 프로세스**: Analysis Agent(URL 모드)에서 자동 추출 → LLM Probe로 검증 질의 → accuracy 판정 → InfoRecognitionScore 산출(baseline). Validation Agent가 클론 모드로 동일 검증 수행 후 Before-After delta 비교.

**산출 공식**: `overall = coverage_rate × 0.5 + accuracy_rate × 0.5 (× 100)`

### 4-C.4 LLMProbe (LLM 질의 결과)

```typescript
LLMProbe {
  probe_id           : string          // UUID
  llm_service        : string          // 'chatgpt' | 'claude' | 'gemini' | ...
  model_version      : string          // 'gpt-4o-2025-12' 등
  query              : string          // 발송한 질의문
  query_type         : 'citation_test'       // 인용 여부 테스트
                     | 'accuracy_test'       // 정보 정확도 테스트
                     | 'info_recognition'    // 정보 인식 검증
                     | 'sentiment_test'      // 감정 분석 (KI-1 대응)
                     | 'competitor_compare'  // 경쟁사 비교

  response_text      : string          // LLM 원문 응답
  response_at        : string          // ISO 8601 datetime

  // 분석 결과
  cited              : boolean         // Target Page를 인용했는가
  citation_excerpt   : string | null   // 인용된 부분 발췌
  citation_position  : number | null   // 복수 출처 중 몇 번째로 인용됐는가
  accuracy_vs_source : number          // 원문 대비 정확도 (0~1)
  info_items_checked : InfoRecognitionPerLLM[]  // 정보 인식 항목별 결과 (해당 시)
}
```

### 4-C.5 AnalysisReport (분석 보고서)

```typescript
AnalysisReport {
  report_id              : string          // UUID
  target_id              : string          // TargetProfile.id
  url                    : string
  analyzed_at            : string          // ISO 8601 datetime

  // 기계 가독성 (섹션 4.2-A)
  machine_readability    : {
    grade                : 'A' | 'B' | 'C' | 'F'
    js_dependency_ratio  : number          // 0~1
    structure_quality    : StructureQuality
    crawler_access       : CrawlerAccessResult[]
  }

  // 콘텐츠 분석
  content_analysis       : {
    word_count           : number
    content_density      : number          // 정보 밀도 점수 (0~100)
    readability_level    : string          // 'technical' | 'general' | 'simplified'
    key_topics_found     : string[]        // 페이지에서 추출된 주요 주제
    topic_alignment      : number          // TargetProfile.topics와의 정렬도 (0~1)
  }

  // 구조화 데이터 현황
  structured_data        : {
    json_ld_present      : boolean
    json_ld_types        : string[]        // 예: ['Product', 'FAQ', 'Article']
    schema_completeness  : number          // Schema.org 커버리지 (0~1)
    og_tags_present      : boolean
    meta_description     : string | null
  }

  // 정보 추출 (InfoRecognition 시드)
  extracted_info_items   : InfoRecognitionItem[]   // 자동 추출된 핵심 정보 목록

  // 현재 GEO 점수
  current_geo_score      : GeoScore

  // 경쟁사 격차
  competitor_gaps        : CompetitorGap[]

  // LLM 현황
  llm_status             : LLMProbe[]     // 각 LLM에 현재 질의한 결과
}

CrawlerAccessResult {
  user_agent             : string          // 'GPTBot' | 'ClaudeBot' | ...
  http_status            : number
  blocked_by_robots_txt  : boolean
  content_accessible     : boolean         // 실제 콘텐츠가 응답에 포함됐는가
}

CompetitorGap {
  competitor             : CompetitorEntry
  competitor_geo_score   : GeoScore | null
  gap_delta              : number          // 우리 점수 - 경쟁사 점수
  key_advantages         : string[]        // 경쟁사가 우리보다 잘하는 영역
  key_weaknesses         : string[]        // 경쟁사가 우리보다 못하는 영역
}
```

### 4-C.6 OptimizationPlan (최적화 실행 계획)

```typescript
OptimizationPlan {
  plan_id                : string          // UUID
  target_id              : string          // TargetProfile.id
  created_at             : string          // ISO 8601 datetime
  analysis_report_ref    : string          // AnalysisReport.report_id

  // 전략 근거
  strategy_rationale     : string          // LLM이 생성한 전략 설명 (자연어)
  memory_context         : {               // Agent Memory에서 참고한 근거
    effectiveness_data   : EffectivenessIndex[]
    similar_cases        : SemanticChangeRecord[]
    negative_patterns    : string[]
  }

  // 태스크 목록 (우선순위 순)
  tasks                  : OptimizationTask[]

  // 예상 효과
  estimated_impact       : {
    expected_delta       : number          // 예상 GEO 점수 변화
    confidence           : number          // 예측 신뢰도 (0~1)
    rationale            : string          // 예측 근거
  }

  status                 : 'draft' | 'approved' | 'executing' | 'completed' | 'cancelled'
}

OptimizationTask {
  task_id                : string          // UUID
  order                  : number          // 실행 순서
  change_type            : ChangeType
  title                  : string          // 태스크 제목 (예: "FAQ 섹션 추가")
  description            : string          // 상세 작업 내용
  target_element         : string | null   // 대상 HTML 요소 (CSS selector 등)
  priority               : 'critical' | 'high' | 'medium' | 'low'

  // 정보 인식 개선 태스크인 경우
  info_recognition_ref   : string | null   // 개선 대상 InfoRecognitionItem.info_id

  // 실행 결과
  status                 : 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
  change_record_ref      : string | null   // 실행 후 생성된 ChangeRecord.change_id
}
```

### 4-C.7 ValidationReport (검증 보고서)

```typescript
ValidationReport {
  report_id              : string          // UUID
  target_id              : string          // TargetProfile.id
  plan_ref               : string | null   // OptimizationPlan.plan_id (최적화 후 검증 시)
  validated_at           : string          // ISO 8601 datetime
  cycle_number           : number          // 현재 사이클 번호

  // AnalysisReport 참조 (Before-After)
  baseline_report_ref    : string          // 초기 분석 AnalysisReport.report_id
  clone_report_ref       : string          // 클론 분석 AnalysisReport.report_id

  // GEO 점수 비교 (AnalysisReport에서 추출)
  score_before           : GeoScore
  score_after            : GeoScore
  score_delta            : number          // total 기준

  // 차원별 delta
  dimension_deltas       : Array<{ id: string; label: string; before: number; after: number; delta: number }>

  // LLM Probe 비교 (AnalysisReport의 probe 결과 대조)
  probe_comparison       : ProbeComparisonResult[]

  // 정보 인식 비교 (AnalysisReport의 InfoRecognitionScore 대조)
  info_recognition_delta : { before: InfoRecognitionScore; after: InfoRecognitionScore; delta: number }

  // 사이클 제어 판정
  needs_more_cycles      : boolean
  stop_reason            : string | null   // score_sufficient / no_more_improvements / max_cycles / llm_verdict_worse

  // 종합 판정
  verdict                : 'improved' | 'unchanged' | 'degraded'
  summary                : string          // LLM이 생성한 종합 평가 (자연어)

  // 권장 후속 조치
  recommendations        : string[]
}

ProbeComparisonResult {
  probe_id               : string
  query                  : string          // 프로브 질의
  llm_service            : string
  before_citation_found  : boolean
  after_citation_found   : boolean
  before_accuracy        : number
  after_accuracy         : number
  delta_accuracy         : number
  html_citation_ratio_before : number | null  // HTML에서 인용한 비율 (before)
  html_citation_ratio_after  : number | null  // HTML에서 인용한 비율 (after)
  info_recognition       : InfoRecognitionPerLLM[]  // 정보 인식 항목별 결과
  delta_vs_before        : number          // 이전 측정 대비 변화
}
```

### 4-C.8 타입 의존 관계

```
TargetProfile ──────┐
                    ▼
            AnalysisReport
              │         │
              │     extracted_info_items ──▶ InfoRecognitionItem[]
              ▼                                      │
        OptimizationPlan                             │
         │    │                                      │
         │    └── OptimizationTask                   │
         │           │  info_recognition_ref ────────┘
         ▼
    ChangeRecord ──▶ ContentSnapshot (before/after)
         │
         ▼
    ChangeImpact
         │
    ┌────┴─────┐
    ▼          ▼
EffectivenessIndex   SemanticChangeRecord

    ValidationReport
         │
         ├── GeoScore (before/after)
         │      └── InfoRecognitionScore
         ├── ValidationLLMResult[]
         │      └── LLMProbe[]
         │            └── InfoRecognitionPerLLM[]
         └── InfoRecognitionScore
                └── InfoRecognitionItem[]
```

---

## 4-D. 사용성 원칙

- LLM Provider가 동작하지 않아서 LLM을 통한 Query가 동작하지 않을 떄에는 사용자에게 Clear하게 문제 원인을 알리고 동작을 정지한다.
   - LLM 으로 해야 할일을 Hardcoded code로 하지 않아야 한다.
- 에러·경고·제한사항은 사용자에게 투명하게 전달한다.
   - 사용자는 개발자와 동일하게 문제 상황을 인지할 수 있어야 한다.
   - 에러를 catch 후 조용히 무시하거나, 빈 결과를 정상인 것처럼 반환하지 않는다.
   - "사용자 경험을 위해" 에러를 숨기는 것은 금지한다 — 문제를 모르면 해결할 수 없다.

---

## 5. GEO 최적화 원칙

### 5.1 LLM 인용 최적화 원칙 (CRAFT 프레임워크)

```
C - Clarity      : LLM이 오해 없이 파싱할 수 있는 명확한 문장 구조
R - Relevance    : 특정 질의 의도에 정확히 매칭되는 콘텐츠 배치
A - Authority    : E-E-A-T 신호 강화 (경험, 전문성, 권위, 신뢰)
F - Freshness    : 최신 정보 명시 및 주기적 업데이트
T - Traceability : 인용 가능한 출처, 데이터, 통계 제공
```

### 5.2 구조화 우선 원칙

- 모든 핵심 정보는 LLM이 청크로 추출할 수 있도록 독립적 단락으로 구성
- FAQ 형식으로 예상 질의-응답 쌍을 명시적으로 제공
- 테이블, 리스트를 활용한 비교·정의·순위 정보 구조화
- 핵심 주장은 첫 문장에 배치 (역피라미드 구조)

### 5.3 다중 LLM 커버리지 원칙

- 특정 LLM에 종속되지 않는 범용 최적화 우선
- LLM별 학습 데이터 특성 및 검색 연동 방식 고려한 차별화 전략 병행
- RAG 파이프라인 친화적 콘텐츠 분절 지원

---

## 6. 기반 소프트웨어 및 기술 스택

### 6.1 에이전트 엔진: pi-mono

> **핵심 결정**: 에이전트 런타임으로 [pi-mono](https://github.com/badlogic/pi-mono) (TypeScript 모노레포)를 채용한다. 이에 따라 시스템 전체가 TypeScript 기반으로 구현된다.

pi-mono에서 사용하는 패키지:

| 패키지 | 역할 | GEO 시스템에서의 용도 |
|---|---|---|
| **@mariozechner/pi-ai** | 통합 멀티 프로바이더 LLM API (OpenAI, Anthropic, Google 등) | 분석·전략 생성용 LLM 호출, Validation Agent의 멀티 LLM 질의 |

> **Note**: `pi-agent-core` (Agent Loop + Tool calling) 기반 에이전트 전환을 준비 중이며, `pi-ai-bridge.ts`와 `llm-analysis-agent.ts`에서 pi-ai Agent Loop 통합이 진행되고 있다. 현재 파이프라인은 순수 함수 기반으로 동작한다.

**현재 에이전트 실행 구조**:

```
┌─────────────────────────────────────────────────────┐
│              GEO Agent Pipeline (현재)                │
│                                                      │
│  Orchestrator (pipeline/orchestrator.ts)              │
│    ├─ StageHandler 순차 실행                          │
│    ├─ Cycle 루프백 (VALIDATING → STRATEGIZING)       │
│    └─ 에러 핸들링 + 타임아웃                          │
│                                                      │
│  에이전트 (순수 async 함수)                           │
│    ├─ runAnalysis()      ← 크롤링 + 채점 + 분류      │
│    ├─ runStrategy()      ← 규칙 기반 + LLM 강화      │
│    ├─ runOptimization()  ← 클론 파일 수정             │
│    └─ runValidation()    ← Before-After 비교          │
│                                                      │
│  LLM 호출 (선택적 강화)                               │
│    ├─ GeoLLMClient.chat()  ← 자체 LLM 추상화         │
│    └─ pi-ai-bridge.ts      ← pi-ai 어댑터 (전환 준비)│
│                                                      │
│  pi-ai (LLM Provider)                               │
│    ├─ OpenAI (GPT-4o)   ← ★ 기본 오케스트레이션 모델 │
│    ├─ Anthropic (Claude) ← 오케스트레이션 대안 + 검증 │
│    ├─ Google (Gemini)    ← 오케스트레이션 대안 + 검증 │
│    ├─ Perplexity         ← Validation 테스트 대상    │
│    └─ ...                                            │
└─────────────────────────────────────────────────────┘
```

**에이전트 실행 방식**: 각 에이전트는 순수 async 함수로 구현되며, 의존성 주입(Deps 인터페이스)을 통해 크롤러, 채점기, LLM 클라이언트 등을 주입받는다. LLM 호출은 선택적이며, 미사용 시 규칙 기반으로 동작한다(graceful degradation).

```typescript
// 예시: Analysis Agent의 실행
const output = await runAnalysis(
  { target_id, target_url },
  { crawlTarget, scoreTarget, classifySite, chatLLM }  // 의존성 주입
);
```

### 6.2 스킬 시스템: openclaw 호환

> **핵심 결정**: [openclaw](https://github.com/openclaw/openclaw)의 스킬 체계를 참고하여, 에이전트가 스스로 필요한 스킬을 생성·등록·재사용할 수 있도록 한다. openclaw 스킬과의 호환성도 확보한다.

#### 6.2.1 스킬 아키텍처 개요

```
┌────────────────────────────────────────────────────────┐
│                     Skill Platform                      │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Bundled     │  │   Managed    │  │  Workspace   │  │
│  │   Skills      │  │   Skills     │  │  Skills      │  │
│  │ (GEO 핵심)   │  │ (ClawHub)    │  │ (사용자 생성)│  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         └──────────────────┼──────────────────┘         │
│                            ▼                            │
│                  ┌─────────────────┐                    │
│                  │  Skill Registry  │                    │
│                  │  (통합 등록소)   │                    │
│                  └────────┬────────┘                    │
│                           ▼                             │
│              ┌────────────────────────┐                 │
│              │  pi-agent-core Tools   │                 │
│              │  (Tool calling 연동)   │                 │
│              └────────────────────────┘                 │
└────────────────────────────────────────────────────────┘
```

**3-tier 스킬 체계**:

| 계층 | 설명 | 예시 |
|---|---|---|
| **Bundled Skills** | GEO 시스템에 기본 내장된 핵심 스킬 | dual-crawl, geo-scorer, schema-builder, content-optimizer, site-classifier, diff-generator |
| **Managed Skills** | ClawHub 레지스트리에서 검색·설치 가능한 검증된 스킬 | SEO 분석, 경쟁사 비교, 소셜 시그널 수집 |
| **Workspace Skills** | 사용자가 직접 생성하거나 에이전트가 자동 생성한 커스텀 스킬 | 특정 CMS 연동, 도메인 특화 분석 |

#### 6.2.2 스킬 정의 형식

각 스킬은 `packages/skills/src/` 하위에 TypeScript 파일로 정의된다:

```
packages/skills/src/
├── index.ts                  # SkillRegistry + 전체 Bundled Skills 등록
├── dual-crawl.ts             # crawlTarget() — HTML/robots/llms.txt/sitemap 수집
├── geo-scorer.ts             # scoreTarget() — Level 2 GEO Readiness Score (S1~S7)
├── schema-builder.ts         # [stub] JSON-LD 자동 생성
├── content-optimizer.ts      # [stub] LLM 기반 콘텐츠 개선
├── site-classifier.ts        # [stub] 사이트 유형 자동 분류
├── diff-generator.ts         # [stub] Before-After 변경 비교
└── *.test.ts                 # 스킬별 테스트
```

> **Note**: 초기 설계의 openclaw 호환 SKILL.md + schema.json 구조는
> 향후 Managed/Workspace 스킬 도입 시 적용 예정. 현재 Bundled Skills는 직접 TypeScript 모듈로 구현.

**SKILL.md 형식** (openclaw 호환):

```markdown
---
name: geo-dual-crawl
version: 1.0.0
description: JS 실행/미실행 이중 크롤링으로 기계 가독성을 진단한다
author: geo-agent-system
tags: [geo, crawling, analysis, machine-readability]
install_gate:                    # 조건부 활성화
  requires: [playwright]
ui:
  icon: globe
  category: Analysis
---

# Dual Crawl Tool

Target URL을 Playwright(JS 실행)와 raw fetch(JS 미실행)로 각각 크롤링하여
콘텐츠 차이를 측정한다. js_dependency_ratio를 산출하여 LLM 크롤러 접근성을 진단한다.

## Parameters
- url (string, required): 크롤링 대상 URL
- timeout_ms (number, optional): 타임아웃 (기본 30000)

## Returns
- text_with_js: JS 실행 후 추출 텍스트
- text_without_js: JS 미실행 추출 텍스트
- js_dependency_ratio: 0~1 (높을수록 JS 의존도 높음)
- grade: A | B | C | F
```

**index.ts** (pi-agent-core Tool로 등록):

```typescript
import { defineTool } from "@mariozechner/pi-agent-core";
import schema from "./schema.json";

export default defineTool({
  name: "geo-dual-crawl",
  description: "JS 실행/미실행 이중 크롤링으로 기계 가독성을 진단한다",
  schema,
  async execute({ url, timeout_ms = 30000 }) {
    // Playwright 크롤링 + raw fetch 크롤링
    // js_dependency_ratio 산출
    // ...
    return { text_with_js, text_without_js, js_dependency_ratio, grade };
  },
});
```

#### 6.2.3 에이전트의 자동 스킬 생성

Strategy Agent 또는 Optimization Agent가 작업 중 필요한 도구가 없으면, **스킬을 자동 생성**할 수 있다:

```
[Strategy Agent 실행 중]
    │
    ├─ "이 사이트는 WordPress REST API가 있는데,
    │    해당 API를 통한 콘텐츠 업데이트 도구가 없다"
    │
    ├─ [자동 스킬 생성 트리거]
    │   ├─ SKILL.md 작성 (메타데이터, 설명)
    │   ├─ index.ts 생성 (WordPress REST API 연동 코드)
    │   ├─ schema.json 생성 (입출력 정의)
    │   └─ skills/workspace/wp-content-updater/ 에 저장
    │
    └─ [Skill Registry에 등록 → 즉시 사용 가능]
```

**자동 생성 제약 조건**:
- Workspace Skills 계층에만 생성 가능 (Bundled/Managed는 수동 관리)
- 생성된 스킬은 `auto_generated: true` 플래그가 붙으며, 관리자 검토 전까지 sandbox 모드 실행
- 실행 권한은 파일시스템 읽기/쓰기, HTTP 요청으로 제한 (시스템 명령 실행 불가)

#### 6.2.4 openclaw 스킬 호환성

openclaw의 스킬을 GEO 시스템에서 재사용할 수 있도록 호환 레이어를 제공한다:

```
┌─────────────────────┐       ┌──────────────────────┐
│   openclaw Skill     │       │   GEO Skill          │
│  (SKILL.md + tools)  │──────▶│  (SKILL.md + index.ts│
│                      │ 변환  │   + schema.json)     │
└─────────────────────┘       └──────────────────────┘
         │
         ▼
  openclaw의 Tool 정의를
  pi-agent-core Tool로 래핑
```

| 호환 방향 | 방식 |
|---|---|
| **openclaw → GEO** | `geo skill import --from-openclaw <skill-name>` CLI로 변환·설치 |
| **GEO → openclaw** | `geo skill export --to-openclaw <skill-name>`으로 openclaw 형식 출력 |
| **ClawHub 검색** | `geo skill search <keyword>`로 ClawHub 레지스트리 검색 및 설치 |

#### 6.2.5 CLI 인터페이스

> **원칙**: CLI는 **서비스 관리 + 빠른 분석 진입점**을 담당한다. Target 설정, 에이전트 실행, 결과 조회 등 인터랙티브 작업은 **localhost 웹 대시보드**에서 수행한다.

```bash
# === 서비스 관리 ===
geo start                               # 전체 서비스 시작 (API 서버 + 대시보드)
geo start --port 3000                   # 포트 지정
geo stop                                # 서비스 중지
geo status                              # 서비스 상태 확인
geo init                                # 워크스페이스 초기화

# === 빠른 분석 (대시보드 없이 CLI에서 직접) ===
geo analyze <url>                       # Level 2 GEO Readiness Score 빠른 산출 (7차원 바 차트)
geo run <url>                           # 전체 파이프라인 실행
geo run <url> --api-key <key>           # LLM API Key 지정
geo run <url> --provider openai         # LLM 프로바이더 지정
geo run <url> --model gpt-4o            # 모델 지정

# === [미구현] 스킬 관리 (개발자용) ===
# geo skill list / create / test / install / remove / search
# → Managed/Workspace 스킬 계층 도입 시 구현 예정
```

**서비스 시작 후**: 브라우저에서 `http://localhost:3000/dashboard` 접속하여 Target 추가, 파이프라인 실행, Evaluation 탭에서 결과 확인 등 모든 작업을 수행한다.

### 6.3 웹 인터랙션

| 구분 | 선택 | 용도 |
|---|---|---|
| **HTTP 클라이언트** | Node.js 내장 fetch | 정적 HTML 크롤링 (LLM 크롤러 시점), robots.txt/llms.txt/sitemap.xml 수집 |
| **HTML 파싱** | 정규식 기반 자체 파서 (`dual-crawl.ts _parsers`) | 타이틀, 메타태그, canonical, JSON-LD, 링크 추출 |
| **멀티 페이지 크롤링** | `crawlMultiplePages()` | depth 1~3 탐색, 제품 URL 우선, 최대 30페이지, 동시 5개 병렬 |

> **향후 확장**: Playwright 기반 JS 실행 크롤링을 추가하여 이중 크롤링 비교(섹션 4.2-A)를 완전 구현할 예정.

### 6.4 데이터 저장 및 처리

| 구분 | 선택 | 용도 |
|---|---|---|
| **관계형 DB (v1)** | @libsql/client + drizzle-orm (로컬 SQLite, WAL 모드) | targets, pipeline_runs, stage_executions, 스냅샷, 이력 등 전체 |
| **파일 저장** | 로컬 파일시스템 | 크롤링 원본, 로컬 클론, 리포트 HTML, LLM Provider 설정 JSON |
| **프롬프트 저장** | JSON 파일 (`workspace/prompts/`) | 에이전트 시스템 프롬프트 (workspace fallback → default) |

> **v2+ 계획**: PostgreSQL 마이그레이션, 벡터 DB (Agent Memory용), Redis (캐시/큐)

### 6.5 UI: localhost 웹 대시보드

> **v1 범위**: localhost에서만 제공. Remote web 접근은 차기 버전 대상.

단일 HTML SPA (`dashboard.html`) + vanilla JS + Chart.js 기반으로 localhost에 대시보드를 제공한다.

```
┌────────────────────────────────────────────────────────────────┐
│  localhost:3000/dashboard  GEO Agent Dashboard                   │
│                                                                  │
│  [Targets] [Pipelines] [Evaluation] [Agent Prompts] [LLM Providers]│
│                                                                  │
│  ┌─ Targets 탭 ─────────────────────────────────────────────┐   │
│  │  Target 목록 + 추가/편집/삭제                             │   │
│  │  (URL, 이름, site_type, topics, target_queries 등)        │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Pipelines 탭 ───────────────────────────────────────────┐   │
│  │  Target별 파이프라인 시작/중단/재실행/삭제                  │   │
│  │  클릭 확장 카드: 스테이지별 상태, prompt/result 미리보기    │   │
│  │  SSE 기반 실시간 진행도 (3초 auto-refresh)                 │   │
│  │  사용된 LLM 모델 정보 표시                                 │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Evaluation 탭 ──────────────────────────────────────────┐   │
│  │  Target + Pipeline 선택 → 10-서브탭 분석 결과:             │   │
│  │  📊 종합 개요 │ 🤖 크롤링 접근성 │ 🏗️ 구조화 데이터      │   │
│  │  📦 제품 정보 │ 💬 브랜드 메시지 │ 🔍 페이지별 분석       │   │
│  │  🎯 개선 권고 │ 🔬 실증 데이터 │ 🗺️ 개선 로드맵          │   │
│  │  ⏱️ 실행 요약 │ 🧪 Synthetic Probes │ 🔎 LLM Call Log    │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Agent Prompts 탭 ───────────────────────────────────────┐   │
│  │  6개 에이전트 시스템 프롬프트 편집                          │   │
│  │  → 섹션 4-A.5 프롬프트 편집 UI 참조                       │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ LLM Providers 탭 ──────────────────────────────────────┐   │
│  │  6개 프로바이더 API Key/모델/활성화 설정                    │   │
│  │  → 섹션 9-B.4 LLM Provider 설정 UI 참조                  │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

**기술 구성**:

| 구분 | 선택 | 용도 |
|---|---|---|
| **프론트엔드** | 단일 HTML SPA (vanilla JS, 인라인 CSS) | 대시보드 전체 UI (`dashboard.html`) |
| **차트/시각화** | Chart.js (CDN) | Radar/Bar/Line 차트, 점수 게이지 |
| **백엔드 API** | Hono (TypeScript) | REST API 서버 (localhost) |
| **실시간 통신** | SSE (`/events` 엔드포인트) | 파이프라인 스테이지 진행 이벤트 스트리밍 |

**localhost 제한 사항 (v1)**:
- 인증/인가 시스템 미포함 (localhost만이므로 불필요)
- HTTPS 미지원 (localhost 환경)
- 동시 사용자 1명 가정

**차기 버전 (remote web) 예정 사항** → Known Issue KI-8 참조

### 6.6 태스크 오케스트레이션

| 구분 | 선택 | 용도 |
|---|---|---|
| **워크플로우** | 자체 Orchestrator 클래스 (`pipeline/orchestrator.ts`) | StageHandler 순차 실행, Cycle 루프백, 타임아웃/재시도 |
| **파이프라인 실행** | Pipeline Runner (`pipeline-runner.ts`) | 6개 스테이지 등록, 의존성 주입, 결과 수집 |
| **상태 관리** | Zod schemas (TypeScript) | 에이전트 입출력 스키마 정의·검증 |
| **실행 기록** | stage_executions DB 테이블 | 스테이지별 prompt/result/duration 추적 |

### 6.7 모니터링 및 관찰성

| 구분 | 선택 | 용도 |
|---|---|---|
| **로깅** | pino (structured JSON logging) | 에이전트 실행 로그 (테스트 환경 silent) |
| **LLM 추적** | 자체 LLM Call Log (`LLMCallLogEntry[]`) | 호출별 provider/model/duration/tokens 기록, Dashboard에서 조회 |
| **비용 추적** | CostTracker (geo-llm-client.ts 내장) | 프로바이더별 비용 추정 (PRICING 테이블 기반) |

### 6.8 개발 환경

| 구분 | 선택 |
|---|---|
| **언어** | TypeScript 5.x (Node.js 20+) |
| **패키지 관리** | npm workspaces (모노레포 4패키지) |
| **코드 품질** | biome (lint/format — 탭 들여쓰기, 더블 쿼트, 세미콜론) |
| **테스트** | vitest |
| **CI** | GitHub Actions (ubuntu + windows, Node 20 + 22 매트릭스) |

---

## 7. 데이터 흐름

> **핵심 원칙**: 원본 Target Web Page는 읽기 전용. 초기 분석만 원본 URL을 크롤링하며,
> 이후 모든 수정/재평가는 로컬 클론에서 수행한다.

```
[사용자: 대시보드에서 Target Profile 설정 또는 선택]
         │
         ▼
[Orchestrator: TargetProfile 로드 → 파이프라인 초기화]
         │
         ├──▶ [Analysis Agent] ★ 원본 URL 직접 크롤링 (읽기 전용)
         │         │ 이중 크롤링 (Playwright + undici/fetch raw)
         │         │ 구조 분석, GEO 현황 점수
         │         │ ★ 기계 가독성 감사 (js_dependency_ratio, DOM 품질, 크롤러 접근성)
         │         │ ★ LLM 기준선 측정 (각 LLM에 질의 → baseline GeoScore 저장)
         │         ▼
         │    AnalysisReport + ContentSnapshot(original) + LLM Baseline
         │         │
         │         ├─ 등급 A/B ──▶ 정상 진행
         │         └─ 등급 C/F ──▶ Strategy Agent에 "구조 개선 우선" 플래그 전달
         │
         ├──▶ [Clone Manager] ★ 원본 → 로컬 클론 생성
         │         │ 원본 페이지 HTML + 리소스를 로컬 파일시스템에 저장
         │         │ clone_base_path = workspace/clones/{target_id}/
         │         │ 클론 메타데이터 기록 (원본 URL, 클론 시각, 해시)
         │         ▼
         │    Local Clone (이후 모든 작업의 대상)
         │
         │  ┌─────────────────────────────────────────────────────┐
         │  │          최적화 루프 (클론 대상으로만 수행)            │
         │  │                                                      │
         │  │  ├──▶ [Strategy Agent]                               │
         │  │  │         │ AnalysisReport + 과거 ChangeImpact      │
         │  │  │         │ 기계 가독성 C/F → 구조 개선 최우선      │
         │  │  │         ▼                                         │
         │  │  │    OptimizationPlan                               │
         │  │  │                                                   │
         │  │  ├──▶ [Optimization Agent] ★ 클론에만 수정 적용      │
         │  │  │         │ OptimizationPlan 수신                   │
         │  │  │         │ 클론 파일에 콘텐츠 패치 적용             │
         │  │  │         │ ★ ChangeRecord 생성 (diff, snapshot)    │
         │  │  │         ▼                                         │
         │  │  │    수정된 클론 HTML/JSON-LD                       │
         │  │  │                                                   │
         │  │  ├──▶ [Validation Agent] ★ Analysis Agent 호출로 검증  │
         │  │  │         │ Analysis Agent를 Clone 모드로 호출       │
         │  │  │         │  → 정적 분석 + LLM Probe 전체 재수행    │
         │  │  │         │ Before-After AnalysisReport 비교         │
         │  │  │         │ ContentSnapshot(after) + ChangeImpact    │
         │  │  │         │ 사이클 판정 (점수/delta/LLM verdict)     │
         │  │  │         ▼                                         │
         │  │  │    ValidationReport (full comparison)             │
         │  │  │                                                   │
         │  │  └──▶ [Orchestrator: 목표 달성 판단]                 │
         │  │            │                                         │
         │  │       목표 미달 ──▶ Strategy로 재순환 (Loop)         │
         │  │            │                                         │
         │  │       목표 달성 ──▶ 루프 종료                        │
         │  └─────────────────────────────────────────────────────┘
         │
         ├──▶ [Result Generator] ★ 최종 결과물 생성
         │         │ Before-After 비교 리포트 생성:
         │         │   - 원본 vs 클론 side-by-side diff
         │         │   - 각 변경사항별 ChangeRecord + Impact 요약
         │         │   - 구조적 점수 변화 + LLM 효과 예측치
         │         │ Archive 파일 생성:
         │         │   - 수정된 클론 전체 파일 (HTML, JSON-LD 등)
         │         │   - 패치 파일 (원본 대비 unified diff)
         │         ▼
         │    OptimizationReport + Archive (.zip) → 대시보드에서 다운로드
         │
         ├──▶ [Monitoring Agent - 상시 동작]
         │         │ 원본 URL 주기적 해시 체크 (읽기 전용)
         │         │ ★ 외부 변경 감지 → EXTERNAL ChangeRecord 자동 생성
         │         │ 주기적 LLM 질의 → GeoTimeSeries 누적
         │         ▼
         │    지속적 GeoTimeSeries 업데이트
         │
         └──▶ [Change History 대시보드 표시]
                   변경 타임라인 / 효과 귀인 / Before-After 리포트 조회
```

---

## 8. GEO 점수 체계

GEO 점수는 2-Level 계층 구조를 갖는다.

### 8.1 Level 1: GEO Score (최종 성과 점수)

LLM 프로브(Synthetic Probes P-01~P-08)를 통해 측정하는 **실제 성과 지표**.
API Key가 설정된 **모든 활성 LLM 서비스**에 웹 검색을 활성화한 상태로 실제 쿼리를 보내 응답을 분석한다.
서비스별 결과를 `llm_priorities` 가중치에 따라 합산하여 최종 점수를 산출한다.

```
GEO Score (0~100) = Σ(가중치 × 세부 지표)

세부 지표:
  - Citation Rate          (25%): LLM 응답에서 Target을 인용하는 빈도
  - Citation Accuracy      (20%): 인용 내용의 정확도 (vs 원문)
  - Info Recognition       (20%): 핵심 정보(제품, 가격, 스펙 등) 인식률 × 정확도
                                  → 4-C.3 InfoRecognitionScore 참조
  - Coverage               (15%): 타겟 LLM 서비스 커버리지 (6개 LLM 중 인용 비율)
  - Rank Position          (10%): 복수 출처 응답 시 인용 순위
  - Structured Score       (10%): Level 2 GEO Readiness Score 전체 점수 투입
```

> **Note**: Info Recognition은 단순 인용 여부를 넘어, Target Page의 **구체적 정보가 정확하게** 전달되는지를 측정한다. 예를 들어 제품 가격이 "$1,999"인데 LLM이 "$999"라고 답하면 citation은 있지만 info_recognition은 낮게 산출된다.

### 8.2 Level 2: GEO Readiness Score (사이트 준비도)

정적 분석만으로 산출하는 **사이트 LLM 친화도 지표**.
API Key 없이 즉시 산출 가능하며, GEO Scorer 스킬이 담당한다.

```
GEO Readiness Score (0~100) = Σ(가중치 × 차원별 점수)

7차원 (S1~S7):
  - S1 LLM 크롤링 접근성     (15%): robots.txt, llms.txt, 응답 속도, canonical
  - S2 구조화 데이터 품질     (25%): JSON-LD, OG, Schema.org, Twitter Cards
  - S3 콘텐츠 기계가독성      (20%): 시맨틱 HTML, 헤딩 구조, 리스트/테이블, alt text
  - S4 콘텐츠 팩트 밀도       (10%): 숫자, 단위, 스펙 테이블, 가격 정보
  - S5 브랜드/조직 메시지     (10%): 브랜드 스키마, 소셜 링크, 법적 문서
  - S6 AI 친화적 인프라       (10%): llms.txt, AI 메타태그, RSS/Atom 피드
  - S7 콘텐츠 탐색 구조       (10%): breadcrumb, 내부 링크, nav, sitemap
```

차원 이름은 사이트 유형(manufacturer/research/generic)에 따라 변경될 수 있으나,
가중치와 차원 수(7)는 모든 유형에서 동일하다. → 9-E 참조

### 8.3 Level 간 관계 및 운용 규칙

```
┌─────────────────────────────────────────────────┐
│  Level 1: GEO Score (최종 성과)                   │
│  ┌───────────┬───────────┬───────────┐           │
│  │ Citation  │ Info      │ Coverage  │ ...       │
│  │ Rate 25%  │ Recog 20% │ 15%       │           │
│  └───────────┴───────────┴───────────┘           │
│         ▲ LLM Probes          │ Readiness 10%    │
│         │                     ▼                  │
│  ┌─────────────────────────────────────────┐     │
│  │  Level 2: GEO Readiness Score (준비도)    │     │
│  │  S1(15%) S2(25%) S3(20%) S4(10%)        │     │
│  │  S5(10%) S6(10%) S7(10%)                │     │
│  │  ← 정적 분석, API 불필요                   │     │
│  └─────────────────────────────────────────┘     │
└─────────────────────────────────────────────────┘
```

| 상황 | 사용 점수 | 설명 |
|---|---|---|
| LLM API Key 미설정 | Level 2만 | Readiness Score가 작업 점수 역할 |
| LLM API Key 설정됨 | Level 1 + Level 2 | Level 1이 권위 점수, Level 2는 구성 요소 |
| ANALYZING 스테이지 | Level 2 산출 | 항상 (무료, 즉시) |
| VALIDATING 스테이지 | Level 2 재산출 + Level 1 (선택) | Before-After 비교에 활용 |

> **설계 근거**: Level 2(Readiness)는 사이트 구조를 개선하기 위한 **행동 가능한(actionable)** 점수이고,
> Level 1(GEO Score)은 그 개선이 **실제 LLM 인용에 반영되었는지** 확인하는 결과 점수다.
> 최적화 루프에서 Level 2로 빠르게 반복하고, 주요 마일스톤에서 Level 1로 검증하는 것이 효율적이다.

---

## 9. 보안 및 윤리 원칙

- **화이트햇 원칙**: 콘텐츠의 실제 품질 향상을 통한 최적화만 수행. LLM 오염이나 프롬프트 인젝션 기법 사용 금지
- **투명성**: 최적화 적용 내역을 모두 로깅하고 감사 가능하도록 유지
- **LLM ToS 준수**: 각 LLM 서비스의 API 이용 약관 및 사용 정책 준수
- **API 키 관리**: 모든 자격증명은 환경변수 및 시크릿 매니저로 관리. 코드 내 하드코딩 금지
- **Rate Limiting**: LLM API 호출 시 속도 제한 및 재시도 정책 적용

---

## 9-A. 에러 핸들링 및 복원 정책

### 9-A.1 LLM API 호출 재시도

```typescript
RetryPolicy {
  max_retries        : number          // 기본값 3
  initial_delay_ms   : number          // 기본값 1000
  backoff_multiplier : number          // 기본값 2.0 (exponential)
  max_delay_ms       : number          // 기본값 30000
  retryable_errors   : string[]        // ['rate_limit', 'timeout', 'server_error']
  non_retryable      : string[]        // ['auth_error', 'invalid_request', 'content_filter']
}
```

| HTTP 상태 | 대응 |
|---|---|
| 429 (Rate Limit) | `Retry-After` 헤더 준수, 없으면 exponential backoff |
| 500/502/503 | exponential backoff 후 재시도 |
| 401/403 | 재시도 없이 즉시 실패 → 사용자에게 API 키 확인 알림 |
| timeout | 1.5× 타임아웃으로 1회 재시도 후 실패 처리 |

### 9-A.2 에이전트 타임아웃

| 에이전트 | 기본 타임아웃 | 사유 |
|---|---|---|
| Analysis Agent (URL 모드) | 10분 | 크롤링 + 구조 분석 + LLM Probe 8건+ |
| Analysis Agent (Clone 모드) | 10분 | 로컬 파일 분석 + LLM Probe 8건+ |
| Strategy Agent | 3분 | LLM 추론 기반 |
| Optimization Agent | 10분 | 다수 패치 생성 가능 |
| Validation Agent | 15분 | Analysis Agent(Clone) 호출 + Before-After 비교 + 사이클 판정 |
| Monitoring Agent | 단건 5분, 주기 무제한 | 상시 동작 |

타임아웃 초과 시: 부분 결과 저장 → Orchestrator에 `TIMEOUT` 상태 보고 → 사용자에게 알림.

### 9-A.3 파이프라인 실패 복원

```
Pipeline State Machine:

  INIT → ANALYZING → CLONING → STRATEGIZING → OPTIMIZING → VALIDATING → REPORTING → COMPLETED
    │         │          │           │              │            │            │
    │         └──────────┴───────────┴──────────────┴────────────┘            │
    │                                │                                        │
    │                     ┌──────────┘                                        │
    │                     │  (최적화 루프: 클론 대상으로만)                      │
    │                     │  STRATEGIZING → OPTIMIZING → VALIDATING           │
    │                     │       ↑                          │                │
    │                     │       └── 목표 미달 ─────────────┘                │
    ▼                     ▼                                                   │
  FAILED            PARTIAL_FAILURE                                           │
    │                     │                                                   │
    ▼                     ▼                                                   │
  [사용자 알림]     [부분 결과 보존 + 사용자 알림]                              │
                          │                                              COMPLETED
                     [재개(Resume) 가능]                            (Report + Archive 생성)
```

| 실패 지점 | 부분 결과 보존 | 복원 방법 |
|---|---|---|
| Analysis 실패 | 없음 | 처음부터 재실행 |
| Cloning 실패 | AnalysisReport 보존 | Cloning부터 재개 |
| Strategy 실패 | AnalysisReport + 클론 보존 | Strategy부터 재개 |
| Optimization 실패 | 클론 + OptimizationPlan 보존, 완료된 ChangeRecord 보존 | 미완료 태스크부터 재개 |
| Validation 실패 | 모든 클론 수정 완료 상태 | Validation만 재실행 |
| Reporting 실패 | 클론 + 모든 ChangeRecord 보존 | Report 생성만 재실행 |

### 9-A.4 롤백 정책

> 모든 롤백은 **로컬 클론**에 대해서만 수행된다. 원본 사이트는 절대 변경하지 않는다.

| 트리거 조건 | 롤백 범위 | 자동/수동 |
|---|---|---|
| Validation에서 구조적 점수 10점 이상 하락 | 클론의 마지막 변경 되돌림 | **자동** (사용자 알림 후) |
| Validation에서 콘텐츠 밀도 30% 이상 하락 | 클론의 마지막 변경 되돌림 | **자동** |
| Monitoring에서 원본 외부 변경 감지 | 해당 없음 (원본 변경이므로) | 수동 — 클론 재생성 권고 |
| 사용자 수동 롤백 요청 | 클론을 특정 ChangeRecord 이전 상태로 복원 | **수동** |

롤백 실행: `ContentSnapshot(before)` 기반으로 클론을 이전 상태로 복원.

### 9-A.5 에러 알림 체계

```typescript
ErrorEvent {
  error_id       : string              // UUID
  timestamp      : string              // ISO 8601
  agent_id       : string              // 발생 에이전트
  target_id      : string              // 대상 Target
  error_type     : 'api_error'         // LLM API 오류
                 | 'timeout'           // 타임아웃
                 | 'crawl_error'       // 크롤링 실패 (403, 네트워크 등)
                 | 'deploy_error'      // 배포 실패
                 | 'validation_regression' // 검증 시 점수 하락
                 | 'system_error'      // 내부 시스템 오류
  severity       : 'critical' | 'warning' | 'info'
  message        : string
  context        : Record<string, unknown>  // 디버깅 컨텍스트
  resolved       : boolean
}
```

알림 경로: 대시보드 실시간 표시 + TargetProfile.notifications.channels 설정에 따라 email/slack 발송.

---

## 9-B. LLM API 추상화 레이어

> Analysis Agent가 LLM Probe 수행 시 6개+ LLM에 질의하고, 에이전트 오케스트레이션에도 LLM을 사용한다.
> pi-ai가 기본 제공하는 멀티 프로바이더 기능 위에 GEO 특화 추상화를 추가한다.

### 9-B.1 기본 모델 및 Provider 정책

> **기본 오케스트레이션 모델**: `GPT-4o` (OpenAI)
> 사용자는 대시보드에서 다른 모델로 자유롭게 전환할 수 있다.

**지원 Provider 및 모델**:

| Provider | 인증 방식 | 기본 모델 (오케스트레이션) | Validation 대상 모델 |
|---|---|---|---|
| **OpenAI** | API Key / OAuth | ★ **GPT-4o** (기본값) | GPT-4o, GPT-4o-mini, o1, o3-mini |
| **Anthropic** | API Key | Claude Sonnet 4 | Claude Opus 4, Claude Sonnet 4, Claude Haiku |
| **Google** | API Key / OAuth (GCP) | Gemini 2.0 Flash | Gemini 2.0 Flash, Gemini 2.0 Pro |
| **Perplexity** | API Key | — | sonar-pro, sonar |
| **Microsoft** | OAuth (Azure AD) | — | Copilot (Bing AI) |
| **Meta** | API Key (via Together/Replicate) | — | Llama 3.x |

사용자가 대시보드에서 오케스트레이션 모델을 전환하면, 에이전트별 `model_preference`(4-A.2)를 통해 개별 에이전트에 다른 모델을 지정할 수도 있다.

### 9-B.2 LLM Provider 구조

```typescript
LLMProviderConfig {
  provider_id    : string              // 'openai' | 'anthropic' | 'google' | 'perplexity' | ...
  display_name   : string              // UI 표시명 (예: "OpenAI")
  enabled        : boolean             // 활성화 여부

  // === 인증 설정 (API Key 또는 OAuth — 둘 다 지원) ===
  auth           : LLMAuthConfig

  // === 모델 목록 ===
  models         : LLMModelConfig[]

  // === 속도 제한 ===
  rate_limit     : {
    requests_per_minute : number
    tokens_per_minute   : number
  }
}

// 인증 방식: API Key와 OAuth 모두 지원
LLMAuthConfig =
  | { method: 'api_key';  api_key_ref: string }      // 환경변수명 또는 시크릿 참조
  | { method: 'oauth';    oauth_config: OAuthConfig } // OAuth 2.0 흐름

OAuthConfig {
  provider       : 'google' | 'microsoft' | 'openai'  // OAuth 제공자
  client_id_ref  : string              // 환경변수명 (client_id)
  client_secret_ref: string            // 환경변수명 (client_secret)
  scopes         : string[]            // 요청 스코프
                                       // Google: ['https://www.googleapis.com/auth/generative-language']
                                       // Microsoft: ['https://cognitiveservices.azure.com/.default']
  token_endpoint : string | null       // 커스텀 토큰 엔드포인트 (null이면 기본값)
  redirect_uri   : string              // 기본: 'http://localhost:3000/auth/callback'

  // 토큰 관리 (자동)
  access_token   : string | null       // 런타임에 채워짐
  refresh_token  : string | null       // 런타임에 채워짐
  expires_at     : string | null       // ISO 8601, 자동 갱신
}

LLMModelConfig {
  model_id       : string              // 'gpt-4o', 'claude-sonnet-4-6' 등
  display_name   : string              // UI 표시명
  role           : 'orchestration'     // 에이전트 두뇌용 (고성능)
               | 'validation_target'   // 테스트 대상 (인용 측정용)
               | 'utility'            // 임베딩, 요약 등 보조 작업
               | 'both'               // 오케스트레이션 + 검증 대상 겸용
  is_default     : boolean             // 오케스트레이션 기본 모델 여부
  max_tokens     : number
  supports_tools : boolean             // Tool calling 지원 여부 (오케스트레이션 필수)
  cost_per_1k_tokens : {
    input  : number
    output : number
  }
}
```

### 9-B.3 인증 흐름

**(1) API Key 방식** (가장 간편):

```
[대시보드: /settings/llm-providers]
     │
     ├─ 사용자가 Provider 선택 (예: OpenAI)
     ├─ API Key 입력 (마스킹 표시)
     ├─ [연결 테스트] 버튼 → 간단한 API 호출로 키 유효성 확인
     │
     └─ 저장: workspace/config.json (암호화) 또는 환경변수 참조
```

**(2) OAuth 방식** (Google Cloud, Microsoft Azure 등):

```
[대시보드: /settings/llm-providers]
     │
     ├─ 사용자가 Provider 선택 (예: Google — OAuth)
     ├─ [Google 계정으로 연결] 버튼 클릭
     │
     ├─ OAuth 흐름 시작:
     │   ├─ localhost:3000/auth/callback 으로 리다이렉트 설정
     │   ├─ Google 로그인 + 권한 동의 화면
     │   ├─ Authorization Code → Access Token + Refresh Token 교환
     │   └─ 토큰을 workspace/config.json에 암호화 저장
     │
     ├─ Refresh Token으로 자동 갱신 (expires_at 기반)
     │
     └─ [연결 해제] 버튼 → 토큰 삭제
```

**(3) 다중 Provider 동시 설정**:

```
workspace/config.json (예시):

{
  "llm_providers": [
    {
      "provider_id": "openai",
      "enabled": true,
      "auth": { "method": "api_key", "api_key_ref": "OPENAI_API_KEY" },
      "models": [
        { "model_id": "gpt-4o", "role": "both", "is_default": true, ... },
        { "model_id": "gpt-4o-mini", "role": "validation_target", ... },
        { "model_id": "o1", "role": "validation_target", ... }
      ]
    },
    {
      "provider_id": "anthropic",
      "enabled": true,
      "auth": { "method": "api_key", "api_key_ref": "ANTHROPIC_API_KEY" },
      "models": [
        { "model_id": "claude-sonnet-4-6", "role": "both", ... },
        { "model_id": "claude-opus-4-6", "role": "orchestration", ... }
      ]
    },
    {
      "provider_id": "google",
      "enabled": true,
      "auth": {
        "method": "oauth",
        "oauth_config": {
          "provider": "google",
          "client_id_ref": "GOOGLE_CLIENT_ID",
          "client_secret_ref": "GOOGLE_CLIENT_SECRET",
          "scopes": ["https://www.googleapis.com/auth/generative-language"],
          "redirect_uri": "http://localhost:3000/auth/callback"
        }
      },
      "models": [
        { "model_id": "gemini-2.0-flash", "role": "both", ... },
        { "model_id": "gemini-2.0-pro", "role": "validation_target", ... }
      ]
    },
    {
      "provider_id": "perplexity",
      "enabled": true,
      "auth": { "method": "api_key", "api_key_ref": "PERPLEXITY_API_KEY" },
      "models": [
        { "model_id": "sonar-pro", "role": "validation_target", ... }
      ]
    }
  ],
  "default_orchestration_model": {
    "provider": "openai",
    "model": "gpt-4o"
  }
}
```

### 9-B.3-1 환경변수 Fallback (CI/CD 지원)

`ProviderConfigManager.loadAll()`는 `llm-providers.json` 파일에 API Key가 없을 때 표준 환경변수를 fallback으로 확인한다. GitHub Actions 등 CI/CD 환경에서 Secrets를 환경변수로 주입하면 별도 설정 파일 없이 LLM을 사용할 수 있다.

| Provider    | API Key 환경변수         | Base URL 환경변수         |
|-------------|--------------------------|---------------------------|
| openai      | `OPENAI_API_KEY`         | —                         |
| anthropic   | `ANTHROPIC_API_KEY`      | —                         |
| google      | `GOOGLE_API_KEY`         | —                         |
| microsoft   | `AZURE_OPENAI_API_KEY`   | `AZURE_OPENAI_BASE_URL`  |
| perplexity  | `PERPLEXITY_API_KEY`     | —                         |
| meta        | `META_API_KEY`           | —                         |

**규칙**:
- 환경변수는 파일 설정에 `api_key`가 없을 때만 적용 (파일 설정 우선)
- 환경변수로 키가 채워지면 해당 provider는 자동으로 `enabled: true`
- `saveAll()`은 환경변수 유래 키를 디스크에 저장하지 않음

**GitHub Actions 설정**:
1. Repository → Settings → Secrets에 `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL` 등록
2. Workflow에서 `env:`로 전달하면 `ProviderConfigManager`가 자동 인식

### 9-B.4 대시보드 LLM Provider 설정 UI

```
┌──────────────────────────────────────────────────────────────────┐
│  localhost:3000/settings/llm-providers                             │
│                                                                    │
│  ┌─ 오케스트레이션 기본 모델 ──────────────────────────────────┐  │
│  │  현재: [OpenAI GPT-4o ▼]                                    │  │
│  │  선택 가능: GPT-4o / GPT-4o-mini / Claude Sonnet 4 /       │  │
│  │            Claude Opus 4 / Gemini 2.0 Flash / ...           │  │
│  │  (연결된 Provider의 orchestration 가능 모델만 표시)           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─ LLM Providers ────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  ┌─ OpenAI ──────────────────────────────────  ✅ 연결됨 ┐  │  │
│  │  │  인증: API Key (sk-...****1234)                        │  │  │
│  │  │  모델: GPT-4o ★기본, GPT-4o-mini, o1, o3-mini        │  │  │
│  │  │  이번 달 비용: $12.34                                  │  │  │
│  │  │  [키 변경]  [연결 테스트]  [모델 설정]  [비활성화]     │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  │  ┌─ Anthropic ───────────────────────────────  ✅ 연결됨 ┐  │  │
│  │  │  인증: API Key (sk-ant-...****5678)                    │  │  │
│  │  │  모델: Claude Opus 4, Claude Sonnet 4, Claude Haiku   │  │  │
│  │  │  이번 달 비용: $8.56                                   │  │  │
│  │  │  [키 변경]  [연결 테스트]  [모델 설정]  [비활성화]     │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  │  ┌─ Google ──────────────────────────────────  ✅ 연결됨 ┐  │  │
│  │  │  인증: OAuth (user@gmail.com)                          │  │  │
│  │  │  모델: Gemini 2.0 Flash, Gemini 2.0 Pro               │  │  │
│  │  │  토큰 만료: 2026-03-17T23:00:00 (자동 갱신)            │  │  │
│  │  │  [연결 해제]  [재인증]  [모델 설정]  [비활성화]        │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  │  ┌─ Perplexity ──────────────────────────────  ⚠️ 미연결 ┐  │  │
│  │  │  인증: API Key (미설정)                                │  │  │
│  │  │  [API Key 입력]                                        │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  │  ┌─ Microsoft (Copilot) ─────────────────────  ⚠️ 미연결 ┐  │  │
│  │  │  인증: OAuth (Azure AD)                                │  │  │
│  │  │  [Microsoft 계정으로 연결]                              │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  │  ┌─ 월간 비용 요약 ─────────────────────────────────────┐   │  │
│  │  │  전체: $20.90  │ 일일 한도: [$5.00]  │ 잔여: $4.10   │   │  │
│  │  │  OpenAI: $12.34 │ Anthropic: $8.56                    │   │  │
│  │  └───────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### 9-B.5 에이전트용 vs 검증 대상용 분리

```
┌─ 에이전트 오케스트레이션용 ──────────────────────────────┐
│  역할: 에이전트의 "두뇌" — 분석, 전략, 최적화 수행        │
│  기본 모델: GPT-4o (대시보드에서 변경 가능)               │
│  에이전트별 개별 모델 지정: 4-A.2 model_preference        │
│  호출 방식: pi-agent-core Agent Loop 내부                  │
│  설정: 시스템 프롬프트 (4-A) + 컨텍스트 슬롯 주입         │
│  인증: 해당 Provider의 API Key 또는 OAuth 토큰 사용       │
└────────────────────────────────────────────────────────────┘

┌─ LLM Probe 테스트 대상용 ──────────────────────────────────┐
│  역할: "이 LLM이 Target Page를 잘 인용하는가" 측정 대상    │
│  대상: API Key가 설정된 모든 활성 Provider (병렬 실행)     │
│  Web Search: 원칙적으로 활성화 (실제 소비자 환경 재현)     │
│  호출 방식: GeoLLMClient.queryAll() — 전체 활성 LLM 동시   │
│  호출 주체: Analysis Agent (URL/Clone 모드 모두)           │
│  인증: 각 Provider별 설정된 인증 방식 자동 적용            │
│  주의: 에이전트 동작과 완전 분리 — 순수 질의+응답 수집용    │
└────────────────────────────────────────────────────────────┘
```

### 9-B.6 GeoLLMClient (검증 질의 통합 인터페이스)

```typescript
interface GeoLLMClient {
  // 단일 LLM에 질의 (web_search 기본 활성화)
  query(
    provider: string,
    query: string,
    options?: { model?: string; temperature?: number; web_search?: boolean }
  ): Promise<LLMProbe>;

  // 전체 활성 LLM에 동일 질의 (병렬 실행, web_search 기본 활성화)
  queryAll(
    query: string,
    options?: { concurrency?: number; web_search?: boolean }
  ): Promise<LLMProbe[]>;

  // 정보 인식 검증 (InfoRecognitionItem에 대한 질의 자동 생성)
  verifyInfoItem(
    item: InfoRecognitionItem,
    providers?: string[]
  ): Promise<InfoRecognitionPerLLM[]>;

  // 비용 추적
  getCostSummary(since?: string): Promise<CostSummary>;
}

CostSummary {
  total_cost         : number
  per_provider       : Record<string, number>
  total_requests     : number
  period_start       : string
}
```

### 9-B.7 비용 관리

| 정책 | 설명 |
|---|---|
| **일일 비용 한도** | `workspace/config.json`에서 설정, 초과 시 경고 + 새 질의 차단 |
| **응답 캐싱** | 동일 질의 + 동일 LLM + 24시간 이내 → 캐시된 응답 재사용 |
| **질의 배치** | Validation 시 모든 질의를 수집 후 LLM별로 배치 실행 (연결 재사용) |
| **비용 리포트** | 대시보드에 Provider별 / 에이전트별 API 비용 시각화 |

### 9-B.8 핵심 LLM 인터페이스

에이전트 시스템 전체에서 공유하는 LLM 호출 인터페이스 요약.

| 인터페이스 | 정의 위치 | 역할 |
|-----------|----------|------|
| `LLMRequest` | `geo-llm-client.ts` (Zod schema) | 모든 에이전트가 사용하는 LLM 호출 요청. 필드: `prompt`, `system_instruction?`, `model?`, `provider?`, `max_tokens?`, `temperature?`, `json_mode` |
| `LLMResponse` | `geo-llm-client.ts` (Zod schema) | LLM 응답. 필드: `content`, `model`, `provider`, `usage` (prompt/completion/total tokens), `latency_ms`, `cost_usd` |
| `chatLLM` | 각 에이전트 Deps 인터페이스 | `(req: LLMRequest) => Promise<LLMResponse>` — DI로 주입. Pipeline Runner가 실제 구현체를 바인딩 |
| `trackedChatLLM` | `pipeline-runner.ts` | `chatLLM`을 래핑하여 모든 LLM 호출을 인터셉트. 사용 모델, 토큰, 에러, 지연시간을 `LLMCallLogEntry[]`에 기록. Auth 에러 시 Orchestrator 정지 |
| `safeLLMCall<T>()` | `llm-helpers.ts` | LLM 호출 + 응답 파싱 헬퍼. 1회 retry 후 throw (4-D: fallback 없음). Auth 에러는 즉시 throw |

---

## 9-C. 클론 워크플로우 및 결과 전달

> **핵심 원칙**: 본 시스템은 Target Web Page에 대한 직접 수정 권한이 없다.
> 모든 최적화 작업은 로컬 클론에서 수행하며, 최종 결과는 리포트 + Archive로 전달한다.

### 9-C.1 Clone Manager (클론 생성 및 관리)

```
[Analysis Agent 완료 후]
    │
    ├─ Clone Manager 트리거
    │
    ├─ 원본 페이지 크롤링 (Analysis Agent의 Playwright 결과 재사용):
    │   ├─ 렌더링된 HTML 전체 저장
    │   ├─ 인라인/외부 CSS, 이미지 등 리소스 수집 (선택적)
    │   ├─ JSON-LD, 메타데이터 별도 추출
    │   └─ robots.txt, llms.txt 등 부속 파일 저장
    │
    ├─ 로컬 파일시스템에 클론 저장:
    │   workspace/clones/{target_id}/
    │     ├─ metadata.json        # 클론 메타데이터
    │     │   { clone_id, target_id, source_url, clone_path,
    │     │     created_at, updated_at, status, original_html_hash,
    │     │     file_count, total_size_bytes, cycle_count }
    │     ├─ original/            # 원본 (불변 — Before 비교 기준)
    │     │   ├─ index.html          # 홈페이지 HTML
    │     │   └─ {path}/...          # 멀티 페이지 크롤링 결과
    │     └─ working/             # 작업 사본 (Optimization Agent 수정 대상)
    │         ├─ index.html          # 수정 가능 사본
    │         └─ {path}/...          # 멀티 페이지 사본
    │
    ├─ TargetProfile.clone_base_path 업데이트
    │
    └─ ContentSnapshot(original) 생성 → DB 저장
```

**클론 관리 정책**:

| 정책 | 설명 |
|---|---|
| **원본 백업 보존** | `original/` 디렉토리는 절대 수정하지 않음 (Before 비교 기준) |
| **작업 사본** | `working/` 디렉토리의 파일이 Optimization Agent의 수정 대상 |
| **버전 관리** | 각 수정 시 ContentSnapshot 생성 → 언제든 특정 버전으로 롤백 가능 |
| **클론 재생성** | 원본 사이트가 외부 변경된 경우, 사용자가 "클론 재생성" 트리거 가능 |
| **클론 만료** | 클론 생성 후 일정 기간 경과 시 재생성 권고 알림 |

### 9-C.2 최적화 루프 (클론 대상)

```
[Optimization Agent — 클론의 working/ 디렉토리 파일 수정]
    │
    ├─ ContentSnapshot(before) 저장 (클론 현재 상태)
    │
    ├─ OptimizationPlan의 각 태스크를 클론 파일에 적용:
    │   ├─ HTML 구조 수정 (div→시맨틱 태그, heading 정규화)
    │   ├─ JSON-LD 추가/수정
    │   ├─ 콘텐츠 강화 (팩트 밀도, FAQ 섹션 등)
    │   └─ 각 변경마다 ChangeRecord 생성 (unified diff 포함)
    │
    ├─ 수정된 클론 저장
    │
    └─ Validation Agent로 전달
        │
        ├─ Analysis Agent를 Clone 모드로 호출 → 전체 재분석
        ├─ 초기 분석(baseline) AnalysisReport와 비교 → ChangeImpact 산출
        └─ 사이클 판정 (목표 미달 시 → Strategy Agent로 재순환)
```

### 9-C.3 결과 전달 (Report + Archive)

최적화 루프 완료 후, 사용자에게 두 가지 결과물을 제공한다.

> **[미구현 — 우선순위 높음]** 현재 최종 리포트는 `OptimizationReport`(Before-After 비교)만 HTML 렌더링한다.
> 초기 분석의 `RichAnalysisReport`(10탭 진단 결과)를 최종 리포트에 **함께 통합 렌더링**해야 한다.
> `dashboard-html-generator.ts`가 `DashboardData`에 `RichAnalysisReport`를 추가로 받아
> OptimizationReport 탭과 RichAnalysisReport 10탭을 하나의 HTML에 통합 출력하도록 확장할 것.

**(1) Before-After 비교 리포트 (OptimizationReport)**

```
┌─ GEO 최적화 리포트 ── Target: 메인 랜딩 페이지 ──────────┐
│                                                            │
│  ── 종합 요약 ──────────────────────────────────────────  │
│  구조적 GEO 점수: 42 → 78 (+36)                           │
│  예측 LLM 인용률 개선: +15~25% (과거 실적 기반)            │
│  총 변경 사항: 8건 (critical 3, high 3, medium 2)          │
│                                                            │
│  ── 변경 사항별 상세 ──────────────────────────────────── │
│                                                            │
│  #1 (critical) — JSON-LD Product 스키마 추가               │
│  Impact: 구조적 점수 +12  │  예측 인용률 +5~8%            │
│  ┌─ Before ────────────────┬─ After ─────────────────┐    │
│  │ (JSON-LD 없음)          │ <script type="ld+json"> │    │
│  │                          │ {"@type": "Product"...} │    │
│  └──────────────────────────┴────────────────────────┘    │
│                                                            │
│  #2 (critical) — FAQ 섹션 추가                             │
│  Impact: 구조적 점수 +8   │  예측 인용률 +3~5%            │
│  ┌─ Before ────────────────┬─ After ─────────────────┐    │
│  │ (FAQ 없음)              │ <section class="faq">   │    │
│  │                          │   <h2>자주 묻는 질문</h2>│    │
│  │                          │   ...                    │    │
│  └──────────────────────────┴────────────────────────┘    │
│  ...                                                       │
│                                                            │
│  ── LLM 기준선 현황 (초기 분석 시 측정) ───────────────── │
│  ChatGPT: 인용 2/10회 │ Claude: 인용 1/10회               │
│  Gemini: 인용 3/10회  │ Perplexity: 인용 4/10회           │
│                                                            │
│  [리포트 다운로드 (HTML/PDF)]  [Archive 다운로드 (.zip)]   │
│  [변경사항 원본 사이트에 적용 완료 → 재검증 트리거]         │
└────────────────────────────────────────────────────────────┘
```

**(2) Archive 파일 (.zip 다운로드)**

```
{target_name}_optimized_{date}.zip
  ├─ report.html              # Before-After 비교 리포트 (독립 실행 가능)
  ├─ optimized/
  │   ├─ index.html           # 최적화 완료된 전체 HTML
  │   ├─ structured-data.json # 추가/수정된 JSON-LD
  │   └─ assets/              # 리소스 (필요 시)
  ├─ patches/
  │   ├─ 001-schema-markup.patch   # 각 변경별 unified diff
  │   ├─ 002-faq-section.patch
  │   └─ ...
  ├─ original/
  │   └─ index.html           # 원본 HTML (비교 기준)
  └─ manifest.json            # 변경 목록, 각 Impact, 적용 순서
```

### 9-C.4 사용자의 적용 후 재검증

> **향후 확장 (미구현)**: 사용자가 원본 사이트에 변경사항을 수동 반영한 뒤, 대시보드에서 재검증을 트리거하는 플로우.
> 현재 시스템은 읽기 전용 원칙에 따라 **클론 대상으로만** 검증을 수행한다.
> 향후 사용자가 별도 수단으로 원본 사이트에 변경을 반영할 수 있는 시나리오가 지원되면,
> Analysis Agent를 URL 모드로 재호출하여 배포 후 실제 LLM 인용률 변화를 측정하는 기능을 추가할 수 있다.

```
[향후 확장 플로우 — 미구현]
[사용자: 원본 사이트에 변경 수동 반영 (시스템 외부에서)]
    │
    ├─ 대시보드에서 [적용 완료 → 재검증] 클릭
    │
    ├─ Analysis Agent (URL 모드): 원본 URL을 재분석
    │   (LLM 인덱스 갱신 대기 필요 — 최소 24~72시간 권장)
    │
    ├─ 초기 기준선(baseline) AnalysisReport 대비 실제 개선폭 산출
    │
    └─ ChangeImpact 확정 → Agent Memory에 학습 데이터로 저장
```

---

## 9-D. 데이터 저장 전략

### 9-D.1 저장소 선택 기준

| 데이터 | v1 (localhost) | 운영 환경 (v2+) |
|---|---|---|
| **TargetProfile, Config** | JSON 파일 (`workspace/`) | PostgreSQL |
| **Agent Prompts** | JSON 파일 (`workspace/prompts/`) | PostgreSQL |
| **AnalysisReport, Plans** | SQLite (`workspace/data/db/`) | PostgreSQL |
| **ContentSnapshot** | SQLite + 파일 (`workspace/data/snapshots/`) | PostgreSQL + S3 |
| **ChangeRecord, ChangeImpact** | SQLite | PostgreSQL |
| **GeoTimeSeries** | SQLite | TimescaleDB (PostgreSQL 확장) |
| **EffectivenessIndex** | SQLite | PostgreSQL (materialized view) |
| **SemanticChangeRecord (벡터)** | ChromaDB (로컬) | Pinecone / pgvector |
| **LLMProbe (응답 캐시)** | SQLite + Redis | Redis + PostgreSQL |

### 9-D.2 SQLite 테이블 구조 (v1)

```sql
-- 핵심 테이블 (v1 SQLite) — 총 10개 (구현 8 + 미구현 2)

CREATE TABLE targets (
  id              TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  topics          TEXT,                -- JSON (string[])
  target_queries  TEXT,                -- JSON (string[])
  competitors     TEXT,                -- JSON (CompetitorEntry[])
  llm_priorities  TEXT,                -- JSON (LLMPriority[])
  clone_base_path TEXT,
  site_type       TEXT DEFAULT 'generic',  -- 'manufacturer' | 'research' | 'generic'
  notifications   TEXT,                -- JSON
  status          TEXT DEFAULT 'active',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE pipeline_runs (
  id              TEXT PRIMARY KEY,
  target_id       TEXT NOT NULL,
  current_stage   TEXT NOT NULL,       -- PipelineStage enum
  status          TEXT NOT NULL,       -- 'running' | 'completed' | 'failed'
  config          TEXT,                -- JSON (OrchestratorConfig)
  error_message   TEXT,
  retry_count     INTEGER DEFAULT 0,
  current_cycle   INTEGER DEFAULT 0,
  analysis_ref    TEXT,
  plan_ref        TEXT,
  report_ref      TEXT,
  started_at      TEXT NOT NULL,
  completed_at    TEXT,
  FOREIGN KEY (target_id) REFERENCES targets(id)
);

CREATE TABLE stage_executions (
  id              TEXT PRIMARY KEY,
  pipeline_id     TEXT NOT NULL,
  stage           TEXT NOT NULL,       -- PipelineStage enum
  cycle           INTEGER DEFAULT 0,
  status          TEXT NOT NULL,       -- 'running' | 'completed' | 'failed'
  prompt_summary  TEXT,
  result_summary  TEXT,
  result_full     TEXT,                -- JSON (전체 결과 데이터)
  error_message   TEXT,
  duration_ms     INTEGER,
  started_at      TEXT NOT NULL,
  completed_at    TEXT,
  FOREIGN KEY (pipeline_id) REFERENCES pipeline_runs(id)
);

CREATE TABLE content_snapshots (
  snapshot_id     TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  captured_at     TEXT NOT NULL,       -- ISO 8601
  html_hash       TEXT NOT NULL,
  content_text    TEXT,
  structured_data TEXT,                -- JSON
  geo_score       TEXT,                -- JSON (GeoScore)
  FOREIGN KEY (target_id) REFERENCES targets(id)
);

CREATE TABLE change_records (
  change_id       TEXT PRIMARY KEY,
  experiment_id   TEXT,
  url             TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  changed_at      TEXT NOT NULL,
  change_type     TEXT NOT NULL,       -- ChangeType enum value
  change_summary  TEXT,
  diff            TEXT,
  snapshot_before TEXT REFERENCES content_snapshots(snapshot_id),
  snapshot_after  TEXT REFERENCES content_snapshots(snapshot_id),
  triggered_by    TEXT NOT NULL,       -- 'auto' | 'manual' | 'scheduled'
  strategy_ref    TEXT,
  FOREIGN KEY (target_id) REFERENCES targets(id)
);

CREATE TABLE change_impacts (
  change_id       TEXT PRIMARY KEY REFERENCES change_records(change_id),
  measured_at     TEXT NOT NULL,
  score_before    REAL,
  score_after     REAL,
  delta           REAL,
  delta_pct       REAL,
  per_llm_impact  TEXT,                -- JSON (Record<string, number>)
  confidence      REAL,
  confounders     TEXT,                -- JSON (string[])
  verdict         TEXT NOT NULL        -- 'positive' | 'negative' | 'neutral'
);

CREATE TABLE geo_time_series (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  url             TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  llm_service     TEXT NOT NULL,
  measured_at     TEXT NOT NULL,
  geo_score       REAL,
  citation_rate   REAL,
  citation_rank   INTEGER,
  change_id       TEXT REFERENCES change_records(change_id),
  delta_score     REAL
);
CREATE INDEX idx_gts_target_time ON geo_time_series(target_id, measured_at);
CREATE INDEX idx_gts_llm ON geo_time_series(llm_service, measured_at);

CREATE TABLE pipeline_runs (
  pipeline_id     TEXT PRIMARY KEY,
  target_id       TEXT NOT NULL,
  stage           TEXT NOT NULL,       -- 현재 파이프라인 스테이지
  started_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  completed_at    TEXT,
  analysis_report_ref  TEXT,
  optimization_plan_ref TEXT,
  validation_report_ref TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  resumable       INTEGER NOT NULL DEFAULT 0,
  resume_from_stage TEXT,
  FOREIGN KEY (target_id) REFERENCES targets(id)
);

CREATE TABLE stage_executions (
  id              TEXT PRIMARY KEY,
  pipeline_id     TEXT NOT NULL,
  stage           TEXT NOT NULL,       -- ANALYZING, CLONING, STRATEGIZING, ...
  cycle           INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending/running/completed/failed
  prompt_summary  TEXT NOT NULL DEFAULT '',
  result_summary  TEXT NOT NULL DEFAULT '',
  result_full     TEXT,                -- JSON (전체 결과, nullable)
  error_message   TEXT,
  started_at      TEXT NOT NULL,
  completed_at    TEXT,
  duration_ms     INTEGER,
  FOREIGN KEY (pipeline_id) REFERENCES pipeline_runs(pipeline_id)
);

-- [미구현] Level 1 GEO Score 산출을 위한 LLM 프로브 결과 저장
CREATE TABLE llm_probes (
  probe_id        TEXT PRIMARY KEY,
  target_id       TEXT NOT NULL,
  llm_service     TEXT NOT NULL,
  model_version   TEXT,
  query           TEXT NOT NULL,
  query_type      TEXT NOT NULL,
  response_text   TEXT,
  response_at     TEXT NOT NULL,
  cited           INTEGER NOT NULL,    -- 0 or 1
  citation_excerpt TEXT,
  citation_position INTEGER,
  accuracy_vs_source REAL,
  info_items_checked TEXT,             -- JSON
  FOREIGN KEY (target_id) REFERENCES targets(id)
);

-- [미구현] Agent Memory — 변경 유형별 효과 학습 데이터
CREATE TABLE effectiveness_index (
  url             TEXT NOT NULL,
  change_type     TEXT NOT NULL,
  llm_service     TEXT,                -- NULL = 전체 평균
  sample_count    INTEGER NOT NULL DEFAULT 0,
  avg_delta       REAL NOT NULL DEFAULT 0,
  success_rate    REAL NOT NULL DEFAULT 0,
  best_delta      REAL,
  worst_delta     REAL,
  last_updated    TEXT NOT NULL,
  PRIMARY KEY (url, change_type, llm_service)
);

CREATE TABLE error_events (
  error_id        TEXT PRIMARY KEY,
  timestamp       TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  target_id       TEXT,
  error_type      TEXT NOT NULL,
  severity        TEXT NOT NULL,
  message         TEXT NOT NULL,
  context         TEXT,                -- JSON
  resolved        INTEGER NOT NULL DEFAULT 0
);
```

### 9-D.3 마이그레이션 전략

```
v1 (@libsql/client + drizzle-orm)  →  v2+ (PostgreSQL)
      │
      ├─ @libsql/client → node-postgres 드라이버 교체
      │
      ├─ 추상화 레이어: Repository 패턴 적용
      │   ├─ interface ChangeRecordRepository { ... }
      │   ├─ class SqliteChangeRecordRepo implements ChangeRecordRepository
      │   └─ class PostgresChangeRecordRepo implements ChangeRecordRepository
      │
      ├─ 마이그레이션 도구: drizzle-orm (TypeScript 네이티브 ORM)
      │   ├─ drizzle-kit generate → SQL 마이그레이션 파일 자동 생성
      │   └─ drizzle-kit migrate → 마이그레이션 실행
      │
      └─ v1 → v2 데이터 이관: geo migrate 명령으로 SQLite → PostgreSQL 자동 이관
```

---

## 9-E. 평가 프롬프트 템플릿 시스템

### 9-E.1 개요

GEO 평가는 사이트 유형에 따라 평가 항목, 프로브(Probe), 채점 기준이 달라진다. 템플릿 시스템은 이를 유형별로 관리하고, 자동 분류 및 수동 선택을 지원한다.

```
┌─────────────────────────────────────────────────────────────┐
│              Evaluation Template System                       │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ manufacturer │  │  research    │  │   generic    │  ...  │
│  │ (제조사)     │  │  (연구소)    │  │   (기타)     │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │                 │
│         ▼                 ▼                 ▼                 │
│  ┌─────────────────────────────────────────────────┐         │
│  │           공통 평가 프레임워크                     │         │
│  │  Phase 1~8 동일 구조 · 7개 채점 차원 · 8개 프로브 │         │
│  │  가중치 동일 (15/25/20/10/10/10/10)               │         │
│  │  차원 이름·프로브 내용만 유형별 차별화              │         │
│  └─────────────────────────────────────────────────┘         │
│                          │                                    │
│                          ▼                                    │
│  ┌─────────────────────────────────────────────────┐         │
│  │       Interactive HTML Dashboard (공통 출력)      │         │
│  │  초기 / 중간 / 최종 결과 모두 동일 포맷            │         │
│  └─────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### 9-E.2 사이트 유형 분류

#### 지원 유형

| 유형 코드 | 한국어 이름 | 대표 사례 | 핵심 평가 초점 |
|---|---|---|---|
| `manufacturer` | 제조사 대표 Site | samsung.com, apple.com, sony.com | 제품 스키마, 가격/스펙 구조화, 카탈로그 |
| `research` | 연구소 대표 Site | research.samsung.com, research.google | ScholarlyArticle, 연구자, 논문 메타데이터 |
| `generic` | 기타 | 뉴스, 교육, 서비스, 정부, 블로그 | 기본 구조화 데이터, 콘텐츠 접근성 |

> 향후 확장: `ecommerce`, `media`, `education`, `government` 등 세분화 가능

#### 자동 분류 메커니즘

Analysis Agent가 초기 크롤링(Phase 1) 수행 후, 다음 시그널로 사이트 유형을 판정한다:

**`manufacturer` 시그널:**
- Product JSON-LD 스키마 존재
- Offer / AggregateRating 스키마 존재
- `/products/`, `/shop/`, `/buy/` 경로 존재
- E-commerce 관련 메타태그 (`og:product:price` 등)
- 제품 카탈로그 또는 카테고리 페이지 존재

**`research` 시그널:**
- ScholarlyArticle / TechArticle 스키마 존재
- `/publications/`, `/papers/`, `/research/` 경로 존재
- DOI 링크 존재
- 연구자 Person 스키마 (ORCID, affiliation)
- 학술 메타태그 (`citation_*`, `DC.*`)
- PDF 논문 다운로드 링크 존재

**`generic` (기본값):**
- 위 두 유형의 시그널이 모두 약함

#### 분류 결과 형식

```typescript
interface ClassificationResult {
  site_type: "manufacturer" | "research" | "generic";
  confidence: number;       // 0.0 ~ 1.0
  signals: string[];         // 탐지된 시그널 목록
  override: boolean;         // 사용자 수동 지정 여부
}
```

#### 수동 분류

- TargetProfile 생성/수정 시 `site_type` 필드로 수동 지정 가능
- 수동 지정 시 자동 분류를 건너뛰고 해당 유형 템플릿을 즉시 적용
- Dashboard에서 유형 변경 가능 (변경 시 재평가 트리거)

### 9-E.3 평가 템플릿 구조

#### 공통 프레임워크 (모든 유형 동일)

| Phase | 이름 | 설명 |
|---|---|---|
| Phase 1 | Infrastructure Crawl | robots.txt, llms.txt, sitemap, 홈페이지 스키마 |
| Phase 2 | Content Analysis | 유형별 주요 콘텐츠 분석 (제품/논문/일반) |
| Phase 3 | Structured Data Audit | 스키마 구현 현황 체크리스트 |
| Phase 4 | Synthetic Probe Suite | 유형별 8개 프로브 실행 |
| Phase 5 | Scoring Rubric | 7개 차원 채점 (가중치 동일: 15/25/20/10/10/10/10) |
| Phase 6 | Improvement Matrix | 개선 항목 생성 |
| Phase 7 | Output | Interactive HTML Dashboard 생성 |
| Phase 8 | Diff Mode | 이전 실행과 비교 (해당 시) |

#### 유형별 차별화 항목

| 항목 | manufacturer | research | generic |
|---|---|---|---|
| Phase 2 대상 | 제품 카탈로그, PDP, 비교 페이지 | 연구 분야, 논문 목록, 논문 상세, 연구자 | 콘텐츠 섹션, 목록, 상세 |
| Phase 3 체크리스트 | Product, Offer, AggregateRating 중심 | ScholarlyArticle, Person, Dataset 중심 | Article, Service, Organization 중심 |
| Phase 4 프로브 | 제품 스펙/가격/비교 중심 (P-01~P-08) | 논문/연구자/연구분야 중심 (P-01~P-08) | 조직 정보/콘텐츠/FAQ 중심 (P-01~P-08) |
| S-2 이름 | 구조화 데이터 품질 | 학술 데이터 구조화 품질 | 구조화 데이터 품질 |
| S-3 이름 | 제품 스펙 기계가독성 | 논문 정보 기계가독성 | 콘텐츠 기계가독성 |
| S-5 이름 | 브랜드 메시지 긍정도·일관성 | 연구소 신뢰도·권위 지표 | 브랜드/조직 신뢰도 지표 |

#### 템플릿 파일 위치

```
packages/core/src/prompts/evaluation-templates/
├── index.ts              # 템플릿 레지스트리, Zod 스키마, 공통 로직
├── manufacturer.md       # 제조사 대표 Site 평가 프롬프트
├── research.md           # 연구소 대표 Site 평가 프롬프트
└── generic.md            # 기타 Site 평가 프롬프트
```

### 9-E.4 Cycle 제어

#### 최적화 사이클 흐름

```
초기 평가 (원본 대상)
    │
    ▼
┌─── Cycle N ──────────────────────────────────────────────┐
│  1. 클론에 최적화 적용 (Optimization Agent)               │
│  2. 클론 재평가 (동일 템플릿, evaluation_target=clone)    │
│  3. 중간 결과 저장 (Dashboard에서 조회 가능)              │
│  4. 중단 조건 검사 ──┬── 충족 → 최종 결과 생성            │
│                       └── 미충족 → Cycle N+1               │
└──────────────────────────────────────────────────────────┘
```

#### 자동 중단 조건 (Auto-Stop)

| 조건 | 설명 | 기본값 |
|---|---|---|
| `score_sufficient` | 종합 점수가 목표에 도달 | target_score ≥ 80 |
| `no_more_improvements` | 직전 사이클 대비 개선폭 미달 | min_improvement < 2점 |
| `max_cycles_reached` | 최대 사이클 수 도달 | max_cycles = 10 |

#### 수동 제어

- **중간 결과 조회**: 매 사이클 완료 시 중간 결과가 저장되며, Dashboard에서 실시간 조회 가능
- **수동 중단**: 사용자가 현재 사이클을 최종 결과로 확정하고 중단 가능
  - 중단 시 현재까지의 최적화 결과가 최종 리포트에 포함
  - stop_reason: `manual_stop`

#### Cycle Control 스키마

```typescript
const CycleControlSchema = z.object({
  max_cycles: z.number().default(10),
  target_score: z.number().min(0).max(100).default(80),
  min_improvement_per_cycle: z.number().default(2),
  current_cycle: z.number().default(0),
  stop_reason: z.enum([
    "score_sufficient",
    "no_more_improvements",
    "max_cycles_reached",
    "manual_stop"
  ]).optional(),
  intermediate_results: z.array(EvaluationResultSchema).default([]),
});
```

#### API 엔드포인트

```
GET  /api/targets/{id}/cycle/status          # 현재 사이클 상태 조회
GET  /api/targets/{id}/cycle/intermediate     # 중간 결과 목록 조회
GET  /api/targets/{id}/cycle/intermediate/{n} # N번째 사이클 결과 조회
POST /api/targets/{id}/cycle/stop             # 수동 중단 (현재 결과를 최종으로)
PUT  /api/targets/{id}/cycle/config           # 사이클 설정 변경 (max, target 등)
```

### 9-E.5 Interactive Dashboard 출력 사양

단일 HTML 파일 (Chart.js CDN, 다크 테마, 인라인 CSS/JS). 구현: `dashboard-html-generator.ts`.

**현재 상태**: `OptimizationReport` 기반 9탭(Overview, Score Breakdown, Changes, Before vs After 등)만 렌더링.
**목표**: `RichAnalysisReport` 10탭(overview, crawlability, structured_data, products, brand, pages, recommendations, evidence, probes, roadmap)을 통합하여 하나의 HTML에 출력. 상세는 9-C.3 참조.

---

## 11. Known Issues (v1 한계)

> 상세 설명, 영향 범위, 해결 방향은 각 GitHub Issue를 참조한다.

| # | 항목 | 심각도 | 로드맵 | Issue |
|---|------|--------|--------|-------|
| KI-001 | 인용 감정(Citation Sentiment) 분석 부재 | 높음 | v2 | [#29](https://github.com/myungjoo/GEO-agent/issues/29) |
| KI-002 | 외부 평판 환경 분석 부재 | 높음 | v3 | [#30](https://github.com/myungjoo/GEO-agent/issues/30) |
| KI-003 | LLM 지식 획득 경로 미구분 | 중간 | v3 | [#31](https://github.com/myungjoo/GEO-agent/issues/31) |
| KI-004 | 테스트 질의(Query Universe) 설계 체계 부재 | 중간 | v2 | [#32](https://github.com/myungjoo/GEO-agent/issues/32) |
| KI-005 | 간접 인용 감지 부재 | 중간 | v2 | [#33](https://github.com/myungjoo/GEO-agent/issues/33) |
| KI-006 | ~~배포 경계 미정의~~ | ~~해결됨~~ | — | 읽기 전용 원칙 (섹션 1.3) |
| KI-007 | LLM 신뢰 형성 모델 부재 | 낮음 | v4 | [#34](https://github.com/myungjoo/GEO-agent/issues/34) |
| KI-008 | Remote Web 대시보드 미지원 | 낮음 | v3 | [#35](https://github.com/myungjoo/GEO-agent/issues/35) |
| KI-009 | 에이전트 자동 생성 스킬 안전성 검증 | 중간 | v2 | [#36](https://github.com/myungjoo/GEO-agent/issues/36) |
| KI-010 | pi-mono 업스트림 의존 관리 | 낮음 | v4 | [#37](https://github.com/myungjoo/GEO-agent/issues/37) |
| KI-011 | 멀티 페이지 최적화 미적용 | 높음 | v2 | [#38](https://github.com/myungjoo/GEO-agent/issues/38) |

---

## 12. 향후 확장 계획

| Phase | 내용 |
|---|---|
| **Phase 1** | 단일 URL 분석 + 로컬 클론 기반 최적화 + Before-After 리포트 MVP |
| **Phase 2** | 자동 최적화 루프 및 멀티 LLM 검증 파이프라인 |
| **Phase 3** | 사이트 전체 GEO 자동화 (sitemap 기반 다중 URL) |
| **Phase 4** | 실시간 모니터링 대시보드 및 알림 시스템 |
| **Phase 5** | 경쟁사 GEO 인텔리전스 및 기회 자동 발굴 |

---

*최종 수정: 2026-03-22*
