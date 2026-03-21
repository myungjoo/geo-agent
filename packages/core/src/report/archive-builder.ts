/**
 * Archive Builder
 *
 * 최적화 결과를 ZIP-like 구조로 패키징한다.
 * (Node.js 네이티브 모듈 의존성 최소화를 위해 tar/디렉토리 구조 기반)
 *
 * Archive 구조:
 *   {target_name}_optimized/
 *     ├── report.json          — 최적화 리포트
 *     ├── original/            — 원본 파일
 *     │   └── index.html
 *     ├── optimized/           — 수정된 파일
 *     │   └── index.html
 *     └── diff/                — 변경사항 diff
 *         └── index.html.diff
 */
import fs from "node:fs";
import path from "node:path";
import type { OptimizationReport } from "./report-generator.js";

export interface ArchiveResult {
	archive_path: string;
	total_files: number;
	total_size_bytes: number;
}

export class ArchiveBuilder {
	private reportsDir: string;

	constructor(workspaceDir: string) {
		this.reportsDir = path.join(workspaceDir, "reports");
		fs.mkdirSync(this.reportsDir, { recursive: true });
	}

	/** 아카이브 생성 */
	build(
		report: OptimizationReport,
		originalFiles: Map<string, string>,
		optimizedFiles: Map<string, string>,
		diffs: Map<string, string>,
	): ArchiveResult {
		const archiveDir = path.join(this.reportsDir, report.target_id, report.report_id);

		const origDir = path.join(archiveDir, "original");
		const optDir = path.join(archiveDir, "optimized");
		const diffDir = path.join(archiveDir, "diff");

		fs.mkdirSync(origDir, { recursive: true });
		fs.mkdirSync(optDir, { recursive: true });
		fs.mkdirSync(diffDir, { recursive: true });

		let totalFiles = 0;
		let totalSize = 0;

		// 리포트 JSON 저장
		const reportJson = JSON.stringify(report, null, 2);
		fs.writeFileSync(path.join(archiveDir, "report.json"), reportJson, "utf-8");
		totalFiles++;
		totalSize += Buffer.byteLength(reportJson, "utf-8");

		// 원본 파일 저장
		for (const [filePath, content] of originalFiles) {
			const fullPath = path.join(origDir, filePath);
			fs.mkdirSync(path.dirname(fullPath), { recursive: true });
			fs.writeFileSync(fullPath, content, "utf-8");
			totalFiles++;
			totalSize += Buffer.byteLength(content, "utf-8");
		}

		// 최적화된 파일 저장
		for (const [filePath, content] of optimizedFiles) {
			const fullPath = path.join(optDir, filePath);
			fs.mkdirSync(path.dirname(fullPath), { recursive: true });
			fs.writeFileSync(fullPath, content, "utf-8");
			totalFiles++;
			totalSize += Buffer.byteLength(content, "utf-8");
		}

		// Diff 저장
		for (const [filePath, content] of diffs) {
			const fullPath = path.join(diffDir, `${filePath}.diff`);
			fs.mkdirSync(path.dirname(fullPath), { recursive: true });
			fs.writeFileSync(fullPath, content, "utf-8");
			totalFiles++;
			totalSize += Buffer.byteLength(content, "utf-8");
		}

		return {
			archive_path: archiveDir,
			total_files: totalFiles,
			total_size_bytes: totalSize,
		};
	}

	/** 아카이브 존재 여부 확인 */
	exists(targetId: string, reportId: string): boolean {
		const reportPath = path.join(this.reportsDir, targetId, reportId, "report.json");
		return fs.existsSync(reportPath);
	}

	/** 리포트 읽기 */
	getReport(targetId: string, reportId: string): OptimizationReport | null {
		const reportPath = path.join(this.reportsDir, targetId, reportId, "report.json");
		if (!fs.existsSync(reportPath)) return null;
		try {
			return JSON.parse(fs.readFileSync(reportPath, "utf-8"));
		} catch (err) {
			throw new Error(
				`Failed to parse report ${reportPath}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	/** 타겟의 전체 아카이브 목록 */
	listArchives(targetId: string): string[] {
		const targetDir = path.join(this.reportsDir, targetId);
		if (!fs.existsSync(targetDir)) return [];
		return fs
			.readdirSync(targetDir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);
	}

	/** 아카이브 삭제 */
	deleteArchive(targetId: string, reportId: string): boolean {
		const archiveDir = path.join(this.reportsDir, targetId, reportId);
		if (!fs.existsSync(archiveDir)) return false;
		fs.rmSync(archiveDir, { recursive: true, force: true });
		return true;
	}
}
