import { describe, expect, it, vi } from "vitest";

const rootMenuItems = vi.hoisted(() => [] as Array<Array<Record<string, unknown>>>);
vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-tui")>();
	return {
		...actual,
		SelectList: class extends actual.SelectList {
			constructor(items: any[], ...rest: any[]) {
				rootMenuItems.push(items);
				super(items, ...(rest as [any, any]));
			}
		},
	};
});

import {
	createMenuActions,
	openAtelierMenu,
	renderMenuBorder,
	renderMenuFrame,
	type SidebarControls,
} from "../src/menu.js";
import { derivePresetIdentity } from "../src/display.js";
import { DEFAULT_CONFIG, type DisplayPatch } from "../src/types.js";

function harness() {
	let config = {
		...DEFAULT_CONFIG,
		segmentLayout: DEFAULT_CONFIG.segmentLayout.map((entry) => ({ ...entry })),
	};
	const runtime = {
		getConfig: vi.fn(() => config),
		getDisplaySettings: vi.fn(() => ({
			preset: config.preset,
			density: config.density,
			segmentLayout: config.segmentLayout.map((entry) => ({ ...entry })),
		})),
		setSessionDisplayPatch: vi.fn((patch: DisplayPatch) => {
			config = { ...config, ...patch };
			config.preset = derivePresetIdentity(config);
		}),
		setConfig: vi.fn((next) => {
			config = next;
		}),
		refreshUsage: vi.fn(),
	};
	const pi = {
		setModel: vi.fn().mockResolvedValue(true),
		getThinkingLevel: vi.fn().mockReturnValue("medium"),
		setThinkingLevel: vi.fn(),
		getAllTools: vi.fn().mockReturnValue([{ name: "read" }, { name: "bash" }]),
		getActiveTools: vi.fn().mockReturnValue(["read"]),
		setActiveTools: vi.fn(),
		setSessionName: vi.fn(),
	};
	const ctx = {
		model: { id: "old", provider: "provider" },
		ui: { notify: vi.fn(), input: vi.fn(), confirm: vi.fn() },
		compact: vi.fn(),
	};
	const save = vi.fn().mockResolvedValue(undefined);
	const savePatch = vi.fn().mockResolvedValue(undefined);
	const actions = createMenuActions(
		pi as never,
		ctx as never,
		runtime as never,
		"/tmp/user.json",
		save,
		savePatch,
	);
	return { actions, pi, ctx, runtime, save, savePatch };
}

describe("menu presentation", () => {
	it.each([
		[
			false,
			{
				value: "sidebar",
				label: "Sidebar: Off",
				description: "Show the docked information rail",
			},
		],
		[
			true,
			{
				value: "sidebar",
				label: "Sidebar: On",
				description: "Hide the docked information rail",
			},
		],
	] as const)("shows and toggles the dynamic sidebar state (%s)", async (visible, expected) => {
		rootMenuItems.length = 0;
		const sidebar: SidebarControls = {
			isVisible: vi.fn(() => visible),
			toggle: vi.fn(),
			isToolListExpanded: vi.fn(() => false),
			toggleToolList: vi.fn().mockResolvedValue(undefined),
		};
		let invocation = 0;
		const ctx = {
			mode: "tui",
			ui: {
				custom: vi.fn(
					(factory: (...args: any[]) => unknown) =>
						new Promise((resolve) => {
							const value = invocation++ === 0 ? "sidebar" : "close";
							factory(
								{ requestRender: vi.fn() },
								{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
								{},
								resolve,
							);
							resolve(value);
						}),
				),
			},
		};

		await openAtelierMenu({} as never, ctx as never, harness().runtime as never, "/tmp/user.json", sidebar);

		expect(rootMenuItems[0]).toContainEqual(expected);
		expect(sidebar.toggle).toHaveBeenCalledOnce();
	});

	it("shows and persists the completion notification toggle", async () => {
		rootMenuItems.length = 0;
		const h = harness();
		const sidebar: SidebarControls = {
			isVisible: vi.fn(() => false),
			toggle: vi.fn(),
			isToolListExpanded: vi.fn(() => false),
			toggleToolList: vi.fn().mockResolvedValue(undefined),
		};
		let invocation = 0;
		const ctx = {
			mode: "tui",
			ui: {
				notify: vi.fn(),
				custom: vi.fn(
					(factory: (...args: any[]) => unknown) =>
						new Promise((resolve) => {
							const value = invocation++ === 0 ? "notifications" : "close";
							factory(
								{ requestRender: vi.fn() },
								{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
								{},
								resolve,
							);
							resolve(value);
						}),
				),
			},
		};

		await openAtelierMenu(
			{} as never,
			ctx as never,
			h.runtime as never,
			"/tmp/user.json",
			sidebar,
			h.save,
			h.savePatch,
		);

		expect(rootMenuItems[0]).toContainEqual({
			value: "notifications",
			label: "Completion notifications: On",
			description: "Notify when a turn settles or Pi requests input",
		});
		expect(h.runtime.getConfig().completionNotifications).toBe(false);
		expect(h.savePatch).toHaveBeenCalledWith("/tmp/user.json", { completionNotifications: false });
		expect(h.save).not.toHaveBeenCalled();
	});

	it("offers performance in the segment toggle and enables it", async () => {
		rootMenuItems.length = 0;
		const h = harness();
		const sidebar: SidebarControls = {
			isVisible: vi.fn(() => false),
			toggle: vi.fn(),
			isToolListExpanded: vi.fn(() => false),
			toggleToolList: vi.fn().mockResolvedValue(undefined),
		};
		let invocation = 0;
		let offered: string[] = [];
		const ctx = {
			mode: "tui",
			ui: {
				notify: vi.fn(),
				select: vi.fn((title: string, options: string[]) => {
					if (title !== "Toggle footer segment") return Promise.resolve("Toggle segments");
					offered = options;
					return Promise.resolve("○ performance");
				}),
				custom: vi.fn(
					(factory: (...args: any[]) => unknown) =>
						new Promise((resolve) => {
							const value = invocation++ === 0 ? "display" : "close";
							factory(
								{ requestRender: vi.fn() },
								{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
								{},
								resolve,
							);
							resolve(value);
						}),
				),
			},
		};

		await openAtelierMenu({} as never, ctx as never, h.runtime as never, "/tmp/user.json", sidebar);

		expect(offered).toContain("○ performance");
		expect(h.runtime.getConfig().segmentLayout.find((entry) => entry.id === "performance")?.visible).toBe(
			true,
		);
	});

	it("shows and toggles collapsed sidebar tool details", async () => {
		rootMenuItems.length = 0;
		const sidebar: SidebarControls = {
			isVisible: vi.fn(() => true),
			toggle: vi.fn(),
			isToolListExpanded: vi.fn(() => false),
			toggleToolList: vi.fn().mockResolvedValue(undefined),
		};
		let invocation = 0;
		const ctx = {
			mode: "tui",
			ui: {
				custom: vi.fn(
					(factory: (...args: any[]) => unknown) =>
						new Promise((resolve) => {
							const value = invocation++ === 0 ? "sidebar-tools" : "close";
							factory(
								{ requestRender: vi.fn() },
								{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
								{},
								resolve,
							);
							resolve(value);
						}),
				),
			},
		};

		await openAtelierMenu({} as never, ctx as never, harness().runtime as never, "/tmp/user.json", sidebar);

		expect(rootMenuItems[0]).toContainEqual({
			value: "sidebar-tools",
			label: "Tool list: Collapsed",
			description: "Show active tool names in the sidebar",
		});
		expect(sidebar.toggleToolList).toHaveBeenCalledOnce();
	});

	it("uses a heavy theme-aware border that fills the available width", () => {
		const theme = {
			fg: vi.fn((_color: string, text: string) => text),
			bold: vi.fn((text: string) => text),
		};
		expect(renderMenuBorder(theme, 6)).toBe("━━━━━━");
		expect(theme.fg).toHaveBeenCalledWith("borderAccent", "━━━━━━");
		expect(theme.bold).toHaveBeenCalled();
	});

	it("frames every content row with heavy vertical borders and corners", () => {
		const theme = {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		};
		expect(renderMenuFrame(theme, ["Hi"], 8)).toEqual(["┏━━━━━━┓", "┃Hi    ┃", "┗━━━━━━┛"]);
	});
});

describe("menu actions", () => {
	it.each([
		["editorial", ["activity", "metrics", "context", "model", "git", "statuses", "menu"]],
		["minimal", ["activity", "metrics", "context", "model", "menu"]],
		["classic", ["metrics", "context", "model", "git", "statuses"]],
	] as const)("applies the complete %s template", (preset, visible) => {
		const h = harness();
		h.actions.setPreset(preset);
		expect(h.runtime.getConfig().segmentLayout).toHaveLength(9);
		expect(
			h.runtime
				.getConfig()
				.segmentLayout.filter((entry) => entry.visible)
				.map((entry) => entry.id),
		).toEqual(visible);
		expect(h.runtime.getConfig().preset).toBe(preset);
	});

	it("toggles in place, protects required entries, and reorders across hidden neighbors", () => {
		const h = harness();
		const initialOrder = h.runtime.getConfig().segmentLayout.map((entry) => entry.id);
		h.actions.toggleSegment("performance");
		h.actions.toggleSegment("metrics");
		expect(h.runtime.getConfig().segmentLayout.map((entry) => entry.id)).toEqual(initialOrder);
		expect(h.runtime.getConfig().segmentLayout.find((entry) => entry.id === "performance")?.visible).toBe(
			true,
		);
		expect(h.runtime.getConfig().segmentLayout.find((entry) => entry.id === "metrics")?.visible).toBe(true);
		h.actions.moveSegment("context", "earlier");
		expect(
			h.runtime
				.getConfig()
				.segmentLayout.map((entry) => entry.id)
				.slice(2, 5),
		).toEqual(["metrics", "context", "performance"]);
		expect(h.runtime.getConfig().preset).toBe("custom");
	});

	it("keeps the prior model when authentication fails", async () => {
		const h = harness();
		h.pi.setModel.mockResolvedValue(false);
		await h.actions.selectModel({ id: "new", provider: "provider" } as never);
		expect(h.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("authentication"), "error");
		expect(h.runtime.refreshUsage).not.toHaveBeenCalled();
	});

	it("restores model and thinking level when refresh fails after mutation", async () => {
		const h = harness();
		h.runtime.refreshUsage.mockImplementation(() => {
			throw new Error("refresh failed");
		});
		await h.actions.selectModel({ id: "new", provider: "provider" } as never);
		expect(h.pi.setModel).toHaveBeenLastCalledWith(h.ctx.model);
		h.actions.setThinkingLevel("high");
		expect(h.pi.setThinkingLevel).toHaveBeenLastCalledWith("medium");
	});

	it("filters unknown tools before applying selection", () => {
		const h = harness();
		h.actions.setTools(["read", "missing"]);
		expect(h.pi.setActiveTools).toHaveBeenCalledWith(["read"]);
	});

	it("persists only completion notifications while display changes remain session-scoped", async () => {
		const h = harness();
		h.actions.setPreset("minimal");
		await h.actions.setCompletionNotifications(false);
		expect(h.runtime.getConfig().completionNotifications).toBe(false);
		expect(h.savePatch).toHaveBeenCalledWith("/tmp/user.json", { completionNotifications: false });
		expect(h.save).not.toHaveBeenCalled();
		expect(h.ctx.ui.notify).toHaveBeenCalledWith("Completion notifications disabled", "info");
	});

	it("persists display changes only after explicit save", async () => {
		const h = harness();
		h.actions.setPreset("minimal");
		expect(h.save).not.toHaveBeenCalled();
		await h.actions.saveDisplayDefaults();
		expect(h.savePatch).toHaveBeenCalledWith("/tmp/user.json", h.runtime.getDisplaySettings());
		expect(h.save).not.toHaveBeenCalled();
	});

	it("restores the ornament-free Status Rail defaults when selecting editorial", () => {
		const h = harness();
		h.actions.setPreset("minimal");
		h.actions.setDensity("compact");
		h.actions.setOrnament("restrained");
		h.actions.setPreset("editorial");
		expect(h.runtime.getConfig()).toMatchObject({
			preset: "editorial",
			segmentLayout: DEFAULT_CONFIG.segmentLayout,
			density: "comfortable",
		});
	});

	it("maps classic to its compatible segments and presentation", () => {
		const h = harness();
		h.actions.setPreset("minimal");
		h.actions.setDensity("compact");
		h.actions.setOrnament("restrained");
		h.actions.setPreset("classic");
		expect(h.runtime.getConfig()).toMatchObject({
			preset: "classic",
			density: "comfortable",
		});
		expect(
			h.runtime
				.getConfig()
				.segmentLayout.filter((entry) => entry.visible)
				.map((entry) => entry.id),
		).toEqual(["metrics", "context", "model", "git", "statuses"]);
	});

	it("renames a session only after non-empty input", async () => {
		const h = harness();
		h.ctx.ui.input.mockResolvedValue("  Release prep  ");
		await h.actions.renameSession();
		expect(h.pi.setSessionName).toHaveBeenCalledWith("Release prep");
	});

	it("rolls back tools and reports synchronous action failures", () => {
		const h = harness();
		h.pi.setActiveTools.mockImplementationOnce(() => {
			throw new Error("tool failure");
		});
		h.actions.setTools(["bash"]);
		expect(h.pi.setActiveTools).toHaveBeenLastCalledWith(["read"]);
		expect(h.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("tool failure"), "error");
	});

	it("updates density, ornament, and segment order through display controls", () => {
		const h = harness();
		h.actions.setDensity("compact");
		h.actions.setOrnament("none");
		h.actions.moveSegment("context", "earlier");
		expect(h.runtime.getConfig()).toMatchObject({ density: "compact", preset: "custom" });
		expect(h.runtime.getConfig().segmentLayout.findIndex((entry) => entry.id === "context")).toBeLessThan(
			h.runtime.getConfig().segmentLayout.findIndex((entry) => entry.id === "performance"),
		);
	});

	it("does not compact without confirmation", async () => {
		const h = harness();
		h.ctx.ui.confirm.mockResolvedValue(false);
		await h.actions.compactSession();
		expect(h.ctx.compact).not.toHaveBeenCalled();
	});
});
