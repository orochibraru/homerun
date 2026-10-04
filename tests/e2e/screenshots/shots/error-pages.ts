import type { ShotModule } from "./types";

export const shots: ShotModule = {
	shots: [
		{
			doc: "/homerun-error/404 (a service still deploying)",
			expect: /Almost there/,
			name: "error-page-not-ready",
			path: () => "/homerun-error/404?preview=notReady",
		},
		{
			doc: "/homerun-error/503",
			expect: /Temporarily unavailable/,
			name: "error-page-unavailable",
			path: () => "/homerun-error/503?preview=unavailable",
		},
		{
			doc: "/settings/error-pages",
			expect: /Page text/,
			name: "error-pages-settings",
			path: () => "/settings/error-pages",
		},
	],
};
