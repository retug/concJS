# Verification cases

The framework serves read-only Django pages at
`/concretedesign/verification/` and `/concretedesign/verification/problem1/`.
It does not run structural analysis on the web server. Problem 1 includes an
actual application screenshot, the supplied 100-profile RETUG curve, the 16
published spColumn control points, and a table of factored differences.

## Add another model

1. Save the application JSON in a dedicated directory under `verification/`.
2. Add a case to `catalog.json`. Give it a stable, unique `id` (for example
   `problem2`), the source citation, descriptive details, a repository-relative
   `modelSource`, and a unique `modelFile` basename (for example `problem2.json`).
3. Run `npm run build:verification` to validate the catalog and saved models.
   This copies the original JSON bytes without changing their material curves,
   mesh settings, metadata, or demands.
4. Run `npm run deploy:retug` to build and copy the pages, app, catalog, and models
   to the local Django repository. The script installs one URL include; later
   cases need no new Python routes or page templates. Use `-DryRun` to review
   destinations first, or `-SiteRoot` for another Django checkout.
5. Review locally, then use the Django site's existing deployment and
   `collectstatic` process to publish. This tool does not publish to Heroku.

The catalog is the source of truth for page content and supported model IDs.
Templates and CSS are maintained in `site/`; Django views are in `site/python/`.
`deployment/verification/` and `public/static/concgui/verification/` are generated.
Run the verification build **after** Webpack, whose clean output removes old
assets from `public/static/concgui/`. `build:deployment` and `deploy:retug` do this.

`/concretedesign/?verification=problem1` opens the app, restores the current
browser session, fetches the catalog's bundled model, and asks before replacing
the model. Cancel keeps the restored project. Import does not run analysis.
For Vite development, use `/?verification=problem1`; the information pages are
Django templates and are previewed through Django.

## Numerical verification

`npm run test:verification` checks the original uniform-compression result
(nominal axial force **−103233.876 kip**) and all 100 nominal/factored profiles
at 90 degrees. `npm test` includes these checks too. The UI inherits its numerical
methods from `src/analysis/SectionAnalysis.js`; the Node runner uses the same
methods, contour reconstruction, material curves, and `buildResolvedSectionMesh`.
It reproduces the supplied values within **0.0051 kip or kip-ft**, reflecting
the input table's two-decimal precision, and checks profile strain parameters
within 1e-10. The resolved mesh has 7,008 triangles and 18,432 square inches.

The files under `complicatedSPColumn/` have distinct roles:

- `retug-90deg-results.txt`: unmodified user-supplied result table.
- `retug-90deg-baseline.json`: those same rounded numerical values, plus strain
  parameters verified with the shared engine and a fingerprint of the model inputs.
- `published-control-points.json`: supplied spColumn values checked visually
  against report page 6 (PDF page 36); sub-0.1 kip-ft residuals are normalized to zero.
- `problem1-section.png`: screenshot of this model in the application.
- The saved project JSON: model inputs plus all 16 published demand checks.

`build:verification` reruns the engine and checks the fixed baseline before
generating the comparison JSON and SVG. It checks demand inputs against the
published controls too. Changing numerical answers or section/material/mesh
inputs stops the build; there is no automatic baseline-update command. Intentional
baseline changes must be separately reviewed and reconciled with the pasted
source table. Normal builds never overwrite either source. Metadata and demand
inputs are excluded from the numerical model fingerprint.

Both the Django table and SVG plot are generated from the same comparison
artifact. To add another completed comparison, register `comparisonSource` and
`resultsSource` alongside the model entry and set `status` to `comparison-ready`.
Use `model-ready` for cases whose reference results are still pending. Register
`previewSource` and a PNG `previewFile` to show a case screenshot. Extend the
control matching/runner explicitly when a future case needs a different axis or
material model. CI can invoke `npm run test:verification` on every change.

## Matching and interpretation

The table matches named control states, rather than a nearest sampled point
or an arbitrary crossing at the published factored P. This avoids ambiguity
where the factored curve folds. The current saved steel yields at 0.00207;
the report's Grade 80 steel yields at approximately 0.00276. The saved engine's
tension-control threshold is 0.00507, versus approximately 0.00576 in spColumn.
These differences are documented, not corrected as part of verification.

Steel-control rows use extreme tensile strain; the half-yield point is linearly
interpolated. Pure bending interpolates at φP = 0. Allowable compression takes
the end of the plotted capped branch at the published φP. All interpolation
uses the supplied rounded profiles, and the table identifies the bracketing
profiles. The maximum-compression row retains the displayed RETUG 0.80 cap and
therefore shows a 20% difference from the report's uncapped φP maximum.

P is displayed positive in compression. Published Y-moment maps to RETUG **My / M3**
for this model, whose long dimension is along x. Relative differences are
`100 * abs(computed - published) / abs(published)`. Zero reference components
have no relative percentage; they display a dash. The comparison table shows
only P and M3. M2 remains in the downloadable data and model's demand inputs
for the application's general biaxial checks.

Orange points are the supplied factored RETUG profiles; the gray dashed curve
is nominal. Teal connects the published control points only as a guide. The
report states that its design diagram omits the axial-capacity increase between
balanced and tension control, so this guide is not a reconstructed design envelope.

This fixture uses a 3 in. mesh and its saved material curves. It is not the
illustrative reference site's 2 in. Whitney-model calculation. A stable numerical
baseline is a regression check, not a claim that every result agrees with spColumn
or that every axis/member design provision has been validated.

The current JSON schema already preserves demand inputs under
`analysisConfiguration.demandCases`: `{ id, name, P, M2, M3 }`, with force in kip
and moments in kip-ft. RETUG uses negative P for compression; `M2 = Mx` and
`M3 = My` about the section centroid. Problem 1 now includes all 16 published
controls in `analysisConfiguration.demandCases` with negative P for compression,
M2 = 0, and the published signed moment in M3. Existing projects without demands
still default to an empty list. Computed DCRs/capacity results remain transient
and are recalculated; the page's named-state percentage comparison is distinct
from the application's constant-P demand/capacity check.
