import { type AppSettings, initWorkspace, loadSettings } from "@geo-agent/core";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { trimTrailingSlash } from "hono/trailing-slash";
import { pipelineRouter } from "./routes/pipeline.js";
import { settingsRouter } from "./routes/settings.js";
import { targetsRouter } from "./routes/targets.js";

const app = new Hono();

// Middleware
app.use("*", cors());
app.use(trimTrailingSlash());

// Error handler (Bug #4: malformed JSON → 400)
app.onError((err, c) => {
	if (err instanceof SyntaxError && err.message.includes("JSON")) {
		return c.json({ error: "Invalid JSON in request body" }, 400);
	}
	return c.json({ error: "Internal server error" }, 500);
});

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// API routes
app.route("/api/targets", targetsRouter);
app.route("/api/targets", pipelineRouter);
app.route("/api/settings", settingsRouter);

// Root redirect
app.get("/", (c) =>
	c.json({
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
	}),
);

export { app };

/**
 * Starts the dashboard server.
 */
export async function startServer(port?: number): Promise<{ settings: AppSettings }> {
	const settings = loadSettings();
	initWorkspace(settings);

	const serverPort = port ?? settings.port;

	return new Promise((resolve, reject) => {
		const server = serve({
			fetch: app.fetch,
			port: serverPort,
		});

		server.on("listening", () => {
			console.log(`✅ GEO Agent Dashboard running on http://localhost:${serverPort}`);
			resolve({ settings });
		});

		server.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EADDRINUSE") {
				console.error(`❌ Port ${serverPort} is already in use.`);
			}
			reject(err);
		});
	});
}
