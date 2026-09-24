# AGENTS.md — Repository scripts

Gate scripts invoke pnpm shell-free, normalize repository-relative glob paths to `/` at ingestion, and keep platform adaptation in the gate that needs it instead of a shared platform layer. Source-ownership gates use syntax-aware discovery, guard against an empty or narrowed corpus, and test every admitted/excluded form that changes their detection boundary.

Script specs run in forked workers beside the rest of the suite and beside the other gate processes in their job, so own every port, temporary path, and child process a spec acquires. A spec that passes only when it runs alone is a defect in the spec; [the testing policy](../docs/testing.md#how-specs-execute) states the execution model and [dsh-ci-test-reliability](../.agents/skills/dsh-ci-test-reliability/SKILL.md) owns the rules.

Test skips are budgeted. [`test-skip-baseline.json`](test-skip-baseline.json) records how many cases skip on each platform, and [`verify-test-skips`](verify-test-skips.ts) fails a run above its platform's count, because a skipped suite reads green: the FreeCAD STEP → TechDraw chain has no non-interactive install, so the lane that can never run it looked covered. Skips differ per platform — each runs what the others cannot — so raise a budget deliberately with `--update` when the new skip is intended, never by widening a suite silently.
