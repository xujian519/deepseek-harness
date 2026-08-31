## Purpose

Defines how block and hierarchy patent figures render reference numerals as a numeral with a leader line pointing to the component, how this can be disabled, and how non-vector output reports the limitation instead of silently dropping it.

## ADDED Requirements

### Requirement: Leader-line numerals are the default for block and hierarchy figures

Block diagrams and component hierarchy figures SHALL render reference numerals as a numeral placed outside the component connected by a leader line, by default, when producing vector output.

#### Scenario: Block diagram renders leader-line numerals

WHEN a block diagram is generated in SVG format without disabling leader lines
THEN the output contains a leader-line segment and an associated numeral labeled outside the component
AND the component label carries no embedded `(NN)` suffix, so each numeral appears exactly once.

#### Scenario: Hierarchy figure renders leader-line numerals

WHEN a component hierarchy is generated in SVG format
THEN its reference numerals are rendered with leader lines pointing to each component.

### Requirement: Flowchart numerals keep embedded prefixes

Flowchart figures SHALL keep their conventional numeral prefix inside the step label.

#### Scenario: Flowchart unaffected by leader-line default

WHEN a flowchart is generated
THEN each step label retains its `NNN. ` prefix in place
AND no leader-line behavior is applied.

### Requirement: Leader-line numerals can be disabled

A caller SHALL be able to opt out of leader-line numerals and fall back to embedded numerals.

#### Scenario: Disabled for a block diagram

WHEN a block diagram is generated with leader lines disabled
THEN the reference numeral is embedded in the component label
AND no leader-line segment is emitted.

### Requirement: Reference annotation supports both placements

The existing SVG reference-annotation tool SHALL keep its inline placement by default and offer leader-line placement on request.

#### Scenario: Inline placement by default

WHEN references are appended to an existing SVG without requesting leader lines
THEN each matched text keeps the appended ` (NN)` suffix inline
AND no leader-line segment is emitted.

#### Scenario: Leader-line placement requested

WHEN references are appended to an existing SVG with leader lines requested
THEN the numerals are placed outside the matched text connected by leader lines
AND unmatched references are reported as warnings.

### Requirement: Non-vector output reports limitation

When leader-line numerals are requested but the output format cannot represent them, the call SHALL surface an informative warning and continue.

#### Scenario: PNG with leader lines enabled

WHEN a block diagram is generated in PNG format with leader lines enabled
THEN a warning is returned noting leader lines apply only to vector output
AND the PNG artifact is still produced.
