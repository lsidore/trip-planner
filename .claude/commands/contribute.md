---
description: Propose a generic improvement of the tool to the public repository (lsidore/trip-planner) as a pull request, after tests, privacy checks and an explicit yes
argument-hint: "[the improvement to propose]"
---

Improvement to propose: $ARGUMENTS (empty: the code changes made here that the public repository does not have).

Only generic changes travel (useful to every trip); trip data and keys never do. Local commit messages may name the
trip, so the public branch is made of **fresh commits** whose messages you write for the public. Stop and say why at
any failing step.

1. **GitHub**: `gh --version` and `gh auth status`. Without `gh` or a login: a contribution needs a free GitHub account
   and the `gh` tool (https://cli.github.com); `gh auth login` is typed by the person in their own terminal. Otherwise
   skip. Never ask for a password or a token.
2. **What would be sent**: commit the local code changes first on their branch (CLAUDE.md > Improving the tool). Then
   `git remote get-url upstream || git remote add upstream https://github.com/lsidore/trip-planner.git`,
   `git fetch upstream` and `git diff --stat upstream/main...HEAD`. Keep only generic code and docs (`scripts/`,
   `page/`, `tests/`, `docs/`, `data/`, `setup/`, `.claude/`, `CLAUDE.md`, `README.md`); never `trips/`, `.env`,
   `.setup/`, state files, nor a change that only makes sense for this trip.
3. **Tests**: `python3 -m unittest discover tests` and `node --test tests/js/*.test.js` pass.
4. **Author identity** (it is published with every commit): show `git config user.name` and `git config user.email`
   and say that both become public. Suggest GitHub's private address instead of a personal e-mail:
   `<id>+<login>@users.noreply.github.com` (`gh api user --jq '.id, .login'`). Change it only on their yes, for this
   folder only: `git config user.email "<id>+<login>@users.noreply.github.com"` (and `git config user.name "<name>"`
   if they want another name). Never change it on your own.
5. **Build the public branch locally** (nothing leaves the computer yet):
   `git switch -c contrib/<short-name> upstream/main`, then `git checkout <their branch> -- <files>` for the generic
   files only; a file deleted on their branch is not carried by `checkout`: remove it with `git rm <file>`. Then one or
   a few new commits whose messages you write for the public (what changed and why, no trip name, place, date, price
   or person).
6. **Privacy**, on that branch: write the trip's personal words (travelers' names, home cities, the trip's places
   and hotel names, the slug), one per line, to `trips/.contrib-blocklist.txt` (git ignores it), then both must find
   nothing:
   - the files: `python3 scripts/privacy_check.py --blocklist trips/.contrib-blocklist.txt <every file sent>`;
   - the messages: `git log --format=%B upstream/main..HEAD | python3 scripts/privacy_check.py --blocklist trips/.contrib-blocklist.txt -`.
   Also read the diff (`git diff upstream/main..HEAD`) yourself for personal details (dates, prices, names in comments
   or test data).
7. **Show the person** the files, a plain-words summary, the commit messages and their author
   (`git log --format='%an <%ae>' upstream/main..HEAD | sort -u`), the pull request title and description, and ask:
   "Send this to the public repository? (yes/no)". Without a clear yes: `git switch <their branch>` and
   `git branch -D contrib/<short-name>`, and stop.
8. **On yes**:
   - `gh repo fork lsidore/trip-planner --clone=false` (when the person owns lsidore/trip-planner, push to it
     directly instead), `git remote add fork https://github.com/<login>/trip-planner.git` if missing (login:
     `gh api user --jq .login`), `gh auth setup-git`;
   - `git push fork contrib/<short-name>`, then
     `gh pr create --repo lsidore/trip-planner --head <login>:contrib/<short-name> --title "..." --body "..."`;
   - `git switch <their branch>`, and give them the pull request link.
