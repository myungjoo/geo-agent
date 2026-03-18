import { describe, it, expect, beforeEach } from "vitest";
import {
	ReportBuilder,
	OptimizationReportSchema,
	renderSimpleDiff,
	ChangeEntrySchema,
	ScoreComparisonSchema,
} from "./report-generator.js";

// ─── ChangeEntrySchema ──────────────────────────────────────────

describe("ChangeEntrySchema", () => {
	it("validates a minimal change entry", () => {
		const entry = ChangeEntrySchema.parse({
			file_path: "index.html",
			change_type: "added",
			summary: "Added schema markup",
		});
		expect(entry.file_path).toBe("index.html");
		expect(entry.change_type).toBe("added");
		expect(entry.summary).toBe("Added schema markup");
		expect(entry.impact_score).toBe(0);
		expect(entry.affected_dimensions).toEqual([]);
		expect(entry.diff_preview).toBe("");
	});

	it("validates a fully specified change entry", () => {
		const entry = ChangeEntrySchema.parse({
			file_path: "about.html",
			change_type: "modified",
			summary: "Updated meta description",
			impact_score: 45,
			affected_dimensions: ["citation_rate", "coverage"],
			diff_preview: "- old meta\n+ new meta",
		});
		expect(entry.impact_score).toBe(45);
		expect(entry.affected_dimensions).toHaveLength(2);
		expect(entry.diff_preview).toContain("+ new meta");
	});

	it("accepts all valid change_type values", () => {
		for (const ct of ["added", "modified", "deleted"]) {
			const entry = ChangeEntrySchema.parse({
				file_path: "f.html",
				change_type: ct,
				summary: "test",
			});
			expect(entry.change_type).toBe(ct);
		}
	});

	it("rejects invalid change_type", () => {
		expect(() =>
			ChangeEntrySchema.parse({
				file_path: "f.html",
				change_type: "renamed",
				summary: "test",
			}),
		).toThrow();
	});

	it("rejects impact_score out of range", () => {
		expect(() =>
			ChangeEntrySchema.parse({
				file_path: "f.html",
				change_type: "added",
				summary: "test",
				impact_score: 101,
			}),
		).toThrow();
		expect(() =>
			ChangeEntrySchema.parse({
				file_path: "f.html",
				change_type: "added",
				summary: "test",
				impact_score: -101,
			}),
		).toThrow();
	});

	it("allows negative impact_score within range", () => {
		const entry = ChangeEntrySchema.parse({
			file_path: "f.html",
			change_type: "deleted",
			summary: "Removed important content",
			impact_score: -50,
		});
		expect(entry.impact_score).toBe(-50);
	});
});

// ─── ScoreComparisonSchema ──────────────────────────────────────

describe("ScoreComparisonSchema", () => {
	it("validates a correct score comparison", () => {
		const comp = ScoreComparisonSchema.parse({
			dimension: "citation_rate",
			before: 40,
			after: 65,
			delta: 25,
			delta_pct: 62.5,
		});
		expect(comp.dimension).toBe("citation_rate");
		expect(comp.before).toBe(40);
		expect(comp.after).toBe(65);
		expect(comp.delta).toBe(25);
		expect(comp.delta_pct).toBe(62.5);
	});

	it("rejects missing required fields", () => {
		expect(() =>
			ScoreComparisonSchema.parse({
				dimension: "citation_rate",
				before: 40,
			}),
		).toThrow();
	});

	it("allows negative delta values", () => {
		const comp = ScoreComparisonSchema.parse({
			dimension: "coverage",
			before: 80,
			after: 60,
			delta: -20,
			delta_pct: -25,
		});
		expect(comp.delta).toBe(-20);
		expect(comp.delta_pct).toBe(-25);
	});
});

// ─── ReportBuilder ──────────────────────────────────────────────

describe("ReportBuilder", () => {
	let builder: ReportBuilder;

	beforeEach(() => {
		builder = new ReportBuilder("rpt-001", "target-001", "https://example.com");
	});

	it("creates a valid report with all fields", () => {
		const report = builder
			.setSiteType("manufacturer")
			.setCycleCount(3)
			.setOverallScores(45, 78)
			.setGrades("C", "B+")
			.addScoreComparison("citation_rate", 40, 65)
			.addChange({
				file_path: "index.html",
				change_type: "modified",
				summary: "Added JSON-LD schema",
				impact_score: 30,
				affected_dimensions: ["structured_score"],
				diff_preview: "+ <script type=\"application/ld+json\">",
			})
			.addKeyImprovement("JSON-LD structured data added")
			.addRemainingIssue("Missing alt text on images")
			.build();

		expect(report.report_id).toBe("rpt-001");
		expect(report.target_id).toBe("target-001");
		expect(report.target_url).toBe("https://example.com");
		expect(report.site_type).toBe("manufacturer");
		expect(report.cycle_count).toBe(3);
		expect(report.overall_before).toBe(45);
		expect(report.overall_after).toBe(78);
		expect(report.overall_delta).toBe(33);
		expect(report.grade_before).toBe("C");
		expect(report.grade_after).toBe("B+");
		expect(report.score_comparisons).toHaveLength(1);
		expect(report.changes).toHaveLength(1);
		expect(report.key_improvements).toHaveLength(1);
		expect(report.remaining_issues).toHaveLength(1);
		expect(report.generated_at).toBeTruthy();
	});

	it("addScoreComparison calculates delta and delta_pct", () => {
		builder
			.setSiteType("generic")
			.setCycleCount(1)
			.setOverallScores(50, 70)
			.setGrades("C", "B")
			.addScoreComparison("citation_rate", 40, 60);

		const report = builder.build();
		const comp = report.score_comparisons[0];

		expect(comp.delta).toBe(20);
		expect(comp.delta_pct).toBe(50);
	});

	it("addScoreComparison handles zero before value", () => {
		builder
			.setSiteType("research")
			.setCycleCount(1)
			.setOverallScores(0, 50)
			.setGrades("F", "C")
			.addScoreComparison("coverage", 0, 50);

		const report = builder.build();
		const comp = report.score_comparisons[0];

		expect(comp.delta).toBe(50);
		expect(comp.delta_pct).toBe(0);
	});

	it("addScoreComparison rounds delta_pct to 2 decimal places", () => {
		builder
			.setSiteType("generic")
			.setCycleCount(1)
			.setOverallScores(30, 40)
			.setGrades("D", "C")
			.addScoreComparison("info_recognition", 30, 40);

		const report = builder.build();
		const comp = report.score_comparisons[0];

		// (10 / 30) * 100 = 33.3333... -> rounded to 33.33
		expect(comp.delta_pct).toBe(33.33);
	});

	it("addChange adds change entries", () => {
		builder
			.setSiteType("manufacturer")
			.setCycleCount(1)
			.setOverallScores(50, 60)
			.setGrades("C", "B")
			.addChange({
				file_path: "page1.html",
				change_type: "added",
				summary: "New page",
				impact_score: 20,
				affected_dimensions: ["coverage"],
				diff_preview: "+ new content",
			})
			.addChange({
				file_path: "page2.html",
				change_type: "deleted",
				summary: "Removed duplicate",
				impact_score: -5,
				affected_dimensions: [],
				diff_preview: "- old content",
			});

		const report = builder.build();

		expect(report.changes).toHaveLength(2);
		expect(report.changes[0].file_path).toBe("page1.html");
		expect(report.changes[1].change_type).toBe("deleted");
	});

	it("build() validates against OptimizationReportSchema", () => {
		const report = builder
			.setSiteType("generic")
			.setCycleCount(2)
			.setOverallScores(30, 55)
			.setGrades("D", "C+")
			.build();

		const result = OptimizationReportSchema.safeParse(report);
		expect(result.success).toBe(true);
	});

	it("build() throws when required fields are missing", () => {
		// Missing site_type, cycle_count, overall scores, grades
		expect(() => builder.build()).toThrow();
	});

	it("supports method chaining", () => {
		const result = builder
			.setSiteType("manufacturer")
			.setCycleCount(1)
			.setOverallScores(10, 20)
			.setGrades("F", "D");

		expect(result).toBe(builder);
	});

	it("sets generated_at automatically", () => {
		const before = new Date().toISOString();
		const report = builder
			.setSiteType("generic")
			.setCycleCount(1)
			.setOverallScores(50, 60)
			.setGrades("C", "B")
			.build();
		const after = new Date().toISOString();

		expect(report.generated_at >= before).toBe(true);
		expect(report.generated_at <= after).toBe(true);
	});

	it("correctly computes overall_delta from setOverallScores", () => {
		const report = builder
			.setSiteType("generic")
			.setCycleCount(1)
			.setOverallScores(70, 55)
			.setGrades("B", "C+")
			.build();

		expect(report.overall_delta).toBe(-15);
	});
});

// ─── OptimizationReportSchema ───────────────────────────────────

describe("OptimizationReportSchema", () => {
	it("validates a minimal valid report", () => {
		const result = OptimizationReportSchema.safeParse({
			report_id: "rpt-test",
			target_id: "tgt-test",
			target_url: "https://test.com",
			site_type: "generic",
			generated_at: new Date().toISOString(),
			cycle_count: 1,
			overall_before: 50,
			overall_after: 60,
			overall_delta: 10,
			grade_before: "C",
			grade_after: "B",
			score_comparisons: [],
			changes: [],
			key_improvements: [],
			remaining_issues: [],
		});
		expect(result.success).toBe(true);
	});

	it("rejects report missing required fields", () => {
		const result = OptimizationReportSchema.safeParse({
			report_id: "rpt-test",
		});
		expect(result.success).toBe(false);
	});
});

// ─── renderSimpleDiff ───────────────────────────────────────────

describe("renderSimpleDiff", () => {
	it("returns empty string for identical content", () => {
		const diff = renderSimpleDiff("hello\nworld", "hello\nworld");
		expect(diff).toBe("");
	});

	it("shows added lines", () => {
		const diff = renderSimpleDiff("line1", "line1\nline2\nline3");
		expect(diff).toContain("+ line2");
		expect(diff).toContain("+ line3");
		expect(diff).not.toContain("- ");
	});

	it("shows removed lines", () => {
		const diff = renderSimpleDiff("line1\nline2\nline3", "line1");
		expect(diff).toContain("- line2");
		expect(diff).toContain("- line3");
		expect(diff).not.toContain("+ ");
	});

	it("shows changed lines with both - and +", () => {
		const diff = renderSimpleDiff("old text", "new text");
		const lines = diff.split("\n");
		expect(lines[0]).toBe("- old text");
		expect(lines[1]).toBe("+ new text");
	});

	it("handles mixed changes correctly", () => {
		const original = "keep\nremove\nchange";
		const modified = "keep\nnew\nchanged";
		const diff = renderSimpleDiff(original, modified);
		const lines = diff.split("\n");

		// "keep" is the same, so not in output
		// "remove" -> "new" is a change
		expect(lines).toContain("- remove");
		expect(lines).toContain("+ new");
		// "change" -> "changed" is a change
		expect(lines).toContain("- change");
		expect(lines).toContain("+ changed");
	});

	it("handles empty strings", () => {
		const diff = renderSimpleDiff("", "");
		expect(diff).toBe("");
	});

	it("handles original empty, modified has content", () => {
		const diff = renderSimpleDiff("", "added line");
		// "" splits into [""], "added line" splits into ["added line"]
		// First line: "" vs "added line" -> changed
		expect(diff).toContain("+ added line");
	});
});
