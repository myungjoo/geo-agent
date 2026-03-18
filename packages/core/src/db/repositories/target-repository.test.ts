import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import { TargetRepository } from "./target-repository.js";
import type { CreateTarget, UpdateTarget } from "../../models/target-profile.js";

const CREATE_TABLE_SQL = `
CREATE TABLE targets (
	id TEXT PRIMARY KEY,
	url TEXT NOT NULL,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	topics TEXT NOT NULL DEFAULT '[]',
	target_queries TEXT NOT NULL DEFAULT '[]',
	audience TEXT NOT NULL DEFAULT '',
	competitors TEXT NOT NULL DEFAULT '[]',
	business_goal TEXT NOT NULL DEFAULT '',
	llm_priorities TEXT NOT NULL DEFAULT '[]',
	clone_base_path TEXT,
	site_type TEXT NOT NULL DEFAULT 'generic',
	notifications TEXT,
	monitoring_interval TEXT NOT NULL DEFAULT 'daily',
	status TEXT NOT NULL DEFAULT 'active',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
`;

function createMinimalInput(overrides: Partial<CreateTarget> = {}): CreateTarget {
	return {
		url: "https://example.com",
		name: "Test Target",
		...overrides,
	};
}

describe("TargetRepository", () => {
	let sqlite: InstanceType<typeof Database>;
	let db: ReturnType<typeof drizzle>;
	let repo: TargetRepository;

	beforeEach(() => {
		sqlite = new Database(":memory:");
		sqlite.pragma("journal_mode = WAL");
		sqlite.pragma("foreign_keys = ON");
		sqlite.exec(CREATE_TABLE_SQL);
		db = drizzle(sqlite, { schema });
		repo = new TargetRepository(db as any);
	});

	afterEach(() => {
		sqlite.close();
	});

	// ─── findAll ──────────────────────────────────────────────

	describe("findAll()", () => {
		it("1. returns empty array when no targets exist", async () => {
			const result = await repo.findAll();
			expect(result).toEqual([]);
		});

		it("2. returns all targets after multiple creates", async () => {
			await repo.create(createMinimalInput({ name: "Target A" }));
			await repo.create(createMinimalInput({ name: "Target B" }));
			await repo.create(createMinimalInput({ name: "Target C" }));

			const result = await repo.findAll();
			expect(result).toHaveLength(3);

			const names = result.map((t) => t.name);
			expect(names).toContain("Target A");
			expect(names).toContain("Target B");
			expect(names).toContain("Target C");
		});

		it("3. returns TargetProfile objects with correct types", async () => {
			await repo.create(createMinimalInput({
				topics: ["seo", "ai"],
				competitors: [{ url: "https://rival.com", name: "Rival", relationship: "direct" }],
			}));

			const result = await repo.findAll();
			expect(result).toHaveLength(1);
			const target = result[0];

			expect(typeof target.id).toBe("string");
			expect(typeof target.url).toBe("string");
			expect(typeof target.name).toBe("string");
			expect(typeof target.description).toBe("string");
			expect(typeof target.audience).toBe("string");
			expect(typeof target.business_goal).toBe("string");
			expect(typeof target.site_type).toBe("string");
			expect(typeof target.monitoring_interval).toBe("string");
			expect(typeof target.status).toBe("string");
			expect(typeof target.created_at).toBe("string");
			expect(typeof target.updated_at).toBe("string");
		});
	});

	// ─── findById ─────────────────────────────────────────────

	describe("findById()", () => {
		it("4. returns target when found", async () => {
			const created = await repo.create(createMinimalInput({ name: "Find Me" }));
			const found = await repo.findById(created.id);

			expect(found).not.toBeNull();
			expect(found!.id).toBe(created.id);
			expect(found!.name).toBe("Find Me");
		});

		it("5. returns null when not found", async () => {
			const result = await repo.findById("00000000-0000-0000-0000-000000000000");
			expect(result).toBeNull();
		});

		it("6. returns null for empty string ID", async () => {
			const result = await repo.findById("");
			expect(result).toBeNull();
		});
	});

	// ─── create ───────────────────────────────────────────────

	describe("create()", () => {
		it("7. creates target with minimal input (url + name only)", async () => {
			const target = await repo.create(createMinimalInput());
			expect(target).toBeDefined();
			expect(target.url).toBe("https://example.com");
			expect(target.name).toBe("Test Target");
		});

		it("8. creates target with all optional fields", async () => {
			const input: CreateTarget = {
				url: "https://full.example.com",
				name: "Full Target",
				description: "A fully specified target",
				topics: ["topic1", "topic2"],
				target_queries: ["query1", "query2"],
				audience: "developers",
				competitors: [
					{ url: "https://comp1.com", name: "Comp1", relationship: "direct" },
					{ url: "https://comp2.com", name: "Comp2", relationship: "indirect" },
				],
				business_goal: "increase visibility",
				llm_priorities: [
					{ llm_service: "chatgpt", priority: "critical" },
					{ llm_service: "perplexity", priority: "important" },
				],
				site_type: "manufacturer",
				notifications: {
					on_score_drop: true,
					on_external_change: false,
					on_optimization_complete: true,
					channels: ["dashboard", "email"],
				},
				monitoring_interval: "6h",
			};

			const target = await repo.create(input);
			expect(target.url).toBe("https://full.example.com");
			expect(target.name).toBe("Full Target");
			expect(target.description).toBe("A fully specified target");
			expect(target.audience).toBe("developers");
			expect(target.business_goal).toBe("increase visibility");
			expect(target.site_type).toBe("manufacturer");
			expect(target.monitoring_interval).toBe("6h");
		});

		it("9. generates UUID for id", async () => {
			const target = await repo.create(createMinimalInput());
			expect(target.id).toBeDefined();
			expect(typeof target.id).toBe("string");
			// UUID v4 format
			expect(target.id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
			);
		});

		it("10. sets created_at and updated_at timestamps", async () => {
			const before = new Date().toISOString();
			const target = await repo.create(createMinimalInput());
			const after = new Date().toISOString();

			expect(target.created_at).toBeDefined();
			expect(target.updated_at).toBeDefined();
			expect(target.created_at).toBe(target.updated_at);
			expect(target.created_at >= before).toBe(true);
			expect(target.created_at <= after).toBe(true);
		});

		it("11. sets status to 'active' by default", async () => {
			const target = await repo.create(createMinimalInput());
			expect(target.status).toBe("active");
		});

		it("12. sets site_type to 'generic' by default", async () => {
			const target = await repo.create(createMinimalInput());
			expect(target.site_type).toBe("generic");
		});

		it("13. sets monitoring_interval to 'daily' by default", async () => {
			const target = await repo.create(createMinimalInput());
			expect(target.monitoring_interval).toBe("daily");
		});
	});

	// ─── BUG TEST - JSON double-serialization (#1) ───────────

	describe("BUG: JSON double-serialization (#1)", () => {
		it("14. create() with topics array -> findById() should return topics as actual array, NOT as JSON string", async () => {
			const target = await repo.create(createMinimalInput({
				topics: ["seo", "content-marketing"],
			}));

			const found = await repo.findById(target.id);
			expect(found).not.toBeNull();
			// BUG: topics may come back as a JSON string like '["seo","content-marketing"]'
			// instead of an actual array ["seo", "content-marketing"]
			expect(Array.isArray(found!.topics)).toBe(true);
			expect(found!.topics).toEqual(["seo", "content-marketing"]);
		});

		it("15. create() with competitors array -> findById() returns actual array of objects", async () => {
			const competitors = [
				{ url: "https://rival.com", name: "Rival", relationship: "direct" as const },
				{ url: "https://other.com", name: "Other", relationship: "indirect" as const },
			];
			const target = await repo.create(createMinimalInput({ competitors }));

			const found = await repo.findById(target.id);
			expect(found).not.toBeNull();
			// BUG: competitors may be double-serialized string instead of array
			expect(Array.isArray(found!.competitors)).toBe(true);
			expect(found!.competitors).toHaveLength(2);
			expect(found!.competitors[0].url).toBe("https://rival.com");
			expect(found!.competitors[0].name).toBe("Rival");
			expect(found!.competitors[0].relationship).toBe("direct");
		});

		it("16. create() with notifications object -> findById() returns actual object, not string", async () => {
			const notifications = {
				on_score_drop: true,
				on_external_change: false,
				on_optimization_complete: true,
				channels: ["dashboard" as const, "email" as const],
			};
			const target = await repo.create(createMinimalInput({ notifications }));

			const found = await repo.findById(target.id);
			expect(found).not.toBeNull();
			// BUG: notifications may be a stringified JSON instead of an object
			expect(typeof found!.notifications).toBe("object");
			expect(found!.notifications).not.toBeNull();
			expect(found!.notifications!.on_score_drop).toBe(true);
			expect(found!.notifications!.on_external_change).toBe(false);
			expect(found!.notifications!.channels).toEqual(["dashboard", "email"]);
		});

		it("17. update() with topics array -> findById() returns actual array", async () => {
			const target = await repo.create(createMinimalInput());
			await repo.update(target.id, { topics: ["new-topic-1", "new-topic-2"] });

			const found = await repo.findById(target.id);
			expect(found).not.toBeNull();
			// BUG: after update, topics might be double-serialized
			expect(Array.isArray(found!.topics)).toBe(true);
			expect(found!.topics).toEqual(["new-topic-1", "new-topic-2"]);
		});

		it("18. create() with empty arrays -> should return [] not '[]'", async () => {
			const target = await repo.create(createMinimalInput({
				topics: [],
				target_queries: [],
				competitors: [],
				llm_priorities: [],
			}));

			const found = await repo.findById(target.id);
			expect(found).not.toBeNull();
			// BUG: empty arrays may come back as the string "[]"
			expect(Array.isArray(found!.topics)).toBe(true);
			expect(found!.topics).toEqual([]);
			expect(Array.isArray(found!.target_queries)).toBe(true);
			expect(found!.target_queries).toEqual([]);
			expect(Array.isArray(found!.competitors)).toBe(true);
			expect(found!.competitors).toEqual([]);
			expect(Array.isArray(found!.llm_priorities)).toBe(true);
			expect(found!.llm_priorities).toEqual([]);
		});
	});

	// ─── BUG TEST - notifications null (#2) ──────────────────

	describe("BUG: notifications null (#2)", () => {
		it("19. create() without notifications -> should have default notification config, NOT null", async () => {
			const target = await repo.create(createMinimalInput());

			const found = await repo.findById(target.id);
			expect(found).not.toBeNull();
			// BUG: notifications is null when not provided, but the schema
			// default should be { on_score_drop: true, on_external_change: true,
			// on_optimization_complete: true, channels: ["dashboard"] }
			expect(found!.notifications).not.toBeNull();
			expect(found!.notifications).toBeDefined();
			expect(typeof found!.notifications).toBe("object");
		});
	});

	// ─── update ───────────────────────────────────────────────

	describe("update()", () => {
		it("20. updates only specified fields, leaves others unchanged", async () => {
			const target = await repo.create(createMinimalInput({
				name: "Original Name",
				description: "Original Description",
				audience: "Original Audience",
			}));

			const updated = await repo.update(target.id, { name: "Updated Name" });
			expect(updated).not.toBeNull();
			expect(updated!.name).toBe("Updated Name");
			expect(updated!.description).toBe("Original Description");
			expect(updated!.audience).toBe("Original Audience");
			expect(updated!.url).toBe("https://example.com");
		});

		it("21. updates url field", async () => {
			const target = await repo.create(createMinimalInput());
			const updated = await repo.update(target.id, { url: "https://new-url.com" });

			expect(updated).not.toBeNull();
			expect(updated!.url).toBe("https://new-url.com");
		});

		it("22. updates name field", async () => {
			const target = await repo.create(createMinimalInput());
			const updated = await repo.update(target.id, { name: "New Name" });

			expect(updated).not.toBeNull();
			expect(updated!.name).toBe("New Name");
		});

		it("23. updates topics array", async () => {
			const target = await repo.create(createMinimalInput({ topics: ["old"] }));
			const updated = await repo.update(target.id, { topics: ["new1", "new2"] });

			expect(updated).not.toBeNull();
			// Note: may be affected by double-serialization bug
			expect(updated!.topics).toEqual(["new1", "new2"]);
		});

		it("24. updates site_type", async () => {
			const target = await repo.create(createMinimalInput());
			expect(target.site_type).toBe("generic");

			const updated = await repo.update(target.id, { site_type: "manufacturer" });
			expect(updated).not.toBeNull();
			expect(updated!.site_type).toBe("manufacturer");
		});

		it("25. returns null for non-existent ID", async () => {
			const result = await repo.update(
				"00000000-0000-0000-0000-000000000000",
				{ name: "Does Not Exist" }
			);
			expect(result).toBeNull();
		});

		it("26. updates updated_at timestamp (should be different from created_at)", async () => {
			const target = await repo.create(createMinimalInput());
			const originalUpdatedAt = target.updated_at;

			// Small delay to ensure timestamp differs
			await new Promise((resolve) => setTimeout(resolve, 10));

			const updated = await repo.update(target.id, { name: "Timestamp Test" });
			expect(updated).not.toBeNull();
			expect(updated!.updated_at).not.toBe(originalUpdatedAt);
			expect(updated!.updated_at > originalUpdatedAt).toBe(true);
		});
	});

	// ─── delete ───────────────────────────────────────────────

	describe("delete()", () => {
		it("27. deletes existing target, findById returns null after", async () => {
			const target = await repo.create(createMinimalInput());
			await repo.delete(target.id);

			const found = await repo.findById(target.id);
			expect(found).toBeNull();
		});

		it("28. returns true for existing target", async () => {
			const target = await repo.create(createMinimalInput());
			const result = await repo.delete(target.id);
			expect(result).toBe(true);
		});
	});

	// ─── BUG TEST - delete non-existent (#6) ─────────────────

	describe("BUG: delete non-existent (#6)", () => {
		it("29. delete() for non-existent ID -> should return false (FIXED)", async () => {
			// BUG: The delete method always returns true regardless of whether
			// the row existed. It should check the result.changes count.
			const result = await repo.delete("00000000-0000-0000-0000-000000000000");
			expect(result).toBe(false);
		});
	});

	// ─── Integration ─────────────────────────────────────────

	describe("Integration", () => {
		it("30. full CRUD lifecycle: create -> findById -> update -> findAll -> delete -> findAll empty", async () => {
			// Create
			const created = await repo.create(createMinimalInput({
				name: "Lifecycle Target",
				topics: ["lifecycle"],
			}));
			expect(created.id).toBeDefined();
			expect(created.name).toBe("Lifecycle Target");

			// FindById
			const found = await repo.findById(created.id);
			expect(found).not.toBeNull();
			expect(found!.id).toBe(created.id);

			// Update
			const updated = await repo.update(created.id, {
				name: "Updated Lifecycle Target",
				description: "Now with description",
			});
			expect(updated).not.toBeNull();
			expect(updated!.name).toBe("Updated Lifecycle Target");
			expect(updated!.description).toBe("Now with description");

			// FindAll
			const all = await repo.findAll();
			expect(all).toHaveLength(1);
			expect(all[0].name).toBe("Updated Lifecycle Target");

			// Delete
			const deleted = await repo.delete(created.id);
			expect(deleted).toBe(true);

			// FindAll empty
			const afterDelete = await repo.findAll();
			expect(afterDelete).toEqual([]);
		});

		it("31. create multiple targets, findAll returns all", async () => {
			const t1 = await repo.create(createMinimalInput({ name: "Alpha", url: "https://alpha.com" }));
			const t2 = await repo.create(createMinimalInput({ name: "Beta", url: "https://beta.com" }));
			const t3 = await repo.create(createMinimalInput({ name: "Gamma", url: "https://gamma.com" }));

			const all = await repo.findAll();
			expect(all).toHaveLength(3);

			const ids = all.map((t) => t.id);
			expect(ids).toContain(t1.id);
			expect(ids).toContain(t2.id);
			expect(ids).toContain(t3.id);
		});

		it("32. delete one of multiple, findAll returns rest", async () => {
			const t1 = await repo.create(createMinimalInput({ name: "Keep1" }));
			const t2 = await repo.create(createMinimalInput({ name: "Delete Me" }));
			const t3 = await repo.create(createMinimalInput({ name: "Keep2" }));

			await repo.delete(t2.id);

			const all = await repo.findAll();
			expect(all).toHaveLength(2);

			const names = all.map((t) => t.name);
			expect(names).toContain("Keep1");
			expect(names).toContain("Keep2");
			expect(names).not.toContain("Delete Me");

			// Verify deleted one is gone
			const found = await repo.findById(t2.id);
			expect(found).toBeNull();
		});
	});
});
