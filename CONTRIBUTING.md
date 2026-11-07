# Contributing

Thank you for helping. The planner is useful when it stays generic: any destination, any travelers.

## If you use the planner and improved something

Type `/contribute` in Claude Code. It runs the tests, builds a clean branch from the public repository, runs the privacy
check, shows you exactly what would be sent, and sends it only after your explicit yes. It needs a free GitHub account and
the `gh` tool (<https://cli.github.com>). Only code and documentation travel, never your trips or your keys.

## If you work on the code

Requirements: Python 3.9 or newer (the `python3` of a stock Mac works), Node 18 or newer, `uv`, Pillow
(`python3 -m pip install --user Pillow`; only the photo scripts need it). Nothing else. The code must keep running on
Python 3.9: no `match`, no `X | Y` annotations evaluated at run time, no `zip(strict=...)`; run the tests with the
oldest Python you have too.

Run the tests, both must pass:

```
python3 -m unittest discover tests
node --test tests/js/*.test.js
```

Run the privacy check on your changes. It looks for e-mail addresses, home-folder paths, key-like values and, with a
blocklist, any words you do not want in the repository (one per line, never committed):

```
python3 scripts/privacy_check.py
python3 scripts/privacy_check.py --blocklist my-words.txt
python3 scripts/privacy_check.py --history      # also scans every commit
```

Exit status 0 means nothing was found.

### Branch and pull request flow

1. Fork the repository and create a branch from `main` (`git switch -c fix-short-name`).
2. Write the test first, watch it fail, then write the code.
3. Run the two test suites and the privacy check.
4. Commit with a message that says what changed and why. No personal details: no names, places, dates or prices of a
   real trip (use the invented example in `examples/sample-trip/`).
5. Open a pull request against `main` and describe what you tested.

### Rules

- **English only** in code, comments, documentation, commit messages and the texts people read. The page also ships a
  French translation (`page/i18n/fr.js`, `scripts/i18n.py`); to add a language see [docs/architecture.md](docs/architecture.md).
- Internal names (JSON keys, research file names) are French for historical reasons. Keep them; the glossary in
  [docs/architecture.md](docs/architecture.md) explains them. New names are English.
- Amounts are in the traveler's home currency (`_home` suffix).
- Python standard library plus Pillow, plain JavaScript without a build step. No new dependency without a strong reason.
- No absolute paths, no keys, no photos of places or hotels in the repository.
- Never add a tool that books or pays by itself.
- Test data is invented and carries `"_example": true`.
