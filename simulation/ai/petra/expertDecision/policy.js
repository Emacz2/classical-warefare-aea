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
  houseMaximumMilitaryHeadroom: 24,
  houseSurplusPrebuildWood: 800,
  houseSurplusExtraHeadroom: 12,
  // Replay-derived Athens opening sequence:
  // starting 4 civilians -> food; first trained batch of 3 -> wood;
  // second trained batch of 3 -> food; then wood until 20 civilian woodcutters.
  startingNaturalFoodCivilians: 4,
  firstTrainedWoodCivilians: 3,
  secondTrainedFoodCivilians: 3,
  openingNaturalFoodCivilians: 7,
  targetWoodCivilians: 20,
  maxConcurrentBuilders: 6,
  maxConcurrentFieldTasks: 3,
  civilianCap: 75,
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
  // The CC stays on civilians until the 75-civilian cap; barracks carry military production.
  ccOpeningSoldierStartTime: 99999,
  ccSecondEmergencySoldierTime: 99999,
  barracksReserveTime: 135,
  barracksTargetTime: 150,
  barracksHardDeadline: 180,
  farmPrepareRatio: 0.35,
  farmTransitionRatio: 0.25,
  naturalFoodExpansionRatio: 0.25,
  minimumAlternativeNaturalFood: 120,
  foodSiteMinimumCommitSeconds: 20,
  naturalFoodDropsiteComfortDistance: 15,
  naturalFoodFarmsteadIdealDistance: 5,
  naturalFoodFarmsteadAssumedWalkSpeed: 8,
  naturalFoodFarmsteadCarryCapacity: 10,
  naturalFoodFarmsteadPaybackWorkerSeconds: 120,
  fieldTransitionLeadSeconds: 55,
  naturalFoodRunwaySafetySeconds: 45,
  farmersPerField: 3,
  fieldsPerFarmstead: 6,
  minimumFarmHubFieldSlots: 4,
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
  resourceBalanceStartTime: 210,
  resourceBalanceActivationBank: 1000,
  resourceBalanceRatioFloor: 250,
  resourceBalanceNewWorkerRatio: 1.5,
  resourceBalanceStrongRatio: 3.0,
  resourceBalanceFoodPriorityBank: 700,
  resourceBalanceReassignBatch: 1,
  resourceBalanceReassignCooldownSeconds: 20,
  resourceBalanceExtremeRatio: 4.0,
  resourceBalanceExtremeBatch: 2,
  resourceBalanceExtremeCooldownSeconds: 15,
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
  phase2PreferredFields: 8,
  phase2LateMinimumFields: 7,
  phase2ExceptionalCostCoverage: 0.80,
  phase2NormalCostCoverage: 0.45,
  phase2MajorThreatUnits: 12,
  phase2MajorThreatRadius: 150,
  // Expert defense doctrine: large incoming forces trigger a deliberate retreat to the
  // base, full-army assembly, and only then a coordinated counterattack. Towers are
  // emergency force multipliers, never routine border spam.
  defenseThreatMinimumUnits: 12,
  defenseAwarenessRadius: 190,
  defenseAutomaticDangerRadius: 115,
  defenseApproachImprovement: 18,
  defenseAssemblyRadius: 24,
  defenseAssemblyFraction: 0.78,
  defenseAssemblyMaxWaitSeconds: 35,
  defenseImmediateEngageRadius: 32,
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
  woodMigrationBatch: 4,
  woodMigrationWindowSeconds: 12,
  woodMigrationSalvageRadius: 52,
  // Post-opening civilians are assigned once, then left alone. New workers repair
  // resource imbalance instead of yanking established farmers off fields.
  postOpeningFoodFloor: 300,
  postOpeningWoodFloor: 180,
  postOpeningFoodWoodRatioForWood: 2.0,
  // 20 is the opening civilian wood target, not a lifetime ceiling. Once food is
  // clearly solved, NEW civilians may reinforce wood if the bank is actually low.
  maxDynamicWoodCivilians: 28,
  dynamicWoodShortageBank: 350,
  foodSurplusRedirectThreshold: 900,
  foodSurplusPauseFarmExpansion: 1000,
  // Permanent-food floors: natural food and a temporary food bank may delay expansion,
  // but they may not collapse the long-term farm economy below these population-scaled floors.
  fieldFloorSixPopulation: 70,
  fieldFloorEightPopulation: 90,
  fieldFloorTenPopulation: 120,
  fieldFloorTwelvePopulation: 150,
  // Do not open generic mines until the permanent food economy has at least six completed fields.
  miningMinimumCompletedFields: 6,
  miningStartCivilians: 45,
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
  houseMinimumCCDistance: 24,
  barracksMinimumCCDistance: 28,
  farmHubMinimumCCDistance: 40,
  storehouseMinimumCCDistance: 18,
  // A forest is a work district, not a one-storehouse resource. When the cutting front
  // recedes, deepen the same patch before abandoning it for a different forest.
  woodSamePatchRadius: 90,
  woodSamePatchMinimumRemaining: 900,
  woodStorehouseMinimumSpacing: 18,
  ecoTechFoodReserve: 600,
  ecoTechWoodReserve: 300,
  ecoTechSurplusFood: 900,
  ecoTechSurplusWood: 500,
  cityStateMeleeShare: 0.67,
  genericMeleeShare: 0.50,
  costs: Object.freeze({
    house: { wood: 100 },
    storehouse: { wood: 100 },
    farmstead: { wood: 100 },
    field: { wood: 100 },
    barracks: { wood: 200 }
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
