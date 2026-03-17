import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { targetsRouter } from "./routes/targets.js";
import { settingsRouter } from "./routes/settings.js";
import {
	loadSettings,
	initWorkspace,
	createDatabase,
} from "@geo-agent/core";

const app = new Hono();

// Middleware
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// API routes
app.route("/api/targets", targetsRouter);
app.route("/api/settings", settingsRouter);

// Root redirect
app.get("/", (c) => c.json({
	name: "GEO Agent Dashboard",
	version: "0.1.0",
	endpoints: [
		"/health",
		"/api/targets",
		"/api/settings/agents/prompts",
		"/api/settings/llm-providers",
	],
}));

export { app };

/**
 * Starts the dashboard server.
 */
export async function startServer(port?: number) {
	const settings = loadSettings();
	initWorkspace(settings);
	const db = createDatabase(settings);

	const serverPort = port ?? settings.port;

	console.log(`🌐 GEO Agent Dashboard starting on http://localhost:${serverPort}`);

	serve({
		fetch: app.fetch,
		port: serverPort,
	});

	console.log(`✅ GEO Agent Dashboard running on http://localhost:${serverPort}`);
	return { settings, db };
}
