# 15.8.25 candidate

## 15.8.25

- Active wood districts can search for new storehouse sites around the actual
  cutters, as well as forest center and currently targeted trees.
- Districts with a carry beyond 35 m cannot be suppressed by healthy-primary
  drift protection; ordinary wood reserve and legal placement still apply.
- P2 tech push/P3 boom begin Village eco-tech sweep at 4:00 rather than 5:30.
  Existing phase reservation, Iron Axe and available-tech checks still apply.
- Added focused search/tech tests. In-game comparison pending.

## Previous

## 15.8.24.1 crash correction

- Guard the result of resourceSupplyType() in the live-worker cleanup path.
- The final gather gate rejects unknown resource types safely.
- Added a regression test for the exact undefined-type replay crash.
- No Wicker, natural-food assignment, tower or combat changes.

## 15.8.24

- Central controller gather-order gate checks territory and infantry food roles.
- Disabled neutral wood rescue override.
- Reject soldier farm assignment; redirect soldier food jobs to wood/metal/stone.
- Worker updates inspect live gather targets, stop prohibited gathering and clear locks.
- Fixed test paths so existing tests run from inside petra/tests.
- Added worker-safety regression tests and concise checkpoint documentation.

No tower/combat/opening changes. Historical reports remain in changes/ and tests/.
Game-engine verification pending.
