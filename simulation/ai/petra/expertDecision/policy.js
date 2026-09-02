const DEFAULT_POLICY = Object.freeze({
  // Fallback housing threshold when live template timing is unavailable.
  houseTriggerFreePopulation: 8,
  houseEmergencyFreePopulation: 3,
  houseSafetyPopulation: 1,
  housePlacementBufferSeconds: 8,
  houseMinimumPredictiveHeadroom: 4,
  houseMaximumPredictiveHeadroom: 14,
  houseMilitaryExtraHeadroomPerBarracks: 4,
  houseCCSoldierExtraHeadroom: 4,
  houseMaximumMilitaryHeadroom: 20,
  houseSurplusPrebuildWood: 1400,
  houseSurplusExtraHeadroom: 4,
  // Replay-derived Athens opening sequence:
  // starting 4 civilians -> food; first trained batch of 3 -> wood;
  // second trained batch of 3 -> food; then wood until 20 civilian woodcutters.
  startingNaturalFoodCivilians: 4,
  firstTrainedWoodCivilians: 3,
  secondTrainedFoodCivilians: 3,
  openingNaturalFoodCivilians: 7,
  // After Wicker completes, preserve one civilian per live bush in the primary patch;
  // surplus berry gatherers establish a worthwhile secondary food branch, otherwise wood.
  postWickerOneWorkerPerBush: true,
  // Preferred connected-patch ceiling. This caps NEW assignments only; it must never
  // redefine whether the opening berries themselves are valid food.
  naturalFoodMaxWorkersPerCluster: 8,
  // One civilian per individual berry/fruit supply before permanent food. This is
  // intentionally stricter than the connected-patch ceiling: a five-bush patch wants
  // five civilians, not eight civilians piled onto those same five bushes.
  naturalFoodMaxWorkersPerSupply: 1,
  // IT14.37: distinguish larger single fruit trees from berry bushes. Apples may
  // support three workers; an unknown isolated fruit source uses the same safe cap.
  naturalFoodAppleTreeMaxWorkers: 3,
  naturalFoodSingleSupplyMaxWorkers: 3,
  // Finish the newly-served natural-food district before purchasing the next one.
  naturalExpansionDepletionThreshold: 10,
  targetWoodCivilians: 20,
  // IT14.43: humans turn a gross resource surplus into construction tempo.  Allow
  // several workers to peel off a rich resource long enough to finish the structure,
  // then the sticky construction lifecycle returns them to normal economic work.
  maxConcurrentBuilders: 10,
  surplusConstructionResourceBank: 1000,
  severeConstructionResourceBank: 2200,
  lopsidedConstructionResourceRatio: 2.25,
  firstBarracksBuilders: 4,
  normalBarracksBuilders: 4,
  surplusBarracksBuilders: 6,
  normalHouseBuilders: 3,
  surplusHouseBuilders: 4,
  emergencyHouseBuilders: 5,
  normalStrategicBuilders: 3,
  surplusStrategicBuilders: 5,
  maxConcurrentFieldTasks: 3,
  // IT14.29: once permanent food is badly behind and wood is abundant, place more
  // fields in parallel. P1/opening behavior keeps the old three-task ceiling.
  maxConcurrentFieldTasksSurplus: 5,
  fieldParallelExpansionWoodBank: 1000,
  civilianCap: 70,
  farmPrebuildWoodCivilians: 12,
  farmSecondPrebuildWoodCivilians: 16,
  farmFullPrebuildWoodCivilians: 20,
  // Keep roughly two fields of permanent food capacity ahead without the IT9 double-count spam.
  farmCapacityBufferWorkers: 6,
  basketsBeforeHouseExtraHeadroom: 4,
  // Human replay military transition: Athens CC soldiers ~3:06, barracks 2:42-3:53;
  // Germans 3:40, Seleucids 3:54. Expert begins military at 3:00.
  soldierTrainingStartTime: 150,
  soldierTrainingBatch: 2,
  soldierFoodReserve: 100,
  // The CC stays on civilians until the 70-civilian cap; barracks carry military production.
  ccOpeningSoldierStartTime: 99999,
  ccSecondEmergencySoldierTime: 99999,
  barracksReserveTime: 135,
  barracksTargetTime: 150,
  barracksHardDeadline: 180,
  farmPrepareRatio: 0.35,
  farmTransitionRatio: 0.25,
  naturalFoodExpansionRatio: 0.25,
  // IT14.15 baseline: permanent fields normally begin when the COMBINED natural food
  // discovered in our territory falls to roughly 30%. IT14.17 adds two safe overrides:
  // spend a large wood bank on fields, or add field capacity when natural patches are full.
  territoryNaturalFarmTransitionRatio: 0.25,
  // IT14.42: natural food remains the preferred opening food engine. Do not let a
  // large wood bank or a temporarily full berry patch force early fields while the
  // combined in-territory natural-food pool is still healthy; overflow civilians can
  // work wood until the natural pool approaches the real transition threshold.
  woodSurplusFarmExpansionBank: 800,
  woodSurplusFarmExpansionPopulation: 45,
  naturalFoodEmergencyFieldFoodBank: 120,
  naturalFoodEmergencyFieldRunwaySeconds: 70,
  // Healthy natural food can substitute for an already-mature farm block when
  // deciding whether to spend wood on core military/economic infrastructure.
  // Otherwise "natural food first" would paradoxically delay the Temple/Forges/
  // Barracks that the saved field wood was supposed to accelerate.
  naturalFoodInfrastructureRemaining: 600,
  naturalFoodInfrastructureRunwaySeconds: 90,
  naturalFoodFieldPressureSlots: 2,
  minimumAlternativeNaturalFood: 60,
  foodSiteMinimumCommitSeconds: 20,
  naturalFoodDropsiteComfortDistance: 15,
  naturalFoodFarmsteadIdealDistance: 5,
  naturalFoodFarmsteadAssumedWalkSpeed: 8,
  naturalFoodFarmsteadCarryCapacity: 10,
  naturalFoodFarmsteadPaybackWorkerSeconds: 85,
  // IT14.43 staged natural-food -> farm transition.  Natural food remains the
  // efficient first choice, but permanent capacity starts coming online BEFORE the
  // last berries disappear instead of jumping from natural food to starvation.
  fieldTransitionLeadSeconds: 55,
  naturalFoodRunwaySafetySeconds: 45,
  naturalFoodStageTwoRunwaySeconds: 120,
  naturalFoodStageFourRunwaySeconds: 90,
  naturalFoodStageSixRunwaySeconds: 60,
  naturalFoodStageEightRunwaySeconds: 35,
  naturalFoodStageTwoRatio: 0.40,
  naturalFoodStageFourRatio: 0.30,
  naturalFoodStageSixRatio: 0.22,
  naturalFoodStageEightRatio: 0.14,
  farmersPerField: 3,
  // IT14.27: compact human-like farm blocks target the four farmstead sides.
  // Do not plan six speculative perimeter slots; four reliable N/E/S/W positions
  // are the capacity contract, with small tangential fallback only if one side is blocked.
  fieldsPerFarmstead: 4,
  minimumFarmHubFieldSlots: 4,
  // IT14.29: keep four-slot farm hubs as the normal standard, but after repeated
  // real-map placement failures accept a compact three-field hub rather than deadlock.
  minimumFarmHubFieldSlotsFallback: 3,
  farmHubFallbackAfterFailures: 6,
  // IT14.21 user contract: a NEW permanent farmstead is not allowed merely because
  // field demand is high. The current compact block must have at least three completed
  // fields and no remaining touching slot. Natural-food dropsites are the only exception.
  minimumFieldsBeforeNextFarmHub: 3,
  // IT14.40: the opening natural-food farmstead is a dropsite first and can be
  // geometrically limited to only two permanent fields. Once its natural food is
  // exhausted and those two slots are genuinely saturated, permit a dedicated
  // permanent farm hub instead of deadlocking forever waiting for an impossible
  // third opening field. Dedicated later farm hubs still use the normal 3-field rule.
  minimumFieldsBeforeConstrainedOpeningFarmHub: 2,
  minimumNaturalExpansionFieldSlots: 2,
  maxFarmHubDistanceFromCC: 70,
  minimumPrebuildFields: 2,
  minimumMidPrebuildFields: 3,
  minimumTransitionFields: 4,
  localWoodHealthyAmount: 700,
  localWoodCriticalAmount: 300,
  woodExpansionAmount: 700,
  woodDistanceExpansionAmount: 1400,
  woodExpansionWorkerThreshold: 10,
  targetWoodDropDistance: 24,
  requiredLowWoodObservations: 3,
  woodWorksiteRadius: 30,
  cavalryHuntSearchRadius: 220,
  firstBarracksPopulation: 30,
  minimumFieldsBeforeBarracks: 2,
  secondBarracksPopulation: 0,
  // IT14.4: reserve early enough that the second barracks can FINISH near 5:00.
  // The normal food gate still applies; an early capacity path may use fields already
  // in the pipeline plus a large in-territory natural-food runway.
  secondBarracksReserveTime: 210,
  secondBarracksTargetTime: 230,
  secondBarracksHardDeadline: 250,
  secondBarracksEarlyFieldPipeline: 3,
  secondBarracksHardFieldPipeline: 2,
  secondBarracksEarlyNaturalFood: 1200,
  // If natural food alone can safely bridge two production buildings, do not require
  // speculative fields merely to unlock Barracks #2.
  secondBarracksEarlyNaturalRunwaySeconds: 120,
  secondBarracksHardNaturalFood: 800,
  secondBarracksEarlyFoodBank: 350,
  minimumCompletedFieldsBeforeSecondBarracks: 5,
  foodRateSafetyMargin: 1.12,
  foodBankBridgeForSecondBarracks: 900,
  secondBarracksMinimumFoodBridgeSeconds: 60,
  secondBarracksFoodReserve: 150,
  earlyResourceSurplusCeiling: 1000,
  // Post-opening bank governor. A 1k+ resource is allowed, but once it is far richer
  // than the weak side of the bank, NEW units repair the deficit first. Existing
  // workers move only as a slow secondary correction, one worker every 20 seconds.
  resourceBalanceStartTime: 165,
  resourceBalanceActivationBank: 650,
  resourceBalanceRatioFloor: 250,
  resourceBalanceNewWorkerRatio: 1.5,
  resourceBalanceStrongRatio: 2.5,
  resourceBalanceFoodPriorityBank: 700,
  resourceBalanceReassignBatch: 2,
  resourceBalanceReassignCooldownSeconds: 15,
  resourceBalanceExtremeRatio: 3.5,
  // IT14.51: extreme bank mismatches need a decisive labor move, not three workers
  // every ten seconds. This is especially important when stone has become effectively
  // dead stock while a live war economy is starved for wood.
  resourceBalanceExtremeBatch: 8,
  resourceBalanceExtremeCooldownSeconds: 5,
  // P2 is readiness-driven, not a hard clock. 90-120 population and 7-11 minutes is
  // the normal corridor; exceptional economies may begin slightly earlier and an
  // overdue economy reserves the phase rather than remaining in Village forever.
  phase2ExceptionalTime: 390,
  phase2NormalTime: 420,
  phase2MatureTime: 480,
  phase2LateTime: 600,
  phase2OverdueTime: 660,
  phase2ExceptionalPopulation: 105,
  phase2NormalPopulation: 90,
  phase2MaturePopulation: 100,
  phase2LatePopulation: 110,
  phase2OverduePopulation: 120,
  // IT14.28 failsafe: once the base has two barracks, a minimally established farm
  // economy and a mature population, P2 must be reserved by 8:00 even if the
  // measured-food model is pessimistic. Queueing the phase lets the queue manager
  // reserve resources instead of allowing Village-phase spending forever.
  phase2AbsoluteTime: 420,
  phase2AbsolutePopulation: 80,
  phase2AbsoluteMinimumFields: 4,
  phase2PreferredFields: 8,
  phase2LateMinimumFields: 7,
  phase2ExceptionalCostCoverage: 0.80,
  phase2NormalCostCoverage: 0.45,
  phase2MajorThreatUnits: 12,
  phase2MajorThreatRadius: 150,
  // IT14.12: once Town Phase is actually reached, production should scale with the
  // economy instead of remaining frozen at the two-barracks P1 footprint. This is
  // deliberately conservative so P1 timing is untouched.
  phase2ThirdBarracksPopulation: 100,
  phase2ThirdBarracksMinimumFields: 6,
  phase2ThirdBarracksFoodBank: 300,
  phase2ThirdBarracksWoodBank: 200,
  // IT14.39: Town-phase food/wood productivity techs are core infrastructure, not
  // late-game surplus spending. They get first reservation priority alongside the
  // first forge upgrades so the home economy keeps scaling while the army is away.
  phase2CoreEcoFoodReserve: 150,
  phase2CoreEcoWoodReserve: 100,
  phase2CoreEcoMetalReserve: 0,
  phase2MilitaryTechFoodReserve: 250,
  phase2MilitaryTechWoodReserve: 50,
  phase2MilitaryTechMetalReserve: 25,
  phase2MarketPopulation: 85,
  phase2MarketWoodReserve: 50,
  phase2SecondMarketPopulation: 115,
  phase2SecondMarketWoodReserve: 75,
  // IT14.43: two markets need separation, not a perfect city plan. Thirty metres
  // still creates distinct Town structures while avoiding the 7k-candidate deadlock.
  phase2SecondMarketSpacing: 30,
  // IT14.35: the worker-efficiency temple is a Village-phase economic structure.
  // Normally establish it after barracks #2, once a small permanent-food base exists.
  // IT14.52: the worker-aura Temple is core economic infrastructure, not a late
  // luxury. A non-rush/P2-tech opening may reserve it once the basic two-barracks
  // economy is established; rush doctrines still suppress it until the rush launches.
  p1TemplePopulation: 55,
  p1TempleMinimumFieldPipeline: 3,
  p1TempleWoodReserve: 25,
  // Give the post-barracks P1 temple a short protected construction window before
  // Town Phase reserves the same wood.  This is a maximum hold, not a phase gate.
  // IT14.38: Temple remains a high P1 priority, but it no longer blocks Town phase.
  p1TemplePhaseHoldUntil: 0,
  // IT14.52: never deadlock the Temple behind an arbitrary eight-field count.
  // If the P1 window was missed, Town-phase Expert should still establish the aura
  // while the economy is growing, normally around the 8-10 minute window.
  phase2TemplePopulation: 75,
  phase2TempleMinimumFields: 3,
  phase2TempleWoodReserve: 75,
  // Greek City States may buy Hoplite Tradition in late P1 when it can be paid for
  // without consuming the resource reserve needed for Town Phase. If that window is
  // missed, it becomes the first dedicated City-State military tech in P2.
  hopliteTraditionMinimumTime: 300,
  hopliteTraditionLatestP1StartTime: 390,
  hopliteTraditionMinimumPopulation: 70,
  hopliteTraditionMinimumFieldPipeline: 4,
  hopliteTraditionFoodReserve: 100,
  hopliteTraditionWoodReserve: 100,
  hopliteTraditionMetalReserve: 0,
  // Surplus wood should become useful infrastructure instead of a 5k bank.
  // One forge may appear late P1 only under an extreme surplus. Forge #1 is part
  // of the P2 transition, forge #2 follows as soon as Town is reached, and forge
  // #3 remains a City-phase expansion.
  lateP1ForgeTime: 330,
  lateP1ForgePopulation: 70,
  lateP1ForgeWoodBank: 1500,
  lateP1ForgeWoodFoodRatio: 3.0,
  phase2Forge1Population: 90,
  phase2Forge2Population: 100,
  phase2Forge3Population: 135,
  // IT14.34 preserves IT14.33: forge #1 is Town-transition infrastructure, forge #2 is immediate
  // Town infrastructure, and only forge #3 waits for City phase.
  phase2ForgeTransitionTime: 420,
  phase2ForgeTransitionMinimumFields: 6,
  phase2ForgeSecondMinimumFields: 8,
  phase2ForgeSecondFoodBank: 250,
  phase2Forge1WoodBank: 200,
  phase2Forge2WoodBank: 200,
  phase2Forge3WoodBank: 2400,
  forgeWoodReserve: 100,
  // Expert defense doctrine: large incoming forces trigger a deliberate retreat to the
  // base, full-army assembly, and only then a coordinated counterattack. Towers are
  // emergency force multipliers, never routine border spam.
  defenseThreatMinimumUnits: 8,
  defenseAwarenessRadius: 220,
  defenseAutomaticDangerRadius: 135,
  defenseApproachImprovement: 18,
  defenseAssemblyRadius: 24,
  defenseAssemblyFraction: 0.55,
  defenseAssemblyMaxWaitSeconds: 18,
  defenseImmediateEngageRadius: 55,
  defenseOrderRefreshSeconds: 3,
  defenseThreatReleaseSeconds: 12,
  defenseTowerOutmatchedRatio: 1.12,
  defenseTowerOutnumberedRatio: 1.20,
  defenseTowerMinWarningDistance: 42,
  defenseTowerMaxWarningDistance: 170,
  defenseTowerMaxEmergencyCount: 2,
  defenseTowerCooldownSeconds: 180,
  defenseTowerGarrisonSlots: 5,
  defenseTowerReserveWood: 125,
  // Civilians near a live fight evacuate independently of army assembly.
  civilianDangerRadius: 48,
  civilianImmediateGarrisonRadius: 22,
  civilianEvacuationReleaseSeconds: 10,
  civilianSafeResourceThreatDistance: 62,
  civilianSafeResourceCCDistance: 150,
  woodMigrationBatch: 4,
  woodMigrationWindowSeconds: 12,
  woodMigrationSalvageRadius: 52,
  // Preserve a still-rich committed forest instead of switching the whole lumber crew
  // just because the tight ring around its storehouse has thinned out.
  woodMigrationRetainWoodRatio: 1.15,
  // Post-opening assignments are sticky, but not blind. Permanent farmers remain
  // protected; a severe food deficit may peel a tiny batch of civilian lumberjacks
  // back to food while later wood recovery is supplied by NEW civilians.
  postOpeningFoodFloor: 300,
  postOpeningWoodFloor: 180,
  postOpeningFoodWoodRatioForWood: 2.0,
  // IT14.24: 20 is the opening civilian-wood target, not a permanent ceiling/floor.
  // The feedback governor may
  // peel a few of those civilians back to food when wood is clearly ahead, or let
  // NEW civilians grow the wood workforce later when a mature food economy is surplus.
  maxDynamicWoodCivilians: 28,
  matureFoodWoodReleaseFields: 7,
  matureFoodWoodReleaseBank: 900,
  matureFoodWoodReleaseRatio: 1.75,
  matureFoodWoodReleaseRateRatio: 1.30,
  matureFoodWoodReleaseWoodBankCeiling: 550,
  // IT14.31: overflow farm slots (4th/5th gatherers) are emergency productivity only.
  // Under a mature food surplus, peel those overflow farmers back to wood before
  // creating yet more permanent food capacity. Preferred three-per-field crews remain.
  foodSurplusFarmerReleaseStartTime: 360,
  foodSurplusFarmerReleaseFoodBank: 1400,
  foodSurplusFarmerReleaseWoodBankCeiling: 550,
  foodSurplusFarmerReleaseBatch: 3,
  foodSurplusFarmerReleaseCooldownSeconds: 6,
  // IT14.35: if a ten-field economy is sitting on thousands of food while wood is
  // critically starved, temporarily release the third farmer from fields down to a
  // two-per-field floor. This is the emergency valve that prevents 3kF/100W lockups.
  extremeFoodWoodReleaseFoodBank: 2200,
  extremeFoodWoodReleaseWoodBankCeiling: 300,
  extremeFoodWoodReleaseMinimumFields: 6,
  extremeFoodWoodReleaseMinimumFarmersPerField: 2,
  extremeFoodWoodReleaseBatch: 8,
  // When the mature food engine is rich but metal has collapsed, shift a tiny
  // amount of established labor instead of waiting for a new civilian that may
  // never exist at the population cap.  Stone workers are preferred, then a
  // third farmer may leave a field, but fields never fall below two workers.
  strategicMetalRebalanceStartTime: 300,
  strategicMetalFoodBank: 300,
  strategicMetalBankFloor: 600,
  strategicMetalMinimumWorkers: 6,
  strategicMetalStoneSurplusRatio: 1.35,
  strategicMetalMinimumFarmersPerField: 2,
  strategicMetalReassignBatch: 2,
  strategicMetalReassignCooldownSeconds: 10,
  foodWoodFeedbackStartTime: 180,
  foodRecoveryFoodBank: 500,
  foodRecoveryWoodBank: 450,
  foodRecoveryWoodFoodRatio: 1.50,
  foodRecoveryStrongWoodFoodRatio: 2.25,
  foodRecoveryRateRatio: 1.05,
  foodRecoveryMinimumCivilianWood: 12,
  foodRecoveryReassignBatch: 2,
  foodRecoveryReassignCooldownSeconds: 12,
  dynamicWoodShortageBank: 350,
  foodSurplusRedirectThreshold: 900,
  foodSurplusPauseFarmExpansion: 1000,
  // IT14.43: once the required food workforce is already covered, a large food
  // bank should make NEW civilians behave like a human surplus-management choice:
  // reinforce wood instead of creating yet more permanent food ownership. Existing
  // preferred farmers stay on their fields (or may briefly build a nearby house).
  foodSurplusNewCivilianWoodBank: 1200,
  foodSurplusNewCivilianWoodRatio: 1.75,
  // Permanent-food floors: natural food and a temporary food bank may delay expansion,
  // but they may not collapse the long-term farm economy below these population-scaled floors.
  fieldFloorSixPopulation: 70,
  fieldFloorEightPopulation: 90,
  fieldFloorTenPopulation: 120,
  fieldFloorTwelvePopulation: 9999,
  preferredPermanentFields: 10,
  emergencyPermanentFieldsFoodBank: 500,
  // IT14.31: twelve permanent fields is the strategic ceiling. The live replay showed
  // that letting current food ownership recursively inflate desiredFields created a
  // 17-18 field target and a runaway food bank.
  maximumPermanentFields: 12,
  // Do not open generic mines until the permanent food economy has at least six completed fields.
  miningMinimumCompletedFields: 4,
  miningStartCivilians: 35,
  miningFoodFloor: 750,
  miningWoodFloor: 300,
  miningTargetStoneWorkers: 3,
  miningTargetMetalWorkers: 6,
  // Strategic bank shape. Equal normalized reserves produce roughly
  // food 1.56 : wood 1.25 : metal 1.00 : stone 0.80.
  resourceReserveWeightFood: 1.5625,
  resourceReserveWeightWood: 1.25,
  resourceReserveWeightMetal: 1.00,
  resourceReserveWeightStone: 0.80,
  // Keep the civic-center movement/assembly core open. Opening resource dropsites are
  // resource-driven exceptions; later housing/military/farm hubs stay outside the core.
  // IT14.28: Expert has no true city-block planner, so keep the CC movement/core area open.
  // Resource dropsites (storehouse/farmstead) remain resource-driven exceptions.
  independentBuildingMinimumCCDistance: 50,
  // IT14.46 temples are economic aura buildings, not generic edge buildings.
  templeMinimumCCDistance: 14,
  templeAuraPlanningRadius: 72,
  templeMinimumWorkerCoverage: 8,
  houseWoodWorksiteExclusionRadius: 24,
  expertCleanupEnemyPopulation: 8,
  p1EcoSweepStartTime: 330,
  p1EcoSweepMaxQueued: 6,
  houseMinimumCCDistance: 50,
  // P2 houses stop extending a single P1 line forever. Search developed edges and
  // wider rings while retaining the same open CC core.
  phase2HouseSearchMaximumDistance: 96,
  phase2HouseDistrictRadius: 34,
  barracksMinimumCCDistance: 50,
  barracksAwaitingFoundationRetrySeconds: 20,
  // IT14.41: Barracks #3 is throughput infrastructure. If its first exact-placement
  // attempt does not create a foundation quickly, retry with the broad frontier sweep
  // instead of burning repeated 20-second dead windows.
  thirdBarracksAwaitingFoundationRetrySeconds: 6,
  strategicPlacementFallbackAfterFailures: 1,
  farmHubMinimumCCDistance: 40,
  // Independent buildings should live outside the food-production core. Fields keep
  // first claim on the legal ring immediately around every farmstead; houses/barracks/
  // markets prefer the outside of that district instead of consuming future field slots.
  farmDistrictIndependentBuildingMinimumDistance: 28,
  farmDistrictIndependentBuildingPreferredDistance: 38,
  farmDistrictReservedSlotMargin: 2,
  // Once the normal 10-field economy is physically complete, military/civic
  // expansion no longer reserves hypothetical future field faces.  Real fields
  // remain protected by the obstruction map; 11-12 fields are emergency capacity.
  matureFarmDistrictRelaxFieldCount: 10,
  // Reuse natural-food farmsteads as permanent farm districts before buying another
  // farm hub. Dedicated hubs still prefer near-touching fields; exhausted natural
  // dropsites may use a modestly wider ring if that is what the terrain allows.
  existingFarmsteadReuseMaxBorderGap: 4.0,
  // IT14.30: before buying another farm hub, make one last local packing pass.
  // This is deliberately wider than the normal 4m reuse ring, but still local enough
  // that the field uses the existing dropsite rather than behaving like a remote farm.
  existingFarmsteadFillInMaxBorderGap: 10.0,
  farmWorkerHomeRadius: 55,
  storehouseMinimumCCDistance: 18,
  // IT14.52 generic resource-district service.  Wood already had sophisticated
  // dropsite logic; stone, metal and natural food now get the same human-like
  // expectation that workers should not carry resources across the settlement.
  resourceServiceStartTime: 120,
  resourceServiceIdealDropDistance: 8,
  resourceServiceHardDropDistance: 11,
  resourceServiceObservedRoundTripSeconds: 3.5,
  resourceServiceClusterRadius: 18,
  resourceServiceMinimumWorkers: 3,
  resourceServiceMinimumMineralRemaining: 250,
  resourceServiceMinimumNaturalFoodRemaining: 300,
  resourceServiceStorehouseMinimumSpacing: 10,
  resourceServiceWoodReserve: 100,
  resourceServiceRetryCooldownSeconds: 16,
  resourceCorridorClearance: 3.5,
  // Temporary/fallback lumberjacks may only use trees actually serviced by a
  // completed storehouse or market. This prevents remote no-dropsite wood camps.
  fallbackWoodDropsiteRadius: 36,
  // IT14.41: temporary overflow work should be genuinely productive, not a one-tick
  // waypoint between food capacity checks. Keep a temporary wood assignment for this
  // long unless food has entered explicit recovery mode.
  temporaryFallbackLeaseSeconds: 30,
  // IT14.41 finishing doctrine. Once the opponent has been broken, convert the lead
  // into a victory instead of dissolving pressure and assembling another full wave.
  expertFinishingEnemyPopulation: 28,
  expertFinishingMinimumOwnPopulation: 80,
  expertFinishingMinimumPopulationLead: 30,
  expertFinishingHomeCitizenSoldierReserve: 12,
  expertFinishingReinforcementBatch: 6,
  expertFinishingForceStartSize: 8,
  // Once the opponent is broken, a 100-man blob is not smarter than a 45-man
  // cleanup army. Cap reinforcement and use watchdog retargets instead.
  expertFinishingMinimumArmy: 36,
  expertFinishingMaximumArmy: 50,
  expertFinishingArmyPerEnemy: 3,
  expertFinishingStallSeconds: 45,
  expertFinishingRetargetCooldownSeconds: 30,
  expertFinishingSiegeTarget: 2,
  // IT14.44: a depleted Town-phase push should not donate its last infantry to a CC/tower.
  // If the field army falls to this size while standing in enemy territory and no siege
  // finisher is present, withdraw and spend a short window rebuilding economy/army.
  expertDepletedAttackRetreatArmy: 22,
  expertDepletedAttackDefendedRadius: 155,
  expertDepletedAttackReboomSeconds: 60,
  expertDepletedAttackResumePopulation: 130,
  // IT14.49 P1 combat discipline. A rush is allowed to fail, but it may not feed
  // the same bad fight indefinitely. Attrition is compared with the opponent's
  // population damage, then local force/static-defense pressure can force a retreat.
  expertRushAbortLossFraction: 0.35,
  expertRushAbortPressureLossFraction: 0.25,
  expertRushAbortEnemyDamageCredit: 0.75,
  expertRushAbortMinimumOwnLosses: 5,
  expertRushAbortMinimumFightSeconds: 10,
  expertRushAbortLocalOutnumberRatio: 1.25,
  expertRushLocalBalanceRadius: 80,
  expertRushDefensiveThreatRadius: 90,
  expertRushRetreatCooldownSeconds: 105,
  // IT14.50: a broken melee screen is first a tactical-regroup signal, not an
  // automatic strategic surrender. Only true local pressure / bad exchange should
  // send the whole army home.
  expertRushTacticalRegroupSeconds: 7,
  expertRushTacticalRegroupCooldownSeconds: 25,
  expertRushTacticalRegroupDistance: 24,
  // IT14.51: normal P2 attacks also need to preserve the ranged body once their
  // melee screen has genuinely collapsed under local pressure. This is a strategic
  // retreat only after the army has already fallen below the healthy attack size.
  expertCombatScreenRetreatArmyCeiling: 48,
  expertCombatScreenRetreatRangedMinimum: 12,
  expertCombatScreenRetreatMeleeToRanged: 0.38,
  expertCombatScreenRetreatEnemyMinimum: 4,
  expertCombatScreenReboomSeconds: 45,
  expertRecentGarrisonThreatSeconds: 25,
  // Keep ranged infantry behind the melee centroid instead of letting pathing put
  // javeliners/archers on the front edge of a mixed infantry army.
  expertRangedScreenBehindMeleeDistance: 8,
  expertRangedScreenTolerance: 4,
  expertRangedScreenUpdateSeconds: 3,
  // IT14.45: preserve veteran manpower.  Badly wounded citizen-soldiers peel out of
  // an active attack, run home, and return to economic work while fresh soldiers
  // replace them.  The full-army retreat remains the fallback when the whole push
  // has actually collapsed.
  expertWoundedRetreatHealth: 0.25,
  // IT14.50: do not constantly dismantle an army in the middle of combat. During
  // contact only critically wounded troops peel; in a lull we may rotate a few more.
  expertWoundedRetreatHealthCombat: 0.18,
  expertWoundedRetreatHealthLull: 0.30,
  expertWoundedRetreatBatchCombat: 2,
  expertWoundedRetreatBatchLull: 6,
  expertWoundedReturnSeconds: 90,
  expertWoundedReplacementBatch: 8,
  expertWoundedReplacementWaveMinimum: 6,
  expertWoundedReplacementWaveCooldownSeconds: 14,
  expertWoundedReplacementHomeReserve: 12,
  // One coherent Town-phase offensive. Fresh troops leave in waves instead of
  // spawning a second independent attack plan or dribbling forward one at a time.
  expertPrimaryOffensiveTargetArmy: 58,
  expertPrimaryReinforcementWaveMinimum: 6,
  expertPrimaryReinforcementWaveMaximum: 8,
  expertPrimaryReinforcementWaveCooldownSeconds: 16,
  // Rams are the finishing tool. Fill a modest number of seats so their movement/damage
  // bonus matters without hiding the whole infantry army inside them.
  expertRamGarrisonTarget: 5,
  expertRamGarrisonSearchRadius: 90,
  expertRamActiveArmySearchRadius: 180,
  expertRamCavalryThreatCount: 4,
  expertRamCavalryReleaseRadius: 48,
  // Once a ram is physically part of the attack, infantry work the perimeter rather
  // than diving under the CC.  When a ram reaches this arrival radius the whole army
  // pivots inward.  The hold has a safety timeout so a stuck ram cannot freeze a win.
  expertRamArrivalRadius: 65,
  expertRamStagingDistance: 88,
  expertRamStagingMaxHoldSeconds: 75,
  // Build one siege finisher as soon as a healthy P3 attack exists; finishing mode
  // still raises the desired total to expertFinishingSiegeTarget.
  expertP3SiegePrepArmy: 40,
  expertP3SiegePrepTarget: 1,
  // IT14.47: if the opponent is already strategically broken in Town Phase, begin
  // the siege-finisher pipeline as soon as the civ's own tech tree actually permits
  // an arsenal/ram. Availability checks remain authoritative, so this cannot invent
  // P2 siege for civs that only receive it in City Phase.
  expertBrokenEnemySiegePopulation: 45,
  expertBrokenEnemySiegeArmy: 55,
  // Zero-pop traders are a small passive multiplier, not a new boom strategy.
  expertTradeInitialTraders: 2,
  expertTradeStrongRouteTraders: 4,
  expertTradeStrongRouteGain: 8,
  // The CWA trader is zero-pop, so even a short legal land route is worth using.
  expertTradeMinimumGain: 2,
  // IT14.51 emergency war-economy barter. Generic Petra barter remains available,
  // but a 4k-stone/50-wood bank needs an explicit wood rescue before queue needs
  // happen to expose the deficit. One transaction per cooldown keeps market price
  // feedback authoritative while restoring a usable production reserve quickly.
  expertEmergencyWoodBarterStartTime: 540,
  expertEmergencyWoodBarterTrigger: 250,
  expertEmergencyWoodBarterCritical: 100,
  expertEmergencyWoodBarterTarget: 700,
  expertEmergencyWoodBarterCooldownSeconds: 4,
  expertEmergencyWoodBarterBatch: 500,
  expertEmergencyWoodBarterStoneFloor: 800,
  expertEmergencyWoodBarterFoodFloor: 1400,
  expertEmergencyWoodBarterMetalFloor: 800,
  // Expert timing doctrines are benchmarked around a normal 200-pop operating
  // economy. A larger lobby cap may be exploited later, but may not inflate the
  // timing attack into an endless house/army boom before the first kill attempt.
  expertOperatingPopulationCap: 200,
  // IT14.44 P2 research package: during an actual P2 push, buy the first two broad
  // military upgrades before spending deeper into the forge tree, then immediately
  // establish the food+wood eco pair. Higher military tiers wait for eco continuity.
  expertP2MilitaryTechsBeforeEco: 2,
  expertP2MilitaryTechsBeforeSecondEcoPair: 2,
  // IT14.50: after the first Town food+wood eco pair is protected, a live push may
  // keep converting genuine surplus into useful military techs. IT14.49's six-tech
  // ceiling left Melee Attack II unresearched while >1k metal sat idle, so there is
  // deliberately no military-tech count cap here.
  expertP2WarTechFoodReserve: 500,
  expertP2WarTechWoodReserve: 250,
  expertP2WarTechStoneReserve: 0,
  expertP2WarTechMetalReserve: 150,
  // IT14.42: a Town-phase default/huge attack may assemble while techs research, but
  // once P2 is complete it waits for two completed Expert forge upgrades before
  // launching. If the same plan reaches launch strength while Town is still
  // researching, it may go early as a P1 timing attack.
  expertP2AttackRequiredMilitaryTechs: 2,
  // A rush-doctrine follow-up may preserve momentum with one completed upgrade so
  // long as a second dedicated military tech is actively researching.
  expertP2RushFollowupCompletedMilitaryTechs: 1,
  expertP2RushFollowupActiveMilitaryTechs: 2,
  expertP1TimingAttackMinimumUnits: 28,
  // Forward infrastructure may deliberately claim territory toward useful neutral
  // resources. Buildings must still pass the normal own-territory legality test.
  forwardAnchorMinimumCCDistance: 58,
  forwardAnchorMaximumCCDistance: 155,
  // A forest is a work district, but repeated dropsites require a genuinely large,
  // actively-worked CONNECTED forest and a meaningful drop-distance improvement.
  woodClusterSearchRadius: 110,
  woodClusterLinkDistance: 22,
  woodDeepenMinimumWorkers: 14,
  woodDeepenExtraWorkersPerStorehouse: 8,
  woodDeepenMinimumRemaining: 1200,
  woodDeepenExtraRemainingPerStorehouse: 300,
  woodDeepenMinimumDistanceImprovement: 3.5,
  woodStorehouseMinimumSpacing: 20,
  // IT14.31: IT14.30 reached ten storehouses while wood income collapsed. Chasing every
  // thinning patch with another 100-wood dropsite is self-defeating. Reuse existing
  // worksites after these phase-scaled caps.
  maximumVillageWoodStorehouses: 5,
  maximumTownWoodStorehouses: 7,
  ecoTechFoodReserve: 600,
  ecoTechWoodReserve: 300,
  ecoTechSurplusFood: 900,
  ecoTechSurplusWood: 500,
  // IT14.48: Athens uses a broad army-composition target instead of a rigid
  // 2 Hoplite : 1 Marine : 1 Javeliner sequence. Leave other civ defaults alone
  // until their own rosters/doctrines are audited.
  athensMeleeShare: 0.58,
  athensMarineShareOfMelee: 0.30,
  cityStateMeleeShare: 0.67,
  genericMeleeShare: 0.50,
  costs: Object.freeze({
    house: { wood: 100 },
    storehouse: { wood: 100 },
    farmstead: { wood: 100 },
    field: { wood: 100 },
    barracks: { wood: 200 },
    market: { wood: 200, stone: 25, metal: 25 },
    forge: { wood: 200 },
    temple: { food: 50, wood: 200 }
  })
});

function mergePolicy(overrides = {}) {
  return {
    ...DEFAULT_POLICY,
    ...overrides,
    costs: {
      ...DEFAULT_POLICY.costs,
      ...(overrides.costs || {})
    }
  };
}

export { DEFAULT_POLICY, mergePolicy };
