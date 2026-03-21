# GEO Agent System

**Generative Engine Optimization** — LLM 서비스(ChatGPT, Claude, Gemini, Perplexity 등)가 Target Web Page를 우선적으로, 정확하게 참조하도록 콘텐츠를 분석하고 최적화하는 에이전트 시스템.

## 핵심 개념

- **GEO Score (2-Level 체계)**:
  - **Level 1 — GEO Score**: LLM Probe 기반 최종 성과 (Citation Rate 25%, Citation Accuracy 20%, Info Recognition 20%, Coverage 15%, Rank Position 10%, Readiness Score 10%). API Key 필요
  - **Level 2 — GEO Readiness Score**: 정적 분석 기반 사이트 준비도 7차원 평가 (크롤링 접근성, 구조화 데이터, 기계가독성, 팩트 밀도, 브랜드 메시지, AI 인프라, 콘텐츠 네비게이션). API Key 불필요
- **읽기 전용 원칙**: Target Web Page를 직접 수정하지 않음. 로컬 클론에서 최적화 후 Before-After 리포트 제공
- **Synthetic Probes**: LLM에 실제 질의하여 Target 인용/정확도를 검증하는 8종 프로브

## 요구 사항

- **Node.js** 20 이상
- **npm** 8 이상
- (선택) LLM API Key — OpenAI, Azure OpenAI, Anthropic, Google AI 중 하나
  - `analyze` 명령: LLM 불필요 (Level 2 정적 분석만 수행)
  - `run` 명령: `--no-llm` 플래그로 rule-based 실행 가능. LLM 사용 시 API Key 필수

## 설치

```bash
git clone https://github.com/myungjoo/geo-agent.git
cd geo-agent
npm install
npm run build
```

### Windows PowerShell 권한 문제

Windows에서 `npm` 또는 `npx` 실행 시 다음과 같은 에러가 발생할 수 있습니다:

```
이 시스템에서 스크립트를 실행할 수 없으므로 ... 파일을 로드할 수 없습니다.
```

이는 PowerShell의 실행 정책(Execution Policy) 때문입니다. 다음 중 하나로 해결하세요:

**방법 1: 현재 세션에서만 허용 (권장)**
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

**방법 2: 현재 사용자에게 영구 허용**
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**방법 3: PowerShell 대신 Git Bash 또는 cmd 사용**
```
# Git 설치 시 함께 설치된 Git Bash를 사용하면 이 문제가 없습니다.
```

## 사용 방법

### 1. 빠른 분석 (CLI)

LLM 없이 즉시 실행 가능. Target URL의 GEO 점수를 정적 분석으로 산출합니다.

```bash
node --import tsx packages/cli/src/index.ts analyze https://www.samsung.com
```

출력 예시:
```
📊 Site: Samsung 대한민국 | 모바일 | TV | 가전 | IT
   Type: manufacturer (confidence: 0.50)
   Overall Score: 71/100
   Grade: Needs Improvement

   Dimensions:
   S1 LLM 크롤링 접근성          ███████████░░░░░░░░░ 55/100
   S2 구조화 데이터              █████████████████░░░ 85/100
   S3 콘텐츠 기계가독성            ██████████████░░░░░░ 70/100
   ...
```

### 2. 전체 파이프라인 실행 (CLI)

분석 → 클론 → 전략 수립 → 최적화 → 검증 → 리포트 생성까지 자동 수행합니다.

```bash
# LLM 없이 (정적 분석 + 규칙 기반 최적화)
node --import tsx packages/cli/src/index.ts run https://www.samsung.com --no-llm

# Azure OpenAI 사용
node --import tsx packages/cli/src/index.ts run https://www.samsung.com \
  --provider microsoft \
  --api-key YOUR_API_KEY \
  --api-base https://YOUR_REGION.api.cognitive.microsoft.com \
  --model gpt-35-turbo

# OpenAI 사용
node --import tsx packages/cli/src/index.ts run https://www.samsung.com \
  --provider openai \
  --api-key sk-YOUR_API_KEY

# 옵션
#   -n, --name <name>       Target 이름
#   -s, --score <score>     목표 점수 (기본: 80)
#   -c, --cycles <cycles>   최대 최적화 사이클 수 (기본: 5)
#   -o, --output <dir>      리포트 출력 디렉토리
```

결과로 `내 문서` 폴더에 Interactive HTML Dashboard가 생성됩니다.

### 3. Web Dashboard (권장)

```bash
# 서버 시작 (간단)
npm start

# 또는 포트 지정
npm start -- --port 8080
```

브라우저에서 접속:
```
http://localhost:3000/dashboard
```

Dashboard 사용 흐름:
1. **LLM Providers 탭** → 사용할 프로바이더의 Edit 클릭 → API Key 입력 → Save → 토글 Enable
2. **Targets 탭** → "+ New Target" → URL과 이름 입력 → Save
3. **Pipelines 탭** → 생성된 Target 옆의 "Start" 클릭
4. 파이프라인 진행 상태 확인, 필요 시 "Stop"으로 중단
5. 결과는 `내 문서` 폴더에 HTML Dashboard로 저장됨

Dashboard 탭 설명:
- **Targets**: Target URL 추가/편집/삭제
- **Pipelines**: 파이프라인 시작/중단/상태 확인
- **Evaluation**: GEO 평가 결과 (종합 개요, 크롤링 접근성, 구조화 데이터, 제품 정보, 브랜드 메시지, 페이지별 분석, 개선 권고, 실증 데이터, Synthetic Probes, 실행 요약)
- **Agent Prompts**: 에이전트 시스템 프롬프트 편집 (고급)
- **LLM Providers**: LLM 프로바이더 설정 (API Key, 모델, 활성화/비활성화)

### 4. REST API

Dashboard 서버가 실행 중일 때 API를 직접 호출할 수 있습니다.

```bash
# Target 생성
curl -X POST http://localhost:3000/api/targets \
  -H "Content-Type: application/json" \
  -d '{"name":"Samsung","url":"https://www.samsung.com","site_type":"manufacturer"}'

# 파이프라인 시작
curl -X POST http://localhost:3000/api/targets/{id}/pipeline

# 사이클 상태 확인
curl http://localhost:3000/api/targets/{id}/cycle/status

# 수동 중단
curl -X POST http://localhost:3000/api/targets/{id}/cycle/stop

# LLM 프로바이더 설정
curl -X PUT http://localhost:3000/api/settings/llm-providers/microsoft \
  -H "Content-Type: application/json" \
  -d '{"api_key":"YOUR_KEY","api_base_url":"https://uksouth.api.cognitive.microsoft.com","default_model":"gpt-35-turbo","enabled":true}'
```

전체 API 목록:
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/health` | 서버 상태 |
| GET | `/dashboard` | Web UI |
| GET | `/api/version` | Git 버전 정보 |
| POST | `/api/shutdown` | 서버 종료 |
| GET | `/events` | SSE 실시간 파이프라인 이벤트 스트림 |
| GET/POST | `/api/targets` | Target CRUD |
| GET/PUT/DELETE | `/api/targets/:id` | Target 개별 관리 |
| GET/POST | `/api/targets/:id/pipeline` | 파이프라인 목록/생성 (`?execute=true`로 실행) |
| GET | `/api/targets/:id/pipeline/latest` | 최신 파이프라인 |
| GET | `/api/targets/:id/pipeline/:pid` | 특정 파이프라인 조회 |
| DELETE | `/api/targets/:id/pipeline/:pid` | 파이프라인 삭제 |
| PUT | `/api/targets/:id/pipeline/:pid/stage` | 스테이지 변경 |
| GET | `/api/targets/:id/pipeline/:pid/stages` | 스테이지 실행 기록 |
| GET | `/api/targets/:id/pipeline/:pid/stages/:sid` | 스테이지 상세 (result_full 포함) |
| GET | `/api/targets/:id/pipeline/:pid/evaluation` | Evaluation 데이터 |
| GET | `/api/targets/:id/pipeline/:pid/llm-log` | LLM 호출 로그 |
| POST | `/api/targets/:id/cycle/stop` | 수동 중단 |
| GET | `/api/targets/:id/cycle/status` | 사이클 상태 |
| GET/PUT | `/api/settings/agents/prompts` | 에이전트 프롬프트 |
| GET/PUT | `/api/settings/llm-providers` | LLM 프로바이더 |

## LLM 프로바이더 설정

| 프로바이더 | Provider ID | API Key 형식 | 비고 |
|-----------|-------------|-------------|------|
| OpenAI | `openai` | `sk-...` | |
| Azure OpenAI | `microsoft` | 32자 hex | `--api-base` 필수 |
| Anthropic | `anthropic` | `sk-ant-...` | |
| Google AI | `google` | `AIzaSy...` | |
| Perplexity | `perplexity` | `pplx-...` | OpenAI 호환 |
| Meta | `meta` | (varies) | Llama, Together/Replicate 경유 |

## 파이프라인 흐름

```
INIT → ANALYZING → CLONING → STRATEGIZING → OPTIMIZING → VALIDATING → REPORTING → COMPLETED
                                  ↑                          │
                                  └── 목표 미달 시 루프백 ────┘
```

1. **ANALYZING**: Target URL 크롤링 + 사이트 분류 + GEO 7차원 채점
2. **CLONING**: 원본 HTML을 로컬 클론으로 복사
3. **STRATEGIZING**: 분석 결과 기반 최적화 계획 수립 (규칙 + LLM)
4. **OPTIMIZING**: 클론 파일에 메타태그/JSON-LD/llms.txt 등 수정 적용
5. **VALIDATING**: 수정 후 재채점 + Before-After 비교 + 추가 사이클 판정
6. **REPORTING**: Interactive HTML Dashboard + Archive 생성

## 프로젝트 구조

```
geo-agent/
├── packages/
│   ├── core/          # 핵심 로직 (모델, DB, 에이전트, 파이프라인, LLM)
│   ├── skills/        # 스킬 (Dual Crawl, GEO Scorer)
│   ├── dashboard/     # Hono 웹 서버 + Dashboard UI
│   └── cli/           # CLI 인터페이스
├── ARCHITECTURE.md    # 전체 시스템 설계서
├── CLAUDE.md          # 작업 기록 및 지침
└── package.json       # 모노레포 루트
```

## 개발

```bash
# 빌드
npm run build

# 테스트
npm test

# Lint
npx biome check .

# 개발 서버 (hot reload)
node --import tsx packages/cli/src/index.ts start
```

## 테스트

```bash
# 전체 테스트
npm test

# 특정 패키지
npx vitest run packages/core/
npx vitest run packages/dashboard/
npx vitest run packages/skills/

# 특정 파일
npx vitest run packages/core/src/agents/analysis/analysis-agent.test.ts
```

## LLM API 호출 비용 추정

파이프라인 1회 실행 시 예상 LLM API 호출 수와 비용입니다.

### 호출 수 내역

| 스테이지 | 호출 목적 | 호출 수 | 비고 |
|---|---|---|---|
| ANALYZING (초기 1회) | 콘텐츠 품질 평가 | 1 | HTML 요약 → LLM 평가 |
| ANALYZING (초기 1회) | LLM Probe 테스트 | 8+ | 사이트 종류별 프로브 프롬프트 |
| STRATEGIZING (매 사이클) | 전략 수립 LLM 강화 | 1 | 규칙 기반 + LLM 보강 |
| OPTIMIZING (매 사이클) | 콘텐츠 생성/수정 | ~4 | 태스크당 1회, 평균 4태스크 |
| VALIDATING (매 사이클) | Analysis Agent Clone 모드 | 9+ | 품질 평가 1 + Probe 8+ |
| **사이클당 소계** | | **~14** | STRATEGIZING + OPTIMIZING + VALIDATING |

### 총 예상 호출 수

| 시나리오 | 사이클 수 | 총 호출 수 |
|---|---|---|
| 빠른 수렴 | 1 | ~23 |
| 기본 (default) | 5 | ~79 |
| 최대 | 10 | ~149 |

### 예상 비용 (Target 1개 기준)

평균 호출당 입력 ~3,000 토큰, 출력 ~1,000 토큰 기준:

| 모델 | 5 사이클 | 10 사이클 | 호출당 비용 |
|---|---|---|---|
| GPT-4o-mini | ~$0.08 | ~$0.16 | ~$0.001 |
| GPT-4o | ~$1.40 | ~$2.60 | ~$0.018 |
| Claude Sonnet | ~$1.90 | ~$3.60 | ~$0.024 |
| Claude Opus | ~$8.70 | ~$16.40 | ~$0.110 |

> 위 비용은 추정치이며 실제 토큰 사용량에 따라 달라집니다. 멀티 페이지 분석(최대 30페이지)이 활성화되면 Probe 호출 수가 페이지 수에 비례하여 증가할 수 있습니다.

## 라이선스

Private
