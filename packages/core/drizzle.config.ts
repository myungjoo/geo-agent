import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = path.resolve(
	process.env.GEO_WORKSPACE ??
		path.join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".geo-agent"),
	"data",
	"geo-agent.db",
);

export default defineConfig({
	schema: path.resolve(__dirname, "src/db/schema.ts"),
	out: path.resolve(__dirname, "drizzle"),
	dialect: "sqlite",
	dbCredentials: {
		url: dbPath,
	},
});
