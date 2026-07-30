import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	applyDisplayTemplate,
	derivePresetIdentity,
	REQUIRED_SEGMENT_IDS,
	reorderSegment,
	toggleSegmentVisibility,
} from "./display.js";
import { renderFooterLine, type ThemeLike } from "./footer.js";
import type {
	AtelierConfig,
	DisplayPatch,
	DisplayProvenance,
	DisplaySettings,
	FooterState,
	SegmentId,
	SessionDisplayOverride,
	TemplateName,
} from "./types.js";

export interface SettingsWorkspaceOptions {
	getDisplaySettings(): DisplaySettings;
	getDisplayProvenance(): DisplayProvenance;
	getSessionDisplayOverride(): SessionDisplayOverride | undefined;
	replaceSessionDisplayOverride(value: SessionDisplayOverride | undefined): void;
	clearSessionDisplayOverride(): void;
	persistUserDisplayPatch(patch: DisplayPatch): Promise<void>;
	applySavedUserDisplayPatch(patch: DisplayPatch): void;
	getRenderConfig(): AtelierConfig;
	getPreviewState?(): FooterState;
	theme: ThemeLike;
	colorEnabled?: boolean;
	requestWorkspaceRender(): void;
	requestLiveRender(): void;
	close(): void;
	report?(message: string, kind: "info" | "warning" | "error"): void;
}

export interface SettingsWorkspace {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
}

const PRESETS: TemplateName[] = ["editorial", "minimal", "classic"];
const DISPLAY_KEYS = ["preset", "density"] as const;
type Row =
	| { kind: "preset"; id: "preset" }
	| { kind: "density"; id: "density" }
	| { kind: "segment"; id: SegmentId }
	| { kind: "action"; id: "save" | "revert" | "undo" };

const cloneDisplay = (value: DisplaySettings): DisplaySettings => ({
	...value,
	segmentLayout: value.segmentLayout.map((entry) => ({ ...entry })),
});
const cloneOverride = (value: SessionDisplayOverride | undefined): SessionDisplayOverride | undefined =>
	value === undefined ? undefined : structuredClone(value);

const representativeState: FooterState = {
	activity: "working",
	workingLabel: "CRAFTING",
	modelId: "artisan-1",
	provider: "atelier",
	thinkingLevel: "high",
	branch: "feat/settings",
	dirty: true,
	workspacePulse: {
		status: "changed",
		data: {
			root: "/project",
			relativeCwd: "",
			branch: "feat/settings",
			snapshot: {
				trackedFiles: 2,
				untrackedFiles: 1,
				linesAdded: 24,
				linesRemoved: 3,
				binaryFiles: 0,
				submodules: 0,
				conflicts: 0,
			},
		},
	},
	metrics: {
		usageAvailable: true,
		costAvailable: true,
		input: 12_400,
		output: 3_200,
		cacheRead: 8_100,
		cacheWrite: 400,
		cacheHitPercent: 72.4,
		cost: 0.142,
		subscription: false,
		contextTokens: 32_000,
		contextWindow: 128_000,
		contextPercent: 25,
		autoCompact: true,
	},
	performance: { ttftMs: 680, tokensPerSecond: 54 },
	extensionStatuses: ["SYNC"],
};

function fit(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = truncateToWidth(text, width, "");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

function panel(title: string, lines: string[], width: number, theme: ThemeLike, accent = false): string[] {
	if (width < 4) return lines.map((line) => fit(line, width));
	const inner = width - 2;
	const color = accent ? "borderAccent" : "muted";
	const edge = (text: string) => theme.fg(color, text);
	const heading = ` ${title} `;
	const rule = Math.max(0, inner - visibleWidth(heading));
	return [
		`${edge("┌")}${theme.bold(theme.fg(accent ? "accent" : "muted", heading))}${edge("─".repeat(rule))}${edge("┐")}`,
		...lines.map((line) => `${edge("│")}${fit(line, inner)}${edge("│")}`),
		`${edge("└")}${edge("─".repeat(inner))}${edge("┘")}`,
	];
}

export function createSettingsWorkspace(options: SettingsWorkspaceOptions): SettingsWorkspace {
	let display = cloneDisplay(options.getDisplaySettings());
	let focus = 0;
	let undo: SessionDisplayOverride | undefined;
	let hasUndo = false;
	let feedback = "";
	let saving = false;

	const rows = (): Row[] => [
		...DISPLAY_KEYS.map((id) => ({ kind: id, id }) as Row),
		...display.segmentLayout.map((entry) => ({ kind: "segment", id: entry.id }) as Row),
		{ kind: "action", id: "save" },
		{ kind: "action", id: "revert" },
		{ kind: "action", id: "undo" },
	];
	const rowIndex = (target: Row, allRows = rows()): number =>
		allRows.findIndex((row) => row.kind === target.kind && row.id === target.id);
	const request = (live = false): void => {
		options.requestWorkspaceRender();
		if (live) options.requestLiveRender();
	};
	const tell = (message: string, kind: "info" | "warning" | "error" = "info"): void => {
		feedback = message;
		options.report?.(message, kind);
	};
	const refresh = (): void => {
		display = cloneDisplay(options.getDisplaySettings());
	};
	const commitMutation = (next: DisplaySettings, message: string): void => {
		undo = cloneOverride(options.getSessionDisplayOverride());
		hasUndo = true;
		const complete = cloneDisplay(next);
		complete.preset = derivePresetIdentity(complete);
		options.replaceSessionDisplayOverride(complete);
		display = complete;
		tell(message);
		request(true);
	};
	const revert = (): void => {
		undo = cloneOverride(options.getSessionDisplayOverride());
		hasUndo = true;
		options.clearSessionDisplayOverride();
		refresh();
		tell("Reverted to Effective lower-layer settings");
		request(true);
	};
	const undoOnce = (): void => {
		if (!hasUndo) {
			tell("Nothing to undo", "warning");
			request();
			return;
		}
		options.replaceSessionDisplayOverride(cloneOverride(undo));
		hasUndo = false;
		undo = undefined;
		refresh();
		tell("Undid the last Display change");
		request(true);
	};
	const save = async (): Promise<void> => {
		if (saving) return;
		saving = true;
		request();
		const patch: DisplayPatch = cloneDisplay(display);
		try {
			await options.persistUserDisplayPatch(patch);
			options.applySavedUserDisplayPatch(patch);
			refresh();
			tell("Saved as User default");
		} catch (error) {
			tell(`Save failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		} finally {
			saving = false;
			request(true);
		}
	};
	const activate = (): void => {
		const row = rows()[focus];
		if (!row) return;
		if (row.kind === "preset") {
			const current = PRESETS.indexOf(display.preset as TemplateName);
			const next = PRESETS[(current + 1 + PRESETS.length) % PRESETS.length] ?? "editorial";
			commitMutation(applyDisplayTemplate(next), `Applied ${next} preset`);
		} else if (row.kind === "density") {
			commitMutation(
				{ ...cloneDisplay(display), density: display.density === "compact" ? "comfortable" : "compact" },
				"Changed density",
			);
		} else if (row.kind === "segment") {
			if ((REQUIRED_SEGMENT_IDS as readonly SegmentId[]).includes(row.id)) {
				tell(`${row.id} is required; use Shift+Up/Down to reorder`, "warning");
				request();
				return;
			}
			commitMutation(
				{ ...cloneDisplay(display), segmentLayout: toggleSegmentVisibility(display.segmentLayout, row.id) },
				`Toggled ${row.id}`,
			);
		} else if (row.id === "save") void save();
		else if (row.id === "revert") revert();
		else undoOnce();
	};
	const move = (direction: "earlier" | "later"): void => {
		const row = rows()[focus];
		if (!row || row.kind !== "segment") {
			tell("Select a Segment to reorder", "warning");
			request();
			return;
		}
		const index = display.segmentLayout.findIndex((entry) => entry.id === row.id);
		const target = direction === "earlier" ? index - 1 : index + 1;
		if (target < 0 || target >= display.segmentLayout.length) {
			tell(`${row.id} is already at the ${direction === "earlier" ? "start" : "end"}`, "warning");
			request();
			return;
		}
		commitMutation(
			{ ...cloneDisplay(display), segmentLayout: reorderSegment(display.segmentLayout, row.id, direction) },
			`Moved ${row.id} ${direction}`,
		);
		focus = rowIndex(row);
	};

	return {
		invalidate() {},
		handleInput(data: string) {
			if (matchesKey(data, "up")) {
				focus = Math.max(0, focus - 1);
				request();
			} else if (matchesKey(data, "down")) {
				focus = Math.min(rows().length - 1, focus + 1);
				request();
			} else if (matchesKey(data, "shift+up")) move("earlier");
			else if (matchesKey(data, "shift+down")) move("later");
			else if (matchesKey(data, "enter") || data === " ") activate();
			else if (matchesKey(data, "escape")) options.close();
			else if (data.toLowerCase() === "u") undoOnce();
			else if (data.toLowerCase() === "r") revert();
			else if (data.toLowerCase() === "s") void save();
		},
		render(width: number): string[] {
			if (width <= 0) return [];
			const outerInner = Math.max(0, width - 2);
			const provenance = options.getDisplayProvenance();
			const allRows = rows();
			const marker = (row: Row) => (focus === rowIndex(row, allRows) ? options.theme.fg("accent", "›") : " ");
			const presetRow: Row = { kind: "preset", id: "preset" };
			const densityRow: Row = { kind: "density", id: "density" };
			const actionRow = (id: Extract<Row, { kind: "action" }>["id"]): Row => ({ kind: "action", id });
			const sessionChanged = options.getSessionDisplayOverride() !== undefined;
			const status = saving ? "saving…" : sessionChanged ? "session changed" : "effective";
			const displayLines = [
				`${marker(presetRow)} Preset       ${display.preset.padEnd(13)} ${provenance.preset}`,
				`${marker(densityRow)} Density      ${display.density.padEnd(13)} ${provenance.density}`,
				"",
				`${marker(actionRow("save"))} Save default ${saving ? "saving…" : "S"}`,
				`${marker(actionRow("revert"))} Revert      R`,
				`${marker(actionRow("undo"))} Undo        ${hasUndo ? "U" : "—"}`,
			];
			const segmentLines = [
				options.theme.fg("muted", `  ● shown · ○ hidden · ◆ required · order:${provenance.order}`),
				...display.segmentLayout.map((entry, index) => {
					const required = (REQUIRED_SEGMENT_IDS as readonly SegmentId[]).includes(entry.id);
					const state = required ? "◆" : entry.visible ? "●" : "○";
					const suffix = required ? "  required" : "";
					return `${marker({ kind: "segment", id: entry.id })} ${String(index + 1).padStart(2)}  ${state} ${entry.id.padEnd(12)}${suffix}`;
				}),
			];
			const previewConfig = { ...options.getRenderConfig(), ...cloneDisplay(display) };
			const previewState = options.getPreviewState?.() ?? representativeState;
			const previewLine = renderFooterLine(
				previewState,
				previewConfig,
				options.theme,
				Math.max(1, outerInner - 6),
				options.colorEnabled ?? true,
			);
			const preview = panel("Preview", [`  ${previewLine}`], outerInner, options.theme, true);
			let editing: string[];
			if (outerInner >= 72) {
				const leftWidth = Math.max(28, Math.floor((outerInner - 2) * 0.4));
				const rightWidth = outerInner - leftWidth - 2;
				const height = Math.max(displayLines.length, segmentLines.length);
				const left = panel(
					"Display",
					[...displayLines, ...Array(Math.max(0, height - displayLines.length)).fill("")],
					leftWidth,
					options.theme,
				);
				const right = panel(
					"Segment Editor",
					[...segmentLines, ...Array(Math.max(0, height - segmentLines.length)).fill("")],
					rightWidth,
					options.theme,
				);
				editing = left.map((line, index) => `${line}  ${right[index] ?? fit("", rightWidth)}`);
			} else {
				editing = [
					...panel("Display", displayLines, outerInner, options.theme),
					"",
					...panel("Segment Editor", segmentLines, outerInner, options.theme),
				];
			}
			const selected = allRows[focus];
			let guidance = "↑/↓ Select · Enter Change · S Save · Esc Close";
			if (selected?.kind === "segment") {
				const required = (REQUIRED_SEGMENT_IDS as readonly SegmentId[]).includes(selected.id);
				const visibility = required
					? "required"
					: display.segmentLayout.find((entry) => entry.id === selected.id)?.visible
						? "shown"
						: "hidden";
				guidance = `${selected.id} · ${visibility} · source:${provenance.visibility[selected.id]} · order:${provenance.order} · ${required ? "Shift+↑/↓ Reorder" : "Enter Toggle · Shift+↑/↓ Reorder"}`;
			} else if (selected?.kind === "preset" || selected?.kind === "density") {
				guidance = `${selected.id} · source:${provenance[selected.id]} · Enter Change · U Undo`;
			} else if (selected?.kind === "action") {
				guidance = `${selected.id} · Enter or ${selected.id === "save" ? "S" : selected.id === "revert" ? "R" : "U"}`;
			}
			const content = [
				fit(
					`${options.theme.bold("DISPLAY SETTINGS")}  ${options.theme.fg(sessionChanged ? "warning" : "success", status)}`,
					outerInner,
				),
				fit(options.theme.fg("muted", "↑/↓ Select · Enter Change · S Save · Esc Close"), outerInner),
				"",
				...preview,
				"",
				...editing,
				...(feedback ? ["", fit(feedback, outerInner)] : []),
				fit(guidance, outerInner),
			];
			const border = (text: string) => options.theme.fg("borderAccent", text);
			return [
				border(`╭${"─".repeat(outerInner)}╮`),
				...content.map((line) => `${border("│")}${fit(line, outerInner)}${border("│")}`),
				border(`╰${"─".repeat(outerInner)}╯`),
			].map((line) => truncateToWidth(line, width, ""));
		},
	};
}
