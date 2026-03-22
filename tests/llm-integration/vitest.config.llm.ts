import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/llm-integration/**/*.test.ts"],
		testTimeout: 60_000,
		hookTimeout: 15_000,
		pool: "forks",
		fileParallelism: false,
	},
});
