import type { HTMLAnchorAttributes } from "svelte/elements";
import type { Pathname } from "$app/types";
import type { Logger } from "$lib/logger";
import type { AuthType } from "$lib/server/auth";

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
		// interface Platform {}
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
