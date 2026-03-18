import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AppSettings,
	createDatabase,
	ensureTables,
	initWorkspace,
	loadSettings,
} from "@geo-agent/core";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { trimTrailingSlash } from "hono/trailing-slash";
import { initPipelineRouter, pipelineRouter } from "./routes/pipeline.js";
import { settingsRouter } from "./routes/settings.js";
import { initTargetsRouter, targetsRouter } from "./routes/targets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = new Hono();

// Middleware
app.use("*", cors());
app.use(trimTrailingSlash());

// Error handler (Bug #4: malformed JSON → 400, DB schema mismatch → 503)
app.onError((err, c) => {
	if (err instanceof SyntaxError && err.message.includes("JSON")) {
		return c.json({ error: "Invalid JSON in request body" }, 400);
	}

	// DB schema mismatch (e.g. "table X has no column named Y")
	const msg = err.message || "";
	if (msg.includes("has no column named") || msg.includes("no such column")) {
		const hint =
			"Database schema is outdated. Delete the DB file and restart the server to recreate it.";
		console.error(`❌ DB schema mismatch: ${msg}`);
		console.error(`   ${hint}`);
		return c.json({ error: "Database schema mismatch", message: msg, hint }, 503);
	}

	// Router not initialized
	if (msg.includes("router not initialized")) {
		console.error(`❌ ${msg}`);
		return c.json(
			{ error: "Server not ready", message: "Database connection not initialized." },
			503,
		);
	}

	console.error("Unhandled error:", err);
	return c.json({ error: "Internal server error", message: msg }, 500);
});

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// API routes
app.route("/api/targets", targetsRouter);
app.route("/api/targets", pipelineRouter);
app.route("/api/settings", settingsRouter);

// Dashboard UI — serve single HTML SPA
let dashboardHtmlCache: string | null = null;

function getDashboardHtml(): string {
	if (!dashboardHtmlCache) {
		// Try src/ first (dev), then fall back to dist/ (built)
		const candidates = [
			join(__dirname, "ui", "dashboard.html"),
			join(__dirname, "..", "src", "ui", "dashboard.html"),
		];
		for (const p of candidates) {
			try {
				dashboardHtmlCache = readFileSync(p, "utf-8");
				break;
			} catch {
				// try next
			}
		}
		if (!dashboardHtmlCache) {
			dashboardHtmlCache = "<html><body><h1>Dashboard HTML not found</h1></body></html>";
		}
	}
	return dashboardHtmlCache;
}

app.get("/dashboard", (c) => {
	return c.html(getDashboardHtml());
});

// Root — API info + dashboard link
app.get("/", (c) =>
	c.json({
		name: "GEO Agent Dashboard",
		version: "0.3.0",
		dashboard: "/dashboard",
		endpoints: [
			"/health",
			"/dashboard",
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

	// Initialize database and inject into routers
	const db = createDatabase(settings);
	await ensureTables(db);
	initTargetsRouter(db);
	initPipelineRouter(db, settings);

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
