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
	// IT14.47: concise doctrine telemetry so a replay immediately shows whether a
	// selected P1 rush is merely arming, has launched, or has rolled into its P2 follow-up.
	this.expertLastStrategyStatusLog = -99999;
	// IT14.49: failed P1 rushes transition into an explicit recovery state rather
	// than dribbling fresh batches into the same lost engagement.
	this.expertRushRecoveryMode = false;
	this.expertRushRecoveryUntil = -99999;
	// IT14.52: the economy uses this one-way signal to unlock the worker-aura
	// Temple immediately after a committed P1 rush leaves home.
	this.expertRushHasLaunched = false;
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

	// IT14.49: keep exact own-loss accounting for each live rush using the plan
	// metadata preserved on Destroy events. This is safer than inferring casualties
	// from current army size, which can be distorted by wounded-unit peel/replacement.
	if (this.Config.difficulty >= difficulty.EXPERT)
		for (const evt of events.Destroy)
		{
			const planId = evt && evt.metadata && evt.metadata[PlayerID] && evt.metadata[PlayerID].plan;
			if (planId === undefined || !evt.entityObj || evt.entityObj.owner() !== PlayerID)
				continue;
			const plan = this.getPlan(planId);
			if (!plan || !plan.isStarted() || plan.type !== AttackPlan.TYPE_RUSH)
				continue;
			plan.expertOwnLosses = Math.max(0, Number(plan.expertOwnLosses) || 0) + 1;
		}

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

// IT14.50 finishing mode: only once an enemy has been driven below the true cleanup threshold and
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
	const policy = mergePolicy();
	const maxEnemy = Math.max(1, Number(policy.expertFinishingEnemyPopulation) || 28);
	const minOwn = Math.max(1, Number(policy.expertFinishingMinimumOwnPopulation) || 80);
	const minLead = Math.max(0, Number(policy.expertFinishingMinimumPopulationLead) || 30);
	if (!Number.isFinite(enemyPopulation) || enemyPopulation <= 0 || enemyPopulation > maxEnemy ||
	    ownPopulation < minOwn || ownPopulation - enemyPopulation < minLead)
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
		return { ready: true, completed: 0, researching: 0, active: 0, required: 0 };
	if (this.getExpertFinishingTarget(gameState))
		return { ready: true, completed: 0, researching: 0, active: 0, required: 0, finishing: true };
	const policy = mergePolicy();
	const doctrine = gameState.ai.HQ && gameState.ai.HQ.expertDoctrine;
	let completed = 0;
	let researching = 0;
	for (const name of Object.keys(this.expertObservedMilitaryTechs || {}))
	{
		if (gameState.isResearched && gameState.isResearched(name))
			++completed;
		else if (gameState.isResearching && gameState.isResearching(name))
			++researching;
	}
	const active = completed + researching;
	// IT14.50: P2 Forge-Tech Push deliberately waits for two completed upgrades. A
	// P1-rush doctrine, however, should preserve the damage window: one completed
	// upgrade plus a second actively researching is enough to launch the follow-up.
	if (doctrine && Number(doctrine.rushes) > 0)
	{
		const requiredCompleted = Math.max(0, Number(policy.expertP2RushFollowupCompletedMilitaryTechs) || 1);
		const requiredActive = Math.max(requiredCompleted, Number(policy.expertP2RushFollowupActiveMilitaryTechs) || 2);
		return { ready: completed >= requiredCompleted && active >= requiredActive, completed, researching, active,
			required: requiredActive, mode: "rush-followup" };
	}
	const required = Math.max(0, Number(policy.expertP2AttackRequiredMilitaryTechs) || 0);
	if (!required)
		return { ready: true, completed, researching, active, required: 0, mode: "p2-tech-push" };
	return { ready: completed >= required, completed, researching, active, required, mode: "p2-tech-push" };
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
	const balance = this.expertRushLocalBalance(gameState, attack);
	const closeCombat = balance.enemyCombat > 0 || balance.defenses > 0;
	const threshold = Math.max(0.05, Math.min(0.9, closeCombat ?
		(Number(policy.expertWoundedRetreatHealthCombat) || 0.18) :
		(Number(policy.expertWoundedRetreatHealthLull) || 0.30)));
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
	const batch = Math.max(1, closeCombat ?
		(Number(policy.expertWoundedRetreatBatchCombat) || 2) :
		(Number(policy.expertWoundedRetreatBatchLull) || 6));
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
	const now = Number(gameState.ai.elapsedTime) || 0;
	const balance = this.expertRushLocalBalance(gameState, attack);
	const closeCombat = balance.enemyCombat > 0 || balance.defenses > 0;
	const waveMin = Math.max(1, Number(policy.expertWoundedReplacementWaveMinimum) || 6);
	const demand = Math.max(0, Number(attack.expertWoundedReplacementDemand) || 0);
	if (closeCombat && demand < waveMin)
		return 0;
	if (now < (Number(attack.expertLastWoundedReplacementWave) || -99999) +
	    (Number(policy.expertWoundedReplacementWaveCooldownSeconds) || 14))
		return 0;
	const rally = attack.position && Number.isFinite(attack.position[0]) ? attack.position : attack.targetPos;
	candidates.sort((a, b) => {
		const da = rally ? SquareVectorDistance(a.position(), rally) : 0;
		const db = rally ? SquareVectorDistance(b.position(), rally) : 0;
		return da - db || b.healthLevel() - a.healthLevel() || a.id() - b.id();
	});
	const batch = Math.min(available, Math.max(1, Number(policy.expertWoundedReplacementBatch) || 8), demand);
	let added = 0;
	for (const ent of candidates.slice(0, batch))
		if (attack.addExpertReinforcement && attack.addExpertReinforcement(gameState, ent))
			++added;
	if (added)
	{
		attack.expertLastWoundedReplacementWave = now;
		attack.expertWoundedReplacementDemand = Math.max(0, attack.expertWoundedReplacementDemand - added);
		aiWarn("[EXPERT-WOUNDED] replace plan=" + attack.name + " added=" + added +
			" remaining=" + attack.expertWoundedReplacementDemand + " army=" + attack.unitCollection.length);
	}
	return added;
};

// IT14.50: keep one coherent Town-phase offensive supplied by reinforcement waves.
// Fresh citizen-soldiers are assigned together every few seconds instead of creating
// a second independent 10-20 man plan that fights/retreats on its own.
AttackManager.prototype.reinforceExpertPrimaryAttackWave = function(gameState, attack, finishing)
{
	if (this.Config.difficulty < difficulty.EXPERT || !attack || !attack.isStarted() || finishing ||
	    (attack.type !== AttackPlan.TYPE_DEFAULT && attack.type !== AttackPlan.TYPE_HUGE_ATTACK) ||
	    gameState.ai.playedTurn % 5 !== 0 || Number(attack.expertTacticalRegroupUntil) > (Number(gameState.ai.elapsedTime) || 0))
		return 0;
	const policy = mergePolicy();
	const now = Number(gameState.ai.elapsedTime) || 0;
	const targetArmy = Math.max(20, Number(policy.expertPrimaryOffensiveTargetArmy) || 50);
	const deficit = targetArmy - attack.unitCollection.length;
	const waveMin = Math.max(1, Number(policy.expertPrimaryReinforcementWaveMinimum) || 6);
	if (deficit < waveMin || now < (Number(attack.expertLastPrimaryReinforcementWave) || -99999) +
	    (Number(policy.expertPrimaryReinforcementWaveCooldownSeconds) || 16))
		return 0;
	const reserve = Math.max(0, Number(policy.expertWoundedReplacementHomeReserve) || 12);
	const candidates = [];
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position() || !ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry") || ent.hasClass("Siege") ||
		    !ent.healthLevel || ent.healthLevel() < 0.75 || ent.getMetadata(PlayerID, "expertWoundedReturnUntil") !== undefined ||
		    ent.getMetadata(PlayerID, "expertCombatRetreatUntil") !== undefined ||
		    ent.getMetadata(PlayerID, "expertDecisionTaskId") !== undefined || ent.getMetadata(PlayerID, "expertDefenseMobilized") !== undefined ||
		    ent.getMetadata(PlayerID, "garrisonHolder") !== undefined)
			continue;
		const plan = ent.getMetadata(PlayerID, "plan");
		if (plan !== undefined && plan !== -1)
			continue;
		candidates.push(ent);
	}
	const available = Math.max(0, candidates.length - reserve);
	if (available < waveMin)
		return 0;
	const home = this.expertWoundedHomePosition(gameState, attack.position || attack.targetPos);
	if (home)
		candidates.sort((a, b) => SquareVectorDistance(a.position(), home) - SquareVectorDistance(b.position(), home) || a.id() - b.id());
	const batch = Math.min(deficit, available, Math.max(waveMin, Number(policy.expertPrimaryReinforcementWaveMaximum) || 8));
	let added = 0;
	for (const ent of candidates.slice(0, batch))
		if (attack.addExpertReinforcement && attack.addExpertReinforcement(gameState, ent))
			++added;
	if (added)
	{
		attack.expertLastPrimaryReinforcementWave = now;
		attack.expertWoundedReplacementDemand = Math.max(0, (Number(attack.expertWoundedReplacementDemand) || 0) - added);
		aiWarn("[EXPERT-WAVE] reinforced plan=" + attack.name + " added=" + added +
			" army=" + attack.unitCollection.length + "/" + targetArmy + " homeReserve=" + reserve);
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

AttackManager.prototype.expertRushLocalBalance = function(gameState, attack)
{
	const out = { ownCombat: 0, enemyCombat: 0, melee: 0, ranged: 0, defenses: 0 };
	if (!attack || !attack.unitCollection)
		return out;
	const centre = attack.unitCollection.getCentrePosition && attack.unitCollection.getCentrePosition() || attack.position || attack.targetPos;
	if (!centre)
		return out;
	const policy = mergePolicy();
	const radius2 = Math.pow(Number(policy.expertRushLocalBalanceRadius) || 80, 2);
	for (const ent of attack.unitCollection.values())
	{
		if (!ent || !ent.position() || SquareVectorDistance(ent.position(), centre) > radius2 || ent.hasClass("Siege"))
			continue;
		const attacks = ent.attackTypes && ent.attackTypes();
		if (!attacks)
			continue;
		++out.ownCombat;
		if (ent.hasClass("Melee")) ++out.melee;
		if (ent.hasClass("Ranged")) ++out.ranged;
	}
	if (attack.targetPlayer !== undefined)
		for (const ent of gameState.getEnemyUnits(attack.targetPlayer).values())
		{
			if (!ent || !ent.position() || SquareVectorDistance(ent.position(), centre) > radius2)
				continue;
			const attacks = ent.attackTypes && ent.attackTypes();
			if (attacks && !ent.hasClass("Animal"))
				++out.enemyCombat;
		}
	const defenseRadius2 = Math.pow(Number(policy.expertRushDefensiveThreatRadius) || 90, 2);
	if (attack.targetPlayer !== undefined)
		for (const struct of gameState.getEnemyStructures(attack.targetPlayer).values())
		{
			if (!struct || !struct.position() || SquareVectorDistance(struct.position(), centre) > defenseRadius2)
				continue;
			if (struct.hasClass("CivCentre") || struct.hasClass("Tower") || struct.hasClass("WallTower") ||
			    struct.hasClass("Fortress") || struct.hasDefensiveFire && struct.hasDefensiveFire())
				++out.defenses;
		}
	return out;
};

AttackManager.prototype.expertFailedRushDecision = function(gameState, attack)
{
	const out = { abort: false, reason: "", losses: 0, enemyDamage: 0 };
	if (this.Config.difficulty < difficulty.EXPERT || !attack || !attack.isStarted() ||
	    attack.type !== AttackPlan.TYPE_RUSH || !(Number(attack.expertLaunchSize) > 0))
		return out;
	const policy = mergePolicy();
	const now = Number(gameState.ai.elapsedTime) || 0;
	const age = now - (Number(attack.expertLaunchTime) || now);
	if (age < (Number(policy.expertRushAbortMinimumFightSeconds) || 10))
		return out;
	const launch = Math.max(1, Number(attack.expertLaunchSize) || attack.unitCollection.length);
	const losses = Math.max(0, Number(attack.expertOwnLosses) || 0);
	const pdata = gameState.sharedScript && gameState.sharedScript.playersData && gameState.sharedScript.playersData[attack.targetPlayer];
	const enemyPop = pdata ? Math.max(0, Number(pdata.popCount) || 0) : Number(attack.expertLaunchEnemyPopulation) || 0;
	const enemyDamage = Math.max(0, (Number(attack.expertLaunchEnemyPopulation) || enemyPop) - enemyPop);
	out.losses = losses;
	out.enemyDamage = enemyDamage;
	const minimumLosses = Math.max(3, Number(policy.expertRushAbortMinimumOwnLosses) || 5);
	const badExchange = losses >= minimumLosses && enemyDamage < losses * (Number(policy.expertRushAbortEnemyDamageCredit) || 0.75);
	const lossFraction = losses / launch;
	const balance = this.expertRushLocalBalance(gameState, attack);
	const outnumbered = balance.enemyCombat >= Math.max(6, Math.ceil(Math.max(1, balance.ownCombat) *
		(Number(policy.expertRushAbortLocalOutnumberRatio) || 1.25)));
	const staticTrap = balance.defenses > 0 && balance.enemyCombat >= 4;
	const screenBroken = balance.ranged >= 4 && balance.melee < Math.max(3, Math.ceil(balance.ranged * 0.35));
	if (badExchange && lossFraction >= (Number(policy.expertRushAbortLossFraction) || 0.35))
	{
		out.abort = true; out.reason = "bad_exchange";
	}
	else if (badExchange && lossFraction >= (Number(policy.expertRushAbortPressureLossFraction) || 0.25) &&
	         (outnumbered || staticTrap))
	{
		out.abort = true; out.reason = outnumbered ? "outnumbered" : "defended_trap";
	}
	else if (badExchange && lossFraction >= (Number(policy.expertRushAbortPressureLossFraction) || 0.25) && screenBroken)
	{
		// IT14.50: IT14.49 abandoned a 16-man rush while the local reading was 10v0
		// merely because the melee/ranged geometry was poor. Reform first; only a real
		// bad fight gets the strategic retreat.
		out.regroup = true; out.reason = "melee_screen_regroup";
	}
	else if (badExchange && attack.unitCollection.length <= Math.max(8, Math.floor(launch * 0.55)))
	{
		out.abort = true; out.reason = "army_collapsed";
	}
	out.balance = balance;
	return out;
};

AttackManager.prototype.startExpertTacticalRegroup = function(gameState, attack, decision)
{
	if (!attack || !attack.unitCollection || !attack.unitCollection.hasEntities())
		return false;
	const policy = mergePolicy();
	const now = Number(gameState.ai.elapsedTime) || 0;
	const cooldown = Number(policy.expertRushTacticalRegroupCooldownSeconds) || 25;
	if (now < (Number(attack.expertLastTacticalRegroup) || -99999) + cooldown)
		return false;
	const centre = attack.unitCollection.getCentrePosition && attack.unitCollection.getCentrePosition() || attack.position || attack.targetPos;
	if (!centre)
		return false;
	const home = this.expertWoundedHomePosition(gameState, centre);
	if (!home)
		return false;
	let dx = home[0] - centre[0], dz = home[1] - centre[1];
	const len = Math.hypot(dx, dz) || 1;
	const step = Math.min(Number(policy.expertRushTacticalRegroupDistance) || 24, len);
	const regroup = [centre[0] + dx / len * step, centre[1] + dz / len * step];
	attack.expertLastTacticalRegroup = now;
	attack.expertTacticalRegroupUntil = now + (Number(policy.expertRushTacticalRegroupSeconds) || 7);
	attack.setPaused(true);
	for (const ent of attack.unitCollection.values())
		if (ent && ent.position() && !ent.hasClass("Siege"))
			ent.moveToRange(regroup[0], regroup[1], 0, 7);
	const b = decision && decision.balance || {};
	aiWarn("[EXPERT-RUSH] REGROUP plan=" + attack.name + " reason=" + (decision && decision.reason || "screen") +
		" army=" + attack.unitCollection.length + " local=" + (b.ownCombat || 0) + "v" + (b.enemyCombat || 0) +
		" defenses=" + (b.defenses || 0) + " resumeAt=" + Math.round(attack.expertTacticalRegroupUntil));
	return true;
};


// IT14.51: normal Town/City attacks should not wait until only ~20 bodies remain when
// their melee screen has already collapsed and real local pressure can reach the ranged
// body. The no-threat case is deliberately excluded so formation geometry alone cannot
// recreate IT14.49's premature retreat regression.
AttackManager.prototype.shouldExpertRetreatBrokenScreen = function(gameState, attack)
{
	if (this.Config.difficulty < difficulty.EXPERT || !attack || !attack.isStarted() ||
	    (attack.type !== AttackPlan.TYPE_DEFAULT && attack.type !== AttackPlan.TYPE_HUGE_ATTACK) || !attack.unitCollection)
		return false;
	const policy = mergePolicy();
	const army = attack.unitCollection.length;
	if (army > (Number(policy.expertCombatScreenRetreatArmyCeiling) || 48))
		return false;
	let melee = 0, ranged = 0;
	for (const ent of attack.unitCollection.values())
	{
		if (!ent || ent.hasClass("Siege") || ent.hasClass("Cavalry"))
			continue;
		if (ent.hasClass("Melee")) ++melee;
		else if (ent.hasClass("Ranged")) ++ranged;
	}
	if (ranged < (Number(policy.expertCombatScreenRetreatRangedMinimum) || 12) ||
	    melee >= Math.max(4, Math.ceil(ranged * (Number(policy.expertCombatScreenRetreatMeleeToRanged) || 0.38))))
		return false;
	const balance = this.expertRushLocalBalance(gameState, attack);
	const pressured = balance.defenses > 0 || balance.enemyCombat >= (Number(policy.expertCombatScreenRetreatEnemyMinimum) || 4);
	if (!pressured)
		return false;
	return { melee, ranged, balance };
};

// IT14.51: defensive cleanup for any Petra path that still manages to create a second
// Default/Huge offensive. Keep the largest coherent field army; abort a smaller sibling
// against the same opponent so its survivors return home and are eligible for the next
// reinforcement wave instead of fighting an independent perimeter battle.
AttackManager.prototype.consolidateExpertSecondaryOffensives = function(gameState)
{
	if (this.Config.difficulty < difficulty.EXPERT)
		return 0;
	const plans = [];
	for (const type of [AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK])
		for (const plan of this.startedAttacks[type] || [])
			if (plan && plan.isStarted() && plan.unitCollection && plan.unitCollection.hasEntities())
				plans.push({ type, plan });
	if (plans.length <= 1)
		return 0;
	plans.sort((a, b) => b.plan.unitCollection.length - a.plan.unitCollection.length || Number(a.plan.name) - Number(b.plan.name));
	const primary = plans[0].plan;
	let removed = 0;
	for (const item of plans.slice(1))
	{
		const secondary = item.plan;
		if (secondary.targetPlayer !== primary.targetPlayer || secondary.unitCollection.length >= 45 || primary.unitCollection.length < 50)
			continue;
		const size = secondary.unitCollection.length;
		secondary.Abort(gameState);
		const list = this.startedAttacks[item.type];
		const idx = list.indexOf(secondary);
		if (idx !== -1) list.splice(idx, 1);
		++removed;
		aiWarn("[EXPERT-CONSOLIDATE] primary=" + primary.name + " army=" + primary.unitCollection.length +
			" recalled=" + secondary.name + " size=" + size + " target=" + primary.targetPlayer);
	}
	return removed;
};

AttackManager.prototype.markExpertCombatRetreat = function(gameState, attack, reason)
{
	const now = Number(gameState.ai.elapsedTime) || 0;
	for (const ent of attack.unitCollection.values())
	{
		if (!ent || !ent.getMetadata)
			continue;
		ent.setMetadata(PlayerID, "expertCombatRetreatUntil", now + 180);
		ent.setMetadata(PlayerID, "expertCombatRetreatReason", reason || "failed_push");
	}
};

AttackManager.prototype.cancelExpertFollowupPreparations = function(gameState)
{
	let cancelled = 0;
	for (const prepType of [AttackPlan.TYPE_RUSH, AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK])
	{
		for (const prep of this.upcomingAttacks[prepType] || [])
		{
			prep.Abort(gameState);
			++cancelled;
		}
		this.upcomingAttacks[prepType] = [];
	}
	return cancelled;
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
	if (this.Config.difficulty >= difficulty.EXPERT && doctrine && Number(doctrine.rushes) > 0 &&
	    gameState.currentPhase && gameState.currentPhase() === 1 &&
	    gameState.ai.elapsedTime >= this.expertLastStrategyStatusLog + 20)
	{
		this.expertLastStrategyStatusLog = gameState.ai.elapsedTime;
		const prep = this.upcomingAttacks[AttackPlan.TYPE_RUSH] && this.upcomingAttacks[AttackPlan.TYPE_RUSH][0];
		const live = this.startedAttacks[AttackPlan.TYPE_RUSH] && this.startedAttacks[AttackPlan.TYPE_RUSH][0];
		let army = 0;
		let state = "waiting-barracks";
		if (live && live.unitCollection)
		{
			army = live.unitCollection.length;
			state = "launched";
		}
		else if (prep && prep.unitCollection)
		{
			army = prep.unitCollection.length;
			state = "arming";
		}
		const civilians = gameState.getOwnEntitiesByClass("Civilian", true).length;
		aiWarn("[EXPERT-STRATEGY] " + doctrine.id + " state=" + state +
			" civilians=" + civilians + " army=" + army + "/" + (Number(doctrine.rushSize) || 0));
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
					if (this.Config.difficulty >= difficulty.EXPERT && attackType === AttackPlan.TYPE_RUSH && doctrine)
					{
						attack.expertLaunchSize = attack.unitCollection.length;
						attack.expertLaunchTime = Number(gameState.ai.elapsedTime) || 0;
						attack.expertOwnLosses = 0;
						const pdata = gameState.sharedScript && gameState.sharedScript.playersData && gameState.sharedScript.playersData[attack.targetPlayer];
						attack.expertLaunchEnemyPopulation = pdata ? Math.max(0, Number(pdata.popCount) || 0) : 0;
						this.expertRushHasLaunched = true;
						aiWarn("[EXPERT-STRATEGY] launch=" + doctrine.id + " plan=" + attack.name +
							" army=" + attack.unitCollection.length + " target=" + attack.targetPlayer +
							" enemyPop=" + attack.expertLaunchEnemyPopulation);
					}
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
			const now = Number(gameState.ai.elapsedTime) || 0;
			if (Number(attack.expertTacticalRegroupUntil) > 0)
			{
				if (now < attack.expertTacticalRegroupUntil)
					continue;
				attack.expertTacticalRegroupUntil = -99999;
				attack.setPaused(false);
				aiWarn("[EXPERT-RUSH] RESUME plan=" + attack.name + " army=" + attack.unitCollection.length);
			}
			const failedRush = this.expertFailedRushDecision(gameState, attack);
			if (failedRush.regroup && this.startExpertTacticalRegroup(gameState, attack, failedRush))
				continue;
			if (failedRush.abort)
			{
				const policy = mergePolicy();
				const now = Number(gameState.ai.elapsedTime) || 0;
				this.expertRushRecoveryMode = true;
				this.expertRushRecoveryUntil = now + (Number(policy.expertRushRetreatCooldownSeconds) || 105);
				this.expertReboomUntil = Math.max(this.expertReboomUntil || -99999, this.expertRushRecoveryUntil);
				this.markExpertCombatRetreat(gameState, attack, failedRush.reason);
				const cancelled = this.cancelExpertFollowupPreparations(gameState);
				const b = failedRush.balance || {};
				aiWarn("[EXPERT-RUSH] ABORT plan=" + attack.name + " reason=" + failedRush.reason +
					" army=" + attack.unitCollection.length + "/" + attack.expertLaunchSize +
					" losses=" + failedRush.losses + " enemyDamage=" + failedRush.enemyDamage +
					" local=" + (b.ownCombat || 0) + "v" + (b.enemyCombat || 0) +
					" defenses=" + (b.defenses || 0) + " cancelled=" + cancelled +
					" recoveryUntil=" + Math.round(this.expertRushRecoveryUntil));
				attack.Abort(gameState);
				this.startedAttacks[attackType].splice(i--, 1);
				continue;
			}
			const brokenScreenRetreat = this.shouldExpertRetreatBrokenScreen(gameState, attack);
			if (brokenScreenRetreat)
			{
				const policy = mergePolicy();
				const now = Number(gameState.ai.elapsedTime) || 0;
				this.expertReboomUntil = Math.max(this.expertReboomUntil || -99999,
					now + (Number(policy.expertCombatScreenReboomSeconds) || 45));
				this.markExpertCombatRetreat(gameState, attack, "melee_screen_under_pressure");
				const cancelled = this.cancelExpertFollowupPreparations(gameState);
				const b = brokenScreenRetreat.balance || {};
				aiWarn("[EXPERT-REBOOM] screen-retreat plan=" + attack.name + " army=" + attack.unitCollection.length +
					" melee=" + brokenScreenRetreat.melee + " ranged=" + brokenScreenRetreat.ranged +
					" local=" + (b.ownCombat || 0) + "v" + (b.enemyCombat || 0) + " defenses=" + (b.defenses || 0) +
					" cancelled=" + cancelled + " until=" + Math.round(this.expertReboomUntil));
				attack.Abort(gameState);
				this.startedAttacks[attackType].splice(i--, 1);
				continue;
			}
			// IT14.45: peel critically wounded soldiers first and replace them with healthy
			// reinforcements.  A whole-army retreat is reserved for an actually collapsed push.
			this.peelExpertWoundedUnits(gameState, attack);
			const woundedWave = this.reinforceExpertWoundedReplacements(gameState, attack);
			if (!woundedWave)
				this.reinforceExpertPrimaryAttackWave(gameState, attack, expertFinishing);
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

	this.consolidateExpertSecondaryOffensives(gameState);
	this.updateExpertFinishingProgress(gameState, expertFinishing);
	// Siege trained for a healthy P3 push joins the field army before the opponent is
	// formally broken.  Finishing reinforcement can then top up the same plan.
	this.attachExpertSiegeToActiveAttack(gameState);
	if (expertFinishing)
		this.reinforceExpertFinishingAttack(gameState, expertFinishing);
	this.recoverExpertRamPassengers(gameState);
	this.manageExpertRamGarrisons(gameState, expertFinishing);

	// creating plans after updating because an aborted plan might be reused in that case.

	const expertPrimaryStarted = this.startedAttacks[AttackPlan.TYPE_DEFAULT].length +
		this.startedAttacks[AttackPlan.TYPE_HUGE_ATTACK].length;
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
				// IT14.47 Expert rushes are infantry timings.  Stock Petra's Rush plan
				// requires two FastMoving units, which Athens cannot reliably provide in
				// Village Phase and which caused the selected IT14.46 rush never to exist.
				// Lock the infantry target to the doctrine and make cavalry optional.
				if (this.Config.difficulty >= difficulty.EXPERT && doctrine)
				{
					const target = Math.max(12, Number(doctrine.rushSize) || 20);
					// IT14.50: Late P1 is a timing push, not an early gamble. Require 26/28
					// before it can leave; Early P1 remains deliberately more opportunistic.
					const minFraction = doctrine.id === "late_p1_rush" ? 0.93 : 0.78;
					const minTotal = Math.max(10, Math.min(target, Math.round(target * minFraction)));
					let screenLabel = "infantryMin=" + minTotal;
					if (gameState.getPlayerCiv() === "athen")
					{
						// IT14.54: Athens' rush is a screened infantry timing, not whatever 28
						// infantry happened to finish first. The 28-man Late P1 target becomes
						// 16 melee / 12 ranged, with a 15/11 minimum launch screen.
						const meleeShare = Number(mergePolicy().athensMeleeShare) || 0.58;
						const meleeTarget = Math.max(1, Math.min(target - 1, Math.round(target * meleeShare)));
						const rangedTarget = Math.max(1, target - meleeTarget);
						const meleeMin = Math.max(1, Math.min(meleeTarget, Math.round(minTotal * meleeShare)));
						const rangedMin = Math.max(1, Math.min(rangedTarget, minTotal - meleeMin));
						delete attackPlan.unitStat.Infantry;
						attackPlan.unitStat.MeleeInfantry = { "priority": 1.1, "minSize": meleeMin, "targetSize": meleeTarget, "batchSize": 2,
							"classes": ["Infantry+Melee+CitizenSoldier"], "interests": [["strength", 1], ["costsResource", 0.5, "stone"], ["costsResource", 0.6, "metal"]] };
						attackPlan.unitStat.RangedInfantry = { "priority": 1, "minSize": rangedMin, "targetSize": rangedTarget, "batchSize": 2,
							"classes": ["Infantry+Ranged+CitizenSoldier"], "interests": [["strength", 1], ["costsResource", 0.5, "stone"], ["costsResource", 0.6, "metal"]] };
						screenLabel = "screen=" + meleeTarget + "M/" + rangedTarget + "R min=" + meleeMin + "M/" + rangedMin + "R";
					}
					else if (attackPlan.unitStat.Infantry)
					{
						attackPlan.unitStat.Infantry.targetSize = target;
						attackPlan.unitStat.Infantry.minSize = minTotal;
					}
					if (attackPlan.unitStat.FastMoving)
						delete attackPlan.unitStat.FastMoving;
					aiWarn("[EXPERT-STRATEGY] create-rush=" + doctrine.id + " targetArmy=" + target + " " + screenLabel);
				}
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
		!(this.Config.difficulty >= difficulty.EXPERT && doctrine && Number(doctrine.rushes) > 0 &&
		  this.startedAttacks[AttackPlan.TYPE_RUSH].length > 0) &&
		unexecutedAttacks[AttackPlan.TYPE_DEFAULT] == 0 &&
		unexecutedAttacks[AttackPlan.TYPE_HUGE_ATTACK] == 0 &&
		(this.Config.difficulty >= difficulty.EXPERT ?
			expertPrimaryStarted === 0 :
			expertPrimaryStarted < Math.min(2, 1 + Math.round(gameState.getPopulationMax() / 100))) &&
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
		"expertReboomUntil": this.expertReboomUntil,
		"expertLastStrategyStatusLog": this.expertLastStrategyStatusLog,
		"expertRushRecoveryMode": this.expertRushRecoveryMode,
		"expertRushRecoveryUntil": this.expertRushRecoveryUntil,
		"expertRushHasLaunched": this.expertRushHasLaunched
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
