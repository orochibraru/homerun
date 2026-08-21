// swagger-ui-dist ships no types of its own and there's no @types package for
// it — minimal ambient shim covering just what api-docs/+page.svelte uses.
declare module "swagger-ui-dist/swagger-ui-bundle.js" {
	interface SwaggerUIBundleOptions {
		url?: string;
		dom_id?: string;
		domNode?: HTMLElement;
		presets?: unknown[];
	}

	interface SwaggerUIBundleStatic {
		(options: SwaggerUIBundleOptions): unknown;
		presets: { apis: unknown };
	}

	const SwaggerUIBundle: SwaggerUIBundleStatic;
	export default SwaggerUIBundle;
}
