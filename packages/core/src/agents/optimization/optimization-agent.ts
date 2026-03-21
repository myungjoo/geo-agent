import type { LLMRequest, LLMResponse } from "../../llm/geo-llm-client.js";
/**
 * Optimization Agent
 *
 * OptimizationPlan의 태스크를 Clone 파일에 실제로 적용.
 * - 규칙 기반 수정 (LLM 없이): 메타태그, JSON-LD, llms.txt 등 구조적 수정
 * - LLM 강화 수정 (선택): 콘텐츠 개선, 설명 보강 등
 */
import type { OptimizationPlan, OptimizationTask } from "../../models/optimization-plan.js";
import {
	escapeHtml,
	extractTitle,
	extractVisibleText,
	safeLLMCall,
} from "../shared/llm-helpers.js";

// ── Types ───────────────────────────────────────────────────

export interface OptimizationInput {
	plan: OptimizationPlan;
	/** Clone의 working 파일 읽기 */
	readFile: (filePath: string) => Promise<string>;
	/** Clone의 working 파일 쓰기 */
	writeFile: (filePath: string, content: string) => Promise<void>;
	/** Clone의 working 파일 목록 */
	listFiles: () => Promise<string[]>;
	/** Target URL (canonical URL 등에 사용) */
	target_url?: string;
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
	deps?: { chatLLM?: (req: LLMRequest) => Promise<LLMResponse> },
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
					const pageText = extractVisibleText(html).slice(0, 1500);
					const pageTitle = extractTitle(html);
					const { result: description } = await safeLLMCall(
						deps?.chatLLM,
						{
							prompt: `Write a concise meta description (max 160 characters) for this web page.\n\nTitle: ${pageTitle}\n\nContent excerpt:\n${pageText}`,
							system_instruction:
								"You are an SEO expert specializing in LLM discoverability. Write a single meta description that is factual, keyword-rich, and optimized for AI engines. Output ONLY the description text, no quotes or labels. Keep it under 160 characters.",
							json_mode: false,
							temperature: 0.3,
							max_tokens: 200,
						},
						(content) => {
							const trimmed = content.trim().replace(/^["']|["']$/g, "");
							return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
						},
					);

					html = html.replace(
						"</head>",
						`<meta name="description" content="${escapeHtml(description)}">\n</head>`,
					);
					fileModified = true;
				}
			}

			if (task.title.includes("Open Graph") || task.title.includes("OG")) {
				if (!/<meta\s+property=["']og:/i.test(html)) {
					const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "Page";
					const pageText = extractVisibleText(html).slice(0, 1500);
					const { result: ogDescription } = await safeLLMCall(
						deps?.chatLLM,
						{
							prompt: `Write a compelling Open Graph description (max 200 characters) for social sharing of this page.\n\nTitle: ${title.trim()}\n\nContent excerpt:\n${pageText}`,
							system_instruction:
								"You are a social media optimization expert. Write a single OG description that encourages clicks and shares. Output ONLY the description text, no quotes or labels. Keep it under 200 characters.",
							json_mode: false,
							temperature: 0.3,
							max_tokens: 200,
						},
						(content) => content.trim().replace(/^["']|["']$/g, ""),
					);

					const ogDescTag = ogDescription
						? `\n<meta property="og:description" content="${escapeHtml(ogDescription)}">`
						: "";
					html = html.replace(
						"</head>",
						`<meta property="og:title" content="${escapeHtml(title.trim())}">\n<meta property="og:type" content="website">${ogDescTag}\n</head>`,
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
	deps?: { chatLLM?: (req: LLMRequest) => Promise<LLMResponse> },
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	const htmlFiles = await getHtmlFiles(input);
	const modified: string[] = [];

	try {
		for (const htmlFile of htmlFiles) {
			let html = await input.readFile(htmlFile);

			if (!/<script\s+type=["']application\/ld\+json["']/i.test(html)) {
				const pageTitle = extractTitle(html) || "Page";
				const metaDesc =
					(html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) || [])[1] ||
					"";

				const pageText = extractVisibleText(html).slice(0, 1500);
				// Check for existing JSON-LD in other script tags (partial matches)
				const existingLdMatches = html.match(
					/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
				);
				const existingLd = existingLdMatches ? existingLdMatches.join("\n") : "None";

				const { result: jsonLdStr } = await safeLLMCall(
					deps?.chatLLM,
					{
						prompt: `Generate a rich JSON-LD (schema.org) structured data object for this web page.\n\nTitle: ${pageTitle}\nMeta description: ${metaDesc}\nExisting JSON-LD: ${existingLd}\n\nContent excerpt:\n${pageText}`,
						system_instruction:
							"You are a structured data expert. Generate a single JSON-LD object using schema.org vocabulary. Choose the most appropriate @type (WebPage, Product, Article, Organization, etc.) based on the content. Include as many relevant properties as the content supports (name, description, url, image, author, datePublished, etc.). Output ONLY valid JSON, no markdown fences or explanation.",
						json_mode: true,
						temperature: 0.3,
						max_tokens: 800,
					},
					(content) => {
						// Validate it's parseable JSON with @context
						const parsed = JSON.parse(content.trim());
						if (!parsed["@context"]) {
							parsed["@context"] = "https://schema.org";
						}
						return JSON.stringify(parsed);
					},
				);

				html = html.replace(
					"</head>",
					`<script type="application/ld+json">${jsonLdStr}</script>\n</head>`,
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
	deps?: { chatLLM?: (req: LLMRequest) => Promise<LLMResponse> },
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	try {
		// Gather summaries from available HTML pages
		const htmlFiles = await getHtmlFiles(input);
		const pageSummaries: string[] = [];

		for (const htmlFile of htmlFiles.slice(0, 5)) {
			try {
				const html = await input.readFile(htmlFile);
				const title = extractTitle(html) || htmlFile;
				const text = extractVisibleText(html).slice(0, 300);
				pageSummaries.push(`- ${htmlFile}: "${title}" — ${text}`);
			} catch {
				pageSummaries.push(`- ${htmlFile}: (could not read)`);
			}
		}

		const { result: content } = await safeLLMCall(
			deps?.chatLLM,
			{
				prompt: `Generate an llms.txt file for a website with these pages:\n\n${pageSummaries.join("\n")}\n\nTotal pages: ${htmlFiles.length}`,
				system_instruction:
					"You are a GEO (Generative Engine Optimization) expert. Generate an llms.txt file that helps LLMs understand this site. Use markdown format with: a top-level heading with the site name, a brief description, then sections for key content areas, important pages, and any structured data available. Be specific to the actual site content — do not use generic boilerplate. Output ONLY the llms.txt content.",
				json_mode: false,
				temperature: 0.3,
				max_tokens: 500,
			},
			(c) => c.trim(),
		);

		await input.writeFile("llms.txt", content);
		return { success: true, files_modified: ["llms.txt"] };
	} catch (err) {
		return { success: false, files_modified: [], error: (err as Error).message };
	}
}

async function optimizeSemanticStructure(
	task: OptimizationTask,
	input: OptimizationInput,
	deps?: { chatLLM?: (req: LLMRequest) => Promise<LLMResponse> },
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

				const pageText = extractVisibleText(html).slice(0, 1000);
				const { result: heading } = await safeLLMCall(
					deps?.chatLLM,
					{
						prompt: `Suggest a clear, descriptive H1 heading for this web page.\n\nCurrent title tag: ${title}\n\nContent excerpt:\n${pageText}`,
						system_instruction:
							"You are a web content expert. Write a single H1 heading that is clear, descriptive, and optimized for both users and LLM engines. It should accurately represent the page content. Output ONLY the heading text — no HTML tags, no quotes, no explanation. Keep it under 80 characters.",
						json_mode: false,
						temperature: 0.3,
						max_tokens: 100,
					},
					(content) => {
						const trimmed = content.trim().replace(/^["'#]+|["']+$/g, "");
						return trimmed || title;
					},
				);

				html = html.replace(/<body[^>]*>/i, (match) => `${match}\n<h1>${escapeHtml(heading)}</h1>`);
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

// ── CONTENT_DENSITY: 콘텐츠 보강 (LLM 기반 또는 구조적 개선) ──

async function optimizeContentDensity(
	task: OptimizationTask,
	input: OptimizationInput,
	deps?: { chatLLM?: (req: LLMRequest) => Promise<LLMResponse> },
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	const htmlFiles = await getHtmlFiles(input);
	const modified: string[] = [];

	try {
		for (const htmlFile of htmlFiles) {
			let html = await input.readFile(htmlFile);
			const text = extractVisibleText(html);
			const wordCount = text.split(/\s+/).filter(Boolean).length;

			// 콘텐츠가 300단어 미만이면 보강 필요
			if (wordCount >= 300) continue;

			const title = extractTitle(html);
			const { result } = await safeLLMCall(
				deps?.chatLLM,
				{
					prompt: `This web page has thin content (${wordCount} words). Title: "${title}"\nContent: "${text.slice(0, 1500)}"\n\nWrite 2-3 additional paragraphs of factual, informative content that would help this page be better understood by LLMs. Write in the same language as the existing content. Output only the HTML paragraphs (wrapped in <section> tags).`,
					system_instruction:
						"You are a GEO content specialist. Generate factual, relevant content to improve page density for LLM consumption. Never fabricate data. Use semantic HTML.",
					json_mode: false,
					temperature: 0.4,
					max_tokens: 1000,
				},
				(content) => content.trim(),
			);
			if (result) {
				html = html.replace("</body>", `\n${result}\n</body>`);
				await input.writeFile(htmlFile, html);
				modified.push(htmlFile);
			}
		}
		return { success: modified.length > 0, files_modified: modified };
	} catch (err) {
		return { success: false, files_modified: [], error: (err as Error).message };
	}
}

// ── FAQ_ADDITION: FAQ 스키마 + 콘텐츠 추가 ──────────────────

async function optimizeFaqAddition(
	task: OptimizationTask,
	input: OptimizationInput,
	deps?: { chatLLM?: (req: LLMRequest) => Promise<LLMResponse> },
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	const htmlFiles = await getHtmlFiles(input);
	const modified: string[] = [];

	try {
		for (const htmlFile of htmlFiles) {
			let html = await input.readFile(htmlFile);

			// 이미 FAQ 스키마가 있으면 skip
			if (/FAQPage/i.test(html)) continue;

			const title = extractTitle(html);
			const text = extractVisibleText(html).slice(0, 2000);
			const { result } = await safeLLMCall(
				deps?.chatLLM,
				{
					prompt: `Based on this page content, generate a FAQ section with 3-5 questions and answers.\nTitle: "${title}"\nContent: "${text}"\n\nOutput JSON: { "faqs": [{ "question": "...", "answer": "..." }] }`,
					system_instruction:
						"Generate factual FAQ items based on the page content. Never invent information not present in the content.",
					json_mode: true,
					temperature: 0.3,
					max_tokens: 1500,
				},
				(content) => {
					const parsed = JSON.parse(content);
					return parsed.faqs as Array<{ question: string; answer: string }>;
				},
			);

			if (result.length > 0) {
				// FAQ HTML section
				const faqHtml = `<section class="faq" itemscope itemtype="https://schema.org/FAQPage">\n<h2>자주 묻는 질문</h2>\n${result.map((f) => `<div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">\n<h3 itemprop="name">${escapeHtml(f.question)}</h3>\n<div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer"><p itemprop="text">${escapeHtml(f.answer)}</p></div>\n</div>`).join("\n")}\n</section>`;

				// FAQ JSON-LD
				const faqJsonLd = {
					"@context": "https://schema.org",
					"@type": "FAQPage",
					mainEntity: result.map((f) => ({
						"@type": "Question",
						name: f.question,
						acceptedAnswer: { "@type": "Answer", text: f.answer },
					})),
				};

				html = html.replace(
					"</body>",
					`${faqHtml}\n<script type="application/ld+json">${JSON.stringify(faqJsonLd)}</script>\n</body>`,
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

// ── AUTHORITY_SIGNAL: 권위 신호 강화 (sameAs, dateModified 등) ──

async function optimizeAuthoritySignal(
	_task: OptimizationTask,
	input: OptimizationInput,
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	const htmlFiles = await getHtmlFiles(input);
	const modified: string[] = [];

	try {
		for (const htmlFile of htmlFiles) {
			let html = await input.readFile(htmlFile);
			let fileModified = false;

			// dateModified 메타태그 추가
			if (!/<meta\s+[^>]*dateModified/i.test(html) && !/"dateModified"/i.test(html)) {
				const now = new Date().toISOString().split("T")[0];
				html = html.replace(
					"</head>",
					`<meta name="article:modified_time" content="${now}">\n</head>`,
				);
				fileModified = true;
			}

			// canonical URL이 없으면 추가 (실제 target 도메인 사용)
			if (!/<link\s+rel=["']canonical["']/i.test(html)) {
				let canonicalBase = "https://example.com";
				if (input.target_url) {
					try {
						canonicalBase = new URL(input.target_url).origin;
					} catch {
						/* keep default */
					}
				}
				const titleForSlug = extractTitle(html).toLowerCase().replace(/\s+/g, "-").slice(0, 50);
				html = html.replace(
					"</head>",
					`<link rel="canonical" href="${canonicalBase}/${titleForSlug}">\n</head>`,
				);
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

// ── CONTENT_CHUNKING: 콘텐츠 구조화 (섹션 분할, 앵커) ──────

async function optimizeContentChunking(
	_task: OptimizationTask,
	input: OptimizationInput,
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	const htmlFiles = await getHtmlFiles(input);
	const modified: string[] = [];

	try {
		for (const htmlFile of htmlFiles) {
			let html = await input.readFile(htmlFile);
			let fileModified = false;

			// H2 태그에 id 앵커 추가 (없으면)
			html = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, (match, attrs, content) => {
				if (/\bid=/i.test(attrs)) return match;
				const text = content.replace(/<[^>]+>/g, "").trim();
				const id = text
					.toLowerCase()
					.replace(/[^a-z0-9가-힣]+/g, "-")
					.replace(/^-|-$/g, "")
					.slice(0, 40);
				if (!id) return match;
				fileModified = true;
				return `<h2${attrs} id="${id}">${content}</h2>`;
			});

			// article 태그가 없으면 본문을 article로 감싸기
			if (!/<article[\s>]/i.test(html) && /<main[\s>]/i.test(html)) {
				html = html.replace(/<main([^>]*)>/i, "<main$1>\n<article>");
				html = html.replace(/<\/main>/i, "</article>\n</main>");
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

// ── READABILITY_FIX: 가독성 개선 ────────────────────────────

async function optimizeReadabilityFix(
	_task: OptimizationTask,
	input: OptimizationInput,
	deps?: { chatLLM?: (req: LLMRequest) => Promise<LLMResponse> },
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	const htmlFiles = await getHtmlFiles(input);
	const modified: string[] = [];

	try {
		for (const htmlFile of htmlFiles) {
			let html = await input.readFile(htmlFile);
			let fileModified = false;

			// lang 속성 추가
			if (/<html(?![^>]*\blang\b)/i.test(html)) {
				html = html.replace(/<html/i, '<html lang="ko"');
				fileModified = true;
			}

			// alt 속성이 빈 img 태그에 placeholder 추가
			html = html.replace(/<img([^>]*)\balt=["']["']/gi, (match, attrs) => {
				const src = (attrs.match(/src=["']([^"']*)["']/i) || [])[1] || "";
				const filename = src.split("/").pop()?.split(".")[0] || "image";
				fileModified = true;
				return `<img${attrs}alt="${escapeHtml(filename)}"`;
			});

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

// ── EXTERNAL: 외부 변경 알림 (수정 불가, 리포트만) ───────────

async function optimizeExternal(
	_task: OptimizationTask,
	_input: OptimizationInput,
): Promise<{ success: boolean; files_modified: string[]; error?: string }> {
	// EXTERNAL 타입은 시스템 외부에서 발생한 변경을 기록하는 용도
	// 최적화 대상이 아니므로 skip (성공으로 처리하되 파일 변경 없음)
	return { success: true, files_modified: [] };
}

// ── Task type → optimizer mapping ────────────────────────────

const OPTIMIZERS: Record<string, TaskOptimizer> = {
	METADATA: optimizeMetadata,
	SCHEMA_MARKUP: optimizeSchemaMarkup,
	LLMS_TXT: optimizeLlmsTxt,
	SEMANTIC_STRUCTURE: optimizeSemanticStructure,
	CONTENT_DENSITY: optimizeContentDensity,
	FAQ_ADDITION: optimizeFaqAddition,
	AUTHORITY_SIGNAL: optimizeAuthoritySignal,
	CONTENT_CHUNKING: optimizeContentChunking,
	READABILITY_FIX: optimizeReadabilityFix,
	EXTERNAL: optimizeExternal,
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
