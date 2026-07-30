import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { resolveDisplayLayers } from "../src/config.js";
import { createSettingsWorkspace } from "../src/settings-workspace.js";
import { DEFAULT_CONFIG, type DisplayLayerState, type DisplayPatch } from "../src/types.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
};

function harness() {
	let layers: DisplayLayerState = {};
	const render = vi.fn();
	const live = vi.fn();
	const close = vi.fn();
	const persist = vi.fn<(patch: DisplayPatch) => Promise<void>>().mockResolvedValue(undefined);
	const component = createSettingsWorkspace({
		getDisplaySettings: () => resolveDisplayLayers(layers).display,
		getDisplayProvenance: () => resolveDisplayLayers(layers).provenance,
		getSessionDisplayOverride: () => layers.session as never,
		replaceSessionDisplayOverride: (value) => {
			const { session: _old, ...lower } = layers;
			layers = value ? { ...lower, session: structuredClone(value) as Record<string, unknown> } : lower;
		},
		clearSessionDisplayOverride: () => {
			const { session: _old, ...lower } = layers;
			layers = lower;
		},
		persistUserDisplayPatch: persist,
		applySavedUserDisplayPatch: (patch) => {
			layers = { ...layers, user: { ...layers.user, ...structuredClone(patch) } };
		},
		getRenderConfig: () => DEFAULT_CONFIG,
		theme,
		colorEnabled: false,
		requestWorkspaceRender: render,
		requestLiveRender: live,
		close,
	});
	return {
		component,
		render,
		live,
		close,
		persist,
		get layers() {
			return layers;
		},
	};
}

const text = (component: ReturnType<typeof createSettingsWorkspace>, width = 120) =>
	component.render(width).join("\n");

describe("Display Settings Workspace", () => {
	it("applies a complete preset continuously as one Session mutation and one Undo step", () => {
		const h = harness();
		h.component.handleInput(" ");
		expect(resolveDisplayLayers(h.layers).display).toMatchObject({ preset: "minimal", density: "compact" });
		expect(text(h.component)).toContain("minimal");
		expect(h.live).toHaveBeenCalledOnce();
		h.component.handleInput("u");
		expect(h.layers.session).toBeUndefined();
		expect(resolveDisplayLayers(h.layers).display.preset).toBe("editorial");
	});

	it("accumulates Segment edits, protects required entries, and retains overrides on close", () => {
		const h = harness();
		// Focus performance (preset, density, brand, activity, metrics, performance).
		for (let index = 0; index < 5; index += 1) h.component.handleInput("\u001b[B");
		h.component.handleInput(" ");
		expect(
			resolveDisplayLayers(h.layers).display.segmentLayout.find((entry) => entry.id === "performance")
				?.visible,
		).toBe(true);
		// metrics is required and rejects toggling.
		h.component.handleInput("\u001b[A");
		h.component.handleInput(" ");
		expect(text(h.component)).toContain("metrics is required");
		h.component.handleInput("\u001b");
		expect(h.close).toHaveBeenCalledOnce();
		expect(h.layers.session).toBeDefined();
	});

	it("supports Revert and one-step Undo of Revert without touching lower layers", () => {
		const h = harness();
		h.component.handleInput(" ");
		h.component.handleInput("r");
		expect(h.layers.session).toBeUndefined();
		h.component.handleInput("u");
		expect(resolveDisplayLayers(h.layers).display.preset).toBe("minimal");
	});

	it("persists the current Display as the User default and keeps the workspace open", async () => {
		const h = harness();
		h.component.handleInput(" ");
		h.component.handleInput("s");
		await vi.waitFor(() => expect(text(h.component)).toContain("Saved as User default"));
		expect(h.persist).toHaveBeenCalledOnce();
		expect(h.layers.user).toMatchObject({ preset: "minimal", density: "compact" });
		expect(h.close).not.toHaveBeenCalled();
	});

	it("saves only Display fields and keeps failed saves and Undo history intact", async () => {
		const h = harness();
		h.component.handleInput(" ");
		h.persist.mockRejectedValueOnce(new Error("disk full"));
		h.component.handleInput("s");
		await vi.waitFor(() => expect(text(h.component)).toContain("Save failed: disk full"));
		expect(h.layers.session).toBeDefined();
		h.component.handleInput("u");
		expect(h.layers.session).toBeUndefined();
		expect(h.persist.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ preset: "minimal", density: "compact", segmentLayout: expect.any(Array) }),
		);
		expect(Object.keys(h.persist.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
			"density",
			"preset",
			"segmentLayout",
		]);
	});

	it.each([40, 80, 120])(
		"renders one native-background rounded frame without overflow at %s columns",
		(width) => {
			const h = harness();
			const lines = h.component.render(width);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			expect(
				lines.filter(
					(line) => line.includes("╭") || line.includes("╮") || line.includes("╰") || line.includes("╯"),
				),
			).toHaveLength(2);
			expect(lines[0]).toContain("╭");
			expect(lines.at(-1)).toContain("╰");
		},
	);

	it("uses stacked panels narrowly and equal-bottom side-by-side panels widely", () => {
		const h = harness();
		const narrow = h.component.render(40);
		expect(narrow.findIndex((line) => line.includes(" Display "))).toBeLessThan(
			narrow.findIndex((line) => line.includes(" Segments ")),
		);
		const wide = h.component.render(120);
		const sideBySide = wide.find((line) => line.includes(" Display ") && line.includes(" Segments "));
		expect(sideBySide).toBeDefined();
		expect(wide.some((line) => (line.match(/└/g) ?? []).length === 2)).toBe(true);
	});
});
