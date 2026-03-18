import type { EvaluationResult } from "../prompts/evaluation-templates/index.js";
/**
 * Interactive Dashboard HTML Generator
 *
 * 평가 결과를 단일 HTML 파일로 생성 (Chart.js, 다크 테마, 10탭 구조)
 * - 초기/중간/최종 결과 동일 포맷
 * - Tab 10: 사이클 이력 (cycle >= 1일 때만 표시)
 */
import type { OptimizationReport, ScoreComparison } from "./report-generator.js";

export interface DashboardData {
	report: OptimizationReport;
	evaluation?: EvaluationResult;
	cycle_history?: EvaluationResult[];
}

/**
 * Interactive HTML Dashboard 생성
 */
export function generateDashboardHtml(data: DashboardData): string {
	const { report, evaluation, cycle_history } = data;
	const hasCycles = (cycle_history?.length ?? 0) > 0;

	const tabNames = [
		"Overview",
		"Score Breakdown",
		"Changes",
		"Before vs After",
		"Crawlability",
		"Structured Data",
		"Content Analysis",
		"Improvements",
		"Remaining Issues",
		...(hasCycles ? ["Cycle History"] : []),
	];

	return `<!DOCTYPE html>
<html lang="ko" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GEO Report: ${escapeHtml(report.target_url)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
:root { --bg: #1a1a2e; --surface: #16213e; --primary: #0f3460; --accent: #e94560; --text: #eee; --text-dim: #999; --border: #333; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); }
.header { background: var(--surface); padding: 20px 30px; border-bottom: 2px solid var(--accent); }
.header h1 { font-size: 1.4em; } .header .meta { color: var(--text-dim); font-size: 0.85em; margin-top: 4px; }
.score-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 1.2em; }
.score-badge.excellent { background: #2d6a4f; } .score-badge.good { background: #457b9d; }
.score-badge.needs-improvement { background: #e76f51; } .score-badge.poor { background: #9b2226; }
.score-badge.critical { background: #6c0014; }
.tabs { display: flex; background: var(--surface); border-bottom: 1px solid var(--border); overflow-x: auto; }
.tab { padding: 10px 18px; cursor: pointer; border-bottom: 3px solid transparent; white-space: nowrap; color: var(--text-dim); }
.tab.active { border-bottom-color: var(--accent); color: var(--text); font-weight: 600; }
.tab:hover { background: var(--primary); }
.panel { display: none; padding: 24px 30px; } .panel.active { display: block; }
.card { background: var(--surface); border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--border); }
.card h3 { margin-bottom: 10px; font-size: 1em; color: var(--accent); }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
th { color: var(--accent); font-size: 0.85em; }
.delta-pos { color: #2d6a4f; } .delta-neg { color: #e94560; } .delta-zero { color: var(--text-dim); }
canvas { max-width: 100%; }
.change-entry { padding: 10px 0; border-bottom: 1px solid var(--border); }
.change-type { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 600; }
.change-type.added { background: #2d6a4f; } .change-type.modified { background: #457b9d; } .change-type.deleted { background: #9b2226; }
@media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="header">
  <h1>GEO Optimization Report</h1>
  <div class="meta">${escapeHtml(report.target_url)} · ${report.site_type} · ${report.generated_at.slice(0, 10)} · ${report.cycle_count} cycles</div>
  <div style="margin-top:8px">
    <span class="score-badge ${gradeClass(report.grade_before)}">${report.overall_before.toFixed(1)}</span>
    → <span class="score-badge ${gradeClass(report.grade_after)}">${report.overall_after.toFixed(1)}</span>
    <span style="margin-left:8px;color:${report.overall_delta >= 0 ? "#2d6a4f" : "#e94560"}">
      ${report.overall_delta >= 0 ? "+" : ""}${report.overall_delta.toFixed(1)}
    </span>
  </div>
</div>

<div class="tabs" id="tabs">
${tabNames.map((name, i) => `  <div class="tab${i === 0 ? " active" : ""}" data-tab="${i}">${name}</div>`).join("\n")}
</div>

<!-- Tab 0: Overview -->
<div class="panel active" id="panel-0">
  <div class="grid-2">
    <div class="card"><h3>Summary</h3>
      <p>Overall: ${report.overall_before.toFixed(1)} → ${report.overall_after.toFixed(1)} (${report.overall_delta >= 0 ? "+" : ""}${report.overall_delta.toFixed(1)})</p>
      <p>Grade: ${report.grade_before} → ${report.grade_after}</p>
      <p>Changes: ${report.changes.length}</p>
      <p>Cycles: ${report.cycle_count}</p>
    </div>
    <div class="card"><h3>Score Radar</h3><canvas id="radar-chart"></canvas></div>
  </div>
</div>

<!-- Tab 1: Score Breakdown -->
<div class="panel" id="panel-1">
  <div class="card"><h3>Dimension Scores</h3>
    <table>
      <tr><th>Dimension</th><th>Before</th><th>After</th><th>Delta</th><th>%</th></tr>
${report.score_comparisons.map((s) => `      <tr><td>${escapeHtml(s.dimension)}</td><td>${s.before.toFixed(1)}</td><td>${s.after.toFixed(1)}</td><td class="${deltaClass(s.delta)}">${s.delta >= 0 ? "+" : ""}${s.delta.toFixed(1)}</td><td class="${deltaClass(s.delta_pct)}">${s.delta_pct >= 0 ? "+" : ""}${s.delta_pct.toFixed(1)}%</td></tr>`).join("\n")}
    </table>
  </div>
  <div class="card"><h3>Bar Chart</h3><canvas id="bar-chart"></canvas></div>
</div>

<!-- Tab 2: Changes -->
<div class="panel" id="panel-2">
  <div class="card"><h3>All Changes (${report.changes.length})</h3>
${report.changes
	.map(
		(ch) => `    <div class="change-entry">
      <span class="change-type ${ch.change_type}">${ch.change_type}</span>
      <strong>${escapeHtml(ch.file_path)}</strong>
      <p style="color:var(--text-dim);font-size:0.9em">${escapeHtml(ch.summary)}</p>
      ${ch.affected_dimensions.length > 0 ? `<p style="font-size:0.8em">Affected: ${ch.affected_dimensions.join(", ")}</p>` : ""}
    </div>`,
	)
	.join("\n")}
  </div>
</div>

<!-- Tab 3-6: Placeholder panels -->
${[3, 4, 5, 6].map((i) => `<div class="panel" id="panel-${i}"><div class="card"><h3>${tabNames[i]}</h3><p>Detailed ${tabNames[i].toLowerCase()} analysis will be populated by the evaluation engine.</p></div></div>`).join("\n")}

<!-- Tab 7: Key Improvements -->
<div class="panel" id="panel-7">
  <div class="card"><h3>Key Improvements</h3>
    <ul>${report.key_improvements.map((imp) => `<li>${escapeHtml(imp)}</li>`).join("")}</ul>
  </div>
</div>

<!-- Tab 8: Remaining Issues -->
<div class="panel" id="panel-8">
  <div class="card"><h3>Remaining Issues</h3>
    <ul>${report.remaining_issues.map((iss) => `<li>${escapeHtml(iss)}</li>`).join("")}</ul>
  </div>
</div>

${
	hasCycles
		? `<!-- Tab 9: Cycle History -->
<div class="panel" id="panel-9">
  <div class="card"><h3>Score Progression</h3><canvas id="cycle-chart"></canvas></div>
  <div class="card"><h3>Cycle Details</h3>
    <table>
      <tr><th>Cycle</th><th>Score</th><th>Grade</th><th>Evaluated At</th></tr>
${(cycle_history ?? []).map((ch) => `      <tr><td>${ch.cycle_number}</td><td>${ch.overall_score.toFixed(1)}</td><td>${ch.grade}</td><td>${ch.evaluated_at.slice(0, 19)}</td></tr>`).join("\n")}
    </table>
  </div>
</div>`
		: ""
}

<script>
// Tab switching
document.getElementById('tabs').addEventListener('click', function(e) {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
});

// Radar Chart
const dims = ${JSON.stringify(report.score_comparisons.map((s) => s.dimension))};
const beforeScores = ${JSON.stringify(report.score_comparisons.map((s) => s.before))};
const afterScores = ${JSON.stringify(report.score_comparisons.map((s) => s.after))};

new Chart(document.getElementById('radar-chart'), {
  type: 'radar',
  data: {
    labels: dims,
    datasets: [
      { label: 'Before', data: beforeScores, borderColor: '#e94560', backgroundColor: 'rgba(233,69,96,0.1)' },
      { label: 'After', data: afterScores, borderColor: '#2d6a4f', backgroundColor: 'rgba(45,106,79,0.1)' }
    ]
  },
  options: { scales: { r: { min: 0, max: 100, ticks: { color: '#999' }, grid: { color: '#333' }, pointLabels: { color: '#eee' } } }, plugins: { legend: { labels: { color: '#eee' } } } }
});

// Bar Chart
new Chart(document.getElementById('bar-chart'), {
  type: 'bar',
  data: {
    labels: dims,
    datasets: [
      { label: 'Before', data: beforeScores, backgroundColor: 'rgba(233,69,96,0.6)' },
      { label: 'After', data: afterScores, backgroundColor: 'rgba(45,106,79,0.6)' }
    ]
  },
  options: { scales: { x: { ticks: { color: '#999' } }, y: { min: 0, max: 100, ticks: { color: '#999' } } }, plugins: { legend: { labels: { color: '#eee' } } } }
});

${
	hasCycles
		? `// Cycle History Chart
const cycleLabels = ${JSON.stringify((cycle_history ?? []).map((c) => `Cycle ${c.cycle_number}`))};
const cycleScores = ${JSON.stringify((cycle_history ?? []).map((c) => c.overall_score))};
new Chart(document.getElementById('cycle-chart'), {
  type: 'line',
  data: { labels: cycleLabels, datasets: [{ label: 'Overall Score', data: cycleScores, borderColor: '#e94560', tension: 0.3, fill: false }] },
  options: { scales: { y: { min: 0, max: 100 } }, plugins: { legend: { labels: { color: '#eee' } } } }
});`
		: ""
}
</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function gradeClass(grade: string): string {
	return grade.toLowerCase().replace(/\s+/g, "-");
}

function deltaClass(delta: number): string {
	if (delta > 0) return "delta-pos";
	if (delta < 0) return "delta-neg";
	return "delta-zero";
}
