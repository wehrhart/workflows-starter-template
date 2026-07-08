import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss(), cloudflare()],
	// Abyrx Tools runs on its own port so it won't collide with other local apps.
	// Override anytime: `npm run dev -- --port 1234`.
	server: {
		port: 5280,
		strictPort: false,
	},
});
