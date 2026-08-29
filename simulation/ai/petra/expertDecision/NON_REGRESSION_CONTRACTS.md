# Expert AI non-regression contracts — IT14

These are hard contracts for future Expert updates. Do not remove or weaken them unless a replay demonstrates that the contract itself is wrong.

1. No persistent idle economy workers
   - `food-wait` is not a legal steady state.
   - If natural food has another productive cluster, switch/commit there instead of waiting.
   - If natural food is exhausted, use a completed field; if preferred 3-worker field capacity is temporarily full, an unused legal engine field slot is better than idling.
   - If permanent food capacity is still under construction, an otherwise-idle food civilian helps finish the pending field/farmstead.
   - New civilians must not be assigned to food once the mathematically required food workforce for the active production burn is already covered.

2. Natural food before new farming
   - All worthwhile fruit/berry clusters inside owned territory are part of one food network.
   - New food civilians exploit available natural food before taking a permanent farm lock.
   - There is NO "two fields before next fruit patch" gate.
   - Fields are prebuilt just-in-time from natural-food runway / production burn, not from one primary patch percentage.

3. Persistent food sites / no A-B-A churn
   - A civilian commits to a food cluster and stays there while that cluster has capacity.
   - Saturation is handled inside the same cluster first.
   - Hysteresis may prevent churn, but may NEVER create an idle worker when another food cluster has capacity.
   - A worker cannot immediately switch back to the site it just abandoned while its current site still contains food.
   - Food workers never use the old generic same-resource fallback that caused the IT12 1924 <-> 1825 loop.

4. Measured food throughput
   - Planner food income uses cumulative delivered-food statistics when available.
   - If cumulative statistics are unavailable, only workers with an actual live GATHER.GATHERING order count toward active income.
   - A worker merely labelled "food" while walking/building/idle contributes zero theoretical gather income.
   - Pending fields count as already-paid near-term capacity so the planner does not queue several more fields to solve the same deficit.

5. New-worker-only resource balancing
   - Existing farmers, woodcutters and miners stay on their assigned resource/site unless their supply is exhausted, inaccessible, unsafe, or the army is deliberately mobilized.
   - CC trains civilians to 75 when housing allows.
   - After the opening 20 civilian woodcutters, NEW civilians go where the production math says they are needed.
   - Once food burn is covered and wood is functional, NEW civilians begin stone/metal instead of becoming surplus farmers.

6. Sticky construction crews
   - Once a worker begins a foundation, that worker finishes it unless the foundation disappears or the worker becomes unavailable.
   - Existing crews consume the global builder budget before new builders are assigned.
   - Routine projects may not repeatedly steal/release the same gatherers.
   - Field builder -> completed field -> permanent farmer remains a hard invariant.

7. Field/farmstead geometry
   - Fields must remain within the established <=2 m farmstead-border rule.
   - Fill measured legal field slots before adding another permanent farm hub.
   - Permanent farm hubs normally require at least 4 legal touching field slots; they may relax to 3 only after repeated placement failure.
   - A natural-food farmstead must also be useful later: placement scoring includes future touching-field capacity.

8. Military/economy pacing preserved
   - CC trains civilians continuously to 75 when housing allows.
   - Barracks #1 is not gated by an arbitrary field count; reserve ~2:15, target ~2:30, hard ~3:00.
   - Barracks #2 requires at least 5 COMPLETE fields, then uses measured/pending food income + bank-runway math. It must NOT demand 11-12 fields before construction.
   - Target barracks #2 around 5-6 minutes when the bank can bridge the short-term two-barracks deficit.
   - Citizen soldiers work wood while massing.
   - City states remain melee/Hoplite-heavy after the opening fast-ranged batch.
   - No stable in this opening layer.

9. Preserve already-working opening contracts
   - Starting civilians: 4 food.
   - First 3 trained civilians: wood.
   - Next 3 trained civilians: food.
   - Continue to 20 civilian woodcutters; citizen soldiers do not count toward that 20 and work wood.
   - Opening cavalry completes chickens before hunt/scout transition.
   - Wicker-before-first-house city-state rule remains.
   - No automatic Petra handoff.

Replay regressions locked by IT14:
- IT12: natural-food A<->B target oscillation and theoretical food income while workers were walking.
- IT13 interestinglog(20260826-225332).html: `food-wait` produced up to 19 idle workers, new civilians continued joining an already-overfull food workforce, 11-12 required fields blocked barracks #2, and 4 farmsteads were built for only 5 completed fields.

- IT14.7: opening farmstead is berry-first and must prioritize nearest-bush travel; P2 uses hasResearchers rather than findAvailableTech; field backlog may start up to three fields concurrently; woodline rollover stages established-worker migration.
- IT14.8: Expert gather/trade multiplier is 1.40 (Very Hard remains 1.56); significant incoming armies mobilize combat units away from worker control, deposit carried resources, retreat to the base rally, assemble before counterattacking, and may request a capped emergency tower only when materially outmatched.
- IT14.9: keep Expert at 1.40; established farmers may start/maintain fields and farm hubs; generic mining is locked until six completed fields, then metal outranks stone; permanent field demand has 6/8/10/12 population floors; normal houses/barracks/farm hubs preserve an open CC core; barracks follow the dominant eligible wood-builder work district; wood rollover deepens the current forest with additional storehouses before abandoning a still-rich patch. Territory-bridging placement is intentionally deferred.

- IT14.10: retain IT14.9 farming/mining/resource-weight fixes but replace its wood/barracks regressions. Barracks queued without a foundation must retry rather than block the entire match; barracks placement remains work-district-oriented with a same-side fallback. Additional storehouses on one forest require a connected forest, sufficient active workers, sufficient remaining wood, and a real drop-distance improvement. A wood worker only preserves a live tree if that tree belongs to the worker's committed worksite; staged migration must never "migrate" back into the same primary worksite.

## IT14.11 opening/storehouse correction
- Athens/Thebes: Wicker may come first when multiple worthwhile fruit patches exist; after the opening storehouse is secured, Iron Axe completes before the first house and first field unless population is at emergency headroom.
- Later wood-storehouse placement must not call the opening-only candidate routine with an untagged ranked summary; no repeated `initialStorehousePlacementCandidates requires a selected initial woodsite` exceptions.


## IT14.12 P1 freeze + first Town-phase layer

- P1 strategic timings/field/mining/defense rules remain unchanged from IT14.11.
- Natural-food workers keep valid current supplies, but new assignments fill the least-loaded bush/supply first (one-per-bush before doubling where possible).
- P2 housing no longer depends on extending the original P1 house line; it searches outward from developed district edges and wider legal rings while preserving the CC core.
- A third barracks is P2-only and capacity-driven: >=110 pop, >=10 completed fields, and healthy food/wood banks.
- P2 surplus research prefers affordable soldier combat upgrades before generic surplus eco upgrades; opening Wicker/Axe/Plows behavior is unchanged.
- Deliberate territory bridging remains opportunistic through outward P2 housing; no separate territory-expansion strategy is introduced yet.
