import type { HTMLAnchorAttributes } from "svelte/elements";
import type { Logger } from "#lib/logger.js";
import type { Permissions } from "#lib/permissions.js";
import type { AuthType } from "#lib/services/auth.js";
import type { SurfaceId } from "#lib/surfaces.js";
import type { Path } from "$app/types";

/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/info" />
// See https://svelte.dev/docs/kit/types#app.d.ts

// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			appOnly: boolean;
			authCookie: string;
			error: string;
			errorId: string;
			errorStackTrace: string;
			logger: Logger;
			message: unknown;
			permissions: Permissions;
			session: AuthType["session"];
			surface?: SurfaceId;
			user: AuthType["user"];
			userAgent: string;
		}
		// interface PageData {}
		// interface PageState {}
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
				href?: Path | (string & {}) | null;
			};
		}
	}
}
