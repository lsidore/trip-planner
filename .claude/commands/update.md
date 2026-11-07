---
description: Get the latest version of the tool from the public repository, keep the local changes, run the tests
---

Trips are never touched: git ignores `trips/`.

1. Remote: `git remote get-url upstream`, else `git remote add upstream https://github.com/lsidore/trip-planner.git`.
2. Keep local changes: `git status`; when code or docs changed, commit them on the current branch with a clear
   message. `trips/`, `.env` and `.setup/` are ignored by git and stay as they are.
3. `git pull upstream main` (when git asks how to reconcile divergent branches: `git pull --no-rebase upstream main`).
4. Conflicts: resolve each one keeping both intents (the local improvement and the new version); when unsure, show
   both versions and ask. Never drop the person's changes silently; `git merge --abort` goes back to the state before.
5. Tests: `python3 -m unittest discover tests` and `node --test tests/js/*.test.js`; fix what the merge broke.
6. When `setup/services.json` or `.mcp.json` changed: `python3 -I scripts/setup.py status` and offer the new services.
   Rebuild the active trip's page: `python3 scripts/build.py`.
7. Summarize what is new in plain words (`git log --oneline ORIG_HEAD..HEAD`). $ARGUMENTS
