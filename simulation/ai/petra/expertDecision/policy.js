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
  maxConcurrentFieldTasks: 2,
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
  woodExpansionAmount: 550,
  woodExpansionWorkerThreshold: 12,
  targetWoodDropDistance: 30,
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
  // Post-opening bank governor.  A 1k+ resource is allowed, but once it is far richer
  // than the weak side of the bank, new flexible workers reinforce the deficit.
  // Severe imbalance peels only two established flexible workers at a time.
  resourceBalanceStartTime: 210,
  resourceBalanceActivationBank: 1000,
  resourceBalanceRatioFloor: 250,
  resourceBalanceNewWorkerRatio: 1.5,
  resourceBalanceStrongRatio: 3.0,
  resourceBalanceFoodPriorityBank: 700,
  resourceBalanceReassignBatch: 2,
  resourceBalanceReassignCooldownSeconds: 12,
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
  miningStartCivilians: 45,
  miningFoodFloor: 750,
  miningWoodFloor: 300,
  miningTargetStoneWorkers: 6,
  miningTargetMetalWorkers: 6,
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
