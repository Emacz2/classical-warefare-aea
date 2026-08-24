const DEFAULT_POLICY = Object.freeze({
  houseTriggerFreePopulation: 8,
  houseEmergencyFreePopulation: 3,
  farmPrepareRatio: 0.35,
  farmTransitionRatio: 0.25,
  farmersPerField: 5,
  fieldsPerFarmstead: 4,
  minimumTransitionFields: 2,
  localWoodHealthyAmount: 600,
  localWoodCriticalAmount: 220,
  targetWoodDropDistance: 30,
  requiredLowWoodObservations: 3,
  woodWorksiteRadius: 30,
  firstBarracksPopulation: 30,
  minimumFieldsBeforeBarracks: 2,
  secondBarracksPopulation: 75,
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
