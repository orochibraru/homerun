// Loaded before anything else in the compiled server bundle (SvelteKit's
// instrumentation hook, which adapter-bun runs ahead of the server entrypoint).
//
// @peculiar/x509 — pulled in transitively by better-auth's passkey plugin via
// @simplewebauthn/server — initializes a tsyringe DI container at module load
// and throws unless the reflect-metadata polyfill is already active. Its own
// nested `import "reflect-metadata"` is enough under a normal Node/Bun module
// graph, but `bun build --compile` reorders module evaluation and the polyfill
// ends up running too late. Forcing it here, as the first thing the bundle
// evaluates, keeps that ordering guarantee.
import "reflect-metadata";
