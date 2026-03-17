import { z } from "zod";
import { GeoScoreSchema } from "./geo-score.js";
import { LLMProbeSchema } from "./llm-probe.js";
import { InfoRecognitionItemSchema } from "./info-recognition.js";

export const StructureQualitySchema = z.object({
	semantic_tag_ratio: z.number().min(0).max(1),
	div_nesting_depth: z.number().int().min(0),
	text_to_markup_ratio: z.number().min(0),
	heading_hierarchy_valid: z.boolean(),
});

export type StructureQuality = z.infer<typeof StructureQualitySchema>;

export const CrawlerAccessResultSchema = z.object({
	user_agent: z.string(),
	http_status: z.number().int(),
	blocked_by_robots_txt: z.boolean(),
	content_accessible: z.boolean(),
});

export type CrawlerAccessResult = z.infer<typeof CrawlerAccessResultSchema>;

export const MachineReadabilitySchema = z.object({
	grade: z.enum(["A", "B", "C", "F"]),
	js_dependency_ratio: z.number().min(0).max(1),
	structure_quality: StructureQualitySchema,
	crawler_access: z.array(CrawlerAccessResultSchema),
});

export type MachineReadability = z.infer<typeof MachineReadabilitySchema>;

export const ContentAnalysisSchema = z.object({
	word_count: z.number().int().min(0),
	content_density: z.number().min(0).max(100),
	readability_level: z.enum(["technical", "general", "simplified"]),
	key_topics_found: z.array(z.string()),
	topic_alignment: z.number().min(0).max(1),
});

export type ContentAnalysis = z.infer<typeof ContentAnalysisSchema>;

export const StructuredDataAuditSchema = z.object({
	json_ld_present: z.boolean(),
	json_ld_types: z.array(z.string()),
	schema_completeness: z.number().min(0).max(1),
	og_tags_present: z.boolean(),
	meta_description: z.string().nullable(),
});

export type StructuredDataAudit = z.infer<typeof StructuredDataAuditSchema>;

export const CompetitorGapSchema = z.object({
	competitor_url: z.string().url(),
	competitor_name: z.string(),
	competitor_geo_score: GeoScoreSchema.nullable(),
	gap_delta: z.number(),
	key_advantages: z.array(z.string()),
	key_weaknesses: z.array(z.string()),
});

export type CompetitorGap = z.infer<typeof CompetitorGapSchema>;

export const AnalysisReportSchema = z.object({
	report_id: z.string().uuid(),
	target_id: z.string().uuid(),
	url: z.string().url(),
	analyzed_at: z.string().datetime(),

	machine_readability: MachineReadabilitySchema,
	content_analysis: ContentAnalysisSchema,
	structured_data: StructuredDataAuditSchema,

	extracted_info_items: z.array(InfoRecognitionItemSchema),
	current_geo_score: GeoScoreSchema,
	competitor_gaps: z.array(CompetitorGapSchema),
	llm_status: z.array(LLMProbeSchema),
});

export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;
