import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	OAuthCredentialsSchema,
	OAuthManager,
	OAuthProviderSchema,
	OAuthStateSchema,
	OAuthTokenSchema,
} from "./oauth-manager.js";
let tmpDirs = [];
function makeTmpDir() {
	const dir = path.join(os.tmpdir(), `geo-oauth-test-${crypto.randomBytes(8).toString("hex")}`);
	fs.mkdirSync(dir, { recursive: true });
	tmpDirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of tmpDirs) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}
	tmpDirs = [];
});
function makeToken(provider, overrides = {}) {
	return {
		access_token: "test-access-token",
		refresh_token: "test-refresh-token",
		token_type: "Bearer",
		expires_at: Date.now() + 3600 * 1000,
		scope: "test-scope",
		provider,
		...overrides,
	};
}
// ── Schema Tests ─────────────────────────────────────────
describe("OAuth Schemas", () => {
	it("OAuthProviderSchema validates google/microsoft", () => {
		expect(OAuthProviderSchema.safeParse("google").success).toBe(true);
		expect(OAuthProviderSchema.safeParse("microsoft").success).toBe(true);
		expect(OAuthProviderSchema.safeParse("facebook").success).toBe(false);
	});
	it("OAuthCredentialsSchema validates correctly", () => {
		const valid = OAuthCredentialsSchema.safeParse({
			client_id: "test-id",
			client_secret: "test-secret",
			redirect_uri: "http://localhost:3000/callback",
		});
		expect(valid.success).toBe(true);
	});
	it("OAuthCredentialsSchema rejects empty client_id", () => {
		const invalid = OAuthCredentialsSchema.safeParse({
			client_id: "",
			client_secret: "test",
			redirect_uri: "http://localhost:3000/callback",
		});
		expect(invalid.success).toBe(false);
	});
	it("OAuthTokenSchema validates a complete token", () => {
		const valid = OAuthTokenSchema.safeParse({
			access_token: "at-123",
			refresh_token: "rt-456",
			token_type: "Bearer",
			expires_at: Date.now() + 3600000,
			provider: "google",
		});
		expect(valid.success).toBe(true);
	});
	it("OAuthStateSchema provides defaults", () => {
		const state = OAuthStateSchema.parse({});
		expect(state.tokens).toEqual({});
		expect(state.credentials).toEqual({});
	});
});
// ── OAuthManager Tests ───────────────────────────────────
describe("OAuthManager", () => {
	it("creates auth directory on construction", () => {
		const dir = makeTmpDir();
		new OAuthManager(dir);
		expect(fs.existsSync(path.join(dir, "auth"))).toBe(true);
	});
	it("loads existing state from disk", () => {
		const dir = makeTmpDir();
		const manager1 = new OAuthManager(dir);
		manager1.setCredentials("google", {
			client_id: "id-1",
			client_secret: "secret-1",
			redirect_uri: "http://localhost:3000/callback",
		});
		// New instance should load saved state
		const manager2 = new OAuthManager(dir);
		const creds = manager2.getCredentials("google");
		expect(creds).not.toBeNull();
		expect(creds.client_id).toBe("id-1");
	});
	it("handles corrupted state file gracefully", () => {
		const dir = makeTmpDir();
		fs.mkdirSync(path.join(dir, "auth"), { recursive: true });
		fs.writeFileSync(path.join(dir, "auth", "oauth-state.json"), "NOT JSON");
		const manager = new OAuthManager(dir);
		expect(manager.getCredentials("google")).toBeNull();
	});
	describe("Credentials management", () => {
		it("sets and gets credentials", () => {
			const manager = new OAuthManager(makeTmpDir());
			manager.setCredentials("google", {
				client_id: "gid",
				client_secret: "gsecret",
				redirect_uri: "http://localhost:3000/callback",
			});
			const creds = manager.getCredentials("google");
			expect(creds.client_id).toBe("gid");
			expect(creds.client_secret).toBe("gsecret");
		});
		it("returns null for unconfigured provider", () => {
			const manager = new OAuthManager(makeTmpDir());
			expect(manager.getCredentials("microsoft")).toBeNull();
		});
		it("validates credentials on set", () => {
			const manager = new OAuthManager(makeTmpDir());
			expect(() =>
				manager.setCredentials("google", {
					client_id: "",
					client_secret: "s",
					redirect_uri: "http://localhost:3000/cb",
				}),
			).toThrow();
		});
	});
	describe("Authorization URL", () => {
		it("generates Google auth URL", () => {
			const manager = new OAuthManager(makeTmpDir());
			manager.setCredentials("google", {
				client_id: "gid",
				client_secret: "gs",
				redirect_uri: "http://localhost:3000/cb",
			});
			const url = manager.getAuthorizationUrl("google");
			expect(url).toContain("accounts.google.com");
			expect(url).toContain("client_id=gid");
			expect(url).toContain("response_type=code");
		});
		it("generates Microsoft auth URL", () => {
			const manager = new OAuthManager(makeTmpDir());
			manager.setCredentials("microsoft", {
				client_id: "mid",
				client_secret: "ms",
				redirect_uri: "http://localhost:3000/cb",
			});
			const url = manager.getAuthorizationUrl("microsoft");
			expect(url).toContain("login.microsoftonline.com");
			expect(url).toContain("client_id=mid");
		});
		it("includes state parameter when provided", () => {
			const manager = new OAuthManager(makeTmpDir());
			manager.setCredentials("google", {
				client_id: "gid",
				client_secret: "gs",
				redirect_uri: "http://localhost:3000/cb",
			});
			const url = manager.getAuthorizationUrl("google", "random-state-123");
			expect(url).toContain("state=random-state-123");
		});
		it("throws when credentials not set", () => {
			const manager = new OAuthManager(makeTmpDir());
			expect(() => manager.getAuthorizationUrl("google")).toThrow("No OAuth credentials");
		});
	});
	describe("Token management", () => {
		it("sets and gets token", () => {
			const manager = new OAuthManager(makeTmpDir());
			const token = makeToken("google");
			manager.setToken("google", token);
			const stored = manager.getToken("google");
			expect(stored.access_token).toBe("test-access-token");
		});
		it("returns null for no token", () => {
			const manager = new OAuthManager(makeTmpDir());
			expect(manager.getToken("google")).toBeNull();
		});
		it("persists token to disk", () => {
			const dir = makeTmpDir();
			const manager1 = new OAuthManager(dir);
			manager1.setToken("google", makeToken("google"));
			const manager2 = new OAuthManager(dir);
			expect(manager2.getToken("google")).not.toBeNull();
		});
	});
	describe("Authentication check", () => {
		it("returns true when token is valid", () => {
			const manager = new OAuthManager(makeTmpDir());
			manager.setToken("google", makeToken("google"));
			expect(manager.isAuthenticated("google")).toBe(true);
		});
		it("returns false when no token", () => {
			const manager = new OAuthManager(makeTmpDir());
			expect(manager.isAuthenticated("google")).toBe(false);
		});
		it("returns false when token is expired", () => {
			const manager = new OAuthManager(makeTmpDir());
			manager.setToken(
				"google",
				makeToken("google", {
					expires_at: Date.now() - 1000,
				}),
			);
			expect(manager.isAuthenticated("google")).toBe(false);
		});
	});
	describe("getAccessToken", () => {
		it("returns access token when valid", async () => {
			const manager = new OAuthManager(makeTmpDir());
			manager.setToken("google", makeToken("google"));
			const token = await manager.getAccessToken("google");
			expect(token).toBe("test-access-token");
		});
		it("returns null when no token", async () => {
			const manager = new OAuthManager(makeTmpDir());
			const token = await manager.getAccessToken("google");
			expect(token).toBeNull();
		});
		it("returns null when expired and no refresh token", async () => {
			const manager = new OAuthManager(makeTmpDir());
			manager.setToken(
				"google",
				makeToken("google", {
					expires_at: Date.now() - 1000,
					refresh_token: undefined,
				}),
			);
			const token = await manager.getAccessToken("google");
			expect(token).toBeNull();
		});
	});
	describe("Token revocation", () => {
		it("removes token on revoke", async () => {
			const manager = new OAuthManager(makeTmpDir());
			manager.setToken("google", makeToken("google"));
			const result = await manager.revokeToken("google");
			expect(result).toBe(true);
			expect(manager.getToken("google")).toBeNull();
		});
		it("returns false when no token to revoke", async () => {
			const manager = new OAuthManager(makeTmpDir());
			const result = await manager.revokeToken("google");
			expect(result).toBe(false);
		});
	});
	describe("Reset", () => {
		it("clears all state", () => {
			const manager = new OAuthManager(makeTmpDir());
			manager.setCredentials("google", {
				client_id: "gid",
				client_secret: "gs",
				redirect_uri: "http://localhost:3000/cb",
			});
			manager.setToken("google", makeToken("google"));
			manager.reset();
			expect(manager.getCredentials("google")).toBeNull();
			expect(manager.getToken("google")).toBeNull();
		});
	});
	describe("Provider endpoints", () => {
		it("returns Google endpoints", () => {
			const endpoints = OAuthManager.getProviderEndpoints("google");
			expect(endpoints.authorize_url).toContain("google.com");
			expect(endpoints.token_url).toContain("googleapis.com");
			expect(endpoints.scopes.length).toBeGreaterThan(0);
		});
		it("returns Microsoft endpoints", () => {
			const endpoints = OAuthManager.getProviderEndpoints("microsoft");
			expect(endpoints.authorize_url).toContain("microsoftonline.com");
			expect(endpoints.scopes.length).toBeGreaterThan(0);
		});
	});
});
//# sourceMappingURL=oauth-manager.test.js.map
