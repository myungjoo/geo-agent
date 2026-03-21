import { describe, expect, it } from "vitest";
import { generateDashboardHtml } from "./dashboard-html-generator.js";
import { ReportBuilder } from "./report-generator.js";
// ── Helper: 기본 OptimizationReport 생성 ────────────────────────
function makeReport(overrides) {
	const builder = new ReportBuilder(
		"rpt-001",
		"tgt-001",
		overrides?.target_url ?? "https://example.com",
	);
	builder.setSiteType("manufacturer");
	builder.setCycleCount(overrides?.cycle_count ?? 1);
	builder.setOverallScores(overrides?.overall_before ?? 45.0, overrides?.overall_after ?? 72.0);
	builder.setGrades(overrides?.grade_before ?? "Poor", overrides?.grade_after ?? "Good");
	builder.addScoreComparison("Citation Rate", 40, 70);
	builder.addScoreComparison("Coverage", 50, 75);
	for (const ch of overrides?.changes ?? []) {
		builder.addChange({
			file_path: ch.file_path,
			change_type: ch.change_type,
			summary: ch.summary,
			impact_score: 10,
			affected_dimensions: ch.affected_dimensions ?? [],
			diff_preview: "",
		});
	}
	for (const imp of overrides?.key_improvements ?? []) {
		builder.addKeyImprovement(imp);
	}
	for (const iss of overrides?.remaining_issues ?? []) {
		builder.addRemainingIssue(iss);
	}
	return builder.build();
}
function makeEvaluationResult(cycle, score) {
	return {
		run_id: `run-${cycle}`,
		site_name: "Example",
		base_url: "https://example.com",
		site_type: "manufacturer",
		evaluated_at: "2026-01-15T10:00:00Z",
		cycle_number: cycle,
		evaluation_target: "clone",
		overall_score: score,
		grade:
			score >= 90
				? "Excellent"
				: score >= 75
					? "Good"
					: score >= 55
						? "Needs Improvement"
						: score >= 35
							? "Poor"
							: "Critical",
		dimension_scores: { S1: 70, S2: 65 },
		probe_results: {},
		key_findings: ["Finding 1"],
		top_improvements: [],
	};
}
function makeDashboardData(overrides) {
	return {
		report: overrides?.report ?? makeReport(),
		evaluation: overrides?.evaluation,
		cycle_history: overrides?.cycle_history,
	};
}
// ── Tests ────────────────────────────────────────────────────────
describe("generateDashboardHtml", () => {
	// ── HTML structure ───────────────────────────────────────────
	it("returns valid HTML with DOCTYPE", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toMatch(/^<!DOCTYPE html>/);
	});
	it("contains opening and closing html tags", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toContain("<html");
		expect(html).toContain("</html>");
	});
	it("contains head and body sections", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toContain("<head>");
		expect(html).toContain("</head>");
		expect(html).toContain("<body>");
		expect(html).toContain("</body>");
	});
	it("contains Chart.js CDN script tag", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toContain("https://cdn.jsdelivr.net/npm/chart.js@4");
	});
	// ── Dark theme CSS ───────────────────────────────────────────
	it("contains dark theme CSS variables", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toContain("--bg:");
		expect(html).toContain("--surface:");
		expect(html).toContain("--primary:");
		expect(html).toContain("--accent:");
		expect(html).toContain("--text:");
	});
	it("sets data-theme=dark on html element", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toContain('data-theme="dark"');
	});
	// ── Tab names ────────────────────────────────────────────────
	it("contains all 9 base tab names", () => {
		const html = generateDashboardHtml(makeDashboardData());
		const tabs = [
			"Overview",
			"Score Breakdown",
			"Changes",
			"Before vs After",
			"Crawlability",
			"Structured Data",
			"Content Analysis",
			"Improvements",
			"Remaining Issues",
		];
		for (const tab of tabs) {
			expect(html).toContain(tab);
		}
	});
	// ── XSS prevention ──────────────────────────────────────────
	it("escapes HTML in target_url (XSS prevention)", () => {
		const report = makeReport({ target_url: 'https://evil.com/<script>alert("xss")</script>' });
		const html = generateDashboardHtml({ report });
		expect(html).not.toContain("<script>alert");
		expect(html).toContain("&lt;script&gt;");
	});
	it("escapes HTML in change file_path", () => {
		const report = makeReport({
			changes: [{ file_path: "<img onerror=alert(1)>", change_type: "added", summary: "test" }],
		});
		const html = generateDashboardHtml({ report });
		expect(html).not.toContain("<img onerror");
		expect(html).toContain("&lt;img onerror");
	});
	it("escapes HTML in change summary", () => {
		const report = makeReport({
			changes: [{ file_path: "index.html", change_type: "modified", summary: '<b>"injected"</b>' }],
		});
		const html = generateDashboardHtml({ report });
		expect(html).toContain("&lt;b&gt;");
		expect(html).toContain("&quot;injected&quot;");
	});
	// ── Before / After scores ────────────────────────────────────
	it("shows correct before/after scores", () => {
		const html = generateDashboardHtml(makeDashboardData());
		// before=45.0, after=72.0
		expect(html).toContain("45.0");
		expect(html).toContain("72.0");
	});
	it("shows score delta with + prefix for positive delta", () => {
		const report = makeReport({ overall_before: 40, overall_after: 65 });
		const html = generateDashboardHtml({ report });
		// delta = 25.0
		expect(html).toContain("+25.0");
	});
	it("shows score delta without + prefix for negative delta", () => {
		const report = makeReport({ overall_before: 70, overall_after: 55 });
		const html = generateDashboardHtml({ report });
		// delta = -15.0
		expect(html).toContain("-15.0");
	});
	it("shows zero delta as +0.0", () => {
		const report = makeReport({ overall_before: 60, overall_after: 60 });
		const html = generateDashboardHtml({ report });
		expect(html).toContain("+0.0");
	});
	// ── Changes list ─────────────────────────────────────────────
	it("shows changes list with file paths and summaries", () => {
		const report = makeReport({
			changes: [
				{ file_path: "index.html", change_type: "added", summary: "Added JSON-LD schema" },
				{ file_path: "about.html", change_type: "modified", summary: "Updated meta tags" },
			],
		});
		const html = generateDashboardHtml({ report });
		expect(html).toContain("index.html");
		expect(html).toContain("Added JSON-LD schema");
		expect(html).toContain("about.html");
		expect(html).toContain("Updated meta tags");
	});
	it("shows change count in Changes tab heading", () => {
		const report = makeReport({
			changes: [
				{ file_path: "a.html", change_type: "added", summary: "a" },
				{ file_path: "b.html", change_type: "modified", summary: "b" },
				{ file_path: "c.html", change_type: "deleted", summary: "c" },
			],
		});
		const html = generateDashboardHtml({ report });
		expect(html).toContain("All Changes (3)");
	});
	it("shows affected_dimensions for changes that have them", () => {
		const report = makeReport({
			changes: [
				{
					file_path: "index.html",
					change_type: "added",
					summary: "Schema markup",
					affected_dimensions: ["Citation Rate", "Coverage"],
				},
			],
		});
		const html = generateDashboardHtml({ report });
		expect(html).toContain("Affected:");
		expect(html).toContain("Citation Rate, Coverage");
	});
	// ── Key improvements and remaining issues ────────────────────
	it("shows key_improvements list", () => {
		const report = makeReport({
			key_improvements: ["Added Product JSON-LD", "Improved meta descriptions"],
		});
		const html = generateDashboardHtml({ report });
		expect(html).toContain("Added Product JSON-LD");
		expect(html).toContain("Improved meta descriptions");
	});
	it("shows remaining_issues list", () => {
		const report = makeReport({
			remaining_issues: ["Missing breadcrumb schema", "No FAQ schema"],
		});
		const html = generateDashboardHtml({ report });
		expect(html).toContain("Missing breadcrumb schema");
		expect(html).toContain("No FAQ schema");
	});
	// ── Empty arrays ─────────────────────────────────────────────
	it("works with empty changes array", () => {
		const report = makeReport({ changes: [] });
		const html = generateDashboardHtml({ report });
		expect(html).toContain("All Changes (0)");
		expect(html).toContain("</html>");
	});
	it("works with empty key_improvements array", () => {
		const report = makeReport({ key_improvements: [] });
		const html = generateDashboardHtml({ report });
		expect(html).toContain("Key Improvements");
		expect(html).toContain("</html>");
	});
	it("works with empty remaining_issues array", () => {
		const report = makeReport({ remaining_issues: [] });
		const html = generateDashboardHtml({ report });
		expect(html).toContain("Remaining Issues");
		expect(html).toContain("</html>");
	});
	// ── Cycle History tab ────────────────────────────────────────
	it("shows Cycle History tab when cycle_history is provided", () => {
		const data = makeDashboardData({
			cycle_history: [makeEvaluationResult(1, 55), makeEvaluationResult(2, 70)],
		});
		const html = generateDashboardHtml(data);
		expect(html).toContain("Cycle History");
		expect(html).toContain("cycle-chart");
		expect(html).toContain("Score Progression");
	});
	it("shows cycle details table in Cycle History tab", () => {
		const data = makeDashboardData({
			cycle_history: [makeEvaluationResult(1, 55.5), makeEvaluationResult(2, 70.2)],
		});
		const html = generateDashboardHtml(data);
		expect(html).toContain("55.5");
		expect(html).toContain("70.2");
	});
	it("does not show Cycle History tab when cycle_history is undefined", () => {
		const data = makeDashboardData({ cycle_history: undefined });
		const html = generateDashboardHtml(data);
		expect(html).not.toContain("Cycle History");
		expect(html).not.toContain("cycle-chart");
	});
	it("does not show Cycle History tab when cycle_history is empty", () => {
		const data = makeDashboardData({ cycle_history: [] });
		const html = generateDashboardHtml(data);
		expect(html).not.toContain("Cycle History");
		expect(html).not.toContain("cycle-chart");
	});
	// ── Grade class names ────────────────────────────────────────
	it("uses 'excellent' grade class", () => {
		const report = makeReport({ grade_before: "Excellent", grade_after: "Excellent" });
		const html = generateDashboardHtml({ report });
		expect(html).toContain('class="score-badge excellent"');
	});
	it("uses 'good' grade class", () => {
		const report = makeReport({ grade_before: "Good", grade_after: "Good" });
		const html = generateDashboardHtml({ report });
		expect(html).toContain('class="score-badge good"');
	});
	it("uses 'needs-improvement' grade class", () => {
		const report = makeReport({
			grade_before: "Needs Improvement",
			grade_after: "Needs Improvement",
		});
		const html = generateDashboardHtml({ report });
		expect(html).toContain('class="score-badge needs-improvement"');
	});
	it("uses 'poor' grade class", () => {
		const report = makeReport({ grade_before: "Poor", grade_after: "Poor" });
		const html = generateDashboardHtml({ report });
		expect(html).toContain('class="score-badge poor"');
	});
	it("uses 'critical' grade class", () => {
		const report = makeReport({ grade_before: "Critical", grade_after: "Critical" });
		const html = generateDashboardHtml({ report });
		expect(html).toContain('class="score-badge critical"');
	});
	// ── Score comparison table ────────────────────────────────────
	it("renders score comparison dimension names", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toContain("Citation Rate");
		expect(html).toContain("Coverage");
	});
	it("renders score comparison before/after values", () => {
		const html = generateDashboardHtml(makeDashboardData());
		// Citation Rate: before=40, after=70
		expect(html).toContain("40.0");
		expect(html).toContain("70.0");
	});
	it("renders positive delta with + prefix in score table", () => {
		const html = generateDashboardHtml(makeDashboardData());
		// Citation Rate delta = 30.0
		expect(html).toContain("+30.0");
	});
	// ── Chart.js data ────────────────────────────────────────────
	it("includes radar chart canvas", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toContain('id="radar-chart"');
	});
	it("includes bar chart canvas", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toContain('id="bar-chart"');
	});
	it("includes Chart constructor calls in script", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toContain("new Chart(");
		expect(html).toContain("type: 'radar'");
		expect(html).toContain("type: 'bar'");
	});
	it("includes cycle line chart when cycle_history exists", () => {
		const data = makeDashboardData({
			cycle_history: [makeEvaluationResult(1, 55)],
		});
		const html = generateDashboardHtml(data);
		expect(html).toContain("type: 'line'");
	});
	// ── Meta info ────────────────────────────────────────────────
	it("includes site_type in meta line", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toContain("manufacturer");
	});
	it("includes cycle_count in meta line", () => {
		const report = makeReport({ cycle_count: 5 });
		const html = generateDashboardHtml({ report });
		expect(html).toContain("5 cycles");
	});
	// ── Tab switching JS ─────────────────────────────────────────
	it("includes tab switching JavaScript", () => {
		const html = generateDashboardHtml(makeDashboardData());
		expect(html).toContain("addEventListener('click'");
		expect(html).toContain("dataset.tab");
	});
});
//# sourceMappingURL=dashboard-html-generator.test.js.map
