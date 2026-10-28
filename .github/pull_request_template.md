## What and why

<!-- What does this change, and why is it needed? Link the issue: Fixes #… -->

## How it was checked

<!-- Tests run, models tried, screenshots of visible changes (before / after). -->

## Checklist

- [ ] `python tests/run_all.py --no-matlab` passes
- [ ] Changed generated output on purpose? Snapshots updated (`python tests/test_snapshots.py --update`) and the diff reviewed
- [ ] New behaviour has a test (`tests/ui_checks.js`, `tests/export_projects.js` or `tests/test_exports.py`)
- [ ] Docs updated (user guide, design notes or architecture) and a line added to `CHANGELOG.md` under *Unreleased*
- [ ] Saved projects still open (new fields have a default in `normalizeProject` / `normalizeEquation`)
