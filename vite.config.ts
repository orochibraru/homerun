import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

process.env.BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT = '1'

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    server: {
        // Traefik's forwardAuth middleware (see docker/labels.ts's
        // authRequired) calls this app from inside a container as
        // http://host.docker.internal:<port>/api/v1/auth-check : without
        // this, Vite dev mode's own Host-header guard rejects that request
        // before it reaches any route. Only relevant to `vite dev`; the
        // built app (`bun run start`) has no such restriction.
        allowedHosts: ["host.docker.internal"],
    },
    build: {
        target: "es2022",
        cssMinify: true,
        reportCompressedSize: false,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("node_modules/svelte")) return "svelte";
                    if (id.includes("node_modules")) return "vendor";
                },
            },
        },
    },
});
