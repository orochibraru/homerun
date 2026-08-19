import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	build: {
		target: 'es2022',
		cssMinify: true,
		reportCompressedSize: false,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes('node_modules/svelte')) return 'svelte';
					if (id.includes('node_modules')) return 'vendor';
				},
			},
		},
	},
});
