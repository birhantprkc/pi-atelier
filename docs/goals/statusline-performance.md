# Goal Document: Configurable Statusline Performance

## Go / No-Go

- **Judgment**: Go
- **Reason**: TTFT and TPS are already measured by `RunActivityTracker`; the missing work is a bounded display and configuration path.

## Target Outcome

Users can add `performance` to Pi Atelier's configured footer `segments` and see the latest response's TTFT and TPS in the Status Rail, including estimated streaming TPS and final TPS.

## Goal Definition

- **Type**: product
- **Boundary**: Add a configurable footer segment, connect it to existing response-performance state, expose it in the display menu, and document it.
- **Non-goals**:
  - Changing how TTFT or TPS is calculated.
  - Enabling the segment in existing presets by default.
  - Removing or changing the Sidebar performance row.
- **Deferred work**:
  - Separate TTFT-only and TPS-only segments.
  - User-configurable labels, precision, or responsive priority.
- **Verification rule**: Focused tests prove configuration acceptance, footer rendering, live event integration, and menu exposure; the full repository check passes.
- **Evidence source**: Vitest assertions, TypeScript checking, linting, formatting checks, and package verification.
- **Pass criteria**: `performance` is accepted as a segment; configured footers show placeholders, estimated values, and final values; unconfigured footers remain unchanged; all checks pass.
- **Confidence note**: Tests exercise both the pure footer renderer and the extension event lifecycle that owns the metric source.
- **Judgment owner**: Automated repository checks.

## Current State

- `RunActivityTracker` already measures TTFT and estimated/final TPS.
- The Sidebar always renders `TTFT ~ · TPS ~` and later values.
- Footer configuration has no `performance` segment and the footer receives no run-performance snapshot.
- Existing presets must retain their current output unless the user opts in.

## Priority Rationale

- Define the public configuration contract first so rendering and integration target a stable behavior.
- Prove the pure footer behavior before connecting lifecycle state, limiting integration debugging to the event boundary.

## Assumptions and Open Decisions

| Item | Status | Impact | Owner / Next step |
| --- | --- | --- | --- |
| Segment name is `performance` | confirmed | Gives configuration and menu one stable term | Implementation |
| Segment is opt-in | confirmed | Avoids changing existing presets and terminal width usage | Tests enforce default absence |
| Footer text matches Sidebar text | confirmed | Prevents terminology and precision drift | Share formatting logic |
| Performance is a single responsive item | assumed | TTFT and TPS disappear together when width is constrained | Verify through footer tests |

## Phases

### Phase 1: Configuration Contract

- **Purpose**: Make `performance` a valid optional footer segment without changing defaults.
- **Entry condition**: Goal document is present and the feature branch is active.
- **Phase rules**:
  - Add no default preset output.
  - Start with a failing configuration test.
- **Todos**:
  - [ ] Accept and preserve `performance` in configured segment order.
    - **Surface**: Types, config validation, tests.
    - **Proof**: Focused configuration test passes after first failing for an unknown segment.
    - **Depends on**: None.
- **Exit proof**: Configuration test passes and default segments do not contain `performance`.
- **Stop condition**: Existing segment compatibility requires a migration.

### Phase 2: Footer Behavior

- **Purpose**: Render current performance in the Status Rail when configured.
- **Entry condition**: `performance` is a valid segment.
- **Phase rules**:
  - Reuse the existing metric calculations and visual text.
  - Preserve placeholders and the estimated TPS marker.
  - Keep the item optional under responsive composition.
- **Todos**:
  - [ ] Render placeholder, estimated, and final performance states.
    - **Surface**: Run-activity formatting, footer renderer, footer tests.
    - **Proof**: Focused footer tests pass after demonstrating RED.
    - **Depends on**: Phase 1.
- **Exit proof**: Pure rendering tests cover configured and unconfigured behavior.
- **Stop condition**: Rendering requires a second source of performance truth.

### Phase 3: Live Integration and Controls

- **Purpose**: Feed live metrics into the footer and expose the segment through the menu.
- **Entry condition**: Pure footer behavior passes.
- **Phase rules**:
  - Read from the existing `RunActivityTracker` snapshot.
  - Do not duplicate timing or token calculations.
  - Start each behavior with a failing test.
- **Todos**:
  - [ ] Connect extension events to configured footer output.
    - **Surface**: Extension lifecycle and integration tests.
    - **Proof**: Streaming and final values appear in the rendered footer.
    - **Depends on**: Phase 2.
  - [ ] Make `performance` selectable in Toggle segments.
    - **Surface**: Menu and menu tests.
    - **Proof**: Menu test observes and toggles the segment.
    - **Depends on**: Phase 1.
- **Exit proof**: Focused extension and menu tests pass.
- **Stop condition**: The footer lifecycle cannot access the active tracker without cross-session leakage.

### Phase 4: Documentation and Full Verification

- **Purpose**: Make configuration discoverable and ensure release-level quality.
- **Entry condition**: All focused behavior tests pass.
- **Phase rules**:
  - Document opt-in behavior and responsive omission accurately.
  - Do not change unrelated release metadata.
- **Todos**:
  - [ ] Update README and changelog.
    - **Surface**: User documentation.
    - **Proof**: Documented JSON example and footer anatomy match code.
    - **Depends on**: Phase 3.
  - [ ] Run the complete check suite.
    - **Surface**: Repository.
    - **Proof**: `npm run check` exits successfully.
    - **Depends on**: Documentation.
- **Exit proof**: Full check passes and git diff contains only goal-related changes.
- **Stop condition**: A regression remains after focused diagnosis.

## Dry-Run Findings

- The active run tracker is created before the footer, so the footer can read the same snapshot without introducing another store.
- Footer state needs an optional performance field; optionality preserves existing tests and callers.
- A shared formatter prevents Sidebar and footer precision or placeholder behavior from drifting.

## Final Validation

- `npm run check`
- Inspect `git diff --check` and verify the active branch is `feat/statusline-performance`.

## First Execution Step

Add a configuration test that expects `performance` to survive validation, then run it to capture the RED failure.
