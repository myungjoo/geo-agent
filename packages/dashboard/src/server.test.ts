import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `geo-server-test-${Date.now()}`);
process.env.GEO_WORKSPACE = testDir;

// Ensure workspace directories exist
fs.mkdirSync(path.join(testDir, "data"), { recursive: true });
fs.mkdirSync(path.join(testDir, "prompts"), { recursive: true });

// createDatabase() now auto-creates tables, no manual setup needed
const { startServer } = await import("./server.js");

afterAll(() => {
	try {
		fs.rmSync(testDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors on Windows
	}
});

describe("BUG #3 [FIXED]: EADDRINUSE handling", () => {
	it("startServer() rejects with EADDRINUSE when port is occupied", async () => {
		// Occupy a port first
		const blocker = net.createServer();
		const port = await new Promise<number>((resolve) => {
			blocker.listen(0, "127.0.0.1", () => {
				const addr = blocker.address() as net.AddressInfo;
				resolve(addr.port);
			});
		});

		try {
			// Try to start the server on the same port — should reject, not crash
			await expect(startServer(port, "127.0.0.1")).rejects.toThrow();
		} finally {
			blocker.close();
		}
	});
});
