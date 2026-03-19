import type { CrawlData } from "./dual-crawl.js";
/**
 * GEO Scorer Skill — 7차원 GEO 평가 점수 산출
 *
 * S1: LLM 크롤링 접근성 (15%)
 * S2: 구조화 데이터 (25%)
 * S3: 콘텐츠 기계가독성 (20%)
 * S4: 팩트 밀도 (10%)
 * S5: 브랜드/조직 메시지 (10%)
 * S6: AI 인프라 (10%)
 * S7: 콘텐츠 네비게이션 (10%)
 */
import type { Skill, SkillExecutionContext, SkillResult } from "./index.js";

// ── Score Types ─────────────────────────────────────────────

export interface DimensionScore {
	id: string;
	label: string;
	score: number;
	weight: number;
	details: string[];
}

export interface GeoScoreData {
	overall_score: number;
	grade: string;
	dimensions: DimensionScore[];
	weighted_scores: Record<string, number>;
}

// ── Scoring Functions (per dimension) ───────────────────────

function scoreS1Crawlability(data: CrawlData): DimensionScore {
	let score = 0;
	const details: string[] = [];

	// robots.txt exists and allows bots
	if (data.robots_txt) {
		score += 20;
		details.push("robots.txt found");
		if (!data.robots_txt.includes("Disallow: /")) {
			score += 10;
			details.push("No blanket disallow");
		}
		// Check explicit AI bot permissions (bonus for named allowance)
		const aiBots = [
			"GPTBot",
			"ClaudeBot",
			"Google-Extended",
			"PerplexityBot",
			"Applebot",
			"OAI-SearchBot",
		];
		let namedAllowed = 0;
		let namedBlocked = 0;
		for (const bot of aiBots) {
			const botRegex = new RegExp(`User-agent:\\s*${bot}[\\s\\S]*?(?=User-agent:|$)`, "i");
			const section = data.robots_txt.match(botRegex);
			if (section) {
				if (/Disallow:\s*\/\s*$/m.test(section[0])) {
					namedBlocked++;
				} else {
					namedAllowed++;
				}
			}
		}
		if (namedAllowed >= 3) {
			score += 15;
			details.push(`${namedAllowed} AI bots explicitly allowed (+15 bonus)`);
		} else if (namedAllowed >= 1) {
			score += 8;
			details.push(`${namedAllowed} AI bots explicitly allowed`);
		}
		// Penalty: named blocks
		if (namedBlocked > 0) {
			const penalty = namedBlocked * 5;
			score -= penalty;
			details.push(`${namedBlocked} AI bots explicitly blocked (-${penalty} penalty)`);
		}
		// Penalty: ClaudeBot/Applebot 미명시 (글로벌 브랜드에 중요)
		if (!data.robots_txt.match(/ClaudeBot/i)) {
			score -= 5;
			details.push("ClaudeBot not mentioned (-5 penalty)");
		}
		if (!data.robots_txt.match(/Applebot/i)) {
			score -= 5;
			details.push("Applebot not mentioned (-5 penalty)");
		}
	} else {
		details.push("No robots.txt found");
	}

	// llms.txt
	if (data.llms_txt) {
		score += 20;
		details.push("llms.txt found");
	}

	// Response time
	if (data.response_time_ms < 1000) {
		score += 15;
		details.push(`Fast response (${data.response_time_ms}ms)`);
	} else if (data.response_time_ms < 3000) {
		score += 8;
		details.push(`Moderate response (${data.response_time_ms}ms)`);
	} else {
		details.push(`Slow response (${data.response_time_ms}ms)`);
	}

	// Canonical URL
	if (data.canonical_url) {
		score += 10;
		details.push("Canonical URL set");
	}

	// Sitemap
	if (data.sitemap_xml) {
		score += 10;
		details.push("sitemap.xml found");
	} else {
		score -= 5;
		details.push("No sitemap.xml (-5 penalty)");
	}

	return {
		id: "S1",
		label: "LLM 크롤링 접근성",
		score: Math.min(100, score),
		weight: 0.15,
		details,
	};
}

function scoreS2StructuredData(data: CrawlData): DimensionScore {
	let score = 0;
	const details: string[] = [];

	// JSON-LD presence
	if (data.json_ld.length > 0) {
		score += 30;
		details.push(`${data.json_ld.length} JSON-LD block(s) found`);

		// Check for common schema types
		const types = data.json_ld
			.map((ld) => (ld as Record<string, unknown>)["@type"])
			.filter(Boolean);
		if (types.length > 0) {
			score += 15;
			details.push(`Schema types: ${types.slice(0, 5).join(", ")}`);
		}

		// Check for Organization/Brand schema
		if (types.some((t) => String(t).match(/Organization|Brand|Corporation/i))) {
			score += 15;
			details.push("Organization/Brand schema found");
		}

		// Check for Product schema
		if (types.some((t) => String(t).match(/Product|Offer|AggregateRating/i))) {
			score += 15;
			details.push("Product/Offer schema found");
		}
	} else {
		details.push("No JSON-LD structured data found");
	}

	// Open Graph tags
	const ogTags = Object.keys(data.meta_tags).filter((k) => k.startsWith("og:"));
	if (ogTags.length > 0) {
		score += 10;
		details.push(`${ogTags.length} Open Graph tag(s)`);
	}

	// Twitter/X cards
	const twitterTags = Object.keys(data.meta_tags).filter((k) => k.startsWith("twitter:"));
	if (twitterTags.length > 0) {
		score += 5;
		details.push(`${twitterTags.length} Twitter card tag(s)`);
	}

	// Description meta
	if (data.meta_tags.description) {
		score += 10;
		details.push("Meta description present");
	}

	// Bonus: advanced schema types
	if (data.json_ld.length > 0) {
		const allTypes = data.json_ld.map((ld) => JSON.stringify(ld)).join(" ");
		if (/BreadcrumbList/i.test(allTypes)) {
			score += 5;
			details.push("BreadcrumbList (+5 bonus)");
		}
		if (/VideoObject/i.test(allTypes)) {
			score += 5;
			details.push("VideoObject (+5 bonus)");
		}
		if (/SpeakableSpecification/i.test(allTypes)) {
			score += 5;
			details.push("SpeakableSpecification (+5 bonus)");
		}
		if (/dateModified/i.test(allTypes)) {
			score += 3;
			details.push("dateModified present (+3 bonus)");
		}
		if (/FAQPage/i.test(allTypes)) {
			score += 3;
			details.push("FAQPage schema (+3 bonus)");
		}
		// Penalty: non-standard custom objects replacing schema
		if (
			/digitalData/i.test(data.html) &&
			!data.json_ld.some((ld) => String((ld as Record<string, unknown>)["@type"]).match(/Product/i))
		) {
			score -= 10;
			details.push("digitalData replaces standard Product schema (-10 penalty)");
		}
	}

	return {
		id: "S2",
		label: "구조화 데이터",
		score: Math.max(0, Math.min(100, score)),
		weight: 0.25,
		details,
	};
}

function scoreS3ContentReadability(data: CrawlData): DimensionScore {
	let score = 0;
	const details: string[] = [];
	const html = data.html;

	// Heading hierarchy
	const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
	const h2Count = (html.match(/<h2[\s>]/gi) || []).length;
	if (h1Count === 1) {
		score += 20;
		details.push("Single H1 tag (correct)");
	} else if (h1Count > 1) {
		score += 5;
		details.push(`${h1Count} H1 tags (should be 1)`);
	} else {
		details.push("No H1 tag found");
	}

	if (h2Count > 0) {
		score += 15;
		details.push(`${h2Count} H2 tag(s) for structure`);
	}

	// Lists (ul/ol)
	const listCount = (html.match(/<(?:ul|ol)[\s>]/gi) || []).length;
	if (listCount > 0) {
		score += 10;
		details.push(`${listCount} list(s) for scannable content`);
	}

	// Tables
	const tableCount = (html.match(/<table[\s>]/gi) || []).length;
	if (tableCount > 0) {
		score += 10;
		details.push(`${tableCount} table(s) for data presentation`);
	}

	// Semantic HTML
	const semanticTags = ["article", "section", "main", "nav", "aside", "header", "footer"];
	const semanticCount = semanticTags.filter((tag) =>
		new RegExp(`<${tag}[\\s>]`, "i").test(html),
	).length;
	if (semanticCount >= 3) {
		score += 20;
		details.push(`${semanticCount} semantic HTML5 elements`);
	} else if (semanticCount > 0) {
		score += 10;
		details.push(`${semanticCount} semantic HTML5 elements (limited)`);
	}

	// Alt text on images
	const imgCount = (html.match(/<img[\s>]/gi) || []).length;
	const imgAltCount = (html.match(/<img[^>]+alt=["'][^"']+["']/gi) || []).length;
	if (imgCount > 0) {
		const altRatio = imgAltCount / imgCount;
		if (altRatio > 0.8) {
			score += 15;
			details.push(`Good alt text coverage (${imgAltCount}/${imgCount})`);
		} else if (altRatio > 0.5) {
			score += 8;
			details.push(`Partial alt text (${imgAltCount}/${imgCount})`);
		} else {
			details.push(`Low alt text (${imgAltCount}/${imgCount})`);
		}
	}

	// Content length
	const textContent = html
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const wordCount = textContent.split(/\s+/).length;
	if (wordCount > 500) {
		score += 10;
		details.push(`Substantial content (${wordCount} words)`);
	} else if (wordCount > 200) {
		score += 5;
		details.push(`Moderate content (${wordCount} words)`);
	}

	return {
		id: "S3",
		label: "콘텐츠 기계가독성",
		score: Math.min(100, score),
		weight: 0.2,
		details,
	};
}

function scoreS4FactDensity(data: CrawlData): DimensionScore {
	let score = 0;
	const details: string[] = [];
	const html = data.html;

	// Numbers / statistics in content
	const numberCount = (html.replace(/<[^>]+>/g, "").match(/\d+[\.,]?\d*/g) || []).length;
	if (numberCount > 20) {
		score += 30;
		details.push(`High fact density (${numberCount} numbers)`);
	} else if (numberCount > 5) {
		score += 15;
		details.push(`Moderate fact density (${numberCount} numbers)`);
	} else {
		details.push(`Low fact density (${numberCount} numbers)`);
	}

	// Spec tables (common in manufacturer sites)
	const specTableLikely =
		/<(?:table|dl)[^>]*>[\s\S]*?(?:spec|feature|dimension|weight|size|capacity)/i.test(html);
	if (specTableLikely) {
		score += 25;
		details.push("Specification table detected");
	}

	// Units (kg, mm, GB, etc.)
	const unitCount = (
		html
			.replace(/<[^>]+>/g, "")
			.match(/\d+\s*(?:kg|g|mm|cm|m|GB|TB|MB|GHz|MHz|mAh|px|dpi|W|V|A)/gi) || []
	).length;
	if (unitCount > 5) {
		score += 25;
		details.push(`${unitCount} measurement values with units`);
	} else if (unitCount > 0) {
		score += 10;
		details.push(`${unitCount} measurement value(s)`);
	}

	// Price information
	const pricePattern = /\$[\d,]+(?:\.\d{2})?|₩[\d,]+|€[\d,]+|£[\d,]+/g;
	const prices = html.replace(/<[^>]+>/g, "").match(pricePattern) || [];
	if (prices.length > 0) {
		score += 20;
		details.push(`${prices.length} price reference(s) found`);
	}

	return { id: "S4", label: "팩트 밀도", score: Math.min(100, score), weight: 0.1, details };
}

function scoreS5BrandMessage(data: CrawlData): DimensionScore {
	let score = 0;
	const details: string[] = [];

	// Brand in title
	if (data.title && data.meta_tags["og:site_name"]) {
		score += 20;
		details.push("Brand in OG site_name");
	}

	// Brand-related JSON-LD
	const hasBrandSchema = data.json_ld.some((ld) => {
		const type = String((ld as Record<string, unknown>)["@type"] || "");
		return /Organization|Brand|Corporation|LocalBusiness/i.test(type);
	});
	if (hasBrandSchema) {
		score += 30;
		details.push("Brand/Organization schema present");
	}

	// Contact information
	const hasContact = /(?:email|phone|tel|contact|address)/i.test(data.html.replace(/<[^>]+>/g, ""));
	if (hasContact) {
		score += 15;
		details.push("Contact information found");
	}

	// Social links
	const socialPatterns = /(?:facebook|twitter|linkedin|instagram|youtube|github)\.com/gi;
	const socialLinks = (data.html.match(socialPatterns) || []).length;
	if (socialLinks > 0) {
		score += 15;
		details.push(`${socialLinks} social link(s)`);
	}

	// About/Company page link
	const aboutLink = /href=["'][^"']*(?:about|company|corporate|who-we-are)/i.test(data.html);
	if (aboutLink) {
		score += 10;
		details.push("About/Company page link found");
	}

	// Privacy policy / Terms
	const legalLinks = /href=["'][^"']*(?:privacy|terms|legal|policy)/i.test(data.html);
	if (legalLinks) {
		score += 10;
		details.push("Legal/Privacy links found");
	}

	return {
		id: "S5",
		label: "브랜드/조직 메시지",
		score: Math.min(100, score),
		weight: 0.1,
		details,
	};
}

function scoreS6AIInfrastructure(data: CrawlData): DimensionScore {
	let score = 0;
	const details: string[] = [];

	// llms.txt
	if (data.llms_txt) {
		score += 35;
		details.push("llms.txt present");
	}

	// AI-specific meta tags
	if (data.meta_tags["ai:description"] || data.meta_tags["ai:summary"]) {
		score += 20;
		details.push("AI-specific meta tags found");
	}

	// robots.txt with AI bot entries
	if (data.robots_txt) {
		const hasAiBotEntries = /GPTBot|ClaudeBot|Google-Extended|Bingbot|PerplexityBot/i.test(
			data.robots_txt,
		);
		if (hasAiBotEntries) {
			score += 20;
			details.push("AI bot entries in robots.txt");
		}
	}

	// API endpoint hints
	const hasApiHints = /\/api\/|graphql|rest|endpoint/i.test(data.html);
	if (hasApiHints) {
		score += 10;
		details.push("API endpoint references found");
	}

	// Structured content feeds
	const hasFeeds = /<link[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i.test(data.html);
	if (hasFeeds) {
		score += 15;
		details.push("RSS/Atom feed available");
	}

	return { id: "S6", label: "AI 인프라", score: Math.min(100, score), weight: 0.1, details };
}

function scoreS7ContentNavigation(data: CrawlData): DimensionScore {
	let score = 0;
	const details: string[] = [];

	// Breadcrumbs
	const hasBreadcrumb = /breadcrumb|BreadcrumbList/i.test(data.html);
	if (hasBreadcrumb) {
		score += 20;
		details.push("Breadcrumb navigation found");
	}

	// Internal links
	const internalLinks = data.links.filter((l) => {
		try {
			const linkUrl = new URL(l.href, data.url);
			return linkUrl.host === new URL(data.url).host;
		} catch {
			return l.href.startsWith("/") || l.href.startsWith("#");
		}
	});
	if (internalLinks.length > 20) {
		score += 20;
		details.push(`${internalLinks.length} internal links`);
	} else if (internalLinks.length > 5) {
		score += 10;
		details.push(`${internalLinks.length} internal links`);
	}

	// Navigation element
	const hasNav = /<nav[\s>]/i.test(data.html);
	if (hasNav) {
		score += 15;
		details.push("Nav element present");
	}

	// Table of contents / anchor links
	const anchorLinks = data.links.filter((l) => l.href.startsWith("#")).length;
	if (anchorLinks > 2) {
		score += 15;
		details.push(`${anchorLinks} anchor links (table of contents)`);
	}

	// Sitemap
	if (data.sitemap_xml) {
		score += 15;
		details.push("XML Sitemap available");
	}

	// Pagination
	const hasPagination = /rel=["'](?:next|prev)["']/i.test(data.html);
	if (hasPagination) {
		score += 10;
		details.push("Pagination links found");
	}

	// Language/locale
	const hasLang = /<html[^>]*lang=["'][^"']+["']/i.test(data.html);
	if (hasLang) {
		score += 5;
		details.push("HTML lang attribute set");
	}

	return {
		id: "S7",
		label: "콘텐츠 네비게이션",
		score: Math.min(100, score),
		weight: 0.1,
		details,
	};
}

// ── Grade calculation ───────────────────────────────────────

function calculateGrade(score: number): string {
	if (score >= 90) return "Excellent";
	if (score >= 75) return "Good";
	if (score >= 55) return "Needs Improvement";
	if (score >= 35) return "Poor";
	return "Critical";
}

// ── Main scoring function ───────────────────────────────────

export function scoreTarget(data: CrawlData): GeoScoreData {
	const dimensions = [
		scoreS1Crawlability(data),
		scoreS2StructuredData(data),
		scoreS3ContentReadability(data),
		scoreS4FactDensity(data),
		scoreS5BrandMessage(data),
		scoreS6AIInfrastructure(data),
		scoreS7ContentNavigation(data),
	];

	const weightedScores: Record<string, number> = {};
	let overallScore = 0;

	for (const dim of dimensions) {
		const weighted = dim.score * dim.weight;
		weightedScores[dim.id] = weighted;
		overallScore += weighted;
	}

	return {
		overall_score: Math.round(overallScore * 10) / 10,
		grade: calculateGrade(overallScore),
		dimensions,
		weighted_scores: weightedScores,
	};
}

// ── Skill wrapper ───────────────────────────────────────────

export const geoScorerSkill: Skill = {
	metadata: {
		name: "geo-scorer",
		version: "1.0.0",
		description: "GEO 7차원 평가 점수를 산출 (S1~S7)",
		author: "geo-agent",
		tags: ["scoring", "evaluation"],
		tier: "bundled",
	},
	async execute(
		context: SkillExecutionContext,
		params: Record<string, unknown>,
	): Promise<SkillResult> {
		const startTime = Date.now();
		try {
			const crawlData = params.crawl_data as CrawlData;
			if (!crawlData) {
				return {
					success: false,
					error: "crawl_data parameter is required (output from dual-crawl skill)",
					duration_ms: Date.now() - startTime,
				};
			}
			const scores = scoreTarget(crawlData);
			return {
				success: true,
				data: scores,
				duration_ms: Date.now() - startTime,
			};
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : String(err),
				duration_ms: Date.now() - startTime,
			};
		}
	},
};
