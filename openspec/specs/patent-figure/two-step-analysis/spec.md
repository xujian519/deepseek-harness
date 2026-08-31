# patent-figure/two-step-analysis Specification

## Purpose
Defines how patent figure analysis can run a two-step mode (structure extraction followed by description generation) through a configurable engine, how it degrades gracefully on a failed first step, and how the default single-step behavior remains unchanged.

## Requirements

### Requirement: Analysis mode is configurable

The deployment SHALL be able to select between a single-step analysis and a two-step analysis through configuration, defaulting to single-step.

#### Scenario: Two-step mode uses two passes

WHEN analysis runs in two-step mode
THEN structure extraction and description generation each perform their own model pass
AND the returned result reflects the description generated in the second pass.

#### Scenario: Single-step default uses one pass

WHEN analysis runs with the default single-step mode
THEN exactly one model pass is performed
AND the result matches the pre-existing behavior.

### Requirement: Two-step analysis degrades without failing

When the first step of a two-step analysis cannot be parsed, the tool SHALL return a usable degraded result and warn, rather than throw.

#### Scenario: Unparseable first step degrades

WHEN the structure-extraction pass of a two-step analysis returns output that cannot be parsed
THEN a result with an empty or best-effort component list is returned
AND a warning is present
AND the call does not fail.

### Requirement: Image gate and result contract are preserved

Turning on two-step mode SHALL NOT change the image-capability gate, the attachment admission, or the shape of the returned analysis result.

#### Scenario: Gated model still handled

WHEN a two-step analysis is run against a route that does not declare image input
THEN it is denied with the same image-capability error as single-step.

#### Scenario: Result shape unchanged

WHEN a two-step analysis completes successfully
THEN the returned result carries the same figure type, components, connections, description, confidence, and model-used fields as single-step analysis.
