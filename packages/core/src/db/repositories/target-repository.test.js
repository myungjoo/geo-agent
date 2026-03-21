import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../schema.js";
import { TargetRepository } from "./target-repository.js";
const CREATE_TABLE_SQL = `
CREATE TABLE targets (
	id TEXT PRIMARY KEY,
	url TEXT NOT NULL,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	brand TEXT NOT NULL DEFAULT '',
	topics TEXT NOT NULL DEFAULT '[]',
	target_queries TEXT NOT NULL DEFAULT '[]',
	audience TEXT NOT NULL DEFAULT '',
	competitors TEXT NOT NULL DEFAULT '[]',
	business_goal TEXT NOT NULL DEFAULT '',
	target_score REAL,
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
function createMinimalInput(overrides = {}) {
	return {
		url: "https://example.com",
		name: "Test Target",
		...overrides,
	};
}
describe("TargetRepository", () => {
	let repo;
	beforeEach(async () => {
		const client = createClient({ url: ":memory:" });
		await client.executeMultiple(CREATE_TABLE_SQL);
		const db = drizzle(client, { schema });
		repo = new TargetRepository(db);
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
			await repo.create(
				createMinimalInput({
					topics: ["seo", "ai"],
					competitors: [{ url: "https://rival.com", name: "Rival", relationship: "direct" }],
				}),
			);
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
			expect(found.id).toBe(created.id);
			expect(found.name).toBe("Find Me");
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
			const input = {
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
			expect(target.id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
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
		it("14. topics array round-trips correctly", async () => {
			const target = await repo.create(
				createMinimalInput({ topics: ["seo", "content-marketing"] }),
			);
			const found = await repo.findById(target.id);
			expect(Array.isArray(found.topics)).toBe(true);
			expect(found.topics).toEqual(["seo", "content-marketing"]);
		});
		it("15. competitors array round-trips correctly", async () => {
			const competitors = [
				{ url: "https://rival.com", name: "Rival", relationship: "direct" },
				{ url: "https://other.com", name: "Other", relationship: "indirect" },
			];
			const target = await repo.create(createMinimalInput({ competitors }));
			const found = await repo.findById(target.id);
			expect(Array.isArray(found.competitors)).toBe(true);
			expect(found.competitors).toHaveLength(2);
			expect(found.competitors[0].url).toBe("https://rival.com");
		});
		it("16. notifications object round-trips correctly", async () => {
			const notifications = {
				on_score_drop: true,
				on_external_change: false,
				on_optimization_complete: true,
				channels: ["dashboard", "email"],
			};
			const target = await repo.create(createMinimalInput({ notifications }));
			const found = await repo.findById(target.id);
			expect(typeof found.notifications).toBe("object");
			expect(found.notifications.on_score_drop).toBe(true);
			expect(found.notifications.on_external_change).toBe(false);
			expect(found.notifications.channels).toEqual(["dashboard", "email"]);
		});
		it("17. update topics round-trips correctly", async () => {
			const target = await repo.create(createMinimalInput());
			await repo.update(target.id, { topics: ["new-topic-1", "new-topic-2"] });
			const found = await repo.findById(target.id);
			expect(Array.isArray(found.topics)).toBe(true);
			expect(found.topics).toEqual(["new-topic-1", "new-topic-2"]);
		});
		it("18. empty arrays round-trip correctly", async () => {
			const target = await repo.create(
				createMinimalInput({
					topics: [],
					target_queries: [],
					competitors: [],
					llm_priorities: [],
				}),
			);
			const found = await repo.findById(target.id);
			expect(found.topics).toEqual([]);
			expect(found.target_queries).toEqual([]);
			expect(found.competitors).toEqual([]);
			expect(found.llm_priorities).toEqual([]);
		});
	});
	// ─── BUG TEST - notifications null (#2) ──────────────────
	describe("BUG: notifications null (#2)", () => {
		it("19. create() without notifications -> default config applied", async () => {
			const target = await repo.create(createMinimalInput());
			const found = await repo.findById(target.id);
			expect(found.notifications).not.toBeNull();
			expect(found.notifications).toBeDefined();
			expect(typeof found.notifications).toBe("object");
		});
	});
	// ─── update ───────────────────────────────────────────────
	describe("update()", () => {
		it("20. updates only specified fields", async () => {
			const target = await repo.create(
				createMinimalInput({
					name: "Original Name",
					description: "Original Description",
					audience: "Original Audience",
				}),
			);
			const updated = await repo.update(target.id, { name: "Updated Name" });
			expect(updated.name).toBe("Updated Name");
			expect(updated.description).toBe("Original Description");
			expect(updated.audience).toBe("Original Audience");
		});
		it("21. updates url field", async () => {
			const target = await repo.create(createMinimalInput());
			const updated = await repo.update(target.id, { url: "https://new-url.com" });
			expect(updated.url).toBe("https://new-url.com");
		});
		it("22. updates name field", async () => {
			const target = await repo.create(createMinimalInput());
			const updated = await repo.update(target.id, { name: "New Name" });
			expect(updated.name).toBe("New Name");
		});
		it("23. updates topics array", async () => {
			const target = await repo.create(createMinimalInput({ topics: ["old"] }));
			const updated = await repo.update(target.id, { topics: ["new1", "new2"] });
			expect(updated.topics).toEqual(["new1", "new2"]);
		});
		it("24. updates site_type", async () => {
			const target = await repo.create(createMinimalInput());
			expect(target.site_type).toBe("generic");
			const updated = await repo.update(target.id, { site_type: "manufacturer" });
			expect(updated.site_type).toBe("manufacturer");
		});
		it("25. returns null for non-existent ID", async () => {
			const result = await repo.update("00000000-0000-0000-0000-000000000000", { name: "X" });
			expect(result).toBeNull();
		});
		it("26. updates updated_at timestamp", async () => {
			const target = await repo.create(createMinimalInput());
			await new Promise((resolve) => setTimeout(resolve, 10));
			const updated = await repo.update(target.id, { name: "Timestamp Test" });
			expect(updated.updated_at).not.toBe(target.updated_at);
			expect(updated.updated_at > target.updated_at).toBe(true);
		});
	});
	// ─── delete ───────────────────────────────────────────────
	describe("delete()", () => {
		it("27. deletes existing target", async () => {
			const target = await repo.create(createMinimalInput());
			await repo.delete(target.id);
			expect(await repo.findById(target.id)).toBeNull();
		});
		it("28. returns true for existing target", async () => {
			const target = await repo.create(createMinimalInput());
			expect(await repo.delete(target.id)).toBe(true);
		});
		it("29. returns false for non-existent ID (Bug #6)", async () => {
			expect(await repo.delete("00000000-0000-0000-0000-000000000000")).toBe(false);
		});
	});
	// ─── Integration ─────────────────────────────────────────
	describe("Integration", () => {
		it("30. full CRUD lifecycle", async () => {
			const created = await repo.create(
				createMinimalInput({ name: "Lifecycle Target", topics: ["lifecycle"] }),
			);
			expect(created.id).toBeDefined();
			const found = await repo.findById(created.id);
			expect(found.id).toBe(created.id);
			const updated = await repo.update(created.id, {
				name: "Updated Lifecycle",
				description: "Desc",
			});
			expect(updated.name).toBe("Updated Lifecycle");
			expect(await repo.findAll()).toHaveLength(1);
			expect(await repo.delete(created.id)).toBe(true);
			expect(await repo.findAll()).toEqual([]);
		});
		it("31. create multiple, findAll returns all", async () => {
			const t1 = await repo.create(createMinimalInput({ name: "Alpha", url: "https://alpha.com" }));
			const t2 = await repo.create(createMinimalInput({ name: "Beta", url: "https://beta.com" }));
			const t3 = await repo.create(createMinimalInput({ name: "Gamma", url: "https://gamma.com" }));
			const all = await repo.findAll();
			expect(all).toHaveLength(3);
			expect(all.map((t) => t.id)).toContain(t1.id);
			expect(all.map((t) => t.id)).toContain(t2.id);
			expect(all.map((t) => t.id)).toContain(t3.id);
		});
		it("32. delete one of multiple, rest remain", async () => {
			const t1 = await repo.create(createMinimalInput({ name: "Keep1" }));
			const t2 = await repo.create(createMinimalInput({ name: "Delete Me" }));
			const t3 = await repo.create(createMinimalInput({ name: "Keep2" }));
			await repo.delete(t2.id);
			const all = await repo.findAll();
			expect(all).toHaveLength(2);
			expect(all.map((t) => t.name)).not.toContain("Delete Me");
		});
	});
});
//# sourceMappingURL=target-repository.test.js.map
