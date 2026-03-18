import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CloneManager, CloneMetadataSchema } from "./clone-manager.js";

describe("CloneManager", () => {
	let tmpDir: string;
	let manager: CloneManager;
	const targetId = uuidv4();
	const sourceUrl = "https://example.com";
	const htmlContent = "<html><body><h1>Hello World</h1></body></html>";

	beforeEach(() => {
		tmpDir = path.join(
			os.tmpdir(),
			`clone-manager-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		fs.mkdirSync(tmpDir, { recursive: true });
		manager = new CloneManager(tmpDir);
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// 1. constructor creates base directory
	it("constructor creates base directory", () => {
		const baseDir = manager.getBaseDir();
		expect(fs.existsSync(baseDir)).toBe(true);
		expect(baseDir).toBe(path.join(tmpDir, "clones"));
	});

	// 2. getClonePath returns correct path
	it("getClonePath returns correct path", () => {
		const clonePath = manager.getClonePath(targetId);
		expect(clonePath).toBe(path.join(tmpDir, "clones", targetId));
	});

	// 3. createClone creates directories and files
	it("createClone creates directories and files", () => {
		const metadata = manager.createClone(targetId, sourceUrl, htmlContent);

		const clonePath = manager.getClonePath(targetId);
		expect(fs.existsSync(path.join(clonePath, "original"))).toBe(true);
		expect(fs.existsSync(path.join(clonePath, "working"))).toBe(true);
		expect(fs.existsSync(path.join(clonePath, "metadata.json"))).toBe(true);
		expect(fs.readFileSync(path.join(clonePath, "original", "index.html"), "utf-8")).toBe(
			htmlContent,
		);
		expect(fs.readFileSync(path.join(clonePath, "working", "index.html"), "utf-8")).toBe(
			htmlContent,
		);

		expect(metadata.target_id).toBe(targetId);
		expect(metadata.source_url).toBe(sourceUrl);
		expect(metadata.status).toBe("ready");
		expect(metadata.file_count).toBe(1);
		expect(metadata.cycle_count).toBe(0);
		expect(metadata.total_size_bytes).toBe(Buffer.byteLength(htmlContent, "utf-8"));
	});

	// 4. createClone with additionalFiles stores extra files
	it("createClone with additionalFiles stores extra files", () => {
		const additional = new Map<string, string>();
		additional.set("styles/main.css", "body { color: red; }");
		additional.set("scripts/app.js", "console.log('hello');");

		const metadata = manager.createClone(targetId, sourceUrl, htmlContent, additional);

		const clonePath = manager.getClonePath(targetId);
		expect(fs.readFileSync(path.join(clonePath, "original", "styles", "main.css"), "utf-8")).toBe(
			"body { color: red; }",
		);
		expect(fs.readFileSync(path.join(clonePath, "working", "scripts", "app.js"), "utf-8")).toBe(
			"console.log('hello');",
		);
		expect(metadata.file_count).toBe(3);
	});

	// 5. getMetadata returns metadata after clone
	it("getMetadata returns metadata after clone", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		const metadata = manager.getMetadata(targetId);

		expect(metadata).not.toBeNull();
		expect(metadata!.target_id).toBe(targetId);
		expect(metadata!.source_url).toBe(sourceUrl);
		expect(metadata!.status).toBe("ready");
		expect(metadata!.clone_id).toBeTruthy();
		expect(metadata!.created_at).toBeTruthy();
		expect(metadata!.updated_at).toBeTruthy();
	});

	// 6. getMetadata returns null for non-existent clone
	it("getMetadata returns null for non-existent clone", () => {
		const metadata = manager.getMetadata("non-existent-id");
		expect(metadata).toBeNull();
	});

	// 7. readOriginalFile reads from original/
	it("readOriginalFile reads from original/", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		const content = manager.readOriginalFile(targetId, "index.html");
		expect(content).toBe(htmlContent);
	});

	it("readOriginalFile returns null for non-existent file", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		const content = manager.readOriginalFile(targetId, "no-such-file.html");
		expect(content).toBeNull();
	});

	// 8. readWorkingFile reads from working/
	it("readWorkingFile reads from working/", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		const content = manager.readWorkingFile(targetId, "index.html");
		expect(content).toBe(htmlContent);
	});

	it("readWorkingFile returns null for non-existent file", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		const content = manager.readWorkingFile(targetId, "missing.html");
		expect(content).toBeNull();
	});

	// 9. writeWorkingFile modifies working/ only (original unchanged)
	it("writeWorkingFile modifies working/ only, original unchanged", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		const newContent = "<html><body><h1>Modified</h1></body></html>";

		manager.writeWorkingFile(targetId, "index.html", newContent);

		expect(manager.readWorkingFile(targetId, "index.html")).toBe(newContent);
		expect(manager.readOriginalFile(targetId, "index.html")).toBe(htmlContent);
	});

	// 10. writeWorkingFile updates metadata status to "modifying"
	it("writeWorkingFile updates metadata status to modifying", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		expect(manager.getMetadata(targetId)!.status).toBe("ready");

		manager.writeWorkingFile(targetId, "index.html", "updated");

		const metadata = manager.getMetadata(targetId);
		expect(metadata!.status).toBe("modifying");
	});

	// 11. listWorkingFiles returns all files
	it("listWorkingFiles returns all files", () => {
		const additional = new Map<string, string>();
		additional.set("css/style.css", "body {}");
		additional.set("js/app.js", "//code");

		manager.createClone(targetId, sourceUrl, htmlContent, additional);
		const files = manager.listWorkingFiles(targetId);

		expect(files).toContain("index.html");
		expect(files).toContain("css/style.css");
		expect(files).toContain("js/app.js");
		expect(files).toHaveLength(3);
	});

	it("listWorkingFiles returns empty array for non-existent clone", () => {
		const files = manager.listWorkingFiles("no-such-target");
		expect(files).toEqual([]);
	});

	// 12. exists() returns true/false correctly
	it("exists returns true for existing clone", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		expect(manager.exists(targetId)).toBe(true);
	});

	it("exists returns false for non-existent clone", () => {
		expect(manager.exists("non-existent")).toBe(false);
	});

	// 13. deleteClone removes directory
	it("deleteClone removes directory and returns true", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		expect(manager.exists(targetId)).toBe(true);

		const result = manager.deleteClone(targetId);
		expect(result).toBe(true);
		expect(manager.exists(targetId)).toBe(false);
		expect(fs.existsSync(manager.getClonePath(targetId))).toBe(false);
	});

	it("deleteClone returns false for non-existent clone", () => {
		const result = manager.deleteClone("non-existent");
		expect(result).toBe(false);
	});

	// 14. incrementCycle increases cycle count
	it("incrementCycle increases cycle count", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);

		const count1 = manager.incrementCycle(targetId);
		expect(count1).toBe(1);

		const count2 = manager.incrementCycle(targetId);
		expect(count2).toBe(2);

		const metadata = manager.getMetadata(targetId);
		expect(metadata!.cycle_count).toBe(2);
	});

	it("incrementCycle throws for non-existent clone", () => {
		expect(() => manager.incrementCycle("no-such")).toThrow("Clone not found: no-such");
	});

	// 15. getDiff returns original vs working content
	it("getDiff returns original vs working content", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		const modified = "<html><body><h1>Changed</h1></body></html>";
		manager.writeWorkingFile(targetId, "index.html", modified);

		const diff = manager.getDiff(targetId, "index.html");
		expect(diff).not.toBeNull();
		expect(diff!.original).toBe(htmlContent);
		expect(diff!.working).toBe(modified);
	});

	it("getDiff returns null for non-existent file", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		const diff = manager.getDiff(targetId, "no-file.html");
		expect(diff).toBeNull();
	});

	// 16. archiveClone renames and sets status
	it("archiveClone renames directory and sets status to archived", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		expect(manager.exists(targetId)).toBe(true);

		manager.archiveClone(targetId);

		// Original clone path should no longer exist (renamed)
		expect(fs.existsSync(manager.getClonePath(targetId))).toBe(false);

		// Archived directory should exist under baseDir with _archived_ suffix
		const baseDir = manager.getBaseDir();
		const entries = fs.readdirSync(baseDir);
		const archivedEntry = entries.find((e) => e.startsWith(targetId) && e.includes("_archived_"));
		expect(archivedEntry).toBeTruthy();

		// Read metadata from archived directory to verify status
		const archivedMeta = JSON.parse(
			fs.readFileSync(path.join(baseDir, archivedEntry!, "metadata.json"), "utf-8"),
		);
		expect(archivedMeta.status).toBe("archived");
	});

	// 17. CloneMetadataSchema validates correctly
	describe("CloneMetadataSchema", () => {
		it("validates a correct metadata object", () => {
			const now = new Date().toISOString();
			const valid = {
				clone_id: uuidv4(),
				target_id: uuidv4(),
				source_url: "https://example.com",
				clone_path: "/tmp/clones/test",
				created_at: now,
				updated_at: now,
				status: "ready",
				original_html_hash: "abcd1234",
				file_count: 3,
				total_size_bytes: 1024,
				cycle_count: 0,
			};
			const result = CloneMetadataSchema.parse(valid);
			expect(result.clone_id).toBe(valid.clone_id);
			expect(result.status).toBe("ready");
		});

		it("applies defaults for optional fields", () => {
			const now = new Date().toISOString();
			const minimal = {
				clone_id: uuidv4(),
				target_id: uuidv4(),
				source_url: "https://example.com",
				clone_path: "/tmp/test",
				created_at: now,
				updated_at: now,
				status: "creating",
			};
			const result = CloneMetadataSchema.parse(minimal);
			expect(result.original_html_hash).toBe("");
			expect(result.file_count).toBe(0);
			expect(result.total_size_bytes).toBe(0);
			expect(result.cycle_count).toBe(0);
		});

		it("rejects invalid status", () => {
			const now = new Date().toISOString();
			const bad = {
				clone_id: uuidv4(),
				target_id: uuidv4(),
				source_url: "https://example.com",
				clone_path: "/tmp/test",
				created_at: now,
				updated_at: now,
				status: "invalid_status",
			};
			expect(() => CloneMetadataSchema.parse(bad)).toThrow();
		});

		it("rejects invalid URL", () => {
			const now = new Date().toISOString();
			const bad = {
				clone_id: uuidv4(),
				target_id: uuidv4(),
				source_url: "not-a-url",
				clone_path: "/tmp/test",
				created_at: now,
				updated_at: now,
				status: "ready",
			};
			expect(() => CloneMetadataSchema.parse(bad)).toThrow();
		});

		it("rejects non-uuid clone_id", () => {
			const now = new Date().toISOString();
			const bad = {
				clone_id: "not-a-uuid",
				target_id: uuidv4(),
				source_url: "https://example.com",
				clone_path: "/tmp/test",
				created_at: now,
				updated_at: now,
				status: "ready",
			};
			expect(() => CloneMetadataSchema.parse(bad)).toThrow();
		});

		it("accepts all valid status values", () => {
			const statuses = ["creating", "ready", "modifying", "archived", "failed"] as const;
			const now = new Date().toISOString();
			for (const status of statuses) {
				const obj = {
					clone_id: uuidv4(),
					target_id: uuidv4(),
					source_url: "https://example.com",
					clone_path: "/tmp/test",
					created_at: now,
					updated_at: now,
					status,
				};
				const result = CloneMetadataSchema.parse(obj);
				expect(result.status).toBe(status);
			}
		});

		it("rejects negative file_count", () => {
			const now = new Date().toISOString();
			const bad = {
				clone_id: uuidv4(),
				target_id: uuidv4(),
				source_url: "https://example.com",
				clone_path: "/tmp/test",
				created_at: now,
				updated_at: now,
				status: "ready",
				file_count: -1,
			};
			expect(() => CloneMetadataSchema.parse(bad)).toThrow();
		});
	});

	// Additional edge case: createClone archives existing clone first
	it("createClone archives existing clone before creating new one", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		expect(manager.exists(targetId)).toBe(true);

		const newHtml = "<html><body><h1>New Version</h1></body></html>";
		const metadata = manager.createClone(targetId, sourceUrl, newHtml);

		expect(metadata.status).toBe("ready");
		expect(manager.readOriginalFile(targetId, "index.html")).toBe(newHtml);

		// Archived version should exist
		const entries = fs.readdirSync(manager.getBaseDir());
		const archivedEntry = entries.find((e) => e.startsWith(targetId) && e.includes("_archived_"));
		expect(archivedEntry).toBeTruthy();
	});

	// writeWorkingFile creates new files in working directory
	it("writeWorkingFile can create new files with nested directories", () => {
		manager.createClone(targetId, sourceUrl, htmlContent);
		manager.writeWorkingFile(targetId, "data/config.json", '{"key":"value"}');

		const content = manager.readWorkingFile(targetId, "data/config.json");
		expect(content).toBe('{"key":"value"}');

		// Original should not have this file
		const originalContent = manager.readOriginalFile(targetId, "data/config.json");
		expect(originalContent).toBeNull();
	});
});
