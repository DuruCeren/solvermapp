# Releasing a new version

A checklist for maintainers. Zenodo archives every GitHub release and gives it a DOI, so a release cannot be taken back: check before you publish.

1. **Tests pass:** `python tests/run_all.py`, with MATLAB if you have it. The *Tests* workflow on GitHub must be green on `main`.
2. **Check by hand in a browser:**
   - open `index.html` with an empty browser profile (or a private window);
   - the Guide shows, *See an example* opens the demo, and the tour starts;
   - export the demo's code in all three languages;
   - import every file in `examples/`.
3. **Version:** choose it with [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`):
   - a patch for fixes;
   - a minor version for new features that keep saved projects working;
   - a major version for breaking changes.
4. **CHANGELOG.md:** rename *Unreleased* to the version and today's date, start a new empty *Unreleased*, and update the links at the bottom.
5. **CITATION.cff:** set `version` and `date-released`.
6. **Commit and push:**
   ```sh
   git commit -am "Release vX.Y.Z"
   git push
   ```
7. **Publish on GitHub:**
   - Releases → *Draft a new release*;
   - tag `vX.Y.Z` (create it on `main`), title `SolverMapp X.Y.Z`;
   - paste the CHANGELOG section as the description;
   - *Publish release*.
8. **Zenodo** archives the release within minutes. Check the new version on Zenodo; the DOI badge in the README points to the latest version by itself.
9. **Announce it** where your users are, with the DOI.

## Snapshots

When a release changes the generated code, report or flowchart on purpose, the snapshots in `tests/snapshots/` must already have been updated (`python tests/test_snapshots.py --update`) and reviewed in the pull request that made the change.
