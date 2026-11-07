---
description: Weather and sea for each stage - climate at the dates when far away, forecasts when close
---

For each stage of the active trip (`trips/<slug>/trip.json`), depending on how far away it is:
- **more than 16 days** (beyond Open-Meteo's forecast range): the climate at those dates (day and night
  temperatures, rain, sea, daylight) from MCP `open-meteo` (`weather_archive` for the same dates of past years,
  climate tools) and official climate pages, with sources;
- **16 days or less**: day-by-day forecasts (MCP `open-meteo` `weather_forecast`, `marine_weather` for sea outings,
  AccuWeather connector) and the warnings of the national weather service.
Then propose adjustments (swap days, switch to plan B, what to pack). $ARGUMENTS
