## Purpose

Defines how figure generation infers the figure type, renders multi-panel figures (such as FIG. 1A/1B) sharing a single numeral series, and automatically continues reference numerals across figures of the same invention family without duplicates or gaps or errors on legacy index data.

## ADDED Requirements

### Requirement: Figure type is inferable when omitted

When `figure_type` is omitted, the tool SHALL infer it from the single structural input present, and SHALL require an explicit type when the input is ambiguous or empty.

#### Scenario: Single structured input infers flowchart

WHEN figure generation is invoked with only `steps` provided and no `figure_type`
THEN the figure type is inferred as a flowchart
AND generation succeeds.

#### Scenario: Ambiguous inputs require explicit type

WHEN figure generation is invoked with more than one structural input present and no `figure_type`
THEN the call fails with an invalid-input error asking for an explicit figure type
AND no figure is generated.

#### Scenario: No structure requires explicit type

WHEN figure generation is invoked with no structural input and no `figure_type`
THEN the call fails with an invalid-input error.

### Requirement: Multi-panel figures share one numeral series

A figure generation call SHALL be able to produce multiple panels that share a single reference-numeral series without reuse or collision.

#### Scenario: Two panels share the series

WHEN a generation call specifies two panels
THEN each panel is written to a distinct `figN<suffix>` file (such as `fig1A` and `fig1B`) in the requested format
AND the reference numerals across the two panels are drawn from one continuous series with no duplicates.

#### Scenario: Panels combined with top-level structure are rejected

WHEN a generation call provides `panels` together with a top-level structural input, or provides an empty `panels` list
THEN the call fails with an invalid-input error
AND no figure is generated.

### Requirement: Cross-figure numerals continue automatically for a declared invention family

When a generation call declares an invention family, figure generation SHALL automatically reuse numerals already assigned to components in earlier figures of that family and continue the series for new components; without a declared family, numbering SHALL behave as before.

#### Scenario: Same component keeps its numeral across figures

WHEN a figure declaring a family is generated that contains a component already assigned a numeral in an earlier figure of that family
THEN that component uses the same numeral as before.

#### Scenario: New component continues the series

WHEN a later figure for the same declared family introduces a new component
THEN the new component receives the next available numeral that does not collide with existing family numerals.

#### Scenario: No family declared keeps per-figure numbering

WHEN a generation call omits the family declaration
THEN numerals are assigned fresh from the figure's own series as before
AND no prior index entries influence the assignment.

### Requirement: Legacy index data remains safe

Reading an index that predates a family marker SHALL NOT cause generation to fail.

#### Scenario: Legacy index without family markers

WHEN figure generation loads an index whose entries carry no family marker
THEN those entries are treated as belonging to no family
AND generation proceeds without error.
