// IT14.46 strategic doctrine layer.
// A doctrine is selected once per match and then serialized by the Expert controller.
// The goal is not to hard-code one perfect build, but to let the same mechanical
// economy execute several coherent timings without changing difficulty bonuses.

const DOCTRINES = Object.freeze({
  EARLY_P1_RUSH: Object.freeze({
    id: "early_p1_rush",
    label: "Early P1 Rush",
    weight: 0.20,
    softCivilianCap: 42,
    softCapUntil: 390,
    soldierTrainingStartTime: 105,
    rushes: 1,
    rushSize: 20,
    p1EcoSweepBeforeP2: false,
    policy: Object.freeze({
      barracksReserveTime: 90,
      barracksTargetTime: 105,
      barracksHardDeadline: 125,
      secondBarracksReserveTime: 190,
      secondBarracksTargetTime: 210,
      secondBarracksHardDeadline: 235,
      phase2ExceptionalTime: 465,
      phase2NormalTime: 495,
      phase2MatureTime: 525,
      phase2AbsoluteTime: 510,
      phase2LateTime: 600
    })
  }),
  LATE_P1_RUSH: Object.freeze({
    id: "late_p1_rush",
    label: "Late P1 Timing Rush",
    weight: 0.25,
    softCivilianCap: 55,
    softCapUntil: 450,
    soldierTrainingStartTime: 135,
    rushes: 1,
    rushSize: 28,
    p1EcoSweepBeforeP2: false,
    policy: Object.freeze({
      barracksReserveTime: 115,
      barracksTargetTime: 135,
      barracksHardDeadline: 155,
      secondBarracksReserveTime: 205,
      secondBarracksTargetTime: 225,
      secondBarracksHardDeadline: 245,
      phase2ExceptionalTime: 435,
      phase2NormalTime: 465,
      phase2MatureTime: 510,
      phase2AbsoluteTime: 465,
      phase2LateTime: 570
    })
  }),
  P2_TECH_PUSH: Object.freeze({
    id: "p2_tech_push",
    label: "P2 Forge-Tech Push",
    weight: 0.55,
    softCivilianCap: 70,
    softCapUntil: 0,
    soldierTrainingStartTime: 150,
    rushes: 0,
    rushSize: 0,
    p1EcoSweepBeforeP2: true,
    policy: Object.freeze({})
  })
});

const ORDER = Object.freeze([
  DOCTRINES.EARLY_P1_RUSH,
  DOCTRINES.LATE_P1_RUSH,
  DOCTRINES.P2_TECH_PUSH
]);

function chooseDoctrine(randomValue)
{
  let r = Number(randomValue);
  if (!Number.isFinite(r))
    r = 0.5;
  r = Math.max(0, Math.min(0.999999, r));
  let total = ORDER.reduce((sum, d) => sum + Math.max(0, Number(d.weight) || 0), 0);
  let cursor = r * Math.max(0.0001, total);
  for (const doctrine of ORDER)
  {
    cursor -= Math.max(0, Number(doctrine.weight) || 0);
    if (cursor < 0)
      return doctrine;
  }
  return DOCTRINES.P2_TECH_PUSH;
}

function doctrineById(id)
{
  return ORDER.find(d => d.id === id) || DOCTRINES.P2_TECH_PUSH;
}

function policyOverridesForDoctrine(doctrine, time = 0)
{
  const d = doctrineById(doctrine && doctrine.id || doctrine);
  const now = Math.max(0, Number(time) || 0);
  const civilianCap = d.softCapUntil > 0 && now < d.softCapUntil ? d.softCivilianCap : 70;
  return {
    ...d.policy,
    civilianCap,
    soldierTrainingStartTime: d.soldierTrainingStartTime
  };
}

export { DOCTRINES, chooseDoctrine, doctrineById, policyOverridesForDoctrine };
