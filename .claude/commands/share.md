---
description: Share the built trip page with someone, safely - a zip of the page folder, or a private page on claude.ai
---

The page of the active trip is the folder `trips/<slug>/site/` (`index.html` and `media/`). It shows the travelers'
names, dates, budget and picks: it goes only to people the person chooses. It never contains a key.

1. Build it fresh: `python3 scripts/build.py` (add `--photos` if the photos are not downloaded yet).
2. Check it before it leaves:
   `python3 scripts/privacy_check.py trips/<slug>/site/index.html trips/<slug>/site/media/*.json` must find nothing
   (no key, no email address, no home folder path); otherwise fix the research data and rebuild.
3. Offer two ways:
   - **A zip**: `cd trips/<slug> && zip -r ../<slug>-page.zip site` gives `trips/<slug>-page.zip`. A browser will not
     load the page's data from a file opened directly, so the recipient serves the folder: unzip, then
     `cd site && python3 -m http.server 8000 --bind 127.0.0.1` and open http://127.0.0.1:8000/. Their picks stay in
     their own browser.
   - **A private page on claude.ai**, when the Artifact tool is available in this session: publish
     `trips/<slug>/site/index.html` with the `media/` files (JSON and photos) as supporting files, in several publishes
     to the same artifact when there are many photos. It starts private; the person decides who gets the link.
4. Never send the zip or the link to anyone yourself: give the person the file path or the link. $ARGUMENTS
