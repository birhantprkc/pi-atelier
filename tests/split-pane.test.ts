import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SIDEBAR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_MAIN_WIDTH,
	MIN_SIDEBAR_WIDTH,
	createSplitPaneController,
	parseSgrMouseEvent,
} from "../src/split-pane.js";

function harness(columns = 120) {
	const baseRender = vi.fn((width: number) => [`base:${width}`]);
	const requestRender = vi.fn();
	const write = vi.fn();
	const tui = {
		render: baseRender,
		requestRender,
		terminal: { columns, rows: 36, write },
	} as unknown as TUI;
	return { tui, baseRender, requestRender, write };
}

function stableTuiReference(renderer: TUI): TUI {
	return new Proxy({} as TUI, {
		get: (_target, property) => {
			const value = Reflect.get(renderer, property, renderer);
			if (typeof value !== "function") return value;
			return (...args: unknown[]) => {
				const method = Reflect.get(renderer, property, renderer);
				if (typeof method !== "function") throw new TypeError(`${String(property)} is not callable`);
				return Reflect.apply(method, renderer, args);
			};
		},
		set: (_target, property, value) => Reflect.set(renderer, property, value, renderer),
	}) as TUI;
}

const press = (x: number, y = 4) => `\u001b[<0;${x};${y}M`;
const motion = (x: number, y = 4) => `\u001b[<32;${x};${y}M`;
const release = (x: number, y = 4) => `\u001b[<0;${x};${y}m`;
const mousePress = (button: number, x: number, y = 4) => `\u001b[<${button};${x};${y}M`;

function resizeHarness(columns = 120) {
	const h = harness(columns);
	let input: ((data: string) => { consume?: boolean; data?: string } | undefined) | undefined;
	const unsubscribe = vi.fn();
	const onResizeChange = vi.fn();
	const split = createSplitPaneController({
		subscribeInput(handler) {
			input = handler;
			return unsubscribe;
		},
		onResizeChange,
	});
	split.attach(h.tui);
	split.show();
	return { ...h, split, unsubscribe, onResizeChange, send: (data: string) => input?.(data) };
}

describe("SGR mouse parsing", () => {
	it("parses press, held motion, and release coordinates", () => {
		expect(parseSgrMouseEvent(press(77))).toEqual({ button: 0, x: 77, y: 4, release: false, motion: false });
		expect(parseSgrMouseEvent(motion(70))).toMatchObject({ x: 70, motion: true, release: false });
		expect(parseSgrMouseEvent(release(70))).toMatchObject({ x: 70, motion: false, release: true });
	});
	it.each(["", "left", "\u001b[<x;1;1M", "\u001b[<0;0;1M"])("rejects malformed input: %j", (data) =>
		expect(parseSgrMouseEvent(data)).toBeUndefined(),
	);
});

describe("temporary Resize mode", () => {
	it("enables mouse reporting only during Resize mode", () => {
		const h = resizeHarness();
		expect(h.write).not.toHaveBeenCalled();
		expect(h.split.beginResize()).toBe(true);
		expect(h.write).toHaveBeenCalledWith("\u001b[?1002h\u001b[?1006h");
		expect(h.split.isResizing()).toBe(true);
		h.split.finishResize();
		expect(h.write).toHaveBeenLastCalledWith("\u001b[?1006l\u001b[?1002l");
		expect(h.unsubscribe).toHaveBeenCalledOnce();
		expect(h.split.isResizing()).toBe(false);
	});
	it("drags only from the divider and accepts on release", () => {
		const h = resizeHarness();
		h.split.beginResize();
		const dividerX = 120 - DEFAULT_SIDEBAR_WIDTH + 1;
		expect(h.send(press(dividerX))).toEqual({ consume: true });
		expect(h.send(motion(70))).toEqual({ consume: true });
		expect(h.split.getSidebarWidth()).toBe(51);
		expect(h.send(release(70))).toEqual({ consume: true });
		expect(h.split.isResizing()).toBe(false);
		expect(h.split.getSidebarWidth()).toBe(51);
	});
	it("does not start dragging for wheel or non-primary mouse events", () => {
		const h = resizeHarness();
		h.split.beginResize();
		const dividerX = 120 - DEFAULT_SIDEBAR_WIDTH + 1;

		expect(h.send(mousePress(64, dividerX))).toEqual({ consume: true });
		expect(h.send(motion(70))).toEqual({ consume: true });
		expect(h.split.getSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);

		expect(h.send(mousePress(1, dividerX))).toEqual({ consume: true });
		expect(h.send(motion(70))).toEqual({ consume: true });
		expect(h.split.getSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
	});
	it("leaves unrelated keyboard input unconsumed", () => {
		const h = resizeHarness();
		h.split.beginResize();
		expect(h.send("a")).toBeUndefined();
	});
	it("keeps Resize mode active on misses and starts dragging within one column of the divider", () => {
		const h = resizeHarness();
		h.split.beginResize();
		h.send("\u001b[C");
		expect(h.split.getSidebarWidth()).toBe(43);

		h.send(press(10));
		expect(h.split.getSidebarWidth()).toBe(43);
		expect(h.split.isResizing()).toBe(true);

		const dividerX = 120 - 43 + 1;
		h.send(press(dividerX - 1));
		h.send(motion(70));
		expect(h.split.getSidebarWidth()).toBe(51);
		h.send(release(70));
		expect(h.split.isResizing()).toBe(false);
	});
	it("supports arrows, shifted arrows, Enter, and Escape rollback", () => {
		const h = resizeHarness();
		h.split.beginResize();
		h.send("\u001b[D");
		expect(h.split.getSidebarWidth()).toBe(45);
		h.send("\u001b[1;2D");
		expect(h.split.getSidebarWidth()).toBe(49);
		h.send("\u001b");
		expect(h.split.getSidebarWidth()).toBe(44);
		h.split.beginResize();
		h.send("\u001b[C");
		h.send("\r");
		expect(h.split.getSidebarWidth()).toBe(43);
		expect(h.split.isResizing()).toBe(false);
	});
	it("refuses Resize mode when the split is hidden or not attached", () => {
		const warnings: string[] = [];
		const split = createSplitPaneController({ onWarning: (message) => warnings.push(message) });
		expect(split.beginResize()).toBe(false);
		expect(warnings.at(-1)).toContain("not ready");
		const h = harness(91);
		split.attach(h.tui);
		split.show();
		expect(split.beginResize()).toBe(false);
		expect(h.write).not.toHaveBeenCalled();
	});
	it.each(["hide", "dispose"] as const)("cleans mouse state on %s", (action) => {
		const h = resizeHarness();
		h.split.beginResize();
		h.split[action]();
		expect(h.write).toHaveBeenLastCalledWith("\u001b[?1006l\u001b[?1002l");
		expect(h.unsubscribe).toHaveBeenCalledOnce();
	});
	it("attempts remaining cleanup when disabling mouse reporting throws", () => {
		const h = resizeHarness();
		h.write.mockImplementation((sequence: string) => {
			if (sequence === "\u001b[?1006l\u001b[?1002l") throw new Error("disable failed");
		});
		h.split.beginResize();

		expect(() => h.split.finishResize()).not.toThrow();
		expect(h.unsubscribe).toHaveBeenCalledOnce();
		expect(h.onResizeChange).toHaveBeenLastCalledWith(false);
		expect(h.split.isResizing()).toBe(false);
	});
	it("attempts remaining cleanup when unsubscribe throws", () => {
		const h = resizeHarness();
		h.unsubscribe.mockImplementation(() => {
			throw new Error("unsubscribe failed");
		});
		h.split.beginResize();

		expect(() => h.split.finishResize()).not.toThrow();
		expect(h.write).toHaveBeenLastCalledWith("\u001b[?1006l\u001b[?1002l");
		expect(h.onResizeChange).toHaveBeenLastCalledWith(false);
		expect(h.split.isResizing()).toBe(false);
	});
	it("cleans up before safely reporting begin errors", () => {
		const h = resizeHarness();
		const error = new Error("enable failed");
		h.write.mockImplementationOnce(() => {
			throw error;
		});
		const onError = vi.fn(() => {
			throw new Error("report failed");
		});
		const split = createSplitPaneController({
			subscribeInput: () => h.unsubscribe,
			onResizeChange: h.onResizeChange,
			onError,
		});
		split.attach(h.tui);
		split.show();

		expect(() => split.beginResize()).not.toThrow();
		expect(h.write).toHaveBeenLastCalledWith("\u001b[?1006l\u001b[?1002l");
		expect(h.unsubscribe).toHaveBeenCalledOnce();
		expect(h.onResizeChange).toHaveBeenLastCalledWith(false);
		expect(onError).toHaveBeenCalledWith(error);
		expect(split.isResizing()).toBe(false);
	});
	it("continues cleanup when onResizeChange throws", () => {
		const h = resizeHarness();
		h.onResizeChange.mockImplementation(() => {
			throw new Error("resize callback failed");
		});
		h.split.beginResize();

		expect(() => h.split.finishResize()).not.toThrow();
		expect(h.write).toHaveBeenLastCalledWith("\u001b[?1006l\u001b[?1002l");
		expect(h.unsubscribe).toHaveBeenCalledOnce();
		expect(h.split.isResizing()).toBe(false);
	});
	it("reclamps while resizing and exits safely when terminal becomes too narrow", () => {
		const h = resizeHarness();
		h.split.setSidebarWidth(72);
		h.split.beginResize();
		expect(h.split.getSidebarWidth()).toBe(56);
		(h.tui.terminal as { columns: number }).columns = 100;
		h.split.overlayOptions().visible?.(100, 36);
		expect(h.split.getSidebarWidth()).toBe(36);
		(h.tui.terminal as { columns: number }).columns = 91;
		h.split.overlayOptions().visible?.(91, 36);
		expect(h.split.isResizing()).toBe(false);
		expect(h.write).toHaveBeenLastCalledWith("\u001b[?1006l\u001b[?1002l");
	});
});

describe("sidebar overlay sizing", () => {
	it("keeps main rendering unchanged and positions the overlay", () => {
		const h = harness(120);
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();

		expect(h.tui.render(120)).toEqual(["base:120"]);
		expect(h.baseRender).toHaveBeenLastCalledWith(120);
		expect(split.overlayOptions()).toMatchObject({
			anchor: "top-right",
			width: 44,
			maxHeight: "100%",
			margin: 0,
			nonCapturing: true,
		});
	});

	it("keeps one overlay options object and updates its width", () => {
		const h = harness(120);
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();
		const retainedOptions = split.overlayOptions();

		split.setSidebarWidth(36);

		expect(split.overlayOptions()).toBe(retainedOptions);
		expect(retainedOptions.width).toBe(36);
		expect(h.tui.render(120)).toEqual(["base:120"]);
	});

	it("keeps main rendering at full width when hidden or too narrow", () => {
		const h = harness(120);
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();

		expect(h.tui.render(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH - 1)).toEqual(["base:91"]);
		expect(split.isVisibleAtWidth(91)).toBe(false);
		expect(h.tui.render(120)).toEqual(["base:120"]);

		split.hide();
		expect(h.tui.render(120)).toEqual(["base:120"]);
	});

	it("shows the pane at the exact minimum terminal width", () => {
		const h = harness();
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();

		expect(split.isVisibleAtWidth(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH)).toBe(true);
		expect(h.tui.render(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH)).toEqual(["base:92"]);
	});

	it("passes zero and negative widths through unchanged", () => {
		const h = harness();
		const split = createSplitPaneController();
		split.attach(h.tui);

		expect(h.tui.render(0)).toEqual(["base:0"]);
		expect(h.tui.render(-5)).toEqual(["base:-5"]);
	});

	it("clamps configured and runtime widths while preserving the main pane", () => {
		const h = harness(100);
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();

		split.setSidebarWidth(999);
		expect(split.getSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH);
		expect(h.tui.render(100)).toEqual(["base:100"]);
		expect(split.overlayOptions()).toMatchObject({ width: 36 });

		split.setSidebarWidth(Number.NaN);
		expect(split.getSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH);

		split.setSidebarWidth(-10);
		expect(split.getSidebarWidth()).toBe(MIN_SIDEBAR_WIDTH);
		expect(h.tui.render(100)).toEqual(["base:100"]);
	});
});

describe("split pane render lifecycle", () => {
	it("does not replace render through Pi 0.84's stable TUI reference", () => {
		const h = harness();
		const originalRender = h.tui.render;
		const split = createSplitPaneController();

		split.attach(stableTuiReference(h.tui));
		split.show();

		expect(h.tui.render).toBe(originalRender);
		expect(h.tui.render(120)).toEqual(["base:120"]);
	});

	it("attaches once and restores the exact original method on dispose", () => {
		const h = harness();
		const original = h.tui.render;
		const split = createSplitPaneController();

		split.attach(h.tui);
		const wrapped = h.tui.render;
		split.attach(h.tui);
		expect(h.tui.render).toBe(wrapped);

		split.dispose();
		expect(h.tui.render).toBe(original);
		split.dispose();
		expect(h.tui.render).toBe(original);
	});

	it("does not overwrite a renderer installed later by another extension", () => {
		const h = harness();
		const split = createSplitPaneController();
		split.attach(h.tui);
		const atelierWrapper = h.tui.render;
		const laterWrapper = vi.fn((width: number) => atelierWrapper.call(h.tui, width));
		h.tui.render = laterWrapper;

		split.dispose();

		expect(h.tui.render).toBe(laterWrapper);
		expect(h.tui.render(120)).toEqual(["base:120"]);
	});

	it("keeps show, hide, width updates, and requests idempotent", () => {
		const h = harness();
		const split = createSplitPaneController();
		split.attach(h.tui);
		split.show();
		split.show();
		split.setSidebarWidth(44);
		split.requestRender();
		split.hide();
		split.hide();

		expect(split.isEnabled()).toBe(false);
		expect(h.tui.render(120)).toEqual(["base:120"]);
		expect(h.requestRender.mock.calls.length).toBeGreaterThan(0);
	});
});
