#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
	GeoLLMClient,
	type PipelineConfig,
	type PipelineDeps,
	ProviderConfigManager,
	initWorkspace,
	loadSettings,
	runPipeline,
} from "@geo-agent/core";
import { classifySite } from "@geo-agent/core/prompts/template-engine.js";
import { startServer } from "@geo-agent/dashboard";
import { crawlTarget, scoreTarget } from "@geo-agent/skills";
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
		console.log(`📊 Dashboard: http://localhost:${port}/dashboard`);
	});

// ── geo run ──────────────────────────────────────────────
program
	.command("run")
	.description("Run the GEO optimization pipeline for a target URL")
	.argument("<url>", "Target URL to analyze and optimize")
	.option("-n, --name <name>", "Target name")
	.option("-s, --score <score>", "Target score (0-100)", "80")
	.option("-c, --cycles <cycles>", "Max optimization cycles", "5")
	.option("-o, --output <dir>", "Output directory for reports")
	.option(
		"--provider <provider>",
		"LLM provider (openai, microsoft, anthropic, google)",
		"microsoft",
	)
	.option("--api-key <key>", "LLM API key")
	.option("--api-base <url>", "LLM API base URL (for Azure)")
	.option("--model <model>", "LLM model/deployment name")
	.option("--no-llm", "Skip LLM-dependent features (probes, strategy enhancement)")
	.action(async (url, opts) => {
		const settings = loadSettings();
		initWorkspace(settings);

		const targetName = opts.name || new URL(url).hostname;
		const targetScore = Number.parseInt(opts.score, 10);
		const maxCycles = Number.parseInt(opts.cycles, 10);
		const outputDir =
			opts.output || path.join(process.env.USERPROFILE || process.env.HOME || ".", "Documents");

		console.log("🔍 GEO Agent — Pipeline Runner");
		console.log(`   Target: ${url}`);
		console.log(`   Name: ${targetName}`);
		console.log(`   Target Score: ${targetScore}`);
		console.log(`   Max Cycles: ${maxCycles}`);
		console.log(`   Output: ${outputDir}`);
		console.log();

		// Configure LLM (필수 — ARCHITECTURE.md 9-A.1)
		if (!opts.apiKey) {
			console.error("❌ LLM API Key가 필요합니다. --api-key 옵션으로 API Key를 지정하세요.");
			console.error("   예: geo run https://example.com --api-key sk-xxx");
			process.exit(1);
		}

		const manager = new ProviderConfigManager(settings.workspace_dir);
		const providerId = opts.provider || "microsoft";

		// Disable all, enable selected
		for (const p of manager.loadAll()) {
			manager.save({ ...p, enabled: false });
		}
		const provider = manager.load(providerId);
		manager.save({
			...provider,
			enabled: true,
			api_key: opts.apiKey,
			api_base_url: opts.apiBase || provider.api_base_url,
			default_model: opts.model || provider.default_model,
		});

		const client = new GeoLLMClient(settings.workspace_dir);
		const chatLLM: PipelineDeps["chatLLM"] = (req) => client.chat(req);
		console.log(`   LLM: ${providerId} (${opts.model || provider.default_model})`);
		console.log();

		// Build pipeline deps
		const deps: PipelineDeps = {
			crawlTarget,
			scoreTarget,
			classifySite,
			chatLLM,
		};

		const config: PipelineConfig = {
			target_id: `target-${Date.now()}`,
			target_url: url,
			workspace_dir: settings.workspace_dir,
			target_score: targetScore,
			max_cycles: maxCycles,
		};

		// Run pipeline
		console.log("⏳ Running pipeline...");
		console.log("   ANALYZING → CLONING → STRATEGIZING → OPTIMIZING → VALIDATING → REPORTING");
		console.log();

		const result = await runPipeline(config, deps);

		// Output results
		console.log("═══════════════════════════════════════════");
		if (result.success) {
			console.log("✅ Pipeline completed successfully!");
		} else {
			console.log("❌ Pipeline failed:", result.error);
		}
		console.log(`   Initial Score: ${result.initial_score}`);
		console.log(`   Final Score:   ${result.final_score}`);
		console.log(`   Delta:         ${result.delta >= 0 ? "+" : ""}${result.delta}`);
		console.log(`   Cycles:        ${result.cycles_completed}`);

		// Save dashboard HTML
		if (result.dashboard_html) {
			const htmlPath = path.join(
				outputDir,
				`${targetName.replace(/[^a-zA-Z0-9]/g, "_")}_GEO_report.html`,
			);
			fs.writeFileSync(htmlPath, result.dashboard_html, "utf-8");
			console.log(`   Dashboard:     ${htmlPath}`);
		}

		if (result.report_path) {
			console.log(`   Archive:       ${result.report_path}`);
		}
		console.log("═══════════════════════════════════════════");
	});

// ── geo analyze ──────────────────────────────────────────
program
	.command("analyze")
	.description("Quick analysis of a target URL (no optimization)")
	.argument("<url>", "Target URL to analyze")
	.action(async (url) => {
		console.log(`🔍 Analyzing ${url}...`);
		console.log();

		const data = await crawlTarget(url, 15000);
		const classification = classifySite(data.html, data.url);
		const scores = scoreTarget(data);

		console.log(`📊 Site: ${data.title}`);
		console.log(
			`   Type: ${classification.site_type} (confidence: ${classification.confidence.toFixed(2)})`,
		);
		console.log(`   Overall Score: ${scores.overall_score}/100`);
		console.log(`   Grade: ${scores.grade}`);
		console.log();
		console.log("   Dimensions:");
		for (const d of scores.dimensions) {
			const bar = "█".repeat(Math.floor(d.score / 5)) + "░".repeat(20 - Math.floor(d.score / 5));
			console.log(`   ${d.id} ${d.label.padEnd(20)} ${bar} ${d.score}/100`);
		}
		console.log();
		console.log("   Key findings:");
		for (const d of scores.dimensions) {
			for (const detail of d.details) {
				console.log(
					`     ${d.score >= 70 ? "✅" : d.score >= 40 ? "⚠️" : "❌"} [${d.id}] ${detail}`,
				);
			}
		}
	});

// ── geo stop ──────────────────────────────────────────────
program
	.command("stop")
	.description("Stop the GEO Agent dashboard server")
	.option("-p, --port <port>", "Server port to stop", "3000")
	.action(async (opts) => {
		const port = Number.parseInt(opts.port, 10);
		console.log("🛑 Stopping GEO Agent System...");
		try {
			const res = await fetch(`http://localhost:${port}/health`, {
				signal: AbortSignal.timeout(3000),
			});
			if (res.ok) {
				// Server is running — send shutdown request
				try {
					await fetch(`http://localhost:${port}/api/shutdown`, {
						method: "POST",
						signal: AbortSignal.timeout(5000),
					});
					console.log("✅ Server shutdown requested.");
				} catch {
					console.log("⚠️ Server running but doesn't support graceful shutdown.");
					console.log("   Use Ctrl+C in the server terminal, or:");
					console.log(`   taskkill /F /FI "WINDOWTITLE eq *geo*" (Windows)`);
					console.log(`   pkill -f "geo.*start" (Linux/macOS)`);
				}
			}
		} catch {
			console.log(`ℹ️  No server found on port ${port}.`);
		}
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
