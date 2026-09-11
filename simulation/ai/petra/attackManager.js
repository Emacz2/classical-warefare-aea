import * as filters from "simulation/ai/common-api/filters.js";
import { aiWarn, SquareVectorDistance, VectorDistance } from "simulation/ai/common-api/utils.js";
import { AttackPlan } from "simulation/ai/petra/attackPlan.js";
import * as chat from "simulation/ai/petra/chatHelper.js";
import { Config } from "simulation/ai/petra/config.js";
import * as difficulty from "simulation/ai/petra/difficultyLevel.js";
import { allowCapture, getLandAccess } from "simulation/ai/petra/entityExtend.js";
import { mergePolicy } from "simulation/ai/petra/expertDecision/policy.js";
import { Worker } from "simulation/ai/petra/worker.js";

// IT14.62: "Siege" is a broad gameplay class and can legitimately appear on
// non-engine units. Expert's structure-finishing logic needs actual mechanical
// building wreckers instead of treating every Siege-tagged entity as a ram/pult.
function isExpertBuildingSiegeEntity(ent)
{
	if (!ent || !ent.hasClass || !ent.hasClass("Siege") || ent.hasClass("SiegeTower"))
		return false;
	if (ent.hasClass("Ram"))
		return true;
	return !ent.hasClass("Human") && !ent.hasClass("Infantry") &&
		!ent.hasClass("Cavalry") && !ent.hasClass("Organic");
}

function isExpertRamEntity(ent)
{
	return !!(ent && ent.hasClass && ent.hasClass("Siege") &&
		(ent.hasClass("Ram") || String(ent.genericName && ent.genericName() || "").toLowerCase().includes("ram")));
}

function expertAttackHasBuildingSiege(attack)
{
	if (!attack || !attack.unitCollection)
		return false;
	for (const ent of attack.unitCollection.values())
		if (isExpertBuildingSiegeEntity(ent))
			return true;
	return false;
}

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
	// IT14.63: a strategic retreat creates a concrete follow-up obligation. Generic
	// Petra plan creation proved capable of leaving 80+ reserve soldiers idle forever.
	this.expertReboomNeedsRelaunch = false;
	this.expertReboomTargetPlayer = undefined;
	this.expertLastReboomRelaunchLog = -99999;
	// IT14.83: strategic P2 retreats must teach the next attack something. A failed
	// 60-man wave now escalates the next commitment instead of recreating 60 forever.
	this.expertP2EscalationLevel = 0;
	this.expertP2EscalationTargetPlayer = undefined;
	// IT14.47: concise doctrine telemetry so a replay immediately shows whether a
	// selected P1 rush is merely arming, has launched, or has rolled into its P2 follow-up.
	this.expertLastStrategyStatusLog = -99999;
	// IT14.49: failed P1 rushes transition into an explicit recovery state rather
	// than dribbling fresh batches into the same lost engagement.
	this.expertRushRecoveryMode = false;
	this.expertRushRecoveryUntil = -99999;
	// IT14.56: remember the last P1 timing target/pop so the P2 follow-up can decide
	// whether the opponent is genuinely wounded rather than launching solely by army size.
	this.expertLastRushTargetPlayer = undefined;
	this.expertLastRushLaunchEnemyPopulation = 0;
	this.expertLastRushLaunchTime = -99999;
	this.expertLastAthensP1MeleeHoldLog = -99999;
	this.expertLastP1RushGateLog = -99999;
	// IT14.64: once Athens deliberately abandons an unupgraded Late-P1 timing, do not
	// let generic Rush creation immediately recreate the same bad plan.
	this.expertLateP1UnupgradedCancelled = false;
	// IT14.89: lightweight post-plan attack-move sweep state. AttackPlan itself is
	// intentionally untouched; this is an Expert-only final order correction.
	this.expertLastAttackMoveSweepAt = {};
	this.expertLastAttackMoveSweepLog = -99999;
	// IT14.90: manager-level CC finish lock. This deliberately lives outside
	// attackPlan.js so the normal strategic plan remains untouched.
	this.expertCCCaptureLock = undefined;
	this.expertCCCaptureSuppressedUntil = {};
	this.expertLastCCCaptureOrderAt = -99999;
	this.expertLastCCCaptureLog = -99999;
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

	// IT14.62: exact own-loss accounting now covers the main P2/P3 field army too.
	// Reinforcement waves otherwise hide a catastrophically bad exchange by keeping
	// the visible army near its target size while replacements continuously die.
	if (this.Config.difficulty >= difficulty.EXPERT)
		for (const evt of events.Destroy)
		{
			const planId = evt && evt.metadata && evt.metadata[PlayerID] && evt.metadata[PlayerID].plan;
			if (planId === undefined || !evt.entityObj || evt.entityObj.owner() !== PlayerID)
				continue;
			const plan = this.getPlan(planId);
			if (!plan || !plan.isStarted() ||
			    (plan.type !== AttackPlan.TYPE_RUSH && plan.type !== AttackPlan.TYPE_DEFAULT && plan.type !== AttackPlan.TYPE_HUGE_ATTACK))
				continue;
			plan.expertOwnLosses = Math.max(0, Number(plan.expertOwnLosses) || 0) + 1;
		}


	let answer = "decline";
	let other;
	let targetPlayer;
	for (const evt of events.AttackRequest)
	{
		// IT14.73: allied requests are advisory on Expert.  They may not retarget or
		// force-start the single Expert-owned combat plan.
		if (this.Config.difficulty >= difficulty.EXPERT)
			continue;
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
	if (!Number.isFinite(enemyPopulation) || enemyPopulation < 0 || enemyPopulation > maxEnemy ||
	    ownPopulation < minOwn || ownPopulation - enemyPopulation < minLead)
		return undefined;
	return { targetPlayer, enemyPopulation, ownPopulation };
};

// IT14.76: when the opponent is already strategically broken, ordinary casualty-ratio
// and reboom rules are no longer the primary objective. Keep the finishing army on task
// unless it has actually collapsed or is catastrophically outnumbered locally.
AttackManager.prototype.expertFinishingPersistenceDecision = function(gameState, attack, finishing)
{
	const out = { persist: false, catastrophic: false, balance: undefined };
	if (this.Config.difficulty < difficulty.EXPERT || !attack || !attack.isStarted() || !finishing ||
	    attack.targetPlayer !== finishing.targetPlayer)
		return out;
	const policy = mergePolicy();
	const army = attack.unitCollection ? attack.unitCollection.length : 0;
	const minArmy = Math.max(6, Number(policy.expertFinishingPersistMinimumArmy) || 14);
	const balance = this.expertRushLocalBalance(gameState, attack);
	out.balance = balance;
	const own = Math.max(0, Number(balance.ownCombat) || 0);
	const enemy = Math.max(0, Number(balance.enemyCombat) || 0);
	const ratio = Math.max(1.2, Number(policy.expertFinishingCatastrophicOutnumberRatio) || 2.2);
	const margin = Math.max(4, Number(policy.expertFinishingCatastrophicOutnumberMargin) || 10);
	const localCollapse = own > 0 && enemy >= Math.ceil(own * ratio) && enemy >= own + margin;
	out.catastrophic = army < minArmy || localCollapse;
	out.persist = !out.catastrophic;
	return out;
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
	// Athens can uniquely buy the first melee upgrade in Village. Count that real
	// completed advantage toward the follow-up package even though it did not pass
	// through the two Town-only observation queues above.
	const athensP1Melee = "citystate/city_state_attack_melee_01";
	if (gameState.getPlayerCiv && gameState.getPlayerCiv() === "athen" &&
	    gameState.isResearched && gameState.isResearched(athensP1Melee) &&
	    !Object.prototype.hasOwnProperty.call(this.expertObservedMilitaryTechs || {}, athensP1Melee))
		++completed;
	const active = completed + researching;
	if (doctrine && Number(doctrine.rushes) > 0)
	{
		const targetPlayer = Number.isFinite(Number(this.expertLastRushTargetPlayer)) ? Number(this.expertLastRushTargetPlayer) : this.currentEnemyPlayer;
		const pdata = Number.isFinite(Number(targetPlayer)) && gameState.sharedScript && gameState.sharedScript.playersData ?
			gameState.sharedScript.playersData[targetPlayer] : undefined;
		const enemyPop = pdata && pdata.state !== "defeated" ? Math.max(0, Number(pdata.popCount) || 0) : Infinity;
		const launchPop = Math.max(0, Number(this.expertLastRushLaunchEnemyPopulation) || 0);
		const damageFraction = launchPop > 0 && Number.isFinite(enemyPop) ? Math.max(0, (launchPop - enemyPop) / launchPop) : 0;
		const critical = Number.isFinite(enemyPop) && enemyPop <= (Number(policy.expertP2RushFollowupCriticalEnemyPopulation) || 30);
		const opportunity = critical || (Number.isFinite(enemyPop) && enemyPop <= (Number(policy.expertP2RushFollowupWeakEnemyPopulation) || 42)) ||
			(launchPop > 0 && damageFraction >= (Number(policy.expertP2RushFollowupDamageFraction) || 0.20));
		if (critical)
			return { ready: true, completed, researching, active, required: 0, mode: "rush-followup", opportunity: "critical-pop", enemyPop, launchPop };
		if (opportunity)
		{
			const required = Math.max(0, Number(policy.expertP2RushFollowupOpportunityActiveTechs) || 1);
			return { ready: active >= required, completed, researching, active, required, mode: "rush-followup",
				opportunity: enemyPop <= policy.expertP2RushFollowupWeakEnemyPopulation ? "weak-pop" : "rush-damage", enemyPop, launchPop };
		}
		const requiredCompleted = Math.max(0, Number(policy.expertP2RushFollowupCompletedMilitaryTechs) || 1);
		const requiredActive = Math.max(requiredCompleted, Number(policy.expertP2RushFollowupActiveMilitaryTechs) || 2);
		return { ready: completed >= requiredCompleted && active >= requiredActive, completed, researching, active,
			required: requiredActive, mode: "rush-followup", opportunity: "stable-enemy", enemyPop, launchPop };
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
		if (isExpertBuildingSiegeEntity(ent))
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
		    isExpertBuildingSiegeEntity(ent) || !ent.healthLevel || ent.healthLevel() > threshold)
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
		if (!ent || !ent.position() || !ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry") || isExpertBuildingSiegeEntity(ent) ||
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
	if (this.expertBadExchangeDecision(gameState, attack).abort)
		return 0;
	const baseTargetArmy = Math.max(20, Number(policy.expertPrimaryOffensiveTargetArmy) || 50);
	const waveMin = Math.max(1, Number(policy.expertPrimaryReinforcementWaveMinimum) || 6);
	if (now < (Number(attack.expertLastPrimaryReinforcementWave) || -99999) +
	    (Number(policy.expertPrimaryReinforcementWaveCooldownSeconds) || 16))
		return 0;
	const reserve = Math.max(0, Number(policy.expertWoundedReplacementHomeReserve) || 12);
	const candidates = [];
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position() || !ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry") || isExpertBuildingSiegeEntity(ent) ||
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
	// IT14.69: 40-60 healthy unassigned citizen-soldiers at home are not a reserve,
	// they are an unused second army. Keep one coherent attack, but raise its target
	// while the live exchange remains favorable.
	let targetArmy = baseTargetArmy;
	if (available >= (Number(policy.expertPrimaryOffensiveFloodReserveThreshold) || 30))
		targetArmy = Math.max(targetArmy, Number(policy.expertPrimaryOffensiveFloodTargetArmy) || 78);
	else if (available >= (Number(policy.expertPrimaryOffensiveSurplusReserveThreshold) || 18))
		targetArmy = Math.max(targetArmy, Number(policy.expertPrimaryOffensiveSurplusTargetArmy) || 68);
	const deficit = targetArmy - attack.unitCollection.length;
	if (deficit < waveMin)
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

// IT14.65: newly-trained champions are combat assets, not a home reserve.  Attach
// healthy unassigned premium infantry directly to the largest active offensive even if
// that army is already above the normal citizen-soldier reinforcement target.
AttackManager.prototype.attachExpertPremiumUnitsToActiveAttack = function(gameState)
{
	if (this.Config.difficulty < difficulty.EXPERT || gameState.ai.playedTurn % 5 !== 0)
		return 0;
	let attack;
	for (const type of [AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK, AttackPlan.TYPE_RUSH])
		for (const plan of this.startedAttacks[type] || [])
			if (plan && plan.targetPlayer !== undefined && (!attack || plan.unitCollection.length > attack.unitCollection.length))
				attack = plan;
	if (!attack || this.expertBadExchangeDecision(gameState, attack).abort)
		return 0;
	const policy = mergePolicy();
	const minimumHealth = Math.max(0.25, Math.min(1, Number(policy.expertPremiumReinforcementHealth) || 0.75));
	const activePlanNames = new Set();
	for (const type of [AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK, AttackPlan.TYPE_RUSH, AttackPlan.TYPE_RAID])
		for (const plan of this.startedAttacks[type] || [])
			if (plan) activePlanNames.add(Number(plan.name));
	const candidates = [];
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position() || !ent.hasClass("Champion") || ent.hasClass("Hero") || ent.hasClass("Support") ||
		    isExpertBuildingSiegeEntity(ent) || !ent.attackTypes || !ent.attackTypes() || !ent.healthLevel || ent.healthLevel() < minimumHealth ||
		    ent.getMetadata(PlayerID, "expertWoundedReturnUntil") !== undefined || ent.getMetadata(PlayerID, "expertCombatRetreatUntil") !== undefined ||
		    ent.getMetadata(PlayerID, "expertDecisionTaskId") !== undefined || ent.getMetadata(PlayerID, "expertDefenseMobilized") !== undefined ||
		    ent.getMetadata(PlayerID, "garrisonHolder") !== undefined)
			continue;
		const plan = ent.getMetadata(PlayerID, "plan");
		// IT14.67: an upcoming/dormant Petra plan does not get to warehouse Champions
		// while a real offensive is already fighting. Preserve units owned by another
		// STARTED attack, but steal stale/upcoming assignments into the live army.
		if (plan !== undefined && plan !== -1 && Number(plan) !== Number(attack.name) && activePlanNames.has(Number(plan)))
			continue;
		if (Number(plan) === Number(attack.name))
			continue;
		candidates.push(ent);
	}
	if (!candidates.length)
		return 0;
	const rally = attack.position && Number.isFinite(attack.position[0]) ? attack.position : attack.targetPos;
	candidates.sort((a, b) => {
		const da = rally ? SquareVectorDistance(a.position(), rally) : 0;
		const db = rally ? SquareVectorDistance(b.position(), rally) : 0;
		return da - db || b.healthLevel() - a.healthLevel() || a.id() - b.id();
	});
	const batch = Math.min(candidates.length, Math.max(1, Number(policy.expertPremiumReinforcementBatch) || 8));
	let added = 0;
	for (const ent of candidates.slice(0, batch))
		if (attack.addExpertReinforcement && attack.addExpertReinforcement(gameState, ent))
			++added;
	if (added)
		aiWarn("[EXPERT-PREMIUM] reinforced plan=" + attack.name + " added=" + added +
			" army=" + attack.unitCollection.length + " waiting=" + Math.max(0, candidates.length - added));
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
		if (added >= 2 || !ent || !ent.position() || !isExpertBuildingSiegeEntity(ent))
			continue;
		const plan = ent.getMetadata(PlayerID, "plan");
		if (plan !== undefined && plan !== -1)
			continue;
		if (attack.addExpertReinforcement && attack.addExpertReinforcement(gameState, ent))
			++added;
	}
	if (added)
	{
		let rams = 0;
		for (const ent of attack.unitCollection.values())
			if (isExpertRamEntity(ent)) ++rams;
		aiWarn((rams ? "[EXPERT-RAM]" : "[EXPERT-SIEGE]") + " attached-engine plan=" + attack.name +
			" added=" + added + " army=" + attack.unitCollection.length + " rams=" + rams);
	}
	return added;
};

// IT14.88: healer support is deliberately OUTSIDE AttackPlan.unitCollection.  That
// means two/three healers do not satisfy launch-size or local-combat thresholds and
// AttackPlan never tries to issue attack orders to a support unit.  They simply trail
// the largest live Expert offensive and auto-heal from a defensive stance.
AttackManager.prototype.coordinateExpertHealerEscort = function(gameState)
{
	if (this.Config.difficulty < difficulty.EXPERT)
		return 0;
	const policy = mergePolicy();
	const now = Number(gameState.ai.elapsedTime) || 0;
	const interval = Math.max(1, Number(policy.expertHealerEscortUpdateSeconds) || 3);
	if (now < (Number(this.expertLastHealerEscortUpdate) || -99999) + interval)
		return 0;
	this.expertLastHealerEscortUpdate = now;
	let attack;
	for (const type of [AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK, AttackPlan.TYPE_RUSH])
		for (const plan of this.startedAttacks[type] || [])
			if (plan && plan.targetPlayer !== undefined && plan.unitCollection && plan.unitCollection.hasEntities &&
			    plan.unitCollection.hasEntities() && (!attack || plan.unitCollection.length > attack.unitCollection.length))
				attack = plan;
	if (!attack)
		return 0;
	const centre = attack.unitCollection.getCentrePosition && attack.unitCollection.getCentrePosition() || attack.position || attack.rallyPoint;
	if (!centre)
		return 0;
	const behind = Math.max(6, Number(policy.expertHealerEscortBehindDistance) || 14);
	const leash = Math.max(20, Number(policy.expertHealerEscortLeashDistance) || 42);
	const target = attack.targetPos || centre;
	let dx = centre[0] - target[0], dz = centre[1] - target[1];
	let len = Math.hypot(dx, dz);
	if (!len) { dx = 1; dz = 0; len = 1; }
	const escort = [centre[0] + dx / len * behind, centre[1] + dz / len * behind];
	let moved = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position || !ent.position() || !ent.hasClass || !ent.hasClass("Healer"))
			continue;
		if (ent.getMetadata && ent.getMetadata(PlayerID, "garrisonHolder") !== undefined)
			continue;
		const plan = ent.getMetadata ? ent.getMetadata(PlayerID, "plan") : undefined;
		if (plan !== undefined && plan !== -1)
			continue;
		if (ent.setMetadata)
			ent.setMetadata(PlayerID, "expertHealerEscortPlan", attack.name);
		if (ent.getStance && ent.setStance && ent.getStance() !== "defensive")
			ent.setStance("defensive");
		const armyDistance = Math.sqrt(SquareVectorDistance(ent.position(), centre));
		const state = ent.unitAIState ? String(ent.unitAIState() || "") : "";
		// Do not interrupt an in-range heal just to make the support line cosmetically exact.
		if (armyDistance <= leash && state.includes("HEAL"))
			continue;
		if (SquareVectorDistance(ent.position(), escort) <= 10 * 10)
			continue;
		if (ent.moveToRange)
		{
			ent.moveToRange(escort[0], escort[1], 0, 8);
			++moved;
		}
	}
	if (moved && (Number(gameState.ai.elapsedTime) || 0) >= (Number(this.expertLastHealerEscortLog) || -99999) + 15)
	{
		this.expertLastHealerEscortLog = Number(gameState.ai.elapsedTime) || 0;
		aiWarn("[EXPERT-HEAL] escort plan=" + attack.name + " moved=" + moved +
			" army=" + attack.unitCollection.length + " behind=" + Math.round(behind));
	}
	return moved;
};

// IT14.90: decisive CC capture lock plus narrower front-contact attack-move correction.
// attackPlan.js remains unchanged; these are Expert-only post-plan order corrections.
AttackManager.prototype.coordinateExpertCCCaptureFinish = function(gameState, finishing)
{
	if (this.Config.difficulty < difficulty.EXPERT || !finishing)
	{
		this.expertCCCaptureLock = undefined;
		return 0;
	}
	const policy = mergePolicy();
	const now = Number(gameState.ai.elapsedTime) || 0;
	let attack;
	for (const type of [AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK, AttackPlan.TYPE_RUSH, AttackPlan.TYPE_RAID])
		for (const plan of this.startedAttacks[type] || [])
			if (plan && plan.isStarted && plan.isStarted() && !plan.isPaused() &&
			    plan.targetPlayer === finishing.targetPlayer &&
			    (!attack || plan.unitCollection.length > attack.unitCollection.length))
				attack = plan;
	if (!attack || !attack.unitCollection || attack.unitCollection.length <
	    Math.max(1, Number(policy.expertCCCaptureFinishMinimumArmy) || 70))
	{
		this.expertCCCaptureLock = undefined;
		return 0;
	}

	const centre = attack.unitCollection.getCentrePosition && attack.unitCollection.getCentrePosition() || attack.position || attack.targetPos;
	if (!centre)
		return 0;
	let cc;
	let ccDist = Infinity;
	for (const struct of gameState.getEnemyStructures(finishing.targetPlayer).values())
	{
		if (!struct || !struct.position || !struct.position() || !struct.hasClass || !struct.hasClass("CivCentre") ||
		    !struct.capturePoints || !struct.capturePoints())
			continue;
		const dist = SquareVectorDistance(centre, struct.position());
		if (dist < ccDist)
		{
			ccDist = dist;
			cc = struct;
		}
	}
	const approach = Math.max(40, Number(policy.expertCCCaptureFinishApproachRadius) || 92);
	if (!cc || ccDist > approach * approach)
	{
		this.expertCCCaptureLock = undefined;
		return 0;
	}
	const suppressed = Number(this.expertCCCaptureSuppressedUntil && this.expertCCCaptureSuppressedUntil[cc.id()]) || -99999;
	if (now < suppressed)
	{
		this.expertCCCaptureLock = undefined;
		return 0;
	}

	const screenRadius = Math.max(25, Number(policy.expertCCCaptureFinishScreenRadius) || 68);
	const screenRadius2 = screenRadius * screenRadius;
	const enemyScreen = [];
	for (const enemy of gameState.getEnemyUnits(finishing.targetPlayer).values())
	{
		if (!enemy || !enemy.position || !enemy.position() || enemy.hasClass && enemy.hasClass("Animal"))
			continue;
		const attacks = enemy.attackTypes && enemy.attackTypes();
		if (!attacks || SquareVectorDistance(enemy.position(), cc.position()) > screenRadius2)
			continue;
		enemyScreen.push(enemy);
	}

	const capturers = [];
	const fighters = [];
	const approach2 = approach * approach;
	for (const ent of attack.unitCollection.values())
	{
		if (!ent || !ent.position || !ent.position() || isExpertBuildingSiegeEntity(ent) ||
		    ent.hasClass && (ent.hasClass("Support") || ent.hasClass("Ship")) ||
		    ent.getMetadata && (ent.getMetadata(PlayerID, "garrisonHolder") !== undefined ||
		    ent.getMetadata(PlayerID, "expertWoundedReturnUntil") !== undefined ||
		    ent.getMetadata(PlayerID, "expertCombatRetreatUntil") !== undefined) ||
		    SquareVectorDistance(ent.position(), cc.position()) > approach2)
			continue;
		if (ent.attackTypes && ent.attackTypes())
			fighters.push(ent);
		if (ent.canCapture && ent.canCapture(cc) && ent.canAttackTarget && ent.canAttackTarget(cc, true))
			capturers.push(ent);
	}
	const minCapturers = Math.max(1, Number(policy.expertCCCaptureFinishMinimumCapturers) || 24);
	if (capturers.length < minCapturers)
	{
		this.expertCCCaptureLock = undefined;
		return 0;
	}
	const maxScreen = Math.max(0, Number(policy.expertCCCaptureFinishMaximumScreenUnits) || 6);
	const maxScreenFraction = Math.max(0.02, Math.min(0.5, Number(policy.expertCCCaptureFinishMaximumScreenFraction) || 0.15));
	if (enemyScreen.length > maxScreen || enemyScreen.length > Math.ceil(capturers.length * maxScreenFraction))
	{
		this.expertCCCaptureLock = undefined;
		return 0;
	}

	let lock = this.expertCCCaptureLock;
	const points = cc.capturePoints ? cc.capturePoints() : undefined;
	const ours = Array.isArray(points) ? Math.max(0, Number(points[PlayerID]) || 0) : 0;
	if (!lock || Number(lock.plan) !== Number(attack.name) || Number(lock.targetId) !== Number(cc.id()))
	{
		lock = { plan: attack.name, targetId: cc.id(), targetPlayer: finishing.targetPlayer,
			startedAt: now, lastCapture: ours, progressCapture: ours, lastProgressAt: now };
		this.expertCCCaptureLock = lock;
		aiWarn("[EXPERT-CAPTURE-FINISH] LOCK plan=" + attack.name + " cc=" + cc.id() +
			" army=" + attack.unitCollection.length + " capturers=" + capturers.length + " screen=" + enemyScreen.length);
	}
	else
	{
		const progressPoints = Math.max(0.5, Number(policy.expertCCCaptureFinishProgressPoints) || 2);
		if (ours >= (Number(lock.progressCapture) || 0) + progressPoints)
		{
			lock.lastProgressAt = now;
			lock.progressCapture = ours;
		}
		lock.lastCapture = ours;
	}
	const stall = Math.max(6, Number(policy.expertCCCaptureFinishStallSeconds) || 18);
	if (now - (Number(lock.lastProgressAt) || now) >= stall)
	{
		const retry = Math.max(8, Number(policy.expertCCCaptureFinishRetryDelaySeconds) || 24);
		this.expertCCCaptureSuppressedUntil[cc.id()] = now + retry;
		this.expertCCCaptureLock = undefined;
		aiWarn("[EXPERT-CAPTURE-FINISH] STALLED cc=" + cc.id() + " capture=" + Math.round(ours) +
			" release=destroy retry=" + Math.round(retry));
		return 0;
	}

	attack.target = cc;
	attack.targetPlayer = cc.owner();
	attack.targetPos = cc.position();
	const interval = Math.max(0.75, Number(policy.expertCCCaptureFinishOrderIntervalSeconds) || 1.75);
	if (now < (Number(this.expertLastCCCaptureOrderAt) || -99999) + interval)
		return capturers.length;
	this.expertLastCCCaptureOrderAt = now;

	// A handful of surviving defenders get a handful of killers. Do NOT send the
	// whole army after one unit; everybody else stays on the decisive capture.
	const screenersPerEnemy = Math.max(1, Number(policy.expertCCCaptureFinishScreenersPerEnemy) || 3);
	const assignedScreeners = new Set();
	for (const enemy of enemyScreen)
	{
		const candidates = fighters.filter(ent => !assignedScreeners.has(ent.id()) && ent.canAttackTarget && ent.canAttackTarget(enemy, false));
		candidates.sort((a, b) => SquareVectorDistance(a.position(), enemy.position()) - SquareVectorDistance(b.position(), enemy.position()) || a.id() - b.id());
		for (const ent of candidates.slice(0, screenersPerEnemy))
		{
			ent.attack(enemy.id(), false);
			assignedScreeners.add(ent.id());
		}
	}
	let orderedCapture = 0;
	for (const ent of capturers)
	{
		if (assignedScreeners.has(ent.id()))
			continue;
		const orders = ent.unitAIOrderData ? ent.unitAIOrderData() || [] : [];
		const currentTarget = orders.length && orders[0].target;
		if (Number(currentTarget) === Number(cc.id()) && String(ent.unitAIState && ent.unitAIState() || "").includes("COMBAT"))
			continue;
		ent.attack(cc.id(), true);
		++orderedCapture;
	}
	if (now - (Number(this.expertLastCCCaptureLog) || -99999) >= 5)
	{
		this.expertLastCCCaptureLog = now;
		aiWarn("[EXPERT-CAPTURE-FINISH] order plan=" + attack.name + " cc=" + cc.id() +
			" capture=" + orderedCapture + " screeners=" + assignedScreeners.size +
			" enemyScreen=" + enemyScreen.length + " points=" + Math.round(ours));
	}
	return orderedCapture;
};

// IT14.90: attack-move remains useful while travelling into a real defending screen,
// but only the front-contact portion of the army is redirected. A 1-2 unit nuisance
// screen is ignored here, and a live CC capture lock always wins.
AttackManager.prototype.coordinateExpertAttackMoveSweep = function(gameState)
{
	if (this.Config.difficulty < difficulty.EXPERT)
		return 0;
	const policy = mergePolicy();
	const now = Number(gameState.ai.elapsedTime) || 0;
	const interval = Math.max(0.75, Number(policy.expertAttackMoveSweepIntervalSeconds) || 1.75);
	const radius = Math.max(20, Number(policy.expertAttackMoveSweepRadius) || 58);
	const radius2 = radius * radius;
	const engagement = Math.max(12, Number(policy.expertAttackMoveSweepEngagementRadius) || 42);
	const engagement2 = engagement * engagement;
	const dotMinimum = Number.isFinite(Number(policy.expertAttackMoveSweepForwardDotMinimum)) ?
		Number(policy.expertAttackMoveSweepForwardDotMinimum) : -0.05;
	const minimumEnemies = Math.max(1, Number(policy.expertAttackMoveSweepMinimumEnemyUnits) || 3);
	const unitsPerEnemy = Math.max(1, Number(policy.expertAttackMoveSweepUnitsPerEnemy) || 3);
	const maxFraction = Math.max(0.1, Math.min(1, Number(policy.expertAttackMoveSweepMaximumArmyFraction) || 0.55));
	let redirectedTotal = 0;
	for (const type of [AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK, AttackPlan.TYPE_RUSH])
		for (const attack of this.startedAttacks[type] || [])
		{
			if (!attack || !attack.isStarted || !attack.isStarted() || attack.isPaused && attack.isPaused() ||
			    attack.targetPlayer === undefined || !attack.unitCollection || !attack.unitCollection.hasEntities || !attack.unitCollection.hasEntities())
				continue;
			if (this.expertCCCaptureLock && Number(this.expertCCCaptureLock.plan) === Number(attack.name))
				continue;
			const key = String(attack.name);
			if (now < (Number(this.expertLastAttackMoveSweepAt[key]) || -99999) + interval)
				continue;
			const centre = attack.unitCollection.getCentrePosition && attack.unitCollection.getCentrePosition() || attack.position || attack.targetPos;
			const destination = attack.targetPos || attack.target && attack.target.position && attack.target.position();
			if (!centre || !destination)
				continue;
			let dx = destination[0] - centre[0], dz = destination[1] - centre[1];
			const forwardLength = Math.hypot(dx, dz);
			if (forwardLength < 1)
				continue;
			dx /= forwardLength; dz /= forwardLength;

			const enemiesAhead = [];
			for (const enemy of gameState.getEnemyUnits(attack.targetPlayer).values())
			{
				if (!enemy || !enemy.position || !enemy.position() || enemy.hasClass && enemy.hasClass("Animal"))
					continue;
				const attacks = enemy.attackTypes && enemy.attackTypes();
				if (!attacks)
					continue;
				const ep = enemy.position();
				const ex = ep[0] - centre[0], ez = ep[1] - centre[1];
				const d2 = ex*ex + ez*ez;
				if (d2 > radius2 || d2 < 1)
					continue;
				const dot = (ex * dx + ez * dz) / Math.sqrt(d2);
				if (dot >= dotMinimum)
					enemiesAhead.push(enemy);
			}
			if (enemiesAhead.length < minimumEnemies)
				continue;
			this.expertLastAttackMoveSweepAt[key] = now;

			const candidates = [];
			for (const ent of attack.unitCollection.values())
			{
				if (!ent || !ent.position || !ent.position() || !ent.attackMove || isExpertBuildingSiegeEntity(ent) ||
				    ent.hasClass && (ent.hasClass("Support") || ent.hasClass("Ship")))
					continue;
				if (ent.getMetadata && (ent.getMetadata(PlayerID, "garrisonHolder") !== undefined ||
				    ent.getMetadata(PlayerID, "expertWoundedReturnUntil") !== undefined ||
				    ent.getMetadata(PlayerID, "expertCombatRetreatUntil") !== undefined))
					continue;
				if (!(ent.attackTypes && ent.attackTypes()))
					continue;
				const orders = ent.unitAIOrderData ? ent.unitAIOrderData() || [] : [];
				const currentTarget = orders.length && orders[0].target ? gameState.getEntityById(orders[0].target) : undefined;
				if (currentTarget && currentTarget.hasClass && currentTarget.hasClass("Unit") &&
				    currentTarget.owner && gameState.isPlayerEnemy(currentTarget.owner()))
					continue;
				let nearest = Infinity;
				for (const enemy of enemiesAhead)
					nearest = Math.min(nearest, SquareVectorDistance(ent.position(), enemy.position()));
				if (nearest > engagement2)
					continue;
				candidates.push({ ent, nearest });
			}
			if (!candidates.length)
				continue;
			candidates.sort((a, b) => a.nearest - b.nearest || a.ent.id() - b.ent.id());
			const capByEnemies = Math.max(minimumEnemies, enemiesAhead.length * unitsPerEnemy);
			const capByArmy = Math.max(1, Math.ceil(attack.unitCollection.length * maxFraction));
			const redirectCount = Math.min(candidates.length, capByEnemies, capByArmy);
			for (const item of candidates.slice(0, redirectCount))
				item.ent.attackMove(destination[0], destination[1], { "attack": ["Unit"], "avoid": ["Support", "Domestic", "Ship"] });
			redirectedTotal += redirectCount;
			if (redirectCount && now - (Number(this.expertLastAttackMoveSweepLog) || -99999) >= 6)
			{
				this.expertLastAttackMoveSweepLog = now;
				aiWarn("[EXPERT-ATTACK-MOVE] contact plan=" + attack.name + " enemiesAhead=" + enemiesAhead.length +
					" redirected=" + redirectCount + " eligible=" + candidates.length + " army=" + attack.unitCollection.length);
			}
		}
	return redirectedTotal;
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

// IT14.65: a selected P1 rush is an opportunity, not an obligation.  Before the
// army leaves the economy, compare the ready force to the visible military defending
// the chosen target and require Athens' Village melee upgrade when that tech exists.
AttackManager.prototype.expertP1RushLaunchDecision = function(gameState, attack)
{
	if (this.Config.difficulty < difficulty.EXPERT || !attack)
		return { launch: true, reason: "not-expert" };
	const doctrine = gameState.ai.HQ && gameState.ai.HQ.expertDoctrine;
	if (!doctrine || (doctrine.id !== "early_p1_rush" && doctrine.id !== "late_p1_rush"))
		return { launch: true, reason: "no-doctrine" };
	const policy = mergePolicy();
	const now = Number(gameState.ai.elapsedTime) || 0;
	const phase = gameState.currentPhase ? gameState.currentPhase() : 1;
	const deadline = doctrine.id === "early_p1_rush" ?
		(Number(policy.expertEarlyP1RushOpportunityDeadline) || 450) :
		(Number(policy.expertLateP1RushOpportunityDeadline) || 480);
	if (phase > 1)
		return { launch: false, cancel: true, reason: "phase2-transition" };

	// IT14.66: Athens has two legitimate P1 timing packages. Melee-I remains the
	// direct-combat route, while an already-finished Hoplite Tradition means the rush
	// deliberately paid for faster/cheaper mass instead of a Forge detour.
	let upgradeReady = true;
	let upgradeLabel = "n/a";
	const civ = gameState.getPlayerCiv && gameState.getPlayerCiv();
	const greekHopliteCiv = civ === "athen" || civ === "spart" || civ === "theb";
	const tradition = greekHopliteCiv && !!(gameState.isResearched && gameState.isResearched("citystate/hoplite_tradition"));
	const traditionQueue = gameState.ai && gameState.ai.queues && gameState.ai.queues.expertHopliteTradition;
	const traditionPending = greekHopliteCiv && !tradition && (
		!!(gameState.isResearching && gameState.isResearching("citystate/hoplite_tradition")) ||
		!!(traditionQueue && traditionQueue.hasQueuedUnits && traditionQueue.hasQueuedUnits()));
	if (civ === "athen")
	{
		const melee = !!(gameState.isResearched && gameState.isResearched("citystate/city_state_attack_melee_01"));
		upgradeReady = melee || tradition;
		upgradeLabel = melee ? "melee" : tradition ? "hoplite" : traditionPending ? "hoplite-pending" : "missing";
	}
	else if (traditionPending)
	{
		// Sparta/Thebes do not require a Forge package, but once they voluntarily pay
		// the P1 Tradition cost, do not launch before the 60-second production tech lands.
		upgradeReady = false;
		upgradeLabel = "hoplite-pending";
	}
	else if (tradition)
		upgradeLabel = "hoplite";

	if ((!attack.target || !attack.targetPos || attack.targetPlayer === undefined) && attack.chooseTarget)
		attack.chooseTarget(gameState);
	if (!attack.targetPos || attack.targetPlayer === undefined)
	{
		if (now >= deadline)
			return { launch: false, cancel: true, reason: "no-scouted-target" };
		return { launch: false, reason: "no-scouted-target" };
	}

	let attackers = 0;
	for (const ent of attack.unitCollection.values())
	{
		if (!ent || !ent.position() || isExpertBuildingSiegeEntity(ent) || ent.hasClass("Animal") || ent.hasClass("Support") && !ent.hasClass("Soldier"))
			continue;
		if (ent.attackTypes && ent.attackTypes())
			++attackers;
	}
	const radius2 = Math.pow(Number(policy.expertP1RushDefenderRadius) || 95, 2);
	let defenders = 0;
	let knownEnemyCombat = 0;
	for (const ent of gameState.getEnemyUnits(attack.targetPlayer).values())
	{
		if (!ent || !ent.position() || ent.hasClass("Animal") || !(ent.attackTypes && ent.attackTypes()) || ent.hasClass("Support") && !ent.hasClass("Soldier"))
			continue;
		++knownEnemyCombat;
		if (SquareVectorDistance(ent.position(), attack.targetPos) <= radius2)
			++defenders;
	}
	let staticDefenses = 0;
	for (const ent of gameState.getEnemyStructures(attack.targetPlayer).values())
	{
		if (!ent || !ent.position() || SquareVectorDistance(ent.position(), attack.targetPos) > radius2)
			continue;
		if (ent.hasClass("CivCentre") || ent.hasClass("Tower") || ent.hasClass("Fortress") || ent.hasClass("WallTower"))
			++staticDefenses;
	}
	const equivalentDefenders = defenders + staticDefenses * Math.max(0, Number(policy.expertP1RushStaticDefenseEquivalent) || 3);
	const ratio = Math.max(1.01, Number(policy.expertP1RushLaunchAdvantageRatio) || 1.15);
	const lead = Math.max(1, Number(policy.expertP1RushLaunchMinimumLead) || 2);
	const localNeeded = equivalentDefenders > 0 ? Math.max(equivalentDefenders + lead, Math.ceil(equivalentDefenders * ratio)) : 0;
	const targetIsCC = !!(attack.target && attack.target.hasClass && attack.target.hasClass("CivCentre"));
	const mainBase = targetIsCC || staticDefenses > 0;
	const knownArmyNeeded = mainBase ? Math.ceil(knownEnemyCombat * Math.max(1, Number(policy.expertP1TimingKnownArmyRatio) || 1.05)) : 0;
	const pdata = gameState.sharedScript && gameState.sharedScript.playersData ? gameState.sharedScript.playersData[attack.targetPlayer] : undefined;
	const enemyPop = pdata && pdata.state !== "defeated" ? Math.max(0, Number(pdata.popCount) || 0) : 0;
	const popSafe = !mainBase || enemyPop <= attackers * Math.max(1.1, Number(policy.expertP1TimingMainBaseEnemyPopPerAttacker) || 1.60);
	const favorable = attackers > 0 && attackers >= localNeeded && attackers >= knownArmyNeeded && popSafe;
	const logEvery = Math.max(5, Number(policy.expertP1RushGateLogSeconds) || 12);
	const shouldLog = now >= (Number(this.expertLastP1RushGateLog) || -99999) + logEvery;

	if (!upgradeReady || !favorable)
	{
		const reason = !upgradeReady ? "timing-package" : !popSafe ? "enemy-pop-risk" :
			attackers < knownArmyNeeded ? "enemy-mobile-army" : "no-local-advantage";
		if (now >= deadline)
		{
			if (shouldLog)
			{
				this.expertLastP1RushGateLog = now;
				aiWarn("[EXPERT-RUSH-GATE] cancel plan=" + attack.name + " strategy=" + doctrine.id +
					" reason=" + reason + " army=" + attackers + " defenders=" + defenders +
					" knownEnemy=" + knownEnemyCombat + " enemyPop=" + enemyPop + " static=" + staticDefenses +
					" needed=" + Math.max(localNeeded, knownArmyNeeded) + " package=" + upgradeLabel +
					" deadline=" + Math.round(deadline));
			}
			return { launch: false, cancel: true, reason, attackers, defenders, knownEnemyCombat, enemyPop, staticDefenses,
				needed: Math.max(localNeeded, knownArmyNeeded), upgradeReady };
		}
		if (shouldLog)
		{
			this.expertLastP1RushGateLog = now;
			aiWarn("[EXPERT-RUSH-GATE] hold plan=" + attack.name + " strategy=" + doctrine.id +
				" reason=" + reason + " army=" + attackers + " defenders=" + defenders +
				" knownEnemy=" + knownEnemyCombat + " enemyPop=" + enemyPop + " static=" + staticDefenses +
				" needed=" + Math.max(localNeeded, knownArmyNeeded) + " package=" + upgradeLabel +
				" deadline=" + Math.round(deadline));
		}
		return { launch: false, reason, attackers, defenders, knownEnemyCombat, enemyPop, staticDefenses,
			needed: Math.max(localNeeded, knownArmyNeeded), upgradeReady };
	}
	if (shouldLog)
	{
		this.expertLastP1RushGateLog = now;
		aiWarn("[EXPERT-RUSH-GATE] launch plan=" + attack.name + " strategy=" + doctrine.id +
			" army=" + attackers + " defenders=" + defenders + " knownEnemy=" + knownEnemyCombat +
			" enemyPop=" + enemyPop + " static=" + staticDefenses + " needed=" + Math.max(localNeeded, knownArmyNeeded) +
			" package=" + upgradeLabel);
	}
	return { launch: true, reason: "advantage", attackers, defenders, knownEnemyCombat, enemyPop, staticDefenses,
		needed: Math.max(localNeeded, knownArmyNeeded), upgradeReady };
};

// IT14.66 closes the second P1-launch path that IT14.65 did not cover: a normal
// AttackPlan could force-start merely because Town Phase was researching.  This gate
// compares that army with the opponent's known mobile force and the selected target's
// defenses.  If the main base is too risky, it may retarget a genuinely exposed
// economic structure; otherwise it waits and becomes a proper P2 attack.
AttackManager.prototype.expertP1TimingWindowDecision = function(gameState, attack)
{
	if (this.Config.difficulty < difficulty.EXPERT || !attack)
		return { launch: true, reason: "not-expert" };
	if ((!attack.target || !attack.targetPos || attack.targetPlayer === undefined) && attack.chooseTarget)
		attack.chooseTarget(gameState);
	if (!attack.targetPos || attack.targetPlayer === undefined)
		return { launch: false, reason: "no-target" };

	const policy = mergePolicy();
	const now = Number(gameState.ai.elapsedTime) || 0;
	let attackers = 0;
	for (const ent of attack.unitCollection.values())
		if (ent && ent.position() && !isExpertBuildingSiegeEntity(ent) && !ent.hasClass("Animal") &&
		    ent.attackTypes && ent.attackTypes() && (!ent.hasClass("Support") || ent.hasClass("Soldier")))
			++attackers;
	if (!attackers)
		return { launch: false, reason: "no-army" };

	const targetRadius2 = Math.pow(Number(policy.expertP1TimingTargetDefenderRadius) || 95, 2);
	const defenseRadius2 = Math.pow(Number(policy.expertP1TimingExposedDefenseRadius) || 75, 2);
	const targetMetrics = pos => {
		let defenders = 0;
		for (const ent of gameState.getEnemyUnits(attack.targetPlayer).values())
			if (ent && ent.position() && !ent.hasClass("Animal") && ent.attackTypes && ent.attackTypes() &&
			    (!ent.hasClass("Support") || ent.hasClass("Soldier")) && SquareVectorDistance(ent.position(), pos) <= targetRadius2)
				++defenders;
		let staticDefenses = 0;
		for (const ent of gameState.getEnemyStructures(attack.targetPlayer).values())
			if (ent && ent.position() && SquareVectorDistance(ent.position(), pos) <= defenseRadius2 &&
			    (ent.hasClass("CivCentre") || ent.hasClass("Tower") || ent.hasClass("Fortress") || ent.hasClass("WallTower")))
				++staticDefenses;
		return { defenders, staticDefenses };
	};

	let knownEnemyCombat = 0;
	for (const ent of gameState.getEnemyUnits(attack.targetPlayer).values())
		if (ent && ent.position() && !ent.hasClass("Animal") && ent.attackTypes && ent.attackTypes() &&
		    (!ent.hasClass("Support") || ent.hasClass("Soldier")))
			++knownEnemyCombat;
	const pdata = gameState.sharedScript && gameState.sharedScript.playersData ? gameState.sharedScript.playersData[attack.targetPlayer] : undefined;
	const enemyPop = pdata && pdata.state !== "defeated" ? Math.max(0, Number(pdata.popCount) || 0) : 0;

	let metrics = targetMetrics(attack.targetPos);
	let targetIsCC = !!(attack.target && attack.target.hasClass && attack.target.hasClass("CivCentre"));
	let mainBase = targetIsCC || metrics.staticDefenses > 0;
	const staticEquivalent = Math.max(0, Number(policy.expertP1TimingStaticDefenseEquivalent) || 3);
	const localNeeded = () => Math.max(metrics.defenders + metrics.staticDefenses * staticEquivalent + 2,
		Math.ceil((metrics.defenders + metrics.staticDefenses * staticEquivalent) * 1.15));
	const globalNeeded = () => mainBase ? Math.ceil(knownEnemyCombat * Math.max(1, Number(policy.expertP1TimingKnownArmyRatio) || 1.05)) : 0;
	const popSafe = () => !mainBase || enemyPop <= attackers * Math.max(1.1, Number(policy.expertP1TimingMainBaseEnemyPopPerAttacker) || 1.60);
	let favorable = attackers >= localNeeded() && attackers >= globalNeeded() && popSafe();

	let retargeted = false;
	if (!favorable)
	{
		const centre = attack.unitCollection.getCentrePosition && attack.unitCollection.getCentrePosition() || attack.rallyPoint || attack.position;
		const maxExposedDefenders = Math.max(3, Math.floor(attackers * Math.max(0.05, Number(policy.expertP1TimingExposedDefenderRatio) || 0.25)));
		let best;
		for (const struct of gameState.getEnemyStructures(attack.targetPlayer).values())
		{
			if (!struct || !struct.position() || !struct.hasClass || struct.hasClass("CivCentre") || struct.hasClass("Tower") ||
			    struct.hasClass("Fortress") || struct.hasClass("WallTower"))
				continue;
			const economic = struct.hasClass("Farmstead") || struct.hasClass("Storehouse") || struct.hasClass("Market") ||
				struct.hasClass("Corral") || struct.hasClass("DropsiteFood") || struct.hasClass("DropsiteWood");
			if (!economic)
				continue;
			const m = targetMetrics(struct.position());
			if (m.staticDefenses > 0 || m.defenders > maxExposedDefenders)
				continue;
			const d = centre ? Math.sqrt(SquareVectorDistance(centre, struct.position())) : 0;
			const valueBias = struct.hasClass("Farmstead") || struct.hasClass("Storehouse") ? -30 : struct.hasClass("Market") ? -20 : 0;
			const score = m.defenders * 1000 + d + valueBias;
			if (!best || score < best.score)
				best = { struct, metrics: m, score };
		}
		if (best)
		{
			attack.target = best.struct;
			attack.targetPos = best.struct.position();
			metrics = best.metrics;
			mainBase = false;
			targetIsCC = false;
			retargeted = true;
			favorable = attackers >= Math.max(metrics.defenders + 2, Math.ceil(metrics.defenders * 1.10));
		}
	}

	const logEvery = Math.max(5, Number(policy.expertP1TimingLogSeconds) || 10);
	const shouldLog = now >= (Number(this.expertLastP1TimingLog) || -99999) + logEvery;
	if (shouldLog)
	{
		this.expertLastP1TimingLog = now;
		aiWarn("[EXPERT-TIMING-GATE] " + (favorable ? retargeted ? "retarget-launch" : "launch" : "hold") +
			" plan=" + attack.name + " army=" + attackers + " local=" + metrics.defenders +
			" knownEnemy=" + knownEnemyCombat + " enemyPop=" + enemyPop + " static=" + metrics.staticDefenses +
			" target=" + (targetIsCC ? "cc" : retargeted ? "exposed-eco" : mainBase ? "defended" : "open") +
			" needed=" + Math.max(localNeeded(), globalNeeded()));
	}
	return { launch: favorable, reason: favorable ? retargeted ? "exposed-economic-target" : "advantage" : "hold-for-better-fight",
		attackers, defenders: metrics.defenders, knownEnemyCombat, enemyPop, staticDefenses: metrics.staticDefenses, retargeted };
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
		if (!ent || !ent.position() || SquareVectorDistance(ent.position(), centre) > radius2 || isExpertBuildingSiegeEntity(ent))
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

AttackManager.prototype.expertClearlyOutnumberedDecision = function(gameState, attack)
{
	const out = { abort: false, balance: undefined };
	if (this.Config.difficulty < difficulty.EXPERT || !attack || !attack.isStarted() ||
	    (attack.type !== AttackPlan.TYPE_RUSH && attack.type !== AttackPlan.TYPE_DEFAULT && attack.type !== AttackPlan.TYPE_HUGE_ATTACK) ||
	    expertAttackHasBuildingSiege(attack))
		return out;
	const now = Number(gameState.ai.elapsedTime) || 0;
	const age = now - (Number(attack.expertLaunchTime) || now);
	const policy = mergePolicy();
	if (age < 4 || age > (Number(policy.expertSmartAttackMaximumAgeSeconds) || 22))
		return out;
	const pdata = gameState.sharedScript && gameState.sharedScript.playersData && gameState.sharedScript.playersData[attack.targetPlayer];
	const enemyPop = pdata ? Math.max(0, Number(pdata.popCount) || 0) : Infinity;
	if (enemyPop <= (Number(policy.expertFinishingEnemyPopulation) || 30))
		return out;
	const balance = this.expertRushLocalBalance(gameState, attack);
	out.balance = balance;
	const own = Number(balance.ownCombat) || 0;
	const enemy = Number(balance.enemyCombat) || 0;
	if (own < (Number(policy.expertSmartAttackMinimumOwnCombat) || 12))
		return out;
	const ratio = balance.defenses > 0 ?
		(Number(policy.expertSmartAttackDefendedOutnumberRatio) || 1.15) :
		(Number(policy.expertSmartAttackOutnumberRatio) || 1.35);
	// Require both a ratio disadvantage and a real numeric margin to avoid reacting
	// to harmless scouting noise or one extra defender crossing the sample radius.
	if (enemy >= Math.ceil(own * ratio) && enemy >= own + (balance.defenses > 0 ? 5 : 8))
		out.abort = true;
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

// IT14.62: normal Town/City armies need exchange discipline too. A stronger eco
// must not disguise a 5:1 casualty trade by continuously refilling one doomed plan.
AttackManager.prototype.expertBadExchangeDecision = function(gameState, attack)
{
	const out = { abort: false, pressureHold: false, losses: 0, enemyDamage: 0, balance: undefined };
	if (this.Config.difficulty < difficulty.EXPERT || !attack || !attack.isStarted() ||
	    (attack.type !== AttackPlan.TYPE_DEFAULT && attack.type !== AttackPlan.TYPE_HUGE_ATTACK) ||
	    !(Number(attack.expertLaunchTime) >= 0))
		return out;
	const policy = mergePolicy();
	const now = Number(gameState.ai.elapsedTime) || 0;
	if (now - Number(attack.expertLaunchTime) < (Number(policy.expertCombatBadExchangeMinimumFightSeconds) || 28))
		return out;
	const losses = Math.max(0, Number(attack.expertOwnLosses) || 0);
	if (losses < (Number(policy.expertCombatBadExchangeMinimumOwnLosses) || 12))
		return out;
	const pdata = gameState.sharedScript && gameState.sharedScript.playersData && gameState.sharedScript.playersData[attack.targetPlayer];
	const enemyPop = pdata ? Math.max(0, Number(pdata.popCount) || 0) : Number(attack.expertLaunchEnemyPopulation) || 0;
	const priorLow = Number.isFinite(Number(attack.expertLowestEnemyPopulation)) ? Number(attack.expertLowestEnemyPopulation) : Number(attack.expertLaunchEnemyPopulation) || enemyPop;
	attack.expertLowestEnemyPopulation = Math.min(priorLow, enemyPop);
	const enemyDamage = Math.max(0, (Number(attack.expertLaunchEnemyPopulation) || enemyPop) - attack.expertLowestEnemyPopulation);
	const balance = this.expertRushLocalBalance(gameState, attack);
	const bad = enemyDamage < losses * (Number(policy.expertCombatBadExchangeEnemyDamageCredit) || 0.70);
	const pressured = balance.defenses > 0 || balance.enemyCombat >= 4 ||
		balance.enemyCombat >= Math.max(4, Math.ceil(Math.max(1, balance.ownCombat) * 0.8));

	// IT14.87: P3 Max-Tech All-In is already the terminal commitment. Enemy population
	// decline is not a casualty counter because the opponent can replace units during the
	// fight. A favorable local battle (e.g. 88v70) therefore cannot be aborted merely
	// because net enemy population moved by only 1-2. Retreat remains legal only after
	// a substantial own loss AND an actual local/army collapse; the separate depleted,
	// screen and catastrophic-outnumber rules remain untouched.
	const doctrine = gameState.ai.HQ && gameState.ai.HQ.expertDoctrine;
	const p3AllIn = doctrine && doctrine.id === "p3_boom_all_in" && gameState.currentPhase && gameState.currentPhase() >= 3;
	if (p3AllIn)
	{
		const launch = Math.max(1, Number(attack.expertLaunchSize) || attack.unitCollection.length + losses);
		const lossFraction = losses / launch;
		const own = Math.max(0, Number(balance.ownCombat) || 0);
		const enemy = Math.max(0, Number(balance.enemyCombat) || 0);
		const locallyCollapsed = enemy >= Math.max(6, Math.ceil(Math.max(1, own) * 1.15)) && enemy >= own + 6;
		const armyCollapsed = attack.unitCollection.length <= Math.max(18, Math.floor(launch * 0.45));
		out.losses = losses;
		out.enemyDamage = enemyDamage;
		out.balance = balance;
		out.abort = bad && lossFraction >= 0.30 && (locallyCollapsed || armyCollapsed);
		if (bad && !out.abort)
			aiWarn("[EXPERT-P3-FINISH] ignore-pop-delta plan=" + attack.name + " army=" + attack.unitCollection.length +
				" losses=" + losses + " enemyDamage=" + enemyDamage + " local=" + own + "v" + enemy +
				" lossFraction=" + lossFraction.toFixed(2));
		return out;
	}

	// IT14.75: active Civic Centre capture progress is strategic damage. Do not abandon
	// the CC solely for a poor casualty exchange while we have meaningful capture share,
	// local parity, and no additional static-defense trap.
	let captureCommitment = false;
	let captureShare = 0;
	if (attack.target && attack.target.hasClass && attack.target.hasClass("CivCentre") && attack.target.capturePoints)
	{
		const points = attack.target.capturePoints();
		if (Array.isArray(points) && points.length)
		{
			const total = points.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
			const ours = Math.max(0, Number(points[PlayerID]) || 0);
			captureShare = total > 0 ? ours / total : 0;
			captureCommitment = captureShare >= 0.10 && balance.defenses <= 0 &&
				balance.ownCombat >= Math.max(1, Math.ceil(balance.enemyCombat * 0.90));
		}
	}
	out.losses = losses;
	out.enemyDamage = enemyDamage;
	out.balance = balance;

	// IT14.94: do not confuse historical casualties with current battlefield control.
	// The 14.93 Seleucid replay repeatedly forced a full reboom at 56v0, 50v1, 74v0,
	// 64v0 and 84v0. A human holds the ground, rotates wounded units and reinforces.
	// Preserve strategic retreat for a real collapse, but keep the plan alive while the
	// local force is still decisively superior. Static defenses can trigger the existing
	// short tactical regroup without surrendering the entire offensive.
	const launch = Math.max(1, Number(attack.expertLaunchSize) || attack.unitCollection.length + losses);
	const army = attack.unitCollection ? attack.unitCollection.length : 0;
	const own = Math.max(0, Number(balance.ownCombat) || 0);
	const enemy = Math.max(0, Number(balance.enemyCombat) || 0);
	const localDominance = army >= (Number(policy.expertCombatPressureHoldMinimumArmy) || 40) &&
		own >= (Number(policy.expertCombatPressureHoldMinimumLocalOwn) || 24) &&
		own >= enemy + (Number(policy.expertCombatPressureHoldMinimumLead) || 12) &&
		enemy <= own * (Number(policy.expertCombatPressureHoldMaximumEnemyRatio) || 0.55) &&
		balance.defenses <= (Number(policy.expertCombatPressureHoldMaximumDefenses) || 3) &&
		army > Math.max(18, Math.floor(launch * 0.45));
	out.pressureHold = bad && pressured && !captureCommitment && localDominance;
	out.abort = bad && pressured && !captureCommitment && !localDominance;
	if (bad && pressured && captureCommitment)
		aiWarn("[EXPERT-CAPTURE] hold-cc plan=" + attack.name + " capture=" + Math.round(captureShare * 100) +
			"% local=" + balance.ownCombat + "v" + balance.enemyCombat + " losses=" + losses +
			" enemyDamage=" + enemyDamage);
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
		if (ent && ent.position() && !isExpertBuildingSiegeEntity(ent))
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
		if (!ent || isExpertBuildingSiegeEntity(ent) || ent.hasClass("Cavalry"))
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
	// IT14.63: the old fixed 180-second exclusion outlived the actual 45-60 second
	// reboom window and could leave the rebuilt army ineligible for the follow-up.
	// Tie the retreat metadata to the strategic cooldown instead.
	const until = Math.max(now + 20, Number(this.expertReboomUntil) || now + 60);
	for (const ent of attack.unitCollection.values())
	{
		if (!ent || !ent.getMetadata)
			continue;
		ent.setMetadata(PlayerID, "expertCombatRetreatUntil", until);
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
	if (attack.unitCollection.length > policy.expertDepletedAttackRetreatArmy || expertAttackHasBuildingSiege(attack))
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
		if (!ram || !ram.position() || !isExpertRamEntity(ram) ||
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

		// IT14.90: once the decisive CC capture lock owns this attack, do not hide
		// capture-capable soldiers inside the ram. Release the small ram crew so the
		// normal passenger-recovery lane can rejoin them to the capture on the next tick,
		// and never refill this ram until the lock ends.
		if (this.expertCCCaptureLock && ramAttack &&
		    Number(this.expertCCCaptureLock.plan) === Number(ramAttack.name))
		{
			let released = 0;
			for (const id of [...ram.garrisoned()])
			{
				const ent = gameState.getEntityById(id);
				if (!ent || !ent.hasClass || !ent.hasClass("CitizenSoldier"))
					continue;
				ent.setMetadata(PlayerID, "garrisonType", undefined);
				ram.unload(id);
				++released;
			}
			if (released)
				aiWarn("[EXPERT-CAPTURE-FINISH] ram=" + ram.id() + " released-capturers=" + released);
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

// IT14.63: count healthy reserve combatants that can seed a post-retreat follow-up.
AttackManager.prototype.expertReserveCombatCount = function(gameState)
{
	let count = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position || !ent.position() || ent.hasClass("Support") ||
		    !(ent.hasClass("Soldier") || ent.hasClass("Champion")))
			continue;
		if (ent.getMetadata)
		{
			const plan = ent.getMetadata(PlayerID, "plan");
			if (ent.getMetadata(PlayerID, "PartOfArmy") !== undefined ||
			    ent.getMetadata(PlayerID, "expertDefenseMobilized") !== undefined ||
			    plan !== undefined && plan !== -1)
				continue;
		}
		if (ent.healthLevel && ent.healthLevel() < 0.45)
			continue;
		++count;
	}
	return count;
};

// IT14.83: remember strategic P2/P3-normal attack failures. Rushes use their own
// recovery doctrine and finishing mode deliberately ignores this escalation layer.
AttackManager.prototype.bumpExpertP2Escalation = function(gameState, attack, reason)
{
	if (this.Config.difficulty < difficulty.EXPERT || !attack || attack.type === AttackPlan.TYPE_RUSH ||
	    !gameState.currentPhase || gameState.currentPhase() < 2)
		return 0;
	const target = attack.targetPlayer;
	if (target === undefined)
		return Math.max(0, Number(this.expertP2EscalationLevel) || 0);
	if (this.expertP2EscalationTargetPlayer !== target)
	{
		this.expertP2EscalationTargetPlayer = target;
		this.expertP2EscalationLevel = 0;
	}
	this.expertP2EscalationLevel = Math.min(3, Math.max(0, Number(this.expertP2EscalationLevel) || 0) + 1);
	aiWarn("[EXPERT-P2-ESCALATE] level=" + this.expertP2EscalationLevel + " targetPlayer=" + target +
		" reason=" + reason + " failedArmy=" + (attack.unitCollection ? attack.unitCollection.length : 0));
	return this.expertP2EscalationLevel;
};

AttackManager.prototype.forceExpertReboomRelaunch = function(gameState)
{
	if (this.Config.difficulty < difficulty.EXPERT || !this.expertReboomNeedsRelaunch ||
	    (Number(gameState.ai.elapsedTime) || 0) < (Number(this.expertReboomUntil) || -99999) ||
	    !gameState.currentPhase || gameState.currentPhase() < 2)
		return false;
	for (const type of [AttackPlan.TYPE_DEFAULT, AttackPlan.TYPE_HUGE_ATTACK])
		if ((this.startedAttacks[type] && this.startedAttacks[type].length) ||
		    (this.upcomingAttacks[type] && this.upcomingAttacks[type].length))
			return false;

	const policy = mergePolicy();
	const reserve = this.expertReserveCombatCount(gameState);
	// IT14.64: reserve strength is the relaunch gate. A housing block must not make
	// 50+ healthy soldiers wait forever for total population to grow.
	if (reserve < (Number(policy.expertReboomRelaunchMinimumReserve) || 40))
		return false;

	const attackPlan = new AttackPlan(gameState, this.Config, this.totalNumber, AttackPlan.TYPE_DEFAULT);
	if (attackPlan.failed)
		return false;
	++this.totalNumber;
	attackPlan.init(gameState);
	if (this.expertReboomTargetPlayer !== undefined && gameState.isPlayerEnemy(this.expertReboomTargetPlayer))
		attackPlan.targetPlayer = this.expertReboomTargetPlayer;
	this.upcomingAttacks[AttackPlan.TYPE_DEFAULT].push(attackPlan);
	this.expertReboomNeedsRelaunch = false;
	const now = Number(gameState.ai.elapsedTime) || 0;
	this.expertLastReboomRelaunchLog = now;
	aiWarn("[EXPERT-REBOOM] relaunch plan=" + attackPlan.name + " reserve=" + reserve +
		" targetPlayer=" + attackPlan.targetPlayer + " pop=" + gameState.getPopulation());
	return true;
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

			// IT14.56 Athens can deliberately time its Late-P1 rush with the unique Village
			// melee upgrade. Keep the soldiers economically active in STATE_UNEXECUTED while
			// that already-queued/researching tech finishes, but never hold past the hard
			// timing ceiling if the research becomes stuck.
			if (this.Config.difficulty >= difficulty.EXPERT && !attack.expertAuthorityOwned && attackType === AttackPlan.TYPE_RUSH && doctrine &&
			    doctrine.id === "late_p1_rush" && gameState.getPlayerCiv && gameState.getPlayerCiv() === "athen" &&
			    gameState.currentPhase && gameState.currentPhase() === 1 && attack.state === AttackPlan.STATE_UNEXECUTED && attack.canStart && attack.canStart())
			{
				const techName = "citystate/city_state_attack_melee_01";
				const techQueue = gameState.ai.queues && gameState.ai.queues.expertAthensP1Melee;
				const researched = !!(gameState.isResearched && gameState.isResearched(techName));
				const researching = !!(gameState.isResearching && gameState.isResearching(techName));
				const queued = !!(techQueue && techQueue.hasQueuedUnits && techQueue.hasQueuedUnits());
				const p = mergePolicy();
				const absolute = Number(p.athensP1MeleeAbsoluteLaunchTime) || 465;
				const start = Number(p.athensP1MeleeTechStartTime) || 250;
				// IT14.62: do not park a ready timing army for a technology that is not
				// actually queued/researching. The controller now treats Forge+Melee-I as an
				// affordable package; here we wait only for a real research pipeline, plus a
				// brief grace period after Forge completion so the next controller tick can queue it.
				const forgeBuilt = gameState.getOwnEntitiesByClass("Forge", true).filter(filters.isBuilt()).hasEntities();
				const enemyData = gameState.sharedScript && gameState.sharedScript.playersData &&
					gameState.sharedScript.playersData[attack.targetPlayer];
				const enemyPop = enemyData ? Math.max(0, Number(enemyData.popCount) || 0) : 999;
				const weakOpportunity = enemyPop <= Math.max(36, Math.ceil(attack.unitCollection.length * 1.35));
				if (!researched && gameState.ai.elapsedTime >= start && gameState.ai.elapsedTime < absolute)
				{
					if (researching || queued)
					{
						if (gameState.ai.elapsedTime >= this.expertLastAthensP1MeleeHoldLog + 12)
						{
							this.expertLastAthensP1MeleeHoldLog = gameState.ai.elapsedTime;
							aiWarn("[EXPERT-ATHENS-P1] hold late-rush melee-obligation plan=" + attack.name +
								" army=" + attack.unitCollection.length + " status=" + (researching ? "researching" : "queued") +
								" absolute=" + Math.round(absolute));
						}
						++unexecutedAttacks[attackType];
						continue;
					}
					if (forgeBuilt)
					{
						if (!Number.isFinite(Number(attack.expertMeleeQueueGraceStart)))
							attack.expertMeleeQueueGraceStart = gameState.ai.elapsedTime;
						if (gameState.ai.elapsedTime - attack.expertMeleeQueueGraceStart < 12)
						{
							++unexecutedAttacks[attackType];
							continue;
						}
					}
					if (!weakOpportunity)
					{
						if (gameState.ai.elapsedTime >= this.expertLastAthensP1MeleeHoldLog + 12)
						{
							this.expertLastAthensP1MeleeHoldLog = gameState.ai.elapsedTime;
							aiWarn("[EXPERT-ATHENS-P1] hold-for-melee-or-p2 plan=" + attack.name +
								" army=" + attack.unitCollection.length + " enemyPop=" + enemyPop +
								" forge=" + (forgeBuilt ? "built" : "missing"));
						}
						++unexecutedAttacks[attackType];
						continue;
					}
					if (gameState.ai.elapsedTime >= this.expertLastAthensP1MeleeHoldLog + 12)
					{
						this.expertLastAthensP1MeleeHoldLog = gameState.ai.elapsedTime;
						aiWarn("[EXPERT-ATHENS-P1] weak-target launch without melee plan=" + attack.name +
							" army=" + attack.unitCollection.length + " enemyPop=" + enemyPop);
					}
				}

				if (!researched && gameState.ai.elapsedTime >= absolute && !weakOpportunity)
				{
					aiWarn("[EXPERT-ATHENS-P1] cancel-unupgraded-late-rush plan=" + attack.name +
						" army=" + attack.unitCollection.length + " enemyPop=" + enemyPop +
						" action=transition-p2");
					this.expertLateP1UnupgradedCancelled = true;
					this.expertReboomNeedsRelaunch = true;
					this.expertReboomTargetPlayer = attack.targetPlayer;
					attack.Abort(gameState);
					this.upcomingAttacks[attackType].splice(i--, 1);
					continue;
				}
				if (!researched && gameState.ai.elapsedTime >= absolute && weakOpportunity &&
				    gameState.ai.elapsedTime < absolute + 2 &&
				    gameState.ai.elapsedTime >= this.expertLastAthensP1MeleeHoldLog + 1)
				{
					this.expertLastAthensP1MeleeHoldLog = gameState.ai.elapsedTime;
					aiWarn("[EXPERT-ATHENS-P1] weak-target hard-deadline launch plan=" + attack.name +
						" army=" + attack.unitCollection.length + " enemyPop=" + enemyPop);
				}
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
					if (this.Config.difficulty >= difficulty.EXPERT &&
					    (attackType === AttackPlan.TYPE_RUSH || attackType === AttackPlan.TYPE_DEFAULT || attackType === AttackPlan.TYPE_HUGE_ATTACK))
					{
						attack.expertLaunchSize = attack.unitCollection.length;
						attack.expertLaunchTime = Number(gameState.ai.elapsedTime) || 0;
						attack.expertOwnLosses = 0;
						const launchData = gameState.sharedScript && gameState.sharedScript.playersData && gameState.sharedScript.playersData[attack.targetPlayer];
						attack.expertLaunchEnemyPopulation = launchData ? Math.max(0, Number(launchData.popCount) || 0) : 0;
						attack.expertLowestEnemyPopulation = attack.expertLaunchEnemyPopulation;
					}
					if (this.Config.difficulty >= difficulty.EXPERT && attackType === AttackPlan.TYPE_RUSH && doctrine)
					{
						this.expertRushHasLaunched = true;
						this.expertLastRushTargetPlayer = attack.targetPlayer;
						this.expertLastRushLaunchEnemyPopulation = attack.expertLaunchEnemyPopulation;
						this.expertLastRushLaunchTime = attack.expertLaunchTime;
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
			const finishPersistence = this.expertFinishingPersistenceDecision(gameState, attack, expertFinishing);
			if (finishPersistence.persist && now >= (Number(attack.expertLastFinishPersistLog) || -99999) +
			    (Number(mergePolicy().expertFinishingPersistenceLogSeconds) || 12))
			{
				attack.expertLastFinishPersistLog = now;
				const fb = finishPersistence.balance || {};
				aiWarn("[EXPERT-FINISH] persist plan=" + attack.name + " army=" + attack.unitCollection.length +
					" enemyPop=" + (expertFinishing && expertFinishing.enemyPopulation) + " local=" +
					(fb.ownCombat || 0) + "v" + (fb.enemyCombat || 0) + " defenses=" + (fb.defenses || 0));
			}
			if (Number(attack.expertTacticalRegroupUntil) > 0)
			{
				if (now < attack.expertTacticalRegroupUntil)
					continue;
				attack.expertTacticalRegroupUntil = -99999;
				attack.setPaused(false);
				aiWarn("[EXPERT-RUSH] RESUME plan=" + attack.name + " army=" + attack.unitCollection.length);
			}
			const outnumberedBeforeFight = this.expertClearlyOutnumberedDecision(gameState, attack);
			if (outnumberedBeforeFight.abort)
			{
				const policy = mergePolicy();
				const b = outnumberedBeforeFight.balance || {};
				this.expertReboomUntil = Math.max(this.expertReboomUntil || -99999,
					now + (attack.type === AttackPlan.TYPE_RUSH ?
						(Number(policy.expertRushRetreatCooldownSeconds) || 105) :
						(Number(policy.expertCombatBadExchangeReboomSeconds) || 55)));
				if (attack.type === AttackPlan.TYPE_RUSH)
				{
					this.expertRushRecoveryMode = true;
					this.expertRushRecoveryUntil = this.expertReboomUntil;
				}
				this.expertReboomNeedsRelaunch = true;
				this.expertReboomTargetPlayer = attack.targetPlayer;
				if (attack.type !== AttackPlan.TYPE_RUSH)
					this.bumpExpertP2Escalation(gameState, attack, "clearly_outnumbered");
				this.markExpertCombatRetreat(gameState, attack, "clearly_outnumbered");
				const cancelled = this.cancelExpertFollowupPreparations(gameState);
				aiWarn("[EXPERT-SMART-ATTACK] avoid-outnumbered plan=" + attack.name +
					" local=" + (b.ownCombat || 0) + "v" + (b.enemyCombat || 0) +
					" defenses=" + (b.defenses || 0) + " cancelled=" + cancelled +
					" until=" + Math.round(this.expertReboomUntil));
				attack.Abort(gameState);
				this.startedAttacks[attackType].splice(i--, 1);
				continue;
			}
			const failedRush = this.expertFailedRushDecision(gameState, attack);
			if (failedRush.regroup && this.startExpertTacticalRegroup(gameState, attack, failedRush))
				continue;
			if (!finishPersistence.persist && failedRush.abort)
			{
				const policy = mergePolicy();
				const now = Number(gameState.ai.elapsedTime) || 0;
				this.expertRushRecoveryMode = true;
				this.expertRushRecoveryUntil = now + (Number(policy.expertRushRetreatCooldownSeconds) || 105);
				this.expertReboomUntil = Math.max(this.expertReboomUntil || -99999, this.expertRushRecoveryUntil);
				// IT14.64 Rush recovery also creates a concrete P2 counterattack obligation.
				// This covers the replay where 50+ healthy reserves defended successfully but
				// never counterattacked because only Default/Huge retreats set this flag.
				this.expertReboomNeedsRelaunch = true;
				this.expertReboomTargetPlayer = attack.targetPlayer;
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
			const badExchange = this.expertBadExchangeDecision(gameState, attack);
			if (!finishPersistence.persist && badExchange.pressureHold)
			{
				const b = badExchange.balance || {};
				const policy = mergePolicy();
				const logEvery = Number(policy.expertCombatPressureHoldLogSeconds) || 12;
				if (now - (Number(attack.expertLastPressureHoldLog) || -99999) >= logEvery)
				{
					attack.expertLastPressureHoldLog = now;
					aiWarn("[EXPERT-PRESSURE] hold plan=" + attack.name + " army=" + attack.unitCollection.length +
						" losses=" + badExchange.losses + " enemyDamage=" + badExchange.enemyDamage +
						" local=" + (b.ownCombat || 0) + "v" + (b.enemyCombat || 0) +
						" defenses=" + (b.defenses || 0));
				}
				if ((b.defenses || 0) > 0 && this.startExpertTacticalRegroup(gameState, attack,
					{ reason: "pressure_hold", balance: b }))
					continue;
			}
			if (!finishPersistence.persist && badExchange.abort)
			{
				const policy = mergePolicy();
				this.expertReboomUntil = Math.max(this.expertReboomUntil || -99999,
					now + (Number(policy.expertCombatBadExchangeReboomSeconds) || 55));
				this.expertReboomNeedsRelaunch = true;
				this.expertReboomTargetPlayer = attack.targetPlayer;
				this.bumpExpertP2Escalation(gameState, attack, "bad_exchange");
				this.markExpertCombatRetreat(gameState, attack, "bad_exchange");
				const cancelled = this.cancelExpertFollowupPreparations(gameState);
				const b = badExchange.balance || {};
				aiWarn("[EXPERT-REBOOM] bad-exchange plan=" + attack.name + " army=" + attack.unitCollection.length +
					" losses=" + badExchange.losses + " enemyDamage=" + badExchange.enemyDamage +
					" local=" + (b.ownCombat || 0) + "v" + (b.enemyCombat || 0) + " defenses=" + (b.defenses || 0) +
					" cancelled=" + cancelled + " until=" + Math.round(this.expertReboomUntil));
				attack.Abort(gameState);
				this.startedAttacks[attackType].splice(i--, 1);
				continue;
			}
			const brokenScreenRetreat = this.shouldExpertRetreatBrokenScreen(gameState, attack);
			if (!finishPersistence.persist && brokenScreenRetreat)
			{
				const policy = mergePolicy();
				const now = Number(gameState.ai.elapsedTime) || 0;
				this.expertReboomUntil = Math.max(this.expertReboomUntil || -99999,
					now + (Number(policy.expertCombatScreenReboomSeconds) || 45));
				this.expertReboomNeedsRelaunch = true;
				this.expertReboomTargetPlayer = attack.targetPlayer;
				this.bumpExpertP2Escalation(gameState, attack, "melee_screen_under_pressure");
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
			if (!finishPersistence.persist && this.shouldExpertRetreatDepletedAttack(gameState, attack))
			{
				const policy = mergePolicy();
				this.expertReboomUntil = Math.max(this.expertReboomUntil || -99999,
					(Number(gameState.ai.elapsedTime) || 0) + policy.expertDepletedAttackReboomSeconds);
				this.expertReboomNeedsRelaunch = true;
				this.expertReboomTargetPlayer = attack.targetPlayer;
				this.bumpExpertP2Escalation(gameState, attack, "depleted_push");
				this.markExpertCombatRetreat(gameState, attack, "depleted_push");
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
	// IT14.65: premium infantry trained behind the army joins it immediately instead of
	// accumulating as an idle home reserve. Siege keeps its existing attachment lane.
	this.attachExpertPremiumUnitsToActiveAttack(gameState);
	this.attachExpertSiegeToActiveAttack(gameState);
	this.coordinateExpertCCCaptureFinish(gameState, expertFinishing);
	this.coordinateExpertAttackMoveSweep(gameState);
	this.coordinateExpertHealerEscort(gameState);
	if (expertFinishing)
		this.reinforceExpertFinishingAttack(gameState, expertFinishing);
	this.recoverExpertRamPassengers(gameState);
	this.manageExpertRamGarrisons(gameState, expertFinishing);

	// IT14.73: ExpertDecisionController is now the exclusive combat-plan creator.
	// Petra keeps this legacy creation machinery only for non-Expert difficulties.
	const expertAuthorityMode = this.Config.difficulty >= difficulty.EXPERT && gameState.ai.HQ.expertDecisionController &&
		gameState.ai.HQ.expertDecisionController.isActive(gameState);
	const expertForcedRelaunch = !expertAuthorityMode && this.forceExpertReboomRelaunch(gameState);
	if (!expertAuthorityMode)
	{

	const expertPrimaryStarted = this.startedAttacks[AttackPlan.TYPE_DEFAULT].length +
		this.startedAttacks[AttackPlan.TYPE_HUGE_ATTACK].length;
	const barracksNb = gameState.getOwnEntitiesByClass("Barracks", true).filter(filters.isBuilt()).length;
	const p1ReserveCount = this.Config.difficulty >= difficulty.EXPERT ? this.expertReserveCombatCount(gameState) : 0;
	const expertP1ReserveWindow = this.Config.difficulty >= difficulty.EXPERT && gameState.currentPhase &&
		gameState.currentPhase() === 1 && (Number(gameState.ai.elapsedTime) || 0) >=
		(Number(mergePolicy().expertP1ReserveAttackMinimumTime) || 360) && p1ReserveCount >=
		(Number(mergePolicy().expertP1ReserveAttackMinimumArmy) || 45);
	if (this.rushNumber < this.maxRushes && barracksNb >= 1)
	{
		if (unexecutedAttacks[AttackPlan.TYPE_RUSH] === 0)
		{
			// IT14.64: after an Athens Late-P1 timing was deliberately cancelled for
			// missing Melee-I, do not recreate another unupgraded P1 rush a frame later.
			if (this.Config.difficulty >= difficulty.EXPERT && doctrine && doctrine.id === "late_p1_rush" &&
			    gameState.getPlayerCiv && gameState.getPlayerCiv() === "athen" &&
			    this.expertLateP1UnupgradedCancelled &&
			    !(gameState.isResearched && gameState.isResearched("citystate/city_state_attack_melee_01")))
			{
				if (gameState.ai.elapsedTime >= this.expertLastAthensP1MeleeHoldLog + 15)
				{
					this.expertLastAthensP1MeleeHoldLog = gameState.ai.elapsedTime;
					aiWarn("[EXPERT-ATHENS-P1] replacement-rush-locked action=transition-p2");
				}
				this.rushNumber = this.maxRushes;
			}
			else
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
	}
	else if (!expertForcedRelaunch &&
		!((Number(gameState.ai.elapsedTime) || 0) < (this.expertReboomUntil || -99999)) &&
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
		if (barracksNb >= 1 && (gameState.currentPhase() > 1 || gameState.isResearching(gameState.getPhaseName(2)) || expertP1ReserveWindow) ||
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
				if (expertP1ReserveWindow)
					aiWarn("[EXPERT-ATTACK] create P1 reserve plan=" + attackPlan.name + " reserve=" + p1ReserveCount);
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
	// IT14.73: a Petra defense army may keep defending, but it may not manufacture a
	// new offensive AttackPlan behind Expert's authority boundary.  Expert will decide
	// when those units transfer into its primary combat plan.
	if (this.Config.difficulty >= difficulty.EXPERT && gameState.ai.HQ.expertDecisionController &&
	    gameState.ai.HQ.expertDecisionController.isActive(gameState))
	{
		aiWarn("[EXPERT-AUTH] blocked Petra defense->attack conversion");
		return false;
	}
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
		"expertReboomNeedsRelaunch": this.expertReboomNeedsRelaunch,
		"expertReboomTargetPlayer": this.expertReboomTargetPlayer,
		"expertLastReboomRelaunchLog": this.expertLastReboomRelaunchLog,
		"expertP2EscalationLevel": this.expertP2EscalationLevel,
		"expertP2EscalationTargetPlayer": this.expertP2EscalationTargetPlayer,
		"expertLastStrategyStatusLog": this.expertLastStrategyStatusLog,
		"expertRushRecoveryMode": this.expertRushRecoveryMode,
		"expertRushRecoveryUntil": this.expertRushRecoveryUntil,
		"expertRushHasLaunched": this.expertRushHasLaunched,
		"expertLastRushTargetPlayer": this.expertLastRushTargetPlayer,
		"expertLastRushLaunchEnemyPopulation": this.expertLastRushLaunchEnemyPopulation,
		"expertLastRushLaunchTime": this.expertLastRushLaunchTime,
		"expertLastAthensP1MeleeHoldLog": this.expertLastAthensP1MeleeHoldLog,
		"expertLastP1RushGateLog": this.expertLastP1RushGateLog,
		"expertLateP1UnupgradedCancelled": this.expertLateP1UnupgradedCancelled,
		"expertLastAttackMoveSweepAt": { ...(this.expertLastAttackMoveSweepAt || {}) },
		"expertLastAttackMoveSweepLog": this.expertLastAttackMoveSweepLog,
		"expertCCCaptureLock": this.expertCCCaptureLock ? { ...this.expertCCCaptureLock } : undefined,
		"expertCCCaptureSuppressedUntil": { ...(this.expertCCCaptureSuppressedUntil || {}) },
		"expertLastCCCaptureOrderAt": this.expertLastCCCaptureOrderAt,
		"expertLastCCCaptureLog": this.expertLastCCCaptureLog
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
	this.expertLastAttackMoveSweepAt = { ...(this.expertLastAttackMoveSweepAt || {}) };
	this.expertLastAttackMoveSweepLog = Number.isFinite(Number(this.expertLastAttackMoveSweepLog)) ? Number(this.expertLastAttackMoveSweepLog) : -99999;
	this.expertCCCaptureLock = this.expertCCCaptureLock ? { ...this.expertCCCaptureLock } : undefined;
	this.expertCCCaptureSuppressedUntil = { ...(this.expertCCCaptureSuppressedUntil || {}) };
	this.expertLastCCCaptureOrderAt = Number.isFinite(Number(this.expertLastCCCaptureOrderAt)) ? Number(this.expertLastCCCaptureOrderAt) : -99999;
	this.expertLastCCCaptureLog = Number.isFinite(Number(this.expertLastCCCaptureLog)) ? Number(this.expertLastCCCaptureLog) : -99999;

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
