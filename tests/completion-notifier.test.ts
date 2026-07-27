import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
	createCompletionNotifier,
	type CompletionNotification,
	type NotificationProcess,
	type SpawnNotificationProcess,
} from "../src/completion-notifier.js";

class FakeProcess extends EventEmitter implements NotificationProcess {
	kill = vi.fn(() => true);
	unref = vi.fn();
}

const settled: CompletionNotification = {
	kind: "turn-settled",
	projectName: "pi-atelier",
	sessionName: "Notification work",
	durationMs: 3_200,
	completedToolCount: 2,
	failedToolCount: 1,
};

function harness(platform: NodeJS.Platform = "linux") {
	const terminal = vi.fn();
	const process = new FakeProcess();
	const spawn = vi.fn<SpawnNotificationProcess>(() => process);
	let enabled = true;
	const notifier = createCompletionNotifier({
		platform,
		spawn,
		terminal,
		isEnabled: () => enabled,
	});
	return { notifier, terminal, spawn, process, disable: () => (enabled = false) };
}

describe("completion notifier", () => {
	it("notifies once when a run settles without using a duration threshold", () => {
		const h = harness();
		h.notifier.runStarted();
		h.notifier.turnSettled({ ...settled, durationMs: 0 });
		h.notifier.turnSettled(settled);

		expect(h.terminal).toHaveBeenCalledOnce();
		expect(h.terminal).toHaveBeenCalledWith("Turn settled · Notification work · 2 done · 1 failed", "info");
	});

	it("notifies once per explicit input-request tool call", () => {
		const h = harness();
		h.notifier.runStarted();
		const notification: CompletionNotification = {
			kind: "input-requested",
			projectName: "pi-atelier",
			sessionName: "Notification work",
		};
		h.notifier.inputRequested("question-1", notification);
		h.notifier.inputRequested("question-1", notification);
		h.notifier.inputRequested("question-2", notification);

		expect(h.terminal).toHaveBeenCalledTimes(2);
		expect(h.terminal).toHaveBeenLastCalledWith("Input requested · Notification work", "info");
	});

	it("does nothing while completion notifications are disabled", () => {
		const h = harness("darwin");
		h.disable();
		h.notifier.runStarted();
		h.notifier.inputRequested("question-1", { kind: "input-requested", projectName: "private" });
		h.notifier.turnSettled(settled);

		expect(h.terminal).not.toHaveBeenCalled();
		expect(h.spawn).not.toHaveBeenCalled();
	});

	it("spawns a detached macOS notification without interpolating content into AppleScript", () => {
		const h = harness("darwin");
		h.notifier.runStarted();
		h.notifier.turnSettled(settled);

		expect(h.spawn).toHaveBeenCalledOnce();
		const [command, args, options] = h.spawn.mock.calls[0]!;
		expect(command).toBe("osascript");
		expect(args).toContain("Pi Atelier · pi-atelier");
		expect(args).toContain("Turn settled · Notification work · 2 done · 1 failed");
		expect(args.slice(0, -2).join(" ")).not.toContain("Notification work");
		expect(options).toMatchObject({ detached: true, stdio: "ignore" });
		expect(h.process.unref).toHaveBeenCalledOnce();
	});

	it("spawns a hidden Windows toast with notification content passed through the environment", () => {
		const h = harness("win32");
		h.notifier.runStarted();
		h.notifier.turnSettled(settled);

		const [command, args, options] = h.spawn.mock.calls[0]!;
		expect(command).toBe("powershell.exe");
		expect(args).toEqual(expect.arrayContaining(["-NoProfile", "-NonInteractive", "-Command"]));
		expect(args.join(" ")).not.toContain("Notification work");
		expect(options).toMatchObject({ detached: true, stdio: "ignore", windowsHide: true });
		expect(options.env).toMatchObject({
			PI_ATELIER_NOTIFICATION_TITLE: "Pi Atelier · pi-atelier",
			PI_ATELIER_NOTIFICATION_BODY: "Turn settled · Notification work · 2 done · 1 failed",
		});
	});

	it("kills pending system notifications when reset", () => {
		const h = harness("darwin");
		h.notifier.runStarted();
		h.notifier.turnSettled(settled);

		h.notifier.reset();

		expect(h.process.kill).toHaveBeenCalledOnce();
	});

	it("kills a native notification that exceeds its delivery timeout", () => {
		vi.useFakeTimers();
		try {
			const h = harness("darwin");
			h.notifier.runStarted();
			h.notifier.turnSettled(settled);

			vi.advanceTimersByTime(5_000);
			expect(h.process.kill).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it("clears the process timeout after native delivery exits", () => {
		vi.useFakeTimers();
		try {
			const h = harness("darwin");
			h.notifier.runStarted();
			h.notifier.turnSettled(settled);
			h.process.emit("exit", 0);

			vi.advanceTimersByTime(10_000);
			expect(h.process.kill).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps terminal delivery cross-platform and skips unsupported system delivery", () => {
		const h = harness("linux");
		h.notifier.runStarted();
		h.notifier.turnSettled(settled);

		expect(h.terminal).toHaveBeenCalledOnce();
		expect(h.spawn).not.toHaveBeenCalled();
	});

	it("silently absorbs system spawn failures", () => {
		const terminal = vi.fn();
		const notifier = createCompletionNotifier({
			platform: "darwin",
			terminal,
			isEnabled: () => true,
			spawn: () => {
				throw new Error("unavailable");
			},
		});
		notifier.runStarted();

		expect(() => notifier.turnSettled(settled)).not.toThrow();
		expect(terminal).toHaveBeenCalledOnce();
	});
});
