/**
 * Clone Manager
 *
 * Target Web Page를 로컬에 클론하여 수정 작업의 기반을 제공한다.
 * 읽기 전용 원칙: 원본 사이트는 절대 수정하지 않고, 클론 복사본에서만 작업한다.
 *
 * 파일 구조:
 *   {workspace}/clones/{target_id}/
 *     ├── metadata.json   — 클론 메타데이터
 *     ├── original/        — 원본 스냅샷 (불변)
 *     └── working/         — 작업용 복사본 (수정 대상)
 */
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

// ── Clone Metadata 스키마 ─────────────────────────────────────

export const CloneMetadataSchema = z.object({
	clone_id: z.string().uuid(),
	target_id: z.string().uuid(),
	source_url: z.string().url(),
	clone_path: z.string(),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	status: z.enum(["creating", "ready", "modifying", "archived", "failed"]),
	original_html_hash: z.string().default(""),
	file_count: z.number().int().min(0).default(0),
	total_size_bytes: z.number().int().min(0).default(0),
	cycle_count: z.number().int().min(0).default(0),
});
export type CloneMetadata = z.infer<typeof CloneMetadataSchema>;

// ── Clone Manager ────────────────────────────────────────────

export class CloneManager {
	private baseDir: string;

	constructor(workspaceDir: string) {
		this.baseDir = path.join(workspaceDir, "clones");
		fs.mkdirSync(this.baseDir, { recursive: true });
	}

	/** 클론 저장소의 기본 경로 반환 */
	getBaseDir(): string {
		return this.baseDir;
	}

	/** 특정 타겟의 클론 디렉토리 경로 */
	getClonePath(targetId: string): string {
		return path.join(this.baseDir, targetId);
	}

	/** 클론 생성 — HTML 콘텐츠를 로컬에 저장 */
	createClone(
		targetId: string,
		sourceUrl: string,
		htmlContent: string,
		additionalFiles?: Map<string, string>,
	): CloneMetadata {
		const clonePath = this.getClonePath(targetId);
		const originalDir = path.join(clonePath, "original");
		const workingDir = path.join(clonePath, "working");

		// 기존 클론이 있으면 아카이브
		if (fs.existsSync(clonePath)) {
			this.archiveClone(targetId);
		}

		// 디렉토리 생성
		fs.mkdirSync(originalDir, { recursive: true });
		fs.mkdirSync(workingDir, { recursive: true });

		// 원본 저장 (불변)
		fs.writeFileSync(path.join(originalDir, "index.html"), htmlContent, "utf-8");
		// 작업용 복사본 저장
		fs.writeFileSync(path.join(workingDir, "index.html"), htmlContent, "utf-8");

		let fileCount = 1;
		let totalSize = Buffer.byteLength(htmlContent, "utf-8");

		// 추가 파일 저장
		if (additionalFiles) {
			for (const [filePath, content] of additionalFiles) {
				const origFile = path.join(originalDir, filePath);
				const workFile = path.join(workingDir, filePath);
				fs.mkdirSync(path.dirname(origFile), { recursive: true });
				fs.mkdirSync(path.dirname(workFile), { recursive: true });
				fs.writeFileSync(origFile, content, "utf-8");
				fs.writeFileSync(workFile, content, "utf-8");
				fileCount++;
				totalSize += Buffer.byteLength(content, "utf-8");
			}
		}

		const now = new Date().toISOString();
		const metadata: CloneMetadata = {
			clone_id: uuidv4(),
			target_id: targetId,
			source_url: sourceUrl,
			clone_path: clonePath,
			created_at: now,
			updated_at: now,
			status: "ready",
			original_html_hash: simpleHash(htmlContent),
			file_count: fileCount,
			total_size_bytes: totalSize,
			cycle_count: 0,
		};

		// 메타데이터 저장
		fs.writeFileSync(
			path.join(clonePath, "metadata.json"),
			JSON.stringify(metadata, null, 2),
			"utf-8",
		);

		return metadata;
	}

	/** 클론 메타데이터 조회 */
	getMetadata(targetId: string): CloneMetadata | null {
		const metaPath = path.join(this.getClonePath(targetId), "metadata.json");
		if (!fs.existsSync(metaPath)) return null;
		try {
			const raw = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
			return CloneMetadataSchema.parse(raw);
		} catch (err) {
			throw new Error(
				`Failed to parse clone metadata ${metaPath}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	/** 작업 디렉토리의 파일 읽기 */
	readWorkingFile(targetId: string, filePath: string): string | null {
		const fullPath = path.join(this.getClonePath(targetId), "working", filePath);
		if (!fs.existsSync(fullPath)) return null;
		return fs.readFileSync(fullPath, "utf-8");
	}

	/** 원본 디렉토리의 파일 읽기 */
	readOriginalFile(targetId: string, filePath: string): string | null {
		const fullPath = path.join(this.getClonePath(targetId), "original", filePath);
		if (!fs.existsSync(fullPath)) return null;
		return fs.readFileSync(fullPath, "utf-8");
	}

	/** 작업 디렉토리에 파일 쓰기 (원본은 변경하지 않음) */
	writeWorkingFile(targetId: string, filePath: string, content: string): void {
		const fullPath = path.join(this.getClonePath(targetId), "working", filePath);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, content, "utf-8");

		// 메타데이터 업데이트
		const metadata = this.getMetadata(targetId);
		if (metadata) {
			metadata.updated_at = new Date().toISOString();
			metadata.status = "modifying";
			this.saveMetadata(targetId, metadata);
		}
	}

	/** 작업 디렉토리의 파일 목록 */
	listWorkingFiles(targetId: string): string[] {
		const workingDir = path.join(this.getClonePath(targetId), "working");
		if (!fs.existsSync(workingDir)) return [];
		return this.walkDir(workingDir, workingDir);
	}

	/** 클론 존재 여부 확인 */
	exists(targetId: string): boolean {
		return fs.existsSync(path.join(this.getClonePath(targetId), "metadata.json"));
	}

	/** 클론 아카이브 (이전 클론을 archived 상태로 변경) */
	archiveClone(targetId: string): void {
		const metadata = this.getMetadata(targetId);
		if (metadata) {
			metadata.status = "archived";
			metadata.updated_at = new Date().toISOString();
			this.saveMetadata(targetId, metadata);
		}

		// 기존 클론을 archived 폴더로 이동
		const clonePath = this.getClonePath(targetId);
		const archivePath = path.join(this.baseDir, `${targetId}_archived_${Date.now()}`);
		if (fs.existsSync(clonePath)) {
			fs.renameSync(clonePath, archivePath);
		}
	}

	/** 클론 삭제 */
	deleteClone(targetId: string): boolean {
		const clonePath = this.getClonePath(targetId);
		if (!fs.existsSync(clonePath)) return false;
		fs.rmSync(clonePath, { recursive: true, force: true });
		return true;
	}

	/** 사이클 카운트 증가 */
	incrementCycle(targetId: string): number {
		const metadata = this.getMetadata(targetId);
		if (!metadata) throw new Error(`Clone not found: ${targetId}`);
		metadata.cycle_count += 1;
		metadata.updated_at = new Date().toISOString();
		this.saveMetadata(targetId, metadata);
		return metadata.cycle_count;
	}

	/** 원본과 작업본 비교 (단순 diff 데이터) */
	getDiff(targetId: string, filePath: string): { original: string; working: string } | null {
		const original = this.readOriginalFile(targetId, filePath);
		const working = this.readWorkingFile(targetId, filePath);
		if (original === null || working === null) return null;
		return { original, working };
	}

	// ── Private helpers ────────────────────────────

	private saveMetadata(targetId: string, metadata: CloneMetadata): void {
		const metaPath = path.join(this.getClonePath(targetId), "metadata.json");
		fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
	}

	private walkDir(dir: string, baseDir: string): string[] {
		const files: string[] = [];
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				files.push(...this.walkDir(fullPath, baseDir));
			} else {
				files.push(path.relative(baseDir, fullPath).replace(/\\/g, "/"));
			}
		}
		return files;
	}
}

/** 단순 해시 (비암호학적, 변경 감지용) */
function simpleHash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = ((hash << 5) - hash + char) | 0;
	}
	return Math.abs(hash).toString(16).padStart(8, "0");
}
