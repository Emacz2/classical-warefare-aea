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

## IT14.13 P1 food polish + Town infrastructure + civilian evacuation
- P1 strategy remains frozen except: after Wicker, primary-fruit civilians above one per live bush deposit first and become wood workers.
- Natural-expansion farmsteads are food dropsites first and hug the selected in-territory fruit/tree cluster; permanent farm hubs remain a separate role.
- Fields target near-zero farmstead border gap, with a small failure-only relaxation to avoid deadlock.
- Town phase adds one market after two barracks with a healthy wood reserve; no P1 market is introduced.
- Third Town barracks keeps worksite-centered placement but gains a wide owned-territory fallback.
- Civilians within local combat danger deposit carried resources, then seek safe work away from the threat or garrison in a house/CC; they resume their permanent job after danger passes.
- Military defense assembly behavior and +40% Expert gather rate remain unchanged.


## IT14.14 natural-food branch ownership
- Post-Wicker excess berry civilians establish a worthwhile uncovered in-territory natural-food branch before falling back to wood.
- The same branch civilians build the new farmstead deposit-first and remain committed to that natural-food cluster after completion.
- A live individual berry/fruit target is sticky. Occupancy changes elsewhere may not retarget a worker that is already gathering or approaching a live supply.
- Natural-food branch locks survive ordinary food balancing and release only when the locked cluster is genuinely exhausted.


## IT14.15 P1 housing + territory-natural-food contract

- Preserve the organized P1 house line as the first placement choice. If it is blocked, use real broad ring candidates around the outer developed/wood district; a blocked line must never hard-cap production.
- Track the combined amount of natural food first observed inside owned territory. Permanent fields may not begin while worthwhile uncovered natural-food clusters remain or while the combined in-territory natural-food pool is above 30% of its discovered amount.
- Cover worthwhile in-territory natural-food clusters sequentially with farmsteads before permanent farming. Existing Wicker branch ownership/sticky berry assignments remain unchanged.


## IT14.17 rollback-safe opening corrections

- Code lineage is IT14.15, not IT14.16.
- Athens/Thebes secondary natural-food farmstead is blocked until Wicker Baskets is fully researched.
- The natural-food preferred ceiling is eight civilians per connected patch, but this ceiling may never determine whether the opening berries are valid food.
- Natural-food assignments must remain inside owned territory; a sticky target that ceases to be owned is invalidated.
- Completed non-opening storehouse builders remain committed to the new storehouse worksite, and the completed storehouse remains the primary worksite for new wood workers.
- The territory-wide natural-food ratio must pass through the Petra adapter into planner state.
- Natural-food-first may be overridden when population >=45 and wood >=800, or when the natural-food network is at the eight-worker cap with <=2 immediate food slots.

## IT14.18 civilian-food ownership + field-throughput contract

- Permanent ordinary-civilian wood ownership is capped at 20 in P1. Citizen-soldiers remain the primary post-opening wood workforce.
- Every ordinary civilian after that opening tranche is food-owned until the six-field mining gate permits metal/stone assignments.
- If no natural/field slot is open, a food-owned civilian may chop wood temporarily without changing its permanent job; the next food slot must reclaim it automatically.
- The natural-food eight-worker ceiling must never turn overflow civilians into permanent lumberjacks.
- Field-capacity measurement and actual placement must use the same border-gap limit. Failure relaxation to ~1.3m must propagate into the real placement request.
- Concurrent field starts fan across completed farmsteads so one obstructed hub cannot block capacity_1/2/3 in the same frame.



## IT14.20 replay-combination contract
- Preserve IT14.14's high-throughput opening and Wicker/secondary-food behavior.
- Preserve IT14.15+ P1 housing fallback so the opening cannot die on a blocked house line.
- Preserve IT14.18 food-owned overflow, 20-civilian opening wood tranche, field fan-out, and defensive behavior.
- Do not add a permanent farm hub while field foundations are already filling current hubs; once those finish, add a hub immediately if measured touching capacity is still exhausted.
- After 8+ completed fields and a strong food surplus, NEW civilians may reinforce wood; established farmers are not stripped from food.
- Preserve a still-rich committed wood front and retain the primary storehouse entity id so staged migration cannot bounce the lumber crew unnecessarily.


## IT14.21 compact-farm contract
- A new farmstead has exactly two valid strategic reasons: (A) cover a worthwhile uncovered natural-food source inside owned territory, or (B) expand permanent farming after an existing farmstead has at least 3 completed adjacent fields and no legal touching field slot remains.
- Field demand, overflow civilians, or a large wood bank alone may never authorize another permanent farmstead.
- Concurrent field starts fill one compact farmstead block first; they no longer deliberately fan one field across each farmstead.
- Permanent farm-hub placement keeps the full minimum field-capacity requirement; repeated placement failures must not relax into one-field/two-field farmstead spam.

## IT14.22 natural-food-to-field handoff
- Preserve the IT14.21 farmstead contract: natural-food dropsites or a genuinely saturated 3+ field farm hub are the only reasons to add another farmstead.
- When the post-Wicker secondary natural-food branch is exhausted and no field exists, force field #1 immediately; do not merge those workers back onto already-occupied berry bushes.
- Before Wicker, preserve the proven opening occupancy. After Wicker, multi-supply berry/fruit patches prefer one civilian per individual live supply; single-source fruit branches may still use multiple workers up to the connected-patch ceiling.
- Immediate food-capacity accounting must use the same post-Wicker per-supply preference so food-owned civilians do not accumulate against imaginary berry capacity.
- Field-capacity probing must not deadlock at the strict 0.8m border gap. Probe 1.3m and then the existing <=2m hard geometry contract before declaring an existing farmstead unable to accept a field.
- Storehouse construction prefers ranged/javelin citizen-soldiers over hoplites when both are otherwise eligible, because gather/build rates are equal and the faster unit loses slightly less time to walking/deposit/return.

## IT14.23 farm-district layout protection
- Preserve IT14.22 food timing, Wicker handoff, worker ownership, storehouse-builder preference, and the IT14.21 farmstead authorization contract.
- The legal touching-field ring around every completed or under-construction farmstead is reserved for fields before independent buildings are placed.
- Houses, barracks, and markets may not occupy a currently legal reserved field footprint or sit directly against a farmstead.
- Independent buildings strongly prefer positions outside the farm district (about 38m from farmstead centers) while retaining their existing candidate order once outside that district.
- House and market fallback generation no longer treats farmsteads as generic development anchors; food hubs are not seeds for housing/military sprawl.
- Resource-driven dropsites and emergency towers remain exempt so wood access and emergency defense are not sacrificed to layout aesthetics.

## IT14.24 adaptive P1 food/wood + persistent farm districts
- Preserve the IT14.14/15 high-throughput opening, Wicker-before-secondary-farmstead sequence, IT14.21 farmstead authorization rule, IT14.22 natural-to-field handoff, and IT14.23 independent-building farm-ring protection.
- Twenty ordinary civilian woodcutters is an opening target, not a permanent law. After ~3 minutes a live feedback governor uses food/wood banks, delivered food income versus current food burn, immediate food capacity, field construction, and food-owned overflow to decide whether the economy is balanced, needs food recovery, or can release NEW civilians to wood.
- During real food recovery, move at most a small cooldown-controlled batch of ordinary civilian lumberjacks back to food and never below the protected minimum civilian wood core. The opening ordinal script may not undo an adaptive food correction on the next tick.
- A food-owned worker with no usable food capacity remains food-owned while temporarily chopping wood. Temporary overflow is a symptom that should accelerate permanent food capacity, not silently inflate the permanent civilian wood workforce.
- Once >=7 fields are established and the food bank plus delivered food rate demonstrate genuine surplus, only NEW civilians may grow the permanent wood workforce above the opening target. Established farmers are not stripped from food to repair wood.
- Every civilian working a natural-food cluster remembers the nearby farmstead as its home food district. A dedicated natural-food branch becomes a permanent local farm district when its source is exhausted: those workers take/build nearby fields before considering distant food.
- Locality is strong but not absolute: after a home district has at least 3 completed local fields and no legal local field slot remains, its workers may be released to another food district.
- Reuse exhausted natural-food farmsteads for permanent farming before buying another hub. Existing dropsites may use a modest <=4m field-border gap when the preferred near-touching ring is obstructed; dedicated new farm hubs retain the stricter capacity requirement.
- Houses, barracks, and markets reserve the future farm district even while berries/fruit still occupy it. Their hard farmstead clearance remains conservative enough not to reintroduce the housing deadlock; outside that protected core, existing placement ordering is preserved.


## IT14.25 second-storehouse handoff + storehouse builder micro
- Built directly from IT14.24; do not alter the IT14.24 adaptive food/wood controller in this patch.
- As soon as the *second* storehouse has a live foundation, its position is the primary wood destination for NEW wood workers. Existing lumberjacks keep their explicit old WORKSITE_ID.
- Newly-created civilians that are still part of the opening wood tranche help finish storehouse #2 if its foundation is live; on completion that crew is committed to the new woodsite.
- Storehouse construction prefers melee/hoplite citizen-soldiers over javelin/ranged citizen-soldiers when both are reasonable candidates, leaving the faster ranged units on the repeated wood walking loop.
- `farmCapacitySnapshot()` must create its own merged policy before referencing farm-reuse settings; the IT14.24 `policy is not defined` runtime spam is forbidden.


## IT14.26 FARM NON-REGRESSION LOCK
- IT14.25 proved the farm planner can deadlock when four permanent fields are split across two existing food districts (for example 2+2): both farmsteads report zero legal field slots, but neither single hub reaches the old 3-field saturation threshold.
- This is now a forbidden state. If permanent food still needs more fields, there are no pending field builds, all measured field slots are exhausted, and the existing farm network already contains at least four permanent fields across two or more farmsteads, a new permanent farm hub is authorized.
- The preferred rule remains unchanged: use current farmsteads first, and normally require a saturated hub with at least 3 fields before another farm hub. The network fallback exists only to escape a genuine all-hubs-full deadlock.
- Do not change the natural-food -> field timing, field demand, field placement geometry, worker ownership, food/wood feedback governor, or house/barracks farm-ring protection in a patch whose purpose is unrelated to farming.
- Farm regression invariant: when desired permanent fields exceed completed+pending fields and measured open field capacity is zero, the planner must either have an active field/farmstead capacity build or explicitly reserve the resources for one. It may never silently sit at 4 fields while wantFld continues climbing.


## IT14.27 CANONICAL FARM PACKING LOCK
- A completed farmstead's permanent-field capacity contract is four compact side slots, not six speculative perimeter slots.
- Field placement tests the canonical N/E/S/W side-centres first at near-zero border gap. Only when a canonical side is obstructed may it search small tangential offsets along that same side, followed by the established modest border-gap fallback.
- The field candidate generator must never begin at farmstead corners. Corner-first placement is forbidden because one awkward first field can consume the geometry of two later side slots and falsely report the hub as full.
- Houses, barracks and markets reserve the same four canonical future field footprints even while temporary berries/fruit still occupy them.
- Capacity accounting assigns each completed field to its nearest farmstead; one field may not make two nearby farmsteads both appear saturated.
- `fieldsPerFarmstead` is 4. The normal target is 3-4 compact fields around the existing farmstead before a new permanent farm hub.
- The IT14.26 all-hubs-full escape remains only as a true deadlock fallback after the canonical four-side scanner has been exhausted.
