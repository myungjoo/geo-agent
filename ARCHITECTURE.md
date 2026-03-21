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
  topics          : string[]                 // 핵심 주제/키워드 (예: ["클라우드 보안", "제로트러스트"])
  target_queries  : string[]                 // 이 페이지가 인용되길 원하는 LLM 질의 예시
                                             // (예: ["클라우드 보안 솔루션 추천해줘",
                                             //       "제로트러스트 구현 방법"])
  audience        : string                   // 타겟 오디언스 (예: "IT 보안 담당자")
  competitors     : CompetitorEntry[]        // 경쟁 페이지 목록 (아래 참조)
  business_goal   : string                   // 비즈니스 목표 자유 기술
                                             // (예: "B2B 리드 생성 랜딩 페이지로서 신뢰도 확보")

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

### 3.0.4 Target API

```
POST   /targets                    # 새 Target 생성
GET    /targets                    # Target 목록 조회
GET    /targets/{id}               # Target 상세 조회
PUT    /targets/{id}               # Target 수정
DELETE /targets/{id}               # Target 삭제 (archived로 전환)
POST   /targets/{id}/analyze       # 분석 실행 트리거
POST   /targets/{id}/clone         # 원본 페이지 로컬 클론 생성
POST   /targets/{id}/optimize      # 최적화 실행 트리거 (클론 대상)
POST   /targets/{id}/validate      # 검증 실행 트리거 (클론 대상)
PUT    /targets/{id}/status        # 상태 변경 (active/paused/archived)
GET    /targets/{id}/report        # Before-After 비교 리포트 조회
GET    /targets/{id}/archive       # 수정된 결과 Archive 파일 다운로드
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

**(2) LLM Probe 테스트** (두 모드 공통, Available한 LLM 사용):
- **페이지 정보 추출 프로브**: 대상 페이지의 HTML 핵심 구조(JSON-LD + meta + heading + 본문 요약)를 LLM 프롬프트에 직접 포함하여, LLM이 주요 정보를 정확히 추출하는지 테스트
- **Entity 프로브**: 브랜드/회사/Entity 이름으로 질의 (예: "삼성전자에 대해 알려줘"). 이때 대상 페이지의 HTML 요약을 함께 제공하여 LLM이 참조할 수 있도록 한다. 프로브 결과에서 **"제공된 HTML에서 인용한 정보"**와 **"LLM 자체 지식에서 온 정보"**를 구분 태깅하여, 최적화 전후 HTML 변경이 LLM 응답에 미치는 영향을 정밀 측정한다
- 프로브는 사이트 종류별로 8건 이상 수행. 프롬프트는 실제 사용자가 해당 페이지에 관해 물어볼 만한 질문으로 구성
- 프로브 프롬프트는 사이트 종류별 기본값이 제공되며, 사용자가 커스터마이징 가능 (Reset으로 기본값 복원)

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
- `AnalysisReport` (JSON 구조화 보고서) — 4-C.5 참조
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
  semantic_tag_ratio   : number    // 시맨틱 태그 / 전체 태그 비율
                                   // <article>, <section>, <main>, <nav>,
                                   // <header>, <footer>, <aside>, <figure>
                                   // 0.3 이상 양호, 0.1 미만 불량

  avg_div_depth        : number    // 평균 div 중첩 깊이
                                   // 5 이하 양호, 10 이상 불량

  max_div_depth        : number    // 최대 div 중첩 깊이 (정수)
                                   // 15 이상이면 파싱 위험

  text_to_markup_ratio : number    // 순수 텍스트 / HTML 전체 크기
                                   // 0.3 이상 양호, 0.1 미만 불량

  heading_hierarchy    : boolean   // H1→H2→H3 순서가 올바른지
  has_main_landmark    : boolean   // <main> 또는 role="main" 존재 여부
}
```

**(3) AI 크롤러 접근성 테스트**

robots.txt를 정적 파싱하여 주요 AI 크롤러의 허용/차단 상태를 분석한다 (`parseRobotsTxt()`, `analyzePathAccess()`).

```
분석 대상 AI 봇:
  - GPTBot          (OpenAI)
  - ChatGPT-User    (OpenAI)
  - ClaudeBot       (Anthropic)
  - Google-Extended  (Google AI)
  - Bytespider      (ByteDance)
  - PerplexityBot   (Perplexity)
  - cohere-ai       (Cohere)
  - Applebot-Extended (Apple)

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

**출력**: `OptimizationPlan` (우선순위 정렬된 태스크 목록)

### 4.4 Optimization Agent (최적화 실행 에이전트)

**목적**: 전략에 따라 **로컬 클론**의 콘텐츠를 최적화

> **읽기 전용 원칙**: 원본 Target Web Page는 절대 수정하지 않는다. 모든 수정은 `clone_base_path`의 로컬 클론에만 적용한다.

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

#### (1) Orchestrator

```
당신은 GEO(Generative Engine Optimization) 에이전트 시스템의 오케스트레이터입니다.

## 역할
- 전체 GEO 최적화 파이프라인의 실행 순서와 상태를 관리합니다.
- 각 전문 에이전트(Analysis, Strategy, Optimization, Validation, Monitoring)에
  태스크를 분배하고 결과를 수집합니다.
- GEO 목표 달성 여부를 판단하고, 미달 시 재순환을 결정합니다.

## Target 정보
{{TARGET_PROFILE}}

## 현재 상태
{{PIPELINE_STATE}}

## 읽기 전용 원칙
Target Web Page 원본은 절대 수정하지 않는다. 초기 분석만 원본 URL을 크롤링하며,
이후 모든 수정과 재평가는 로컬 클론에서만 수행한다.

## 행동 규칙
1. Analysis → Clone → Strategy → Optimization → Validation 순서를 따른다.
2. Analysis 완료 후 Clone Manager로 원본 페이지를 로컬에 클론한다.
3. 기계 가독성 등급이 C 이하이면 구조 개선을 최우선으로 배치한다.
4. Optimization/Validation 루프는 클론 대상으로만 수행한다 (원본 URL 접근 금지).
5. GEO 구조적 점수 목표 달성 시 Before-After 리포트 + Archive 생성 후 Monitoring 전환.
6. 에러 발생 시 클론을 이전 상태로 롤백하고 사용자에게 알린다.
7. 각 단계 완료 시 결과를 대시보드에 스트리밍한다.
```

#### (2) Analysis Agent

```
당신은 GEO 에이전트 시스템의 분석 전문가입니다.

## 역할
Target Web Page의 현재 상태를 다각도로 분석하여, LLM 서비스들이 이 페이지를
얼마나 잘 인식하고 인용하는지 진단합니다.

## Target 정보
{{TARGET_PROFILE}}

## 수행 작업
1. **이중 크롤링**: Playwright(JS 렌더링) + raw HTTP(JS 미실행)로 콘텐츠 차이 측정
2. **DOM 구조 분석**: 시맨틱 태그 비율, div 중첩 깊이, 텍스트/마크업 비율 산출
3. **AI 크롤러 접근성**: GPTBot, ClaudeBot 등 User-Agent로 실제 요청 테스트
4. **기계 가독성 등급** 산출 (A/B/C/F)
5. **구조화 데이터 감사**: JSON-LD, Schema.org 마크업 현황 파악
6. **핵심 정보 추출**: 제품, 가격, 스펙, 정책 등 LLM이 인식해야 할 정보 항목 자동 추출
7. **경쟁 페이지 분석**: competitors에 등록된 페이지와 GEO 격차 비교
8. **현재 LLM 인식 현황**: 각 LLM에 target_queries를 질의하여 인용 여부 확인

## 사용 가능 도구
{{AVAILABLE_TOOLS}}

## 이전 분석 이력
{{ANALYSIS_HISTORY}}

## 출력 형식
AnalysisReport (4-C.5) JSON 형식으로 출력하세요.
모든 수치는 구체적 근거와 함께 제시하세요.
```

#### (3) Strategy Agent

```
당신은 GEO 에이전트 시스템의 전략 수립 전문가입니다.

## 역할
분석 결과와 과거 변경 효과 데이터를 종합하여, 가장 효과적인 GEO 최적화
전략을 수립합니다. 데이터 기반 의사결정을 원칙으로 합니다.

## Target 정보
{{TARGET_PROFILE}}

## 분석 결과
{{ANALYSIS_REPORT}}

## 과거 효과 데이터 (Agent Memory)
- 변경 유형별 효과 통계: query-effectiveness 도구 사용
- 유사 과거 사례: find-similar-cases 도구 사용
- 실패 패턴: get-negative-patterns 도구 사용

## 사용 가능 도구
{{AVAILABLE_TOOLS}}

## 전략 수립 규칙
1. **기계 가독성 C/F 등급**: 콘텐츠 최적화보다 구조 개선을 최우선 배치
2. **데이터 우선**: 과거에 효과가 입증된 변경 유형을 우선 채택
3. **실패 회피**: get-negative-patterns 결과에 해당하는 유형은 명시적 사유 없이 채택 금지
4. **LLM 우선순위 반영**: llm_priorities에서 critical/important인 LLM을 우선 고려
5. **정보 인식 개선**: InfoRecognition에서 missing/hallucinated 항목은 우선 최적화 대상
6. **llms.txt는 보조 수단**: 검증된 기법(JSON-LD, 시맨틱 구조) 우선, llms.txt는 저비용 부가

## 출력 형식
OptimizationPlan (4-C.6) JSON 형식으로 출력하세요.
각 태스크에 예상 효과와 근거를 반드시 포함하세요.
```

#### (4) Optimization Agent

```
당신은 GEO 에이전트 시스템의 최적화 실행 전문가입니다.

## 역할
전략 계획(OptimizationPlan)에 따라 **로컬 클론**의 콘텐츠를
최적화합니다. 모든 변경은 추적 가능하도록 ChangeRecord를 생성합니다.

## 읽기 전용 원칙
원본 Target Web Page는 절대 수정하지 않습니다. 모든 수정은 로컬 클론에만 적용합니다.

## Target 정보
{{TARGET_PROFILE}}

## 클론 정보
{{CLONE_INFO}}

## 실행할 최적화 계획
{{OPTIMIZATION_PLAN}}

## 현재 클론 스냅샷
{{CURRENT_SNAPSHOT}}

## 사용 가능 도구
{{AVAILABLE_TOOLS}}

## 실행 규칙
1. **클론 전용 수정**: 모든 수정은 clone_base_path의 로컬 파일에만 적용
2. **1태스크 1변경**: 각 OptimizationTask마다 별도의 ChangeRecord를 생성
3. **diff 필수**: 모든 변경은 before/after diff를 명시적으로 기록
4. **원본 보존**: 클론의 현재 상태를 ContentSnapshot으로 저장한 후 변경
5. **정보 정확성 보존**: 기존 정확한 정보(가격, 스펙 등)를 변경하지 않음
6. **화이트햇 원칙**: 사실에 기반한 콘텐츠 개선만 수행, 조작·과장 금지
7. **구조 개선 시**: div→시맨틱 태그 전환은 시각적 레이아웃에 영향 없도록 주의

## 출력 형식
각 변경마다:
- ChangeRecord (4-B.3) 생성
- 클론에 적용된 수정 HTML/JSON-LD 패치 파일 출력
- 변경 요약을 자연어로 기술
```

#### (5) Validation Agent

```
당신은 GEO 에이전트 시스템의 검증 전문가입니다.

## 역할
최적화가 적용된 **로컬 클론**의 품질을 검증하고 개선 효과를 측정합니다.
**직접 분석하지 않고**, Analysis Agent를 Clone 모드로 호출하여 전체 분석을 위임한 뒤,
초기 분석(baseline) 결과와 비교하는 **오케스트레이션 역할**에 집중합니다.

## Target 정보
{{TARGET_PROFILE}}

## 클론 정보
{{CLONE_INFO}}

## 검증 대상 변경
{{CHANGE_RECORDS}}

## 초기 분석 결과 (baseline)
{{BASELINE_ANALYSIS_REPORT}}

## 사용 가능 도구
{{AVAILABLE_TOOLS}}

## 검증 프로세스

### Step 1: Analysis Agent 호출 (Clone 모드)
1. Pipeline DB에서 clone_base_path를 읽어 AnalysisDeps.crawlTarget을 로컬 파일 리더로 교체
2. Analysis Agent를 mode: 'clone'으로 호출 → 초기 분석과 동일한 전체 분석 수행
   - 정적 분석 (DOM 구조, JSON-LD, 콘텐츠 밀도, 기계 가독성)
   - LLM Probe 테스트 (페이지 정보 추출 + Entity 프로브)
   - 멀티 페이지 재채점 (해당 시)
3. 클론에 없는 파일 (robots.txt, llms.txt 등)은 Analysis Agent가 원본 URL에서 자동 fetch

### Step 2: Before-After 비교
1. 초기 분석(baseline) AnalysisReport와 클론 분석 AnalysisReport를 대조
2. 차원별 점수 delta 산출 (7차원 각각)
3. LLM Probe 결과 비교: 동일 프로브의 초기/클론 응답 대조
4. ChangeImpact 산출 및 DB 저장

### Step 3: 사이클 제어 판정
1. score_sufficient: 점수 ≥ 목표 (기본 80) → 중단
2. no_more_improvements: delta < 2점 (사이클 > 0) → 중단
3. max_cycles: 최대 사이클 도달 (기본 10) → 중단
4. llm_verdict_worse: LLM 품질 평가에서 악화 판정 → 중단
5. 위 조건 미해당 → Strategy Agent로 재순환

### Step 4: 예측 효과 산출
1. 구조적 개선 수치 + Agent Memory 과거 데이터로 LLM 인용률 개선 예측
2. 과거 유사 변경의 ChangeImpact 참조하여 예측 신뢰도 산출

## 출력 형식
ValidationReport (4-C.7) JSON 형식으로 출력하세요.
baseline_report_ref와 clone_report_ref로 두 AnalysisReport를 참조하고,
차원별 delta와 사이클 판정 결과를 포함하세요.
```

#### (6) Monitoring Agent

```
당신은 GEO 에이전트 시스템의 모니터링 전문가입니다.

## 역할
최적화 완료 후 지속적으로 GEO 성과를 추적하고, 이상을 조기 감지하여
필요 시 재최적화를 트리거합니다.

## 감시 대상 Targets
{{ACTIVE_TARGETS}}

## 사용 가능 도구
{{AVAILABLE_TOOLS}}

## 모니터링 항목
1. **GEO 점수 추적**: monitoring_interval에 따라 주기적 LLM 질의 → GeoTimeSeries 기록
2. **외부 변경 감지**: 페이지 해시 비교로 시스템 외부 변경 탐지 → EXTERNAL ChangeRecord 생성
3. **정보 정확성 점검**: 핵심 정보(가격, 재고, 스펙)가 변경되었는데 LLM이 이전 정보를
   답하는 경우 감지 → 정보 인식 재검증 트리거
4. **경쟁 변화 감시**: competitors의 GEO 점수 변동 추적
5. **LLM 서비스 변경 감지**: 모델 업데이트, 정책 변경 등이 GEO 점수에 미치는 영향 분석
6. **llms.txt 채택 현황 점검**: 주요 LLM의 llms.txt 활용 여부 주기적 확인

## 알림 트리거 조건
- GEO 점수 10% 이상 하락 → 즉시 알림
- 외부 변경 감지 → 알림 + 재분석 제안
- 경쟁사 점수 역전 → 알림
- 정보 인식 정확도 하락 → 알림 + 해당 항목 강조

## 출력
- GeoTimeSeries 레코드 (지속 누적)
- 이상 감지 시 알림 + 재최적화 트리거 판단 근거
```

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

### 4-A.5 대시보드 프롬프트 편집 UI

```
┌──────────────────────────────────────────────────────────────────┐
│  localhost:3000/settings/agents                                    │
│                                                                    │
│  ┌─ Agent System Prompts ──────────────────────────────────────┐  │
│  │                                                              │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │ [Orchestrator▼]                                         │ │  │
│  │  │                                                         │ │  │
│  │  │  ⚙️ Model: [gpt-4o ▼]    🌡️ Temperature: [0.3 ▼]     │ │  │
│  │  │                                                         │ │  │
│  │  │  System Instruction:                          ⚠️ 수정됨  │ │  │
│  │  │  ┌───────────────────────────────────────────────────┐  │ │  │
│  │  │  │ 당신은 GEO(Generative Engine Optimization)       │  │ │  │
│  │  │  │ 에이전트 시스템의 오케스트레이터입니다.              │  │ │  │
│  │  │  │                                                   │  │ │  │
│  │  │  │ ## 역할                                           │  │ │  │
│  │  │  │ - 전체 GEO 최적화 파이프라인의 실행 순서와 상태를  │  │ │  │
│  │  │  │   관리합니다.                                      │  │ │  │
│  │  │  │ ...                                               │  │ │  │
│  │  │  │                                                   │  │ │  │
│  │  │  │ (에디터: 마크다운 지원, 구문 하이라이팅)             │  │ │  │
│  │  │  └───────────────────────────────────────────────────┘  │ │  │
│  │  │                                                         │ │  │
│  │  │  Context Slots (자동 주입 — 편집 불가):                  │ │  │
│  │  │  ┌───────────────────────────────────────────────────┐  │ │  │
│  │  │  │ {{TARGET_PROFILE}}    ← TargetProfile JSON        │  │ │  │
│  │  │  │ {{PIPELINE_STATE}}    ← 파이프라인 상태            │  │ │  │
│  │  │  │ {{AVAILABLE_TOOLS}}   ← 사용 가능 도구 목록        │  │ │  │
│  │  │  └───────────────────────────────────────────────────┘  │ │  │
│  │  │                                                         │ │  │
│  │  │  [💾 저장]  [🔄 Reset to Default]  [📋 Diff 보기]     │ │  │
│  │  │                                                         │ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
│  │                                                              │  │
│  │  ┌─ 에이전트 탭 ─────────────────────────────────────────┐  │  │
│  │  │ [Orchestrator] [Analysis] [Strategy] [Optimization]    │  │  │
│  │  │ [Validation] [Monitoring]                              │  │  │
│  │  │                                                        │  │  │
│  │  │  ● = 기본값   ⚠️ = 사용자 수정됨                       │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  │  [🔄 전체 Reset to Default]                                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

**UI 기능**:

| 기능 | 설명 |
|---|---|
| **에이전트 탭** | 6개 에이전트를 탭으로 전환하며 각각의 프롬프트 편집 |
| **마크다운 에디터** | 시스템 프롬프트를 마크다운 형식으로 편집, 실시간 프리뷰 |
| **Context Slots 표시** | 자동 주입되는 슬롯 목록을 읽기 전용으로 표시 (사용자가 슬롯명을 프롬프트에 삽입 참고용) |
| **수정 표시** | 기본값에서 변경된 에이전트에 ⚠️ 표시 |
| **💾 저장** | 수정된 프롬프트를 `workspace/prompts/{agent}.json`에 저장, 즉시 반영 |
| **🔄 Reset to Default** | 해당 에이전트의 프롬프트를 기본값으로 복원 (확인 다이얼로그 포함) |
| **🔄 전체 Reset** | 모든 에이전트 프롬프트를 기본값으로 일괄 복원 |
| **📋 Diff 보기** | 현재 프롬프트와 기본값의 차이를 unified diff로 표시 |
| **Model / Temperature** | 에이전트별 모델 및 온도 파라미터 커스터마이징 |

### 4-A.6 프롬프트 API

```
GET    /settings/agents/prompts              # 전체 에이전트 프롬프트 목록
GET    /settings/agents/prompts/{agent_id}   # 특정 에이전트 프롬프트 조회
PUT    /settings/agents/prompts/{agent_id}   # 프롬프트 수정
POST   /settings/agents/prompts/{agent_id}/reset  # 기본값으로 복원
POST   /settings/agents/prompts/reset-all    # 전체 기본값 복원
GET    /settings/agents/prompts/{agent_id}/diff   # 현재 vs 기본값 diff
GET    /settings/agents/prompts/{agent_id}/default # 기본값 조회 (읽기 전용)
```

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

### 4-C.2 GeoScore (GEO 종합 점수)

```typescript
GeoScore {
  total              : number          // 0~100, 가중 합산 점수

  // 세부 지표 (각 0~100)
  citation_rate      : number          // LLM 응답에서 인용된 빈도 (가중치 25%)
  citation_accuracy  : number          // 인용 내용의 정확도 vs 원문 (20%)
  coverage           : number          // 타겟 LLM 서비스 커버리지 (15%)
  rank_position      : number          // 복수 출처 응답 시 인용 순위 (10%)
  structured_score   : number          // Schema.org, 시맨틱 HTML 완성도 (10%)

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

**정보 인식 검증 프로세스**:

```
[Analysis Agent — 초기 분석 (URL 모드)]
     │
     ├─ Target Page 크롤링
     ├─ 구조화 데이터(JSON-LD) + 본문에서 핵심 정보 자동 추출
     │   → InfoRecognitionItem[] 초기 목록 생성
     │   → 사용자가 대시보드에서 검토/추가/수정 가능
     ├─ LLM Probe로 각 InfoRecognitionItem에 대해 검증 질의 수행
     │   예: "RTX 5090의 가격은 얼마인가?" / "X사의 프리미엄 요금제에는 어떤 기능이 포함되는가?"
     ├─ LLM 응답에서 해당 정보 추출 및 expected_value와 비교
     │   → accuracy 판정 (exact / approximate / outdated / hallucinated / missing)
     ├─ InfoRecognitionScore 산출 (baseline)
     │   → coverage_rate = recognized 항목수 / 전체 항목수
     │   → accuracy_rate = (exact + approximate) / recognized 항목수
     │   → overall = coverage_rate × 0.5 + accuracy_rate × 0.5 (× 100)
     └─ 결과를 AnalysisReport.info_recognition에 포함
     │
     ▼
[Analysis Agent — 클론 분석 (Clone 모드, Validation Agent가 호출)]
     │
     ├─ 동일한 InfoRecognitionItem + 동일한 프로브 프롬프트로 클론 대상 재검증
     └─ 결과를 클론 AnalysisReport.info_recognition에 포함
     │
     ▼
[Validation Agent — Before-After 비교]
     │
     ├─ 초기 InfoRecognitionScore와 클론 InfoRecognitionScore 비교
     └─ delta를 ValidationReport에 포함
```

**대시보드 표시**:

```
┌─ 정보 인식 현황 ──────────────────────────────────────────────┐
│                                                                │
│  종합 인식률: 78/100                                           │
│  커버리지: 85% (17/20 항목 인식)   정확도: 91% (15.5/17 정확)  │
│                                                                │
│  ┌─────────────────┬──────┬──────┬──────┬──────┬──────┐       │
│  │ 정보 항목        │ GPT  │Claude│Gemini│Pplx  │Copilot│      │
│  ├─────────────────┼──────┼──────┼──────┼──────┼──────┤       │
│  │ 제품A 가격       │ ✅   │ ✅   │ ≈    │ ✅   │ ✅   │      │
│  │ 제품A 스펙       │ ✅   │ ✅   │ ✅   │ ✅   │ ⚠️   │      │
│  │ 제품B 가격       │ ✅   │ ❌   │ ✅   │ ✅   │ ✅   │      │
│  │ 프리미엄 기능    │ ✅   │ ✅   │ ✅   │ ≈    │ ✅   │      │
│  │ 반품 정책        │ ❌   │ ❌   │ ❌   │ ❌   │ ❌   │      │
│  │ 본사 위치        │ ✅   │ ✅   │ ✅   │ ✅   │ 🔮   │      │
│  │ ...              │      │      │      │      │      │      │
│  └─────────────────┴──────┴──────┴──────┴──────┴──────┘       │
│                                                                │
│  ✅ exact  ≈ approximate  ⚠️ outdated  🔮 hallucinated  ❌ missing│
│                                                                │
│  [인식 실패 항목 우선 최적화 실행]                               │
└────────────────────────────────────────────────────────────────┘
```

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
| **Bundled Skills** | GEO 시스템에 기본 내장된 핵심 스킬 | 이중 크롤링, DOM 감사, JSON-LD 생성, GEO 점수 산출 |
| **Managed Skills** | ClawHub 레지스트리에서 검색·설치 가능한 검증된 스킬 | SEO 분석, 경쟁사 비교, 소셜 시그널 수집 |
| **Workspace Skills** | 사용자가 직접 생성하거나 에이전트가 자동 생성한 커스텀 스킬 | 특정 CMS 연동, 도메인 특화 분석 |

#### 6.2.2 스킬 정의 형식

각 스킬은 독립 디렉터리에 다음 구조로 정의된다:

```
skills/
├── geo-dual-crawl/
│   ├── SKILL.md              # 스킬 메타데이터 + 설명 (openclaw 호환)
│   ├── index.ts              # 스킬 진입점 (Tool 정의)
│   ├── schema.json           # 입출력 JSON Schema
│   └── tests/
│       └── skill.test.ts
├── geo-schema-builder/
│   ├── SKILL.md
│   ├── index.ts
│   └── schema.json
└── ...
```

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

> **원칙**: CLI는 **서비스 시작/중지 및 스킬 관리**만 담당한다. Target 설정, 에이전트 실행, 결과 조회 등 모든 사용자 인터랙션은 **localhost 웹 대시보드**에서 수행한다.

```bash
# === 서비스 시작/중지 ===
geo start                               # 전체 서비스 시작 (API 서버 + 대시보드)
geo start --port 3000                   # 포트 지정
geo stop                                # 서비스 중지
geo status                              # 서비스 상태 확인

# === 스킬 관리 (개발자용) ===
geo skill list                          # 설치된 스킬 목록
geo skill create <name>                 # 새 스킬 스캐폴딩 생성
geo skill test <name>                   # 스킬 단위 테스트 실행
geo skill install <name>               # ClawHub에서 스킬 설치
geo skill remove <name>                # 스킬 제거
geo skill search <keyword>             # ClawHub 레지스트리 검색
geo skill import --from-openclaw <name> # openclaw 스킬 가져오기
geo skill export --to-openclaw <name>   # openclaw 형식으로 내보내기
geo skill generate "설명"               # 에이전트 위임 자동 스킬 생성
```

**서비스 시작 후**: 브라우저에서 `http://localhost:3000` 접속하여 Target 추가, 분석 실행, 결과 확인 등 모든 작업을 수행한다.

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

```
GEO Score (0~100) = Σ(가중치 × 세부 지표)

세부 지표:
  - Citation Rate          (25%): LLM 응답에서 인용된 빈도
  - Citation Accuracy      (20%): 인용 내용의 정확도 (vs 원문)
  - Info Recognition       (20%): 핵심 정보(제품, 가격, 스펙 등) 인식률 × 정확도
                                  → 4-C.3 InfoRecognitionScore 참조
  - Coverage               (15%): 타겟 LLM 서비스 커버리지
  - Rank Position          (10%): 복수 출처 응답 시 인용 순위
  - Structured Score       (10%): Schema.org, 시맨틱 HTML, 메타데이터 적용 완성도
```

> **Note**: Info Recognition은 단순 인용 여부를 넘어, Target Page의 **구체적 정보가 정확하게** 전달되는지를 측정한다. 예를 들어 제품 가격이 "$1,999"인데 LLM이 "$999"라고 답하면 citation은 있지만 info_recognition은 낮게 산출된다.

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
│  모델: 연결된 모든 Provider의 validation_target 모델       │
│  호출 방식: GeoLLMClient 인터페이스로 통합 호출             │
│  호출 주체: Analysis Agent (URL/Clone 모드 모두)           │
│  인증: 각 Provider별 설정된 인증 방식 자동 적용            │
│  주의: 에이전트 동작과 완전 분리 — 순수 질의+응답 수집용    │
└────────────────────────────────────────────────────────────┘
```

### 9-B.6 GeoLLMClient (검증 질의 통합 인터페이스)

```typescript
interface GeoLLMClient {
  // 단일 LLM에 질의
  query(
    provider: string,
    query: string,
    options?: { model?: string; temperature?: number }
  ): Promise<LLMProbe>;

  // 전체 활성 LLM에 동일 질의 (병렬 실행)
  queryAll(
    query: string,
    options?: { concurrency?: number }
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

최적화 루프 완료 후, 사용자에게 두 가지 결과물을 제공한다:

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
-- 핵심 테이블 (v1 SQLite)

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

-- llm_probes, effectiveness_index 테이블은 Agent Memory 구현 시 추가 예정 (미구현)

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

모든 사이트 유형의 평가 결과는 동일한 대시보드 포맷으로 출력한다.
초기 평가, 중간 사이클 결과, 최종 결과 모두 같은 HTML 구조를 사용한다.

#### 기본 구조: 단일 HTML 파일

- Chart.js CDN 사용
- 다크 테마 (배경 `#0A0E1A`, 카드 `#111827`)
- 브랜드 색상 config 주입: `brand_color` (기본값 `#1428A0`)
- 외부 의존성 최소화 (인라인 CSS/JS)

#### 파일명 규칙

```
초기 평가:      {site_name}_GEO_{run_id}.html
중간 결과:      {site_name}_GEO_{run_id}_cycle{N}.html
최종 결과:      {site_name}_GEO_{run_id}_final.html
다중 사이트:    GEO_Comparison_{site1}_{site2}_{date}.html
```

#### 탭 구성 (10탭)

| # | 탭 이름 | 내용 |
|---|---|---|
| 1 | 종합 개요 | 종합 점수 게이지, 7개 차원 진행바, LLM 서비스별 접근 가능성 추정 막대그래프, 강점/약점/기회 카드, 사이트 유형 배지 |
| 2 | 크롤링 접근성 | robots.txt 원문 발췌, 봇별 허용/차단 테이블, llms.txt 상태 |
| 3 | 구조화 데이터 | 스키마 도넛차트, 페이지 유형별 품질 진행바, 스키마 타입 상세 테이블 |
| 4 | 콘텐츠 인식 | 유형별 메인 콘텐츠 레이더차트 (제품/논문/일반), LLM 인식 가능 데이터 목록 |
| 5 | 브랜드/조직 | 마케팅 클레임 × 검증가능성 테이블 (manufacturer) / 권위 지표 (research) / 조직 정보 (generic) |
| 6 | 페이지별 분석 | URL별 점수 + 태그(good/bad) |
| 7 | 실증 데이터 | Phase 1~3 수집 원문 코드 스니펫 |
| 8 | Synthetic Probe 결과 | 8개 프롬프트 PASS/PARTIAL/FAIL 결과 및 실제 응답 기록 |
| 9 | 개선 로드맵 | 임팩트×난이도 버블차트, Sprint별 로드맵, 점수 시뮬레이션 라인차트 |
| 10 | 사이클 이력 | 사이클별 점수 추이 라인차트, 차원별 변화 히트맵, 중간 결과 비교 (Cycle ≥1 시에만 표시) |

#### 대시보드 JSON 데이터 구조

```json
{
  "run_id": "...",
  "site_name": "...",
  "site_type": "manufacturer|research|generic",
  "base_url": "...",
  "evaluated_at": "ISO 8601",
  "cycle_number": 0,
  "evaluation_target": "original|clone",
  "overall_score": 0,
  "grade": "Excellent|Good|Needs Improvement|Poor|Critical",
  "dimension_scores": { "S1": 0, "S2": 0, "S3": 0, "S4": 0, "S5": 0, "S6": 0, "S7": 0 },
  "dimension_labels": { "S1": "LLM 크롤링 접근성", "S2": "..." },
  "probe_results": { "P-01": {"verdict": "...", "found": 0, "total": 0} },
  "schema_coverage": { ... },
  "key_findings": ["..."],
  "top_improvements": [{"id": "...", "title": "...", "sprint": 1, "impact": 5, "difficulty": 1}],
  "cycle_history": [
    {"cycle": 0, "score": 57, "timestamp": "..."},
    {"cycle": 1, "score": 65, "timestamp": "..."}
  ]
}
```

#### 다중 사이트 비교 모드

여러 사이트를 동시에 비교하는 경우 추가 차트:
- 레이더차트: 모든 사이트의 7개 차원 중첩
- 스키마 구현율 비교 바차트
- Probe PASS율 비교 바차트
- Sprint별 개선 시 예상 점수 비교

---

## 10. 디렉터리 구조

```
geo-agent/
├── packages/
│   ├── core/                          # GEO 핵심 로직
│   │   ├── src/
│   │   │   ├── agents/                # ★ 에이전트 (서브디렉토리 구조)
│   │   │   │   ├── index.ts              # barrel export
│   │   │   │   ├── analysis/             # Analysis Agent
│   │   │   │   │   ├── analysis-agent.ts    # runAnalysis() — 크롤링+채점+분류
│   │   │   │   │   ├── geo-eval-extractor.ts # 봇 정책/스키마/클레임/JS/제품 추출
│   │   │   │   │   ├── llm-analysis-agent.ts # pi-ai Agent Loop 기반 분석 (전환 준비)
│   │   │   │   │   ├── rich-analysis-schema.ts # 10탭 RichAnalysisReport 스키마
│   │   │   │   │   ├── tools.ts             # pi-ai Tool 9종 정의 (전환 준비)
│   │   │   │   │   └── index.ts
│   │   │   │   ├── strategy/             # Strategy Agent
│   │   │   │   │   ├── strategy-agent.ts    # runStrategy() — 규칙+LLM 태스크 생성
│   │   │   │   │   └── index.ts
│   │   │   │   ├── optimization/         # Optimization Agent
│   │   │   │   │   ├── optimization-agent.ts # runOptimization() — 클론 수정
│   │   │   │   │   └── index.ts
│   │   │   │   ├── validation/           # Validation Agent
│   │   │   │   │   ├── validation-agent.ts  # runValidation() — Before-After 비교
│   │   │   │   │   └── index.ts
│   │   │   │   ├── pipeline/             # Pipeline Runner (E2E 오케스트레이션)
│   │   │   │   │   ├── pipeline-runner.ts   # runPipeline() — 전체 파이프라인
│   │   │   │   │   └── index.ts
│   │   │   │   ├── probes/               # Synthetic Probes (P-01~P-08)
│   │   │   │   │   ├── synthetic-probes.ts  # runProbes() — 8종 LLM 프로브
│   │   │   │   │   └── index.ts
│   │   │   │   └── shared/               # 공유 유틸리티
│   │   │   │       ├── llm-helpers.ts       # safeLLMCall, buildPageContext 등
│   │   │   │       ├── llm-response-schemas.ts # ContentQualityAssessment 등 Zod
│   │   │   │       ├── types.ts             # CrawlData, MultiPageCrawlResult 등
│   │   │   │       └── index.ts
│   │   │   ├── models/                    # Zod 스키마 정의
│   │   │   │   ├── target-profile.ts      # ★ TargetProfile 스키마
│   │   │   │   ├── analysis-report.ts
│   │   │   │   ├── optimization-plan.ts
│   │   │   │   ├── validation-report.ts
│   │   │   │   ├── content-snapshot.ts    # ★ ContentSnapshot
│   │   │   │   ├── change-record.ts       # ★ ChangeRecord
│   │   │   │   ├── change-impact.ts       # ★ ChangeImpact
│   │   │   │   ├── geo-time-series.ts     # ★ GeoTimeSeries
│   │   │   │   ├── geo-score.ts           # ★ GeoScore, GEO_SCORE_WEIGHTS
│   │   │   │   ├── llm-probe.ts           # ★ LLMProbe
│   │   │   │   ├── info-recognition.ts    # ★ InfoRecognitionScore, Item, PerLLM
│   │   │   │   ├── change-type.ts         # ★ ChangeType enum (10종)
│   │   │   │   └── index.ts              # barrel export
│   │   │   ├── prompts/                   # ★ 에이전트 시스템 프롬프트
│   │   │   │   ├── defaults.ts               # 6개 에이전트 기본 프롬프트 (단일 파일)
│   │   │   │   ├── prompt-loader.ts          # 프롬프트 로드 (workspace → default fallback)
│   │   │   │   ├── template-engine.ts        # 템플릿 렌더링 + classifySite()
│   │   │   │   └── evaluation-templates/     # ★ 평가 프롬프트 템플릿 (9-E)
│   │   │   │       ├── index.ts                 # 템플릿 레지스트리, 스키마, Cycle 제어
│   │   │   │       ├── manufacturer.md          # 제조사 대표 Site 평가 템플릿
│   │   │   │       ├── research.md              # 연구소 대표 Site 평가 템플릿
│   │   │   │       ├── generic.md               # 기타 Site 평가 템플릿
│   │   │   │       └── viz-specs/               # VisualizationSpec 3-계층 시각화
│   │   │   ├── llm/                        # ★ LLM 추상화 레이어 (9-B)
│   │   │   │   ├── provider-config.ts        # ProviderConfigManager + 스키마
│   │   │   │   ├── geo-llm-client.ts         # GeoLLMClient (chat + CostTracker 내장)
│   │   │   │   ├── oauth-manager.ts          # OAuth 토큰 관리 (발급/갱신/폐기)
│   │   │   │   └── pi-ai-bridge.ts           # pi-ai 어댑터 (Agent Loop + 단일 호출)
│   │   │   ├── skills/                    # ★ 스킬 로더
│   │   │   │   ├── skill-loader.ts           # SKILL.md 파싱 + 로드
│   │   │   │   └── geo-analysis.skill.md     # GEO 분석 스킬 정의
│   │   │   ├── pipeline/                  # ★ 파이프라인 실행 엔진 (9-A)
│   │   │   │   ├── state-machine.ts          # 파이프라인 상태 머신
│   │   │   │   └── orchestrator.ts           # Orchestrator (StageHandler 순차 실행)
│   │   │   ├── clone/                     # ★ 클론 관리 (9-C.1)
│   │   │   │   └── clone-manager.ts          # CloneManager (생성/읽기/쓰기/diff/archive)
│   │   │   ├── report/                    # ★ 결과 리포트 & Archive 생성 (9-C.3)
│   │   │   │   ├── report-generator.ts       # ReportBuilder + renderSimpleDiff
│   │   │   │   ├── archive-builder.ts        # Archive 패키징
│   │   │   │   └── dashboard-html-generator.ts # Interactive HTML Dashboard 생성
│   │   │   ├── db/                        # ★ 데이터베이스
│   │   │   │   ├── schema.ts                # drizzle 테이블 정의 (8개)
│   │   │   │   ├── connection.ts            # SQLite 연결 + ensureTables()
│   │   │   │   └── repositories/
│   │   │   │       ├── target-repository.ts
│   │   │   │       ├── pipeline-repository.ts
│   │   │   │       └── stage-execution-repository.ts
│   │   │   ├── config/
│   │   │   │   └── settings.ts            # AppSettings (Zod validated)
│   │   │   ├── logger.ts                  # pino 구조화 로깅
│   │   │   └── index.ts                   # 패키지 entry point
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── skills/                            # ★ 스킬 패키지
│   │   ├── src/
│   │   │   ├── index.ts                   # SkillRegistry (등록/조회/실행)
│   │   │   ├── dual-crawl.ts              # crawlTarget() + crawlMultiplePages()
│   │   │   └── geo-scorer.ts              # scoreTarget() — 7차원 GEO 채점
│   │   └── package.json
│   │
│   ├── cli/                               # ★ CLI 패키지
│   │   ├── src/
│   │   │   └── index.ts                   # geo start/stop/status/init/analyze/run
│   │   └── package.json
│   │
│   └── dashboard/                         # ★ localhost 웹 대시보드
│       ├── src/
│       │   ├── server.ts                  # Hono API 서버 + SSE broadcastSSE()
│       │   ├── routes/
│       │   │   ├── targets.ts             # /api/targets/** CRUD
│       │   │   ├── settings.ts            # /api/settings/** 프롬프트 + LLM Provider
│       │   │   └── pipeline.ts            # /api/targets/:id/pipeline/** + cycle + evaluation
│       │   └── ui/
│       │       └── dashboard.html         # 단일 HTML SPA (5탭, 다크 테마, Chart.js)
│       └── package.json
│
├── workspace/                             # ★ 사용자 작업 공간 (런타임 생성)
│   ├── prompts/                           # 사용자 커스텀 프롬프트 (4-A)
│   │   └── {agent}.json                   # 수정 시 생성, 없으면 default fallback
│   ├── clones/                            # 로컬 클론 저장소 (9-C.1)
│   │   └── {target_id}/
│   │       ├── metadata.json              #   클론 메타데이터
│   │       ├── original/                  #   원본 (불변)
│   │       │   └── index.html
│   │       └── working/                   #   작업 사본 (수정 대상)
│   │           └── index.html
│   ├── config/                            # LLM Provider 설정 등
│   ├── reports/                           # 결과 리포트 & Archive (9-C.3)
│   │   └── {target_id}/
│   │       ├── report-{date}.html         #   Before-After 비교 리포트
│   │       └── archive-{date}.zip         #   수정된 결과 Archive
│   ├── skills/                            # Workspace Skills (사용자/자동 생성)
│   │   └── (사용자가 생성한 커스텀 스킬)
│   ├── data/                              # 로컬 데이터 저장
│   │   ├── snapshots/
│   │   ├── reports/
│   │   └── db/                            # SQLite DB 파일
│   └── config.json                        # 시스템 설정 (API 키, 기본값 등)
│
├── docker-compose.yml
├── package.json                           # 모노레포 루트
├── tsconfig.json
├── biome.json                             # biome 설정 (pi-mono 표준)
└── ARCHITECTURE.md
```

---

## 11. Known Issues (v1 한계)

> 아래 항목들은 현재 아키텍처의 알려진 구조적 한계이며, 차기 버전에서 해결한다.

### KI-1. 인용 감정(Citation Sentiment) 분석 부재 — 심각도: 높음

**문제**: GEO Score가 인용의 "존재 여부"만 측정하며, 인용이 긍정·부정·중립 어떤 맥락에서 이루어졌는지 판정하지 않는다. Target Page가 빈번히 인용되더라도 부정적 프레이밍으로 인용되는 경우를 "성공"으로 오판한다.

**영향 범위**: GEO Score 전체 신뢰도, "긍정적 인식" 목표 달성 불가

**차기 해결 방향**:
- GEO Score에 `Citation Sentiment (가중치 TBD)` 지표 추가
- Analysis Agent가 LLM Probe에서 인용 발견 시 해당 문맥의 감정 분석 수행
- 긍정 인용률 / 부정 인용률 / 중립 인용률 분리 추적
- Change Impact에 sentiment delta 포함

---

### KI-2. 외부 평판 환경 분석 부재 — 심각도: 높음

**문제**: LLM의 Target Page에 대한 인식은 페이지 자체보다 웹 전체에서의 평판에 더 크게 좌우된다. 현 아키텍처는 Target Page 내부만 분석·개선하며, 외부에서 Target에 대해 어떻게 언급하고 있는지를 파악하지 못한다.

**영향 범위**: Strategy Agent의 전략 수립이 내부 요인에만 의존하여 효과 제한적

**차기 해결 방향**:
- **Reputation Scout Agent** 신규 도입
  - 경쟁 페이지 콘텐츠에서 Target 관련 서술 수집
  - 포럼, 뉴스, 리뷰 사이트에서 Target 평판 분석
  - Wikipedia 등 권위 출처에서의 표현 방식 추적
- 외부 평판 점수를 Strategy Agent 컨텍스트에 주입
- 외부 평판 개선이 필요한 경우 별도 권고 리포트 생성

---

### KI-3. LLM 지식 획득 경로 미구분 — 심각도: 중간

**문제**: Pre-training 학습 데이터, 실시간 검색(RAG), 에이전트 직접 탐색 등 LLM이 웹 콘텐츠를 "아는" 경로가 근본적으로 다르지만, 현 아키텍처는 이를 구분하지 않고 동일한 최적화를 적용한다.

**구체적 문제 상황**:

| LLM 경로 | 현 아키텍처의 최적화 효과 |
|---|---|
| Pre-training (ChatGPT/Claude 기본) | JSON-LD, 시맨틱 구조 등 페이지 수정 → **즉시 반영 안 됨** |
| Search-RAG (Perplexity, Copilot) | 효과 있으나 **전통 SEO 순위가 전제 조건** (미다룸) |
| Agent 직접 탐색 | 구조화 데이터 최적화 → **효과 있음** |

**차기 해결 방향**:
- LLM Knowledge Pathway Model 도입 (Pre-training / Search-RAG / Agent 3분류)
- Strategy Agent가 경로별 최적화 가능 범위를 인지하고 차별화된 전략 수립
- Search-RAG 경로의 경우 전통 SEO 요소와의 연계 전략 포함

---

### KI-4. 테스트 질의(Query Universe) 설계 체계 부재 — 심각도: 중간

**문제**: Analysis Agent가 LLM Probe 수행 시 "타겟 주제 관련 질의를 발송"하지만, 어떤 질의를 어떻게 설계·선정하는지 체계가 없다. 질의 세트가 편향되면 GEO Score 전체가 왜곡된다.

**구체적 위험**:
- 동일 최적화도 질의 유형에 따라 효과가 반대일 수 있음
- "A사 추천해줘"에서는 성공, "A사 vs B사"에서는 실패 → 평균으로 묻힘
- 사용자들이 실제로 LLM에 하는 질의와 테스트 질의가 괴리될 수 있음

**차기 해결 방향**:
- **Query Universe Engine** 도입
  - 타겟 주제에 대한 예상 질의를 자동 생성·분류 (정보형 / 비교형 / 추천형 / 검증형)
  - 질의 유형별 GEO Score 분리 측정
  - "어떤 유형의 질의에서 약한가" 진단 리포트
- 질의 중요도 가중치 (검색 볼륨 유사 개념) 적용

---

### KI-5. 간접 인용 감지(Indirect Citation Detection) 부재 — 심각도: 중간

**문제**: 대부분의 LLM API는 출처 인용(source citation)을 제공하지 않는다.

| LLM 서비스 | 인용 출처 제공 | 현 아키텍처의 측정 가능성 |
|---|---|---|
| Perplexity | O (URL 포함) | 직접 측정 가능 |
| Copilot | O (출처 표시) | 직접 측정 가능 |
| ChatGPT Browsing | 부분적 | 제한적 |
| ChatGPT API 기본 | **X** | **측정 불가** |
| Claude API | **X** | **측정 불가** |
| Gemini API | **X** | **측정 불가** |

Citation Rate가 GEO Score의 30%인데, 타겟 LLM 절반 이상에서 직접 측정이 불가능하다.

**차기 해결 방향**:
- 출처 미표기 LLM 응답에서 Target 콘텐츠와의 **시맨틱 유사도** 기반 간접 인용 추정
- 핵심 팩트·수치·고유 표현의 일치 여부로 간접 인용 확률 산출
- 직접 인용 / 간접 인용(추정) / 미인용 3단계 분류
- GEO Score 산출 시 간접 인용은 confidence 가중치 적용

---

### KI-6. ~~배포 경계(Deployment Boundary) 미정의~~ — **해결됨**

> **해결**: 읽기 전용 원칙 도입 (섹션 1.3)으로 근본적 해결.
> 시스템은 Target Web Page에 대한 직접 수정 권한이 없다는 전제 하에,
> 모든 최적화를 로컬 클론에서 수행하고 결과를 Before-After 리포트 + Archive로 전달한다.
> 사용자가 리포트를 검토 후 원본 사이트에 수동 반영한다. (섹션 9-C 참조)

---

### KI-7. LLM 신뢰 형성 모델(Trust Model) 부재 — 심각도: 낮음

**문제**: LLM이 출처를 "신뢰"하게 되는 메커니즘이 다층적인데, 현 아키텍처는 페이지 내 E-E-A-T 시그널 추가만을 다룬다.

```
LLM 신뢰 형성 요인:
  1. 학습 데이터 내 출처 빈도           ← 제어 불가 (과거 데이터)
  2. 타 출처와의 정보 일관성            ← KI-2에 의존
  3. 도메인 권위 (학습 시점 기준)       ← 제어 불가 (장기 과제)
  4. 검색 엔진 순위 (실시간 검색형)     ← KI-3에 의존
  5. 페이지 내 자기 신뢰 시그널         ← ★ 현재 유일하게 다루는 부분
```

**차기 해결 방향**:
- 요인 1~4에 대한 진단 능력을 Reputation Scout Agent(KI-2)에 통합
- "현재 제어 가능한 것 vs 불가능한 것"을 Strategy Agent에 명시적으로 제공
- 장기적으로 제어 불가 요인의 간접 개선 전략 (외부 인용 확보, 도메인 권위 구축 가이드)

---

### KI-8. Remote Web 대시보드 미지원 — 심각도: 낮음 (v1 의도적 제한)

**문제**: v1에서 대시보드는 localhost에서만 접근 가능하다. 팀 공유, 원격 모니터링, 모바일 접근이 불가하다.

**v1 의도적 제한 사유**: 인증/인가 시스템 없이 외부 노출 시 보안 위험

**차기 해결 방향**:
- 인증/인가 시스템 도입 (OAuth2 또는 API Key 기반)
- HTTPS 지원 (Let's Encrypt 또는 리버스 프록시)
- 멀티 사용자 세션 관리
- 읽기 전용 공유 링크 (GEO 리포트 외부 공유용)

---

### KI-9. 에이전트 자동 생성 스킬의 안전성 검증 — 심각도: 중간

**문제**: Strategy/Optimization Agent가 자동으로 스킬을 생성할 수 있는데, 생성된 코드의 안전성·정확성을 보장하는 체계가 미비하다.

**구체적 위험**:
- 자동 생성 코드에 보안 취약점 (인젝션, 무한 루프 등) 포함 가능
- 외부 API 호출 스킬의 rate limiting/비용 통제 미비
- 자동 생성 스킬 간 의존성 충돌 가능

**현재 대응** (v1 최소 안전장치):
- Workspace Skills 계층에만 생성 허용
- `auto_generated: true` 플래그 + sandbox 모드 실행
- 시스템 명령 실행 권한 차단

**차기 해결 방향**:
- 생성된 스킬의 정적 분석 (AST 검사, 위험 패턴 감지)
- 스킬 실행 리소스 제한 (시간, 메모리, 네트워크 요청 수)
- 관리자 승인 워크플로우 (auto → pending_review → approved)
- 스킬 실행 감사 로그 (어떤 스킬이 어떤 외부 API를 호출했는지)

---

### KI-10. pi-mono 업스트림 의존 관리 — 심각도: 낮음

**결정**: pi-mono는 업스트림을 추종하지 않고, **현재 최종 stable 버전으로 고정(pin)** 한다. 향후 업스트림 업데이트가 있더라도 자동 반영하지 않으며, 필요 시 수동으로 검토 후 선택적으로 반영한다.

**v1 대응** (즉시 적용):
- `package.json`에서 pi-mono 패키지를 정확한 버전으로 고정 (캐럿/틸드 없이 exact version)
- `package-lock.json` 커밋하여 의존성 트리 전체 고정
- pi-mono 소스를 vendor 디렉터리에 스냅샷 보관 (업스트림 소실 대비)

**잔여 위험 및 차기 해결 방향**:
- 고정 버전에서 보안 취약점 발견 시 패치 적용 절차 필요
- pi-agent-core 인터페이스에 대한 얇은 추상화 레이어 유지 → 장기적 교체 가능성 확보
- 핵심 인터페이스(Agent, Tool, LLM Provider)에 대해 자체 타입 정의 보유

---

### Known Issues 우선순위 로드맵

```
v2 (단기):  KI-1 인용 감정 분석   ←  측정 체계 보완의 핵심
            KI-4 Query Universe   ←  측정 신뢰도의 전제 조건
            KI-5 간접 인용 감지   ←  LLM 커버리지 확보
            KI-9 스킬 안전성 검증 ←  자동 스킬 생성 안정화

v3 (중기):  KI-2 외부 평판 분석   ←  Reputation Scout Agent 신규 개발
            KI-3 LLM 경로 구분   ←  Strategy Agent 대폭 개선
            KI-8 Remote Web      ←  팀 공유/원격 접근 지원

v4 (장기):  KI-6 ~~배포 경계~~ (해결됨 — 읽기 전용 원칙 + 클론 워크플로우)
            KI-7 Trust Model     ←  KI-2, KI-3 완료 후 통합
            KI-10 pi-mono 의존   ←  장기 유지보수 전략
```

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

*최종 수정: 2026-03-18*
