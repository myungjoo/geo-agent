/**
 * Synthetic Probes — LLM에 실제 질의하여 Target 인용/정확도 검증
 *
 * 8종 프로브:
 * P-01: 제품/서비스 스펙 질의 → 정확한 스펙 인용 여부
 * P-02: 가격 질의 → 가격 정보 정확도
 * P-03: 비교 질의 → 경쟁사 대비 Target 언급 여부
 * P-04: 브랜드 질의 → 브랜드/조직 인식 정확도
 * P-05: 추천 질의 → Target 추천 포함 여부
 * P-06: 팩트 검증 → 주요 수치/사실 정확도
 * P-07: 최신 정보 → 최신 정보 반영 여부
 * P-08: 문제 해결 → 솔루션으로 Target 언급 여부
 */
import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
import { PromptConfigManager, resolvePrompt } from "../../prompts/prompt-config-manager.js";

// ── Types ───────────────────────────────────────────────────

export interface ProbeDefinition {
	id: string;
	name: string;
	category: "citation" | "accuracy" | "recognition" | "recommendation";
	/** 프로브 질문 생성 함수 */
	generateQuery: (context: ProbeContext) => string;
}

export interface ProbeContext {
	site_name: string;
	site_url: string;
	site_type: string;
	/** 페이지에서 추출한 주요 키워드/토픽 */
	topics: string[];
	/** 페이지에서 추출한 제품/서비스 이름 */
	products: string[];
	/** 페이지에서 추출한 가격 정보 */
	prices: string[];
	/** 페이지에서 추출한 조직/브랜드 이름 */
	brand: string;
}

export interface SyntheticProbeResult {
	probe_id: string;
	probe_name: string;
	category: string;
	query: string;
	response: string;
	/** Target 사이트가 응답에서 언급/인용되었는지 */
	cited: boolean;
	/** 정확도 (0~1): 응답 내용이 원본 데이터와 일치하는 정도 */
	accuracy: number;
	/** 결과 판정 */
	verdict: "PASS" | "PARTIAL" | "FAIL";
	latency_ms: number;
	model: string;
	provider: string;
	/** 에러 메시지 (실패 시) */
	error?: string;
}

export interface SyntheticProbeRunResult {
	probes: SyntheticProbeResult[];
	summary: {
		total: number;
		pass: number;
		partial: number;
		fail: number;
		citation_rate: number;
		average_accuracy: number;
	};
}

// ── Probe Definitions ────────────────────────────────────────

/** Resolve {{QUERY_SUBJECT}} / {{BRAND_OR_SITE}} from context */
function resolveProbeSubject(ctx: ProbeContext, probeId: string): string {
	switch (probeId) {
		case "P-01":
			return ctx.products.length > 0 ? ctx.products[0] : `${ctx.site_name}의 주요 제품이나 서비스`;
		case "P-02":
			return ctx.products.length > 0 ? ctx.products[0] : `${ctx.site_name}의 주요 제품 가격대`;
		case "P-03":
			return ctx.products.length > 0 ? ctx.products[0] : ctx.site_name;
		case "P-05":
			return ctx.topics.length > 0 ? ctx.topics[0] : `${ctx.brand || ctx.site_name} 분야`;
		case "P-06":
			return ctx.products.length > 0 ? ctx.products[0] : `${ctx.site_name}에 대한 주요 사실`;
		case "P-08":
			return ctx.topics.length > 0
				? ctx.topics[0]
				: `${ctx.brand || ctx.site_name}이 제공하는 서비스`;
		default:
			return ctx.products.length > 0 ? ctx.products[0] : ctx.site_name;
	}
}

const PROBE_CATEGORIES: Record<string, "accuracy" | "citation" | "recognition" | "recommendation"> =
	{
		"P-01": "accuracy",
		"P-02": "accuracy",
		"P-03": "citation",
		"P-04": "recognition",
		"P-05": "recommendation",
		"P-06": "accuracy",
		"P-07": "citation",
		"P-08": "recommendation",
	};

const PROBE_NAMES: Record<string, string> = {
	"P-01": "제품/서비스 스펙",
	"P-02": "가격 정보",
	"P-03": "비교 분석",
	"P-04": "브랜드 인식",
	"P-05": "추천 질의",
	"P-06": "팩트 검증",
	"P-07": "최신 정보",
	"P-08": "문제 해결",
};

/** Build probe definitions, optionally loading custom templates from workspace */
export function getProbeDefinitions(workspaceDir?: string): ProbeDefinition[] {
	let configManager: PromptConfigManager | null = null;
	if (workspaceDir) {
		configManager = new PromptConfigManager(workspaceDir);
	}

	const probeIds = ["P-01", "P-02", "P-03", "P-04", "P-05", "P-06", "P-07", "P-08"];

	return probeIds.map((probeId) => {
		let template: string | null = null;
		if (configManager) {
			try {
				const config = configManager.load(`probe.${probeId}`);
				if (config.is_customized) {
					template = config.prompt_template;
				}
			} catch {
				/* use default */
			}
		}

		return {
			id: probeId,
			name: PROBE_NAMES[probeId],
			category: PROBE_CATEGORIES[probeId],
			generateQuery: (ctx: ProbeContext) => {
				if (template) {
					return resolvePrompt(template, {
						"{{QUERY_SUBJECT}}": resolveProbeSubject(ctx, probeId),
						"{{BRAND_OR_SITE}}": ctx.brand || ctx.site_name,
					});
				}
				// Default hardcoded (backward compat when no workspaceDir)
				return (
					resolveProbeSubject(ctx, probeId) +
					(probeId === "P-01"
						? "의 주요 스펙과 특징을 알려주세요."
						: probeId === "P-02"
							? "의 가격은 얼마인가요?"
							: probeId === "P-03"
								? "을 경쟁 제품과 비교해주세요."
								: probeId === "P-04"
									? `${ctx.brand || ctx.site_name}에 대해 알려주세요. 어떤 회사이고 무엇으로 유명한가요?`
									: probeId === "P-05"
										? " 관련 좋은 제품이나 서비스를 추천해주세요."
										: probeId === "P-06"
											? "의 사양 정보가 정확한지 확인해주세요."
											: probeId === "P-07"
												? `${ctx.brand || ctx.site_name}의 최신 소식이나 새로운 발표가 있나요?`
												: " 관련 문제를 해결하려면 어떻게 해야 하나요?")
				);
			},
		};
	});
}

/** Default probe definitions (no workspace customization) */
const PROBE_DEFINITIONS: ProbeDefinition[] = getProbeDefinitions();

// ── Citation/Accuracy Analysis (LLM-based, 4-D) ─────────────

/**
 * LLM-based citation check: asks the LLM to judge whether the response
 * cited or referenced the target site. Catches indirect citations,
 * paraphrases, and URL variants that string matching would miss.
 */
async function checkCitation(
	response: string,
	siteUrl: string,
	siteName: string,
	brand: string,
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
	workspaceDir?: string,
): Promise<boolean> {
	let promptText: string;
	let sysInstruction: string;

	if (workspaceDir) {
		try {
			const mgr = new PromptConfigManager(workspaceDir);
			const config = mgr.load("judge.citation_check");
			promptText = resolvePrompt(config.prompt_template, {
				"{{SITE_URL}}": siteUrl,
				"{{SITE_NAME}}": siteName,
				"{{BRAND}}": brand,
				"{{RESPONSE}}": response.slice(0, 1500),
			});
			sysInstruction = config.system_instruction;
		} catch {
			promptText = "";
			sysInstruction = "";
		}
	} else {
		promptText = "";
		sysInstruction = "";
	}

	if (!promptText) {
		promptText = `Analyze this AI-generated response and determine if it cites, references, or mentions the target website.\n\nTarget website:\n- URL: ${siteUrl}\n- Site name: ${siteName}\n- Brand: ${brand}\n\nAI response to analyze:\n"""\n${response.slice(0, 1500)}\n"""\n\nDoes the response cite, reference, or mention the target website (including indirect references, paraphrases, or URL variants)?\nRespond with JSON: { "cited": true/false, "reasoning": "brief explanation" }`;
		sysInstruction =
			"You are a citation analysis expert. Determine if a given text references a specific website. Look for: direct URL mentions, domain references, brand/site name mentions, indirect references, and paraphrased content attribution. Be thorough but accurate. Respond with JSON only.";
	}

	const judgeResponse = await chatLLM({
		prompt: promptText,
		system_instruction: sysInstruction,
		json_mode: true,
		temperature: 0.1,
		max_tokens: 200,
	});

	try {
		const parsed = JSON.parse(judgeResponse.content);
		return !!parsed.cited;
	} catch {
		// If JSON parse fails, fall back to checking for "true" in response
		return (
			judgeResponse.content.toLowerCase().includes('"cited": true') ||
			judgeResponse.content.toLowerCase().includes('"cited":true')
		);
	}
}

/**
 * LLM-based accuracy estimation: asks the LLM to judge how accurately
 * the probe response reflects the target site's actual data.
 * Provides ProbeContext (topics, products, prices) for comparison.
 */
async function estimateAccuracy(
	response: string,
	context: ProbeContext,
	cited: boolean,
	chatLLM: (req: LLMRequest) => Promise<LLMResponse>,
	workspaceDir?: string,
): Promise<number> {
	const contextInfo = [
		context.topics.length > 0 ? `Topics: ${context.topics.join(", ")}` : null,
		context.products.length > 0 ? `Products: ${context.products.join(", ")}` : null,
		context.prices.length > 0 ? `Prices: ${context.prices.join(", ")}` : null,
		`Brand: ${context.brand}`,
		`Site: ${context.site_name} (${context.site_url})`,
	]
		.filter(Boolean)
		.join("\n");

	let promptText: string;
	let sysInstruction: string;

	if (workspaceDir) {
		try {
			const mgr = new PromptConfigManager(workspaceDir);
			const config = mgr.load("judge.accuracy_estimation");
			promptText = resolvePrompt(config.prompt_template, {
				"{{CONTEXT_INFO}}": contextInfo,
				"{{CITED}}": cited ? "Yes" : "No",
				"{{RESPONSE}}": response.slice(0, 1500),
			});
			sysInstruction = config.system_instruction;
		} catch {
			promptText = "";
			sysInstruction = "";
		}
	} else {
		promptText = "";
		sysInstruction = "";
	}

	if (!promptText) {
		promptText = `Evaluate the accuracy of this AI-generated response against the known facts about the target site.\n\nKnown facts about the target:\n${contextInfo}\nWas the target cited in the response: ${cited ? "Yes" : "No"}\n\nAI response to evaluate:\n"""\n${response.slice(0, 1500)}\n"""\n\nRate the accuracy from 0.0 to 1.0 based on:\n- How well the response reflects the actual products, topics, and prices\n- Whether product names, specs, or brand information are correctly stated\n- Whether the response contains relevant and factual information about the target\n- Deduct for fabricated or incorrect information\n\nRespond with JSON: { "accuracy": 0.0-1.0, "reasoning": "brief explanation" }`;
		sysInstruction =
			"You are an accuracy evaluation expert. Rate how accurately an AI response reflects known facts about a website. Be strict: fabricated details score low, verified facts score high. Respond with JSON only.";
	}

	const judgeResponse = await chatLLM({
		prompt: promptText,
		system_instruction: sysInstruction,
		json_mode: true,
		temperature: 0.1,
		max_tokens: 200,
	});

	try {
		const parsed = JSON.parse(judgeResponse.content);
		const accuracy = Number(parsed.accuracy);
		if (Number.isFinite(accuracy)) {
			return Math.min(Math.max(Math.round(accuracy * 100) / 100, 0), 1);
		}
	} catch {
		// Fallback: try to extract number from response
	}
	return 0;
}

function determineVerdict(cited: boolean, accuracy: number): "PASS" | "PARTIAL" | "FAIL" {
	if (cited && accuracy >= 0.5) return "PASS";
	if (cited || accuracy >= 0.3) return "PARTIAL";
	return "FAIL";
}

// ── Probe Runner ─────────────────────────────────────────────

export async function runProbes(
	context: ProbeContext,
	deps: {
		chatLLM: (req: LLMRequest) => Promise<LLMResponse>;
	},
	options?: {
		/** 실행할 프로브 ID 목록 (기본: 전체) */
		probeIds?: string[];
		/** 프로브 간 딜레이 ms (rate limit 방지, 기본: 1000) */
		delayMs?: number;
	},
): Promise<SyntheticProbeRunResult> {
	const probesToRun = options?.probeIds
		? PROBE_DEFINITIONS.filter((p) => options.probeIds!.includes(p.id))
		: PROBE_DEFINITIONS;

	const delayMs = options?.delayMs ?? 1000;
	const results: SyntheticProbeResult[] = [];

	for (const probe of probesToRun) {
		const query = probe.generateQuery(context);

		try {
			const llmResponse = await deps.chatLLM({
				prompt: query,
				system_instruction:
					"사용자의 질문에 정확하고 상세하게 답변하세요. 가능하면 출처나 브랜드를 언급하세요.",
				max_tokens: 500,
				temperature: 0.3,
				json_mode: false,
			});

			const cited = await checkCitation(
				llmResponse.content,
				context.site_url,
				context.site_name,
				context.brand,
				deps.chatLLM,
			);
			const accuracy = await estimateAccuracy(llmResponse.content, context, cited, deps.chatLLM);
			const verdict = determineVerdict(cited, accuracy);

			results.push({
				probe_id: probe.id,
				probe_name: probe.name,
				category: probe.category,
				query,
				response: llmResponse.content,
				cited,
				accuracy,
				verdict,
				latency_ms: llmResponse.latency_ms,
				model: llmResponse.model,
				provider: llmResponse.provider,
			});
		} catch (err) {
			results.push({
				probe_id: probe.id,
				probe_name: probe.name,
				category: probe.category,
				query,
				response: `Error: ${err instanceof Error ? err.message : String(err)}`,
				cited: false,
				accuracy: 0,
				verdict: "FAIL",
				latency_ms: 0,
				model: "error",
				provider: "error",
			});
		}

		// Rate limit delay
		if (delayMs > 0 && probesToRun.indexOf(probe) < probesToRun.length - 1) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}

	const pass = results.filter((r) => r.verdict === "PASS").length;
	const partial = results.filter((r) => r.verdict === "PARTIAL").length;
	const fail = results.filter((r) => r.verdict === "FAIL").length;
	const citedCount = results.filter((r) => r.cited).length;
	const avgAccuracy =
		results.length > 0 ? results.reduce((sum, r) => sum + r.accuracy, 0) / results.length : 0;

	return {
		probes: results,
		summary: {
			total: results.length,
			pass,
			partial,
			fail,
			citation_rate: results.length > 0 ? citedCount / results.length : 0,
			average_accuracy: Math.round(avgAccuracy * 100) / 100,
		},
	};
}

export { PROBE_DEFINITIONS };
