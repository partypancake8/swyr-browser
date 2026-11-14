# Behaviour bugs

Found by `npm run behaviour` (qa/behaviour.mjs). Check names match `qa/out/behaviour-results.json` exactly.

| id | date | check name | description | status | fixing commit |
| --- | --- | --- | --- | --- | --- |
| B-001 | 2026-11-14 | reopen closed tab: the tab returns to its place in the list | Cmd+W on a middle Today tab and then Cmd+Shift+T put the tab back at the end of Today instead of where it was. `archive.restore` always used the next free order. | fixed-unverified | d211327 |
| B-002 | 2026-11-14 | Cmd+click on a link opens it in a background tab | Cmd+click asked for a background tab (disposition `background-tab`), but the new tab came to the front. The extensions library marks every tab it starts tracking as active and calls the host's `selectTab`, which activated the new tab. | fixed-unverified | 5879c2d |
| B-003 | 2026-11-14 | close tab: the close button on a sidebar row closes that tab | Failed once right after the check scrolled the Today list: the overlay scrollbar shown during a scroll sits over the row's Archive button until it fades, so the click landed on the scrollbar. Not a product bug; the check now waits for the scrollbar to fade. | wontfix | 3cb3b15 |
