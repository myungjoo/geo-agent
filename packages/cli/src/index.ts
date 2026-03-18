#!/usr/bin/env node

import { initWorkspace, loadSettings } from "@geo-agent/core";
import { startServer } from "@geo-agent/dashboard";
import { Command } from "commander";

const program = new Command();

program.name("geo").description("GEO Agent System CLI").version("0.1.0");

// ── geo start ─────────────────────────────────────────────
program
	.command("start")
	.description("Start the GEO Agent dashboard server")
	.option("-p, --port <port>", "Server port", "3000")
	.action(async (opts) => {
		const port = Number.parseInt(opts.port, 10);
		const settings = loadSettings();
		initWorkspace(settings);

		console.log("🚀 Starting GEO Agent System...");
		await startServer(port);
	});

// ── geo stop ──────────────────────────────────────────────
program
	.command("stop")
	.description("Stop the GEO Agent dashboard server")
	.action(() => {
		console.log("🛑 Stopping GEO Agent System...");
		// TODO: Implement graceful shutdown via PID file or signal
		console.log("⚠️  Not yet implemented. Use Ctrl+C to stop the server.");
	});

// ── geo status ────────────────────────────────────────────
program
	.command("status")
	.description("Show the current status of the GEO Agent system")
	.action(() => {
		const settings = loadSettings();
		console.log("📊 GEO Agent Status");
		console.log(`   Workspace: ${settings.workspace_dir}`);
		console.log(`   Port:      ${settings.port}`);
		console.log(`   Model:     ${settings.default_model}`);
		// TODO: Check if server is running
	});

// ── geo init ──────────────────────────────────────────────
program
	.command("init")
	.description("Initialize the GEO Agent workspace")
	.option("-d, --dir <directory>", "Workspace directory")
	.action((opts) => {
		const settings = loadSettings(opts.dir);
		initWorkspace(settings);
		console.log(`✅ Workspace initialized at ${settings.workspace_dir}`);
	});

program.parse();
