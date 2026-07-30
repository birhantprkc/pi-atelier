import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Keep the suite off the developer's real ~/.pi/agent configuration, which the
		// extension loads through getAgentDir() during session_start.
		env: {
			PI_CODING_AGENT_DIR: fileURLToPath(new URL(".tmp/agent", import.meta.url)),
		},
	},
});
