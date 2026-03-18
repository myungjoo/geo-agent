import pino from "pino";

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export const logger = pino({
	level: process.env.LOG_LEVEL ?? (isTest ? "silent" : "info"),
	transport:
		!isTest && process.env.NODE_ENV !== "production"
			? { target: "pino-pretty", options: { colorize: true } }
			: undefined,
});

export function createChildLogger(name: string) {
	return logger.child({ module: name });
}
