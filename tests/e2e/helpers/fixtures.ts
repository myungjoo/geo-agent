import http from "node:http";
import { getFreePort } from "./test-server.js";

export interface FixtureServer {
	baseUrl: string;
	port: number;
	stop: () => Promise<void>;
}

// ── Fixture HTML content ────────────────────────────────────

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Acme Corp — Leading Widget Manufacturer</title>
  <meta name="description" content="Acme Corp is the world's leading manufacturer of high-quality widgets and gadgets.">
  <meta property="og:title" content="Acme Corp — Leading Widget Manufacturer">
  <meta property="og:description" content="High-quality widgets since 1990.">
  <meta property="og:type" content="website">
  <link rel="canonical" href="{{BASE_URL}}/">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Acme Corp",
    "url": "{{BASE_URL}}",
    "description": "Leading manufacturer of widgets and gadgets",
    "foundingDate": "1990-01-15",
    "sameAs": ["https://twitter.com/acmecorp", "https://linkedin.com/company/acmecorp"]
  }
  </script>
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/products/widget">Widget Pro</a>
    <a href="/about">About</a>
  </nav>
  <h1>Acme Corp — The Widget Experts</h1>
  <h2>Our Products</h2>
  <p>We manufacture over 500,000 widgets annually, serving 120 countries worldwide.</p>
  <ul>
    <li>Widget Pro — $49.99</li>
    <li>Widget Lite — $29.99</li>
    <li>Widget Enterprise — $199.99</li>
  </ul>
  <h2>Why Choose Us</h2>
  <p>With 35 years of experience and ISO 9001 certification, Acme Corp delivers precision-engineered widgets with a 99.7% quality rate.</p>
  <table>
    <thead><tr><th>Model</th><th>Weight</th><th>Dimensions</th></tr></thead>
    <tbody>
      <tr><td>Pro</td><td>250g</td><td>10x5x3 cm</td></tr>
      <tr><td>Lite</td><td>150g</td><td>8x4x2 cm</td></tr>
    </tbody>
  </table>
  <footer><p>&copy; 2024 Acme Corp. All rights reserved.</p></footer>
</body>
</html>`;

const PRODUCT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Widget Pro — Acme Corp</title>
  <meta name="description" content="Widget Pro is our flagship product with advanced features and premium build quality.">
  <meta property="og:title" content="Widget Pro — Acme Corp">
  <link rel="canonical" href="{{BASE_URL}}/products/widget">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Widget Pro",
    "description": "Flagship widget with advanced features",
    "brand": {"@type": "Brand", "name": "Acme Corp"},
    "offers": {
      "@type": "Offer",
      "price": "49.99",
      "priceCurrency": "USD",
      "availability": "https://schema.org/InStock"
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.7",
      "reviewCount": "1523"
    }
  }
  </script>
</head>
<body>
  <nav><a href="/">Home</a> &gt; <a href="/products/widget">Widget Pro</a></nav>
  <h1>Widget Pro</h1>
  <h2>Specifications</h2>
  <table>
    <tr><th>Weight</th><td>250g</td></tr>
    <tr><th>Dimensions</th><td>10 x 5 x 3 cm</td></tr>
    <tr><th>Material</th><td>Aircraft-grade aluminum</td></tr>
    <tr><th>Battery</th><td>4000mAh Li-Po</td></tr>
    <tr><th>Price</th><td>$49.99</td></tr>
  </table>
  <p>Rating: 4.7/5 based on 1,523 reviews.</p>
</body>
</html>`;

const ROBOTS_TXT = `User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: {{BASE_URL}}/sitemap.xml
`;

const LLMS_TXT = `# Acme Corp

> Leading manufacturer of widgets and gadgets since 1990.

## Products
- Widget Pro: Flagship widget, $49.99
- Widget Lite: Budget-friendly option, $29.99
- Widget Enterprise: Business solution, $199.99

## Company Info
- Founded: 1990
- Headquarters: San Francisco, CA
- Employees: 2,500+
- Annual production: 500,000+ units
`;

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{{BASE_URL}}/</loc><lastmod>2024-12-01</lastmod><priority>1.0</priority></url>
  <url><loc>{{BASE_URL}}/products/widget</loc><lastmod>2024-11-15</lastmod><priority>0.8</priority></url>
  <url><loc>{{BASE_URL}}/about</loc><lastmod>2024-10-01</lastmod><priority>0.5</priority></url>
</urlset>`;

// ── Fixture HTTP server ─────────────────────────────────────

function buildRoutes(baseUrl: string): Map<string, { body: string; contentType: string }> {
	const replace = (tpl: string) => tpl.replaceAll("{{BASE_URL}}", baseUrl);

	return new Map([
		["/", { body: replace(INDEX_HTML), contentType: "text/html; charset=utf-8" }],
		["/products/widget", { body: replace(PRODUCT_HTML), contentType: "text/html; charset=utf-8" }],
		["/robots.txt", { body: replace(ROBOTS_TXT), contentType: "text/plain; charset=utf-8" }],
		["/llms.txt", { body: replace(LLMS_TXT), contentType: "text/plain; charset=utf-8" }],
		["/sitemap.xml", { body: replace(SITEMAP_XML), contentType: "application/xml; charset=utf-8" }],
	]);
}

export async function startFixtureServer(): Promise<FixtureServer> {
	const port = await getFreePort();
	const baseUrl = `http://localhost:${port}`;
	const routes = buildRoutes(baseUrl);

	const server = http.createServer((req, res) => {
		const pathname = (req.url ?? "/").split("?")[0];
		const route = routes.get(pathname);

		if (route) {
			res.writeHead(200, { "Content-Type": route.contentType });
			res.end(route.body);
		} else {
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not Found");
		}
	});

	await new Promise<void>((resolve) => {
		server.listen(port, () => resolve());
	});

	const stop = async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	};

	return { baseUrl, port, stop };
}
