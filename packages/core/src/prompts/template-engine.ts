/**
 * Evaluation Template Engine
 *
 * 사이트 유형별 평가 프롬프트 로딩, 파라미터 치환, 사이트 자동 분류
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type SiteType,
	SiteTypeSchema,
	CLASSIFICATION_SIGNALS,
	TEMPLATE_REGISTRY,
	type EvaluationTemplate,
	getTemplate,
	type ClassificationSignal,
} from "./evaluation-templates/index.js";

// ── Template Parameters ────────────────────────────────────────

export interface TemplateParams {
	site_name: string;
	base_url: string;
	site_type: SiteType;
	target_queries?: string[];
	competitors?: string[];
	[key: string]: unknown;
}

// ── Template Engine ────────────────────────────────────────────

export class TemplateEngine {
	private templatesDir: string;

	constructor(corePackagePath?: string) {
		// evaluation-templates 디렉토리는 core 패키지 내에 위치
		this.templatesDir = corePackagePath
			? path.join(corePackagePath, "src", "prompts", "evaluation-templates")
			: path.join(path.dirname(fileURLToPath(import.meta.url)), "evaluation-templates");
	}

	/** 사이트 유형에 해당하는 템플릿 로드 */
	loadTemplate(siteType: SiteType): string {
		const template = getTemplate(siteType);
		const templatePath = path.join(this.templatesDir, `${siteType}.md`);

		if (!fs.existsSync(templatePath)) {
			throw new Error(`Template file not found: ${templatePath}`);
		}

		return fs.readFileSync(templatePath, "utf-8");
	}

	/** 템플릿에 파라미터 치환 */
	render(siteType: SiteType, params: TemplateParams): string {
		let content = this.loadTemplate(siteType);

		// {{variable}} 형태의 파라미터 치환
		for (const [key, value] of Object.entries(params)) {
			const placeholder = `{{${key}}}`;
			const replacement = Array.isArray(value)
				? value.join(", ")
				: String(value ?? "");
			content = content.replaceAll(placeholder, replacement);
		}

		return content;
	}

	/** 등록된 모든 템플릿 정보 반환 */
	listTemplates(): EvaluationTemplate[] {
		return [...TEMPLATE_REGISTRY];
	}

	/** 특정 유형의 템플릿 정보 반환 */
	getTemplateInfo(siteType: SiteType): EvaluationTemplate {
		return getTemplate(siteType);
	}
}

// ── Site Classifier ────────────────────────────────────────────

export interface ClassificationResult {
	site_type: SiteType;
	confidence: number;
	matched_signals: string[];
	all_signals: ClassificationSignal[];
}

/**
 * HTML 콘텐츠와 URL을 분석하여 사이트 유형을 자동 분류한다.
 */
export function classifySite(htmlContent: string, url: string): ClassificationResult {
	const signals: ClassificationSignal[] = [];
	const lowerHtml = htmlContent.toLowerCase();
	const lowerUrl = url.toLowerCase();

	// Manufacturer 시그널 검사
	const mfgMatches: string[] = [];
	if (lowerHtml.includes('"@type":"product"') || lowerHtml.includes('"@type": "product"')) {
		mfgMatches.push("Product JSON-LD 스키마 존재");
	}
	if (lowerHtml.includes('"@type":"offer"') || lowerHtml.includes("aggregaterating")) {
		mfgMatches.push("Offer/AggregateRating 스키마 존재");
	}
	if (/\/(products?|shop|buy|store)\//i.test(lowerUrl) || /\/(products?|shop|buy|store)\//i.test(lowerHtml)) {
		mfgMatches.push("/products/, /shop/, /buy/ 경로 존재");
	}
	if (lowerHtml.includes("og:product:price") || lowerHtml.includes("product:price")) {
		mfgMatches.push("E-commerce 관련 메타태그");
	}
	if (/\$[\d,]+\.?\d*|₩[\d,]+|price/i.test(lowerHtml)) {
		mfgMatches.push("가격 정보가 HTML에 포함");
	}

	const mfgConfidence = Math.min(mfgMatches.length / 4, 1);
	signals.push({
		site_type: "manufacturer",
		confidence: mfgConfidence,
		signals: mfgMatches,
	});

	// Research 시그널 검사
	const resMatches: string[] = [];
	if (lowerHtml.includes("scholarlyarticle") || lowerHtml.includes("techarticle")) {
		resMatches.push("ScholarlyArticle/TechArticle 스키마 존재");
	}
	if (/\/(publications?|papers?|research)\//i.test(lowerUrl) || /\/(publications?|papers?|research)\//i.test(lowerHtml)) {
		resMatches.push("/publications/, /papers/, /research/ 경로 존재");
	}
	if (lowerHtml.includes("doi.org") || lowerHtml.includes("doi:")) {
		resMatches.push("DOI 링크 존재");
	}
	if (lowerHtml.includes("orcid") || lowerHtml.includes("affiliation")) {
		resMatches.push("연구자 Person 스키마");
	}
	if (lowerHtml.includes("citation_") || lowerHtml.includes("dc.")) {
		resMatches.push("학술 메타태그 (citation_*, DC.*)");
	}
	if (lowerHtml.includes(".pdf") && (lowerHtml.includes("download") || lowerHtml.includes("paper"))) {
		resMatches.push("PDF 논문 다운로드 링크 존재");
	}

	const resConfidence = Math.min(resMatches.length / 4, 1);
	signals.push({
		site_type: "research",
		confidence: resConfidence,
		signals: resMatches,
	});

	// Generic은 나머지
	const genMatches: string[] = [];
	if (mfgConfidence < 0.3 && resConfidence < 0.3) {
		genMatches.push("위 두 유형의 시그널이 모두 약함");
	}
	if (lowerHtml.includes('"@type":"article"') || lowerHtml.includes("newsarticle")) {
		genMatches.push("Article/NewsArticle 스키마");
	}
	if (lowerHtml.includes('"@type":"service"') || lowerHtml.includes("localbusiness")) {
		genMatches.push("Service/LocalBusiness 스키마");
	}

	const genConfidence = mfgConfidence < 0.3 && resConfidence < 0.3
		? Math.max(0.5, Math.min(genMatches.length / 2, 1))
		: Math.max(0, 1 - Math.max(mfgConfidence, resConfidence));
	signals.push({
		site_type: "generic",
		confidence: genConfidence,
		signals: genMatches,
	});

	// 가장 높은 confidence를 선택
	const winner = signals.reduce((best, s) =>
		s.confidence > best.confidence ? s : best,
	);

	return {
		site_type: winner.site_type,
		confidence: winner.confidence,
		matched_signals: winner.signals,
		all_signals: signals,
	};
}
