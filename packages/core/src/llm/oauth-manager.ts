/**
 * OAuth Manager — Google/Microsoft OAuth 플로우 관리
 *
 * localhost 콜백 기반 OAuth 2.0 Authorization Code 플로우.
 * 토큰 저장/갱신/취소 기능 제공.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// ── Schemas ─────────────────────────────────────────────────

export const OAuthProviderSchema = z.enum(["google", "microsoft"]);
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>;

export const OAuthCredentialsSchema = z.object({
	client_id: z.string().min(1),
	client_secret: z.string().min(1),
	redirect_uri: z.string().url().default("http://localhost:3000/api/auth/callback"),
});
export type OAuthCredentials = z.infer<typeof OAuthCredentialsSchema>;

export const OAuthTokenSchema = z.object({
	access_token: z.string(),
	refresh_token: z.string().optional(),
	token_type: z.string().default("Bearer"),
	expires_at: z.number(),
	scope: z.string().optional(),
	provider: OAuthProviderSchema,
});
export type OAuthToken = z.infer<typeof OAuthTokenSchema>;

export const OAuthStateSchema = z.object({
	tokens: z.record(OAuthProviderSchema, OAuthTokenSchema).default({}),
	credentials: z.record(OAuthProviderSchema, OAuthCredentialsSchema).default({}),
});
export type OAuthState = z.infer<typeof OAuthStateSchema>;

// ── Provider Configurations ──────────────────────────────────

interface ProviderEndpoints {
	authorize_url: string;
	token_url: string;
	revoke_url: string | null;
	scopes: string[];
}

const PROVIDER_ENDPOINTS: Record<OAuthProvider, ProviderEndpoints> = {
	google: {
		authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
		token_url: "https://oauth2.googleapis.com/token",
		revoke_url: "https://oauth2.googleapis.com/revoke",
		scopes: [
			"https://www.googleapis.com/auth/generative-language",
			"https://www.googleapis.com/auth/cloud-platform",
		],
	},
	microsoft: {
		authorize_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
		token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
		revoke_url: null,
		scopes: ["https://cognitiveservices.azure.com/.default", "offline_access"],
	},
};

// ── OAuth Manager ────────────────────────────────────────────

export class OAuthManager {
	private state: OAuthState;
	private statePath: string;

	constructor(workspaceDir: string) {
		const dir = join(workspaceDir, "auth");
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		this.statePath = join(dir, "oauth-state.json");
		this.state = this.loadState();
	}

	private loadState(): OAuthState {
		try {
			if (existsSync(this.statePath)) {
				const raw = readFileSync(this.statePath, "utf-8");
				return OAuthStateSchema.parse(JSON.parse(raw));
			}
		} catch {
			// Corrupted state, start fresh
		}
		return { tokens: {}, credentials: {} };
	}

	private saveState(): void {
		writeFileSync(this.statePath, JSON.stringify(this.state, null, "\t"), "utf-8");
	}

	/** OAuth credentials 설정 (client_id, client_secret) */
	setCredentials(provider: OAuthProvider, credentials: OAuthCredentials): void {
		const parsed = OAuthCredentialsSchema.parse(credentials);
		this.state.credentials[provider] = parsed;
		this.saveState();
	}

	/** Credentials 조회 */
	getCredentials(provider: OAuthProvider): OAuthCredentials | null {
		return this.state.credentials[provider] ?? null;
	}

	/** OAuth authorization URL 생성 */
	getAuthorizationUrl(provider: OAuthProvider, stateParam?: string): string {
		const creds = this.state.credentials[provider];
		if (!creds) {
			throw new Error(`No OAuth credentials configured for ${provider}`);
		}

		const endpoints = PROVIDER_ENDPOINTS[provider];
		const params = new URLSearchParams({
			client_id: creds.client_id,
			redirect_uri: creds.redirect_uri,
			response_type: "code",
			scope: endpoints.scopes.join(" "),
			access_type: "offline",
			prompt: "consent",
			...(stateParam ? { state: stateParam } : {}),
		});

		return `${endpoints.authorize_url}?${params.toString()}`;
	}

	/** Authorization code → token 교환 */
	async exchangeCode(provider: OAuthProvider, code: string): Promise<OAuthToken> {
		const creds = this.state.credentials[provider];
		if (!creds) {
			throw new Error(`No OAuth credentials configured for ${provider}`);
		}

		const endpoints = PROVIDER_ENDPOINTS[provider];
		const body = new URLSearchParams({
			client_id: creds.client_id,
			client_secret: creds.client_secret,
			redirect_uri: creds.redirect_uri,
			code,
			grant_type: "authorization_code",
		});

		const res = await fetch(endpoints.token_url, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: body.toString(),
		});

		if (!res.ok) {
			const error = await res.text();
			throw new Error(`Token exchange failed: ${res.status} ${error}`);
		}

		const data = await res.json();
		const token: OAuthToken = {
			access_token: data.access_token,
			refresh_token: data.refresh_token,
			token_type: data.token_type ?? "Bearer",
			expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
			scope: data.scope,
			provider,
		};

		this.state.tokens[provider] = token;
		this.saveState();
		return token;
	}

	/** 토큰 갱신 */
	async refreshToken(provider: OAuthProvider): Promise<OAuthToken> {
		const token = this.state.tokens[provider];
		if (!token?.refresh_token) {
			throw new Error(`No refresh token available for ${provider}`);
		}

		const creds = this.state.credentials[provider];
		if (!creds) {
			throw new Error(`No OAuth credentials configured for ${provider}`);
		}

		const endpoints = PROVIDER_ENDPOINTS[provider];
		const body = new URLSearchParams({
			client_id: creds.client_id,
			client_secret: creds.client_secret,
			refresh_token: token.refresh_token,
			grant_type: "refresh_token",
		});

		const res = await fetch(endpoints.token_url, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: body.toString(),
		});

		if (!res.ok) {
			const error = await res.text();
			throw new Error(`Token refresh failed: ${res.status} ${error}`);
		}

		const data = await res.json();
		const newToken: OAuthToken = {
			access_token: data.access_token,
			refresh_token: data.refresh_token ?? token.refresh_token,
			token_type: data.token_type ?? "Bearer",
			expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
			scope: data.scope ?? token.scope,
			provider,
		};

		this.state.tokens[provider] = newToken;
		this.saveState();
		return newToken;
	}

	/** 유효한 access_token 가져오기 (필요하면 자동 갱신) */
	async getAccessToken(provider: OAuthProvider): Promise<string | null> {
		const token = this.state.tokens[provider];
		if (!token) return null;

		// 만료 5분 전에 갱신
		if (token.expires_at < Date.now() + 5 * 60 * 1000) {
			if (token.refresh_token) {
				try {
					const refreshed = await this.refreshToken(provider);
					return refreshed.access_token;
				} catch {
					return null;
				}
			}
			return null;
		}

		return token.access_token;
	}

	/** 토큰 직접 설정 (테스트 또는 수동 설정 용) */
	setToken(provider: OAuthProvider, token: OAuthToken): void {
		this.state.tokens[provider] = OAuthTokenSchema.parse(token);
		this.saveState();
	}

	/** 토큰 조회 */
	getToken(provider: OAuthProvider): OAuthToken | null {
		return this.state.tokens[provider] ?? null;
	}

	/** 토큰 취소 */
	async revokeToken(provider: OAuthProvider): Promise<boolean> {
		const token = this.state.tokens[provider];
		if (!token) return false;

		const endpoints = PROVIDER_ENDPOINTS[provider];
		if (endpoints.revoke_url) {
			try {
				await fetch(`${endpoints.revoke_url}?token=${token.access_token}`, {
					method: "POST",
				});
			} catch {
				// Best effort revocation
			}
		}

		delete this.state.tokens[provider];
		this.saveState();
		return true;
	}

	/** 인증 상태 확인 */
	isAuthenticated(provider: OAuthProvider): boolean {
		const token = this.state.tokens[provider];
		return !!token && token.expires_at > Date.now();
	}

	/** 전체 상태 초기화 */
	reset(): void {
		this.state = { tokens: {}, credentials: {} };
		this.saveState();
	}

	/** Provider endpoint 정보 */
	static getProviderEndpoints(provider: OAuthProvider): ProviderEndpoints {
		return PROVIDER_ENDPOINTS[provider];
	}
}
