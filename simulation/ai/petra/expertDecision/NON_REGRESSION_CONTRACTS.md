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
   - CC trains civilians to 70 when housing allows.
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
   - CC trains civilians continuously to 70 when housing allows.
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


## IT14.28 replay-regression lock
- Opening storehouse builder selection is type-priority, not a soft distance preference: melee/Hoplite citizen-soldiers outrank ranged/Javelineer citizen-soldiers for storehouse construction whenever both are legal.
- A NATURAL_FOOD_LOCK is released only after the actual locked supply entities report zero remaining food. A temporary cluster-network omission may never force live second-berry workers onto fields.
- Barracks #2 hard deadline is a true deadline: after the deadline and with the minimum field pipeline, measured food capacity may not veto construction.
- Village phase has an 8:00 absolute reservation failsafe once two barracks, >=4 field pipeline and >=80 population exist. It may reserve resources before the full phase cost is banked.
- Houses, barracks, markets and towers are independent structures and must be >=50 m from the primary CC. Storehouses and farmsteads remain resource-driven exceptions.


## IT14.29 additive Town-economy layer
- Built directly on IT14.28. The IT14.28 P2 failsafe, live-supply berry lock, opening storehouse type-priority, true barracks #2 deadline, and >=50 m CC exclusion for independent buildings are frozen and may not regress.
- A permanent farm hub still prefers four compact legal touching-field slots. After at least 6 failed live farm-hub placement attempts, the hard requirement may relax to exactly 3 slots; one-field/two-field farmstead spam remains forbidden.
- When permanent farming is materially behind and either Town Phase is reached or wood is already >=1000, up to 5 field foundations may be active concurrently instead of 3. This changes throughput only; desired-field math and field geometry remain unchanged.
- Forges are a surplus-wood sink after farm reservations, never a replacement for permanent food. One forge may be requested late P1 only under an extreme wood surplus; Town Phase may scale progressively to at most 3 forges as population and wood bank grow.
- Forges inherit the IT14.28 independent-building layout rule: >=50 m from the primary CC and outside reserved farm districts.
- The Town market remains one market, but placement is resource-aware: owned same-land stone/metal deposits and the active wood district are preferred before the existing outer-developed-settlement fallback. The >=50 m CC and farm-district protections remain mandatory.
- Athens Town-phase barracks production follows a deterministic 2 Hoplite : 1 Athenian Marine : 1 Javelineer cycle. P1 opening military selection and CC training behavior are unchanged.


## IT14.30 additive farm-packing contract
- IT14.29 opening, berry retention, P2 gate, 50m CC exclusion, second-barracks timing, forge layer, market resource placement, and Athens P2 2:1:1 roster are frozen.
- Existing farmsteads are exhausted before buying another permanent farm hub: normal compact slots first, then the 4m reuse ring, then a bounded 10m corner/fill-in pass, still capped at 4 fields per hub.
- The wide fill-in pass may search diagonally around an obstructed side; it does not relax normal first-choice touching placement.
- In Town Phase, completed Markets are valid food hubs for field placement and reserve their immediate field faces from later independent construction.


## IT14.31 economy-balance / P2 infrastructure contract
- IT14.30 opening, berry retention, phase-up, 50m CC exclusion, farm packing, market-as-P2-food-hub, second-barracks timing, and Athens P2 2:1:1 roster remain frozen.
- Permanent fields have a hard strategic ceiling of 12. `desiredFields` may not recursively grow past 12 merely because extra civilians were already assigned to food.
- Preferred permanent field staffing remains three civilians per field. Emergency 4th/5th gatherers are temporary overflow and may not become sacred permanent farm locks.
- When mature food is strongly surplus and wood is weak, release temporary/overflow farmers toward wood in small cooldown-controlled batches; never peel the protected opening food tranche or reduce a normally staffed field below the preferred three through this path.
- Forge #1 is a P2-transition obligation once two barracks, 8 fields, ~90 population and the P2 timing corridor are present. Its actual wood cost is reserved before optional farm/storehouse expansion.
- Forge #2 becomes a Town transition obligation at ~100 population, 10 fields and a healthy food bank. Forge #3 remains an optional late surplus sink.
- Woodsite rollover is phase-capped at five storehouses in Village and seven in Town. Once the cap is reached, reuse existing worksites rather than spending scarce wood chasing every thinning patch.


## IT14.33 additive P2/P3 contracts
- IT14.32 opening, berry, farm, housing, market placement and attack-manager handoff remain frozen.
- Expert does not deliberately train new Cavalry while cavalry-control work is deferred; starting cavalry remains usable.
- Forge #1 belongs to the P2 transition; forge #2 follows in Town Phase; forge #3 is City-only.
- Barracks #3 is a Town-phase production ramp and may start once eight fields and modest food/wood banks exist.
- A second market may satisfy an unmet Town-class phase requirement, but must remain at least 55m from the first market.
- Normal Petra may research City Phase only after Expert-placed structures already satisfy all entity requirements; generic Petra construction remains blocked.


## IT14.34 additive Village-temple / City-State doctrine contracts

- IT14.33's working attack-manager handoff, cavalry-production freeze, two-forge P2 plan, third P2 barracks, market placement, farm limits, civilian cap, phase watchdog, and 50m independent-building core are frozen.
- One worker-efficiency temple is now eligible in Village phase after barracks #2, with a modest permanent-food pipeline and a protected wood reserve. If missed, the Town-phase temple fallback remains.
- Temple placement ranks existing market/farmstead/storehouse districts by current Worker coverage inside the 75m aura before generating candidates.
- Forge #1 remains transition infrastructure. Forge #2 remains immediate Town infrastructure; its food-bank gate is modest so a wood-only forge is not delayed by a temporarily low food bank.
- Athens/Sparta/Thebes may research citystate/hoplite_tradition in late Village phase only when barracks #2 and the temple are secured, Town Phase is not already ready, and the current bank can pay both Hoplite Tradition and the full observed Town-phase cost plus reserves. If that safe P1 window is missed, Hoplite Tradition becomes the first dedicated City-State doctrine-tech candidate in Town phase.

- IT14.39: Expert gather/trade multiplier reduced to 1.35; attack-committed citizen-soldiers are excluded from home-economy workforce counts once they stop economic work; temporary fallback gather targets are sticky while legal/live; Town-phase food and wood gather upgrades use dedicated higher-priority queues before/alongside forge military upgrades.

- IT14.40: Expert gather/trade multiplier remains 1.35. A single opening natural-food farmstead that is genuinely saturated at two fields after its natural food is exhausted may authorize a dedicated 3+-slot permanent farm hub; home food workers are released from that constrained two-field district only when no local field foundation or legal slot remains. This is a deadlock escape, not permission to spam farmsteads.

- IT14.41: Expert gather/trade multiplier remains 1.35. Benchmarking tracks both BREAK time (first sustained enemy population <50 after 10:00) and VICTORY time. When Expert has >=80 population, a >=30-pop lead, and the enemy is <=50 population, active attacks receive streaming citizen-soldier/siege reinforcements while 12 citizen-soldiers remain home; upcoming finishing attacks may force-start at 10 units. P3 finishing mode may build one Arsenal and train up to two siege units if the civ exposes a buildable Arsenal. Temporary food-overflow wood work receives a 30-second lease unless food recovery is active. Barracks #3 retries after 8 seconds and its first placement sweep includes broad outer-territory and neutral-resource-facing candidates. Town-phase Barracks/Forge/Market/Arsenal placement may intentionally use legal edge positions toward neutral food/wood/metal/stone as territory-expansion anchors.

- IT14.42: Expert gather/trade multiplier remains 1.35. Healthy in-territory natural food is preferred over speculative permanent fields until the combined natural-food ratio reaches roughly 25%; a large wood bank or a temporarily saturated berry patch may not by itself force early farms, although a genuine short-runway/low-food emergency may. Healthy natural food may satisfy the food-infrastructure side of P1 Temple, P2 phase, Forge #1/#2, and Barracks #3 readiness so saving field wood accelerates infrastructure rather than deadlocking it. Barracks #1/#2 placement may first test legal inside-border sites facing valuable neutral food/wood so their territory influence can claim the resource, while the established timing-safe home candidates remain immediate fallbacks. P1 timing attacks remain legal while Town Phase is only researching. Once Town Phase is actually complete, ordinary/huge Expert attacks wait for two completed technologies observed from the dedicated Expert military-tech queues; finishing mode bypasses this gate. BREAK and VICTORY benchmarking remains mandatory and +35% stays frozen until the three-clean-win median threshold is met.

- IT14.43: Expert gather/trade multiplier remains 1.35. Construction labor is adaptive: Barracks #1 uses the four opening citizen-soldiers; later Barracks/Forge/Market/Temple/Arsenal may use 5-6 workers when wood is heavily banked, with workers from the richest lopsided resource preferred temporarily. Construction intent (builder pool/count/job preference) persists from placement through foundation completion. Houses may prefer the outside of established farm districts so nearby farmers can build and immediately return. Once the required food workforce is covered and the food bank is grossly ahead of wood, NEW civilians reinforce wood rather than creating unnecessary food ownership; established preferred farmers are not stripped by this marginal-worker rule. Natural-food-first is preserved but permanent fields ramp on a 2/4/6/8-field runway/depletion staircase before the last natural food disappears. After one failed strategic placement cycle, Barracks #3/Forge/Market/Temple/Arsenal add dense developed-district legal fallbacks; third barracks no longer reserves hypothetical future farm faces. Finishing armies are capped around 36-50 troops, may create a second cleanup attack even near pop cap, and use a 45-second population/target-health/capture-progress watchdog to retarget or reissue stalled attacks. BREAK/VICTORY tracking remains mandatory and +35% stays frozen.
- IT14.44: Expert gather/trade multiplier remains 1.35. A depleted P2+ attack of ~22 units or fewer withdraws from defended enemy territory if it has no siege, then observes a short reboom window before launching another normal wave. During an actual P2 push, the first two broad forge upgrades are established before deeper military spending; once those are in the pipeline, dedicated food and wood eco-tech lanes must resume before higher forge tiers. Finishing retargeting points the attack at the enemy Civic Centre immediately; melee siege prioritizes that CC except towers/fortresses actively firing on the army. Rams may carry up to five nearby expendable javelineers, or spearmen when enemy cavalry is substantial; spear passengers unload when cavalry closes on the ram. BREAK/VICTORY tracking remains mandatory and +35% stays frozen.
- IT14.45: Expert gather/trade multiplier remains 1.35. Citizen-soldiers at or below 25% health may peel from a started attack in small batches, return all the way to friendly territory, then resume normal economic work; the field army records replacement demand and recruits healthy >=75% citizen-soldiers while preserving the home reserve. The existing ~22-unit defended-push retreat/reboom remains the whole-army fallback. Active attack infantry are valid ram passengers: preferred javelineers normally, spearmen against substantial cavalry; passengers remember their original attack plan and rejoin it after unloading. Once a ram joins an attack, the enemy Civic Centre becomes the shared strategic objective, but infantry hold an outer staging/perimeter ring and avoid CC/tower/fortress fire until a ram reaches the assault radius; then the army pivots inward. A healthy P3 field army may trigger one Arsenal/ram before formal finishing mode, while finishing mode may still target two siege units. The second dedicated P2 food+wood eco pair is no longer blocked behind four military technologies; after the first two attack-package upgrades are established it may proceed before deeper forge tiers. After one failed strategic second-Market search, phase3 Town-support placement may sample legal centres directly from owned territory cells. BREAK/VICTORY tracking remains mandatory and +35% stays frozen.
- IT14.46: Expert gather/trade multiplier remains 1.35. A single replay-deterministic strategic doctrine is selected once per match and serialized: Early P1 Rush, Late P1 Timing Rush, or P2 Forge-Tech Push. Rush doctrines lower the civilian cap only temporarily and start barracks/soldier production earlier; the P2 tech doctrine retains the 70-civilian boom and runs a dedicated Village eco-tech sweep before/alongside Town research. Resource balancing begins before the prior 1,000-resource overshoot and uses hysteretic reassignment batches. Houses may not occupy the immediate storehouse worksite ring; rich heavily staffed forests may deepen with a second storehouse before depletion. Smaller natural-food branches can justify a dropsite before fields and Markets are no longer field hubs. Temples may sit near the CC when that maximizes worker aura coverage. Infantry without siege avoids diving into CC/tower/fortress strongpoints while the enemy economy is still alive. At <=8 enemy population, cleanup prioritizes visible ConquestCritical units and occupied garrison holders before arbitrary Civic Centres, and rams use the same cleanup objective. BREAK/VICTORY tracking remains mandatory and +35% stays frozen.
- IT14.47: Expert gather/trade multiplier remains 1.35. The IT14.46 doctrine selection is now executable: only Early/Late P1 Rush doctrines may run AttackManager in Village Phase, and their Rush plan has no mandatory FastMoving quota. Expert rush targeting prefers exposed Workers outside defensive-fire envelopes, then undefended production/economic structures; P2 Tech Push remains fully P2-gated. The first two P2 military upgrades and first Town food+wood eco pair remain the core package; once a real push exists, deeper military technologies may consume only true war surplus while preserving 500F/250W/150M and are capped at six observed military upgrades. Market #1 remains resource/barter-oriented; the second Town-support Market is scored for safe route distance. Generic Petra market prospection remains disabled, but two completed markets may support 2 zero-pop traders, rising to 4 on a strong route, with no generic trade-tech spending. If the enemy is <=30 population against a >=40-unit active army in Town Phase, the siege-finisher pipeline may begin only when current-phase Arsenal/siege templates are genuinely buildable/available. Strategy arming/launch/P2-follow-up telemetry is mandatory. BREAK/VICTORY tracking remains mandatory and +35% stays frozen.
- IT14.48: Expert gather/trade multiplier remains 1.35. The IT14.47 second-Market trade scoring regression is fixed: placement-port construction may never read an undefined placement `request`; Market #1 retains the established farm-district avoidance score and only a `phase3_town_support` request receives route-distance scoring. Athens' old exact 2 Hoplite : 1 Marine : 1 Javelineer production cycle is superseded by a broad ~58% melee / ~42% ranged target. Hoplites remain the majority of Athens melee and Marines are a soft subtype preference, but affordability may select another useful infantry class rather than idle a trainer. The oldest completed barracks acts as a production-floor/auto-queue analogue: after the opening batch it uses one-unit batches and tries to retain two layers of Expert soldier work (current plus one queued), while other barracks retain opportunistic larger-batch production. This production-floor change may not hand military construction/training ownership back to generic Petra, may not change other civs' melee/ranged defaults, and may not alter the IT14.47 strategy/P1-rush/P2-tech/trade/siege contracts. BREAK/VICTORY tracking remains mandatory and +35% stays frozen.

- IT14.49: Failed P1 rushes must not become reinforcement trickles. A live doctrine rush suppresses normal follow-up attack-plan creation; if own losses reach the configured attrition threshold with poor enemy-population damage and/or local defensive pressure, survivors withdraw to a friendly base, remain protected from economy reassignment until they re-enter friendly territory, and Expert enters a 105-second recovery/reboom window. Infantry without siege must remember recent CC/tower/garrison threats and avoid resuming attacks on those holders while defenders can pop out; mixed infantry keeps ranged units behind the melee centroid. A worthwhile uncovered natural-food cluster in `natural_expand` mode suppresses normal new fields except the existing critical-food emergency bridge. Rush doctrines may delay the worker-aura temple during the actual rush window, but after the timing window or an explicit failed-rush recovery the temple threshold is relaxed. IT14.48 production-floor behavior, Athens ~58/42 composition, P2 tech/trade/siege logic, placement contracts, and +35% gather/trade remain unchanged.
- IT14.50: Preserve IT14.49 economy/placement/food/temple/production/trade/siege contracts and the +35% gather/trade multiplier. A P1 rush with a broken melee screen but no genuine local threat performs a short tactical regroup instead of immediately abandoning the rush; Late P1 requires roughly 26/28 infantry before launch. In Town phase Expert permits only one started Default/Huge primary infantry offensive, and unassigned healthy citizen-soldiers reinforce it in 6-8 unit waves rather than spawning multiple small independent attacks. Wounded rotation is stricter during contact (critical-health only) and broader only in lulls. Strategic finishing mode is delayed to <=28 enemy population, while <=8 ConquestCritical cleanup remains deterministic. P2 Forge-Tech Push still requires two completed military upgrades; rush-doctrine P2 follow-up may launch with one completed plus a second actively researching. The six-tech war-surplus research ceiling is removed; military tech selection is army-composition-aware and may create a modest market-barter bridge for a high-value upgrade while preserving the war reserve.

- IT14.51: Expert gather/trade multiplier remains 1.35. During an active mature economy, wood below 250 with a built Barter structure invokes a dedicated emergency wood trade before generic queue-need barter; disposable stone is preferred, then food, then metal, with preserved resource floors and one transaction per price-update cooldown. Extreme bank imbalance may move up to eight workers per correction, including post-opening civilian miners from the surplus finite resource, while emergency farmer release still preserves at least two workers per field. The strategy timing economy uses a 200-pop operating housing ceiling even when the lobby cap is higher. A Default/Huge attack below the healthy attack size retreats when a real local/static threat has collapsed its melee screen enough to expose a substantial ranged body; no-threat formation shape alone may not cause retreat. One coherent primary Default/Huge field offensive remains authoritative; smaller same-target siblings are recalled. Zero-pop trade routes may use gain >=2, and Market #2 retains stronger safe-distance scoring. P2 broken-enemy siege preparation begins around <=45 enemy population with a >=55-unit active army; +35% remains frozen.

- IT14.52: Expert gather/trade multiplier remains 1.35. Active stone, metal, and non-field natural-food districts receive generic dropsite-service auditing in addition to the existing wood worksite system: with at least three workers and useful remaining resources, a compatible dropsite should normally be within roughly 8-11m, and an observed >3.5s return/deposit/back-to-resource round trip may independently justify a Storehouse/Farmstead when obstacles make straight-line distance misleading. Resource-service construction is local, retains a 100-wood reserve, and may not be suppressed merely because the normal wood-storehouse or permanent-farm-hub count is satisfied. Active resource-to-dropsite corridors are protected from unrelated independent-building footprints. Temple eligibility may not depend on reaching eight fields: non-rush P1 may establish the worker-aura Temple around 55 population/3-field pipeline after the core barracks; once an Early/Late P1 rush actually launches, the Temple threshold is immediately relaxed; a missed Temple has a Town fallback around 75 population/3 fields without requiring a Market. Temple placement must cover a useful non-army worker cluster and uses four builders. IT14.51 strategy, attack coordination, emergency barter, production, tech-spending and +35% contracts remain frozen.
- IT14.53: Expert gather/trade multiplier remains 1.35. At <=8 enemy population, a living valid enemy Civic Centre is the hard execution target for Expert ram assault and finishing retarget; the IT14.46 visible-critical-unit/occupied-garrison-holder cleanup applies only after no valid CC remains. Athens may add one Gymnasium in Town Phase only from surplus after two Barracks, a Forge, the worker-aura Temple, the timing population threshold, and the doctrine-specific minimum time are satisfied; this may not delay the initial timing attack. Gymnasium champion training must inspect the live trainer roster rather than assume a template: if a champion melee/spearman is trainable it is preferred when the melee screen needs it, otherwise only a small ranged champion complement is added, with Gastraphetes/crossbowmen explicitly preferred for part of that complement. P2 Forge-Tech Push may intentionally train a live-trainable Hippocrates from the Temple when no Hero exists/queues. In City Phase Athens may add one Prytaneion from surplus; if no Hero survives/queues, Iphicrates is preferred when the live trainer exposes him, while a surviving Hippocrates is never intentionally discarded. IT14.52 logistics/Temple, IT14.51 economy controls, IT14.50 attack coordination, and all +35% benchmark contracts remain frozen.
- IT14.54: Expert gather/trade multiplier remains 1.35. Food and wood remain the primary economy. The Village/Town wood-Storehouse limits are soft limits on live wood-service districts only: Storehouses serving stone/metal and exhausted former forest camps may never block a required new forest worksite, and a measured wood-continuity emergency may bypass the soft limit. Permanent `wood`/`citizenSoldierWood` jobs may not silently gather stone or metal as a fallback. A delivered-wood watchdog must distinguish desired lumberjacks from their actual current gather resource and trigger recovery when assigned wood labor stops delivering. If Town Phase has been queued but not begun for at least the watchdog interval, the controller records the exact resource shortfall; when wood is the blocker, a tiny <=25 wood shortfall is bridge-chopped without spending the phase reservation; for a larger failure, only the exact cost of one authorized recovery Storehouse may be transferred from the sticky `majorTech` virtual account to `dropsites`, after which the phase reservation remains protected. Athens may inspect the live Forge `unlock_slingers` tech as a high-food/low-wood pressure valve, but it must read live technology and unit costs rather than hardcode them and may not spend scarce wood on the unlock during a wood shortage; once the data exposes a zero-wood unlock/unit path, zero-wood slingers may keep barracks productive while wood is protected. Athens Late P1 target 28 is screened at 16 melee/12 ranged (minimum 15/11 at a 26-unit launch threshold). IT14.53 special infrastructure, IT14.52 resource-service placement, existing combat/trade/siege contracts, and +35% remain frozen.
- IT14.55: Expert gather/trade multiplier remains 1.35. Natural-food dropsite service and permanent farm capacity are separate systems: a food-service Farmstead should require a meaningful carry problem (roughly >=15m or >4.5s observed cycle) and a genuinely separate food district (normally >=30m from an existing Farmstead), rather than multiplying Farmsteads around 12-13m berry carries. If natural food is exhausted, permanent fields are still missing, measured open field slots are zero and no field is pending, Expert must force a dedicated `farm_hub_deadlock` regardless of prior per-hub/network field-count anti-spam thresholds; the forced hub receives top economic priority, six builders, and may accept three immediate legal field slots. During a severe zero-slot food-capacity deadlock civilian production pauses automatically until capacity returns, and ordinary wood expansion may not consume attention merely because overflow workers were displaced to wood while >=1000 wood is already banked. The two Village first-tier mining upgrades (`gather_mining_servants` and `gather_mining_wedgemallet`) have a dedicated protected lane rather than competing in the broad P1 eco sweep: P1 preserves the full Town-Phase resource cost plus primary food/wood operating reserves and never delays an immediately ready Town click; P2 catches either missed Village upgrade early behind the core food/wood lanes. To make their 100-stone costs reachable without weakening the primary economy, from the mature Village opening at most two flexible citizen-soldier lumberjacks may bootstrap stone toward ~300 bank while wood is healthy, and P1 metal rebalance may not steal that protected stone. Higher mining tiers remain later surplus choices. IT14.54 wood-continuity/phase-watchdog and slinger-pressure contracts, IT14.53 Athens special infrastructure, existing combat/trade/siege behavior, and +35% remain frozen.


## IT14.55 smart eco-tech ordering addendum
- Food and wood are the primary economic resources, but the AI may not use a fixed farming-before-lumbering technology order after the replay-locked opening.
- Eco-tech scoring observes the live food/wood bank against phase-appropriate operating targets. When one primary resource is abundant and the other is below target, an affordable gather upgrade for the bottleneck resource must rank first.
- P1 eco sweep, Town core food/wood lanes, and later surplus economic research use the same pressure signal. Town core evaluates the higher-pressure lane first and reserves its live cost before considering the second lane.
- Dynamic scoring does not weaken hard Town-Phase reservation, queue affordability, mining-lane protection, or the +35% benchmark multiplier.


## IT14.56 productive reserve / adaptive-tech contract
- Expert gather/trade multiplier remains 1.35. Citizen-soldiers assigned to an unexecuted attack plan remain valid economic workers until the short completing/launch window; a large home military reserve is not a reason to mobilize by itself. Diagnostics must distinguish permanent civilians, reserve military, economically active reserve, and committed army.
- A Rush-doctrine P2 follow-up is opportunity-aware: a stable opponent retains the IT14.50 one-completed + second-active tech preference, while a clearly damaged or low-pop opponent may be attacked with the smaller opportunity package. P2 Forge-Tech Push still requires two completed military upgrades.
- Athens may deliberately establish Forge #1 in Village for Late-P1 Rush or P2 Forge-Tech Push. The live Village tech `citystate/city_state_attack_melee_01` may be researched before Town when affordable; a queued Late-P1 melee-I may briefly hold the rush while soldiers continue economic work, but never beyond the hard timing ceiling. A completed P1 melee-I counts as a real military upgrade for the P2 package.
- Food/wood productivity research is sequential across the P1 sweep, Town core lanes and later surplus research: one primary eco technology enters research, then pressure is re-evaluated before another primary eco tech is reserved. Mining remains subordinate to food/wood.
- The first-tier mining bootstrap is affordability-driven rather than clock-driven and may peel at most two flexible soldier-lumberjacks only when the live mining tech is stone-short and projected primary-resource income can support the technology plus protected reserves.
- A failed optional farm-hub placement may be cooled down when at least seven productive fields and adequate food throughput/bank already exist; `farm_hub_deadlock` is never cooled down. Gymnasium/Prytaneion may use a safe developed-home/territory-grid fallback instead of repeatedly failing edge-placement searches. IT14.55 food-capacity, IT14.54 wood continuity, IT14.53 special-unit behavior and all combat/trade/siege contracts remain in force.


## IT14.57 hard-cap / Athens-P1 / decisive-finish contract

- The configured Expert operating population ceiling is a **hard production ceiling**. Current population, live engine training, and AI-planned unit queues all count before civilians, citizen soldiers, Athens special units, or siege may be queued.
- `population.limit` and `population.max` are both capped in the Expert decision observation, so a 300-pop lobby cannot silently turn a 200-pop timing build into a 220+ boom.
- Athens `p2_tech_push` gets a genuine Village Forge + `citystate/city_state_attack_melee_01` attempt. A Forge already in progress may briefly hold Town, but never beyond the absolute Town timing.
- The Athens Village Forge/Melee affordability gate protects only resources the purchase actually spends; a wood-only Forge cannot be blocked by an unrelated unbanked food phase cost.
- Finishing-range opponents may trigger legal Town-phase siege preparation. The normal target is one ram in P2 and the existing finishing target in P3.
- At enemy population <=20, finishing watchdog retargets prioritize Civic Centre, then other ConquestCritical structures, then genuine military-production structures before ordinary cleanup.


## IT14.58 efficiency / rally / annex contract
- Resource reassignment is sticky: ordinary balancing may not reverse a worker during a short job lease or while approaching a valid gather target. Food/wood emergencies may override.
- Newly trained economic units receive trainer rally points toward the intended resource before they spawn. Citizen soldiers remain productive reserve workers until mobilized.
- Visible neutral natural food near the border is a strategic future food source: Wicker and influence expansion may claim it before permanent farms.
- Athens Late-P1 can exploit its Village Melee-I; when melee is the army majority, Melee-I precedes Ranged-I if still missing.
- Large lumber crews pre-build the next serviced forest district before depletion.
- Strategic construction tasks adopt matching orphan foundations rather than abandoning a real foundation after a tracker mismatch.
- The +35% Expert multiplier remains 1.35.


## IT14.59 execution-efficiency / City-throughput contract
- Preserve the IT14.58 1.35 benchmark multiplier and all working phase, combat, siege, food-capacity and operating-population contracts.
- The active engine training item, not a merely AI-queued future batch, owns the trainer rally point. Expert reconciles current training metadata every update and visibly rallies economy batches directly to a live gather target.
- Cross-resource worker moves use a 30-second lease. Ordinary `food_recovery` does not automatically break the lease; only strong recovery or a true emergency bank may. Temporary overflow wood receives a 36-second lease under the same rule.
- A rejected `setDesiredJob` request may not mutate FARM_LOCK/home/adaptive ownership, increment rebalance counters, start cooldowns, or emit a success log. Permanent farmers remain locked unless an actual transition is accepted.
- A worthwhile third natural-food district may be pipelined once the currently serviced district falls to roughly 350 food; literal exhaustion is no longer required. A resource-service food Farmstead preempts same-frame new Field spending unless food is critically low.
- Athens City-State attack tech follows its melee-majority/Hoplite doctrine: the intended 58% melee share is considered even during an opening ranged pulse, and a same-tier ranged attack does not outrank its missing melee counterpart.
- Missing Village mining upgrades remain a dedicated lane in City Phase as high-priority tech debt. Reaching P3 with `gather_mining_servants` or `gather_mining_wedgemallet` still missing must trigger the lane when affordable.
- P1 remains exactly two Barracks; Town may reach three. Barracks #4 is City-only at roughly 140+ population with a healthy bank; Barracks #5 is City-only at roughly 165+ population with a stronger bank.
- After one failed strategic placement, emergency fallback may ignore economic corridor/resource-comfort exclusions while retaining territory, accessibility and engine obstruction legality. This specifically prevents Gymnasium/Prytaneion from retrying thousands of impossible "pretty" positions.

## IT14.60 biome-proof food-capacity / four-farmer / siege-cap contract

- Expert gather/trade multiplier remains 1.35.
- Standard permanent fields use four preferred permanent farmers, clamped to the live/template `MaxGatherers`; lower-cap fields (for example Han rice paddies) keep their real lower cap. A fifth standard-field farmer is emergency overflow only.
- Field throughput planning uses the engine diminishing-return curve geometrically (`1 + d + d^2 + ...`) rather than `farmers × baseRate`. With the current standard `d=0.90`, four farmers provide 3.439 unsaturated-worker equivalents.
- If `desiredFields > existingFields`, field placement capacity is known, zero legal field slots remain, and no field is pending, another farm hub is a hard geometry obligation immediately; natural-food remaining may not postpone it.
- A sustained delivered-food shortfall of at least 15 seconds while permanent fields are missing raises new Field spending to emergency priority. Biome labels never override measured food throughput.
- Existing 6/8/10 permanent-field population floors remain unchanged for this test; 14.60 fixes execution before raising field-count floors.
- Legacy Petra Expert siege scaling is capped at two rams for normal attacks and three for Huge attacks. The dedicated Expert finishing lane remains two rams; the army must never wait for a five-to-seven-ram siege park.
- Preserve IT14.59 rally/worker-stability/P3-production behavior, IT14.58 benchmark multiplier, and all prior combat, phase and logistics contracts unless explicitly superseded above.

## IT14.61 construction-robustness / Wicker-release / map-hunt contract

- The opening Storehouse is mandatory. An Expert exact Storehouse plan that remains `awaiting-foundation` beyond the opening watchdog is cancelled and replanned; each recovery widens candidate rings and considers more of the ranked opening woodsites.
- Storehouse/Farmstead exact construction plans may not remain permanently queued without a foundation. Economic-task retries preserve the same Expert ownership/builder contracts and may adopt a real orphan foundation before cancelling anything.
- A Wicker secondary-food Farmstead is opportunistic, not a global lock. Its placement search broadens after failures, and an unfounded branch is released after repeated failures/time/food emergency or when permanent food declares `farm_hub_deadlock`. Peeled civilians then work the discovered food directly while the permanent Farmstead lane is free.
- A zero-slot `farm_hub_deadlock` may accept a two-field emergency hub after three failed searches. Normal permanent hubs retain the stricter four-slot ideal / three-slot fallback contract and >=30m Farmstead spacing.
- Athens `late_p1_rush` treats Village Melee-I as an obligation once the attack is ready: the army remains productive until Melee-I completes or the existing absolute launch deadline is reached. `early_p1_rush` is not held for Forge/Melee-I.
- Additional hunting cavalry are map-aware and are never trained from the Civic Centre. If sufficiently rich safe nearby hunt exists after roughly population 30, a buildable Stable may train up to two extra non-champion cavalry (three hunters total). The Stable requires core Barracks infrastructure and genuine surplus; food-capacity emergencies always veto the investment. Early-P1 uses substantially higher hunt thresholds to protect the proven rush timing.
- Four preferred farmers per standard field, diminishing-return-aware food math, existing permanent-field floors, P1/P2 Barracks ceilings, and the 1-3 ram finishing behavior remain unchanged from IT14.60.
- Benchmark gather/trade multiplier remains 1.35.

## IT14.62 true-siege / combat-discipline / expansion contract

- A broad `Siege` class is **not** sufficient to satisfy Expert building-siege logic. Human/Infantry/Cavalry/Organic units with a Siege tag remain normal combat units for attack composition, retreat and reinforcement. Real building wreckers are Rams and non-organic/non-human mechanical siege engines such as catapults; Siege Towers are excluded from the finisher count.
- Expert finishing normally targets two real building wreckers and never requires more than three. One real engine may execute a nearly defeated opponent. When finishing needs an engine, reserve operating-population headroom before routine infantry fills the cap; the dedicated high-priority siege queue runs before routine infantry and may spend that reserved headroom itself. Live engine-training items count toward the target so multiple Arsenals do not over-order.
- Ram-only behavior (passenger garrison and ram execution semantics) requires a real Ram, not any generic Siege unit. A ranged champion with a broad Siege tag may never suppress depleted-army retreat or masquerade as the ram package.
- Default/Huge P2/P3 attacks track exact own losses from Destroy events and enemy-population damage from the lowest reached enemy population. A sustained bad exchange under genuine enemy/static-defense pressure causes disengage/reboom; reinforcement waves may not keep feeding a fight already classified as a bad exchange.
- Strategic foundation tracking accepts either the expected building class or the exact civ-resolved template. A real Prytaneion foundation may not be dropped as `missing-after-foundation` merely because the template does not expose a `Prytaneion` class.
- Athens military attack-tech progression is doctrinal: Melee Attack I -> Ranged Attack I -> Melee II -> Ranged II -> Melee III -> Ranged III when the live civ exposes those technologies. Same-tier Ranged never leapfrogs its missing Melee counterpart. Narrow cavalry/javelineer technologies require a meaningful matching force. Forge #2 may begin around 90 population once six fields are established so the parallel Town military-tech lane exists during the relevant attack window.
- Late-P1 Athens Forge+Melee-I is an affordable package. Forge purchase must preserve the live Melee-I cost and operating reserves. A ready timing army waits meaningfully only for a technology actually queued/researching; a completed Forge gets only a short queue-grace window before the army launches without pretending the upgrade is imminent.
- Market #1 remains a resource dropsite/barter hub. Market #2 is a separated safe trade endpoint and must target meaningful route distance. Two Markets may not be intentionally clustered merely to satisfy a structure count.
- Every built `DropsiteWood` structure contributes to wood-service coverage. Late-game Storehouse expansion must reject tiny forest districts after the economy already owns many literal Storehouses; Markets/CCs/expansion centres are not ignored as valid wood dropsites.
- Athens may build at most one optional Town-phase Cleruchy when a safe neutral, same-land frontier contains a sufficiently rich multi-resource district and protected reserves remain. It is an expansion/dropsite/pop/military anchor, not a mandatory timing building, and finishing mode suppresses it.
- Preserve the opening Storehouse and Wicker-release invariants, four preferred standard-field farmers with diminishing-return-aware planning, existing 6/8/10 field floors, P1<=2 and P2<=3 Barracks ceilings, P3 production expansion, first-tier mining debt recovery, and the 1.35 benchmark multiplier.

## IT14.63 Town-finisher / relaunch / production-discipline contract

- Expert gather/trade multiplier remains 1.35. The IT14.62 true-siege, food-capacity, Storehouse, Barracks-phase, mining-debt and construction-retry contracts remain in force unless explicitly superseded here.
- Hunting does not justify a Stable. After the protected opening window, rich safe hunt may add pursuit cavalry one at a time from the Civic Centre, subject to the live CC queue and phase/technology obligations. A Stable is reserved for a separate combat-cavalry doctrine that actually intends to produce cavalry.
- A strategically broken Town-phase opponent can be finished in Town. If the surviving visible enemy combat force is small enough and the live assault has at least the configured escort advantage, finishing targets two real Town-phase building wreckers. City Phase is deferred while that finishing condition is active. If the opponent still has a substantial army, Town-rams are withheld rather than thrown away.
- Finishing Arsenal placement is urgent rather than aesthetic. The first finishing-placement failure may immediately use a dense legal owned-territory fallback out to the configured emergency radius; an impossible preferred district may not delay siege production for several minutes.
- Finishing pressure remains active at enemy population zero while the enemy player is still alive. The cleanup watchdog, real siege and ConquestCritical retargeting therefore continue until conquest rather than dropping out merely because the last unit died.
- A P2+ depleted/bad-exchange retreat creates an explicit reboom obligation. When the retreat cooldown expires, enough healthy reserve soldiers exist, population is rebuilt, and no primary attack already exists, Expert directly creates a new normal attack against the prior target. Retreat metadata and the relaunch cooldown use the same actual deadline.
- Athens P1 timing attacks do not suicide an unupgraded army into an intact opponent. A clearly weak target may still be exploited without Melee-I; otherwise the timing waits only while the upgrade is genuinely in the pipeline, and at the hard deadline abandons the P1 attack into P2 rather than forcing a poor fight.
- Athens Gymnasium champion doctrine is role-ordered: champion Hoplite/melee spear first, champion javelineer second, Gastraphetes/crossbow specialist last. The doctrine keeps no more than two concurrent/queued Gastraphetes and never fills a generic champion quota with extra Gastraphetes merely because they are trainable.
- Expert may build at most two Forges. Forge #2 exists to create useful parallel Town military-research throughput and may be built earlier when four established fields, protected food and wood reserves, and the first Forge make the second lane useful. A third Forge is never a City-phase surplus sink.
- Cleruchy expansion and the main assault are sequenced. If a major attack is already active or close to launch, the frontier expansion waits; otherwise the Cleruchy may complete first and the all-in follows. Finishing mode suppresses Cleruchy and other long-payback support infrastructure.
- Once finishing has enough military plus the required home reserve, routine infantry production stops filling operating-population headroom needed for siege/cleanup. Endgame retarget/stall timers are shorter so a broken opponent's remaining towers and ConquestCritical structures are cleared decisively.
- Market #1 remains a useful local dropsite/barter hub and receives a practical legal owned-territory fallback when its preferred Town placement is impossible. Market #2 remains a separated trade endpoint under the IT14.62 distance/route doctrine.

## IT14.64 attack-commitment / housing-resilience / actionable-infrastructure contract

- Expert gather/trade multiplier remains 1.35. Difficulty is not reduced until three consecutive clean sub-20-minute benchmark victories; the next tested reduction is +30%, not +25%.
- An Athens Late-P1 rush explicitly cancelled because Melee-I never arrived may not be immediately recreated by generic Rush creation. Expert may also abort a newly launched Rush/Default/Huge attack before heavy losses when the local head-on fight is clearly and materially outnumbered, especially under defensive structures. This is a commitment gate only; Petra's underlying movement/pathing remains unchanged.
- A House task that remains awaiting-foundation beyond the housing watchdog is adopted if a real orphan foundation exists, otherwise cancelled and replanned with a widened P2 search. Repeated House failures near the cap may research the live Town `pop_house_01` capacity technology rather than deadlock production indefinitely.
- Citizen-soldiers assigned to an unexecuted attack plan remain valid economic workers even when Petra has already set `PartOfArmy`; only actually started/completing combat or defense mobilization removes them from home-economy work. A reboom relaunch is gated by healthy reserve strength, not total population, so a housing block cannot suppress a viable counterattack.
- Forge accounting includes the live 50-metal building cost. Forge #2 is an on-demand parallel research lane: it is eligible only while exactly one Forge exists, a relevant Expert military technology is already in progress/queued, and the resource bank is strong enough to fund the second building and another lane. An idle Forge #1 never justifies Forge #2.
- Athens Gymnasium is built only when its live trainer roster exposes an available champion candidate and the bank can preserve the first intended champion after paying for the building. Repeated impossible Gymnasium placement enters a cooldown instead of retrying every frame. Champion preference remains Hoplite/melee > javelineer > Gastraphetes with the two-Gastraphetes cap.
- During a low-wood but high-food/stone window, Athens may activate the existing slinger pressure valve even when the wood-income watchdog has not formally declared a stall. This is a resource substitution inside the existing melee-screen doctrine, not permission to abandon Hoplites when resources support them.
