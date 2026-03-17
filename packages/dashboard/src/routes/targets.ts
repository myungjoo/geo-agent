import { Hono } from "hono";
import {
	loadSettings,
	createDatabase,
	CreateTargetSchema,
	UpdateTargetSchema,
} from "@geo-agent/core";
import { TargetRepository } from "@geo-agent/core";

const targetsRouter = new Hono();

function getRepo() {
	const settings = loadSettings();
	const db = createDatabase(settings);
	return new TargetRepository(db);
}

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
	await repo.delete(c.req.param("id"));
	return c.json({ deleted: true });
});

export { targetsRouter };
