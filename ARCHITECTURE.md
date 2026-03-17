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
│          │               │  2. Strategy Agent (전략 수립)       │   │
│          │               │  3. Optimization Agent (최적화 실행) │   │
│          │               │  4. Validation Agent (검증)          │   │
│          │               │  5. Monitoring Agent (모니터링)      │   │
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
│  └───────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
          │                          │
          ▼                          ▼
  ┌───────────────┐          ┌───────────────────┐
  │  Target Web   │          │   LLM Services    │
  │  Page(s)      │          │  (테스트 대상)    │
  └───────────────┘          └───────────────────┘
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

  // === 배포 설정 ===
  deployment_mode : 'direct' | 'cms_api' | 'suggestion_only'
  deployment_config?: {                      // direct/cms_api일 때 연결 정보
    type          : 'git' | 'ftp' | 'wordpress_api' | 'custom_api'
    endpoint      : string
    credentials_ref: string                  // 시크릿 매니저 참조키
  }

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
│  │  배포 설정           알림 설정                      │  │
│  │  ├ 모드: [direct▼]  ├ ☑ 점수 하락                  │  │
│  │  └ 연결: Git push   ├ ☑ 외부 변경 감지             │  │
│  │                     ├ ☑ 최적화 완료                 │  │
│  │                     └ 채널: [dashboard, slack]      │  │
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
    │     deployment_mode → 패치 출력 형식 결정
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
POST   /targets/{id}/optimize      # 최적화 실행 트리거
POST   /targets/{id}/validate      # 검증 실행 트리거
PUT    /targets/{id}/status        # 상태 변경 (active/paused/archived)
```

---

## 4. 에이전트 구성 및 역할

### 4.1 Orchestrator

- 전체 파이프라인의 실행 순서와 상태를 관리
- 각 에이전트에 태스크를 분배하고 결과를 수집
- **TargetProfile을 로드하여 각 에이전트 컨텍스트에 주입**
- 반복(iteration) 루프를 통한 지속적 최적화 주도
- 긴급 롤백 및 에러 핸들링 담당

### 4.2 Analysis Agent (분석 에이전트)

**목적**: Target Web Page의 현재 상태를 다각도로 분석

**수행 작업**:
- 페이지 크롤링 및 콘텐츠 추출 (HTML, 구조화 데이터, 메타데이터)
- 기존 Schema.org / JSON-LD 마크업 감사
- 콘텐츠 밀도, 명확성, 인용 가능성 점수 산출
- 경쟁 페이지 대비 GEO 격차 분석
- LLM별 인덱싱 현황 파악 (`robots.txt` AI 크롤러 허용 상태, `llms.txt` 존재 여부 확인)
- **기계 가독성 감사 (Machine Readability Audit)** — 아래 4.2-A 참조
- **핵심 정보 자동 추출**: 제품 목록, 가격, 스펙, 정책 등 LLM이 인식해야 할 정보 항목을 JSON-LD + 본문에서 자동 추출 → `InfoRecognitionItem[]` 목록 생성 (사용자가 대시보드에서 검토/보완)

**출력**: `AnalysisReport` (JSON 구조화 보고서) — 4-C.5 참조

#### 4.2-A. 기계 가독성 감사 (Machine Readability Audit)

Target Page가 과도한 `<div>` 중첩이나 JavaScript 의존으로 인해 LLM 크롤러가 콘텐츠를 제대로 수집하지 못하는 경우, 이후의 모든 GEO 최적화는 무의미하다. 따라서 Analysis Agent는 **최적화에 앞서** 기계 가독성을 진단한다.

**(1) 이중 크롤링 비교 (Dual Crawl Diff)**

동일 URL을 두 가지 방식으로 크롤링하여 콘텐츠 차이를 측정한다.

```
크롤링 A: Playwright (JS 실행, 풀 렌더링)
  → 사람이 브라우저에서 보는 것과 동일한 콘텐츠

크롤링 B: undici/node-fetch (raw HTTP, JS 미실행)
  → LLM 크롤러(GPTBot, ClaudeBot 등)가 보는 것에 근사

비교 지표:
  js_dependency_ratio = 1 - (len(text_B) / len(text_A))
  → 0에 가까울수록 양호 (JS 없이도 콘텐츠 접근 가능)
  → 0.5 이상이면 위험 (콘텐츠 절반 이상이 JS 의존)
  → 0.9 이상이면 치명적 (SPA — 거의 빈 페이지)
```

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

주요 AI 크롤러의 User-Agent로 실제 요청하여 응답을 확인한다.

```
테스트 대상 User-Agent:
  - GPTBot          (OpenAI)
  - ClaudeBot       (Anthropic)
  - Google-Extended  (Google AI)
  - Bytespider      (ByteDance)
  - PerplexityBot   (Perplexity)
  - cohere-ai       (Cohere)

확인 항목:
  - HTTP 응답 코드 (200 vs 403/429 — 차단 여부)
  - 응답 본문에 실제 콘텐츠 포함 여부
  - robots.txt에서 해당 봇 차단 여부
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

**목적**: 전략에 따라 실제 콘텐츠 최적화 작업 수행

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

**출력**: 수정된 HTML/콘텐츠 패치, 구조화 데이터 파일

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

**목적**: 실제 LLM 서비스에 질의하여 최적화 효과를 측정

**수행 작업**:
- 다수의 LLM 서비스에 타겟 주제 관련 질의 자동 발송
- 응답에서 Target Page 인용 여부 및 빈도 측정
- 인용 정확도 (할루시네이션 여부) 평가
- **정보 인식 검증 (Information Recognition)**: Target Page의 핵심 정보(제품 목록, 가격, 스펙 등)를 LLM이 정확히 인식하는지 항목별 검증 — 4-C.3 InfoRecognitionScore 참조
- 최적화 전/후 GEO 점수 비교
- 멀티 LLM 커버리지 리포트 생성

**테스트 대상 LLM 서비스**:
```
- OpenAI ChatGPT (GPT-4o, o-series)
- Anthropic Claude (claude-opus-4-6, claude-sonnet-4-6)
- Google Gemini (Gemini 2.0 Flash, Pro)
- Perplexity AI (sonar-pro)
- Microsoft Copilot (Bing AI)
- Meta AI (Llama 기반)
```

**출력**: `ValidationReport` (LLM별 인용률, 정확도, GEO 점수)

### 4.6 Monitoring Agent (모니터링 에이전트)

**목적**: 지속적으로 GEO 성과를 추적하고 이상 감지

**수행 작업**:
- 주기적 LLM 질의를 통한 인용률 트래킹
- LLM 서비스 업데이트 감지 및 영향 분석
- 경쟁 페이지의 GEO 변화 모니터링
- 알람 및 자동 재최적화 트리거

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

각 Change Record에 대해 Validation Agent가 측정 후 다음을 산출한다.

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
  citation_rate      : number          // LLM 응답에서 인용된 빈도 (가중치 30%)
  citation_accuracy  : number          // 인용 내용의 정확도 vs 원문 (25%)
  coverage           : number          // 타겟 LLM 서비스 커버리지 (20%)
  rank_position      : number          // 복수 출처 응답 시 인용 순위 (15%)
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
[Analysis Agent]
     │
     ├─ Target Page 크롤링
     ├─ 구조화 데이터(JSON-LD) + 본문에서 핵심 정보 자동 추출
     │   → InfoRecognitionItem[] 초기 목록 생성
     │   → 사용자가 대시보드에서 검토/추가/수정 가능
     │
     ▼
[Validation Agent]
     │
     ├─ 각 InfoRecognitionItem에 대해 LLM별 검증 질의 생성
     │   예: "RTX 5090의 가격은 얼마인가?" / "X사의 프리미엄 요금제에는 어떤 기능이 포함되는가?"
     │
     ├─ LLM 응답에서 해당 정보 추출 및 expected_value와 비교
     │   → accuracy 판정 (exact / approximate / outdated / hallucinated / missing)
     │
     ├─ InfoRecognitionScore 산출
     │   → coverage_rate = recognized 항목수 / 전체 항목수
     │   → accuracy_rate = (exact + approximate) / recognized 항목수
     │   → overall = coverage_rate × 0.5 + accuracy_rate × 0.5 (× 100)
     │
     └─ 결과를 ValidationReport.info_recognition에 포함
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

  // GEO 점수 비교
  score_before           : GeoScore
  score_after            : GeoScore
  score_delta            : number          // total 기준

  // LLM별 상세 결과
  llm_results            : ValidationLLMResult[]

  // 정보 인식 검증 결과
  info_recognition       : InfoRecognitionScore

  // 종합 판정
  verdict                : 'improved' | 'unchanged' | 'degraded'
  summary                : string          // LLM이 생성한 종합 평가 (자연어)

  // 권장 후속 조치
  recommendations        : string[]
}

ValidationLLMResult {
  llm_service            : string
  probes                 : LLMProbe[]      // 해당 LLM에 보낸 모든 질의 결과
  citation_rate          : number          // 인용률 (0~1)
  citation_accuracy      : number          // 인용 정확도 (0~1)
  rank_position_avg      : number | null   // 평균 인용 순위
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
| **@mariozechner/pi-agent-core** | 에이전트 런타임 (Tool calling + 상태 관리) | Orchestrator, Analysis/Strategy/Optimization/Validation/Monitoring Agent 실행 |
| **@mariozechner/pi-web-ui** | AI 채팅 인터페이스 웹 컴포넌트 | localhost 대시보드 UI (섹션 6.5 참조) |
| **@mariozechner/pi-tui** | 터미널 UI 라이브러리 | CLI 인터페이스 (스킬 관리, 에이전트 실행) |

**pi-agent-core 활용 구조**:

```
┌─────────────────────────────────────────────────────┐
│                  pi-agent-core                       │
│                                                      │
│  Agent Runtime                                       │
│    ├─ Tool Registry  ← GEO 도구들 등록               │
│    ├─ State Manager  ← 에이전트 실행 상태 추적        │
│    └─ Agent Loop     ← LLM ↔ Tool 반복 실행          │
│                                                      │
│  pi-ai (LLM Provider)                               │
│    ├─ Anthropic (Claude) ← 에이전트 오케스트레이션용  │
│    ├─ OpenAI (GPT)       ← Validation 테스트 대상    │
│    ├─ Google (Gemini)    ← Validation 테스트 대상    │
│    └─ ...                                            │
└─────────────────────────────────────────────────────┘
```

**에이전트-Tool 매핑**: pi-agent-core의 Tool calling 프레임워크를 통해, 각 에이전트가 호출할 수 있는 Tool을 명시적으로 등록한다.

```typescript
// 예시: Analysis Agent의 Tool 등록
const analysisAgent = createAgent({
  name: "analysis-agent",
  model: piAi.model("anthropic", "claude-sonnet-4-6"),
  tools: [
    dualCrawlTool,         // 이중 크롤링 (Playwright + fetch)
    structureAuditorTool,  // DOM 구조 품질 감사
    crawlerSimulatorTool,  // AI 크롤러 접근성 테스트
    geoScorerTool,         // GEO 점수 산출
  ],
  systemPrompt: analysisSystemPrompt,
});
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
| **브라우저 자동화** | Playwright (Node.js) | JS 실행 풀 렌더링 크롤링 (사용자 시점) |
| **HTTP 클라이언트** | undici / node-fetch | JS 미실행 크롤링 (LLM 크롤러 시점 시뮬레이션), API 호출 |
| **HTML 파싱** | cheerio + htmlparser2 | DOM 분석, 시맨틱 태그 비율 산출, 메타데이터 추출 |
| **가독성 추출** | @mozilla/readability + linkedom | div soup에서도 본문 핵심 텍스트 추출 |

### 6.4 데이터 저장 및 처리

| 구분 | 선택 | 용도 |
|---|---|---|
| **벡터 데이터베이스** | ChromaDB (로컬) / Pinecone (클라우드) | 콘텐츠 임베딩 저장, 유사도 검색 |
| **문서 저장소** | better-sqlite3 (로컬) / PostgreSQL (운영) | 분석 보고서, 최적화 이력 |
| **Change Tracking DB** | PostgreSQL (시계열 확장) / TimescaleDB | ContentSnapshot, ChangeRecord, GeoTimeSeries, ChangeImpact |
| **캐시** | Redis | LLM 응답 캐싱, 태스크 큐 |
| **파일 저장** | 로컬 파일시스템 / S3 호환 | 크롤링 원본, HTML diff 파일, 패치 파일 |

### 6.5 UI: localhost 웹 대시보드

> **v1 범위**: localhost에서만 제공. Remote web 접근은 차기 버전 대상.

pi-web-ui 웹 컴포넌트를 기반으로 localhost에 대시보드를 제공한다.

```
┌────────────────────────────────────────────────────────────────┐
│  localhost:3000  GEO Agent Dashboard                            │
│                                                                 │
│  [Targets] [Dashboard] [Skills] [Activity] [Settings]           │
│                                                                 │
│  ┌─ /targets ──────────────────────────────────────────────┐   │
│  │  Target 목록 + 추가/편집/삭제                            │   │
│  │  (Target Profile 전체 설정: URL, 주제, 경쟁자,           │   │
│  │   LLM 우선순위, 배포 모드, 알림 등)                      │   │
│  │  → 섹션 3.0.2 Target 설정 화면 참조                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─ /dashboard/{target_id} ────────────────────────────────┐   │
│  │                                                          │   │
│  │  ┌───────────────────────────────────────────────────┐   │   │
│  │  │  pi-web-ui Chat Interface                         │   │   │
│  │  │  ┌─────────────────────────────────────────────┐  │   │   │
│  │  │  │ [에이전트 대화형 인터페이스]                  │  │   │   │
│  │  │  │  "이 페이지를 분석해줘"                      │  │   │   │
│  │  │  │  → Analysis Agent 실행 중...                 │  │   │   │
│  │  │  │  → 기계 가독성 등급: B                       │  │   │   │
│  │  │  │  → GEO 점수: 42/100                         │  │   │   │
│  │  │  └─────────────────────────────────────────────┘  │   │   │
│  │  └───────────────────────────────────────────────────┘   │   │
│  │                                                          │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌────────────────┐    │   │
│  │  │ GEO Score   │ │ Change       │ │ LLM Coverage   │    │   │
│  │  │ Timeline    │ │ Impact Map   │ │ Matrix         │    │   │
│  │  │ (시계열)    │ │ (효과 귀인)  │ │ (LLM별 현황)  │    │   │
│  │  └─────────────┘ └──────────────┘ └────────────────┘    │   │
│  │                                                          │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌────────────────┐    │   │
│  │  │ Competitor  │ │ Agent        │ │ Machine        │    │   │
│  │  │ Comparison  │ │ Activity Log │ │ Readability    │    │   │
│  │  │ (경쟁 비교) │ │ (실행 이력)  │ │ Report         │    │   │
│  │  └─────────────┘ └──────────────┘ └────────────────┘    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─ /skills ───────────────────────────────────────────────┐   │
│  │  Skill Manager (스킬 목록, 설치, 제거, 테스트)           │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

**기술 구성**:

| 구분 | 선택 | 용도 |
|---|---|---|
| **프론트엔드** | pi-web-ui 웹 컴포넌트 + Lit/Preact | 대화형 에이전트 UI, 대시보드 |
| **차트/시각화** | D3.js 또는 Chart.js | GEO 점수 시계열, 변경 효과 차트 |
| **백엔드 API** | Hono (TypeScript) | REST API 서버 (localhost) |
| **실시간 통신** | WebSocket | 에이전트 실행 상태 스트리밍 |
| **알림** | 이메일 / Slack Webhook | 최적화 완료, 이상 감지 알림 |

**localhost 제한 사항 (v1)**:
- 인증/인가 시스템 미포함 (localhost만이므로 불필요)
- HTTPS 미지원 (localhost 환경)
- 동시 사용자 1명 가정

**차기 버전 (remote web) 예정 사항** → Known Issue KI-8 참조

### 6.6 태스크 오케스트레이션

| 구분 | 선택 | 용도 |
|---|---|---|
| **워크플로우** | pi-agent-core Agent Loop + BullMQ | 에이전트 파이프라인 스케줄링 |
| **메시지 큐** | Redis Streams 또는 BullMQ | 에이전트 간 비동기 통신 |
| **상태 관리** | Zod schemas (TypeScript) | 에이전트 입출력 스키마 정의·검증 |

### 6.7 모니터링 및 관찰성

| 구분 | 선택 | 용도 |
|---|---|---|
| **메트릭** | Prometheus + Grafana | GEO 점수 추이, 에이전트 성능 |
| **로깅** | pino (structured JSON logging) | 에이전트 실행 로그 |
| **트레이싱** | Langfuse 또는 Arize AI | LLM 호출 추적 및 비용 관리 |

### 6.8 개발 환경

| 구분 | 선택 |
|---|---|
| **언어** | TypeScript 5.x (Node.js 20+) |
| **패키지 관리** | npm (pi-mono 모노레포 호환) |
| **코드 품질** | biome (lint/format — pi-mono 표준) |
| **테스트** | vitest |
| **컨테이너** | Docker + Docker Compose |

---

## 7. 데이터 흐름

```
[사용자: 대시보드에서 Target Profile 설정 또는 선택]
         │
         ▼
[Orchestrator: TargetProfile 로드 → 파이프라인 초기화]
         │
         ├──▶ [Analysis Agent]
         │         │ 이중 크롤링 (Playwright + undici/fetch raw)
         │         │ 구조 분석, GEO 현황 점수
         │         │ ★ 기계 가독성 감사 (js_dependency_ratio, DOM 품질, 크롤러 접근성)
         │         ▼
         │    AnalysisReport (기계 가독성 등급 포함) + ContentSnapshot(before)
         │         │
         │         ├─ 등급 A/B ──▶ 정상 진행
         │         └─ 등급 C/F ──▶ Strategy Agent에 "구조 개선 우선" 플래그 전달
         │
         ├──▶ [Strategy Agent]
         │         │ AnalysisReport + 과거 ChangeImpact 피드백 수신
         │         │ 기계 가독성 등급 C/F → 구조 개선 태스크 최우선 배치
         │         │ 우선순위 최적화 태스크 생성
         │         ▼
         │    OptimizationPlan
         │
         ├──▶ [Optimization Agent]
         │         │ OptimizationPlan 수신
         │         │ 콘텐츠 패치 생성
         │         │ ★ ChangeRecord 생성 (change_type, diff, snapshot_before)
         │         ▼
         │    수정된 HTML/JSON-LD (+ llms.txt 보조)
         │         │
         │         ▼
         │    [배포 or 스테이징 저장]
         │
         ├──▶ [Validation Agent]
         │         │ 배포된 콘텐츠 대상
         │         │ 6개+ LLM에 질의 발송 (LLM 인덱스 갱신 대기 후)
         │         │ 인용 여부 및 정확도 측정
         │         │ ★ ContentSnapshot(after) + GeoTimeSeries 저장
         │         │ ★ ChangeImpact 산출 (delta, confidence, per_llm)
         │         ▼
         │    ValidationReport + ChangeImpact ──▶ Change Tracking Store
         │
         ├──▶ [Orchestrator: 목표 달성 판단]
         │         │
         │    GEO 목표 미달 ──▶ Strategy Agent로 재순환 (ChangeImpact 반영)
         │         │
         │    GEO 목표 달성 ──▶ Monitoring Agent 등록
         │
         ├──▶ [Monitoring Agent - 상시 동작]
         │         │ 주기적 페이지 해시 체크
         │         │ ★ 외부 변경 감지 → EXTERNAL ChangeRecord 자동 생성
         │         │ 주기적 LLM 질의 → GeoTimeSeries 누적
         │         ▼
         │    지속적 ChangeImpact 업데이트
         │
         └──▶ [Change History 대시보드 표시]
                   변경 타임라인 / 효과 귀인 / LLM별 반응 차트
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

## 10. 디렉터리 구조

```
geo-agent/
├── packages/
│   ├── core/                          # GEO 핵심 로직
│   │   ├── src/
│   │   │   ├── agents/
│   │   │   │   ├── orchestrator.ts        # 파이프라인 조율
│   │   │   │   ├── analysis-agent.ts      # 분석 에이전트
│   │   │   │   ├── strategy-agent.ts      # 전략 수립 (ChangeImpact 피드백 수신)
│   │   │   │   ├── optimization-agent.ts  # 최적화 실행 (ChangeRecord 생성)
│   │   │   │   ├── validation-agent.ts    # 검증 (ChangeImpact 산출)
│   │   │   │   └── monitoring-agent.ts    # 모니터링 (외부 변경 감지)
│   │   │   ├── tracking/                  # ★ Change Tracking 시스템
│   │   │   │   ├── snapshot.ts            # ContentSnapshot 캡처·저장
│   │   │   │   ├── change-record.ts       # ChangeRecord 생성·관리
│   │   │   │   ├── impact-analyzer.ts     # ChangeImpact 귀인 분석
│   │   │   │   ├── time-series.ts         # GeoTimeSeries 저장·조회
│   │   │   │   ├── external-detector.ts   # 외부 변경 감지 (해시 비교)
│   │   │   │   └── agent-memory/          # ★ Agent Memory Layer
│   │   │   │       ├── effectiveness-index.ts   # 구조적 기억
│   │   │   │       ├── semantic-archive.ts      # 의미 기억 (벡터 검색)
│   │   │   │       ├── memory-tools.ts          # 에이전트 Tool 정의 (4종)
│   │   │   │       └── freshness-manager.ts     # 기억 신선도 관리
│   │   │   ├── models/                    # Zod 스키마 정의
│   │   │   │   ├── target-profile.ts      # ★ TargetProfile 스키마
│   │   │   │   ├── analysis-report.ts
│   │   │   │   ├── optimization-plan.ts
│   │   │   │   ├── validation-report.ts
│   │   │   │   ├── content-snapshot.ts    # ★ ContentSnapshot
│   │   │   │   ├── change-record.ts       # ★ ChangeRecord
│   │   │   │   ├── change-impact.ts       # ★ ChangeImpact
│   │   │   │   ├── geo-time-series.ts     # ★ GeoTimeSeries
│   │   │   │   ├── geo-score.ts           # ★ GeoScore, GeoScorePerLLM
│   │   │   │   ├── llm-probe.ts           # ★ LLMProbe
│   │   │   │   ├── info-recognition.ts    # ★ InfoRecognitionScore, Item, PerLLM
│   │   │   │   └── change-type.ts         # ★ ChangeType enum
│   │   │   └── config/
│   │   │       └── settings.ts            # 설정 관리 (Zod validated)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── skills/                            # ★ 스킬 패키지
│   │   ├── bundled/                       # 기본 내장 스킬 (Bundled)
│   │   │   ├── geo-dual-crawl/
│   │   │   │   ├── SKILL.md               # openclaw 호환 메타데이터
│   │   │   │   ├── index.ts               # Tool 정의
│   │   │   │   └── schema.json            # 입출력 스키마
│   │   │   ├── geo-structure-auditor/
│   │   │   ├── geo-crawler-simulator/
│   │   │   ├── geo-schema-builder/
│   │   │   ├── geo-llms-txt-builder/      # (실험적)
│   │   │   ├── geo-llm-tester/
│   │   │   ├── geo-scorer/
│   │   │   └── geo-readability/
│   │   ├── registry.ts                    # Skill Registry (통합 등록소)
│   │   ├── loader.ts                      # 스킬 로더 (SKILL.md 파싱)
│   │   ├── openclaw-compat.ts             # openclaw 호환 레이어
│   │   └── generator.ts                   # 에이전트 자동 스킬 생성
│   │
│   ├── cli/                               # ★ CLI 패키지
│   │   ├── src/
│   │   │   ├── index.ts                   # 진입점 (geo 커맨드)
│   │   │   ├── commands/
│   │   │   │   ├── start.ts               # geo start [--port]
│   │   │   │   ├── stop.ts                # geo stop
│   │   │   │   ├── status.ts              # geo status
│   │   │   │   └── skill.ts               # geo skill <sub-command>
│   │   │   └── util/
│   │   │       └── pi-tui-helpers.ts      # pi-tui 기반 터미널 UI
│   │   └── package.json
│   │
│   └── dashboard/                         # ★ localhost 웹 대시보드
│       ├── src/
│       │   ├── server.ts                  # Hono API 서버 (localhost)
│       │   ├── routes/
│       │   │   ├── targets.ts             # ★ /targets/** Target Profile CRUD + 실행 트리거
│       │   │   ├── tracking.ts            # /tracking/** 엔드포인트
│       │   │   ├── agents.ts              # /agents/** 에이전트 실행 API
│       │   │   └── skills.ts              # /skills/** 스킬 관리 API
│       │   ├── ws/
│       │   │   └── agent-stream.ts        # WebSocket 에이전트 상태 스트리밍
│       │   └── ui/
│       │       ├── index.html             # 대시보드 진입점
│       │       ├── components/            # pi-web-ui 기반 웹 컴포넌트
│       │       │   ├── target-manager.ts   # ★ Target 목록/추가/편집/삭제
│       │       │   ├── target-settings.ts  # ★ Target Profile 상세 설정 폼
│       │       │   ├── chat-interface.ts   # 에이전트 대화형 UI
│       │       │   ├── geo-timeline.ts     # GEO 점수 시계열 차트
│       │       │   ├── change-impact.ts    # 변경 효과 시각화
│       │       │   ├── llm-matrix.ts       # LLM별 커버리지 매트릭스
│       │       │   ├── competitor-compare.ts # 경쟁 페이지 비교 차트
│       │       │   ├── skill-manager.ts    # 스킬 관리 UI
│       │       │   ├── readability-report.ts # 기계 가독성 리포트
│       │       │   └── info-recognition.ts  # ★ 정보 인식 현황 매트릭스
│       │       └── styles/
│       └── package.json
│
├── workspace/                             # ★ 사용자 작업 공간
│   ├── targets/                           # ★ Target Profile 저장 (JSON 파일)
│   │   ├── {target-id}.json               # 각 Target의 TargetProfile
│   │   └── ...
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
- Validation Agent가 인용 발견 시 해당 문맥의 감정 분석 수행
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

**문제**: Validation Agent가 "타겟 주제 관련 질의를 발송"하지만, 어떤 질의를 어떻게 설계·선정하는지 체계가 없다. 질의 세트가 편향되면 GEO Score 전체가 왜곡된다.

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

### KI-6. 배포 경계(Deployment Boundary) 미정의 — 심각도: 낮음

**문제**: Optimization Agent가 "수정된 HTML/콘텐츠 패치"를 출력하지만, 실제 배포 가능 여부는 Target Page의 소유 형태에 따라 다르다.

| Target 유형 | 실행 가능 범위 |
|---|---|
| 자체 소유 사이트 | 직접 배포 (API/FTP/Git) |
| CMS 기반 (WordPress 등) | CMS API 연동 배포 |
| 타사 플랫폼 (마켓플레이스 등) | **직접 수정 불가**, 제안서만 출력 |

**차기 해결 방향**:
- Deployment Mode를 3종으로 정의 (`direct` / `cms_api` / `suggestion_only`)
- Orchestrator 초기 설정 시 Target의 배포 모드를 지정
- `suggestion_only` 모드에서는 사람이 읽을 수 있는 개선 제안서 자동 생성

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

v4 (장기):  KI-6 배포 경계 정의   ←  운영 환경 다양화 대응
            KI-7 Trust Model     ←  KI-2, KI-3 완료 후 통합
            KI-10 pi-mono 의존   ←  장기 유지보수 전략
```

---

## 12. 향후 확장 계획

| Phase | 내용 |
|---|---|
| **Phase 1** | 단일 URL 분석 및 수동 최적화 제안 MVP |
| **Phase 2** | 자동 최적화 실행 및 멀티 LLM 검증 파이프라인 |
| **Phase 3** | 사이트 전체 GEO 자동화 (sitemap 기반 다중 URL) |
| **Phase 4** | 실시간 모니터링 대시보드 및 알림 시스템 |
| **Phase 5** | 경쟁사 GEO 인텔리전스 및 기회 자동 발굴 |

---

*최종 수정: 2026-03-17*
