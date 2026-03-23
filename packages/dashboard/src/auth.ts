import { randomBytes } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

// ── Session Store ─────────────────────────────────────────

const SESSION_COOKIE = "geo_session";
const activeSessions = new Set<string>();

export function createSession(): string {
	const token = randomBytes(32).toString("hex");
	activeSessions.add(token);
	return token;
}

export function validateSession(token: string): boolean {
	return activeSessions.has(token);
}

export function invalidateSession(token: string): void {
	activeSessions.delete(token);
}

// ── Credentials ───────────────────────────────────────────

export function authEnabled(): boolean {
	return !!(process.env.GEO_AUTH_USERNAME && process.env.GEO_AUTH_PASSWORD);
}

export function checkCredentials(username: string, password: string): boolean {
	return username === process.env.GEO_AUTH_USERNAME && password === process.env.GEO_AUTH_PASSWORD;
}

// ── IP Helpers ────────────────────────────────────────────

const LOCALHOST_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLocalhost(c: Context): boolean {
	try {
		const info = getConnInfo(c);
		const addr = info.remote.address;
		return addr !== undefined && LOCALHOST_ADDRESSES.has(addr);
	} catch {
		// No real socket (e.g. unit tests) — treat as non-localhost
		return false;
	}
}

// ── Middleware ────────────────────────────────────────────

const SKIP_PATHS = new Set(["/health", "/login"]);
const SKIP_EXACT: Array<{ method: string; path: string }> = [
	{ method: "POST", path: "/api/auth/login" },
];

export function authMiddleware(): MiddlewareHandler {
	return async (c: Context, next: Next) => {
		if (!authEnabled()) {
			return next();
		}

		const path = new URL(c.req.url).pathname;
		const method = c.req.method;

		// Always allow health check and login page/endpoint
		if (SKIP_PATHS.has(path)) {
			return next();
		}
		for (const skip of SKIP_EXACT) {
			if (method === skip.method && path === skip.path) {
				return next();
			}
		}

		// Localhost bypass — CLI and local tools can always access
		if (isLocalhost(c)) {
			return next();
		}

		// Check session cookie
		const token = getCookie(c, SESSION_COOKIE);
		if (token && validateSession(token)) {
			return next();
		}

		// Unauthenticated — API returns 401, UI redirects to login
		const acceptsHtml = c.req.header("Accept")?.includes("text/html") ?? false;
		if (path.startsWith("/api/") || !acceptsHtml) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		return c.redirect("/login");
	};
}

// ── Login/Logout Handlers ────────────────────────────────

export async function handleLogin(c: Context) {
	let username: string;
	let password: string;
	try {
		const body = await c.req.json<{ username: string; password: string }>();
		username = body.username ?? "";
		password = body.password ?? "";
	} catch {
		return c.json({ error: "Invalid request body" }, 400);
	}

	if (!checkCredentials(username, password)) {
		return c.json({ error: "Invalid credentials" }, 401);
	}

	const token = createSession();
	setCookie(c, SESSION_COOKIE, token, {
		httpOnly: true,
		sameSite: "Strict",
		path: "/",
		// Secure flag only over HTTPS — omit for local HTTP
	});
	return c.json({ ok: true });
}

export function handleLogout(c: Context) {
	const token = getCookie(c, SESSION_COOKIE);
	if (token) {
		invalidateSession(token);
	}
	deleteCookie(c, SESSION_COOKIE, { path: "/" });
	return c.json({ ok: true });
}

// ── Login Page HTML ───────────────────────────────────────

export function getLoginPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GEO Agent — Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 2.5rem;
      width: 100%;
      max-width: 380px;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
      color: #f8fafc;
    }
    p.sub { font-size: 0.875rem; color: #94a3b8; margin-bottom: 2rem; }
    label { display: block; font-size: 0.8125rem; color: #94a3b8; margin-bottom: 0.375rem; }
    input {
      width: 100%;
      padding: 0.625rem 0.875rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      color: #f1f5f9;
      font-size: 0.9375rem;
      margin-bottom: 1rem;
      outline: none;
    }
    input:focus { border-color: #6366f1; }
    button {
      width: 100%;
      padding: 0.7rem;
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 0.5rem;
    }
    button:hover { background: #4f46e5; }
    .error {
      display: none;
      background: #450a0a;
      border: 1px solid #7f1d1d;
      color: #fca5a5;
      padding: 0.625rem 0.875rem;
      border-radius: 6px;
      font-size: 0.875rem;
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>GEO Agent</h1>
    <p class="sub">Sign in to access the dashboard</p>
    <form id="form">
      <label for="username">Username</label>
      <input id="username" type="text" autocomplete="username" required autofocus>
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
      <div class="error" id="error"></div>
    </form>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('error');
      errEl.style.display = 'none';
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value,
        }),
      });
      if (res.ok) {
        window.location.href = '/dashboard';
      } else {
        const data = await res.json().catch(() => ({}));
        errEl.textContent = data.error || 'Login failed';
        errEl.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}
