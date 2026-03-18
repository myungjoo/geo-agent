/**
 * Report Generator
 *
 * Before-After 비교 리포트 생성
 * - 원본 vs 수정본 변경사항 요약
 * - 각 변경사항의 GEO Impact 분석
 * - 점수 변화 추적
 */
import { z } from "zod";

// ── Report 스키마 ────────────────────────────────────────────

export const ChangeEntrySchema = z.object({
	file_path: z.string(),
	change_type: z.enum(["added", "modified", "deleted"]),
	summary: z.string(),
	impact_score: z.number().min(-100).max(100).default(0),
	affected_dimensions: z.array(z.string()).default([]),
	diff_preview: z.string().default(""),
});
export type ChangeEntry = z.infer<typeof ChangeEntrySchema>;

export const ScoreComparisonSchema = z.object({
	dimension: z.string(),
	before: z.number(),
	after: z.number(),
	delta: z.number(),
	delta_pct: z.number(),
});
export type ScoreComparison = z.infer<typeof ScoreComparisonSchema>;

export const OptimizationReportSchema = z.object({
	report_id: z.string(),
	target_id: z.string(),
	target_url: z.string(),
	site_type: z.string(),
	generated_at: z.string(),
	cycle_count: z.number(),
	overall_before: z.number(),
	overall_after: z.number(),
	overall_delta: z.number(),
	grade_before: z.string(),
	grade_after: z.string(),
	score_comparisons: z.array(ScoreComparisonSchema),
	changes: z.array(ChangeEntrySchema),
	key_improvements: z.array(z.string()),
	remaining_issues: z.array(z.string()),
});
export type OptimizationReport = z.infer<typeof OptimizationReportSchema>;

// ── Report Builder ──────────────────────────────────────────

export class ReportBuilder {
	private report: Partial<OptimizationReport>;

	constructor(reportId: string, targetId: string, targetUrl: string) {
		this.report = {
			report_id: reportId,
			target_id: targetId,
			target_url: targetUrl,
			generated_at: new Date().toISOString(),
			changes: [],
			score_comparisons: [],
			key_improvements: [],
			remaining_issues: [],
		};
	}

	setSiteType(siteType: string): this {
		this.report.site_type = siteType;
		return this;
	}

	setCycleCount(count: number): this {
		this.report.cycle_count = count;
		return this;
	}

	setOverallScores(before: number, after: number): this {
		this.report.overall_before = before;
		this.report.overall_after = after;
		this.report.overall_delta = after - before;
		return this;
	}

	setGrades(before: string, after: string): this {
		this.report.grade_before = before;
		this.report.grade_after = after;
		return this;
	}

	addScoreComparison(dimension: string, before: number, after: number): this {
		const delta = after - before;
		const delta_pct = before > 0 ? (delta / before) * 100 : 0;
		this.report.score_comparisons!.push({
			dimension,
			before,
			after,
			delta,
			delta_pct: Math.round(delta_pct * 100) / 100,
		});
		return this;
	}

	addChange(entry: ChangeEntry): this {
		this.report.changes!.push(entry);
		return this;
	}

	addKeyImprovement(improvement: string): this {
		this.report.key_improvements!.push(improvement);
		return this;
	}

	addRemainingIssue(issue: string): this {
		this.report.remaining_issues!.push(issue);
		return this;
	}

	build(): OptimizationReport {
		return OptimizationReportSchema.parse(this.report);
	}
}

// ── 간단한 Diff 렌더러 ───────────────────────────────────────

export function renderSimpleDiff(original: string, modified: string): string {
	const origLines = original.split("\n");
	const modLines = modified.split("\n");
	const result: string[] = [];
	const maxLen = Math.max(origLines.length, modLines.length);

	for (let i = 0; i < maxLen; i++) {
		const orig = origLines[i];
		const mod = modLines[i];

		if (orig === undefined) {
			result.push(`+ ${mod}`);
		} else if (mod === undefined) {
			result.push(`- ${orig}`);
		} else if (orig !== mod) {
			result.push(`- ${orig}`);
			result.push(`+ ${mod}`);
		}
	}

	return result.join("\n");
}
