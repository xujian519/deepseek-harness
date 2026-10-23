# OA retro evaluation subset

`subset.jsonl` is a five-case, anonymized slice of the OA retrospective
evaluation set used by `scripts/adversary-eval.ts`. It exists so a checkout can
regress the dataset parser, the anonymization scan, and the (statute, claim)
coverage shape without shipping the full corpus.

The full set is 30 cases / 53 disputes, built from the owner's local archive
and kept under the ignored `.dsh-work/patent-oa-retro/` directory. It is not
committed: the material is derived from real examination files, and only this
reviewed slice is published.

Selected cases cover the four statutes the full set exercises and claim
positions 1, 2, 3, and 5:

| Case | Statutes | Claims |
|---|---|---|
| `oa-001` | A22.3 | 1, 2, 3 |
| `oa-006` | A22.2, A22.3 | 1 |
| `oa-018` | A33 | 1, 2, 3 |
| `oa-021` | A26.4 | 1, 5 |
| `oa-029` | A22.3, A33 | 1, 2 |

Validate it with:

```sh
pnpm exec tsx scripts/patent-oa-retro.ts scripts/fixtures/patent-oa-retro/subset.jsonl --min-cases 5
```

`scripts/adversary-eval.spec.ts` checks the same file: parse, anonymization
scan, the four-statute / three-claim-position minimum, and the shape of the
stored disputes.
