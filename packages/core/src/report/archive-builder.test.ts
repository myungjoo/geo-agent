import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArchiveBuilder } from "./archive-builder.js";
import { ReportBuilder } from "./report-generator.js";

function createTestReport(
	reportId = "rpt-001",
	targetId = "target-001",
): ReturnType<ReportBuilder["build"]> {
	return new ReportBuilder(reportId, targetId, "https://example.com")
		.setSiteType("generic")
		.setCycleCount(1)
		.setOverallScores(40, 65)
		.setGrades("D", "B")
		.addScoreComparison("citation_rate", 30, 55)
		.addChange({
			file_path: "index.html",
			change_type: "modified",
			summary: "Added structured data",
			impact_score: 15,
			affected_dimensions: ["structured_score"],
			diff_preview: '+ <script type="application/ld+json">',
		})
		.addKeyImprovement("Added JSON-LD structured data")
		.addRemainingIssue("Missing Open Graph tags")
		.build();
}

describe("ArchiveBuilder", () => {
	let tmpDir: string;
	let builder: ArchiveBuilder;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-test-"));
		builder = new ArchiveBuilder(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// ─── build() ───────────────────────────────────────────────

	describe("build()", () => {
		it("should create archive directory structure", () => {
			const report = createTestReport();
			const origFiles = new Map([["index.html", "<html>original</html>"]]);
			const optFiles = new Map([["index.html", "<html>optimized</html>"]]);
			const diffs = new Map([["index.html", "- original\n+ optimized"]]);

			const result = builder.build(report, origFiles, optFiles, diffs);

			expect(fs.existsSync(result.archive_path)).toBe(true);
			expect(fs.existsSync(path.join(result.archive_path, "report.json"))).toBe(true);
			expect(fs.existsSync(path.join(result.archive_path, "original"))).toBe(true);
			expect(fs.existsSync(path.join(result.archive_path, "optimized"))).toBe(true);
			expect(fs.existsSync(path.join(result.archive_path, "diff"))).toBe(true);
		});

		it("should write report.json with valid content", () => {
			const report = createTestReport();
			const result = builder.build(report, new Map(), new Map(), new Map());

			const written = JSON.parse(
				fs.readFileSync(path.join(result.archive_path, "report.json"), "utf-8"),
			);
			expect(written.report_id).toBe("rpt-001");
			expect(written.target_id).toBe("target-001");
			expect(written.target_url).toBe("https://example.com");
			expect(written.overall_before).toBe(40);
			expect(written.overall_after).toBe(65);
		});

		it("should write original files to original/ directory", () => {
			const report = createTestReport();
			const origFiles = new Map([["index.html", "<html>orig</html>"]]);

			const result = builder.build(report, origFiles, new Map(), new Map());

			const content = fs.readFileSync(
				path.join(result.archive_path, "original", "index.html"),
				"utf-8",
			);
			expect(content).toBe("<html>orig</html>");
		});

		it("should write optimized files to optimized/ directory", () => {
			const report = createTestReport();
			const optFiles = new Map([["index.html", "<html>opt</html>"]]);

			const result = builder.build(report, new Map(), optFiles, new Map());

			const content = fs.readFileSync(
				path.join(result.archive_path, "optimized", "index.html"),
				"utf-8",
			);
			expect(content).toBe("<html>opt</html>");
		});

		it("should write diff files with .diff extension", () => {
			const report = createTestReport();
			const diffs = new Map([["index.html", "- old\n+ new"]]);

			const result = builder.build(report, new Map(), new Map(), diffs);

			const content = fs.readFileSync(
				path.join(result.archive_path, "diff", "index.html.diff"),
				"utf-8",
			);
			expect(content).toBe("- old\n+ new");
		});

		it("should return correct total_files count", () => {
			const report = createTestReport();
			const origFiles = new Map([
				["a.html", "a"],
				["b.html", "b"],
			]);
			const optFiles = new Map([["a.html", "a-opt"]]);
			const diffs = new Map([["a.html", "diff-a"]]);

			const result = builder.build(report, origFiles, optFiles, diffs);
			// 1 report.json + 2 original + 1 optimized + 1 diff = 5
			expect(result.total_files).toBe(5);
		});

		it("should return correct total_size_bytes", () => {
			const report = createTestReport();
			const origContent = "hello";
			const optContent = "world!";
			const diffContent = "diff";

			const result = builder.build(
				report,
				new Map([["f.html", origContent]]),
				new Map([["f.html", optContent]]),
				new Map([["f.html", diffContent]]),
			);

			const reportJson = JSON.stringify(report, null, 2);
			const expectedSize =
				Buffer.byteLength(reportJson, "utf-8") +
				Buffer.byteLength(origContent, "utf-8") +
				Buffer.byteLength(optContent, "utf-8") +
				Buffer.byteLength(diffContent, "utf-8");

			expect(result.total_size_bytes).toBe(expectedSize);
		});

		it("should handle multibyte characters in size calculation", () => {
			const report = createTestReport();
			const koreanContent = "<html>한국어 콘텐츠</html>";

			const result = builder.build(
				report,
				new Map([["index.html", koreanContent]]),
				new Map(),
				new Map(),
			);

			const reportJson = JSON.stringify(report, null, 2);
			const expectedSize =
				Buffer.byteLength(reportJson, "utf-8") + Buffer.byteLength(koreanContent, "utf-8");

			expect(result.total_size_bytes).toBe(expectedSize);
		});

		it("should handle empty maps (report.json only)", () => {
			const report = createTestReport();
			const result = builder.build(report, new Map(), new Map(), new Map());

			expect(result.total_files).toBe(1);
			expect(fs.existsSync(path.join(result.archive_path, "report.json"))).toBe(true);
			// Subdirectories still created
			expect(fs.existsSync(path.join(result.archive_path, "original"))).toBe(true);
			expect(fs.existsSync(path.join(result.archive_path, "optimized"))).toBe(true);
			expect(fs.existsSync(path.join(result.archive_path, "diff"))).toBe(true);
		});

		it("should handle nested file paths in original/", () => {
			const report = createTestReport();
			const origFiles = new Map([["subdir/page.html", "<html>nested</html>"]]);

			const result = builder.build(report, origFiles, new Map(), new Map());

			const content = fs.readFileSync(
				path.join(result.archive_path, "original", "subdir", "page.html"),
				"utf-8",
			);
			expect(content).toBe("<html>nested</html>");
		});

		it("should handle nested file paths in optimized/", () => {
			const report = createTestReport();
			const optFiles = new Map([["deep/nested/dir/file.html", "<html>deep</html>"]]);

			const result = builder.build(report, new Map(), optFiles, new Map());

			const content = fs.readFileSync(
				path.join(result.archive_path, "optimized", "deep", "nested", "dir", "file.html"),
				"utf-8",
			);
			expect(content).toBe("<html>deep</html>");
		});

		it("should handle nested file paths in diff/", () => {
			const report = createTestReport();
			const diffs = new Map([["subdir/page.html", "some diff"]]);

			const result = builder.build(report, new Map(), new Map(), diffs);

			const content = fs.readFileSync(
				path.join(result.archive_path, "diff", "subdir", "page.html.diff"),
				"utf-8",
			);
			expect(content).toBe("some diff");
		});

		it("should handle multiple files across all directories", () => {
			const report = createTestReport();
			const origFiles = new Map([
				["index.html", "orig-index"],
				["about.html", "orig-about"],
				["css/style.css", "orig-css"],
			]);
			const optFiles = new Map([
				["index.html", "opt-index"],
				["about.html", "opt-about"],
				["css/style.css", "opt-css"],
			]);
			const diffs = new Map([
				["index.html", "diff-index"],
				["about.html", "diff-about"],
			]);

			const result = builder.build(report, origFiles, optFiles, diffs);

			// 1 report + 3 orig + 3 opt + 2 diff = 9
			expect(result.total_files).toBe(9);
			expect(fs.existsSync(path.join(result.archive_path, "original", "css", "style.css"))).toBe(
				true,
			);
			expect(fs.existsSync(path.join(result.archive_path, "optimized", "css", "style.css"))).toBe(
				true,
			);
		});

		it("should return archive_path under reports/<targetId>/<reportId>", () => {
			const report = createTestReport("rpt-xyz", "tgt-abc");
			const result = builder.build(report, new Map(), new Map(), new Map());

			expect(result.archive_path).toContain(path.join("reports", "tgt-abc", "rpt-xyz"));
		});
	});

	// ─── exists() ──────────────────────────────────────────────

	describe("exists()", () => {
		it("should return true when archive exists", () => {
			const report = createTestReport();
			builder.build(report, new Map(), new Map(), new Map());

			expect(builder.exists("target-001", "rpt-001")).toBe(true);
		});

		it("should return false when archive does not exist", () => {
			expect(builder.exists("nonexistent", "no-report")).toBe(false);
		});

		it("should return false when target dir exists but report id does not", () => {
			const report = createTestReport();
			builder.build(report, new Map(), new Map(), new Map());

			expect(builder.exists("target-001", "other-report")).toBe(false);
		});

		it("should return false when directory exists but report.json is missing", () => {
			const dirPath = path.join(tmpDir, "reports", "target-001", "rpt-ghost");
			fs.mkdirSync(dirPath, { recursive: true });

			expect(builder.exists("target-001", "rpt-ghost")).toBe(false);
		});
	});

	// ─── getReport() ───────────────────────────────────────────

	describe("getReport()", () => {
		it("should return parsed report when archive exists", () => {
			const report = createTestReport();
			builder.build(report, new Map(), new Map(), new Map());

			const loaded = builder.getReport("target-001", "rpt-001");
			expect(loaded).not.toBeNull();
			expect(loaded!.report_id).toBe("rpt-001");
			expect(loaded!.target_id).toBe("target-001");
			expect(loaded!.target_url).toBe("https://example.com");
			expect(loaded!.overall_before).toBe(40);
			expect(loaded!.overall_after).toBe(65);
			expect(loaded!.changes).toHaveLength(1);
			expect(loaded!.score_comparisons).toHaveLength(1);
		});

		it("should return null when archive does not exist", () => {
			expect(builder.getReport("no-target", "no-report")).toBeNull();
		});

		it("should throw for corrupted JSON", () => {
			const dirPath = path.join(tmpDir, "reports", "target-001", "rpt-corrupt");
			fs.mkdirSync(dirPath, { recursive: true });
			fs.writeFileSync(path.join(dirPath, "report.json"), "{ invalid json !!!", "utf-8");

			expect(() => builder.getReport("target-001", "rpt-corrupt")).toThrow(
				/Failed to parse report/,
			);
		});
	});

	// ─── listArchives() ────────────────────────────────────────

	describe("listArchives()", () => {
		it("should return directory names for a target", () => {
			const r1 = createTestReport("rpt-a", "target-001");
			const r2 = createTestReport("rpt-b", "target-001");
			builder.build(r1, new Map(), new Map(), new Map());
			builder.build(r2, new Map(), new Map(), new Map());

			const archives = builder.listArchives("target-001");
			expect(archives).toHaveLength(2);
			expect(archives).toContain("rpt-a");
			expect(archives).toContain("rpt-b");
		});

		it("should return empty array for non-existent target", () => {
			expect(builder.listArchives("ghost-target")).toEqual([]);
		});

		it("should not include files, only directories", () => {
			const report = createTestReport("rpt-x", "target-001");
			builder.build(report, new Map(), new Map(), new Map());

			// Place a stray file in the target directory
			const strayFile = path.join(tmpDir, "reports", "target-001", "stray.txt");
			fs.writeFileSync(strayFile, "stray", "utf-8");

			const archives = builder.listArchives("target-001");
			expect(archives).toEqual(["rpt-x"]);
		});
	});

	// ─── deleteArchive() ───────────────────────────────────────

	describe("deleteArchive()", () => {
		it("should remove archive directory and return true", () => {
			const report = createTestReport();
			const result = builder.build(report, new Map(), new Map(), new Map());

			expect(builder.deleteArchive("target-001", "rpt-001")).toBe(true);
			expect(fs.existsSync(result.archive_path)).toBe(false);
		});

		it("should return false for non-existent archive", () => {
			expect(builder.deleteArchive("no-target", "no-report")).toBe(false);
		});

		it("should not affect other archives for the same target", () => {
			const r1 = createTestReport("rpt-keep", "target-001");
			const r2 = createTestReport("rpt-del", "target-001");
			builder.build(r1, new Map(), new Map(), new Map());
			builder.build(r2, new Map(), new Map(), new Map());

			builder.deleteArchive("target-001", "rpt-del");

			expect(builder.exists("target-001", "rpt-keep")).toBe(true);
			expect(builder.exists("target-001", "rpt-del")).toBe(false);
		});
	});

	// ─── Multiple archives for same target ─────────────────────

	describe("multiple archives for same target", () => {
		it("should store and retrieve multiple independent archives", () => {
			const r1 = createTestReport("rpt-1", "target-001");
			const r2 = createTestReport("rpt-2", "target-001");
			const r3 = createTestReport("rpt-3", "target-001");

			builder.build(r1, new Map([["a.html", "a1"]]), new Map(), new Map());
			builder.build(r2, new Map([["b.html", "b2"]]), new Map(), new Map());
			builder.build(r3, new Map([["c.html", "c3"]]), new Map(), new Map());

			expect(builder.listArchives("target-001")).toHaveLength(3);

			const loaded1 = builder.getReport("target-001", "rpt-1");
			const loaded2 = builder.getReport("target-001", "rpt-2");
			expect(loaded1!.report_id).toBe("rpt-1");
			expect(loaded2!.report_id).toBe("rpt-2");
		});

		it("should keep archives separate across targets", () => {
			const rA = createTestReport("rpt-shared", "target-a");
			const rB = createTestReport("rpt-shared", "target-b");

			builder.build(rA, new Map([["a.html", "content-a"]]), new Map(), new Map());
			builder.build(rB, new Map([["b.html", "content-b"]]), new Map(), new Map());

			expect(builder.exists("target-a", "rpt-shared")).toBe(true);
			expect(builder.exists("target-b", "rpt-shared")).toBe(true);

			builder.deleteArchive("target-a", "rpt-shared");
			expect(builder.exists("target-a", "rpt-shared")).toBe(false);
			expect(builder.exists("target-b", "rpt-shared")).toBe(true);
		});

		it("should allow deleting then recreating an archive with the same id", () => {
			const report = createTestReport("rpt-cycle", "target-001");
			builder.build(report, new Map([["v1.html", "version-1"]]), new Map(), new Map());
			builder.deleteArchive("target-001", "rpt-cycle");

			builder.build(report, new Map([["v2.html", "version-2"]]), new Map(), new Map());
			expect(builder.exists("target-001", "rpt-cycle")).toBe(true);

			const archivePath = path.join(tmpDir, "reports", "target-001", "rpt-cycle");
			expect(fs.existsSync(path.join(archivePath, "original", "v2.html"))).toBe(true);
		});
	});
});
