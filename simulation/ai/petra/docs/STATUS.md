# Expert checkpoint: 15.8.25 candidate

Base: uploaded petra(1).zip; its shared code equals petra.zip, and its released
15.8.23 controller/planner matched the previous patch byte for byte.

Only game file changed in .25: expertDecisionController.js.
The opening planner, placement, training, combat and tower investment are unchanged.
Tests live inside petra/tests; run from any directory with Node:

    node /path/to/petra/tests/worker-safety.test.cjs
    node /path/to/petra/tests/food-handoff.test.cjs
    node /path/to/petra/tests/house-placement.test.cjs
    node /path/to/petra/tests/service-tech.test.cjs

Implemented: final controller gather gate rejects targets outside owned territory
and infantry citizen-soldier food. Neutral wood rescue is disabled. Existing
illegal gather orders are stopped during worker updates. Soldier food handoff
tries owned wood/metal/stone instead. Civilians retain farming; cavalry retain
owned-territory hunting. No safe reachable work can still mean idle workers;
expansion/barter behavior is not rewritten in this patch.

Verification: mocked controller-method regression tests and syntax checks only.
NOT verified in game. Do not call this stable until replay testing passes.

15.8.24.1 additionally checks whether resourceSupplyType() returns a value
before reading .generic. The regression test executes the live worker cleanup
block with an undefined supply type, matching the 15.8.24 replay failure.

Next: compare opening minutes 1–5 with .23, then longer-game worker safety.
15.8.25: when active woodcutters lack a short carry, storehouse placement also
tries positions around their actual worksite. Normal legality checks remain.
P2 tech push and P3 boom evaluate Village economic tech at 4:00 rather than
5:30 while still retaining phase cost reservation. Other doctrines unchanged.
The 25–35 m carry target remains a target, not a guarantee when wood or legal
construction positions are unavailable. In-game placement and phase timing
must be verified with replays.
Known outstanding: surplus-wood tower investment, competing endgame orders,
military upgrade timing, resource exhaustion and expansion efficiency.
Past change reports describe historical intentions, not proof of current behavior.
