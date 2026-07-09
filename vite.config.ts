import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
	// `inspectorPort: false` turns off the workerd debugger, which otherwise
	// tries to reach workers.cloudflare.com on boot and crashes the dev server
	// in locked-down/offline environments. The app runs fully local without it.
	plugins: [react(), tailwindcss(), cloudflare({ inspectorPort: false })],
	// Abyrx Tools runs on its own port so it won't collide with other local apps.
	// Override anytime: `npm run dev -- --port 1234`.
	server: {
		port: 5280,
		strictPort: false,
	},
});
