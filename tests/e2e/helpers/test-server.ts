import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Minimal server interface — compatible with @hono/node-server ServerType */
interface Closeable {
	close(cb?: (err?: Error) => void): unknown;
}

export interface TestServerContext {
	baseUrl: string;
	port: number;
	workspaceDir: string;
	stop: () => Promise<void>;
}

/**
 * Get a free port from the OS ephemeral range.
 * Uses port 0 to let the OS assign an available port.
 */
export async function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, () => {
			const { port } = srv.address() as net.AddressInfo;
			srv.close((err) => (err ? reject(err) : resolve(port)));
		});
		srv.on("error", reject);
	});
}

/**
 * Start a GEO Agent server with an isolated workspace and dynamic port.
 * Each call creates a fresh temp directory and DB.
 */
export async function startTestServer(): Promise<TestServerContext> {
	const workspaceDir = path.join(
		os.tmpdir(),
		`geo-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);

	// Create workspace subdirectories
	for (const sub of ["data", "prompts", "snapshots", "patches", "clones", "reports"]) {
		fs.mkdirSync(path.join(workspaceDir, sub), { recursive: true });
	}

	// Set env BEFORE importing server (loadSettings reads this)
	process.env.GEO_WORKSPACE = workspaceDir;

	// Dynamic import to pick up the env var
	const { startServer } = await import("../../../packages/dashboard/src/server.js");

	const port = await getFreePort();
	const { server } = await startServer(port);

	const baseUrl = `http://localhost:${port}`;

	const stop = async () => {
		await new Promise<void>((resolve, reject) => {
			(server as Closeable).close((err?: Error) => (err ? reject(err) : resolve()));
		});
		try {
			fs.rmSync(workspaceDir, { recursive: true, force: true });
		} catch {
			// Windows may hold file handles briefly
		}
	};

	return { baseUrl, port, workspaceDir, stop };
}
