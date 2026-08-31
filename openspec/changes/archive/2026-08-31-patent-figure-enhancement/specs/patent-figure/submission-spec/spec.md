## Purpose

Defines how patent figure output complies with submission specifications (page size, resolution, margin, orientation) through configuration and per-call override, while keeping the unconfigured behavior identical to the current output.

## ADDED Requirements

### Requirement: Submission layout is configurable

The deployment SHALL be able to set page size, resolution, margin, and orientation through configuration, and the renderer SHALL apply them to the figure output.

#### Scenario: A4 portrait at 300 DPI configured

WHEN page size A4, 300 DPI, portrait orientation, and a margin are configured
THEN the emitted diagram declares the corresponding page, size, dpi, and margin attributes.

#### Scenario: Landscape orientation configured

WHEN landscape orientation is configured
THEN the emitted DOT declares `orientation=landscape`.

### Requirement: Per-call override takes precedence

An individual figure-generation call SHALL be able to override the configured page size, resolution, and orientation.

#### Scenario: Call overrides page size

WHEN a figure-generation call passes a page size different from the configured value
THEN the emitted diagram uses the call-provided page size.

#### Scenario: Call overrides resolution

WHEN a figure-generation call passes a resolution different from the configured value
THEN the emitted output is rendered at the call-provided resolution.

#### Scenario: Call overrides margin

WHEN a figure-generation call passes a margin different from the configured value
THEN the emitted diagram uses the call-provided margin.

### Requirement: Unconfigured behavior is unchanged

When no submission-layout parameters are supplied, the figure output SHALL behave exactly as before this change.

#### Scenario: No parameters, no layout attributes

WHEN figure generation runs with no page, dpi, orientation, or margin specified
THEN the emitted diagram contains no new layout attributes
AND the output matches the pre-existing behavior.

#### Scenario: Defaults preserved for existing consumers

WHEN an existing caller invokes figure generation without the new parameters
THEN the returned path, format, and index entry remain unchanged.
