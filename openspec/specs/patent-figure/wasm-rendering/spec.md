# patent-figure/wasm-rendering Specification

## Purpose
Defines how patent figure rendering produces SVG/PNG/PDF output without requiring a system Graphviz binary, and how renderer selection and error classification stay observable to the caller.

## Requirements

### Requirement: Renderer selection is configurable

The deployment SHALL be able to select between the bundled in-process renderer and the system CLI renderer through configuration, defaulting to the bundled renderer.

#### Scenario: Bundled renderer chosen by default

WHEN figure rendering is invoked without a renderer override
THEN the bundled in-process renderer is used
AND figure output is produced even when no `dot` binary exists on the host.

#### Scenario: CLI renderer explicitly selected

WHEN the renderer is configured to the CLI engine and a `dot` executable is available
THEN rendering proceeds via that executable
AND the configured executable path is honored.

#### Scenario: CLI renderer selected but Graphviz absent

WHEN the CLI renderer is explicitly selected but no `dot` executable can be resolved
THEN the call fails with a setup-required error that carries install guidance.

### Requirement: Rendering succeeds without a system graphviz binary

The bundled renderer SHALL render the formats its Graphviz build supports (text formats, including SVG) to disk without invoking any external binary. Formats the build cannot produce (PNG, PDF) SHALL route through the CLI fallback.

#### Scenario: SVG rendering without `dot`

WHEN a figure is rendered in SVG format using the bundled renderer on a host with no `dot` executable
THEN a valid SVG file is written to the output directory and its path is returned.

#### Scenario: PNG routes through the CLI fallback

WHEN a block diagram is rendered in PNG format using the bundled renderer and a `dot` executable is available
THEN the PNG is produced through the CLI fallback and its path is returned.

#### Scenario: PNG without a CLI renderer fails with install guidance

WHEN a figure is rendered in PNG format using the bundled renderer and no `dot` executable can be resolved
THEN the call fails with a setup-required error that carries install guidance.

### Requirement: Rendering errors are classified distinctly

Rendering failures SHALL be distinguishable from the not-installed condition and from caller cancellation.

#### Scenario: Syntax error maps to render failure

WHEN the supplied DOT text is invalid and the renderer reports a failure
THEN the call resolves to a render-failed error, not a setup-required error.

#### Scenario: Caller cancellation maps to aborted

WHEN the caller aborts a rendering call
THEN the call resolves to an aborted error.

#### Scenario: Bundled engine load failure maps to not-installed

WHEN the bundled WASM engine fails to load
THEN the call resolves to the same setup-required error class as a missing CLI executable
AND the error message names the bundled engine rather than a system package.

### Requirement: Output contract stays format-stable

The rendered artifact SHALL honor the requested format and be written under the configured output directory with a stable path return.

#### Scenario: PDF requested

WHEN PDF format is requested either through the bundled renderer or its CLI fallback
THEN a PDF file is produced or, if the bundled renderer cannot produce PDF, the CLI fallback is used
AND a setup-required error is returned only when neither path can produce the format.
