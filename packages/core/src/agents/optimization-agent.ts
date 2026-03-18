import type { LLMRequest, LLMResponse } from "../llm/geo-llm-client.js";
/**
 * Optimization Agent
 *
 * OptimizationPlan의 태스크를 Clone 파일에 실제로 적용.
 * - 규칙 기반 수정 (LLM 없이): 메타태그, JSON-LD, llms.txt 등 구조적 수정
 * - LLM 강화 수정 (선택): 콘텐츠 개선, 설명 보강 등
 */
import type { OptimizationPlan, OptimizationTask } from "../models/optimization-plan.js";

// ── Types ───────────────────────────────────────────────────

export interface OptimizationInput {
	plan: OptimizationPlan;
	/** Clone의 working 파일 읽기 */
	readFile: (filePath: string) => Promise<string>;
	/** Clone의 working 파일 쓰기 */
	writeFile: (filePath: string, content: string) => Promise<void>;
	/** Clone의 working 파일 목록 */
	listFiles: () => Promise<string[]>;
}

export interface OptimizationResult {
	applied_tasks: string[];
	skipped_tasks: string[];
	failed_tasks: Array<{ task_id: string; error: string }>;
	files_modified: string[];
}

// ── Rule-based optimizers ────────────────────────────────────

type TaskOptimizer = (
	task: OptimizationTask,
	input: OptimizationInput,
	deps?: { chatLLM?: (req: LLMRequest) => Promise<LLMResponse> },
) => Promise<{ success: boolean; files_modified: string[]; error?: string }>;

/** Helper: get all HTML files from clone */
async function getHtmlFiles(input: OptimizationInput): Promise<string[]> {
	const files = await input.listFiles();
	const htmlFiles = files.filter((f) => f.endsWith(".html") || f.endsWith(".htm"));
	return htmlFiles.length > 0 ? htmlFiles : ["index.html"];
}

async function optimizeMetadata(
	task: OptimizationTask,
	input: OptimizationInput,
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	const htmlFiles = await getHtmlFiles(input);
	const modified: string[] = [];

	try {
		// robots.txt는 전역 파일 — 한 번만 생성
		if (task.title.includes("robots.txt") || task.title.includes("봇 허용")) {
			await input.writeFile(
				"robots.txt",
				"User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n",
			);
			modified.push("robots.txt");
		}

		// 모든 HTML 파일에 메타태그 적용
		for (const htmlFile of htmlFiles) {
			let html = await input.readFile(htmlFile);
			let fileModified = false;

			if (task.title.includes("Meta description") || task.title.includes("메타")) {
				if (!/<meta\s+name=["']description["']/i.test(html)) {
					html = html.replace(
						"</head>",
						'<meta name="description" content="Optimized page description for LLM discoverability">\n</head>',
					);
					fileModified = true;
				}
			}

			if (task.title.includes("Open Graph") || task.title.includes("OG")) {
				if (!/<meta\s+property=["']og:/i.test(html)) {
					const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "Page";
					html = html.replace(
						"</head>",
						`<meta property="og:title" content="${title.trim()}">\n<meta property="og:type" content="website">\n</head>`,
					);
					fileModified = true;
				}
			}

			if (fileModified) {
				await input.writeFile(htmlFile, html);
				modified.push(htmlFile);
			}
		}

		return { success: modified.length > 0, files_modified: modified };
	} catch (err) {
		return { success: false, files_modified: [], error: (err as Error).message };
	}
}

async function optimizeSchemaMarkup(
	_task: OptimizationTask,
	input: OptimizationInput,
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	const htmlFiles = await getHtmlFiles(input);
	const modified: string[] = [];

	try {
		for (const htmlFile of htmlFiles) {
			let html = await input.readFile(htmlFile);

			if (!/<script\s+type=["']application\/ld\+json["']/i.test(html)) {
				const jsonLd = {
					"@context": "https://schema.org",
					"@type": "WebPage",
					name: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || "Page",
					description:
						(html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) || [])[1] ||
						"",
				};
				html = html.replace(
					"</head>",
					`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`,
				);
				await input.writeFile(htmlFile, html);
				modified.push(htmlFile);
			}
		}

		return { success: modified.length > 0, files_modified: modified };
	} catch (err) {
		return { success: false, files_modified: [], error: (err as Error).message };
	}
}

async function optimizeLlmsTxt(
	_task: OptimizationTask,
	input: OptimizationInput,
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	try {
		await input.writeFile(
			"llms.txt",
			"# Site Information\n\nThis site provides information about products and services.\n\n## Key Content\n- Products and specifications\n- Pricing information\n- Company information\n",
		);
		return { success: true, files_modified: ["llms.txt"] };
	} catch (err) {
		return { success: false, files_modified: [], error: (err as Error).message };
	}
}

async function optimizeSemanticStructure(
	task: OptimizationTask,
	input: OptimizationInput,
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	const htmlFiles = await getHtmlFiles(input);
	const modified: string[] = [];

	try {
		for (const htmlFile of htmlFiles) {
			let html = await input.readFile(htmlFile);
			let fileModified = false;

			// Add H1 if missing
			if (task.title.includes("헤딩") && !/<h1[\s>]/i.test(html)) {
				const title =
					(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || "Page Title";
				html = html.replace(/<body[^>]*>/i, (match) => `${match}\n<h1>${title}</h1>`);
				fileModified = true;
			}

			if (fileModified) {
				await input.writeFile(htmlFile, html);
				modified.push(htmlFile);
			}
		}

		return { success: modified.length > 0, files_modified: modified };
	} catch (err) {
		return { success: false, files_modified: [], error: (err as Error).message };
	}
}

// ── Task type → optimizer mapping ────────────────────────────

const OPTIMIZERS: Record<string, TaskOptimizer> = {
	METADATA: optimizeMetadata,
	SCHEMA_MARKUP: optimizeSchemaMarkup,
	LLMS_TXT: optimizeLlmsTxt,
	SEMANTIC_STRUCTURE: optimizeSemanticStructure,
};

// ── Optimization Agent 실행 ──────────────────────────────────

export async function runOptimization(
	input: OptimizationInput,
	deps?: {
		chatLLM?: (req: LLMRequest) => Promise<LLMResponse>;
	},
): Promise<OptimizationResult> {
	const result: OptimizationResult = {
		applied_tasks: [],
		skipped_tasks: [],
		failed_tasks: [],
		files_modified: [],
	};

	for (const task of input.plan.tasks) {
		if (task.status !== "pending") {
			result.skipped_tasks.push(task.task_id);
			continue;
		}

		const optimizer = OPTIMIZERS[task.change_type];
		if (!optimizer) {
			result.skipped_tasks.push(task.task_id);
			continue;
		}

		const optimizeResult = await optimizer(task, input, deps);

		if (optimizeResult.success) {
			result.applied_tasks.push(task.task_id);
			for (const f of optimizeResult.files_modified) {
				if (!result.files_modified.includes(f)) {
					result.files_modified.push(f);
				}
			}
		} else if (optimizeResult.error) {
			result.failed_tasks.push({ task_id: task.task_id, error: optimizeResult.error });
		} else {
			result.skipped_tasks.push(task.task_id);
		}
	}

	return result;
}
