import * as filters from "simulation/ai/common-api/filters.js";
import { aiWarn, SquareVectorDistance, VectorDistance } from "simulation/ai/common-api/utils.js";
import { AttackPlan } from "simulation/ai/petra/attackPlan.js";
import * as chat from "simulation/ai/petra/chatHelper.js";
import { Config } from "simulation/ai/petra/config.js";
import * as difficulty from "simulation/ai/petra/difficultyLevel.js";
import { allowCapture, getLandAccess } from "simulation/ai/petra/entityExtend.js";
import { mergePolicy } from "simulation/ai/petra/expertDecision/policy.js";
import { Worker } from "simulation/ai/petra/worker.js";

export function AttackManager(config)
{
	this.Config = config;

	this.totalNumber = 0;
	this.attackNumber = 0;
	this.rushNumber = 0;
	this.raidNumber = 0;
	this.upcomingAttacks = {
		[AttackPlan.TYPE_RUSH]: [],
		[AttackPlan.TYPE_RAID]: [],
		[AttackPlan.TYPE_DEFAULT]: [],
		[AttackPlan.TYPE_HUGE_ATTACK]: []
	};
	this.startedAttacks = {
		[AttackPlan.TYPE_RUSH]: [],
		[AttackPlan.TYPE_RAID]: [],
		[AttackPlan.TYPE_DEFAULT]: [],
		[AttackPlan.TYPE_HUGE_ATTACK]: []
	};
	this.bombingAttacks = new Map();// Temporary attacks for siege units while waiting their current attack to start
	this.debugTime = 0;
	this.maxRushes = 0;
	this.rushSize = [];
	this.currentEnemyPlayer = undefined; // enemy player we are currently targeting
	this.defeated = {};
	// IT14.42: remember the P2 military upgrades Expert has actually queued so an
	// ordinary Town-phase attack can wait for a small force-multiplier package.
	// This is deliberately observation-only: the research controller still chooses
	// the technologies and pays their full cost.
	this.expertObservedMilitaryTechs = {};
	this.expertLastTechGateLog = 0;
	// IT14.43 finish watchdog: population/target progress, not army size, drives cleanup.
	this.expertFinishingProgress = undefined;
	// IT14.44: after a depleted push retreats, give the economy/production a short
	// reboom window before Petra immediately assembles another understrength wave.
	this.expertReboomUntil = -99999;
}

/** More initialisation for stuff that needs the gameState */
AttackManager.prototype.init = function(gameState)
{
	this.outOfPlan = gameState.getOwnUnits().filter(filters.byMetadata(PlayerID, "plan", -1));
	this.outOfPlan.registerUpdates();
};

AttackManager.prototype.setRushes = function(allowed)
{
	if (this.Config.personality.aggressive > this.Config.personalityCut.strong && allowed > 2)
	{
		this.maxRushes = 3;
		this.rushSize = [ 16, 20, 24 ];
	}
	else if (this.Config.personality.aggressive > this.Config.personalityCut.medium && allowed > 1)
	{
		this.maxRushes = 2;
		this.rushSize = [ 18, 22 ];
	}
	else if (this.Config.personality.aggressive > this.Config.personalityCut.weak && allowed > 0)
	{
		this.maxRushes = 1;
		this.rushSize = [ 20 ];
	}
};

AttackManager.prototype.checkEvents = function(gameState, events)
{
	for (const evt of events.PlayerDefeated)
		this.defeated[evt.playerId] = true;

	let answer = "decline";
	let other;
	let targetPlayer;
	for (const evt of events.AttackRequest)
	{
		if (evt.source === PlayerID || !gameState.isPlayerAlly(evt.source) || !gameState.isPlayerEnemy(evt.player))
			continue;
		targetPlayer = evt.player;
		let available = 0;
		for (const attackType in this.upcomingAttacks)
		{
			for (const attack of this.upcomingAttacks[attackType])
			{
				if (attack.state === AttackPlan.STATE_COMPLETING)
				{
					if (attack.targetPlayer === targetPlayer)
						available += attack.unitCollection.length;
					else if (attack.targetPlayer !== undefined && attack.targetPlayer !== targetPlayer)
						other = attack.targetPlayer;
					continue;
				}

				attack.targetPlayer = targetPlayer;

				if (attack.unitCollection.length > 2)
					available += attack.unitCollection.length;
			}
		}

		if (available > 12)	// launch the attack immediately
		{
			for (const attackType in this.upcomingAttacks)
			{
				for (const attack of this.upcomingAttacks[attackType])
				{
					if (attack.state === AttackPlan.STATE_COMPLETING ||
						attack.targetPlayer !== targetPlayer ||
						attack.unitCollection.length < 3)
						continue;
					attack.forceStart();
					attack.requested = true;
				}
			}
			answer = "join";
		}
		else if (other !== undefined)
			answer = "other";
		break;  // take only the first attack request into account
	}
	if (targetPlayer !== undefined)
		chat.answerRequestAttack(gameState, targetPlayer, answer, other);

	for (const evt of events.EntityRenamed)	// take care of packing units in bombing attacks
	{
		for (const [targetId, unitIds] of this.bombingAttacks)
		{
			if (targetId == evt.entity)
			{
				this.bombingAttacks.set(evt.newentity, unitIds);
				this.bombingAttacks.delete(evt.entity);
			}
			else if (unitIds.has(evt.entity))
			{
				unitIds.add(evt.newentity);
				unitIds.delete(evt.entity);
			}
		}
	}
};

/**
 * Check for any structure in range from within our territory, and bomb it
 */
AttackManager.prototype.assignBombers = function(gameState)
{
	// First some cleaning of current bombing attacks
	for (const [targetId, unitIds] of this.bombingAttacks)
	{
		const target = gameState.getEntityById(targetId);
		if (!target || !gameState.isPlayerEnemy(target.owner()))
			this.bombingAttacks.delete(targetId);
		else
		{
			for (const entId of unitIds.values())
			{
				const ent = gameState.getEntityById(entId);
				if (ent && ent.owner() == PlayerID)
				{
					const plan = ent.getMetadata(PlayerID, "plan");
					const orders = ent.unitAIOrderData();
					const lastOrder = orders && orders.length ? orders[orders.length-1] : null;
					if (lastOrder && lastOrder.target && lastOrder.target == targetId && plan != -2 && plan != -3)
						continue;
				}
				unitIds.delete(entId);
			}
			if (!unitIds.size)
				this.bombingAttacks.delete(targetId);
		}
	}

	const bombers = gameState.updatingCollection("bombers",
		filters.byClasses(["BoltShooter", "StoneThrower"]), gameState.getOwnUnits());
	for (const ent of bombers.values())
	{
		if (!ent.position() || !ent.isIdle() || !ent.attackRange("Ranged"))
			continue;
		if (ent.getMetadata(PlayerID, "plan") == -2 || ent.getMetadata(PlayerID, "plan") == -3)
			continue;
		if (ent.getMetadata(PlayerID, "plan") !== undefined && ent.getMetadata(PlayerID, "plan") != -1)
		{
			const subrole = ent.getMetadata(PlayerID, "subrole");
			if (subrole && (subrole === Worker.SUBROLE_COMPLETING ||
				subrole === Worker.SUBROLE_WALKING || subrole === Worker.SUBROLE_ATTACKING))
				continue;
		}
		let alreadyBombing = false;
		for (const unitIds of this.bombingAttacks.values())
		{
			if (!unitIds.has(ent.id()))
				continue;
			alreadyBombing = true;
			break;
		}
		if (alreadyBombing)
			break;

		const range = ent.attackRange("Ranged").max;
		const entPos = ent.position();
		const access = getLandAccess(gameState, ent);
		for (const struct of gameState.getEnemyStructures().values())
		{
			if (!ent.canAttackTarget(struct, allowCapture(gameState, ent, struct)))
				continue;

			const structPos = struct.position();
			let x;
			let z;
			if (struct.hasClass("Field"))
			{
				if (!struct.resourceSupplyNumGatherers() ||
				    !gameState.isPlayerEnemy(gameState.ai.HQ.territoryMap.getOwner(structPos)))
					continue;
			}
			const dist = VectorDistance(entPos, structPos);
			if (dist > range)
			{
				const safety = struct.footprintRadius() + 30;
				x = structPos[0] + (entPos[0] - structPos[0]) * safety / dist;
				z = structPos[1] + (entPos[1] - structPos[1]) * safety / dist;
				const owner = gameState.ai.HQ.territoryMap.getOwner([x, z]);
				if (owner != 0 && gameState.isPlayerEnemy(owner))
					continue;
				x = structPos[0] + (entPos[0] - structPos[0]) * range / dist;
				z = structPos[1] + (entPos[1] - structPos[1]) * range / dist;
				if (gameState.ai.HQ.territoryMap.getOwner([x, z]) != PlayerID ||
				    gameState.ai.accessibility.getAccessValue([x, z]) != access)
					continue;
			}
			let attackingUnits;
			for (const [targetId, unitIds] of this.bombingAttacks)
			{
				if (targetId != struct.id())
					continue;
				attackingUnits = unitIds;
				break;
			}
			if (attackingUnits && attackingUnits.size > 4)
				continue;	// already enough units against that target
			if (!attackingUnits)
			{
				attackingUnits = new Set();
				this.bombingAttacks.set(struct.id(), attackingUnits);
			}
			attackingUnits.add(ent.id());
			if (dist > range)
				ent.move(x, z);
			ent.attack(struct.id(), false, dist > range);
			break;
		}
	}
};

/**
 * Some functions are run every turn
 * Others once in a while
 */

// IT14.41 finishing mode: once an enemy has been driven below 50 population and
// Expert still has a healthy lead, preserve pressure instead of restarting the normal
// full-wave cycle. This uses only units/resources Expert actually owns.
AttackManager.prototype.getExpertFinishingTarget = function(gameState)
{
	if (this.Config.difficulty < difficulty.EXPERT)
		return undefined;
	let targetPlayer;
	let enemyPopulation = Infinity;
	for (let i = 1; i < gameState.sharedScript.playersData.length; ++i)
	{
		if (!gameState.isPlayerEnemy(i))
			continue;
		const data = gameState.sharedScript.playersData[i];
		if (!data || data.state === "defeated")
			continue;
		const pop = Math.max(0, Number(data.popCount) || 0);
		if (pop < enemyPopulation)
		{
			enemyPopulation = pop;
			targetPlayer = i;
		}
	}
	const ownPopulation = Math.max(0, Number(gameState.getPopulation()) || 0);
	if (!Number.isFinite(enemyPopulation) || enemyPopulation <= 0 || enemyPopulation > 50 ||
	    ownPopulation < 80 || ownPopulation - enemyPopulation < 30)
		return undefined;
	return { targetPlayer, enemyPopulation, ownPopulation };
};

// Observe the dedicated Expert forge lanes while their plans are visible. Once a
// plan leaves the queue we still retain its technology name and can ask gameState
// whether research actually completed. This avoids hard-coding civ-specific techs.
AttackManager.prototype.observeExpertMilitaryTechs = function(gameState, queues)
{
	if (this.Config.difficulty < difficulty.EXPERT)
		return;
	if (!this.expertObservedMilitaryTechs)
		this.expertObservedMilitaryTechs = {};
	const sourceQueues = gameState.ai && gameState.ai.queues ? gameState.ai.queues : queues;
	if (!sourceQueues)
		return;
	for (const name of ["expertMilitaryTech1", "expertMilitaryTech2"])
	{
		const queue = sourceQueues[name];
		if (!queue || !queue.plans)
			continue;
		for (const plan of queue.plans)
			if (plan && plan.type)
				this.expertObservedMilitaryTechs[plan.type] = true;
	}
};

// P1 timing attacks remain legal: if the army is ready while Town Phase is still
// researching, Expert may hit immediately and try to exploit numbers/surprise.
// Once Town Phase is actually complete, however, a normal/huge attack waits until
// two dedicated P2 military upgrades have FINISHED. Finishing mode bypasses this
// gate because an already-broken opponent should be closed out immediately.
AttackManager.prototype.getExpertP2AttackTechGate = function(gameState)
{
	if (this.Config.difficulty < difficulty.EXPERT || !gameState.currentPhase || gameState.currentPhase() !== 2)
		return { ready: true, completed: 0, required: 0 };
	if (this.getExpertFinishingTarget(gameState))
		return { ready: true, completed: 0, required: 0, finishing: true };
	const policy = mergePolicy();
	const required = Math.max(0, Number(policy.expertP2AttackRequiredMilitaryTechs) || 0);
	if (!required)
		return { ready: true, completed: 0, required: 0 };
	let completed = 0;
	for (const name of Object.keys(this.expertObservedMilitaryTechs || {}))
		if (gameState.isResearched && gameState.isResearched(name))
			++completed;
	return { ready: completed >= required, completed, required };
};

AttackManager.prototype.reinforceExpertFinishingAttack = function(gameState, finishing)
{
	if (!finishing || gameState.ai.playedTurn % 5 !== 0)
		return 0;
	let attack;
	for (const type of [AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK, AttackPlan.TYPE_RUSH, AttackPlan.TYPE_RAID])
		for (const plan of this.startedAttacks[type])
			if (plan.targetPlayer === finishing.targetPlayer && (!attack || plan.unitCollection.length > attack.unitCollection.length))
				attack = plan;
	if (!attack)
		return 0;

	const citizen = [];
	const siege = [];
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position() || ent.attackTypes() === undefined ||
		    ent.getMetadata(PlayerID, "expertDecisionTaskId") !== undefined ||
		    ent.getMetadata(PlayerID, "expertDefenseMobilized") !== undefined ||
		    ent.getMetadata(PlayerID, "garrisonHolder") !== undefined ||
		    ent.getMetadata(PlayerID, "transport") !== undefined || ent.getMetadata(PlayerID, "transporter") !== undefined)
			continue;
		const plan = ent.getMetadata(PlayerID, "plan");
		if (plan !== undefined && plan !== -1)
			continue;
		if (ent.hasClass("Siege"))
			siege.push(ent);
		else if (ent.hasClass("CitizenSoldier") && !ent.hasClass("Cavalry"))
			citizen.push(ent);
	}
	const policy = mergePolicy();
	const reserve = Math.max(0, Number(policy.expertFinishingHomeCitizenSoldierReserve) || 12);
	const desiredArmy = Math.max(Number(policy.expertFinishingMinimumArmy) || 36,
		Math.min(Number(policy.expertFinishingMaximumArmy) || 50, Math.ceil(finishing.enemyPopulation * (Number(policy.expertFinishingArmyPerEnemy) || 3))));
	if (attack.unitCollection.length >= desiredArmy)
		return 0;
	const availableCitizens = Math.max(0, citizen.length - reserve);
	const rally = attack.position && Number.isFinite(attack.position[0]) && Number.isFinite(attack.position[1]) &&
		(attack.position[0] !== 0 || attack.position[1] !== 0) ? attack.position : attack.targetPos;
	if (rally && Number.isFinite(rally[0]) && Number.isFinite(rally[1]))
		citizen.sort((a, b) => SquareVectorDistance(a.position(), rally) - SquareVectorDistance(b.position(), rally) || a.id() - b.id());
	else
		citizen.sort((a, b) => a.id() - b.id());
	siege.sort((a, b) => a.id() - b.id());
	const room = Math.max(0, desiredArmy - attack.unitCollection.length);
	const batch = Math.min(room, Math.max(1, Number(policy.expertFinishingReinforcementBatch) || 6));
	const selectedSiege = siege.slice(0, Math.min(2, batch));
	const selected = [...selectedSiege, ...citizen.slice(0, Math.min(batch - selectedSiege.length, availableCitizens))];
	let added = 0;
	for (const ent of selected)
		if (attack.addExpertReinforcement && attack.addExpertReinforcement(gameState, ent))
			++added;
	if (added)
		aiWarn("[EXPERT-FINISH] reinforced plan=" + attack.name + " added=" + added + " army=" + attack.unitCollection.length +
			" enemyPop=" + finishing.enemyPopulation + " targetArmy=" + desiredArmy + " homeCitizenReserve=" + reserve);
	return added;
};

AttackManager.prototype.expertFinishingTargetProgress = function(attack)
{
	if (!attack || !attack.target)
		return { targetId: undefined, health: 1, capture: 0 };
	let capture = 0;
	if (attack.target.capturePoints)
	{
		const points = attack.target.capturePoints();
		if (Array.isArray(points)) capture = Number(points[PlayerID]) || 0;
	}
	return {
		targetId: attack.target.id(),
		health: attack.target.healthLevel ? Number(attack.target.healthLevel()) || 0 : 1,
		capture
	};
};

AttackManager.prototype.updateExpertFinishingProgress = function(gameState, finishing)
{
	if (!finishing) { this.expertFinishingProgress = undefined; return; }
	const now = Number(gameState.ai.elapsedTime) || 0;
	let attack;
	for (const type of [AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK, AttackPlan.TYPE_RUSH, AttackPlan.TYPE_RAID])
		for (const plan of this.startedAttacks[type])
			if (plan.targetPlayer === finishing.targetPlayer && (!attack || plan.unitCollection.length > attack.unitCollection.length)) attack = plan;
	const metric = this.expertFinishingTargetProgress(attack);
	let progress = this.expertFinishingProgress;
	if (!progress || progress.targetPlayer !== finishing.targetPlayer)
	{
		// Immediately point cleanup at the strategic objective (normally the CC) rather
		// than waiting 45 seconds for the first watchdog cycle.
		if (attack && attack.forceExpertFinishingRetarget)
			attack.forceExpertFinishingRetarget(gameState);
		const initialMetric = this.expertFinishingTargetProgress(attack);
		this.expertFinishingProgress = { targetPlayer: finishing.targetPlayer, enemyPop: finishing.enemyPopulation,
			targetId: initialMetric.targetId, health: initialMetric.health, capture: initialMetric.capture, lastProgressTime: now, lastRetargetTime: now };
		return;
	}
	const advanced = finishing.enemyPopulation < progress.enemyPop || metric.targetId !== progress.targetId ||
		metric.health < progress.health - 0.015 || metric.capture > progress.capture + 5;
	if (advanced)
		progress.lastProgressTime = now;
	progress.enemyPop = finishing.enemyPopulation; progress.targetId = metric.targetId; progress.health = metric.health; progress.capture = metric.capture;
	const policy = mergePolicy();
	if (!attack || now - progress.lastProgressTime < policy.expertFinishingStallSeconds ||
		now - progress.lastRetargetTime < policy.expertFinishingRetargetCooldownSeconds)
		return;
	progress.lastRetargetTime = now;
	progress.lastProgressTime = now;
	const changed = attack.forceExpertFinishingRetarget ? attack.forceExpertFinishingRetarget(gameState) : false;
	aiWarn("[EXPERT-FINISH] watchdog plan=" + attack.name + " army=" + attack.unitCollection.length + " enemyPop=" + finishing.enemyPopulation +
		" retarget=" + (changed ? "changed" : "reissued"));
};

AttackManager.prototype.expertWoundedHomePosition = function(gameState, from)
{
	let best;
	let bestDist = Infinity;
	for (const ent of gameState.getOwnStructures().values())
	{
		if (!ent || !ent.position() || !ent.hasClass("CivCentre"))
			continue;
		const dist = from ? SquareVectorDistance(from, ent.position()) : 0;
		if (dist < bestDist)
		{
			bestDist = dist;
			best = ent.position();
		}
	}
	if (best)
		return best;
	for (const ent of gameState.getOwnStructures().values())
	{
		if (!ent || !ent.position())
			continue;
		const dist = from ? SquareVectorDistance(from, ent.position()) : 0;
		if (dist < bestDist)
		{
			bestDist = dist;
			best = ent.position();
		}
	}
	return best;
};

// IT14.45: preserve wounded veterans instead of leaving every damaged soldier in the
// grinder until the entire attack qualifies for a retreat.  Units below the health
// threshold leave the plan, run home, and become normal economic workers once they
// reach friendly territory.  The attack records a replacement demand for fresh troops.
AttackManager.prototype.peelExpertWoundedUnits = function(gameState, attack)
{
	if (this.Config.difficulty < difficulty.EXPERT || !attack || !attack.isStarted() ||
	    gameState.ai.playedTurn % 5 !== 0)
		return 0;
	const policy = mergePolicy();
	const threshold = Math.max(0.05, Math.min(0.9, Number(policy.expertWoundedRetreatHealth) || 0.25));
	const candidates = [];
	for (const ent of attack.unitCollection.values())
	{
		if (!ent || !ent.position() || !ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry") ||
		    ent.hasClass("Siege") || !ent.healthLevel || ent.healthLevel() > threshold)
			continue;
		candidates.push(ent);
	}
	if (!candidates.length)
		return 0;
	candidates.sort((a, b) => a.healthLevel() - b.healthLevel() || a.id() - b.id());
	const batch = Math.max(1, Number(policy.expertWoundedRetreatBatch) || 6);
	const now = Number(gameState.ai.elapsedTime) || 0;
	let peeled = 0;
	for (const ent of candidates.slice(0, batch))
	{
		const pos = ent.position();
		const home = this.expertWoundedHomePosition(gameState, pos);
		if (!home)
			continue;
		attack.removeUnit(ent, true);
		ent.setMetadata(PlayerID, "expertWoundedReturnUntil", now + (Number(policy.expertWoundedReturnSeconds) || 90));
		ent.setMetadata(PlayerID, "expertWoundedFromPlan", attack.name);
		ent.moveToRange(home[0], home[1], 0, 20);
		++peeled;
	}
	if (peeled)
	{
		attack.expertWoundedReplacementDemand = Math.max(0, Number(attack.expertWoundedReplacementDemand) || 0) + peeled;
		aiWarn("[EXPERT-WOUNDED] peel plan=" + attack.name + " units=" + peeled +
			" army=" + attack.unitCollection.length + " replace=" + attack.expertWoundedReplacementDemand);
	}
	return peeled;
};

AttackManager.prototype.reinforceExpertWoundedReplacements = function(gameState, attack)
{
	if (this.Config.difficulty < difficulty.EXPERT || !attack || !attack.isStarted() ||
	    gameState.ai.playedTurn % 5 !== 0 || !(Number(attack.expertWoundedReplacementDemand) > 0))
		return 0;
	const policy = mergePolicy();
	const reserve = Math.max(0, Number(policy.expertWoundedReplacementHomeReserve) || 12);
	const candidates = [];
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position() || !ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry") || ent.hasClass("Siege") ||
		    !ent.healthLevel || ent.healthLevel() < 0.75 || ent.getMetadata(PlayerID, "expertWoundedReturnUntil") !== undefined ||
		    ent.getMetadata(PlayerID, "expertDecisionTaskId") !== undefined || ent.getMetadata(PlayerID, "expertDefenseMobilized") !== undefined ||
		    ent.getMetadata(PlayerID, "garrisonHolder") !== undefined)
			continue;
		const plan = ent.getMetadata(PlayerID, "plan");
		if (plan !== undefined && plan !== -1)
			continue;
		candidates.push(ent);
	}
	const available = Math.max(0, candidates.length - reserve);
	if (!available)
		return 0;
	const rally = attack.position && Number.isFinite(attack.position[0]) ? attack.position : attack.targetPos;
	candidates.sort((a, b) => {
		const da = rally ? SquareVectorDistance(a.position(), rally) : 0;
		const db = rally ? SquareVectorDistance(b.position(), rally) : 0;
		return da - db || b.healthLevel() - a.healthLevel() || a.id() - b.id();
	});
	const batch = Math.min(available, Math.max(1, Number(policy.expertWoundedReplacementBatch) || 4),
		Math.max(0, Number(attack.expertWoundedReplacementDemand) || 0));
	let added = 0;
	for (const ent of candidates.slice(0, batch))
		if (attack.addExpertReinforcement && attack.addExpertReinforcement(gameState, ent))
			++added;
	if (added)
	{
		attack.expertWoundedReplacementDemand = Math.max(0, attack.expertWoundedReplacementDemand - added);
		aiWarn("[EXPERT-WOUNDED] replace plan=" + attack.name + " added=" + added +
			" remaining=" + attack.expertWoundedReplacementDemand + " army=" + attack.unitCollection.length);
	}
	return added;
};

// Attach newly-created siege to the largest active field army even before the opponent
// formally enters finishing mode.  This lets a P3 ram become part of the current push
// instead of waiting for a separate cleanup plan.
AttackManager.prototype.attachExpertSiegeToActiveAttack = function(gameState)
{
	if (this.Config.difficulty < difficulty.EXPERT || gameState.ai.playedTurn % 5 !== 0)
		return 0;
	let attack;
	for (const type of [AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK, AttackPlan.TYPE_RUSH, AttackPlan.TYPE_RAID])
		for (const plan of this.startedAttacks[type])
			if (plan && plan.targetPlayer !== undefined && (!attack || plan.unitCollection.length > attack.unitCollection.length))
				attack = plan;
	if (!attack)
		return 0;
	let added = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (added >= 2 || !ent || !ent.position() || !ent.hasClass("Siege"))
			continue;
		const plan = ent.getMetadata(PlayerID, "plan");
		if (plan !== undefined && plan !== -1)
			continue;
		if (attack.addExpertReinforcement && attack.addExpertReinforcement(gameState, ent))
			++added;
	}
	if (added)
		aiWarn("[EXPERT-RAM] attached-siege plan=" + attack.name + " added=" + added + " army=" + attack.unitCollection.length);
	return added;
};

// GarrisonManager temporarily replaces attack-plan metadata while a passenger is in a
// holder.  Restore active-army passengers to their original attack after they unload.
AttackManager.prototype.recoverExpertRamPassengers = function(gameState)
{
	if (this.Config.difficulty < difficulty.EXPERT || gameState.ai.playedTurn % 5 !== 0)
		return;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position())
			continue;
		const originalPlan = ent.getMetadata(PlayerID, "expertRamAttackPlan");
		if (originalPlan === undefined || ent.getMetadata(PlayerID, "garrisonHolder") !== undefined)
			continue;
		const currentPlan = ent.getMetadata(PlayerID, "plan");
		if (currentPlan === -2 || currentPlan === -3)
			continue;
		const attack = this.getPlan(originalPlan);
		if (attack && attack.isStarted() && ent.healthLevel && ent.healthLevel() > mergePolicy().expertWoundedRetreatHealth &&
		    attack.addExpertReinforcement && attack.addExpertReinforcement(gameState, ent))
			aiWarn("[EXPERT-RAM] passenger-rejoined unit=" + ent.id() + " plan=" + originalPlan);
		ent.setMetadata(PlayerID, "expertRamAttackPlan", undefined);
	}
};

AttackManager.prototype.shouldExpertRetreatDepletedAttack = function(gameState, attack)
{
	if (this.Config.difficulty < difficulty.EXPERT || !attack || !attack.isStarted() ||
	    !gameState.currentPhase || gameState.currentPhase() < 2)
		return false;
	const policy = mergePolicy();
	if (attack.unitCollection.length > policy.expertDepletedAttackRetreatArmy || attack.hasSiegeUnits && attack.hasSiegeUnits())
		return false;
	const pos = attack.unitCollection && attack.unitCollection.getCentrePosition && attack.unitCollection.getCentrePosition() ||
		attack.position || attack.targetPos;
	if (!pos)
		return false;
	// IT14.45: do not rely only on territory ownership here.  A depleted army can sit
	// on a border cell while still being fully exposed to an enemy CC/tower/fortress;
	// proximity to a surviving defensive objective is enough evidence that continuing
	// the push will just donate the remaining units.
	const defendedRadius2 = Math.pow(Number(policy.expertDepletedAttackDefendedRadius) || 155, 2);
	const owner = gameState.ai.HQ.territoryMap.getOwner(pos);
	let defendedObjective = false;
	for (const struct of gameState.getEnemyStructures(attack.targetPlayer).values())
	{
		if (!struct || !struct.position())
			continue;
		if (!(struct.hasClass("CivCentre") || struct.hasClass("Fortress") || struct.hasClass("Tower") ||
		      struct.hasClass("WallTower") || struct.hasDefensiveFire && struct.hasDefensiveFire()))
			continue;
		if (owner === attack.targetPlayer || SquareVectorDistance(pos, struct.position()) <= defendedRadius2)
		{
			defendedObjective = true;
			break;
		}
	}
	return defendedObjective;
};

AttackManager.prototype.manageExpertRamGarrisons = function(gameState, finishing)
{
	if (this.Config.difficulty < difficulty.EXPERT || gameState.ai.playedTurn % 5 !== 0 ||
	    !gameState.ai.HQ.garrisonManager)
		return;
	const policy = mergePolicy();
	const defaultTargetPlayer = finishing && finishing.targetPlayer !== undefined ? finishing.targetPlayer : this.currentEnemyPlayer;
	const search2 = Math.pow(Number(policy.expertRamGarrisonSearchRadius) || 90, 2);
	const activeSearch2 = Math.pow(Number(policy.expertRamActiveArmySearchRadius) || 180, 2);
	const release2 = Math.pow(Number(policy.expertRamCavalryReleaseRadius) || 48, 2);

	for (const ram of gameState.getOwnUnits().values())
	{
		if (!ram || !ram.position() || !ram.hasClass("Siege") ||
		    !(ram.hasClass("Ram") || String(ram.genericName && ram.genericName() || "").toLowerCase().includes("ram")) ||
		    !ram.isGarrisonHolder || !ram.isGarrisonHolder())
			continue;

		const ramPlanId = ram.getMetadata(PlayerID, "plan");
		const ramAttack = ramPlanId !== undefined && ramPlanId !== -1 ? this.getPlan(ramPlanId) : undefined;
		const targetPlayer = ramAttack && ramAttack.targetPlayer !== undefined ? ramAttack.targetPlayer : defaultTargetPlayer;
		if (targetPlayer === undefined)
			continue;
		const enemyCavalry = [];
		for (const ent of gameState.getEnemyUnits(targetPlayer).values())
			if (ent && ent.position() && ent.hasClass("Cavalry"))
				enemyCavalry.push(ent);
		const preferSpears = enemyCavalry.length >= policy.expertRamCavalryThreatCount;

		// If cavalry is actually on top of the ram, unload spear passengers so they can
		// body-block/kill the horses instead of remaining hidden.  Passengers remember
		// their original attack plan and rejoin it on a later manager tick.
		let closeCavalry = false;
		for (const cav of enemyCavalry)
			if (SquareVectorDistance(cav.position(), ram.position()) <= release2)
			{
				closeCavalry = true;
				break;
			}
		if (closeCavalry)
		{
			let released = 0;
			for (const id of [...ram.garrisoned()])
			{
				const ent = gameState.getEntityById(id);
				if (!ent || !ent.hasClass("Spearman"))
					continue;
				ent.setMetadata(PlayerID, "garrisonType", undefined);
				ram.unload(id);
				++released;
			}
			if (released)
				aiWarn("[EXPERT-RAM] cavalry-threat ram=" + ram.id() + " released-spears=" + released);
			continue;
		}

		const occupied = gameState.ai.HQ.garrisonManager.numberOfGarrisonedSlots(ram);
		const wanted = Math.min(policy.expertRamGarrisonTarget, Math.max(0, ram.garrisonMax ? ram.garrisonMax() : 0));
		let room = wanted - occupied;
		if (room <= 0)
			continue;
		const candidates = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !ent.position() || !ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry") ||
			    ent.getMetadata(PlayerID, "garrisonHolder") !== undefined || !ent.canGarrison || !ent.canGarrison())
				continue;
			const entPlan = ent.getMetadata(PlayerID, "plan");
			const sameAttack = !!(ramAttack && entPlan === ramAttack.name);
			const free = entPlan === undefined || entPlan === -1;
			if (!sameAttack && !free)
				continue;
			const dist = SquareVectorDistance(ent.position(), ram.position());
			if (dist > (sameAttack ? activeSearch2 : search2))
				continue;
			const preferred = preferSpears ? ent.hasClass("Spearman") : ent.hasClass("Javelineer");
			if (!preferred)
				continue;
			// A modest same-army bonus means nearby reinforcements can still fill instantly,
			// but the field army is now a legitimate source instead of being categorically banned.
			candidates.push({ ent, sameAttack, score: dist - (sameAttack ? 2500 : 0) });
		}
		candidates.sort((a, b) => a.score - b.score || a.ent.id() - b.ent.id());
		let ordered = 0;
		let fromArmy = 0;
		for (const candidate of candidates)
		{
			if (room-- <= 0)
				break;
			const ent = candidate.ent;
			if (candidate.sameAttack && ramAttack)
			{
				ent.setMetadata(PlayerID, "expertRamAttackPlan", ramAttack.name);
				ramAttack.removeUnit(ent, true);
				++fromArmy;
			}
			gameState.ai.HQ.garrisonManager.garrison(gameState, ent, ram, "expert_ram");
			++ordered;
		}
		if (ordered)
			aiWarn("[EXPERT-RAM] garrison ram=" + ram.id() + " added=" + ordered + " fromArmy=" + fromArmy +
				" type=" + (preferSpears ? "spears" : "javelineers"));
	}
};

AttackManager.prototype.update = function(gameState, queues, events)
{
	if (this.Config.debug > 2 && gameState.ai.elapsedTime > this.debugTime + 60)
	{
		this.debugTime = gameState.ai.elapsedTime;
		aiWarn(" upcoming attacks =================");
		for (const attackType in this.upcomingAttacks)
		{
			for (const attack of this.upcomingAttacks[attackType])
			{
				aiWarn(" plan " + attack.name + " type " + attackType + " state " + attack.state +
					" units " + attack.unitCollection.length);
			}
		}
		aiWarn(" started attacks ==================");
		for (const attackType in this.startedAttacks)
		{
			for (const attack of this.startedAttacks[attackType])
			{
				aiWarn(" plan " + attack.name + " type " + attackType + " state " + attack.state +
					" units " + attack.unitCollection.length);
			}
		}
		aiWarn(" ==================================");
	}

	this.checkEvents(gameState, events);
	this.observeExpertMilitaryTechs(gameState, queues);
	// IT14.46: Expert's opening attack behavior follows the single doctrine selected
	// by ExpertDecisionController instead of Petra personality rolling a second strategy.
	const doctrine = gameState.ai.HQ && gameState.ai.HQ.expertDoctrine;
	if (this.Config.difficulty >= difficulty.EXPERT && doctrine)
	{
		this.maxRushes = Math.max(0, Number(doctrine.rushes) || 0);
		this.rushSize = this.maxRushes ? [Math.max(12, Number(doctrine.rushSize) || 20)] : [];
	}
	const expertFinishing = this.getExpertFinishingTarget(gameState);
	const unexecutedAttacks = {
		[AttackPlan.TYPE_RUSH]: 0,
		[AttackPlan.TYPE_RAID]: 0,
		[AttackPlan.TYPE_DEFAULT]: 0,
		[AttackPlan.TYPE_HUGE_ATTACK]: 0
	};
	for (const attackType in this.upcomingAttacks)
	{
		for (let i = 0; i < this.upcomingAttacks[attackType].length; ++i)
		{
			const attack = this.upcomingAttacks[attackType][i];
			attack.checkEvents(gameState, events);
			if (expertFinishing && attack.state === AttackPlan.STATE_UNEXECUTED &&
			    attack.unitCollection.length >= Math.max(1, Number(mergePolicy().expertFinishingForceStartSize) || 8))
			{
				attack.targetPlayer = expertFinishing.targetPlayer;
				attack.forceStart();
			}

			if (attack.isStarted())
			{
				aiWarn("Petra problem in attackManager: attack in preparation has already " +
					"started ???");
			}

			const updateStep = attack.updatePreparation(gameState);
			// now we're gonna check if the preparation time is over
			if (updateStep === AttackPlan.PREPARATION_KEEP_GOING || attack.isPaused())
			{
				// just chillin'
				if (attack.state === AttackPlan.STATE_UNEXECUTED)
					++unexecutedAttacks[attackType];
			}
			else if (updateStep === AttackPlan.PREPARATION_FAILED)
			{
				if (this.Config.debug > 1)
				{
					aiWarn("Attack Manager: " + attack.getType() + " plan " + attack.getName() +
						" aborted.");
				}
				attack.Abort(gameState);
				this.upcomingAttacks[attackType].splice(i--, 1);
			}
			else if (updateStep === AttackPlan.PREPARATION_START)
			{
				if (attack.StartAttack(gameState))
				{
					if (this.Config.debug > 1)
					{
						aiWarn("Attack Manager: Starting " + attack.getType() + " plan " +
							attack.getName());
					}
					if (this.Config.chat)
						chat.launchAttack(gameState, attack.targetPlayer, attack.getType());
					this.startedAttacks[attackType].push(attack);
				}
				else
					attack.Abort(gameState);
				this.upcomingAttacks[attackType].splice(i--, 1);
			}
		}
	}

	for (const attackType in this.startedAttacks)
	{
		for (let i = 0; i < this.startedAttacks[attackType].length; ++i)
		{
			const attack = this.startedAttacks[attackType][i];
			attack.checkEvents(gameState, events);
			// IT14.45: peel critically wounded soldiers first and replace them with healthy
			// reinforcements.  A whole-army retreat is reserved for an actually collapsed push.
			this.peelExpertWoundedUnits(gameState, attack);
			this.reinforceExpertWoundedReplacements(gameState, attack);
			// IT14.44/45: do not donate the last ~20 infantry to a defended enemy CC. Pull
			// them home, reboom briefly, then return with a rebuilt army/siege.
			if (this.shouldExpertRetreatDepletedAttack(gameState, attack))
			{
				const policy = mergePolicy();
				this.expertReboomUntil = Math.max(this.expertReboomUntil || -99999,
					(Number(gameState.ai.elapsedTime) || 0) + policy.expertDepletedAttackReboomSeconds);
				aiWarn("[EXPERT-REBOOM] retreat plan=" + attack.name + " army=" + attack.unitCollection.length +
					" targetPlayer=" + attack.targetPlayer + " until=" + Math.round(this.expertReboomUntil));
				attack.Abort(gameState);
				this.startedAttacks[attackType].splice(i--, 1);
				// A second plan may already be assembling when the field army collapses. Cancel
				// those normal/huge preparations too; otherwise it can launch during the very
				// reboom window we just created and repeat the same piecemeal failure.
				let cancelled = 0;
				for (const prepType of [AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK])
				{
					for (const prep of this.upcomingAttacks[prepType] || [])
					{
						prep.Abort(gameState);
						++cancelled;
					}
					this.upcomingAttacks[prepType] = [];
				}
				if (cancelled)
					aiWarn("[EXPERT-REBOOM] cancelled-preparations=" + cancelled);
				continue;
			}
			// okay so then we'll update the attack.
			if (attack.isPaused())
				continue;
			const remaining = attack.update(gameState, events);
			if (!remaining)
			{
				if (this.Config.debug > 1)
				{
					aiWarn("Military Manager: " + attack.getType() + " plan " +
						attack.getName() + " is finished with remaining " + remaining);
				}
				attack.Abort(gameState);
				this.startedAttacks[attackType].splice(i--, 1);
			}
		}
	}

	this.updateExpertFinishingProgress(gameState, expertFinishing);
	// Siege trained for a healthy P3 push joins the field army before the opponent is
	// formally broken.  Finishing reinforcement can then top up the same plan.
	this.attachExpertSiegeToActiveAttack(gameState);
	if (expertFinishing)
		this.reinforceExpertFinishingAttack(gameState, expertFinishing);
	this.recoverExpertRamPassengers(gameState);
	this.manageExpertRamGarrisons(gameState, expertFinishing);

	// creating plans after updating because an aborted plan might be reused in that case.

	const barracksNb = gameState.getOwnEntitiesByClass("Barracks", true).filter(filters.isBuilt()).length;
	if (this.rushNumber < this.maxRushes && barracksNb >= 1)
	{
		if (unexecutedAttacks[AttackPlan.TYPE_RUSH] === 0)
		{
			// we have a barracks and we want to rush, rush.
			const data = { "targetSize": this.rushSize[this.rushNumber] };
			const attackPlan = new AttackPlan(gameState, this.Config, this.totalNumber,
				AttackPlan.TYPE_RUSH, data);
			if (!attackPlan.failed)
			{
				if (this.Config.debug > 1)
				{
					aiWarn("Military Manager: Rushing plan " + this.totalNumber +
						" with maxRushes " + this.maxRushes);
				}
				this.totalNumber++;
				attackPlan.init(gameState);
				this.upcomingAttacks[AttackPlan.TYPE_RUSH].push(attackPlan);
			}
			this.rushNumber++;
		}
	}
	else if (!((Number(gameState.ai.elapsedTime) || 0) < (this.expertReboomUntil || -99999)) &&
		unexecutedAttacks[AttackPlan.TYPE_DEFAULT] == 0 &&
		unexecutedAttacks[AttackPlan.TYPE_HUGE_ATTACK] == 0 &&
		this.startedAttacks[AttackPlan.TYPE_DEFAULT].length +
			this.startedAttacks[AttackPlan.TYPE_HUGE_ATTACK].length <
			Math.min(2, 1 + Math.round(gameState.getPopulationMax() / 100)) &&
		(expertFinishing || this.startedAttacks[AttackPlan.TYPE_DEFAULT].length +
			this.startedAttacks[AttackPlan.TYPE_HUGE_ATTACK].length == 0 ||
		gameState.getPopulationMax() - gameState.getPopulation() > 12))
	{
		if (barracksNb >= 1 && (gameState.currentPhase() > 1 || gameState.isResearching(gameState.getPhaseName(2))) ||
			!gameState.ai.HQ.hasPotentialBase())	// if we have no base ... nothing else to do than attack
		{
			const type = expertFinishing ? AttackPlan.TYPE_DEFAULT :
				(this.attackNumber < 2 || this.startedAttacks[AttackPlan.TYPE_HUGE_ATTACK].length > 0 ?
				AttackPlan.TYPE_DEFAULT : AttackPlan.TYPE_HUGE_ATTACK);
			const attackPlan = new AttackPlan(gameState, this.Config, this.totalNumber, type);
			if (attackPlan.failed)
				this.attackPlansEncounteredWater = true; // hack
			else
			{
				if (this.Config.debug > 1)
				{
					aiWarn("Military Manager: Creating the plan " + type + "  " +
						this.totalNumber);
				}
				this.totalNumber++;
				attackPlan.init(gameState);
				if (expertFinishing)
					attackPlan.targetPlayer = expertFinishing.targetPlayer;
				this.upcomingAttacks[type].push(attackPlan);
			}
			this.attackNumber++;
		}
	}

	if (unexecutedAttacks[AttackPlan.TYPE_RAID] === 0 &&
		gameState.ai.HQ.defenseManager.targetList.length)
	{
		let target;
		for (const targetId of gameState.ai.HQ.defenseManager.targetList)
		{
			target = gameState.getEntityById(targetId);
			if (!target)
				continue;
			if (gameState.isPlayerEnemy(target.owner()))
				break;
			target = undefined;
		}
		if (target) // prepare a raid against this target
			this.raidTargetEntity(gameState, target);
	}

	// Check if we have some unused ranged siege unit which could do something useful while waiting
	if (this.Config.difficulty > difficulty.VERY_EASY && gameState.ai.playedTurn % 5 == 0)
		this.assignBombers(gameState);
};

AttackManager.prototype.getPlan = function(planName)
{
	for (const attackType in this.upcomingAttacks)
	{
		for (const attack of this.upcomingAttacks[attackType])
			if (attack.getName() == planName)
				return attack;
	}
	for (const attackType in this.startedAttacks)
	{
		for (const attack of this.startedAttacks[attackType])
			if (attack.getName() == planName)
				return attack;
	}
	return undefined;
};

AttackManager.prototype.pausePlan = function(planName)
{
	const attack = this.getPlan(planName);
	if (attack)
		attack.setPaused(true);
};

AttackManager.prototype.unpausePlan = function(planName)
{
	const attack = this.getPlan(planName);
	if (attack)
		attack.setPaused(false);
};

AttackManager.prototype.pauseAllPlans = function()
{
	for (const attackType in this.upcomingAttacks)
		for (const attack of this.upcomingAttacks[attackType])
			attack.setPaused(true);

	for (const attackType in this.startedAttacks)
		for (const attack of this.startedAttacks[attackType])
			attack.setPaused(true);
};

AttackManager.prototype.unpauseAllPlans = function()
{
	for (const attackType in this.upcomingAttacks)
		for (const attack of this.upcomingAttacks[attackType])
			attack.setPaused(false);

	for (const attackType in this.startedAttacks)
		for (const attack of this.startedAttacks[attackType])
			attack.setPaused(false);
};

AttackManager.prototype.getAttackInPreparation = function(type)
{
	return this.upcomingAttacks[type].length ? this.upcomingAttacks[type][0] : undefined;
};

/**
 * Determine which player should be attacked: when called when starting the attack,
 * attack.targetPlayer is undefined and in that case, we keep track of the chosen target
 * for future attacks.
 */
AttackManager.prototype.getEnemyPlayer = function(gameState, attack)
{
	let enemyPlayer;

	// First check if there is a preferred enemy based on our victory conditions.
	// If both wonder and relic, choose randomly between them TODO should combine decisions

	if (gameState.getVictoryConditions().has("wonder"))
		enemyPlayer = this.getWonderEnemyPlayer(gameState, attack);

	if (gameState.getVictoryConditions().has("capture_the_relic"))
		if (!enemyPlayer || randBool())
			enemyPlayer = this.getRelicEnemyPlayer(gameState, attack) || enemyPlayer;

	if (enemyPlayer)
		return enemyPlayer;

	const veto = {};
	for (const i in this.defeated)
		veto[i] = true;
	// No rush if enemy too well defended (i.e. iberians)
	if (attack.type === AttackPlan.TYPE_RUSH)
	{
		for (let i = 1; i < gameState.sharedScript.playersData.length; ++i)
		{
			if (!gameState.isPlayerEnemy(i) || veto[i])
				continue;
			if (this.defeated[i])
				continue;
			let enemyDefense = 0;
			for (const ent of gameState.getEnemyStructures(i).values())
				if (ent.hasClasses(["Tower", "WallTower", "Fortress"]))
					enemyDefense++;
			if (enemyDefense > 6)
				veto[i] = true;
		}
	}

	// then if not a huge attack, continue attacking our previous target as long as it has some entities,
	// otherwise target the most accessible one
	if (attack.type !== AttackPlan.TYPE_HUGE_ATTACK)
	{
		if (attack.targetPlayer === undefined && this.currentEnemyPlayer !== undefined &&
			!this.defeated[this.currentEnemyPlayer] &&
			gameState.isPlayerEnemy(this.currentEnemyPlayer) &&
			gameState.getEntities(this.currentEnemyPlayer).hasEntities())
			return this.currentEnemyPlayer;

		let distmin;
		let ccmin;
		const ccEnts = gameState.updatingGlobalCollection("allCCs", filters.byClass("CivCentre"));
		for (const ourcc of ccEnts.values())
		{
			if (ourcc.owner() != PlayerID)
				continue;
			const ourPos = ourcc.position();
			const access = getLandAccess(gameState, ourcc);
			for (const enemycc of ccEnts.values())
			{
				if (veto[enemycc.owner()])
					continue;
				if (!gameState.isPlayerEnemy(enemycc.owner()))
					continue;
				if (access !== getLandAccess(gameState, enemycc))
					continue;
				const dist = SquareVectorDistance(ourPos, enemycc.position());
				if (distmin && dist > distmin)
					continue;
				ccmin = enemycc;
				distmin = dist;
			}
		}
		if (ccmin)
		{
			enemyPlayer = ccmin.owner();
			if (attack.targetPlayer === undefined)
				this.currentEnemyPlayer = enemyPlayer;
			return enemyPlayer;
		}
	}

	// then let's target our strongest enemy (basically counting enemies units)
	// with priority to enemies with civ center
	let max = 0;
	for (let i = 1; i < gameState.sharedScript.playersData.length; ++i)
	{
		if (veto[i])
			continue;
		if (!gameState.isPlayerEnemy(i))
			continue;
		let enemyCount = 0;
		let enemyCivCentre = false;
		for (const ent of gameState.getEntities(i).values())
		{
			enemyCount++;
			if (ent.hasClass("CivCentre"))
				enemyCivCentre = true;
		}
		if (enemyCivCentre)
			enemyCount += 500;
		if (!enemyCount || enemyCount < max)
			continue;
		max = enemyCount;
		enemyPlayer = i;
	}
	if (attack.targetPlayer === undefined)
		this.currentEnemyPlayer = enemyPlayer;
	return enemyPlayer;
};

/**
 * Target the player with the most advanced wonder.
 * TODO currently the first built wonder is kept, should chek on the minimum wonderDuration left instead.
 */
AttackManager.prototype.getWonderEnemyPlayer = function(gameState, attack)
{
	let enemyPlayer;
	let enemyWonder;
	let moreAdvanced;
	for (const wonder of gameState.getEnemyStructures().filter(filters.byClass("Wonder")).values())
	{
		if (wonder.owner() == 0)
			continue;
		const progress = wonder.foundationProgress();
		if (progress === undefined)
		{
			enemyWonder = wonder;
			break;
		}
		if (enemyWonder && moreAdvanced > progress)
			continue;
		enemyWonder = wonder;
		moreAdvanced = progress;
	}
	if (enemyWonder)
	{
		enemyPlayer = enemyWonder.owner();
		if (attack.targetPlayer === undefined)
			this.currentEnemyPlayer = enemyPlayer;
	}
	return enemyPlayer;
};

/**
 * Target the player with the most relics (including gaia).
 */
AttackManager.prototype.getRelicEnemyPlayer = function(gameState, attack)
{
	let enemyPlayer;
	const allRelics = gameState.updatingGlobalCollection("allRelics", filters.byClass("Relic"));
	let maxRelicsOwned = 0;
	for (let i = 0; i < gameState.sharedScript.playersData.length; ++i)
	{
		if (!gameState.isPlayerEnemy(i) || this.defeated[i] ||
		    i == 0 && !gameState.ai.HQ.victoryManager.tryCaptureGaiaRelic)
			continue;

		const relicsCount = allRelics.filter(relic => relic.owner() == i).length;
		if (relicsCount <= maxRelicsOwned)
			continue;
		maxRelicsOwned = relicsCount;
		enemyPlayer = i;
	}
	if (enemyPlayer !== undefined)
	{
		if (attack.targetPlayer === undefined)
			this.currentEnemyPlayer = enemyPlayer;
		if (enemyPlayer == 0)
			gameState.ai.HQ.victoryManager.resetCaptureGaiaRelic(gameState);
	}
	return enemyPlayer;
};

/** f.e. if we have changed diplomacy with another player. */
AttackManager.prototype.cancelAttacksAgainstPlayer = function(gameState, player)
{
	for (const attackType in this.upcomingAttacks)
		for (const attack of this.upcomingAttacks[attackType])
			if (attack.targetPlayer === player)
				attack.targetPlayer = undefined;

	for (const attackType in this.startedAttacks)
		for (let i = 0; i < this.startedAttacks[attackType].length; ++i)
		{
			const attack = this.startedAttacks[attackType][i];
			if (attack.targetPlayer === player)
			{
				attack.Abort(gameState);
				this.startedAttacks[attackType].splice(i--, 1);
			}
		}
};

AttackManager.prototype.raidTargetEntity = function(gameState, ent)
{
	const data = { "target": ent };
	const attackPlan = new AttackPlan(gameState, this.Config, this.totalNumber,
		AttackPlan.TYPE_RAID, data);
	if (attackPlan.failed)
		return null;
	if (this.Config.debug > 1)
		aiWarn("Military Manager: Raiding plan " + this.totalNumber);
	this.raidNumber++;
	this.totalNumber++;
	attackPlan.init(gameState);
	this.upcomingAttacks[AttackPlan.TYPE_RAID].push(attackPlan);
	return attackPlan;
};

/**
 * Return the number of units from any of our attacking armies around this position
 */
AttackManager.prototype.numAttackingUnitsAround = function(pos, dist)
{
	let num = 0;
	for (const attackType in this.startedAttacks)
		for (const attack of this.startedAttacks[attackType])
		{
			if (!attack.position)	// this attack may be inside a transport
				continue;
			if (SquareVectorDistance(pos, attack.position) < dist*dist)
				num += attack.unitCollection.length;
		}
	return num;
};

/**
 * Switch defense armies into an attack one against the given target
 * data.range: transform all defense armies inside range of the target into a new attack
 * data.armyID: transform only the defense army ID into a new attack
 * data.uniqueTarget: the attack will stop when the target is destroyed or captured
 */
AttackManager.prototype.switchDefenseToAttack = function(gameState, target, data)
{
	if (!target || !target.position())
		return false;
	if (!data.range && !data.armyID)
	{
		aiWarn(" attackManager.switchDefenseToAttack inconsistent data " + uneval(data));
		return false;
	}
	const attackData = data.uniqueTarget ? { "uniqueTargetId": target.id() } : undefined;
	const pos = target.position();
	const attackType = AttackPlan.TYPE_DEFAULT;
	const attackPlan = new AttackPlan(gameState, this.Config, this.totalNumber, attackType, attackData);
	if (attackPlan.failed)
		return false;
	this.totalNumber++;
	attackPlan.init(gameState);
	this.startedAttacks[attackType].push(attackPlan);

	const targetAccess = getLandAccess(gameState, target);
	for (const army of gameState.ai.HQ.defenseManager.armies)
	{
		if (data.range)
		{
			army.recalculatePosition(gameState);
			if (SquareVectorDistance(pos, army.foePosition) > data.range * data.range)
				continue;
		}
		else if (army.ID != +data.armyID)
			continue;

		while (army.foeEntities.length > 0)
			army.removeFoe(gameState, army.foeEntities[0]);
		while (army.ownEntities.length > 0)
		{
			const unitId = army.ownEntities[0];
			army.removeOwn(gameState, unitId);
			const unit = gameState.getEntityById(unitId);
			const accessOk = unit.getMetadata(PlayerID, "transport") !== undefined ||
				unit.position() && getLandAccess(gameState, unit) == targetAccess;
			if (unit && accessOk && attackPlan.isAvailableUnit(gameState, unit))
			{
				unit.setMetadata(PlayerID, "plan", attackPlan.name);
				unit.setMetadata(PlayerID, "role", Worker.ROLE_ATTACK);
				attackPlan.unitCollection.updateEnt(unit);
			}
		}
	}
	if (!attackPlan.unitCollection.hasEntities())
	{
		attackPlan.Abort(gameState);
		return false;
	}
	for (const unit of attackPlan.unitCollection.values())
		unit.setMetadata(PlayerID, "role", Worker.ROLE_ATTACK);
	attackPlan.targetPlayer = target.owner();
	attackPlan.targetPos = pos;
	attackPlan.target = target;
	attackPlan.state = AttackPlan.STATE_ARRIVED;
	return true;
};

AttackManager.prototype.Serialize = function()
{
	const properties = {
		"totalNumber": this.totalNumber,
		"attackNumber": this.attackNumber,
		"rushNumber": this.rushNumber,
		"raidNumber": this.raidNumber,
		"debugTime": this.debugTime,
		"maxRushes": this.maxRushes,
		"rushSize": this.rushSize,
		"currentEnemyPlayer": this.currentEnemyPlayer,
		"defeated": this.defeated,
		"expertObservedMilitaryTechs": this.expertObservedMilitaryTechs,
		"expertLastTechGateLog": this.expertLastTechGateLog,
		"expertFinishingProgress": this.expertFinishingProgress,
		"expertReboomUntil": this.expertReboomUntil
	};

	const upcomingAttacks = {};
	for (const key in this.upcomingAttacks)
	{
		upcomingAttacks[key] = [];
		for (const attack of this.upcomingAttacks[key])
			upcomingAttacks[key].push(attack.Serialize());
	}

	const startedAttacks = {};
	for (const key in this.startedAttacks)
	{
		startedAttacks[key] = [];
		for (const attack of this.startedAttacks[key])
			startedAttacks[key].push(attack.Serialize());
	}

	return { "properties": properties, "upcomingAttacks": upcomingAttacks, "startedAttacks": startedAttacks };
};

AttackManager.prototype.Deserialize = function(gameState, data)
{
	for (const key in data.properties)
		this[key] = data.properties[key];

	this.upcomingAttacks = {};
	for (const key in data.upcomingAttacks)
	{
		this.upcomingAttacks[key] = [];
		for (const dataAttack of data.upcomingAttacks[key])
		{
			const attack = new AttackPlan(gameState, this.Config, dataAttack.properties.name);
			attack.Deserialize(gameState, dataAttack);
			attack.init(gameState);
			this.upcomingAttacks[key].push(attack);
		}
	}

	this.startedAttacks = {};
	for (const key in data.startedAttacks)
	{
		this.startedAttacks[key] = [];
		for (const dataAttack of data.startedAttacks[key])
		{
			const attack = new AttackPlan(gameState, this.Config, dataAttack.properties.name);
			attack.Deserialize(gameState, dataAttack);
			attack.init(gameState);
			this.startedAttacks[key].push(attack);
		}
	}
};
