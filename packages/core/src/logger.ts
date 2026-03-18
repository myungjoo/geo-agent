import { createRequire } from "node:module";
import pino from "pino";

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

function hasPinoPretty(): boolean {
	try {
		const require = createRequire(import.meta.url);
		require.resolve("pino-pretty");
		return true;
	} catch {
		return false;
	}
}

const usePretty = !isTest && process.env.NODE_ENV !== "production" && hasPinoPretty();

export const logger = pino({
	level: process.env.LOG_LEVEL ?? (isTest ? "silent" : "info"),
	transport: usePretty ? { target: "pino-pretty", options: { colorize: true } } : undefined,
});

export function createChildLogger(name: string) {
	return logger.child({ module: name });
}
