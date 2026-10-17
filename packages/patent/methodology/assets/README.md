# TRIZ data assets

English | [中文](README.zh.md)

Provenance, license status, known deviations, and validation for `triz-matrix.json` and `triz-principles.json`.

## Provenance

### Contradiction matrix

`triz-matrix.json` is a 39×39 transcription of the classical Altshuller contradiction matrix. The reviewed chain is:

| Step | Source | Role |
| --- | --- | --- |
| 1 | Genrich Altshuller, *Creativity as an Exact Science* (1985), and the classical TRIZ literature | Original 39 engineering parameters, 40 inventive principles, and contradiction matrix |
| 2 | Casey Perno (2007), `triz_matrix.xls`, sheet `CM4` | Spreadsheet transcription of the classical matrix |
| 3 | [`kamil-szczepanik/TRIZ-Agents`](https://github.com/kamil-szczepanik/TRIZ-Agents), `data/tools_sources/triz_matrix.xls` | Copy of the Perno spreadsheet used for the 2026-10-17 correction |
| 4 | [`mmysior/pytriz`](https://github.com/mmysior/pytriz), `src/pytriz/resources/matrix_values.csv` | Independent second transcription used to cross-check every cell |
| 5 | [`Antropocosmist/triz-engineering-solver`](https://github.com/Antropocosmist/triz-engineering-solver) | Earlier intermediate JSON in the same lineage; not used as a source of truth for the correction |
| 6 | This package, `assets/triz-matrix.json` | Shipped asset, indexed `matrix[worsening - 1][improving - 1]` |

Steps 3 and 4 agree on all 1521 cells: 1248 filled, 39 diagonal empties, and 234 off-diagonal empties. The spreadsheet layout stores rows as improving parameters and columns as worsening parameters; the shipped JSON transposes that layout into the `[worsening][improving]` order used by `lookupMatrixCell(improving, worsening)`.

No stable canonical URL is recorded for the Perno 2007 page. The reviewed spreadsheet carries the document metadata author `Jim Pinto`; the Perno attribution comes from the secondary literature around this widely copied transcription. Treat the transcription lineage as documented but not independently authenticated at the original page.

### Inventive principles

`triz-principles.json` contains the 40 classical principle names and Chinese explanations. The English names and the principle set are classical TRIZ material. **The Chinese name and description text has no source or translation record in this repository; its provenance is unconfirmed.** Do not claim that the translation is license-cleared until that record exists.

### Separation principles

`triz-separations.json` describes the five classical separation dimensions — space, time, condition, direction, and system level. The English text and the applicability signals were written for this package from the classical TRIZ separation principles; no third-party text is copied. The asset is not a translation of a source file, so its license is the package's MIT license.

## License status

| Source | Declared license | Status |
| --- | --- | --- |
| Altshuller, classical TRIZ matrix and principles | Public classical material; no open-source license applies to the underlying facts | Facts are not copyrightable in most jurisdictions; the specific transcription and translated prose still need review |
| Casey Perno, `triz_matrix.xls` | No license recorded with the file | Unknown |
| `kamil-szczepanik/TRIZ-Agents` | README states MIT; GitHub reports no LICENSE file | Unconfirmed at repository level |
| `mmysior/pytriz` | MIT | Confirmed |
| `Antropocosmist/triz-engineering-solver` | MIT | Confirmed |
| This package's Chinese principle text | Not recorded | Unconfirmed |

The matrix is a table of facts; the copyright risk is concentrated in the Chinese explanations and in any copied spreadsheet formatting. Record written confirmation for the Chinese text and for the Perno transcription before treating the package as license-cleared.

## Known deviations

- **Transcription gaps**: 234 cells off the diagonal carry no recommendation in both independent transcriptions. They are matrix gaps, not physical contradictions. Do not describe them as separation cases.
- **Duplicate source cell**: `(improving 19, worsening 9)` is `[8, 35, 35]` in both the Perno spreadsheet and the pytriz CSV. The raw asset preserves the source value; `lookupMatrixCell` deduplicates to `[8, 35]`. No replacement set has been guessed.
- **Single-principle cells**: an earlier intermediate dataset dropped 58 cells whose recommendation was a single principle. The 2026-10-17 correction restored all 58; the matrix now has 1248 filled cells.
- **Classical matrix only**: no newer, derived, or domain-specific matrix is included.
- **Off-diagonal empties are asymmetric in meaning**: an empty cell after a correction does not imply that TRIZ has no answer; it means this transcription records none.

## Validation

Run the package checks:

```sh
pnpm exec vitest run packages/patent/methodology/tests
```

The test suite asserts:

- 39×39 dimensions and principle numbers in 1–40.
- `filled = 1248`, `diagonalEmpty = 39`, `offDiagonalEmpty = 234`.
- Anchor cells: `(improving 14, worsening 1) = [1, 8, 40, 15]`, `(9, 10) = [13, 28, 15, 19]`, `(3, 15) = [19]`, `(6, 14) = [40]`, `(14, 20) = [35]`.
- Exactly one raw duplicate cell, `(19, 9) = [8, 35, 35]`; lookup returns `[8, 35]`.

Ad-hoc count check:

```sh
node -e "const M=require('./packages/patent/methodology/assets/triz-matrix.json');const f=M.flat();console.log(JSON.stringify({rows:M.length,cols:M[0].length,filled:f.filter(c=>c.length).length,empty:f.filter(c=>!c.length).length,diagonalEmpty:M.filter((r,i)=>r[i].length===0).length,offDiagonalEmpty:f.filter(c=>!c.length&&Math.floor(i/39)!==i%39).length,duplicates:f.filter(c=>new Set(c).size!==c.length).length}))"
```

Expected: `{"rows":39,"cols":39,"filled":1248,"empty":273,"diagonalEmpty":39,"offDiagonalEmpty":234,"duplicates":1}`.

## Regeneration procedure

1. Read sheet `CM4` of `triz_matrix.xls`. Data rows 3–41 and columns C–AQ hold improving parameters 1–39 and worsening parameters 1–39; `+`, `-`, and empty cells mean no recommendation.
2. Parse every remaining non-empty cell with `\d+`; do not split on commas alone, because at least one source cell separates principles with a space.
3. Transpose into `matrix[worsening - 1][improving - 1]`.
4. Cross-check every cell against `pytriz`'s `matrix_values.csv`; both sources must agree before replacing the asset.
5. Preserve source anomalies; deduplicate only in `lookupMatrixCell`.
6. Re-run the package tests and the count command above.
