import {
	CreateTargetSchema,
	type GeoDatabase,
	TargetRepository,
	UpdateTargetSchema,
} from "@geo-agent/core";
import { Hono } from "hono";

let sharedRepo: TargetRepository | null = null;

/**
 * Injects a shared database connection for all target routes.
 * Must be called once at startup before handling requests.
 */
export function initTargetsRouter(db: GeoDatabase): void {
	sharedRepo = new TargetRepository(db);
}

function getRepo(): TargetRepository {
	if (!sharedRepo) {
		throw new Error("Targets router not initialized. Call initTargetsRouter(db) at startup.");
	}
	return sharedRepo;
}

const targetsRouter = new Hono();

// GET /api/targets — List all targets
targetsRouter.get("/", async (c) => {
	const repo = getRepo();
	const targets = await repo.findAll();
	return c.json(targets);
});

// GET /api/targets/:id — Get a single target
targetsRouter.get("/:id", async (c) => {
	const repo = getRepo();
	const target = await repo.findById(c.req.param("id"));
	if (!target) {
		return c.json({ error: "Target not found" }, 404);
	}
	return c.json(target);
});

// POST /api/targets — Create a new target
targetsRouter.post("/", async (c) => {
	const repo = getRepo();
	const body = await c.req.json();
	const parsed = CreateTargetSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);
	}
	const target = await repo.create(parsed.data);
	return c.json(target, 201);
});

// PUT /api/targets/:id — Update a target
targetsRouter.put("/:id", async (c) => {
	const repo = getRepo();
	const body = await c.req.json();
	const parsed = UpdateTargetSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);
	}
	const target = await repo.update(c.req.param("id"), parsed.data);
	if (!target) {
		return c.json({ error: "Target not found" }, 404);
	}
	return c.json(target);
});

// DELETE /api/targets/:id — Delete a target
targetsRouter.delete("/:id", async (c) => {
	const repo = getRepo();
	const deleted = await repo.delete(c.req.param("id"));
	if (!deleted) {
		return c.json({ error: "Target not found" }, 404);
	}
	return c.json({ deleted: true });
});

export { targetsRouter };
