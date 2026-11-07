---
description: Guided setup - checks the prerequisites and the free services, then offers the optional services and connectors one by one
---

Run the guided setup described in CLAUDE.md > First launch, from step 1, one step at a time, in the person's language,
with the `start` skill's setup screen for the three questions (keys, connectors, Chrome).
It is safe to run again: prerequisites and servers are re-checked, keys already in `.env` are kept (offer to replace one
only if the person asks), and `python3 -I scripts/setup.py done` refreshes `.setup/state.json` at the end.

Never print, echo or read back a key. $ARGUMENTS
