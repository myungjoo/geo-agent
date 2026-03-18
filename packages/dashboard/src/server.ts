import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { targetsRouter } from "./routes/targets.js";
import { settingsRouter } from "./routes/settings.js";
import { pipelineRouter } from "./routes/pipeline.js";
import {
	loadSettings,
	initWorkspace,
	type AppSettings,
} from "@geo-agent/core";

const app = new Hono();

// Middleware
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// API routes
app.route("/api/targets", targetsRouter);
app.route("/api/targets", pipelineRouter);
app.route("/api/settings", settingsRouter);

// Root redirect
app.get("/", (c) => c.json({
	name: "GEO Agent Dashboard",
	version: "0.2.0",
	endpoints: [
		"/health",
		"/api/targets",
		"/api/targets/:id/pipeline",
		"/api/targets/:id/cycle/status",
		"/api/settings/agents/prompts",
		"/api/settings/llm-providers",
	],
}));

export { app };

/**
 * Starts the dashboard server.
 */
export async function startServer(port?: number): Promise<{ settings: AppSettings }> {
	const settings = loadSettings();
	initWorkspace(settings);

	const serverPort = port ?? settings.port;

	console.log(`🌐 GEO Agent Dashboard starting on http://localhost:${serverPort}`);

	serve({
		fetch: app.fetch,
		port: serverPort,
	});

	console.log(`✅ GEO Agent Dashboard running on http://localhost:${serverPort}`);
	return { settings };
}
