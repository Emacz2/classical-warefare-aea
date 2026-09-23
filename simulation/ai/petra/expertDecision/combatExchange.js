function observedEnemyCombat(playersData, targetPlayer) {
  const data = playersData && playersData[targetPlayer];
  const counts = data && data.classCounts;
  if (!counts)
    return undefined;
  const soldiers = Math.max(0, Number(counts.Soldier) || 0);
  const siege = Math.max(0, Number(counts.Siege) || 0);
  return soldiers + siege;
}

function catastrophicCombatExchange(observation, policy = {}) {
  const losses = Math.max(0, Number(observation.rawLosses) || 0);
  const launch = Math.max(1, Number(observation.launchSize) || 1);
  const army = Math.max(0, Number(observation.armySize) || 0);
  const enemyDamage = Math.max(0, Number(observation.enemyDamage) || 0);
  const globalEnemy = Number(observation.globalEnemyCombat);
  const minimumLosses = Math.max(Number(policy.expertCombatCatastrophicMinimumOwnLosses) || 20,
    Math.ceil(launch * (Number(policy.expertCombatCatastrophicLossFraction) || 0.25)));
  const poorExchange = enemyDamage < losses *
    (Number(policy.expertCombatCatastrophicEnemyDamageCredit) || 0.35);
  const globalThreat = Number.isFinite(globalEnemy) ?
    globalEnemy >= Math.max(Number(policy.expertCombatCatastrophicMinimumEnemyCombat) || 12,
      Math.ceil(army * (Number(policy.expertCombatCatastrophicGlobalThreatRatio) || 0.35))) : true;
  return losses >= minimumLosses && poorExchange && globalThreat;
}

function requiredGlobalAttackers(knownEnemyCombat, attackType, rushType, policy = {}) {
  const known = Math.max(0, Number(knownEnemyCombat) || 0);
  if (attackType === rushType)
    return Math.min(24, Math.ceil(known * Math.max(1,
      Number(policy.expertP1TimingKnownArmyRatio) || 1.05)));
  return Math.ceil(known * Math.max(1,
    Number(policy.expertP2GlobalArmyAdvantageRatio) || 1.05));
}

export { observedEnemyCombat, catastrophicCombatExchange, requiredGlobalAttackers };
