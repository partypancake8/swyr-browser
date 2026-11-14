# Bugs

One row per bug. Source is where it was found: owner (reported by hand), sweep (`npm run sweep`), sitecheck
(`npm run sitecheck`) or reliability (`npm run reliability`). Screenshots go in `bugs/media/`, which is never
committed.

| id | date | source | surface | description | status | fixing commit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-14 | owner | sidebar tab list | Tab titles clip their descenders: the bottoms of g, j, p, q and y are cut off (seen on "google docs - Google Search", selected and unselected rows). Cause: the truncated title span had a 13px line-height (`leading-none`) inside overflow hidden. Screenshot: bugs/media/bug-001.png | fixed-unverified | c3fb596 |
| 2 | 2026-11-14 | sweep | sidebar folders | Folder and Live Folder names clip their descenders, same cause as bug 1 (`leading-none` on the truncated name). | fixed-unverified | c3fb596 |
| 3 | 2026-11-14 | owner | settings, app menu | A locally installed build (electron-builder --dir, no app-update.yml) reported the missing update config as an error in Settings and in Check for Updates. It now stays quiet and says updates are installed locally. | fixed-unverified | a64b6d0 |
| 4 | 2026-11-14 | reliability | sidebar tab list | Tabs opened in a quick burst lose their page title when the warm cache unloads them before their first page finishes loading; the row shows the raw URL until the tab is visited again. A fix that keeps loading tabs warm a little longer conflicts with the hard 8-view cap the test suite checks, so it waits for a decision on that trade-off. | open | |
| 5 | 2026-11-14 | sitecheck | youtube | Under the automated harness a YouTube video plays for about 45 s, then the player shows "Something went wrong. Refresh or try again later." Same with the ad blocker off. Not yet known whether the cause is the harness (the page sees navigator.webdriver = true) or the browser's Chrome identity; needs a check in the real app. | open | |
| 6 | 2026-11-14 | sitecheck | google search | Under the automated harness Google answers a search with its "unusual traffic" page (navigator.webdriver is true while the harness drives the app). The row cannot pass headless without hiding the automation from the site, which the harness does not do; needs a check in the real app. | open | |
