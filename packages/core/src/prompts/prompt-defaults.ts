/**
 * Unified Prompt Defaults Registry
 *
 * 시스템 전체의 모든 프롬프트/템플릿을 단일 레지스트리로 관리.
 * 32개 항목 (7 카테고리).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptConfigItem } from "../models/prompt-config.js";
import { DEFAULT_PROMPTS } from "./defaults.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Helper: 파일 읽기 (빌드 타임에 인라인 불가한 큰 템플릿) ──

function readTemplateFile(relativePath: string): string {
	const fullPath = path.resolve(__dirname, relativePath);
	try {
		return fs.readFileSync(fullPath, "utf-8");
	} catch {
		return `[Template file not found: ${relativePath}]`;
	}
}

// ── Category 1: Agent System Prompts (6) ────────────────────

function buildAgentSystemDefaults(): PromptConfigItem[] {
	return Object.values(DEFAULT_PROMPTS).map((p) => ({
		id: `agent.${p.agent_id}`,
		category: "agent_system" as const,
		display_name: p.display_name,
		prompt_template: p.system_instruction,
		system_instruction: "",
		variables: p.context_slots.map((s) => ({
			name: s.slot_name,
			description: s.description,
		})),
		is_customized: false,
		last_modified: null,
	}));
}

// ── Category 2: Analysis Skill (1) ──────────────────────────

function buildSkillDefaults(): PromptConfigItem[] {
	return [
		{
			id: "skill.geo_analysis",
			category: "skill",
			display_name: "GEO Analysis Skill (SKILL.md)",
			prompt_template: readTemplateFile("../skills/geo-analysis.skill.md"),
			system_instruction: "",
			variables: [],
			is_customized: false,
			last_modified: null,
		},
	];
}

// ── Category 3: Evaluation Templates (3) ────────────────────

function buildEvalTemplateDefaults(): PromptConfigItem[] {
	return [
		{
			id: "eval.manufacturer",
			category: "evaluation_template",
			display_name: "제조사 대표 Site (manufacturer)",
			prompt_template: readTemplateFile("./evaluation-templates/manufacturer.md"),
			system_instruction: "",
			variables: [
				{ name: "{{SITE_NAME}}", description: "사이트 이름" },
				{ name: "{{BASE_URL}}", description: "기본 URL" },
				{ name: "{{ROOT_URL}}", description: "루트 URL" },
				{ name: "{{LOCALE}}", description: "로케일" },
				{ name: "{{PRODUCT_CATEGORIES}}", description: "제품 카테고리 목록" },
				{ name: "{{RUN_ID}}", description: "실행 ID" },
				{ name: "{{PREVIOUS_RUN_ID}}", description: "이전 실행 ID" },
				{ name: "{{EVALUATOR}}", description: "평가자" },
				{ name: "{{PURPOSE}}", description: "평가 목적" },
				{ name: "{{CYCLE_NUMBER}}", description: "사이클 번호" },
				{ name: "{{EVAL_TARGET}}", description: "평가 대상 (original/clone)" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "eval.research",
			category: "evaluation_template",
			display_name: "연구소 대표 Site (research)",
			prompt_template: readTemplateFile("./evaluation-templates/research.md"),
			system_instruction: "",
			variables: [
				{ name: "{{SITE_NAME}}", description: "사이트 이름" },
				{ name: "{{BASE_URL}}", description: "기본 URL" },
				{ name: "{{ROOT_URL}}", description: "루트 URL" },
				{ name: "{{LOCALE}}", description: "로케일" },
				{ name: "{{RESEARCH_SECTIONS}}", description: "연구 섹션 목록" },
				{ name: "{{RUN_ID}}", description: "실행 ID" },
				{ name: "{{PREVIOUS_RUN_ID}}", description: "이전 실행 ID" },
				{ name: "{{EVALUATOR}}", description: "평가자" },
				{ name: "{{PURPOSE}}", description: "평가 목적" },
				{ name: "{{CYCLE_NUMBER}}", description: "사이클 번호" },
				{ name: "{{EVAL_TARGET}}", description: "평가 대상 (original/clone)" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "eval.generic",
			category: "evaluation_template",
			display_name: "기타 Site (generic)",
			prompt_template: readTemplateFile("./evaluation-templates/generic.md"),
			system_instruction: "",
			variables: [
				{ name: "{{SITE_NAME}}", description: "사이트 이름" },
				{ name: "{{BASE_URL}}", description: "기본 URL" },
				{ name: "{{ROOT_URL}}", description: "루트 URL" },
				{ name: "{{LOCALE}}", description: "로케일" },
				{ name: "{{CONTENT_SECTIONS}}", description: "콘텐츠 섹션 목록" },
				{ name: "{{RUN_ID}}", description: "실행 ID" },
				{ name: "{{PREVIOUS_RUN_ID}}", description: "이전 실행 ID" },
				{ name: "{{EVALUATOR}}", description: "평가자" },
				{ name: "{{PURPOSE}}", description: "평가 목적" },
				{ name: "{{CYCLE_NUMBER}}", description: "사이클 번호" },
				{ name: "{{EVAL_TARGET}}", description: "평가 대상 (original/clone)" },
			],
			is_customized: false,
			last_modified: null,
		},
	];
}

// ── Category 4: Probe Definitions (8 queries + 1 system) ────

function buildProbeDefaults(): PromptConfigItem[] {
	return [
		{
			id: "probe.P-01",
			category: "probe_definition",
			display_name: "P-01: 제품/서비스 스펙",
			prompt_template: "{{QUERY_SUBJECT}}의 주요 스펙과 특징을 알려주세요.",
			system_instruction: "",
			variables: [
				{ name: "{{QUERY_SUBJECT}}", description: "products[0] 또는 site_name (조건부 결정)" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "probe.P-02",
			category: "probe_definition",
			display_name: "P-02: 가격 정보",
			prompt_template: "{{QUERY_SUBJECT}}의 가격은 얼마인가요?",
			system_instruction: "",
			variables: [
				{
					name: "{{QUERY_SUBJECT}}",
					description: "products[0] 또는 '사이트명의 주요 제품 가격대'",
				},
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "probe.P-03",
			category: "probe_definition",
			display_name: "P-03: 비교 분석",
			prompt_template: "{{QUERY_SUBJECT}}을 경쟁 제품과 비교해주세요.",
			system_instruction: "",
			variables: [{ name: "{{QUERY_SUBJECT}}", description: "products[0] 또는 site_name" }],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "probe.P-04",
			category: "probe_definition",
			display_name: "P-04: 브랜드 인식",
			prompt_template: "{{BRAND_OR_SITE}}에 대해 알려주세요. 어떤 회사이고 무엇으로 유명한가요?",
			system_instruction: "",
			variables: [{ name: "{{BRAND_OR_SITE}}", description: "brand 또는 site_name" }],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "probe.P-05",
			category: "probe_definition",
			display_name: "P-05: 추천 질의",
			prompt_template: "{{QUERY_SUBJECT}} 관련 좋은 제품이나 서비스를 추천해주세요.",
			system_instruction: "",
			variables: [
				{ name: "{{QUERY_SUBJECT}}", description: "topics[0] 또는 'brand/site_name 분야'" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "probe.P-06",
			category: "probe_definition",
			display_name: "P-06: 팩트 검증",
			prompt_template: "{{QUERY_SUBJECT}}의 사양 정보가 정확한지 확인해주세요.",
			system_instruction: "",
			variables: [
				{ name: "{{QUERY_SUBJECT}}", description: "products[0] 또는 '사이트명에 대한 주요 사실'" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "probe.P-07",
			category: "probe_definition",
			display_name: "P-07: 최신 정보",
			prompt_template: "{{BRAND_OR_SITE}}의 최신 소식이나 새로운 발표가 있나요?",
			system_instruction: "",
			variables: [{ name: "{{BRAND_OR_SITE}}", description: "brand 또는 site_name" }],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "probe.P-08",
			category: "probe_definition",
			display_name: "P-08: 문제 해결",
			prompt_template: "{{QUERY_SUBJECT}} 관련 문제를 해결하려면 어떻게 해야 하나요?",
			system_instruction: "",
			variables: [
				{
					name: "{{QUERY_SUBJECT}}",
					description: "topics[0] 또는 'brand/site_name이 제공하는 서비스'",
				},
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "probe.system",
			category: "probe_definition",
			display_name: "Probe System Instruction",
			prompt_template: "",
			system_instruction:
				"You are a citation analysis expert. Determine if a given text references a specific website. Look for: direct URL mentions, domain references, brand/site name mentions, indirect references, and paraphrased content attribution. Be thorough but accurate. Respond with JSON only.",
			variables: [],
			is_customized: false,
			last_modified: null,
		},
	];
}

// ── Category 5: Judgment Prompts (4) ────────────────────────

function buildJudgmentDefaults(): PromptConfigItem[] {
	return [
		{
			id: "judge.citation_check",
			category: "judgment",
			display_name: "Citation Check (인용 판정)",
			prompt_template: `Analyze this AI-generated response and determine if it cites, references, or mentions the target website.

Target website:
- URL: {{SITE_URL}}
- Site name: {{SITE_NAME}}
- Brand: {{BRAND}}

AI response to analyze:
"""
{{RESPONSE}}
"""

Does the response cite, reference, or mention the target website (including indirect references, paraphrases, or URL variants)?
Respond with JSON: { "cited": true/false, "reasoning": "brief explanation" }`,
			system_instruction:
				"You are a citation analysis expert. Determine if a given text references a specific website. Look for: direct URL mentions, domain references, brand/site name mentions, indirect references, and paraphrased content attribution. Be thorough but accurate. Respond with JSON only.",
			variables: [
				{ name: "{{SITE_URL}}", description: "Target website URL" },
				{ name: "{{SITE_NAME}}", description: "Target site name" },
				{ name: "{{BRAND}}", description: "Brand name" },
				{ name: "{{RESPONSE}}", description: "AI response text (max 1500 chars)" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "judge.accuracy_estimation",
			category: "judgment",
			display_name: "Accuracy Estimation (정확도 평가)",
			prompt_template: `Evaluate the accuracy of this AI-generated response against the known facts about the target site.

Known facts about the target:
{{CONTEXT_INFO}}
Was the target cited in the response: {{CITED}}

AI response to evaluate:
"""
{{RESPONSE}}
"""

Rate the accuracy from 0.0 to 1.0 based on:
- How well the response reflects the actual products, topics, and prices
- Whether product names, specs, or brand information are correctly stated
- Whether the response contains relevant and factual information about the target
- Deduct for fabricated or incorrect information

Respond with JSON: { "accuracy": 0.0-1.0, "reasoning": "brief explanation" }`,
			system_instruction:
				"You are an accuracy evaluation expert. Rate how accurately an AI response reflects known facts about a website. Be strict: fabricated details score low, verified facts score high. Respond with JSON only.",
			variables: [
				{
					name: "{{CONTEXT_INFO}}",
					description: "Known facts (topics, products, prices, brand, site)",
				},
				{ name: "{{CITED}}", description: "Yes/No — was target cited" },
				{ name: "{{RESPONSE}}", description: "AI response text (max 1500 chars)" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "judge.fact_judgment",
			category: "judgment",
			display_name: "Fact Judgment (팩트 판정)",
			prompt_template: `Compare the following AI responses against the ground truth fact.

Ground Truth Fact:
- Category: {{FACT_CATEGORY}}
- Label: {{FACT_LABEL}}
- Expected Value: "{{FACT_EXPECTED_VALUE}}"

AI Responses:
{{RESPONSES_BLOCK}}

For each provider, determine:
1. Whether the response mentions or recognizes the fact
2. Accuracy level:
   - "exact": fact is mentioned correctly and completely
   - "approximate": fact is partially correct or paraphrased with minor differences
   - "outdated": fact was correct but the response shows old/outdated information
   - "hallucinated": response mentions the topic but with incorrect information
   - "missing": response does not mention or address the fact at all

Respond with JSON only:
{ "results": [{ "provider_id": "...", "accuracy": "exact|approximate|outdated|hallucinated|missing", "llm_answer": "what the LLM said about this fact (brief)", "detail": "brief explanation" }] }`,
			system_instruction:
				"You are a fact-checking expert. Compare AI responses against ground truth data. Be strict: only rate 'exact' if the fact is correctly stated. Respond with JSON only.",
			variables: [
				{ name: "{{FACT_CATEGORY}}", description: "Fact category" },
				{ name: "{{FACT_LABEL}}", description: "Fact label" },
				{ name: "{{FACT_EXPECTED_VALUE}}", description: "Expected value" },
				{ name: "{{RESPONSES_BLOCK}}", description: "Provider responses block" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "judge.citation_judgment",
			category: "judgment",
			display_name: "Citation Judgment (인용률 판정)",
			prompt_template: `Analyze these AI-generated responses and determine what fraction of each provider's responses cite, reference, or mention the target website.

Target:
- URL: {{SITE_URL}}
- Name: {{SITE_NAME}}
- Brand: {{BRAND}}

Responses:
{{RESPONSES_BLOCK}}

For each provider, count how many of its responses cite the target (direct URL, domain, brand/site name, or indirect reference).

Respond with JSON: { "citations": { "provider_id": { "cited_count": N, "total": M } } }`,
			system_instruction:
				"You are a citation analysis expert. Count citations accurately. Respond with JSON only.",
			variables: [
				{ name: "{{SITE_URL}}", description: "Target website URL" },
				{ name: "{{SITE_NAME}}", description: "Target site name" },
				{ name: "{{BRAND}}", description: "Brand name" },
				{ name: "{{RESPONSES_BLOCK}}", description: "Provider responses block" },
			],
			is_customized: false,
			last_modified: null,
		},
	];
}

// ── Category 6: Optimization Prompts (7) ────────────────────

function buildOptimizationDefaults(): PromptConfigItem[] {
	return [
		{
			id: "opt.meta_description",
			category: "optimization",
			display_name: "Meta Description 생성",
			prompt_template:
				"Write a concise meta description (max 160 characters) for this web page.\n\nTitle: {{PAGE_TITLE}}\n\nContent excerpt:\n{{PAGE_TEXT}}",
			system_instruction:
				"You are an SEO expert specializing in LLM discoverability. Write a single meta description that is factual, keyword-rich, and optimized for AI engines. Output ONLY the description text, no quotes or labels. Keep it under 160 characters.",
			variables: [
				{ name: "{{PAGE_TITLE}}", description: "Page title tag" },
				{ name: "{{PAGE_TEXT}}", description: "Visible text excerpt (max 1500 chars)" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "opt.og_description",
			category: "optimization",
			display_name: "Open Graph Description 생성",
			prompt_template:
				"Write a compelling Open Graph description (max 200 characters) for social sharing of this page.\n\nTitle: {{PAGE_TITLE}}\n\nContent excerpt:\n{{PAGE_TEXT}}",
			system_instruction:
				"You are a social media optimization expert. Write a single OG description that encourages clicks and shares. Output ONLY the description text, no quotes or labels. Keep it under 200 characters.",
			variables: [
				{ name: "{{PAGE_TITLE}}", description: "Page title" },
				{ name: "{{PAGE_TEXT}}", description: "Visible text excerpt" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "opt.json_ld",
			category: "optimization",
			display_name: "JSON-LD 구조화 데이터 생성",
			prompt_template:
				"Generate a rich JSON-LD (schema.org) structured data object for this web page.\n\nTitle: {{PAGE_TITLE}}\nMeta description: {{META_DESC}}\nExisting JSON-LD: {{EXISTING_LD}}\n\nContent excerpt:\n{{PAGE_TEXT}}",
			system_instruction:
				"You are a structured data expert. Generate a single JSON-LD object using schema.org vocabulary. Choose the most appropriate @type (WebPage, Product, Article, Organization, etc.) based on the content. Include as many relevant properties as the content supports (name, description, url, image, author, datePublished, etc.). Output ONLY valid JSON, no markdown fences or explanation.",
			variables: [
				{ name: "{{PAGE_TITLE}}", description: "Page title" },
				{ name: "{{META_DESC}}", description: "Meta description" },
				{ name: "{{EXISTING_LD}}", description: "Existing JSON-LD blocks or 'None'" },
				{ name: "{{PAGE_TEXT}}", description: "Visible text excerpt" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "opt.llms_txt",
			category: "optimization",
			display_name: "llms.txt 파일 생성",
			prompt_template:
				"Generate an llms.txt file for a website with these pages:\n\n{{PAGE_SUMMARIES}}\n\nTotal pages: {{TOTAL_PAGES}}",
			system_instruction:
				"You are a GEO (Generative Engine Optimization) expert. Generate an llms.txt file that helps LLMs understand this site. Use markdown format with: a top-level heading with the site name, a brief description, then sections for key content areas, important pages, and any structured data available. Be specific to the actual site content — do not use generic boilerplate. Output ONLY the llms.txt content.",
			variables: [
				{ name: "{{PAGE_SUMMARIES}}", description: "Page summaries list" },
				{ name: "{{TOTAL_PAGES}}", description: "Total HTML pages count" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "opt.semantic_h1",
			category: "optimization",
			display_name: "H1 헤딩 생성",
			prompt_template:
				"Suggest a clear, descriptive H1 heading for this web page.\n\nCurrent title tag: {{PAGE_TITLE}}\n\nContent excerpt:\n{{PAGE_TEXT}}",
			system_instruction:
				"You are a web content expert. Write a single H1 heading that is clear, descriptive, and optimized for both users and LLM engines. It should accurately represent the page content. Output ONLY the heading text — no HTML tags, no quotes, no explanation. Keep it under 80 characters.",
			variables: [
				{ name: "{{PAGE_TITLE}}", description: "Current title tag" },
				{ name: "{{PAGE_TEXT}}", description: "Page content excerpt" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "opt.content_density",
			category: "optimization",
			display_name: "콘텐츠 밀도 보강",
			prompt_template:
				'This web page has thin content ({{WORD_COUNT}} words). Title: "{{PAGE_TITLE}}"\nContent: "{{PAGE_TEXT}}"\n\nWrite 2-3 additional paragraphs of factual, informative content that would help this page be better understood by LLMs. Write in the same language as the existing content. Output only the HTML paragraphs (wrapped in <section> tags).',
			system_instruction:
				"You are a GEO content specialist. Generate factual, relevant content to improve page density for LLM consumption. Never fabricate data. Use semantic HTML.",
			variables: [
				{ name: "{{WORD_COUNT}}", description: "Current word count" },
				{ name: "{{PAGE_TITLE}}", description: "Page title" },
				{ name: "{{PAGE_TEXT}}", description: "Existing content text (max 1500 chars)" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "opt.faq_generation",
			category: "optimization",
			display_name: "FAQ 섹션 생성",
			prompt_template:
				'Based on this page content, generate a FAQ section with 3-5 questions and answers.\nTitle: "{{PAGE_TITLE}}"\nContent: "{{PAGE_TEXT}}"\n\nOutput JSON: { "faqs": [{ "question": "...", "answer": "..." }] }',
			system_instruction:
				"Generate factual FAQ items based on the page content. Never invent information not present in the content.",
			variables: [
				{ name: "{{PAGE_TITLE}}", description: "Page title" },
				{ name: "{{PAGE_TEXT}}", description: "Page content text" },
			],
			is_customized: false,
			last_modified: null,
		},
	];
}

// ── Category 7: Strategy & Validation (2) ───────────────────

function buildStrategyValidationDefaults(): PromptConfigItem[] {
	return [
		{
			id: "sv.strategy_generation",
			category: "strategy_validation",
			display_name: "Strategy Generation (전략 생성)",
			prompt_template: `You are a GEO (Generative Engine Optimization) strategist. Analyze the following website assessment and generate a complete optimization strategy with prioritized tasks.

## Current GEO Scores
- Total: {{GEO_TOTAL}}/100
- Citation Rate: {{CITATION_RATE}}/100
- Citation Accuracy: {{CITATION_ACCURACY}}/100
- Info Recognition: {{INFO_RECOGNITION}}/100
- Coverage: {{COVERAGE}}/100
- Rank Position: {{RANK_POSITION}}/100
- Structured Score: {{STRUCTURED_SCORE}}/100

## Structured Data Status
- JSON-LD present: {{JSON_LD_PRESENT}}
- Schema completeness: {{SCHEMA_COMPLETENESS}}
- OG tags present: {{OG_TAGS_PRESENT}}
- Meta description: {{META_DESC_STATUS}}

## Content Analysis
- Word count: {{WORD_COUNT}}
- Readability level: {{READABILITY_LEVEL}}

## Machine Readability
- Grade: {{MR_GRADE}}
- Heading hierarchy valid: {{HEADING_VALID}}
- Semantic tag ratio: {{SEMANTIC_RATIO}}

## Existing Rule-Based Tasks
{{RULE_BASED_TASKS}}

Generate a complete strategy as JSON. Include tasks that address the most impactful improvements. Use change_type values from: METADATA, SCHEMA_MARKUP, LLMS_TXT, SEMANTIC_STRUCTURE, CONTENT_DENSITY, FAQ_SECTION, INTERNAL_LINKING, IMAGE_ALT, CANONICAL, SITEMAP.`,
			system_instruction:
				'You are a GEO optimization expert. Respond with JSON only:\n{"strategy_rationale":"detailed explanation","tasks":[{"change_type":"SCHEMA_MARKUP","title":"...","description":"specific instructions","target_element":null,"priority":"critical","expected_impact":"...","specific_data":{}}],"estimated_delta":15,"confidence":0.7}',
			variables: [
				{ name: "{{GEO_TOTAL}}", description: "Total GEO score" },
				{ name: "{{CITATION_RATE}}", description: "Citation rate score" },
				{ name: "{{CITATION_ACCURACY}}", description: "Citation accuracy score" },
				{ name: "{{INFO_RECOGNITION}}", description: "Info recognition score" },
				{ name: "{{COVERAGE}}", description: "Coverage score" },
				{ name: "{{RANK_POSITION}}", description: "Rank position score" },
				{ name: "{{STRUCTURED_SCORE}}", description: "Structured score" },
				{ name: "{{JSON_LD_PRESENT}}", description: "JSON-LD presence (true/false)" },
				{ name: "{{SCHEMA_COMPLETENESS}}", description: "Schema completeness" },
				{ name: "{{OG_TAGS_PRESENT}}", description: "OG tags presence" },
				{ name: "{{META_DESC_STATUS}}", description: "Meta description status" },
				{ name: "{{WORD_COUNT}}", description: "Word count" },
				{ name: "{{READABILITY_LEVEL}}", description: "Readability level" },
				{ name: "{{MR_GRADE}}", description: "Machine readability grade" },
				{ name: "{{HEADING_VALID}}", description: "Heading hierarchy valid" },
				{ name: "{{SEMANTIC_RATIO}}", description: "Semantic tag ratio" },
				{ name: "{{RULE_BASED_TASKS}}", description: "Pre-generated task list" },
			],
			is_customized: false,
			last_modified: null,
		},
		{
			id: "sv.validation_assessment",
			category: "strategy_validation",
			display_name: "Validation Assessment (검증 평가)",
			prompt_template:
				"Compare the optimization results. Score changed from {{BEFORE_SCORE}} to {{AFTER_SCORE}} (delta: {{DELTA}}).\n\nDimension changes:\n{{DIMENSION_DELTAS}}\n\nAssess the optimization quality. Respond in JSON format.",
			system_instruction:
				'You are a GEO validation expert. Assess optimization quality. Respond with JSON:\n{"improved_aspects":["string"],"remaining_issues":["string"],"llm_friendliness_verdict":"much_better|better|marginally_better|no_change|worse","specific_recommendations":["string"],"confidence":0.0-1.0}',
			variables: [
				{ name: "{{BEFORE_SCORE}}", description: "Score before optimization" },
				{ name: "{{AFTER_SCORE}}", description: "Score after optimization" },
				{ name: "{{DELTA}}", description: "Score delta" },
				{ name: "{{DIMENSION_DELTAS}}", description: "Per-dimension changes" },
			],
			is_customized: false,
			last_modified: null,
		},
	];
}

// ── Build full registry ─────────────────────────────────────

let _cachedDefaults: Record<string, PromptConfigItem> | null = null;

export function getPromptDefaults(): Record<string, PromptConfigItem> {
	if (_cachedDefaults) return _cachedDefaults;

	const all = [
		...buildAgentSystemDefaults(),
		...buildSkillDefaults(),
		...buildEvalTemplateDefaults(),
		...buildProbeDefaults(),
		...buildJudgmentDefaults(),
		...buildOptimizationDefaults(),
		...buildStrategyValidationDefaults(),
	];

	_cachedDefaults = {};
	for (const item of all) {
		_cachedDefaults[item.id] = item;
	}
	return _cachedDefaults;
}

/** Reset cache (for testing) */
export function resetPromptDefaultsCache(): void {
	_cachedDefaults = null;
}
