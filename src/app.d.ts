import type { HTMLAnchorAttributes } from "svelte/elements";
import type { Pathname } from "$app/types";
import type { Logger } from "$lib/logger";
import type { AuthType } from "$lib/services/auth";

/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/info" />
// See https://svelte.dev/docs/kit/types#app.d.ts

// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			authCookie: string;
			error: string;
			errorId: string;
			errorStackTrace: string;
			isAdmin: boolean;
			logger: Logger;
			message: unknown;
			session: AuthType["session"];
			user: AuthType["user"];
			userAgent: string;
		}
		// interface PageData {}
		// interface PageState {}
		// Matches the `platform` object @orochibraru/svelte-smol's handler
		// passes to server.respond(), request is available via event.request too,
		// server is the underlying Bun.Server for anything needing raw access to
		// it (e.g. Bun.Server#requestIP).
		interface Platform {
			server: Bun.Server;
			request: Request;
		}
		interface Error {
			code?: string;
			errorId?: string;
		}
	}

	namespace svelteHtml {
		interface HtmlAttributes<T> {
			onlongpress?: (event: CustomEvent<null>) => void;
			ontap?: (event: CustomEvent<null>) => void;
		}

		interface IntrinsicElements {
			a: Omit<HTMLAnchorAttributes, "href"> & {
				// The (string & {}) trick prevents 'string' from collapsing the union,
				// preserving Intellisense for your Pathnames.
				href?: Pathname | (string & {}) | null;
			};
		}
	}
}
