import * as filters from "simulation/ai/common-api/filters.js";
import { aiWarn, SquareVectorDistance } from "simulation/ai/common-api/utils.js";
import * as difficulty from "simulation/ai/petra/difficultyLevel.js";
import { getLandAccess, getMaxStrength, isSupplyFull, returnResources } from "simulation/ai/petra/entityExtend.js";
import { createObstructionMap } from "simulation/ai/petra/mapModule.js";
import { ExpertFixedConstructionPlan } from "simulation/ai/petra/expertFixedConstructionPlan.js";
import { TrainingPlan } from "simulation/ai/petra/queueplanTraining.js";
import { ResearchPlan } from "simulation/ai/petra/queueplanResearch.js";
import { Worker } from "simulation/ai/petra/worker.js";

import { createMemory, stepDecision } from "simulation/ai/petra/expertDecision/decisionEngine.js";
import { mergePolicy } from "simulation/ai/petra/expertDecision/policy.js";
import { chooseDoctrine, doctrineById, policyOverridesForDoctrine } from "simulation/ai/petra/expertDecision/strategyPolicy.js";
import { predictiveHouseTrigger } from "simulation/ai/petra/expertDecision/economyPlanner.js";
import {
	createCivilianRoster, reconcileCivilianRoster, decideCivilianJob, decidePostOpeningCivilianJob, resourceBalanceDirective, foodWoodFeedbackDirective,
	serializeCivilianRoster, deserializeCivilianRoster
} from "simulation/ai/petra/expertDecision/civilianAssignmentPolicy.js";
import {
	PrimaryFoodClusterTracker, collectFoodClusters, collectInitialWoodCandidates, collectWoodTrees,
	summarizeWoodTrees, collectWorkerMetrics, entityPosition, toEntities
} from "simulation/ai/petra/expertDecision/petraMechanicalCollector.js";
import { selectInitialWoodWorksite, makeInitialStorehousePlacementRequest, initialStorehousePlacementCandidates } from
	"simulation/ai/petra/expertDecision/initialWoodWorksite.js";
import { FoundationTracker } from "simulation/ai/petra/expertDecision/foundationTracker.js";
import { observePetra, BUILDING_SPECS, resolvedTemplate, countPendingCivilianTraining } from
	"simulation/ai/petra/expertDecision/petraApiAdapter.js";
import { executeDecisionFrame, executeWorkerAction, buildKey, JOB_METADATA, PENDING_JOB_METADATA } from
	"simulation/ai/petra/expertDecision/petraActionAdapter.js";
import { prepareMechanicalExecution } from "simulation/ai/petra/expertDecision/petraMechanicalCoordinator.js";
import { createPetraPlacementPorts, readTemplateGeometry } from
	"simulation/ai/petra/expertDecision/petraMechanicalPorts.js";
import { generatePlacementCandidates } from
	"simulation/ai/petra/expertDecision/petraPlacementResolver.js";
import { selectFoundationStarter, selectFoundationStarterCandidate, selectMaintenanceTeam, commitBuilders, TASK_KEY } from
	"simulation/ai/petra/expertDecision/petraBuilderResolver.js";
import { desiredBuilders, constructionPriority, allocateBuilderBudget } from "simulation/ai/petra/expertDecision/constructionLifecycle.js";
import { hasLiveGatherOrder, hasLiveRepairOrder, ensureGatherOrder, ensureRepairOrder, describeLiveOrder } from
	"simulation/ai/petra/expertDecision/liveOrderVerifier.js";
import { decideWoodWorkerTarget } from "simulation/ai/petra/expertDecision/workerPolicy.js";
import { needsDepositBeforeRetarget, pendingTransitionDecision, isCrossResourceJobChange, jobResourceType } from "simulation/ai/petra/expertDecision/resourceTransitionPolicy.js";
import { encodeFoodSite, decodeFoodSite, matchingFoodCluster, effectiveGatherRate, naturalRunwaySeconds, shouldSwitchFoodSite } from
	"simulation/ai/petra/expertDecision/foodEfficiency.js";
import { DEFAULT_OWNERSHIP_METADATA, isExpertOpeningEconomyEntity } from
	"simulation/ai/petra/expertDecision/petraOwnershipGate.js";

const CIVILIAN_ORDINAL = "expertDecisionCivilianOrdinal";
const WORKSITE_ID = "expertDecisionWoodWorksite";
const SUPPLY_ID = "supply";
const FARM_LOCK = "expertDecisionPermanentFarmId";
const FOOD_SITE = "expertDecisionFoodSite";
const FOOD_SITE_CHANGED_AT = "expertDecisionFoodSiteChangedAt";
const FOOD_PREVIOUS_SITE = "expertDecisionPreviousFoodSite";
const EXPERT_DEFENSE = "expertDefenseMobilized";
const EXPERT_DEFENSE_ORDER_AT = "expertDefenseOrderAt";
const EXPERT_DEFENSE_ORDER_STAGE = "expertDefenseOrderStage";
const EXPERT_CIVILIAN_EVAC = "expertCivilianEvacuating";
const EXPERT_CIVILIAN_DANGER_AT = "expertCivilianDangerAt";
const EXPERT_WICKER_PEELED = "expertPostWickerWood";
const EXPERT_WICKER_BRANCH = "expertPostWickerFoodBranch";
const NATURAL_FOOD_LOCK = "expertDecisionNaturalFoodLock";
const FOOD_HOME_FARMSTEAD = "expertDecisionFoodHomeFarmstead";
const FOOD_HOME_PERMANENT = "expertDecisionFoodHomePermanent";
const EXPERT_ADAPTIVE_FOOD = "expertAdaptiveFoodRebalance";
const EXPERT_FALLBACK_LEASE_UNTIL = "expertFallbackLeaseUntil";
const EXPERT_FALLBACK_LEASE_RESOURCE = "expertFallbackLeaseResource";
const EXPERT_RETURN_STARTED_AT = "expertResourceReturnStartedAt";
const EXPERT_RETURN_SUPPLY_ID = "expertResourceReturnSupplyId";
const EXPERT_RETURN_GENERIC = "expertResourceReturnGeneric";
const CONTROL_UNTIL = -1; // save-compatibility only: Expert no longer auto-hands off to Petra.
const CITY_STATE_CIVS = new Set(["athen", "spart", "theb"]);
const EARLY_AXE_CIVS = new Set(["athen", "theb"]);
const P1_MINING_TECHS = new Set(["gather_mining_servants", "gather_mining_wedgemallet"]);

function hasClass(ent, name)
{
	return !!(ent && ent.hasClass && ent.hasClass(name));
}

function finiteId(ent)
{
	return ent && ent.id && Number.isFinite(ent.id()) ? ent.id() : undefined;
}

function currentTargetId(ent)
{
	if (!ent || !ent.unitAIOrderData)
		return undefined;
	const orders = ent.unitAIOrderData();
	if (!orders || !orders.length)
		return undefined;
	const target = orders[0] && orders[0].target;
	return Number.isFinite(target) ? target : undefined;
}

function centerOf(entities)
{
	let x = 0, z = 0, n = 0;
	for (const ent of entities)
	{
		const p = entityPosition(ent);
		if (!p)
			continue;
		x += p[0]; z += p[1]; ++n;
	}
	return n ? [x / n, z / n] : undefined;
}

function pointSegmentDistanceSquared(point, a, b)
{
	if (!point || !a || !b)
		return Infinity;
	const vx = b[0] - a[0];
	const vz = b[1] - a[1];
	const wx = point[0] - a[0];
	const wz = point[1] - a[1];
	const len2 = vx*vx + vz*vz;
	if (len2 <= 0.0001)
		return SquareVectorDistance(point, a);
	const t = Math.max(0, Math.min(1, (wx*vx + wz*vz) / len2));
	const px = a[0] + t*vx;
	const pz = a[1] + t*vz;
	const dx = point[0] - px;
	const dz = point[1] - pz;
	return dx*dx + dz*dz;
}

export class ExpertDecisionController
{
	constructor(HQ)
	{
		this.HQ = HQ;
		this.controlUntil = CONTROL_UNTIL;
		this.lastDesiredFields = 0;
		this.released = false;
		this.releaseReason = undefined;
		this.lastUpdateTurn = -1;
		this.lastDiag = -100;
		this.memory = createMemory();
		this.civilianRoster = createCivilianRoster();
		this.foodTracker = new PrimaryFoodClusterTracker();
		this.foundationTracker = new FoundationTracker({ "playerId": PlayerID });
		this.initialWoodSelection = undefined;
		this.primaryWoodWorksite = undefined;
		this.activeTaskByKind = {};
		// IT14.43: keep the planner's crew/pool preference for the life of the foundation.
		this.activeTaskBuildIntent = {};
		this.placementFailureCounts = {};
		this.activeFieldTasks = [];
		this.pendingFieldPositions = {};
		this.taskCounters = {};
		this.taskStartedAt = {};
		this.pendingWoodSelectionByTask = {};
		this.pendingFoodSelectionByTask = {};
		this.readyNextFoodCluster = undefined;
		// IT14.37: natural-food expansion is sequential. Once Expert pays for a
		// farmstead at a new fruit/berry district, that district must be consumed
		// before another 100-wood natural-food farmstead may be started.
		this.activeNaturalExpansionCluster = undefined;
		this.orderDiagnostics = {};
		this.taskDiagnostics = {};
		this.openingChickenIds = [];
		this.openingChickensCaptured = false;
		this.openingChickenPhaseComplete = false;
		this.fieldPlacementFailures = {};
		this.farmsteadPlacementFailures = 0;
		this.firstCCSoldierBatchQueued = false;
		this.secondCCEmergencyBatchQueued = false;
		this.firstBarracksSoldierBatchQueued = false;
		this.foodIncomeSample = undefined;
		this.foodIncomeEMA = 0;
		this.foodIncomeMeasured = false;
		// IT14.54: independently measure delivered wood. Desired-job metadata is not
		// evidence that lumber is reaching a dropsite.
		this.woodIncomeSample = undefined;
		this.woodIncomeEMA = 0;
		this.woodIncomeMeasured = false;
		this.woodLastDeliveryAt = -99999;
		this.woodIncomeStalled = false;
		this.phaseWoodCrisis = false;
		this.phase2QueuedAt = -99999;
		this.phase2Shortfall = { food: 0, wood: 0, stone: 0, metal: 0 };
		this.lastPhaseStallDiag = -99999;
		this.lastWoodStallDiag = -99999;
		this.lastResourceRebalanceTime = -99999;
		this.lastFoodPressureRebalanceTime = -99999;
		this.lastFoodWoodFeedback = { "mode": "opening" };
		this.lastImmediateFoodSlots = 0;
		this.lastResourceBalance = undefined;
		this.lastPhase2Decision = { "state": "waiting", "reason": "opening" };
		this.woodMigrationWindowStart = -99999;
		this.woodMigrationsThisWindow = 0;
		this.expertDefenseState = { "active": false, "stage": "idle", "startedAt": -99999, "lastSeen": -99999 };
		this.lastEmergencyTowerTime = -99999;
		this.emergencyTowerCount = 0;
		this.postWickerBerryPeelDone = false;
		this.postWickerBranchCluster = undefined;
		this.postWickerBranchWorkerIds = [];
		this.postWickerBranchFarmsteadPending = false;
		// Once a covered secondary natural-food branch is exhausted, guarantee that the
		// economy begins field #1 instead of sending those food-owned civilians back to
		// double-stack the original berries or overflow to wood.
		this.secondaryNaturalDepletionFieldPending = false;
		// IT14.15: remember the amount of every natural-food supply when it first
		// becomes ours. This gives the farm transition a territory-wide denominator
		// instead of letting one nearly-depleted tracked patch trigger fields while
		// other in-territory fruit is still healthy.
		this.naturalFoodDiscoveredAmounts = {};
		this.lastTerritoryNaturalFoodRatio = 1;
		this.trainerIdleSince = {};
		// IT14.48 Athens production no longer follows a rigid 2 Hoplite / 1 Marine /
		// 1 Javelineer cycle. Composition is maintained as a broad melee/ranged share
		// so an unavailable or temporarily unaffordable role never idles a barracks.
		this.athensP2TrainingCursor = 0;
		this.lastStrategicMetalRebalanceTime = -99999;
		this.lastMilitaryTechHoldDiag = -99999;
		this.lastFinishingDiag = -99999;
		// IT14.52: generic dropsite service records measured return->resource round trips.
		// This catches obstacle detours that straight-line geometry cannot see.
		this.resourceRoundTripBySupply = {};
		this.lastResourceServiceBuildTime = -99999;
		this.lastResourceServiceDiag = -99999;
		this.lastFoodCapacityDeadlockDiag = -99999;
		// IT14.53: Athens special production is deliberately small and opportunistic.
		// These diagnostics/cooldowns keep it from spamming champion/hero queue attempts.
		this.lastAthenianSpecialBuildDiag = -99999;
		this.lastAthenianSpecialTrainingDiag = -99999;
		this.lastAthenianSlingerDiag = -99999;
		// IT14.44: remember which dedicated P2 package technologies Expert has paid for.
		// This lets research ordering be human-like: two forge upgrades for the push,
		// then food/wood continuity before buying ever-deeper military tiers.
		this.expertObservedP2MilitaryTechs = {};
		this.expertObservedCoreEcoTechs = {};
		// IT14.46: one coherent strategy is selected once per match. The doctrine is
		// intentionally lightweight: it biases timings/civilian commitment while the
		// existing economy, placement and combat mechanics remain shared.
		this.strategyDoctrine = undefined;
		this.strategyLogged = false;
		this.strategyP2TransitionLogged = false;
		this.lastP1EcoSweepDiag = -99999;
	}


	ensureStrategicDoctrine(gameState)
	{
		if (!this.strategyDoctrine)
		{
			// randFloat is the engine-seeded AI RNG, so this remains replay-deterministic.
			this.strategyDoctrine = chooseDoctrine(randFloat(0, 1));
		}
		// AttackManager runs later in Headquarters.update; expose a read-only snapshot
		// so it can create the matching Rush/default plan without duplicating RNG.
		this.HQ.expertDoctrine = { ...this.strategyDoctrine };
		if (!this.strategyLogged)
		{
			this.strategyLogged = true;
			aiWarn("[EXPERT-STRATEGY] selected=" + this.strategyDoctrine.id +
				" label=" + this.strategyDoctrine.label + " civ=" + gameState.getPlayerCiv());
		}
		return this.strategyDoctrine;
	}

	strategyPolicyOverrides(gameState)
	{
		const doctrine = this.ensureStrategicDoctrine(gameState);
		const base = policyOverridesForDoctrine(doctrine, Number(gameState.ai.elapsedTime) || 0);
		const attacks = this.HQ.attackManager;
		// IT14.49: once a P1 rush has been explicitly abandoned, stop pretending the
		// opening civilian cap still matters. Recovery outranks the persistent launch flag.
		if (attacks && attacks.expertRushRecoveryMode)
			return { ...base, civilianCap: 70, p1TemplePopulation: 48, p1TempleMinimumFieldPipeline: 2 };
		// IT14.52: a live rush may protect its launch timing, but once the army actually
		// leaves home the worker-aura Temple becomes an immediate economic follow-up.
		if (attacks && attacks.expertRushHasLaunched)
			return { ...base, p1TemplePopulation: 48, p1TempleMinimumFieldPipeline: 2 };
		return base;
	}

	currentCivilianCap(gameState)
	{
		return Math.max(1, Number(this.strategyPolicyOverrides(gameState).civilianCap) || mergePolicy().civilianCap);
	}

	isExpert()
	{
		return this.HQ.Config.difficulty >= difficulty.EXPERT;
	}

	isExpertControlActive(gameState)
	{
		return this.isExpert() && !this.released;
	}

	isActive(gameState)
	{
		return this.isExpertControlActive(gameState);
	}

	isExpertEconomyEntity(ent)
	{
		return isExpertOpeningEconomyEntity(ent, { "playerId": PlayerID });
	}

	attackPlanAllowsEconomicWork(gameState, ent)
	{
		if (!ent || !ent.getMetadata)
			return true;
		// IT14.45 wounded veterans must actually get home before the economy controller
		// gives them a new gather order.  Once they cross back into friendly territory,
		// clear the return marker and let them resume ordinary work immediately.
		const combatRetreatUntil = ent.getMetadata(PlayerID, "expertCombatRetreatUntil");
		if (combatRetreatUntil !== undefined)
		{
			const pos = ent.position && ent.position();
			if (pos && this.HQ.territoryMap.getOwner(pos) === PlayerID)
			{
				ent.setMetadata(PlayerID, "expertCombatRetreatUntil", undefined);
				ent.setMetadata(PlayerID, "expertCombatRetreatReason", undefined);
			}
			else
				return false;
		}
		const woundedUntil = ent.getMetadata(PlayerID, "expertWoundedReturnUntil");
		if (woundedUntil !== undefined)
		{
			const pos = ent.position && ent.position();
			if (pos && this.HQ.territoryMap.getOwner(pos) === PlayerID)
			{
				ent.setMetadata(PlayerID, "expertWoundedReturnUntil", undefined);
				ent.setMetadata(PlayerID, "expertWoundedFromPlan", undefined);
			}
			else
				// Never turn a wounded retreat into a remote gather order merely because
				// the trip took longer than expected.  The marker clears only after the
				// unit actually reaches friendly territory.
				return false;
		}
		const planId = ent.getMetadata(PlayerID, "plan");
		if (planId === undefined || planId === -1)
			return true;
		if (!this.HQ.attackManager || !this.HQ.attackManager.getPlan)
			return false;
		const plan = this.HQ.attackManager.getPlan(planId);
		// Units keep gathering for the entire recruitment/assembly phase. The short
		// STATE_COMPLETING regroup window is deliberately left to Petra so Expert
		// never fights the launch movement orders. IT14.37 shortens that window in
		// attackPlan.js instead of making workers overwrite regroup commands.
		return !!(plan && plan.state === "unexecuted");
	}

	economyWorkerMetrics(gameState)
	{
		const out = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		out.attackCommitted = 0;
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !ent.getMetadata || !this.isExpertEconomyEntity(ent))
				continue;
			const unavailable = ent.getMetadata(PlayerID, "PartOfArmy") ||
				ent.getMetadata(PlayerID, EXPERT_DEFENSE) !== undefined ||
				!this.attackPlanAllowsEconomicWork(gameState, ent);
			if (!unavailable)
				continue;
			++out.attackCommitted;
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			if (job === "food" || job === "food_owned")
				out.food = Math.max(0, out.food - 1);
			else if (job === "farm")
				out.farm = Math.max(0, out.farm - 1);
			else if (job === "wood" || job === "citizenSoldierWood" || job === "food_overflow_wood")
				out.wood = Math.max(0, out.wood - 1);
			else if (job === "stone")
				out.stone = Math.max(0, out.stone - 1);
			else if (job === "metal")
				out.metal = Math.max(0, out.metal - 1);
			if (ent.isIdle && ent.isIdle())
				out.idle = Math.max(0, out.idle - 1);
		}
		return out;
	}

	claimWorker(gameState, ent)
	{
		if (!this.isExpertControlActive(gameState) || !this.isExpertEconomyEntity(ent))
			return false;
		if (ent.setMetadata)
		{
			ent.setMetadata(PlayerID, DEFAULT_OWNERSHIP_METADATA, true);
			if (ent.getMetadata(PlayerID, "role") === undefined && !hasClass(ent, "Cavalry"))
				ent.setMetadata(PlayerID, "role", Worker.ROLE_WORKER);
			if (ent.getMetadata(PlayerID, "subrole") === undefined && !hasClass(ent, "Cavalry"))
				ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_IDLE);
		}
		return true;
	}

	handleWorker(gameState, ent)
	{
		return this.claimWorker(gameState, ent);
	}

	findCC(gameState)
	{
		for (const ent of gameState.getOwnStructures().values())
			if (entityPosition(ent) && hasClass(ent, "CivCentre") &&
			    (!ent.foundationProgress || ent.foundationProgress() === undefined))
				return ent;
		return undefined;
	}

	baseAccess(gameState, cc)
	{
		const bases = this.HQ.baseManagers();
		if (bases.length && Number.isFinite(bases[0].accessIndex))
			return bases[0].accessIndex;
		return getLandAccess(gameState, cc);
	}

	foodCaptureContext(gameState, cc, accessIndex)
	{
		return {
			"getLandAccess": getLandAccess,
			"territoryMap": this.HQ.territoryMap,
			"anchorPosition": cc.position(),
			"accessIndex": accessIndex,
			"playerId": PlayerID,
			"linkDistance": 24
		};
	}

	clustersOverlap(a, b)
	{
		if (!a || !b || !Array.isArray(a.ids) || !Array.isArray(b.ids))
			return false;
		const ids = new Set(a.ids);
		return b.ids.some(id => ids.has(id));
	}

	foodClusters(gameState, foodContext)
	{
		try
		{
			return collectFoodClusters(gameState, foodContext);
		}
		catch (e)
		{
			return [];
		}
	}

	foodClusterNetwork(gameState, foodContext)
	{
		const clusters = this.foodClusters(gameState, foodContext).map(cluster => {
			const availableIds = [];
			for (const id of cluster.ids || [])
			{
				const supply = gameState.getEntityById(id);
				if (supply && supply.resourceSupplyAmount && supply.resourceSupplyAmount() > 0 && !isSupplyFull(gameState, supply))
					availableIds.push(id);
			}
			return { ...cluster, availableIds, covered: this.foodClusterCovered(gameState, cluster) };
		});
		return {
			clusters,
			totalRemaining: clusters.reduce((sum, cluster) => sum + Math.max(0, Number(cluster.remaining) || 0), 0),
			availableClusters: clusters.filter(cluster => cluster.availableIds.length)
		};
	}

	naturalFoodClusterWorkers(gameState, cluster)
	{
		if (!cluster || !Array.isArray(cluster.ids) || !cluster.ids.length)
			return [];
		const ids = new Set(cluster.ids.map(Number));
		const workers = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !ent.getMetadata || !hasClass(ent, "Civilian") || hasClass(ent, "CitizenSoldier") || hasClass(ent, "Cavalry"))
				continue;
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			if (job !== "food" && job !== "food_owned")
				continue;
			const supplyId = Number(ent.getMetadata(PlayerID, SUPPLY_ID));
			const siteIds = decodeFoodSite(ent.getMetadata(PlayerID, FOOD_SITE));
			if (ids.has(supplyId) || siteIds.some(id => ids.has(Number(id))))
				workers.push(ent);
		}
		return workers;
	}

	naturalFoodSupplyLoads(gameState, cluster, excludeId = undefined)
	{
		const ids = new Set((cluster && cluster.ids || []).map(Number));
		const loads = new Map([...ids].map(id => [id, 0]));
		for (const worker of gameState.getOwnUnits().values())
		{
			if (!worker || !worker.getMetadata || worker.id() === excludeId ||
			    !hasClass(worker, "Civilian") || hasClass(worker, "CitizenSoldier") || hasClass(worker, "Cavalry"))
				continue;
			const job = worker.getMetadata(PlayerID, JOB_METADATA);
			if (job !== "food" && job !== "food_owned")
				continue;
			const supplyId = Number(worker.getMetadata(PlayerID, SUPPLY_ID));
			if (loads.has(supplyId))
				loads.set(supplyId, loads.get(supplyId) + 1);
		}
		return loads;
	}

	naturalFoodClusterActiveWorkers(gameState, cluster)
	{
		const loads = this.naturalFoodSupplyLoads(gameState, cluster);
		let total = 0;
		for (const value of loads.values())
			total += value;
		return total;
	}

	naturalFoodSupplyWorkerLimit(gameState, supplyId, cluster)
	{
		const policy = mergePolicy();
		const supply = gameState.getEntityById(Number(supplyId));
		const name = supply && supply.templateName ? String(supply.templateName()).toLowerCase() : "";
		// Apple trees are a single, larger source: up to three civilians is efficient.
		// Berry bushes remain one-per-bush after Wicker. Use template names when the
		// simulation exposes them, with a safe three-worker fallback for an isolated
		// unknown single fruit source.
		if (name.includes("apple"))
			return Math.max(1, Number(policy.naturalFoodAppleTreeMaxWorkers) || 3);
		if (name.includes("berry") || name.includes("berries"))
			return this.wickerCompleted(gameState) ? Math.max(1, Number(policy.naturalFoodMaxWorkersPerSupply) || 1) : Infinity;
		if ((cluster && cluster.ids || []).length === 1)
			return Math.max(1, Number(policy.naturalFoodSingleSupplyMaxWorkers) || 3);
		return this.wickerCompleted(gameState) ? Math.max(1, Number(policy.naturalFoodMaxWorkersPerSupply) || 1) : Infinity;
	}

	naturalFoodClusterHasPreferredSlot(gameState, cluster, ent)
	{
		if (!cluster || !ent || !ent.getMetadata)
			return false;
		const ids = new Set((cluster.ids || []).map(Number));
		const currentSupplyId = Number(ent.getMetadata(PlayerID, SUPPLY_ID));
		if (ids.has(currentSupplyId))
			return true;
		const active = this.naturalFoodClusterActiveWorkers(gameState, cluster);
		if (active >= mergePolicy().naturalFoodMaxWorkersPerCluster)
			return false;
		const loads = this.naturalFoodSupplyLoads(gameState, cluster, ent.id());
		return (cluster.availableIds || []).some(id => {
			const limit = this.naturalFoodSupplyWorkerLimit(gameState, id, cluster);
			return !Number.isFinite(limit) || (loads.get(Number(id)) || 0) < limit;
		});
	}

	naturalFoodClusterAllowsWorker(gameState, cluster, ent)
	{
		if (!cluster || !ent || !ent.getMetadata)
			return false;
		const ids = new Set((cluster.ids || []).map(Number));
		const supplyId = Number(ent.getMetadata(PlayerID, SUPPLY_ID));
		// A worker with a real live assignment may finish that bush. Merely committing
		// FOOD_SITE metadata is not permission to bypass the one-worker-per-supply rule.
		if (ids.has(supplyId))
			return true;
		return this.naturalFoodClusterHasPreferredSlot(gameState, cluster, ent);
	}

	territoryNaturalFoodMetrics(gameState, foodNetwork)
	{
		let current = 0;
		for (const cluster of foodNetwork && foodNetwork.clusters || [])
			for (const id of cluster.ids || [])
			{
				const supply = gameState.getEntityById(Number(id));
				if (!supply || !supply.resourceSupplyAmount)
					continue;
				const amount = Math.max(0, Number(supply.resourceSupplyAmount()) || 0);
				current += amount;
				const key = String(Number(id));
				const prior = Number(this.naturalFoodDiscoveredAmounts[key]) || 0;
				// Some fruit regenerates slowly. Preserve the largest amount observed while
				// the supply is in our territory so regeneration does not make the ratio > 1.
				if (amount > prior)
					this.naturalFoodDiscoveredAmounts[key] = amount;
			}
		const discovered = Object.values(this.naturalFoodDiscoveredAmounts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
		const ratio = discovered > 0 ? Math.max(0, Math.min(1, current / discovered)) : 0;
		this.lastTerritoryNaturalFoodRatio = ratio;
		return { current, discovered, ratio };
	}

	immediateFoodCapacitySlots(gameState, foodNetwork)
	{
		const policy = mergePolicy();
		let slots = 0;
		for (const cluster of foodNetwork && foodNetwork.clusters || [])
		{
			const loads = this.naturalFoodSupplyLoads(gameState, cluster);
			const activeAssigned = [...loads.values()].reduce((sum, value) => sum + value, 0);
			let preferredSupplySlots = 0;
			for (const id of cluster.ids || [])
			{
				const supply = gameState.getEntityById(id);
				if (!supply || !supply.resourceSupplyAmount || supply.resourceSupplyAmount() <= 0 || isSupplyFull(gameState, supply))
					continue;
				const hard = supply.maxGatherers ? Number(supply.maxGatherers()) : NaN;
				const live = supply.resourceSupplyNumGatherers ? Number(supply.resourceSupplyNumGatherers()) || 0 : 0;
				const queued = this.HQ.basesManager && this.HQ.basesManager.GetTCGatherer ? Number(this.HQ.basesManager.GetTCGatherer(id)) || 0 : 0;
				const engineOpen = Number.isFinite(hard) && hard > 0 ? Math.max(0, hard - live - queued) : 1;
				if (engineOpen > 0)
				{
					const limit = this.naturalFoodSupplyWorkerLimit(gameState, id, cluster);
					preferredSupplySlots += Number.isFinite(limit) ?
						Math.max(0, Math.min(engineOpen, limit - (loads.get(Number(id)) || 0))) : engineOpen;
				}
			}
			const clusterSlots = Math.max(0, policy.naturalFoodMaxWorkersPerCluster - activeAssigned);
			slots += Math.min(preferredSupplySlots, clusterSlots);
		}

		// Permanent fields are not subject to the natural-patch eight-worker ceiling.
		for (const field of this.builtByClass(gameState, "Field"))
		{
			if (!field || !field.resourceSupplyAmount || field.resourceSupplyAmount() <= 0 || isSupplyFull(gameState, field))
				continue;
			const hard = field.maxGatherers ? Number(field.maxGatherers()) : NaN;
			const live = field.resourceSupplyNumGatherers ? Number(field.resourceSupplyNumGatherers()) || 0 : 0;
			const queued = this.HQ.basesManager && this.HQ.basesManager.GetTCGatherer ? Number(this.HQ.basesManager.GetTCGatherer(field.id())) || 0 : 0;
			slots += Number.isFinite(hard) && hard > 0 ? Math.max(0, hard - live - queued) : 1;
		}
		return slots;
	}

	lowestBankTarget(resources, allowed = ["wood", "metal", "stone"], weights = {})
	{
		return [...allowed].sort((a, b) =>
			((Number(resources[a]) || 0) / Math.max(0.01, Number(weights[a]) || 1)) -
			((Number(resources[b]) || 0) / Math.max(0.01, Number(weights[b]) || 1)) || a.localeCompare(b))[0];
	}

	foodDropsites(gameState)
	{
		const out = [];
		for (const structure of gameState.getOwnStructures().values())
			if (entityPosition(structure) && hasClass(structure, "DropsiteFood") && (!structure.foundationProgress || structure.foundationProgress() === undefined))
				out.push(structure);
		return out;
	}

	foodClusterDropDistance(gameState, cluster)
	{
		if (!cluster || !cluster.center)
			return Infinity;
		let best = Infinity;
		for (const dropsite of this.foodDropsites(gameState))
			best = Math.min(best, Math.sqrt(SquareVectorDistance(cluster.center, dropsite.position())));
		return best;
	}

	foodClusterFarmsteadWorthwhile(gameState, cluster)
	{
		const policy = mergePolicy();
		if (!cluster || !(cluster.remaining > 0))
			return false;
		const distance = this.foodClusterDropDistance(gameState, cluster);
		if (!Number.isFinite(distance))
			return cluster.remaining >= policy.minimumAlternativeNaturalFood;
		if (distance <= policy.naturalFoodDropsiteComfortDistance)
			return false;
		const trips = cluster.remaining / Math.max(1, policy.naturalFoodFarmsteadCarryCapacity);
		const distanceSaved = Math.max(0, distance - policy.naturalFoodFarmsteadIdealDistance);
		const workerSecondsSaved = trips * 2 * distanceSaved / Math.max(1, policy.naturalFoodFarmsteadAssumedWalkSpeed);
		return workerSecondsSaved >= policy.naturalFoodFarmsteadPaybackWorkerSeconds;
	}

	foodClusterScore(gameState, ent, cluster)
	{
		if (!cluster || !cluster.availableIds || !cluster.availableIds.length)
			return -Infinity;
		const rates = ent.resourceGatherRates ? ent.resourceGatherRates() || {} : {};
		let rawRate = 0;
		for (const id of cluster.availableIds)
		{
			const supply = gameState.getEntityById(id);
			const type = supply && supply.resourceSupplyType ? supply.resourceSupplyType() : undefined;
			if (type && type.generic === "food")
				rawRate = Math.max(rawRate, Number(rates["food." + type.specific]) || 0);
		}
		let template;
		try { template = ent.templateName ? gameState.getTemplate(ent.templateName()) : undefined; }
		catch (e) { template = undefined; }
		const walkSpeed = template && typeof template.walkSpeed === "function" ? Number(template.walkSpeed()) || 1 : 1;
		const dropDistance = this.foodClusterDropDistance(gameState, cluster);
		const effective = effectiveGatherRate(rawRate, 10, Number.isFinite(dropDistance) ? dropDistance : 50, walkSpeed);
		// Prefer effective throughput first, then remaining food so a worker commits to a
		// useful site instead of bouncing between two nearby bushes every controller tick.
		return effective * 1000 + Math.min(999, Math.max(0, Number(cluster.remaining) || 0));
	}

	playerGatheredResource(gameState, generic)
	{
		const candidates = [
			gameState && gameState.playerData,
			gameState && gameState.sharedScript && gameState.sharedScript.playersData && gameState.sharedScript.playersData[PlayerID],
			gameState && gameState.ai && gameState.ai.sharedScript && gameState.ai.sharedScript.playersData && gameState.ai.sharedScript.playersData[PlayerID]
		];
		for (const data of candidates)
		{
			const value = data && data.statistics && data.statistics.resourcesGathered && Number(data.statistics.resourcesGathered[generic]);
			if (Number.isFinite(value))
				return value;
		}
		return undefined;
	}

	playerGatheredFood(gameState)
	{
		return this.playerGatheredResource(gameState, "food");
	}

	measureDeliveredFoodIncome(gameState)
	{
		const now = Number(gameState.ai.elapsedTime) || 0;
		const total = this.playerGatheredFood(gameState);
		if (!Number.isFinite(total))
			return { measured: false, rate: 0 };
		if (!this.foodIncomeSample)
		{
			this.foodIncomeSample = { time: now, total };
			return { measured: this.foodIncomeMeasured, rate: this.foodIncomeEMA };
		}
		const dt = now - this.foodIncomeSample.time;
		if (dt >= 4 && total >= this.foodIncomeSample.total)
		{
			const instantaneous = (total - this.foodIncomeSample.total) / dt;
			this.foodIncomeEMA = this.foodIncomeMeasured ? 0.65 * this.foodIncomeEMA + 0.35 * instantaneous : instantaneous;
			this.foodIncomeMeasured = true;
			this.foodIncomeSample = { time: now, total };
		}
		return { measured: this.foodIncomeMeasured, rate: Math.max(0, this.foodIncomeEMA) };
	}

	measureDeliveredWoodIncome(gameState)
	{
		const now = Number(gameState.ai.elapsedTime) || 0;
		const total = this.playerGatheredResource(gameState, "wood");
		if (!Number.isFinite(total))
			return { measured: false, rate: 0, total: undefined, deliveredNow: false };
		if (!this.woodIncomeSample)
		{
			this.woodIncomeSample = { time: now, total };
			this.woodLastDeliveryAt = now;
			return { measured: this.woodIncomeMeasured, rate: this.woodIncomeEMA, total, deliveredNow: false };
		}
		const dt = now - this.woodIncomeSample.time;
		let deliveredNow = false;
		if (dt >= 4 && total >= this.woodIncomeSample.total)
		{
			const delta = total - this.woodIncomeSample.total;
			const instantaneous = delta / dt;
			this.woodIncomeEMA = this.woodIncomeMeasured ? 0.65 * this.woodIncomeEMA + 0.35 * instantaneous : instantaneous;
			this.woodIncomeMeasured = true;
			if (delta > 0)
			{
				this.woodLastDeliveryAt = now;
				deliveredNow = true;
			}
			this.woodIncomeSample = { time: now, total };
		}
		return { measured: this.woodIncomeMeasured, rate: Math.max(0, this.woodIncomeEMA), total, deliveredNow };
	}

	foodClusterCovered(gameState, cluster)
	{
		if (!cluster || !cluster.center)
			return false;
		if (this.readyNextFoodCluster && this.clustersOverlap(cluster, this.readyNextFoodCluster))
			return true;
		for (const pending of Object.values(this.pendingFoodSelectionByTask))
			if (this.clustersOverlap(cluster, pending))
				return true;
		// CCs and farmsteads are both valid food dropsites. A fruit patch already close
		// to the CC must not trigger a redundant farmstead merely because it is not close
		// to the opening farmstead.
		const comfort = mergePolicy().naturalFoodDropsiteComfortDistance;
		for (const dropsite of this.foodDropsites(gameState))
			if (SquareVectorDistance(dropsite.position(), cluster.center) <= comfort * comfort)
				return true;
		return false;
	}

	alternativeFoodInfo(gameState, foodContext, foodObservation)
	{
		const current = new Set(foodObservation && foodObservation.ids || []);
		const policy = mergePolicy();
		const allClusters = this.foodClusters(gameState, foodContext);
		if (this.activeNaturalExpansionCluster)
		{
			const active = allClusters.find(cluster => this.clustersOverlap(cluster, this.activeNaturalExpansionCluster));
			const remaining = active ? Math.max(0, Number(active.remaining) || 0) : 0;
			if (active && remaining > (Number(policy.naturalExpansionDepletionThreshold) || 10))
			{
				// The newly-served source is still productive. Report it as covered so the
				// planner cannot leapfrog to source #3 while source #2 is barely started.
				return {
					"clusters": [active], "next": active, "remaining": remaining,
					"covered": true, "physicallyCovered": true, "farmsteadWorthwhile": false
				};
			}
			aiWarn("[EXPERT-FOOD] serviced natural district exhausted; next expansion unlocked remaining=" + Math.round(remaining));
			this.activeNaturalExpansionCluster = undefined;
		}
		const alternatives = allClusters.filter(cluster =>
			cluster.remaining >= policy.minimumAlternativeNaturalFood && !cluster.ids.some(id => current.has(id)));
		const details = alternatives.map(cluster => {
			const physicallyCovered = this.foodClusterCovered(gameState, cluster);
			const farmsteadWorthwhile = this.foodClusterFarmsteadWorthwhile(gameState, cluster);
			return { cluster, physicallyCovered, farmsteadWorthwhile, covered: physicallyCovered || !farmsteadWorthwhile };
		});
		// IT14.15: once the Wicker branch is covered, do not keep reporting that
		// already-served cluster as the only alternative. Walk outward through every
		// worthwhile uncovered in-territory cluster before permanent farms begin.
		const selected = details.find(item => item.farmsteadWorthwhile && !item.physicallyCovered) || details[0];
		const next = selected && selected.cluster;
		return {
			"clusters": alternatives,
			"next": next,
			"remaining": next ? next.remaining : 0,
			"covered": selected ? selected.covered : false,
			"physicallyCovered": selected ? selected.physicallyCovered : false,
			"farmsteadWorthwhile": selected ? selected.farmsteadWorthwhile : false
		};
	}

	advanceFoodTracker(gameState, foodContext)
	{
		let observation = this.foodTracker.observe(gameState, foodContext);
		if (observation.remaining > 0)
			return observation;

		const clusters = this.foodClusters(gameState, foodContext);
		let next;
		if (this.readyNextFoodCluster)
			next = clusters.find(cluster => this.clustersOverlap(cluster, this.readyNextFoodCluster));
		if (!next)
			next = clusters.find(cluster => this.foodClusterCovered(gameState, cluster));
		if (!next)
			return observation;

		this.foodTracker.retarget(next);
		this.readyNextFoodCluster = undefined;
		observation = this.foodTracker.observe(gameState, foodContext);
		aiWarn("[EXPERT-FOOD] switched natural-food cluster remaining=" + Math.round(observation.remaining));
		return observation;
	}

	foodPathSources(gameState, ids)
	{
		const out = [];
		for (const id of ids || [])
		{
			const ent = gameState.getEntityById(id);
			const pos = entityPosition(ent);
			if (pos)
				out.push(pos);
		}
		return out;
	}

	templateBuildTime(template)
	{
		if (!template || typeof template.get !== "function")
			return 0;
		const value = Number(template.get("Cost/BuildTime"));
		return Number.isFinite(value) && value > 0 ? value : 0;
	}

	housingMetrics(gameState, cc)
	{
		const houseType = gameState.applyCiv(BUILDING_SPECS.house.template);
		const house = gameState.getTemplate(houseType);
		const training = this.trainingExecution(gameState, cc);
		const civilian = training && training.template ? gameState.getTemplate(training.template) : undefined;
		const workers = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		return {
			"houseBuildTime": this.templateBuildTime(house),
			"housePopulationBonus": house && typeof house.getPopulationBonus === "function" ? Number(house.getPopulationBonus()) || 0 : 0,
			"civilianTrainTime": this.templateBuildTime(civilian),
			"activeMilitaryTrainers": this.builtByClass(gameState, "Barracks").length,
			"ccSoldierActive": workers.civilians >= this.currentCivilianCap(gameState)
		};
	}

	trainerBatchTimeModifier(gameState, trainer)
	{
		if (!trainer || !trainer.templateName)
			return 1;
		let template;
		try
		{
			template = gameState.getBuiltTemplate ? gameState.getBuiltTemplate(trainer.templateName()) : gameState.getTemplate(trainer.templateName());
		}
		catch (e)
		{
			return 1;
		}
		if (!template || typeof template.get !== "function")
			return 1;
		const value = Number(template.get("Trainer/BatchTimeModifier"));
		return Number.isFinite(value) && value > 0 ? value : 1;
	}

	batchFoodBurnRate(gameState, trainer, unitType, batchSize)
	{
		if (!trainer || !unitType)
			return 0;
		const template = gameState.getTemplate(unitType);
		if (!template)
			return 0;
		const batch = Math.max(1, Math.floor(Number(batchSize) || 1));
		const baseTime = this.templateBuildTime(template);
		if (!(baseTime > 0))
			return 0;
		let cost = 0;
		try
		{
			const raw = template.cost ? template.cost(trainer) : undefined;
			cost = Number(raw && raw.food) || 0;
		}
		catch (e)
		{
			cost = 0;
		}
		if (!(cost > 0))
			return 0;
		const modifier = this.trainerBatchTimeModifier(gameState, trainer);
		const totalTime = baseTime * Math.pow(batch, modifier);
		return totalTime > 0 ? cost * batch / totalTime : 0;
	}

	foodThroughputMetrics(gameState, cc, foodNetwork)
	{
		const policy = mergePolicy();
		let activeNaturalRate = 0;
		let expectedNaturalDepletionRate = 0;
		let activeFarmRate = 0;
		let farmWorkers = 0;
		let grainRateSamples = 0;
		let grainRateTotal = 0;

		// This is deliberately ACTUAL-order based. A worker merely labelled "food" does
		// not contribute theoretical income while walking, oscillating, building or idle.
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !ent.getMetadata || !ent.resourceGatherRates)
				continue;
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			if (!["food", "food_owned", "farm"].includes(job))
				continue;
			const rates = ent.resourceGatherRates() || {};
			const grain = Number(rates["food.grain"]) || 0;
			if (grain > 0)
			{
				grainRateTotal += grain;
				++grainRateSamples;
			}
			const targetId = Number(ent.getMetadata(PlayerID, SUPPLY_ID));
			const supply = Number.isFinite(targetId) ? gameState.getEntityById(targetId) : undefined;
			const type = supply && supply.resourceSupplyType ? supply.resourceSupplyType() : undefined;
			const rate = type && type.generic === "food" ? Number(rates["food." + type.specific]) || 0 : 0;

			// Runway is a long-run depletion estimate, not current delivered income. For a
			// worker assigned to natural food, include the source<->dropsite walking cost so
			// a distant berry patch is correctly slower than an adjacent one. This estimate
			// never gets added to measured income; it is used only to decide WHEN fields must
			// be prepared before the natural network runs out.
			if (supply && type && type.generic === "food" && !hasClass(supply, "Field") && rate > 0)
			{
				const cluster = foodNetwork && foodNetwork.clusters ? foodNetwork.clusters.find(c => (c.ids || []).includes(targetId)) : undefined;
				let template;
				try { template = ent.templateName ? gameState.getTemplate(ent.templateName()) : undefined; } catch (e) { template = undefined; }
				const walkSpeed = template && typeof template.walkSpeed === "function" ? Number(template.walkSpeed()) || 1 : 1;
				const distance = cluster ? this.foodClusterDropDistance(gameState, cluster) : 0;
				expectedNaturalDepletionRate += effectiveGatherRate(rate, 10, Number.isFinite(distance) ? distance : 50, walkSpeed);
			}

			if (!Number.isFinite(targetId) || !hasLiveGatherOrder(ent, targetId))
				continue;
			const state = ent.unitAIState ? String(ent.unitAIState() || "") : "";
			if (!state.includes("GATHER.GATHERING") || !supply || !type || type.generic !== "food")
				continue;
			if (hasClass(supply, "Field"))
			{
				activeFarmRate += rate;
				++farmWorkers;
			}
			else
				activeNaturalRate += rate;
		}

		const delivered = this.measureDeliveredFoodIncome(gameState);
		const measuredFoodIncomeRate = delivered.measured ? delivered.rate : activeNaturalRate + activeFarmRate;
		const averageFarmerRate = farmWorkers > 0 ? activeFarmRate / farmWorkers : grainRateSamples > 0 ? grainRateTotal / grainRateSamples : 0.7;
		const workers = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		const civilianExecution = this.trainingExecution(gameState, cc);
		const civilianBatch = gameState.getPopulation() < 24 ? 3 : gameState.getResources().food >= 450 ? 4 : 3;
		const ccFoodBurnRate = workers.civilians < this.currentCivilianCap(gameState) && civilianExecution && civilianExecution.template ?
			this.batchFoodBurnRate(gameState, cc, civilianExecution.template, civilianBatch) : 0;

		let barracksRate = 0;
		const barracks = this.builtByClass(gameState, "Barracks").sort((a, b) => a.id() - b.id())[0];
		if (barracks)
		{
			const selected = this.selectInfantrySoldier(gameState, barracks, "barracks");
			if (selected)
				barracksRate = this.batchFoodBurnRate(gameState, barracks, selected.type, policy.soldierTrainingBatch);
		}

		const naturalRemaining = foodNetwork ? foodNetwork.totalRemaining : 0;
		const naturalRunway = naturalRunwaySeconds(naturalRemaining, Math.max(activeNaturalRate, expectedNaturalDepletionRate));
		return {
			"naturalIncomeRate": activeNaturalRate,
			"expectedNaturalDepletionRate": expectedNaturalDepletionRate,
			"farmIncomeRate": activeFarmRate,
			"measuredFoodIncomeRate": Math.max(0, measuredFoodIncomeRate),
			"measuredFoodIncomeAvailable": delivered.measured,
			"totalNaturalRemaining": naturalRemaining,
			"naturalRunwaySeconds": Number.isFinite(naturalRunway) ? naturalRunway : 99999,
			"averageFarmerRate": averageFarmerRate,
			"ccFoodBurnRate": ccFoodBurnRate,
			"oneBarracksFoodBurnRate": ccFoodBurnRate + barracksRate,
			"twoBarracksFoodBurnRate": ccFoodBurnRate + 2 * barracksRate
		};
	}

	isCityStateCiv(gameState)
	{
		return CITY_STATE_CIVS.has(gameState.getPlayerCiv());
	}

	wickerTechNames()
	{
		return ["gather_wicker_baskets", "gather_wicker_baskets_maur"];
	}

	multipleWorthwhileFruit(foodClusters)
	{
		const policy = mergePolicy();
		return (foodClusters || []).filter(cluster => cluster.remaining >= policy.minimumAlternativeNaturalFood).length >= 2;
	}

	wickerCommitted(gameState, queues)
	{
		const names = this.wickerTechNames();
		if (names.some(name => gameState.isResearched(name) || gameState.isResearching(name)))
			return true;
		const q = queues && queues.minorTech;
		return !!(q && q.plans && q.plans.some(plan => plan.metadata && plan.metadata.expertEcoTech === "wicker"));
	}

	wickerCompleted(gameState)
	{
		return this.wickerTechNames().some(name => gameState.isResearched(name));
	}

	earlyAxeCommitted(gameState, queues)
	{
		const axe = "gather_lumbering_ironaxes";
		if (gameState.isResearched(axe) || gameState.isResearching(axe))
			return true;
		const q = queues && queues.minorTech;
		return !!(q && q.plans && q.plans.some(plan => plan.metadata && plan.metadata.expertEcoTech === "ironaxes"));
	}

	earlyAxeCompleted(gameState)
	{
		return gameState.isResearched("gather_lumbering_ironaxes");
	}

	expertEcoResourcePressure(gameState)
	{
		const policy = mergePolicy(this.strategyPolicyOverrides(gameState));
		const phase = gameState && gameState.currentPhase ? Math.max(1, Number(gameState.currentPhase()) || 1) : 1;
		const resources = gameState && gameState.getResources ? gameState.getResources() : {};
		const food = Math.max(0, Number(resources.food) || 0);
		const wood = Math.max(0, Number(resources.wood) || 0);
		const foodTarget = phase >= 2 ? Number(policy.ecoSmartFoodBankTargetP2) || 900 : Number(policy.ecoSmartFoodBankTargetP1) || 650;
		const woodTarget = phase >= 2 ? Number(policy.ecoSmartWoodBankTargetP2) || 750 : Number(policy.ecoSmartWoodBankTargetP1) || 550;
		const clamp = value => Math.max(0.5, Math.min(3.0, value));
		let foodPressure = clamp(foodTarget / Math.max(100, food));
		let woodPressure = clamp(woodTarget / Math.max(100, wood));

		// IT14.55 smart eco-tech ordering: bank imbalance matters more than a fixed
		// "farm before lumber" list. If one primary resource is abundant while the
		// other is below its operating target, accelerate the bottleneck and devalue
		// another upgrade to the already-rich resource. Food and wood remain the two
		// primary resources; stone/metal lanes never receive this primary-resource bonus.
		const abundance = Math.max(1.25, Number(policy.ecoSmartAbundanceRatio) || 1.6);
		const bottleneckBonus = Math.max(0, Number(policy.ecoSmartBottleneckPressureBonus) || 0.9);
		if (food >= foodTarget * abundance && wood < woodTarget)
		{
			woodPressure = clamp(woodPressure + bottleneckBonus);
			foodPressure = clamp(foodPressure * 0.65);
		}
		else if (wood >= woodTarget * abundance && food < foodTarget)
		{
			foodPressure = clamp(foodPressure + bottleneckBonus);
			woodPressure = clamp(woodPressure * 0.65);
		}

		return { food, wood, foodTarget, woodTarget, foodPressure, woodPressure, phase };
	}

	expertEcoTechPressureScore(gameState, values, name = "")
	{
		const pressure = this.expertEcoResourcePressure(gameState);
		let score = 0;
		let foodTech = false;
		let woodTech = false;
		for (const rawValue of values || [])
		{
			const value = String(rawValue || "");
			if (value.includes("food.grain"))
			{
				foodTech = true;
				score += 145 * pressure.foodPressure;
			}
			else if (value.includes("food.fruit"))
			{
				foodTech = true;
				score += 125 * pressure.foodPressure;
			}
			else if (value.includes("wood.tree"))
			{
				woodTech = true;
				score += 140 * pressure.woodPressure;
			}
			else if (value.includes("stone.rock") || value.includes("metal.ore"))
				score += 75;
			else if (value.startsWith("ResourceGatherer/Capacities"))
				score += 95 * Math.max(pressure.foodPressure, pressure.woodPressure);
			else if (value.startsWith("ResourceGatherer/"))
				score += 50;
		}

		// Names are a fallback for techs whose modification schema is less explicit.
		if (!foodTech && String(name).startsWith("gather_farming_"))
		{
			foodTech = true;
			score += 120 * pressure.foodPressure;
		}
		if (!woodTech && String(name).startsWith("gather_lumbering_"))
		{
			woodTech = true;
			score += 120 * pressure.woodPressure;
		}

		// Make a genuine primary-resource shortage decisive rather than merely a
		// five-point tie-break. This is the human-like rule the user asked for:
		// e.g. 1500 food / 250 wood should buy the affordable wood upgrade before plows.
		const decisive = Math.max(0, Number(mergePolicy().ecoSmartBottleneckScoreBonus) || 110);
		if (woodTech && pressure.woodPressure >= pressure.foodPressure + 0.35)
			score += decisive;
		if (foodTech && pressure.foodPressure >= pressure.woodPressure + 0.35)
			score += decisive;
		return { score, foodTech, woodTech, pressure };
	}

	openingTechSafeBeforeHouse(gameState, cc, policy)
	{
		if (!cc)
			return false;
		const housing = this.housingMetrics(gameState, cc);
		const trigger = predictiveHouseTrigger({ "housing": housing }, policy);
		const accounted = this.HQ.getAccountedPopulation(gameState);
		const queuedCivilians = gameState.ai.queues.villager ? gameState.ai.queues.villager.countQueuedUnits() : 0;
		const free = gameState.getPopulationLimit() - accounted - queuedCivilians;
		return free > trigger + policy.basketsBeforeHouseExtraHeadroom;
	}

	deferFirstHouseForCityStateWicker(gameState, queues, foodClusters)
	{
		if (!this.isCityStateCiv(gameState) || !this.multipleWorthwhileFruit(foodClusters))
			return false;
		if (this.builtByClass(gameState, "House").length || this.foundationsByClass(gameState, "House").length)
			return false;
		if (this.wickerCompleted(gameState))
			return false;
		// Never create a hard population lock if something external delayed the tech.
		const free = gameState.getPopulationLimit() - this.HQ.getAccountedPopulation(gameState);
		return free > mergePolicy().houseEmergencyFreePopulation;
	}

	filterFrameForOpeningTech(gameState, queues, foodClusters, frame)
	{
		const wickerGate = this.deferFirstHouseForCityStateWicker(gameState, queues, foodClusters);
		const wickerExpansionGate = this.isCityStateCiv(gameState) && this.multipleWorthwhileFruit(foodClusters) &&
			this.builtByClass(gameState, "Farmstead").length >= 1 && !this.wickerCompleted(gameState);
		const storehouseSecured = this.builtByClass(gameState, "Storehouse").length > 0 ||
			this.foundationsByClass(gameState, "Storehouse").length > 0 ||
			(gameState.ai.queues.dropsites && gameState.ai.queues.dropsites.plans &&
			 gameState.ai.queues.dropsites.plans.some(plan => plan.metadata && plan.metadata.expertDecisionKind === "storehouse"));
		const noHouseYet = this.builtByClass(gameState, "House").length === 0 && this.foundationsByClass(gameState, "House").length === 0;
		const free = gameState.getPopulationLimit() - this.HQ.getAccountedPopulation(gameState);
		// Athens/Thebes opening contract: after the opening storehouse is secured, Iron Axe
		// completes before the first house/field unless population is at genuine emergency headroom.
		// Wicker may still precede it when there are multiple worthwhile fruit patches.
		const axeGate = EARLY_AXE_CIVS.has(gameState.getPlayerCiv()) && storehouseSecured && noHouseYet &&
			!this.earlyAxeCompleted(gameState) && free > mergePolicy().houseEmergencyFreePopulation;
		if (!wickerGate && !wickerExpansionGate && !axeGate)
			return frame;
		return {
			...frame,
			"actions": frame.actions.filter(action => {
				if (action.type === "PAUSE_POPULATION_TRAINING")
					return false;
				if (action.kind === "house" && (wickerGate || axeGate))
					return false;
				if (action.kind === "farmstead" && wickerExpansionGate)
					return false;
				if (action.kind === "field" && axeGate)
					return false;
				return true;
			})
		};
	}

	applyPostWickerBerryPeel(gameState, foodObservation, foodAlternative)
	{
		const policy = mergePolicy();
		if (this.postWickerBerryPeelDone || !policy.postWickerOneWorkerPerBush || !this.wickerCompleted(gameState))
			return;
		const liveIds = (foodObservation && foodObservation.ids || []).filter(id => {
			const supply = gameState.getEntityById(Number(id));
			return supply && supply.resourceSupplyAmount && supply.resourceSupplyAmount() > 0 && !hasClass(supply, "Animal");
		});
		if (!liveIds.length)
			return;
		const live = new Set(liveIds.map(Number));
		const workers = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !entityPosition(ent) || !hasClass(ent, "Civilian") || hasClass(ent, "CitizenSoldier") || hasClass(ent, "Cavalry"))
				continue;
			if (ent.getMetadata(PlayerID, TASK_KEY) !== undefined || ent.getMetadata(PlayerID, EXPERT_CIVILIAN_EVAC) !== undefined)
				continue;
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			const supplyId = Number(ent.getMetadata(PlayerID, SUPPLY_ID));
			if ((job === "food" || job === "food_owned") && live.has(supplyId))
				workers.push(ent);
		}
		if (workers.length <= live.size)
		{
			this.postWickerBerryPeelDone = true;
			aiWarn("[EXPERT-BERRIES] Wicker peel complete workers=" + workers.length + " bushes=" + live.size + " moved=0");
			return;
		}

		// Keep one assigned civilian per live bush. Existing assignments are deliberately
		// sticky; this is a one-time Wicker transition, not a continuous rebalance loop.
		const keep = new Set();
		for (const id of live)
		{
			const group = workers.filter(ent => Number(ent.getMetadata(PlayerID, SUPPLY_ID)) === id).sort((a, b) => a.id() - b.id());
			if (group.length)
				keep.add(group[0].id());
		}
		for (const ent of workers.slice().sort((a, b) => a.id() - b.id()))
		{
			if (keep.size >= Math.min(live.size, workers.length))
				break;
			keep.add(ent.id());
		}
		const peel = workers.filter(ent => !keep.has(ent.id()));

		// IT14.14: if Wicker reveals spare berry workers AND a worthwhile secondary
		// in-territory food cluster exists, those workers establish that branch instead
		// of becoming lumberjacks. The same two civilians build the farmstead and then
		// remain locked to that cluster. Only fall back to wood when there is no useful
		// secondary natural-food job.
		const branch = foodAlternative && foodAlternative.next && foodAlternative.next.center &&
			foodAlternative.next.remaining >= policy.minimumAlternativeNaturalFood ? foodAlternative.next : undefined;
		if (branch && peel.length)
		{
			const site = encodeFoodSite(branch.ids);
			const now = Number(gameState.ai.elapsedTime) || 0;
			this.postWickerBranchCluster = { ...branch, ids: [...branch.ids], center: [...branch.center] };
			this.postWickerBranchWorkerIds = peel.map(ent => ent.id());
			// A cluster already comfortably covered by a food dropsite needs no redundant
			// farmstead. Otherwise keep the peeled civilians on their present berries until
			// the branch farmstead foundation owns them; this prevents a failed placement
			// attempt from sending them on a long food walk before the dropsite exists.
			this.postWickerBranchFarmsteadPending = !!(foodAlternative.farmsteadWorthwhile && !foodAlternative.physicallyCovered);
			for (const ent of peel)
			{
				ent.setMetadata(PlayerID, EXPERT_WICKER_BRANCH, true);
				ent.setMetadata(PlayerID, EXPERT_WICKER_PEELED, undefined);
				if (this.postWickerBranchFarmsteadPending)
					continue;
				const oldSite = encodeFoodSite(decodeFoodSite(ent.getMetadata(PlayerID, FOOD_SITE)));
				if (oldSite && oldSite !== site)
					ent.setMetadata(PlayerID, FOOD_PREVIOUS_SITE, oldSite);
				ent.setMetadata(PlayerID, NATURAL_FOOD_LOCK, site);
				ent.setMetadata(PlayerID, FOOD_SITE, site);
				ent.setMetadata(PlayerID, FOOD_SITE_CHANGED_AT, now);
				ent.setMetadata(PlayerID, SUPPLY_ID, undefined);
				this.setDesiredJob(gameState, ent, "food_owned");
			}
			aiWarn("[EXPERT-BERRIES] Wicker branch workers=" + peel.length + " food=" + Math.round(branch.remaining) +
				" farmstead=" + this.postWickerBranchFarmsteadPending);
		}
		else
		{
			for (const ent of peel)
			{
				ent.setMetadata(PlayerID, EXPERT_WICKER_PEELED, true);
				this.setDesiredJob(gameState, ent, "wood");
				aiWarn("[EXPERT-BERRIES] post-Wicker peel worker=" + ent.id() + " -> wood deposit-first");
			}
		}
		this.postWickerBerryPeelDone = true;
		aiWarn("[EXPERT-BERRIES] Wicker peel complete workers=" + workers.length + " bushes=" + live.size + " moved=" + peel.length);
	}

	applyPostWickerBranchConstruction(frame)
	{
		if (!this.postWickerBranchFarmsteadPending || !this.postWickerBranchCluster || !this.postWickerBranchWorkerIds.length)
			return frame;
		// Branch establishment owns the farmstead slot while it is pending. Do not let
		// the ordinary 25% transition planner race these same workers with another hub.
		const actions = (frame.actions || []).filter(action => action.kind !== "farmstead");
		if (this.activeTaskByKind.farmstead)
			actions.push({ "type": "MAINTAIN_CONSTRUCTION", "kind": "farmstead", "role": "wicker_branch",
				"builderPool": ["food", "food_owned"], "requiredBuilderIds": [...this.postWickerBranchWorkerIds], "builderCount": 2 });
		else
			actions.push({ "type": "BUILD", "kind": "farmstead", "role": "wicker_branch", "priority": 99,
				"builderPool": ["food", "food_owned"], "requiredBuilderIds": [...this.postWickerBranchWorkerIds] });
		return { ...frame, actions };
	}

	researchExpertEcoTech(gameState, queues, foodClusters, cc)
	{
		if (!queues || !queues.minorTech || queues.minorTech.hasQueuedUnits())
			return;

		const policy = mergePolicy();
		const availableTechs = gameState.findAvailableTech() || [];
		const available = new Map();
		for (const tech of availableTechs)
			if (tech && tech[0])
				available.set(tech[0], tech[1]);

		const farmsteadSecured = this.builtByClass(gameState, "Farmstead").length > 0 ||
			this.foundationsByClass(gameState, "Farmstead").length > 0 ||
			(gameState.ai.queues.dropsites && gameState.ai.queues.dropsites.plans &&
			 gameState.ai.queues.dropsites.plans.some(plan => plan.metadata && plan.metadata.expertDecisionKind === "farmstead"));
		const storehouseSecured = this.builtByClass(gameState, "Storehouse").length > 0 ||
			this.foundationsByClass(gameState, "Storehouse").length > 0 ||
			(gameState.ai.queues.dropsites && gameState.ai.queues.dropsites.plans &&
			 gameState.ai.queues.dropsites.plans.some(plan => plan.metadata && plan.metadata.expertDecisionKind === "storehouse"));

		const houseBuilt = this.builtByClass(gameState, "House").length > 0;
		const houseSecured = houseBuilt || this.foundationsByClass(gameState, "House").length > 0 ||
			(gameState.ai.queues.house && gameState.ai.queues.house.hasQueuedUnits());

		const baskets = this.wickerTechNames();
		const multipleFruit = this.multipleWorthwhileFruit(foodClusters);
		const basketDone = baskets.some(name => gameState.isResearched(name));
		const basketBusy = baskets.some(name => gameState.isResearching(name));
		if (multipleFruit && !basketDone && !basketBusy && farmsteadSecured && storehouseSecured)
		{
			// Greek city states deliberately buy Baskets first when multiple fruit sources
			// exist. Other civs retain the predictive safety calculation.
			let safeBeforeHouse = this.isCityStateCiv(gameState) || houseBuilt;
			if (!safeBeforeHouse && !houseBuilt && cc)
			{
				const housing = this.housingMetrics(gameState, cc);
				const trigger = predictiveHouseTrigger({ "housing": housing }, policy);
				const accounted = this.HQ.getAccountedPopulation(gameState);
				const queuedCivilians = gameState.ai.queues.villager ? gameState.ai.queues.villager.countQueuedUnits() : 0;
				const free = gameState.getPopulationLimit() - accounted - queuedCivilians;
				safeBeforeHouse = free > trigger + policy.basketsBeforeHouseExtraHeadroom;
			}

			if (safeBeforeHouse)
			{
				const name = baskets.find(tech => available.has(tech));
				if (name)
				{
					const plan = new ResearchPlan(gameState, name, true);
					plan.metadata = { "expertDecisionLayer": true, "expertEcoTech": "wicker" };
					queues.minorTech.addPlan(plan);
					// Opening dropsites remain first (950).  Safe baskets beat a normal house (900).
					gameState.ai.queueManager.changePriority("minorTech", Math.max(this.HQ.Config.priorities.minorTech || 1, this.isCityStateCiv(gameState) ? 980 : 925));
					aiWarn("[EXPERT-TECH] queued " + name + (houseBuilt ? "" : " before first house"));
				}
			}
			return;
		}
		if (multipleFruit && !basketDone)
			return;

		// Athens and Thebes deliberately take Iron Axe before the first house once the
		// opening storehouse is secured. Wicker still wins first with multiple fruit.
		// The housing filter carries the emergency-pop escape hatch.
		const earlyAxe = EARLY_AXE_CIVS.has(gameState.getPlayerCiv()) && storehouseSecured && !houseBuilt;
		if (!houseSecured && !earlyAxe)
			return;
		const axe = "gather_lumbering_ironaxes";
		const axeDone = gameState.isResearched(axe);
		const axeBusy = gameState.isResearching(axe);
		if (!axeDone)
		{
			if (axeBusy)
				return;
			if (available.has(axe))
			{
				const plan = new ResearchPlan(gameState, axe, true);
				plan.metadata = { "expertDecisionLayer": true, "expertEcoTech": "ironaxes" };
				queues.minorTech.addPlan(plan);
				gameState.ai.queueManager.changePriority("minorTech", Math.max(this.HQ.Config.priorities.minorTech || 1, earlyAxe && !houseSecured ? 940 : 700));
				aiWarn("[EXPERT-TECH] queued " + axe + (earlyAxe && !houseSecured ? " before first house" : ""));
				return;
			}
		}

		// Human Athens references consistently add Plows as the first fields come online.
		// Do not buy it speculatively before the permanent farm engine has actually started.
		const plows = "gather_farming_plows";
		const farmStarted = this.builtByClass(gameState, "Field").length > 0 ||
			this.foundationsByClass(gameState, "Field").length > 0 ||
			(gameState.ai.queues.field && gameState.ai.queues.field.hasQueuedUnits());
		if (farmStarted && !gameState.isResearched(plows) && !gameState.isResearching(plows) && available.has(plows))
		{
			const plowPlan = new ResearchPlan(gameState, plows, true);
			plowPlan.metadata = { "expertDecisionLayer": true, "expertEcoTech": "plows" };
			queues.minorTech.addPlan(plowPlan);
			gameState.ai.queueManager.changePriority("minorTech", Math.max(this.HQ.Config.priorities.minorTech || 1, 760));
			aiWarn("[EXPERT-TECH] queued " + plows + " with farm transition");
			return;
		}

		// After the replay-locked opening upgrades, surplus resources should become
		// productivity instead of a 5,000-food bank. Research any affordable Village-
		// phase technology that actually improves gathering/carrying, prioritizing the
		// resources with the largest current workforces.
		const resources = gameState.getResources();
		if (resources.food < policy.ecoTechSurplusFood && resources.wood < policy.ecoTechSurplusWood)
			return;
		const economic = [];
		for (const [name, tech] of available.entries())
		{
			if (!tech || !tech._template || !Array.isArray(tech._template.modifications))
				continue;
			const values = tech._template.modifications.map(mod => mod && String(mod.value || ""));
			if (!values.some(value => value.startsWith("ResourceGatherer/")))
				continue;
			const rawCost = tech._template.cost || {};
			const cost = {
				"food": Number(rawCost.food) || 0, "wood": Number(rawCost.wood) || 0,
				"stone": Number(rawCost.stone) || 0, "metal": Number(rawCost.metal) || 0
			};
			if (resources.food < cost.food + policy.ecoTechFoodReserve ||
			    resources.wood < cost.wood + policy.ecoTechWoodReserve ||
			    resources.stone < cost.stone || resources.metal < cost.metal)
				continue;
			const smart = this.expertEcoTechPressureScore(gameState, values, name);
			const totalCost = cost.food + cost.wood + cost.stone + cost.metal;
			economic.push({ name, score: smart.score * 1000 - totalCost, smart });
		}
		if (!economic.length)
			return;
		economic.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
		const pick = economic[0].name;
		const plan = new ResearchPlan(gameState, pick, false);
		if (!plan)
			return;
		plan.metadata = { "expertDecisionLayer": true, "expertEcoTech": "surplus" };
		queues.minorTech.addPlan(plan);
		gameState.ai.queueManager.changePriority("minorTech", Math.max(this.HQ.Config.priorities.minorTech || 1, 620));
		const pickInfo = economic[0].smart && economic[0].smart.pressure;
		aiWarn("[EXPERT-TECH] queued surplus eco upgrade " + pick +
			(pickInfo ? " smartPressure=f" + pickInfo.foodPressure.toFixed(2) + "/w" + pickInfo.woodPressure.toFixed(2) +
			" bank=" + Math.round(pickInfo.food) + "/" + Math.round(pickInfo.wood) : ""));
	}


	researchExpertP1EcoSweep(gameState, queues)
	{
		const doctrine = this.ensureStrategicDoctrine(gameState);
		const policy = mergePolicy(this.strategyPolicyOverrides(gameState));
		if (!doctrine.p1EcoSweepBeforeP2 || !gameState.currentPhase || gameState.currentPhase() !== 1 ||
		    gameState.ai.elapsedTime < policy.p1EcoSweepStartTime || !gameState.ai || !gameState.ai.queueManager)
			return 0;

		const queueManager = gameState.ai.queueManager;
		const laneCount = Math.max(1, Number(policy.p1EcoSweepMaxQueued) || 6);
		const lanes = [];
		for (let i = 0; i < laneCount; ++i)
		{
			const name = "expertP1EcoTech" + (i + 1);
			queueManager.addQueue(name, 1050 - i * 3);
			lanes.push(name);
		}

		const alreadyQueued = new Set();
		for (const name of lanes)
		{
			const q = gameState.ai.queues[name];
			for (const plan of q && q.plans || [])
				if (plan && plan.type)
					alreadyQueued.add(plan.type);
		}
		for (const qName of ["minorTech"])
			for (const plan of gameState.ai.queues[qName] && gameState.ai.queues[qName].plans || [])
				if (plan && plan.type)
					alreadyQueued.add(plan.type);

		const candidates = [];
		for (const tech of gameState.findAvailableTech() || [])
		{
			const name = tech && tech[0], data = tech && tech[1];
			if (!name || alreadyQueued.has(name) || gameState.isResearched(name) || gameState.isResearching(name) ||
			    !data || !data._template || !Array.isArray(data._template.modifications))
				continue;
			const values = data._template.modifications.map(mod => String(mod && mod.value || ""));
			if (!values.some(value => value.startsWith("ResourceGatherer/")))
				continue;
			// IT14.55 mining has its own protected lane. Keeping it out of the broad P1
			// sweep prevents food/wood upgrades and the phase reservation from accidentally
			// starving or double-reserving the two first-tier mining technologies.
			if (String(name).startsWith("gather_mining_") ||
			    values.some(value => value.includes("stone.rock") || value.includes("metal.ore")))
				continue;
			const raw = data._template.cost || {};
			const cost = { food: Number(raw.food) || 0, wood: Number(raw.wood) || 0,
				stone: Number(raw.stone) || 0, metal: Number(raw.metal) || 0 };
			const smart = this.expertEcoTechPressureScore(gameState, values, name);
			candidates.push({ name, cost, score: smart.score * 1000 - cost.food - cost.wood - cost.stone - cost.metal, smart });
		}
		if (!candidates.length)
			return 0;
		candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

		const resources = gameState.getResources();
		let remaining = { food: Number(resources.food) || 0, wood: Number(resources.wood) || 0,
			stone: Number(resources.stone) || 0, metal: Number(resources.metal) || 0 };
		// Before Town Phase is actually reserved, keep enough bank for the phase click.
		// Once it is queued/researching the queue manager has already reserved that cost.
		const nextPhase = gameState.getPhaseName ? gameState.getPhaseName(2) : undefined;
		const phaseCommitted = (nextPhase && gameState.isResearching && gameState.isResearching(nextPhase)) ||
			(queues && queues.majorTech && queues.majorTech.hasQueuedUnits());
		if (!phaseCommitted)
		{
			const info = this.phaseTechInfo(gameState);
			const cost = info && info.cost || {};
			remaining.food -= Number(cost.food) || 0;
			remaining.wood -= Number(cost.wood) || 0;
			remaining.stone -= Number(cost.stone) || 0;
			remaining.metal -= Number(cost.metal) || 0;
		}

		let queued = 0;
		for (const lane of lanes)
		{
			const q = gameState.ai.queues[lane];
			if (!q || q.hasQueuedUnits())
				continue;
			const index = candidates.findIndex(c => remaining.food >= c.cost.food && remaining.wood >= c.cost.wood &&
				remaining.stone >= c.cost.stone && remaining.metal >= c.cost.metal);
			if (index < 0)
				continue;
			const pick = candidates.splice(index, 1)[0];
			const plan = new ResearchPlan(gameState, pick.name, false);
			if (!plan)
				continue;
			plan.metadata = { "expertDecisionLayer": true, "expertEcoTech": "p1-sweep", "strategy": doctrine.id };
			q.addPlan(plan);
			queueManager.changePriority(lane, 1050 - lanes.indexOf(lane) * 3);
			remaining.food -= pick.cost.food; remaining.wood -= pick.cost.wood;
			remaining.stone -= pick.cost.stone; remaining.metal -= pick.cost.metal;
			++queued;
			const pressure = pick.smart && pick.smart.pressure;
			aiWarn("[EXPERT-STRATEGY] P1 eco sweep queued=" + pick.name + " lane=" + lane +
				(pressure ? " smartPressure=f" + pressure.foodPressure.toFixed(2) + "/w" + pressure.woodPressure.toFixed(2) +
				" bank=" + Math.round(pressure.food) + "/" + Math.round(pressure.wood) : ""));
		}
		if (!queued && gameState.ai.elapsedTime - this.lastP1EcoSweepDiag >= 20)
		{
			this.lastP1EcoSweepDiag = gameState.ai.elapsedTime;
			aiWarn("[EXPERT-STRATEGY] P1 eco sweep waiting candidates=" + candidates.length +
				" phaseCommitted=" + phaseCommitted);
		}
		return queued;
	}



	researchExpertMiningEcoTech(gameState, queues, frame)
	{
		if (!gameState || !gameState.currentPhase || !gameState.ai || !gameState.ai.queueManager)
			return false;
		const phase = Number(gameState.currentPhase()) || 1;
		if (phase < 1 || phase > 2)
			return false;
		const policy = mergePolicy(this.strategyPolicyOverrides(gameState));
		const now = Number(gameState.ai.elapsedTime) || 0;
		if (phase === 1)
		{
			if (now < policy.miningTechP1StartTime || gameState.getPopulation() < policy.miningTechP1MinimumPopulation ||
			    this.builtByClass(gameState, "Field").length < policy.miningTechP1MinimumFields)
				return false;
			// Town Phase always wins the instant it becomes a valid click.
			const phaseDecision = this.phase2Readiness(gameState, frame);
			if (phaseDecision && phaseDecision.ready)
				return false;
		}

		const queueName = "expertMiningEcoTech";
		const priority = Number(policy.miningTechPriority) || 805;
		gameState.ai.queueManager.addQueue(queueName, priority);
		const queue = gameState.ai.queues[queueName];
		if (!queue || queue.hasQueuedUnits())
			return !!(queue && queue.hasQueuedUnits());

		const alreadyQueued = new Set();
		for (const qName of Object.keys(gameState.ai.queues || {}))
			for (const qPlan of gameState.ai.queues[qName] && gameState.ai.queues[qName].plans || [])
				if (qPlan && qPlan.type)
					alreadyQueued.add(qPlan.type);

		const workers = this.economyWorkerMetrics(gameState);
		const candidates = [];
		for (const item of gameState.findAvailableTech() || [])
		{
			const name = item && item[0], data = item && item[1];
			if (!name || alreadyQueued.has(name) || gameState.isResearched(name) || gameState.isResearching(name) ||
			    !data || !data._template || !Array.isArray(data._template.modifications))
				continue;
			const values = data._template.modifications.map(mod => String(mod && mod.value || ""));
			const stone = values.some(value => value.includes("stone.rock"));
			const metal = values.some(value => value.includes("metal.ore"));
			// This lane is deliberately only the two Village mining upgrades. Higher
			// mining tiers remain normal surplus eco choices later in Town/City.
			if (!P1_MINING_TECHS.has(String(name)) || (!stone && !metal))
				continue;
			const raw = data._template.cost || {};
			const cost = { food: Number(raw.food) || 0, wood: Number(raw.wood) || 0,
				stone: Number(raw.stone) || 0, metal: Number(raw.metal) || 0 };
			const total = cost.food + cost.wood + cost.stone + cost.metal;
			let score = 100000 - total;
			if (stone) score += 3000 + 250 * (Number(workers.stone) || 0);
			if (metal) score += 3000 + 250 * (Number(workers.metal) || 0);
			candidates.push({ name, cost, score });
		}
		if (!candidates.length)
			return false;
		candidates.sort((a,b) => b.score - a.score || a.name.localeCompare(b.name));

		const resources = gameState.getResources();
		let phaseReserve = { food: 0, wood: 0, stone: 0, metal: 0 };
		if (phase === 1)
		{
			const info = this.phaseTechInfo(gameState);
			if (info && info.cost)
				phaseReserve = { food: Number(info.cost.food) || 0, wood: Number(info.cost.wood) || 0,
					stone: Number(info.cost.stone) || 0, metal: Number(info.cost.metal) || 0 };
		}
		const foodReserve = phase === 1 ? policy.miningTechP1FoodReserve : policy.miningTechP2FoodReserve;
		const woodReserve = phase === 1 ? policy.miningTechP1WoodReserve : policy.miningTechP2WoodReserve;
		for (const candidate of candidates)
		{
			if ((Number(resources.food) || 0) < candidate.cost.food + phaseReserve.food + foodReserve ||
			    (Number(resources.wood) || 0) < candidate.cost.wood + phaseReserve.wood + woodReserve ||
			    (Number(resources.stone) || 0) < candidate.cost.stone + phaseReserve.stone ||
			    (Number(resources.metal) || 0) < candidate.cost.metal + phaseReserve.metal)
				continue;
			const plan = new ResearchPlan(gameState, candidate.name, false);
			if (!plan)
				continue;
			plan.metadata = { "expertDecisionLayer": true, "expertEcoTech": phase === 1 ? "p1-mining" : "p2-mining", "phase": phase };
			queue.addPlan(plan);
			gameState.ai.queueManager.changePriority(queueName, priority);
			aiWarn("[EXPERT-MINING-TECH] queued=" + candidate.name + " phase=" + phase +
				" bank=" + Math.round(resources.food) + "/" + Math.round(resources.wood) + "/" +
				Math.round(resources.stone) + "/" + Math.round(resources.metal) +
				(phase === 1 ? " protectedP2=" + Math.round(phaseReserve.food) + "/" + Math.round(phaseReserve.wood) + "/" + Math.round(phaseReserve.stone) + "/" + Math.round(phaseReserve.metal) : ""));
			return true;
		}
		return false;
	}

	researchExpertAthenianSlingerUnlock(gameState, queues)
	{
		if (!gameState || gameState.getPlayerCiv() !== "athen" || !gameState.ai || !gameState.ai.queueManager)
			return false;
		const techName = "unlock_slingers";
		if (gameState.isResearched(techName) || gameState.isResearching(techName))
			return false;
		if (!this.builtByClass(gameState, "Forge").length)
			return false;
		const available = new Map(gameState.findAvailableTech() || []);
		if (!available.has(techName) || !(gameState.hasResearchers && gameState.hasResearchers(techName, true)))
			return false;

		const queueName = "expertUnlockTech";
		gameState.ai.queueManager.addQueue(queueName, 820);
		const queue = gameState.ai.queues[queueName];
		if (!queue || queue.hasQueuedUnits())
			return !!(queue && queue.hasQueuedUnits());

		const plan = new ResearchPlan(gameState, techName, false);
		if (!plan)
			return false;
		const liveCost = plan.getCost();
		const cost = {
			food: Math.max(0, Number(liveCost.food) || 0),
			wood: Math.max(0, Number(liveCost.wood) || 0),
			stone: Math.max(0, Number(liveCost.stone) || 0),
			metal: Math.max(0, Number(liveCost.metal) || 0)
		};
		const policy = mergePolicy();
		const res = gameState.getResources();
		const lowWood = this.phaseWoodCrisis || this.woodIncomeStalled ||
			(Number(res.wood) || 0) <= (Number(policy.athensSlingerLowWood) || 300);
		if (!lowWood)
			return false;
		const foodReady = (Number(res.food) || 0) >= Math.max(Number(policy.athensSlingerUnlockMinimumFoodBank) || 900,
			cost.food + (Number(policy.athensSlingerUnlockFoodReserve) || 600));
		const stoneReady = (Number(res.stone) || 0) >= cost.stone + (Number(policy.athensSlingerUnlockStoneReserve) || 75);
		const metalReady = (Number(res.metal) || 0) >= cost.metal;
		// Until the data-side unlock is converted to its intended four-unit cost, do not
		// spend scarce wood to solve a wood shortage. With the planned 300F/100S cost this
		// gate naturally opens without any AI hardcoding of that price.
		const woodSafe = cost.wood <= 0;
		if (!foodReady || !stoneReady || !metalReady || !woodSafe)
		{
			const now = Number(gameState.ai.elapsedTime) || 0;
			if (now - this.lastAthenianSlingerDiag >= 20)
			{
				this.lastAthenianSlingerDiag = now;
				aiWarn("[EXPERT-SLINGER] waiting unlock cost=" + Math.round(cost.food) + "/" + Math.round(cost.wood) + "/" +
					Math.round(cost.stone) + "/" + Math.round(cost.metal) + " bank=" + Math.round(res.food) + "/" +
					Math.round(res.wood) + "/" + Math.round(res.stone) + "/" + Math.round(res.metal) +
					(!woodSafe ? " reason=unlock-still-costs-wood" : " reason=reserve"));
			}
			return false;
		}

		plan.metadata = { "expertDecisionLayer": true, "expertUnlockTech": "slingers", "woodPressure": true };
		queue.addPlan(plan);
		gameState.ai.queueManager.changePriority(queueName, 820);
		aiWarn("[EXPERT-SLINGER] queued " + techName + " liveCost=" + Math.round(cost.food) + "/" +
			Math.round(cost.wood) + "/" + Math.round(cost.stone) + "/" + Math.round(cost.metal) +
			" bankWood=" + Math.round(res.wood));
		return true;
	}

	researchExpertHopliteTradition(gameState, queues, frame)
	{
		if (!gameState || !gameState.currentPhase || !queues || !queues.minorTech ||
		    queues.minorTech.hasQueuedUnits())
			return false;
		const civ = gameState.getPlayerCiv && gameState.getPlayerCiv();
		if (!new Set(["athen", "spart", "theb"]).has(civ))
			return false;
		const techName = "citystate/hoplite_tradition";
		if (gameState.isResearched(techName) || gameState.isResearching(techName))
			return false;

		const available = new Map(gameState.findAvailableTech() || []);
		const tech = available.get(techName);
		if (!tech || !tech._template)
			return false;

		const phase = gameState.currentPhase();
		const policy = mergePolicy();
		const now = Number(gameState.ai.elapsedTime) || 0;
		const barracks = this.builtByClass(gameState, "Barracks").length;
		const fields = this.builtByClass(gameState, "Field").length;
		const fieldPipeline = fields + this.foundationsByClass(gameState, "Field").length +
			(gameState.ai.queues.field ? gameState.ai.queues.field.countQueuedUnits() : 0);
		const templePipeline = this.builtByClass(gameState, "Temple").length +
			this.foundationsByClass(gameState, "Temple").length +
			(gameState.ai.queues.economicBuilding && gameState.ai.queues.economicBuilding.plans ?
			 gameState.ai.queues.economicBuilding.plans.filter(plan =>
				plan && plan.metadata && plan.metadata.expertDecisionKind === "temple").length : 0);
		if (barracks < 2 || templePipeline < 1)
			return false;

		const raw = tech._template.cost || {};
		const cost = {
			food: Math.max(0, Number(raw.food) || 0),
			wood: Math.max(0, Number(raw.wood) || 0),
			stone: Math.max(0, Number(raw.stone) || 0),
			metal: Math.max(0, Number(raw.metal) || 0)
		};
		const resources = gameState.getResources();

		if (phase === 1)
		{
			if (now < policy.hopliteTraditionMinimumTime ||
			    now > policy.hopliteTraditionLatestP1StartTime ||
			    gameState.getPopulation() < policy.hopliteTraditionMinimumPopulation ||
			    fieldPipeline < policy.hopliteTraditionMinimumFieldPipeline)
				return false;

			// Town Phase always wins once it is actually ready. Before that point, only
			// buy Hoplite Tradition if the bank can also preserve the full current P2
			// resource cost plus a modest operating reserve. This prevents the 600-resource
			// tradition tech from recreating the old "Village forever" failure.
			const phaseDecision = this.phase2Readiness(gameState, frame);
			if (phaseDecision && phaseDecision.ready)
				return false;
			const phaseInfo = this.phaseTechInfo(gameState);
			const phaseCost = phaseInfo && phaseInfo.cost || {};
			if (resources.food < cost.food + (phaseCost.food || 0) + policy.hopliteTraditionFoodReserve ||
			    resources.wood < cost.wood + (phaseCost.wood || 0) + policy.hopliteTraditionWoodReserve ||
			    resources.stone < cost.stone + (phaseCost.stone || 0) ||
			    resources.metal < cost.metal + (phaseCost.metal || 0) + policy.hopliteTraditionMetalReserve)
				return false;
		}
		else if (phase === 2)
		{
			// If the strict P1 window was missed, make this the first dedicated City-State
			// doctrine tech once Town is reached and the bank can support it.
			if (resources.food < cost.food + policy.phase2MilitaryTechFoodReserve ||
			    resources.wood < cost.wood + policy.phase2MilitaryTechWoodReserve ||
			    resources.stone < cost.stone ||
			    resources.metal < cost.metal + policy.phase2MilitaryTechMetalReserve)
				return false;
		}
		else
			return false;

		const plan = new ResearchPlan(gameState, techName, false);
		if (!plan)
			return false;
		plan.metadata = { "expertDecisionLayer": true, "expertMilitaryTech": "hoplite_tradition", "phase": phase };
		queues.minorTech.addPlan(plan);
		gameState.ai.queueManager.changePriority("minorTech", Math.max(this.HQ.Config.priorities.minorTech || 1, phase === 1 ? 780 : 760));
		aiWarn("[EXPERT-TECH] queued " + techName + " phase=" + phase +
			" bank=" + Math.round(resources.food) + "/" + Math.round(resources.wood) + "/" +
			Math.round(resources.stone) + "/" + Math.round(resources.metal));
		return true;
	}

	researchExpertP2CoreEcoTech(gameState, queues)
	{
		if (!gameState || !gameState.currentPhase || gameState.currentPhase() < 2 || !gameState.ai || !gameState.ai.queueManager)
			return false;
		const queueManager = gameState.ai.queueManager;
		const policy = mergePolicy();
		const smartPressure = this.expertEcoResourcePressure(gameState);
		// IT14.55 smart eco ordering: process the scarcer primary resource first. The
		// first lane reserves its live tech cost before the second lane is considered,
		// so a farming upgrade can no longer consume the bank needed for a more urgent
		// wood upgrade merely because food used to be hard-coded first.
		const laneDefs = [
			{ name: "expertEcoTechFood", kind: "food", pressure: smartPressure.foodPressure },
			{ name: "expertEcoTechWood", kind: "wood", pressure: smartPressure.woodPressure }
		].sort((a, b) => b.pressure - a.pressure || (a.kind === "wood" ? -1 : 1));
		for (let i = 0; i < laneDefs.length; ++i)
		{
			laneDefs[i].priority = 825 - i * 10;
			queueManager.addQueue(laneDefs[i].name, laneDefs[i].priority);
		}

		const resources = gameState.getResources();
		let remaining = { food: resources.food, wood: resources.wood, stone: resources.stone, metal: resources.metal };
		let coreAvailable = false;
		let queued = 0;
		for (const lane of laneDefs)
		{
			const queue = gameState.ai.queues[lane.name];
			if (queue && queue.hasQueuedUnits())
			{
				coreAvailable = true;
				continue;
			}
			const candidates = [];
			for (const tech of gameState.findAvailableTech() || [])
			{
				const name = tech && tech[0], data = tech && tech[1];
				if (!name || !data || !data._template || !Array.isArray(data._template.modifications) ||
				    (gameState.isResearching && gameState.isResearching(name)))
					continue;
				const values = data._template.modifications.map(mod => String(mod && mod.value || ""));
				const foodTech = String(name).startsWith("gather_farming_") || values.some(value => value.includes("food.grain"));
				const woodTech = String(name).startsWith("gather_lumbering_") || values.some(value => value.includes("wood.tree"));
				if (lane.kind === "food" ? !foodTech : !woodTech)
					continue;
				coreAvailable = true;
				const raw = data._template.cost || {};
				const cost = { food: Number(raw.food) || 0, wood: Number(raw.wood) || 0, stone: Number(raw.stone) || 0, metal: Number(raw.metal) || 0 };
				const total = cost.food + cost.wood + cost.stone + cost.metal;
				const smart = this.expertEcoTechPressureScore(gameState, values, name);
				candidates.push({ name, cost, score: smart.score * 1000 - total, smart });
			}
			if (!candidates.length)
				continue;
			candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
			const pick = candidates.find(c =>
				remaining.food >= c.cost.food + policy.phase2CoreEcoFoodReserve &&
				remaining.wood >= c.cost.wood + policy.phase2CoreEcoWoodReserve &&
				remaining.stone >= c.cost.stone &&
				remaining.metal >= c.cost.metal + policy.phase2CoreEcoMetalReserve);
			if (!pick)
				continue;
			const plan = new ResearchPlan(gameState, pick.name, false);
			if (!plan)
				continue;
			plan.metadata = { "expertDecisionLayer": true, "expertEcoTech": "p2-core-" + lane.kind, "lane": lane.name, "smartPressure": lane.pressure };
			queue.addPlan(plan);
			this.expertObservedCoreEcoTechs[pick.name] = lane.kind;
			queueManager.changePriority(lane.name, lane.priority);
			remaining.food -= pick.cost.food; remaining.wood -= pick.cost.wood;
			remaining.stone -= pick.cost.stone; remaining.metal -= pick.cost.metal;
			++queued;
			aiWarn("[EXPERT-P2-ECO] queued " + pick.name + " lane=" + lane.name +
				" smartPressure=f" + smartPressure.foodPressure.toFixed(2) + "/w" + smartPressure.woodPressure.toFixed(2) +
				" bank=" + Math.round(smartPressure.food) + "/" + Math.round(smartPressure.wood));
		}
		return coreAvailable || queued > 0;
	}

	expertObservedTechCount(gameState, observed)
	{
		let queued = 0;
		let completed = 0;
		for (const name of Object.keys(observed || {}))
		{
			++queued;
			if (gameState.isResearched && gameState.isResearched(name))
				++completed;
		}
		return { queued, completed };
	}

	expertP2PushInPreparation()
	{
		const manager = this.HQ && this.HQ.attackManager;
		if (!manager)
			return false;
		for (const collection of [manager.upcomingAttacks, manager.startedAttacks])
			for (const type of Object.keys(collection || {}))
				for (const plan of collection[type] || [])
					if (plan && plan.unitCollection && plan.unitCollection.length >= 20)
						return true;
		return false;
	}

	researchExpertP2MilitaryTech(gameState, queues)
	{
		this.lastP2MilitaryTechCandidateAvailable = false;
		if (!gameState || !gameState.currentPhase || gameState.currentPhase() < 2 || !gameState.ai || !gameState.ai.queueManager)
			return false;

		const forgeCount = this.builtByClass(gameState, "Forge").length;
		if (!forgeCount)
			return false;
		const policy = mergePolicy();
		const militaryProgress = this.expertObservedTechCount(gameState, this.expertObservedP2MilitaryTechs);
		const ecoProgress = this.expertObservedTechCount(gameState, this.expertObservedCoreEcoTechs);
		const p2Push = this.expertP2PushInPreparation();
		const bank = gameState.getResources();
		// IT14.47: the first food+wood Town eco pair remains mandatory after the opening
		// two military upgrades.  After that continuity package is protected, however,
		// an army that is already assembling/fighting may convert a genuine bank surplus
		// into additional military techs instead of waiting for every second-tier eco tech.
		if (militaryProgress.queued >= policy.expertP2MilitaryTechsBeforeEco && ecoProgress.queued < 2)
			return false;
		const warMode = p2Push && militaryProgress.queued >= policy.expertP2MilitaryTechsBeforeEco && ecoProgress.queued >= 2;
		const warSurplus = warMode &&
			bank.food >= policy.expertP2WarTechFoodReserve &&
			bank.wood >= policy.expertP2WarTechWoodReserve &&
			bank.stone >= policy.expertP2WarTechStoneReserve &&
			bank.metal >= policy.expertP2WarTechMetalReserve;
		if (militaryProgress.queued >= policy.expertP2MilitaryTechsBeforeSecondEcoPair && ecoProgress.queued < 4 && !warSurplus)
			return false;
		const queueManager = gameState.ai.queueManager;
		const laneNames = ["expertMilitaryTech1", "expertMilitaryTech2"].slice(0, Math.min(2, forgeCount));
		for (let i = 0; i < laneNames.length; ++i)
			queueManager.addQueue(laneNames[i], 780 - i * 5);

		const resources = bank;
		const foodReserve = warMode ? policy.expertP2WarTechFoodReserve : policy.phase2MilitaryTechFoodReserve;
		const woodReserve = warMode ? policy.expertP2WarTechWoodReserve : policy.phase2MilitaryTechWoodReserve;
		const stoneReserve = warMode ? policy.expertP2WarTechStoneReserve : 0;
		const metalReserve = warMode ? policy.expertP2WarTechMetalReserve : policy.phase2MilitaryTechMetalReserve;
		const canBarter = warMode && gameState.getOwnEntitiesByClass("Barter", true).filter(filters.isBuilt()).hasEntities();
		const alreadyQueued = new Set();
		for (const qName of laneNames)
		{
			const queue = gameState.ai.queues[qName];
			if (!queue || !queue.plans)
				continue;
			for (const qPlan of queue.plans)
				if (qPlan && qPlan.type) alreadyQueued.add(qPlan.type);
		}

		// IT14.50: rank forge value against the army that actually exists. Athens is
		// intentionally ~58/42 melee/ranged, so a second melee attack tier should not
		// sit behind low-value luxuries while the metal bank grows.
		let meleeArmy = 0, rangedArmy = 0;
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !ent.hasClass || !ent.hasClass("CitizenSoldier") || ent.hasClass("Cavalry"))
				continue;
			if (ent.hasClass("Melee")) ++meleeArmy;
			else if (ent.hasClass("Ranged")) ++rangedArmy;
		}
		const combatTotal = Math.max(1, meleeArmy + rangedArmy);
		const meleeShare = meleeArmy / combatTotal;
		const rangedShare = rangedArmy / combatTotal;

		const candidates = [];
		for (const tech of gameState.findAvailableTech() || [])
		{
			const name = tech && tech[0], data = tech && tech[1];
			if (!name || alreadyQueued.has(name) || (gameState.isResearching && gameState.isResearching(name)) ||
			    !data || !data._template || !Array.isArray(data._template.modifications))
				continue;
			const affects = String(data._template.affects || "");
			if (!/(CitizenSoldier|Infantry|Soldier|Spearman|Javelineer|Cavalry|Hoplite)/i.test(affects))
				continue;
			let score = 0;
			// The first P2 push wants army-wide value, not a cavalry upgrade while Expert
			// deliberately produces almost no cavalry or a narrow one-unit-class luxury tech.
			if (/(CitizenSoldier|Infantry|Soldier)/i.test(affects)) score += 90;
			if (/Hoplite/i.test(affects)) score += 20;
			if (/Javelineer/i.test(affects) && !/(Infantry|Soldier)/i.test(affects)) score -= 35;
			if (/Cavalry/i.test(affects) && !/(Infantry|CitizenSoldier)/i.test(affects)) score -= 160;
			for (const mod of data._template.modifications)
			{
				const value = String(mod && mod.value || "");
				if (value.startsWith("Attack/")) score += 130;
				else if (value.startsWith("Resistance/")) score += 115;
				else if (value.includes("Health/Max")) score += 105;
				else if (value.startsWith("UnitMotion/")) score += 70;
			}
			if (/attack_melee/i.test(name)) score += Math.round(140 * meleeShare);
			if (/attack_ranged/i.test(name)) score += Math.round(140 * rangedShare);
			if (/resistance_melee/i.test(name)) score += Math.round(90 * meleeShare);
			if (/resistance_ranged/i.test(name)) score += Math.round(90 * rangedShare);
			if (/_02(?:$|\/)/i.test(name)) score += 25;
			if (!score)
				continue;
			this.lastP2MilitaryTechCandidateAvailable = true;
			const raw = data._template.cost || {};
			const cost = { food: Number(raw.food) || 0, wood: Number(raw.wood) || 0, stone: Number(raw.stone) || 0, metal: Number(raw.metal) || 0 };
			const requiredBank = { food: cost.food + foodReserve, wood: cost.wood + woodReserve,
				stone: cost.stone + stoneReserve, metal: cost.metal + metalReserve };
			const affordable = resources.food >= requiredBank.food && resources.wood >= requiredBank.wood &&
				resources.stone >= requiredBank.stone && resources.metal >= requiredBank.metal;
			let barterBridge = false;
			if (!affordable)
			{
				if (!canBarter)
					continue;
				const deficit = Math.max(0, requiredBank.food - resources.food) + Math.max(0, requiredBank.wood - resources.wood) +
					Math.max(0, requiredBank.stone - resources.stone) + Math.max(0, requiredBank.metal - resources.metal);
				const surplus = Math.max(0, resources.food - foodReserve) + Math.max(0, resources.wood - woodReserve) +
					Math.max(0, resources.stone - stoneReserve) + Math.max(0, resources.metal - metalReserve);
				// Queue a high-value tech only when the missing piece is small enough for Petra's
				// already-enabled market barter safety valve to bridge quickly. The queued plan
				// creates an explicit resource need, so performBarter() buys the missing resource.
				if (deficit > 250 || surplus < deficit + 400)
					continue;
				barterBridge = true;
			}
			const totalCost = cost.food + cost.wood + cost.stone + cost.metal;
			candidates.push({ name, cost, score: score * 1000 - totalCost - (barterBridge ? 5000 : 0), barterBridge });
		}
		if (!candidates.length)
			return false;
		candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

		let queued = 0;
		let remaining = { food: resources.food, wood: resources.wood, stone: resources.stone, metal: resources.metal };
		for (const qName of laneNames)
		{
			const queue = gameState.ai.queues[qName];
			if (!queue || queue.hasQueuedUnits())
				continue;
			let pickIndex = -1;
			for (let i = 0; i < candidates.length; ++i)
			{
				const c = candidates[i];
				const canPayNow = remaining.food >= c.cost.food + foodReserve &&
					remaining.wood >= c.cost.wood + woodReserve &&
					remaining.stone >= c.cost.stone + stoneReserve &&
					remaining.metal >= c.cost.metal + metalReserve;
				if (canPayNow || c.barterBridge && queued === 0)
				{ pickIndex = i; break; }
			}
			if (pickIndex < 0)
				continue;
			const pick = candidates.splice(pickIndex, 1)[0];
			const plan = new ResearchPlan(gameState, pick.name, false);
			if (!plan)
				continue;
			plan.metadata = { "expertDecisionLayer": true, "expertMilitaryTech": "p2", "lane": qName };
			queue.addPlan(plan);
			this.expertObservedP2MilitaryTechs[pick.name] = true;
			queueManager.changePriority(qName, qName === "expertMilitaryTech1" ? 780 : 775);
			remaining.food -= pick.cost.food; remaining.wood -= pick.cost.wood;
			remaining.stone -= pick.cost.stone; remaining.metal -= pick.cost.metal;
			++queued;
			aiWarn("[EXPERT-P2] queued military tech " + pick.name + " lane=" + qName +
				(pick.barterBridge ? " mode=barter-bridge" : warSurplus ? " mode=war-surplus" : " mode=core-push"));
		}
		return queued > 0;
	}

	phaseTechInfo(gameState)
	{
		if (!gameState || !gameState.currentPhase || gameState.currentPhase() !== 1)
			return undefined;
		const name = gameState.getPhaseName ? gameState.getPhaseName(2) : undefined;
		if (!name)
			return undefined;

		// Phase technologies are not reliably exposed by findAvailableTech() while Petra
		// is still in Village phase. Petra's own phase manager uses hasResearchers(), so
		// Expert must use the same capability check instead of silently vetoing P2.
		const canResearch = !!(gameState.hasResearchers && gameState.hasResearchers(name, true));
		let raw = {};
		try
		{
			const template = gameState.getTemplate && gameState.getTemplate(name);
			let researcher;
			const researchers = gameState.findResearchers && gameState.findResearchers(name, true);
			if (researchers && researchers.hasEntities && researchers.hasEntities())
				for (const ent of researchers.values())
				{
					researcher = ent;
					break;
				}
			if (template && template.cost)
				raw = template.cost(researcher) || {};
			else if (template && template._template)
				raw = template._template.cost || {};
		}
		catch (e)
		{
			raw = {};
		}
		return {
			name,
			canResearch,
			cost: {
				food: Math.max(0, Number(raw.food) || 0),
				wood: Math.max(0, Number(raw.wood) || 0),
				stone: Math.max(0, Number(raw.stone) || 0),
				metal: Math.max(0, Number(raw.metal) || 0)
			}
		};
	}

	majorPhaseThreat(gameState)
	{
		const policy = mergePolicy();
		if (this.expertDefenseState && this.expertDefenseState.active &&
		    Number(this.expertDefenseState.foeCount || 0) >= policy.phase2MajorThreatUnits)
			return { "major": true, "foes": Number(this.expertDefenseState.foeCount) || 0 };
		const cc = this.findCC(gameState);
		const ccPos = cc && entityPosition(cc);
		let foes = 0;
		for (const army of this.HQ.defenseManager && this.HQ.defenseManager.armies || [])
		{
			if (!army || !Array.isArray(army.foeEntities) || !army.foeEntities.length)
				continue;
			if (ccPos && army.foePosition &&
			    SquareVectorDistance(ccPos, army.foePosition) > policy.phase2MajorThreatRadius * policy.phase2MajorThreatRadius)
				continue;
			for (const id of army.foeEntities)
				if (gameState.getEntityById(id))
					++foes;
		}
		return { "major": foes >= policy.phase2MajorThreatUnits, foes };
	}


	combatStrength(ent)
	{
		if (!ent)
			return 0;
		try
		{
			return Math.max(0, Number(getMaxStrength(ent, this.HQ.Config.debug, this.HQ.Config.DamageTypeImportance)) || 0);
		}
		catch (e)
		{
			return 1;
		}
	}

	isCombatUnit(ent)
	{
		if (!ent || hasClass(ent, "Support") || hasClass(ent, "Trader") || hasClass(ent, "Ship") || hasClass(ent, "FishingBoat"))
			return false;
		try
		{
			return !!(ent.attackTypes && ent.attackTypes() && ent.attackTypes().length);
		}
		catch (e)
		{
			return hasClass(ent, "Soldier") || hasClass(ent, "CitizenSoldier") || hasClass(ent, "Champion") || hasClass(ent, "Cavalry");
		}
	}

	enemyIsApproachingBase(gameState, ent, ccPos, dist)
	{
		const policy = mergePolicy();
		if (dist <= policy.defenseAutomaticDangerRadius)
			return true;
		if (!ent || !ent.unitAIOrderData)
			return false;
		const orders = ent.unitAIOrderData() || [];
		for (const order of orders)
		{
			if (!order)
				continue;
			if (Number.isFinite(Number(order.target)))
			{
				const target = gameState.getEntityById(Number(order.target));
				if (target && target.owner && target.owner() === PlayerID)
					return true;
			}
			const x = Number(order.x), z = Number(order.z);
			if (!Number.isFinite(x) || !Number.isFinite(z))
				continue;
			const destinationDistance = Math.sqrt(SquareVectorDistance([x, z], ccPos));
			if (destinationDistance + policy.defenseApproachImprovement < dist)
				return true;
		}
		return false;
	}

	civilianSafeGarrison(gameState, ent, accessIndex, threatPosition)
	{
		if (!this.HQ.garrisonManager || !ent || !ent.canGarrison || !ent.canGarrison() || !entityPosition(ent))
			return false;
		const holders = [];
		for (const holder of gameState.getOwnStructures().values())
		{
			if (!holder || !entityPosition(holder) || !holder.isGarrisonHolder || !holder.isGarrisonHolder())
				continue;
			if (!hasClass(holder, "House") && !hasClass(holder, "CivCentre"))
				continue;
			if (getLandAccess(gameState, holder) !== accessIndex || !ent.hasClasses || !ent.hasClasses(holder.garrisonableClasses()))
				continue;
			if (this.HQ.garrisonManager.numberOfGarrisonedSlots(holder) >= holder.garrisonMax())
				continue;
			const threatDist = threatPosition ? SquareVectorDistance(holder.position(), threatPosition) : Infinity;
			holders.push({ holder, threatDist, workerDist: SquareVectorDistance(holder.position(), ent.position()) });
		}
		if (!holders.length)
			return false;
		// Prefer a nearby shelter that also moves the civilian away from the threat.
		holders.sort((a, b) => b.threatDist - a.threatDist || a.workerDist - b.workerDist || a.holder.id() - b.holder.id());
		this.HQ.garrisonManager.garrison(gameState, ent, holders[0].holder, "protection");
		aiWarn("[EXPERT-CIV] garrison worker=" + ent.id() + " holder=" + holders[0].holder.id());
		return true;
	}

	assignCivilianSafeWork(gameState, ent, accessIndex, threatPosition, cc)
	{
		if (!ent || !entityPosition(ent) || !threatPosition)
			return false;
		const policy = mergePolicy();
		const currentGeneric = jobResourceType(ent.getMetadata(PlayerID, JOB_METADATA));
		const order = [];
		for (const generic of [currentGeneric, "food", "wood", "metal", "stone"])
			if (generic && !order.includes(generic)) order.push(generic);
		for (const generic of order)
		{
			const candidates = this.resourceCandidatesInOwnTerritory(gameState, ent, accessIndex, generic).filter(supply => {
				const pos = entityPosition(supply);
				return pos && SquareVectorDistance(pos, threatPosition) >= policy.civilianSafeResourceThreatDistance * policy.civilianSafeResourceThreatDistance &&
					(!cc || SquareVectorDistance(pos, cc.position()) <= policy.civilianSafeResourceCCDistance * policy.civilianSafeResourceCCDistance);
			});
			if (!candidates.length)
				continue;
			candidates.sort((a, b) => SquareVectorDistance(ent.position(), a.position()) - SquareVectorDistance(ent.position(), b.position()) || a.id() - b.id());
			const target = candidates[0];
			ent.setMetadata(PlayerID, SUPPLY_ID, target.id());
			ent.setMetadata(PlayerID, "gather-type", generic);
			ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
			if (this.HQ.basesManager && this.HQ.basesManager.AddTCGatherer)
				this.HQ.basesManager.AddTCGatherer(target.id());
			const result = ensureGatherOrder(ent, target);
			aiWarn("[EXPERT-CIV] safe-work worker=" + ent.id() + " resource=" + generic + " target=" + target.id());
			return result.status !== "FAILED";
		}
		return false;
	}

	coordinateCivilianSafety(gameState, cc)
	{
		const policy = mergePolicy();
		const now = Number(gameState.ai.elapsedTime) || 0;
		if (!gameState.getEnemyUnits)
			return;
		const enemies = [];
		for (const enemy of gameState.getEnemyUnits().values())
			if (enemy && entityPosition(enemy) && this.isCombatUnit(enemy))
				enemies.push(enemy);
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !hasClass(ent, "Civilian") || hasClass(ent, "CitizenSoldier") || hasClass(ent, "Cavalry"))
				continue;
			const pos = entityPosition(ent);
			if (!pos)
				continue; // a garrisoned civilian will be released by the normal garrison manager.
			let nearest, nearest2 = Infinity;
			for (const enemy of enemies)
			{
				const d2 = SquareVectorDistance(pos, enemy.position());
				if (d2 < nearest2) { nearest2 = d2; nearest = enemy; }
			}
			const danger = nearest && nearest2 <= policy.civilianDangerRadius * policy.civilianDangerRadius;
			if (!danger)
			{
				const last = Number(ent.getMetadata(PlayerID, EXPERT_CIVILIAN_DANGER_AT));
				if (ent.getMetadata(PlayerID, EXPERT_CIVILIAN_EVAC) !== undefined && Number.isFinite(last) && now - last >= policy.civilianEvacuationReleaseSeconds)
				{
					ent.setMetadata(PlayerID, EXPERT_CIVILIAN_EVAC, undefined);
					ent.setMetadata(PlayerID, EXPERT_CIVILIAN_DANGER_AT, undefined);
					if (ent.getMetadata(PlayerID, "garrisonHolder") === undefined && ent.stopMoving)
						ent.stopMoving();
					aiWarn("[EXPERT-CIV] resume worker=" + ent.id());
				}
				continue;
			}
			ent.setMetadata(PlayerID, EXPERT_CIVILIAN_EVAC, true);
			ent.setMetadata(PlayerID, EXPERT_CIVILIAN_DANGER_AT, now);
			const taskId = ent.getMetadata(PlayerID, TASK_KEY);
			if (taskId !== undefined)
				this.releaseConstructionWorker(ent, taskId);
			if (ent.getMetadata(PlayerID, "garrisonHolder") !== undefined)
				continue;
			const carrying = ent.resourceCarrying ? (ent.resourceCarrying() || []) : [];
			if (carrying.some(item => item && Number(item.amount) > 0))
			{
				if (returnResources(gameState, ent))
					aiWarn("[EXPERT-CIV] deposit-retreat worker=" + ent.id() + " enemy=" + nearest.id());
				continue;
			}
			const accessIndex = getLandAccess(gameState, ent);
			if (nearest2 <= policy.civilianImmediateGarrisonRadius * policy.civilianImmediateGarrisonRadius)
			{
				if (this.civilianSafeGarrison(gameState, ent, accessIndex, nearest.position()))
					continue;
			}
			if (this.assignCivilianSafeWork(gameState, ent, accessIndex, nearest.position(), cc))
				continue;
			this.civilianSafeGarrison(gameState, ent, accessIndex, nearest.position());
		}
	}

	scanIncomingBaseThreat(gameState, cc)
	{
		const policy = mergePolicy();
		const ccPos = cc && entityPosition(cc);
		if (!ccPos || !gameState.getEnemyUnits)
			return undefined;
		const enemies = [];
		let strength = 0;
		let nearest = Infinity;
		const max2 = policy.defenseAwarenessRadius * policy.defenseAwarenessRadius;
		for (const ent of gameState.getEnemyUnits().values())
		{
			const pos = entityPosition(ent);
			if (!pos || !this.isCombatUnit(ent))
				continue;
			const dist2 = SquareVectorDistance(pos, ccPos);
			if (dist2 > max2)
				continue;
			const dist = Math.sqrt(dist2);
			if (!this.enemyIsApproachingBase(gameState, ent, ccPos, dist))
				continue;
			enemies.push(ent);
			strength += this.combatStrength(ent);
			nearest = Math.min(nearest, dist);
		}
		// IT14.38: do not ignore a small raid once it is already inside the economy.
		// Farther threats still need a meaningful group, but 3 attackers inside ~85m
		// are enough to mobilize. This prevents concentrated human armies from killing
		// scattered working citizen-soldiers before the old 12-unit gate trips.
		const required = nearest <= 85 ? 3 : policy.defenseThreatMinimumUnits;
		if (enemies.length < required)
			return undefined;
		const position = centerOf(enemies) || ccPos;
		return { "entities": enemies, "count": enemies.length, strength, position, nearest };
	}

	expertDefenders(gameState)
	{
		const defenders = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!this.isCombatUnit(ent))
				continue;
			if (ent.getMetadata && (ent.getMetadata(PlayerID, "transport") !== undefined || ent.getMetadata(PlayerID, "transporter") !== undefined))
				continue;
			defenders.push(ent);
		}
		return defenders;
	}

	defenseTowerNearBase(gameState, cc)
	{
		const ccPos = cc && entityPosition(cc);
		if (!ccPos)
			return undefined;
		const towers = this.builtByClass(gameState, "Tower").filter(ent => entityPosition(ent));
		towers.sort((a, b) => SquareVectorDistance(a.position(), ccPos) - SquareVectorDistance(b.position(), ccPos) || a.id() - b.id());
		return towers.find(tower => SquareVectorDistance(tower.position(), ccPos) <= 65 * 65);
	}

	towerBuildAffordable(gameState)
	{
		const policy = mergePolicy();
		let type;
		try { type = resolvedTemplate(gameState, "tower"); }
		catch (e) { return false; }
		if (this.HQ.canBuild && !this.HQ.canBuild(gameState, type))
			return false;
		let cost = {};
		try
		{
			const template = gameState.getTemplate(type);
			cost = template && template.cost ? template.cost() || {} : {};
		}
		catch (e) { return false; }
		const res = gameState.getResources();
		for (const resource of ["food", "wood", "stone", "metal"])
		{
			const reserve = resource === "wood" ? policy.defenseTowerReserveWood : 0;
			if ((Number(res[resource]) || 0) < (Number(cost[resource]) || 0) + reserve)
				return false;
		}
		return true;
	}

	clearExpertDefense(gameState, reason = "clear")
	{
		if (!this.expertDefenseState || !this.expertDefenseState.active)
			return;
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !ent.getMetadata || ent.getMetadata(PlayerID, EXPERT_DEFENSE) === undefined)
				continue;
			ent.setMetadata(PlayerID, EXPERT_DEFENSE, undefined);
			ent.setMetadata(PlayerID, EXPERT_DEFENSE_ORDER_AT, undefined);
			ent.setMetadata(PlayerID, EXPERT_DEFENSE_ORDER_STAGE, undefined);
			if (ent.getMetadata(PlayerID, "PartOfArmy") === undefined && ent.position && ent.position() && ent.stopMoving)
				ent.stopMoving();
		}
		aiWarn("[EXPERT-DEF] cleared stage=" + this.expertDefenseState.stage + " reason=" + reason);
		this.expertDefenseState = { "active": false, "stage": "idle", "startedAt": -99999, "lastSeen": Number(gameState.ai.elapsedTime) || 0 };
	}

	defenseGarrisonCount(gameState, tower)
	{
		if (!tower)
			return 0;
		let count = tower.garrisoned ? (tower.garrisoned() || []).length : 0;
		const holders = this.HQ.garrisonManager && this.HQ.garrisonManager.holders;
		if (holders && holders.has(tower.id()))
			count += (holders.get(tower.id()).list || []).length;
		return count;
	}

	garrisonEmergencyTower(gameState, tower, defenders, slots)
	{
		if (!tower || !this.HQ.garrisonManager || slots <= 0)
			return;
		const occupied = this.HQ.garrisonManager.numberOfGarrisonedSlots(tower);
		let left = Math.max(0, Math.min(slots, tower.garrisonMax ? tower.garrisonMax() : slots) - occupied);
		if (!left)
			return;
		const candidates = defenders.filter(ent => entityPosition(ent) && ent.canGarrison && ent.canGarrison() &&
			ent.getMetadata(PlayerID, "garrisonHolder") === undefined && ent.getMetadata(PlayerID, TASK_KEY) === undefined);
		candidates.sort((a, b) => Number(hasClass(b, "Ranged")) - Number(hasClass(a, "Ranged")) ||
			SquareVectorDistance(a.position(), tower.position()) - SquareVectorDistance(b.position(), tower.position()) || a.id() - b.id());
		for (const ent of candidates)
		{
			if (left <= 0)
				break;
			const carrying = ent.resourceCarrying ? ent.resourceCarrying() || [] : [];
			if (carrying.some(item => item && Number(item.amount) > 0))
			{
				returnResources(gameState, ent);
				continue;
			}
			this.HQ.garrisonManager.garrison(gameState, ent, tower, "protection");
			--left;
		}
	}

	unloadEmergencyTower(tower)
	{
		if (!tower || !tower.garrisoned || !tower.unload)
			return;
		for (const id of [...(tower.garrisoned() || [])])
			tower.unload(id);
	}

	issueExpertDefenseOrder(gameState, ent, state, force = false)
	{
		if (!ent || !ent.getMetadata || !ent.setMetadata)
			return false;
		const pos = entityPosition(ent);
		if (!pos)
			return false;
		if (ent.getMetadata(PlayerID, TASK_KEY) !== undefined)
			return false;
		ent.setMetadata(PlayerID, EXPERT_DEFENSE, true);
		if (ent.getMetadata(PlayerID, "garrisonHolder") !== undefined)
			return true;
		const now = Number(gameState.ai.elapsedTime) || 0;
		const lastAt = Number(ent.getMetadata(PlayerID, EXPERT_DEFENSE_ORDER_AT));
		const lastStage = ent.getMetadata(PlayerID, EXPERT_DEFENSE_ORDER_STAGE);
		if (!force && lastStage === state.stage && Number.isFinite(lastAt) && now - lastAt < mergePolicy().defenseOrderRefreshSeconds)
			return true;

		const carrying = ent.resourceCarrying ? ent.resourceCarrying() || [] : [];
		if (state.stage === "assemble")
		{
			let queued = false;
			if (carrying.some(item => item && Number(item.amount) > 0))
				queued = returnResources(gameState, ent);
			if (ent.moveToRange)
				ent.moveToRange(state.rallyPoint[0], state.rallyPoint[1], 8, 20, queued);
		}
		else if (state.stage === "engage")
		{
			if (carrying.some(item => item && Number(item.amount) > 0))
			{
				returnResources(gameState, ent);
				ent.setMetadata(PlayerID, EXPERT_DEFENSE_ORDER_AT, now);
				ent.setMetadata(PlayerID, EXPERT_DEFENSE_ORDER_STAGE, state.stage);
				return true;
			}
			if (ent.attackMove)
				ent.attackMove(state.threatPosition[0], state.threatPosition[1], { "attack": ["Unit"] });
		}
		ent.setMetadata(PlayerID, EXPERT_DEFENSE_ORDER_AT, now);
		ent.setMetadata(PlayerID, EXPERT_DEFENSE_ORDER_STAGE, state.stage);
		return true;
	}

	coordinateExpertDefense(gameState, cc)
	{
		const policy = mergePolicy();
		const now = Number(gameState.ai.elapsedTime) || 0;
		const threat = this.scanIncomingBaseThreat(gameState, cc);
		if (!threat)
		{
			if (this.expertDefenseState.active && now - this.expertDefenseState.lastSeen >= policy.defenseThreatReleaseSeconds)
				this.clearExpertDefense(gameState, "threat-gone");
			return this.expertDefenseState;
		}

		const defenders = this.expertDefenders(gameState);
		const defenderStrength = defenders.reduce((sum, ent) => sum + this.combatStrength(ent), 0);
		const outmatched = threat.strength > Math.max(1, defenderStrength) * policy.defenseTowerOutmatchedRatio ||
			threat.count > Math.max(1, defenders.length) * policy.defenseTowerOutnumberedRatio;
		const ccPos = cc.position();
		const tower = this.defenseTowerNearBase(gameState, cc);
		const towerPending = !!this.activeTaskByKind.tower || this.foundationsByClass(gameState, "Tower").length > 0;

		let state = this.expertDefenseState;
		if (!state.active)
		{
			state = {
				"active": true, "stage": "assemble", "startedAt": now, "lastSeen": now,
				"rallyPoint": [ccPos[0], ccPos[1]]
			};
			aiWarn("[EXPERT-DEF] mobilize incoming=" + threat.count + " defenders=" + defenders.length +
				" nearest=" + Math.round(threat.nearest) + " outmatched=" + outmatched);
		}
		state.lastSeen = now;
		state.threatPosition = [threat.position[0], threat.position[1]];
		state.foeCount = threat.count;
		state.foeStrength = threat.strength;
		state.defenderCount = defenders.length;
		state.defenderStrength = defenderStrength;
		state.outmatched = outmatched;
		state.nearest = threat.nearest;
		state.rallyPoint = [ccPos[0], ccPos[1]];
		state.towerId = tower ? tower.id() : undefined;

		let towerGarrisoned = tower ? new Set([...(tower.garrisoned ? tower.garrisoned() || [] : [])]) : new Set();
		if (tower && this.HQ.garrisonManager && this.HQ.garrisonManager.holders && this.HQ.garrisonManager.holders.has(tower.id()))
			for (const id of this.HQ.garrisonManager.holders.get(tower.id()).list || [])
				towerGarrisoned.add(id);
		let assembled = 0;
		for (const ent of defenders)
		{
			if (towerGarrisoned.has(ent.id()))
			{
				++assembled;
				continue;
			}
			const pos = entityPosition(ent);
			if (pos && SquareVectorDistance(pos, state.rallyPoint) <= policy.defenseAssemblyRadius * policy.defenseAssemblyRadius)
				++assembled;
		}
		state.assembled = assembled;
		state.assemblyFraction = defenders.length ? assembled / defenders.length : 0;

		const warningGood = threat.nearest >= policy.defenseTowerMinWarningDistance && threat.nearest <= policy.defenseTowerMaxWarningDistance;
		state.shouldBuildTower = outmatched && warningGood && !tower && !towerPending &&
			this.emergencyTowerCount < policy.defenseTowerMaxEmergencyCount && now - this.lastEmergencyTowerTime >= policy.defenseTowerCooldownSeconds &&
			this.towerBuildAffordable(gameState);
		state.towerExpected = !!(state.towerExpected || tower || towerPending || state.shouldBuildTower);

		if (state.stage === "assemble")
		{
			if (outmatched && tower)
			{
				this.garrisonEmergencyTower(gameState, tower, defenders, policy.defenseTowerGarrisonSlots);
				towerGarrisoned = new Set([...(tower.garrisoned ? tower.garrisoned() || [] : [])]);
				if (this.HQ.garrisonManager && this.HQ.garrisonManager.holders && this.HQ.garrisonManager.holders.has(tower.id()))
					for (const id of this.HQ.garrisonManager.holders.get(tower.id()).list || [])
						towerGarrisoned.add(id);
			}
			const waited = now - state.startedAt;
			const towerReadyEnough = !outmatched || !state.towerExpected ||
				!!(tower && this.defenseGarrisonCount(gameState, tower) >= Math.min(3, policy.defenseTowerGarrisonSlots));
			if ((state.assemblyFraction >= policy.defenseAssemblyFraction && towerReadyEnough) ||
			    threat.nearest <= policy.defenseImmediateEngageRadius || waited >= policy.defenseAssemblyMaxWaitSeconds)
			{
				state.stage = "engage";
				state.engagedAt = now;
				aiWarn("[EXPERT-DEF] engage assembled=" + assembled + "/" + defenders.length +
					" fraction=" + state.assemblyFraction.toFixed(2) + " foe=" + threat.count + " outmatched=" + outmatched);
			}
		}

		if (state.stage === "engage" && tower && !outmatched)
			this.unloadEmergencyTower(tower);

		for (const ent of defenders)
		{
			if (state.stage === "engage" && tower && outmatched && towerGarrisoned.has(ent.id()))
				continue;
			this.issueExpertDefenseOrder(gameState, ent, state);
		}

		this.expertDefenseState = state;
		return state;
	}

	hasActiveExpertDefense()
	{
		return !!(this.expertDefenseState && this.expertDefenseState.active);
	}

	assignExpertDefenseUnit(gameState, army, ent)
	{
		if (!this.hasActiveExpertDefense() || !ent)
			return false;
		return this.issueExpertDefenseOrder(gameState, ent, this.expertDefenseState, true);
	}

	phaseCostCoverage(resources, cost)
	{
		const ratios = [];
		for (const type of ["food", "wood", "stone", "metal"])
		{
			const need = Math.max(0, Number(cost && cost[type]) || 0);
			if (!need)
				continue;
			ratios.push(Math.min(1, Math.max(0, Number(resources && resources[type]) || 0) / need));
		}
		return ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : 1;
	}

	phase2Readiness(gameState, frame)
	{
		const policy = mergePolicy(this.strategyPolicyOverrides(gameState));
		const info = this.phaseTechInfo(gameState);
		if (!info)
			return { "ready": false, "state": gameState.currentPhase && gameState.currentPhase() > 1 ? "complete" : "unavailable", "reason": "not in Village phase" };
		const now = Number(gameState.ai.elapsedTime) || 0;
		const pop = gameState.getPopulation();
		const fields = this.builtByClass(gameState, "Field").length;
		const fieldPipeline = fields + this.foundationsByClass(gameState, "Field").length +
			(gameState.ai.queues.field ? gameState.ai.queues.field.countQueuedUnits() : 0);
		const barracks = this.builtByClass(gameState, "Barracks").length;
		const resources = gameState.getResources();
		const coverage = this.phaseCostCoverage(resources, info.cost);
		const naturalRemaining = frame && frame.state && frame.state.food ?
			Math.max(0, Number(frame.state.food.totalNaturalRemaining) || 0) : 0;
		const naturalRunway = frame && frame.state && frame.state.food ?
			Math.max(0, Number(frame.state.food.naturalRunwaySeconds) || 0) : 0;
		const naturalInfrastructureHealthy = naturalRemaining >= policy.naturalFoodInfrastructureRemaining &&
			naturalRunway >= policy.naturalFoodInfrastructureRunwaySeconds;
		const foodInfrastructureHealthy = fieldPipeline >= policy.phase2PreferredFields || naturalInfrastructureHealthy;
		const lateFoodFloor = fieldPipeline >= policy.phase2LateMinimumFields || naturalInfrastructureHealthy;
		const absoluteFoodFloor = fieldPipeline >= policy.phase2AbsoluteMinimumFields || naturalInfrastructureHealthy;
		const productionReady = barracks >= 2;

		let ready = false;
		let lane = "waiting";
		if (productionReady && foodInfrastructureHealthy && now >= policy.phase2ExceptionalTime &&
		    pop >= policy.phase2ExceptionalPopulation && coverage >= policy.phase2ExceptionalCostCoverage)
			ready = true, lane = "exceptional";
		else if (productionReady && foodInfrastructureHealthy && now >= policy.phase2NormalTime &&
		         pop >= policy.phase2NormalPopulation && coverage >= policy.phase2NormalCostCoverage)
			ready = true, lane = "normal";
		else if (productionReady && foodInfrastructureHealthy && now >= policy.phase2MatureTime &&
		         pop >= policy.phase2MaturePopulation)
			ready = true, lane = "mature";
		else if (productionReady && absoluteFoodFloor &&
		         now >= policy.phase2AbsoluteTime && pop >= policy.phase2AbsolutePopulation)
			ready = true, lane = "absolute-7m";
		else if (productionReady && lateFoodFloor && now >= policy.phase2LateTime &&
		         pop >= policy.phase2LatePopulation)
			ready = true, lane = "late";
		else if (productionReady && lateFoodFloor && now >= policy.phase2ExceptionalTime &&
		         (now >= policy.phase2OverdueTime || pop >= policy.phase2OverduePopulation))
			ready = true, lane = "overdue";

		const threat = ready ? this.majorPhaseThreat(gameState) : { "major": false, "foes": 0 };
		if (ready && threat.major)
			return {
				ready: false, state: "threat-hold",
				reason: `P2 ready but ${threat.foes} invading units are near the core; fight first`,
				name: info.name, cost: info.cost, coverage, fields, fieldPipeline, barracks, pop, time: now, threat: threat.foes
			};

		return {
			ready: ready && info.canResearch,
			state: ready ? (info.canResearch ? lane : "blocked-no-researcher") : "waiting",
			reason: `t=${Math.round(now)} pop=${pop} fields=${fields}/${fieldPipeline} natural=${Math.round(naturalRemaining)} runway=${Math.round(naturalRunway)}s barracks=${barracks} coverage=${coverage.toFixed(2)} canResearch=${info.canResearch}`,
			name: info.name, cost: info.cost, coverage, fields, fieldPipeline, barracks, pop, time: now
		};
	}

	phase2QueuedPlan(queues)
	{
		if (!queues || !queues.majorTech || !Array.isArray(queues.majorTech.plans))
			return undefined;
		return queues.majorTech.plans.find(plan => plan && plan.metadata && plan.metadata.expertPhase2);
	}

	phase2PlanShortfall(gameState, plan)
	{
		const resources = gameState.getResources();
		let cost = {};
		try { cost = plan && plan.getCost ? plan.getCost() : {}; }
		catch (e) { cost = {}; }
		const out = {};
		for (const generic of ["food", "wood", "stone", "metal"])
			out[generic] = Math.max(0, (Number(cost && cost[generic]) || 0) - (Number(resources && resources[generic]) || 0));
		return out;
	}

	refreshPhase2QueueWatchdog(gameState, queues)
	{
		const now = Number(gameState.ai.elapsedTime) || 0;
		if (!gameState.currentPhase || gameState.currentPhase() !== 1)
		{
			this.phaseWoodCrisis = false;
			this.phase2Shortfall = { food: 0, wood: 0, stone: 0, metal: 0 };
			this.phase2QueuedAt = -99999;
			return;
		}
		const nextPhase = gameState.getPhaseName ? gameState.getPhaseName(2) : undefined;
		if (nextPhase && gameState.isResearching && gameState.isResearching(nextPhase))
		{
			this.phaseWoodCrisis = false;
			this.phase2Shortfall = { food: 0, wood: 0, stone: 0, metal: 0 };
			this.phase2QueuedAt = -99999;
			return;
		}
		const plan = this.phase2QueuedPlan(queues);
		if (!plan)
		{
			this.phaseWoodCrisis = false;
			this.phase2Shortfall = { food: 0, wood: 0, stone: 0, metal: 0 };
			this.phase2QueuedAt = -99999;
			return;
		}
		if (!plan.metadata)
			plan.metadata = {};
		let queuedAt = Number(plan.metadata.expertPhaseQueuedAt);
		if (!Number.isFinite(queuedAt))
		{
			queuedAt = now;
			plan.metadata.expertPhaseQueuedAt = now;
		}
		this.phase2QueuedAt = queuedAt;
		this.phase2Shortfall = this.phase2PlanShortfall(gameState, plan);
		const waited = Math.max(0, now - queuedAt);
		const stall = waited >= (Number(mergePolicy().phase2QueueStallSeconds) || 8);
		this.phaseWoodCrisis = stall && this.phase2Shortfall.wood > 0;
		if (stall && Object.values(this.phase2Shortfall).some(value => value > 0) && now - this.lastPhaseStallDiag >= 8)
		{
			this.lastPhaseStallDiag = now;
			aiWarn("[EXPERT-PHASE] STALLED waited=" + Math.round(waited) + "s shortfall=" +
				["food", "wood", "stone", "metal"].map(g => g + "=" + Math.round(this.phase2Shortfall[g] || 0)).join("/") +
				(this.phaseWoodCrisis ? " recovery=WOOD" : ""));
		}
	}

	updateWoodContinuityWatchdog(gameState, workers, woodsite)
	{
		const policy = mergePolicy();
		const now = Number(gameState.ai.elapsedTime) || 0;
		const delivered = this.measureDeliveredWoodIncome(gameState);
		const actual = this.actualWorkerOrders(gameState);
		const enoughWorkers = (Number(workers && workers.wood) || 0) >= (Number(policy.woodIncomeWatchMinimumWorkers) || 8);
		const lowOrNoActiveWood = (Number(actual.wood) || 0) === 0 ||
			(Number(woodsite && woodsite.localWoodAmount) || 0) <= (Number(policy.woodExpansionAmount) || 1200);
		const sinceDelivery = Number.isFinite(Number(this.woodLastDeliveryAt)) ? now - Number(this.woodLastDeliveryAt) : 0;
		this.woodIncomeStalled = !!(delivered.measured && enoughWorkers && lowOrNoActiveWood &&
			sinceDelivery >= (Number(policy.woodIncomeStallSeconds) || 12));
		if (this.woodIncomeStalled && now - this.lastWoodStallDiag >= 10)
		{
			this.lastWoodStallDiag = now;
			aiWarn("[EXPERT-WOOD] STALLED desired=" + (Number(workers.wood) || 0) + " actual=" + (Number(actual.wood) || 0) +
				" local=" + Math.round(Number(woodsite.localWoodAmount) || 0) + " delivered=" + delivered.rate.toFixed(2) +
				" lastDelivery=" + Math.round(sinceDelivery) + "s");
		}
		return { delivered, actual };
	}

	resetPhaseWoodRecoveryPriority(gameState, queues)
	{
		if (!gameState.ai || !gameState.ai.queueManager)
			return;
		// IT14.54: never broadly demote the phase queue. While the Expert Town plan is
		// actually waiting, keep its established 1100 priority; only the exact cost of one
		// authorized recovery Storehouse may be borrowed from its sticky account. Once the
		// phase plan starts/leaves the queue, return majorTech to Petra's normal priority.
		const phaseWaiting = !!this.phase2QueuedPlan(queues || gameState.ai.queues);
		gameState.ai.queueManager.changePriority("majorTech", phaseWaiting ?
			Math.max(this.HQ.Config.priorities.majorTech || 1, 1100) : (this.HQ.Config.priorities.majorTech || 700));
		// Priorities are sticky too. Reset dropsites before the new frame; current actions
		// (including a recovery Storehouse) will raise it again later in this update.
		gameState.ai.queueManager.changePriority("dropsites", this.HQ.Config.priorities.dropsites || 950);
	}

	fundPhaseWoodRecoveryStorehouse(gameState, queues)
	{
		if (!this.phaseWoodCrisis || !this.phase2QueuedPlan(queues) || !gameState.ai ||
		    !gameState.ai.queueManager || !gameState.ai.queues || !gameState.ai.queues.dropsites)
			return false;
		const queue = gameState.ai.queues.dropsites;
		const plans = queue.plans || [];
		let index = plans.findIndex(candidate => candidate && candidate.metadata &&
			candidate.metadata.expertDecisionLayer && candidate.metadata.expertDecisionKind === "storehouse" &&
			candidate.metadata.expertDecisionRole === "expansion");
		// A pre-existing Expert Storehouse may already be occupying this one-at-a-time lane.
		// Funding it still breaks the queue deadlock; a dedicated forest expansion can follow.
		if (index < 0)
			index = plans.findIndex(candidate => candidate && candidate.metadata &&
				candidate.metadata.expertDecisionLayer && candidate.metadata.expertDecisionKind === "storehouse");
		if (index < 0)
			return false;
		const plan = plans[index];
		if (typeof plan.getCost !== "function")
			return false;
		if (index > 0)
		{
			plans.splice(index, 1);
			plans.unshift(plan);
		}

		const manager = gameState.ai.queueManager;
		if (!manager.accounts || !manager.accounts.majorTech || !manager.accounts.dropsites ||
		    typeof manager.transferAccounts !== "function")
			return false;
		const cost = plan.getCost();
		const phaseWoodShortfall = Math.max(0, Number(this.phase2Shortfall.wood) || 0);
		const bridgeLimit = Math.max(1, Number(mergePolicy().phaseWoodBridgeShortfall) || 25);
		if (phaseWoodShortfall > 0 && phaseWoodShortfall <= bridgeLimit)
		{
			// The IT14.53 failure was literally 298/300 wood. Do not turn a two-wood
			// phase shortfall into a 102-wood shortfall by paying for the new Storehouse first.
			// Keep the recovery plan queued, but let emergency long-haul lumber deliveries
			// finish Town Phase before the dropsite claims fresh wood.
			manager.changePriority("dropsites", this.HQ.Config.priorities.dropsites || 950);
			return false;
		}
		const beforeWood = Number(manager.accounts.dropsites.wood) || 0;
		manager.transferAccounts(cost, "majorTech", "dropsites");
		const afterWood = Number(manager.accounts.dropsites.wood) || 0;
		const movedWood = Math.max(0, afterWood - beforeWood);
		if (movedWood > 0)
			aiWarn("[EXPERT-PHASE] recovery-fund majorTech->dropsites wood=" + Math.round(movedWood) +
				" storehouseCost=" + Math.round(Number(cost.wood) || 0) +
				" phaseShortfall=" + Math.round(Number(this.phase2Shortfall.wood) || 0));
		// The construction was explicitly authorized as the phase-recovery action. Give that
		// one queue enough priority to start promptly, without exposing the rest of the phase
		// reservation to houses, ordinary techs or military spending.
		manager.changePriority("dropsites", Math.max(this.HQ.Config.priorities.dropsites || 1, 1250));
		return movedWood > 0;
	}

	researchExpertPhase2(gameState, queues, frame)
	{
		if (!queues || !queues.majorTech)
			return false;
		if (gameState.currentPhase && gameState.currentPhase() !== 1)
		{
			this.lastPhase2Decision = { "state": "complete", "reason": "Town phase reached" };
			return false;
		}
		const nextPhase = gameState.getPhaseName ? gameState.getPhaseName(2) : undefined;
		if (nextPhase && gameState.isResearching && gameState.isResearching(nextPhase))
		{
			this.lastPhase2Decision = { "state": "researching", "reason": nextPhase + " is in progress" };
			return true;
		}
		if (queues.majorTech.hasQueuedUnits())
		{
			this.lastPhase2Decision = this.phaseWoodCrisis ?
				{ "state": "stalled-wood", "reason": "queued phase is waiting for " + Math.round(this.phase2Shortfall.wood || 0) + " wood" } :
				{ "state": "queued", "reason": "phase research already queued" };
			return true;
		}
		const policy = mergePolicy();
		const now = Number(gameState.ai.elapsedTime) || 0;
		// IT14.38: the economic temple is still built aggressively after Barracks #2,
		// but never hold Town phase hostage for it. IT14.37 spent ~2.5 minutes in
		// temple-hold and the temple still completed only after P2. Phase progression
		// and temple construction are independent lanes.
		const decision = this.phase2Readiness(gameState, frame);
		this.lastPhase2Decision = decision;
		if (!decision.ready)
			return false;
		const plan = new ResearchPlan(gameState, decision.name, true);
		if (!plan)
			return false;
		plan.metadata = { "expertDecisionLayer": true, "expertPhase2": true, "lane": decision.state,
			"expertPhaseQueuedAt": now };
		this.phase2QueuedAt = now;
		plan.queueToReset = "majorTech";
		queues.majorTech.addPlan(plan);
		this.HQ.phasing = 2;
		// Phase reservation beats normal population/military spending once the economy has
		// proven it is mature enough. This converts P1 surplus into new spending options.
		gameState.ai.queueManager.changePriority("majorTech", Math.max(this.HQ.Config.priorities.majorTech || 1, 1100));
		aiWarn("[EXPERT-PHASE] queued " + decision.name + " lane=" + decision.state + " " + decision.reason);
		return true;
	}

	lineObstructionPenalty(obstructionMap, from, to)
	{
		if (!obstructionMap || !Array.isArray(from) || !Array.isArray(to))
			return 0;
		const data = obstructionMap.map || obstructionMap.data;
		const width = Number(obstructionMap.width);
		const cellSize = Number(obstructionMap.cellSize);
		if (!data || !Number.isFinite(width) || !Number.isFinite(cellSize) || cellSize <= 0)
			return 0;
		const dist = Math.sqrt(SquareVectorDistance(from, to));
		const steps = Math.max(2, Math.ceil(dist / cellSize));
		let blocked = 0;
		for (let i = 2; i <= steps - 2; ++i)
		{
			const t = i / steps;
			const x = from[0] + (to[0] - from[0]) * t;
			const z = from[1] + (to[1] - from[1]) * t;
			const mx = Math.floor(x / cellSize);
			const mz = Math.floor(z / cellSize);
			if (mx < 0 || mz < 0 || mx >= width || mz >= width)
				continue;
			const value = data[mx + mz * width];
			if (Number(value) < 255)
				++blocked;
		}
		return blocked;
	}

	ensureInitialWoodSelection(gameState, cc, accessIndex)
	{
		if (this.initialWoodSelection && this.initialWoodSelection.position)
			return;
		const trees = collectInitialWoodCandidates(gameState, {
			"getLandAccess": getLandAccess,
			"isSupplyFull": isSupplyFull,
			"territoryMap": this.HQ.territoryMap,
			"anchorPosition": cc.position(),
			"accessIndex": accessIndex,
			"playerId": PlayerID,
			"searchRadius": 90
		});
		this.initialWoodSelection = selectInitialWoodWorksite(trees, cc.position());
	}

	builtByClass(gameState, className)
	{
		const out = [];
		for (const ent of gameState.getOwnStructures().values())
			if (entityPosition(ent) && hasClass(ent, className) &&
			    (!ent.foundationProgress || ent.foundationProgress() === undefined))
				out.push(ent);
		return out;
	}

	foundationsByClass(gameState, className)
	{
		const out = [];
		for (const ent of gameState.getOwnFoundations().values())
			if (entityPosition(ent) && hasClass(ent, className))
				out.push(ent);
		return out;
	}

	structuresByTemplate(gameState, type, foundations = false)
	{
		const out = [];
		const collection = foundations ? gameState.getOwnFoundations() : gameState.getOwnStructures();
		for (const ent of collection.values())
		{
			if (!ent || !entityPosition(ent) || !ent.templateName)
				continue;
			const name = String(ent.templateName() || "");
			// Foundations may expose either the built template name or foundation|<type>.
			if (name === type || name.endsWith("|" + type) || name.includes(type))
			{
				if (!foundations && ent.foundationProgress && ent.foundationProgress() !== undefined)
					continue;
				out.push(ent);
			}
		}
		return out;
	}

	specialStructurePipeline(gameState, kind)
	{
		const spec = BUILDING_SPECS[kind];
		if (!spec)
			return 0;
		const type = gameState.applyCiv(spec.template);
		let queued = 0;
		const queue = gameState.ai.queues && gameState.ai.queues[spec.queue];
		if (queue && Array.isArray(queue.plans))
			for (const plan of queue.plans)
				if (plan && (plan.type === type || plan.metadata && plan.metadata.expertDecisionKind === kind))
					++queued;
		return this.structuresByTemplate(gameState, type).length +
			this.structuresByTemplate(gameState, type, true).length +
			(this.activeTaskByKind[kind] ? 1 : 0) + queued;
	}

	specialBuildingAffordable(gameState, type, reserve = {})
	{
		const template = gameState.getTemplate(type);
		if (!template || typeof template.cost !== "function")
			return false;
		const cost = template.cost();
		const bank = gameState.getResources();
		for (const resource of ["food", "wood", "stone", "metal"])
			if ((Number(bank[resource]) || 0) < (Number(cost && cost[resource]) || 0) + (Number(reserve[resource]) || 0))
				return false;
		return true;
	}

	getPrimaryWoodPosition(gameState)
	{
		if (this.primaryWoodWorksite && Array.isArray(this.primaryWoodWorksite.position))
			return this.primaryWoodWorksite.position;
		const stores = this.builtByClass(gameState, "Storehouse");
		if (stores.length)
		{
			const wanted = this.primaryWoodWorksite && this.primaryWoodWorksite.taskId;
			const exact = wanted && stores.find(ent => ent.getMetadata && ent.getMetadata(PlayerID, "expertTaskId") === wanted);
			const selected = exact || stores[0];
			this.primaryWoodWorksite = {
				"entityId": selected.id(),
				"position": selected.position(),
				"taskId": selected.getMetadata ? selected.getMetadata(PlayerID, "expertTaskId") : undefined
			};
			return selected.position();
		}
		return this.initialWoodSelection && this.initialWoodSelection.position;
	}

	countLiveCivilianTraining(gameState)
	{
		let pendingCivilians = 0, pendingBatches = 0;
		for (const ent of gameState.getOwnTrainingFacilities().values())
		{
			if (!ent.trainingQueue)
				continue;
			for (const item of ent.trainingQueue() || [])
			{
				const metadata = item.metadata || {};
				if (metadata.expertDecisionTraining !== "civilian" && metadata.expertDecisionCivilian !== true)
					continue;
				const count = Number(item.count ?? item.number ?? 1);
				pendingCivilians += Number.isFinite(count) && count > 0 ? count : 1;
				++pendingBatches;
			}
		}
		return { pendingCivilians, pendingBatches };
	}

	syncJobs(gameState, foodNetwork, foodThroughput)
	{
		const policy = mergePolicy();
		const resources = gameState.getResources();
		const fields = this.builtByClass(gameState, "Field").length;
		let metrics = this.economyWorkerMetrics(gameState);
		let farmWorkers = metrics.farm;
		let woodCivilians = metrics.woodCivilians;
		let foodWorkers = metrics.food + metrics.farm;
		let stoneWorkers = metrics.stone;
		let metalWorkers = metrics.metal;
		let foodSlots = this.immediateFoodCapacitySlots(gameState, foodNetwork);

		const throughput = foodThroughput || {};
		const activeBurn = this.builtByClass(gameState, "Barracks").length > 0 ?
			(Number(throughput.oneBarracksFoodBurnRate) || 0) : (Number(throughput.ccFoodBurnRate) || 0);
		const steadyFarmerRate = Math.max(0.5, Number(throughput.averageFarmerRate) || 0.7);
		const requiredFoodWorkers = Math.max(
			policy.openingNaturalFoodCivilians,
			Math.ceil(activeBurn * Math.max(1, policy.foodRateSafetyMargin) / steadyFarmerRate)
		);
		const foodWoodFeedback = foodWoodFeedbackDirective({
			"time": gameState.ai.elapsedTime,
			"food": resources.food, "wood": resources.wood,
			"foodIncomeRate": Number(throughput.measuredFoodIncomeRate) || 0,
			"foodBurnRate": activeBurn,
			"foodSlots": foodSlots,
			"fieldFoundations": this.foundationsByClass(gameState, "Field").length,
			"fields": fields,
			"overflowWood": metrics.overflowWood,
			"woodCivilians": woodCivilians,
			"startTime": policy.foodWoodFeedbackStartTime,
			"recoveryFoodBank": policy.foodRecoveryFoodBank,
			"recoveryWoodBank": policy.foodRecoveryWoodBank,
			"recoveryWoodFoodRatio": policy.foodRecoveryWoodFoodRatio,
			"strongWoodFoodRatio": policy.foodRecoveryStrongWoodFoodRatio,
			"recoveryRateRatio": policy.foodRecoveryRateRatio,
			"minimumCivilianWood": policy.foodRecoveryMinimumCivilianWood,
			"maxReassign": policy.foodRecoveryReassignBatch,
			"releaseFields": policy.matureFoodWoodReleaseFields,
			"releaseFoodBank": policy.matureFoodWoodReleaseBank,
			"releaseRateRatio": policy.matureFoodWoodReleaseRateRatio,
			"releaseFoodWoodRatio": policy.matureFoodWoodReleaseRatio,
			"releaseWoodBankCeiling": policy.matureFoodWoodReleaseWoodBankCeiling
		});
		this.lastFoodWoodFeedback = foodWoodFeedback;

		const reserveWeights = {
			"food": policy.resourceReserveWeightFood, "wood": policy.resourceReserveWeightWood,
			"metal": policy.resourceReserveWeightMetal, "stone": policy.resourceReserveWeightStone
		};
		const balanceInput = {
			"food": resources.food, "wood": resources.wood, "stone": resources.stone, "metal": resources.metal,
			"activationBank": policy.resourceBalanceActivationBank,
			"ratioFloor": policy.resourceBalanceRatioFloor,
			"newWorkerRatio": policy.resourceBalanceNewWorkerRatio,
			"strongRatio": policy.resourceBalanceStrongRatio,
			"foodPriorityBank": policy.resourceBalanceFoodPriorityBank,
			"weights": reserveWeights
		};
		const balancingActive = gameState.ai.elapsedTime >= policy.resourceBalanceStartTime;
		const foodAllowed = foodSlots > 0;
		const miningUnlocked = fields >= policy.miningMinimumCompletedFields;
		const genericTargets = miningUnlocked ? (foodAllowed ? ["food", "wood", "metal", "stone"] : ["wood", "metal", "stone"]) :
			(foodAllowed ? ["food", "wood"] : ["wood"]);
		const soldierTargets = miningUnlocked ? ["wood", "metal", "stone"] : ["wood"];
		const genericBalance = balancingActive ? resourceBalanceDirective({ ...balanceInput, "allowedTargets": genericTargets }) : { "active": false };
		const soldierBalance = balancingActive ? resourceBalanceDirective({ ...balanceInput, "allowedTargets": soldierTargets }) : { "active": false };
		// IT14.24: 20 civilians is the opening target, not a permanent ceiling/floor.
		// A live feedback signal decides whether NEW civilians may reinforce wood.
		// Existing farmers are still never stripped off food merely to chase wood.
		const matureFoodWoodRelease = foodWoodFeedback.allowNewCivilianWood;
		const civilianTargets = miningUnlocked ?
			(foodAllowed ? (matureFoodWoodRelease ? ["food", "wood", "metal", "stone"] : ["food", "metal", "stone"]) :
				(matureFoodWoodRelease ? ["wood", "metal", "stone"] : ["metal", "stone"])) :
			(matureFoodWoodRelease ? ["food", "wood"] : ["food"]);
		const civilianBalance = balancingActive ?
			resourceBalanceDirective({ ...balanceInput, "allowedTargets": civilianTargets }) : { "active": false };
		this.lastImmediateFoodSlots = foodSlots;
		this.lastResourceBalance = genericBalance;

		const civilians = [];
		const explicit = {};
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!entityPosition(ent) || !this.isExpertEconomyEntity(ent))
				continue;
			this.claimWorker(gameState, ent);
			if (ent.getMetadata(PlayerID, EXPERT_DEFENSE) !== undefined || ent.getMetadata(PlayerID, EXPERT_CIVILIAN_EVAC) !== undefined)
				continue;
			if (!this.attackPlanAllowsEconomicWork(gameState, ent))
				continue;
			if (hasClass(ent, "Civilian") && !hasClass(ent, "CitizenSoldier") && !hasClass(ent, "Cavalry"))
			{
				civilians.push(ent);
				const ord = ent.getMetadata(PlayerID, CIVILIAN_ORDINAL);
				if (Number.isFinite(ord) && ord > 0)
					explicit[String(ent.id())] = ord;
			}
			else if (hasClass(ent, "CitizenSoldier") && !hasClass(ent, "Cavalry"))
			{
				// Citizen-soldiers are the flexible non-food workforce. Civilians are better
				// gatherers, so soldiers never get sent to food by the bank governor. Once a
				// 1k+ imbalance exists, NEW soldiers repair wood/stone/metal first.
				const current = ent.getMetadata(PlayerID, JOB_METADATA);
				const pending = ent.getMetadata(PlayerID, PENDING_JOB_METADATA);
				if (!["citizenSoldierWood", "wood", "food", "food_owned", "farm", "stone", "metal"].includes(current) && !pending)
				{
					const target = soldierBalance.active ? soldierBalance.target : "wood";
					const desired = this.resourceJobForEntity(ent, target);
					this.setDesiredJob(gameState, ent, desired);
					if (soldierBalance.active)
						aiWarn("[EXPERT-BALANCE] new citizen-soldier=" + ent.id() + " -> " + target + " bank=" +
							Math.round(resources.food) + "/" + Math.round(resources.wood) + "/" + Math.round(resources.stone) + "/" + Math.round(resources.metal));
				}
			}
			else if (hasClass(ent, "Cavalry") && ent.canGather && ent.canGather("food"))
				this.setDesiredJob(gameState, ent, "chicken");
		}

		const reconciled = reconcileCivilianRoster(this.civilianRoster, civilians.map(ent => ent.id()), explicit);
		this.civilianRoster = reconciled.roster;
		const byId = new Map(civilians.map(ent => [String(ent.id()), ent]));
		const openingEnd = policy.startingNaturalFoodCivilians + policy.secondTrainedFoodCivilians + policy.targetWoodCivilians;
		// If Wicker peeled one/two opening berry civilians to wood because no secondary
		// natural branch existed, count those workers INSIDE the 20-civilian wood tranche.
		// Otherwise the ordinal script would quietly create 21-22 permanent wood civilians.
		const wickerWoodPeelCount = civilians.filter(ent => ent.getMetadata(PlayerID, EXPERT_WICKER_PEELED) === true).length;
		const scriptedWoodTarget = Math.max(policy.firstTrainedWoodCivilians, policy.targetWoodCivilians - wickerWoodPeelCount);

		for (const entry of reconciled.civilians)
		{
			const ent = byId.get(entry.id);
			if (!ent)
				continue;
			ent.setMetadata(PlayerID, CIVILIAN_ORDINAL, entry.ordinal);

			const lockedFieldId = Number(ent.getMetadata(PlayerID, FARM_LOCK));
			const lockedField = Number.isFinite(lockedFieldId) ? gameState.getEntityById(lockedFieldId) : undefined;
			if (lockedField && hasClass(lockedField, "Field") && lockedField.resourceSupplyAmount && lockedField.resourceSupplyAmount() > 0)
			{
				if (ent.getMetadata(PlayerID, JOB_METADATA) !== "farm")
					ent.setMetadata(PlayerID, JOB_METADATA, "farm");
				continue;
			}
			if (Number.isFinite(lockedFieldId))
				ent.setMetadata(PlayerID, FARM_LOCK, undefined);

			const current = ent.getMetadata(PlayerID, JOB_METADATA);
			const hadPermanentJob = ["wood", "food", "food_owned", "farm", "stone", "metal"].includes(current);
			let desired;

			if (entry.ordinal <= openingEnd)
			{
				// IT14.24 feedback may deliberately peel one/two opening wood civilians back
				// to food under a real food deficit. The ordinal script must not undo that
				// correction on the next decision tick.
				if (ent.getMetadata(PlayerID, EXPERT_ADAPTIVE_FOOD) === true)
					desired = "food_owned";
				else if (ent.getMetadata(PlayerID, EXPERT_WICKER_BRANCH) === true && ent.getMetadata(PlayerID, NATURAL_FOOD_LOCK))
					desired = "food_owned";
				else if (ent.getMetadata(PlayerID, EXPERT_WICKER_BRANCH) === true && this.postWickerBranchFarmsteadPending)
					desired = "food";
				else if (ent.getMetadata(PlayerID, EXPERT_WICKER_PEELED) === true)
					desired = "wood";
				const d = desired ? undefined : decideCivilianJob({
					"ordinal": entry.ordinal,
					"fields": fields,
					"farmWorkers": farmWorkers,
					"farmersPerField": policy.farmersPerField,
					"startingNaturalFoodCivilians": policy.startingNaturalFoodCivilians,
					"firstTrainedWoodCivilians": policy.firstTrainedWoodCivilians,
					"secondTrainedFoodCivilians": policy.secondTrainedFoodCivilians,
					"targetWoodCivilians": scriptedWoodTarget
				});
				if (d) desired = d.job;
				if (desired === "food" && (!foodNetwork || foodNetwork.totalRemaining <= 0))
					desired = farmWorkers < fields * policy.farmersPerField ? "farm" : "food_owned";
			}
			else
			{
				const idleWithFoodCapacity = ent.isIdle && ent.isIdle() && foodSlots > 0 &&
					!["food", "food_owned", "farm"].includes(current);
				if (["wood", "food", "food_owned", "farm", "stone", "metal"].includes(current) && !idleWithFoodCapacity)
					continue;
				if (idleWithFoodCapacity)
				{
					desired = "farm";
					aiWarn("[EXPERT-CAPACITY] idle civilian=" + ent.id() + " takes newly-opened farm slot");
				}

				// Civilians remain the preferred food workforce when food production actually
				// needs workers AND a completed source has an open engine slot. The IT14.4
				// mistake was assigning dozens of civilians to food with zero capacity.
				const mustFeed = !desired && foodWorkers < requiredFoodWorkers && foodSlots > 0;
				if (mustFeed)
				{
					const d = decidePostOpeningCivilianJob({
						"food": resources.food, "wood": resources.wood, "stone": resources.stone, "metal": resources.metal,
						"civilians": civilians.length, "woodCivilians": woodCivilians, "foodWorkers": foodWorkers,
						"requiredFoodWorkers": requiredFoodWorkers, "naturalFoodAvailable": !!(foodNetwork && foodNetwork.totalRemaining > 0),
						"stoneWorkers": stoneWorkers, "metalWorkers": metalWorkers, "fields": fields, "farmWorkers": farmWorkers,
						"farmersPerField": policy.farmersPerField, "postOpeningFoodFloor": policy.postOpeningFoodFloor,
						"postOpeningWoodFloor": policy.postOpeningWoodFloor, "postOpeningFoodWoodRatioForWood": policy.postOpeningFoodWoodRatioForWood,
						"maxDynamicWoodCivilians": policy.maxDynamicWoodCivilians, "dynamicWoodShortageBank": policy.dynamicWoodShortageBank,
						"foodSurplusRedirectThreshold": policy.foodSurplusRedirectThreshold,
						"foodSurplusNewCivilianWoodBank": policy.foodSurplusNewCivilianWoodBank, "foodSurplusNewCivilianWoodRatio": policy.foodSurplusNewCivilianWoodRatio,
						"miningStartCivilians": policy.miningStartCivilians,
						"miningMinimumCompletedFields": policy.miningMinimumCompletedFields,
						"miningFoodFloor": policy.miningFoodFloor, "miningWoodFloor": policy.miningWoodFloor,
						"miningTargetStoneWorkers": policy.miningTargetStoneWorkers, "miningTargetMetalWorkers": policy.miningTargetMetalWorkers
					});
					desired = d.job;
				}
				else if (!desired && matureFoodWoodRelease && woodCivilians < policy.maxDynamicWoodCivilians)
				{
					// Food is mature, the bank is healthy, and delivered food comfortably
					// covers current burn. Grow wood with NEW civilians only; established
					// farmers stay on food. The feedback signal turns this back off as soon
					// as food stops being genuinely surplus.
					desired = "wood";
					aiWarn("[EXPERT-FEEDBACK] new civilian=" + ent.id() + " -> wood mode=wood_release food=" +
						Math.round(resources.food) + " wood=" + Math.round(resources.wood) + " rate=" + foodWoodFeedback.rateRatio.toFixed(2));
				}
				else if (!desired && civilianBalance.active)
				{
					desired = this.resourceJobForEntity(ent, civilianBalance.target);
					aiWarn("[EXPERT-BALANCE] new civilian=" + ent.id() + " -> " + civilianBalance.target + " ratio=" + civilianBalance.ratio.toFixed(2));
				}
				else if (!desired)
				{
					const d = decidePostOpeningCivilianJob({
						"food": resources.food, "wood": resources.wood, "stone": resources.stone, "metal": resources.metal,
						"civilians": civilians.length, "woodCivilians": woodCivilians, "foodWorkers": foodWorkers,
						"requiredFoodWorkers": requiredFoodWorkers, "naturalFoodAvailable": !!(foodNetwork && foodNetwork.totalRemaining > 0),
						"stoneWorkers": stoneWorkers, "metalWorkers": metalWorkers, "fields": fields, "farmWorkers": farmWorkers,
						"farmersPerField": policy.farmersPerField, "postOpeningFoodFloor": policy.postOpeningFoodFloor,
						"postOpeningWoodFloor": policy.postOpeningWoodFloor, "postOpeningFoodWoodRatioForWood": policy.postOpeningFoodWoodRatioForWood,
						"maxDynamicWoodCivilians": policy.maxDynamicWoodCivilians, "dynamicWoodShortageBank": policy.dynamicWoodShortageBank,
						"foodSurplusRedirectThreshold": policy.foodSurplusRedirectThreshold,
						"foodSurplusNewCivilianWoodBank": policy.foodSurplusNewCivilianWoodBank, "foodSurplusNewCivilianWoodRatio": policy.foodSurplusNewCivilianWoodRatio,
						"miningStartCivilians": policy.miningStartCivilians,
						"miningMinimumCompletedFields": policy.miningMinimumCompletedFields,
						"miningFoodFloor": policy.miningFoodFloor, "miningWoodFloor": policy.miningWoodFloor,
						"miningTargetStoneWorkers": policy.miningTargetStoneWorkers, "miningTargetMetalWorkers": policy.miningTargetMetalWorkers
					});
					desired = d.job;
				}

				if (["food", "food_owned", "farm"].includes(desired) && foodSlots <= 0)
				{
					// Keep permanent ownership on food. updateWorkers/assignFoodWorker will use
					// wood only as a temporary productive overflow and will pull this civilian
					// straight onto the next natural/field slot that opens.
					desired = "food_owned";
					aiWarn("[EXPERT-CAPACITY] civilian=" + ent.id() + " food-full -> temporary-wood (food-owned)");
				}
			}

			if (!desired)
				continue;
			this.setDesiredJob(gameState, ent, desired);
			if (desired === "wood")
			{
				++woodCivilians;
				// During the opening wood tranche, every newly-created civilian that is
				// assigned to wood after storehouse #2 appears helps finish that foundation.
				// Completion then commits the whole crew to the new woodsite. If the
				// foundation finished earlier this tick, primaryWoodWorksite already points
				// at the completed expansion and normal wood assignment takes over.
				if (!hadPermanentJob && entry.ordinal <= openingEnd)
					this.commitNewWoodCivilianToSecondStorehouse(gameState, ent);
			}
			else if (desired === "farm")
			{
				++farmWorkers; ++foodWorkers; foodSlots = Math.max(0, foodSlots - 1);
			}
			else if (desired === "food" || desired === "food_owned")
			{
				++foodWorkers; foodSlots = Math.max(0, foodSlots - 1);
			}
			else if (desired === "stone")
				++stoneWorkers;
			else if (desired === "metal")
				++metalWorkers;
		}

		this.applyFoodRecoveryRebalance(gameState, foodWoodFeedback);
		this.applyFoodSurplusWoodRebalance(gameState, foodWoodFeedback, openingEnd);
		// The dedicated feedback path deliberately limits food recovery to a small,
		// cooldown-controlled batch. Do not let the older generic bank balancer stack
		// another civilian peel on the same tick.
		if (foodWoodFeedback.mode !== "food_recovery")
			this.rebalanceExistingWorkers(gameState, openingEnd, genericBalance);
		this.applyMiningTechBootstrap(gameState);
		this.applyStrategicMetalRebalance(gameState, openingEnd);
	}

	applyFoodRecoveryRebalance(gameState, feedback)
	{
		const policy = mergePolicy();
		const now = Number(gameState.ai.elapsedTime) || 0;
		if (!feedback || feedback.mode !== "food_recovery" || !(feedback.reassignCount > 0))
			return;
		if (now - this.lastFoodPressureRebalanceTime < policy.foodRecoveryReassignCooldownSeconds)
			return;

		const candidates = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !entityPosition(ent) || !this.isExpertEconomyEntity(ent) ||
			    !hasClass(ent, "Civilian") || hasClass(ent, "CitizenSoldier") || hasClass(ent, "Cavalry"))
				continue;
			if (ent.getMetadata(PlayerID, JOB_METADATA) !== "wood")
				continue;
			if (ent.getMetadata(PlayerID, TASK_KEY) !== undefined || ent.getMetadata(PlayerID, PENDING_JOB_METADATA) ||
			    ent.getMetadata(PlayerID, "transport") !== undefined || ent.getMetadata(PlayerID, "PartOfArmy") ||
			    ent.getMetadata(PlayerID, EXPERT_DEFENSE) !== undefined || ent.getMetadata(PlayerID, EXPERT_CIVILIAN_EVAC) !== undefined ||
			    ent.getMetadata(PlayerID, NATURAL_FOOD_LOCK) || Number.isFinite(Number(ent.getMetadata(PlayerID, FARM_LOCK))))
				continue;
			const state = ent.unitAIState ? ent.unitAIState() : "";
			if (state && state.includes(".COMBAT."))
				continue;
			const ordinal = Number(ent.getMetadata(PlayerID, CIVILIAN_ORDINAL));
			candidates.push({ ent, ordinal: Number.isFinite(ordinal) ? ordinal : 0 });
		}

		// Prefer the newest permanent civilian lumberjacks. This preserves the oldest
		// opening workers when possible while still allowing the nominal 20-worker
		// tranche to shrink when the live economy proves that 20 is temporarily too many.
		candidates.sort((a, b) => b.ordinal - a.ordinal || b.ent.id() - a.ent.id());
		const count = Math.min(Number(feedback.reassignCount) || 0, candidates.length);
		if (!count)
			return;
		for (let i = 0; i < count; ++i)
		{
			const ent = candidates[i].ent;
			ent.setMetadata(PlayerID, EXPERT_ADAPTIVE_FOOD, true);
			const carrying = ent.resourceCarrying ? (ent.resourceCarrying() || []) : [];
			const carried = carrying.reduce((sum, item) => sum + Math.max(0, Number(item && item.amount) || 0), 0);
			this.setDesiredJob(gameState, ent, "food_owned");
			aiWarn("[EXPERT-FEEDBACK] peel civilian=" + ent.id() + " wood->food mode=food_recovery bank=" +
				Math.round(feedback.food) + "/" + Math.round(feedback.wood) + " ratio=" + feedback.bankRatio.toFixed(2) +
				" rate=" + feedback.rateRatio.toFixed(2) + (carried > 0 ? " deposit-first=" + Math.round(carried) : ""));
		}
		this.lastFoodPressureRebalanceTime = now;
	}

	applyFoodSurplusWoodRebalance(gameState, feedback, openingEnd)
	{
		const policy = mergePolicy();
		const now = Number(gameState.ai.elapsedTime) || 0;
		if (!feedback || feedback.mode !== "wood_release" ||
		    now < policy.foodSurplusFarmerReleaseStartTime ||
		    feedback.food < policy.foodSurplusFarmerReleaseFoodBank ||
		    feedback.wood > policy.foodSurplusFarmerReleaseWoodBankCeiling)
			return;
		if (now - (Number(this.lastFoodSurplusWoodReleaseTime) || 0) < policy.foodSurplusFarmerReleaseCooldownSeconds)
			return;

		const fields = this.builtByClass(gameState, "Field");
		if (!fields.length)
			return;
		const extremeWoodStarvation =
			fields.length >= policy.extremeFoodWoodReleaseMinimumFields &&
			feedback.food >= policy.extremeFoodWoodReleaseFoodBank &&
			feedback.wood <= policy.extremeFoodWoodReleaseWoodBankCeiling;
		const fieldIds = new Set(fields.map(field => field.id()));
		const loads = new Map(fields.map(field => [field.id(), 0]));
		// Count EVERY permanent lock first, including the protected opening civilians.
		// Candidate eligibility is evaluated separately so the overload test sees the
		// real field population rather than only the releasable subset.
		for (const worker of gameState.getOwnUnits().values())
		{
			if (!worker || !worker.getMetadata)
				continue;
			const lockedId = Number(worker.getMetadata(PlayerID, FARM_LOCK));
			if (Number.isFinite(lockedId) && fieldIds.has(lockedId))
				loads.set(lockedId, (loads.get(lockedId) || 0) + 1);
		}

		const workers = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !entityPosition(ent) || !this.isExpertEconomyEntity(ent) ||
			    !hasClass(ent, "Civilian") || hasClass(ent, "CitizenSoldier") || hasClass(ent, "Cavalry"))
				continue;
			if (ent.getMetadata(PlayerID, TASK_KEY) !== undefined || ent.getMetadata(PlayerID, PENDING_JOB_METADATA) ||
			    ent.getMetadata(PlayerID, "transport") !== undefined || ent.getMetadata(PlayerID, "PartOfArmy") ||
			    ent.getMetadata(PlayerID, EXPERT_DEFENSE) !== undefined || ent.getMetadata(PlayerID, EXPERT_CIVILIAN_EVAC) !== undefined)
				continue;
			const ordinal = Number(ent.getMetadata(PlayerID, CIVILIAN_ORDINAL));
			if (!Number.isFinite(ordinal) || ordinal <= openingEnd)
				continue;
			const lockedId = Number(ent.getMetadata(PlayerID, FARM_LOCK));
			workers.push({ ent, ordinal, lockedId });
		}

		// Release temporary overflow farmers first. Under ordinary surplus only the
		// 4th/5th gatherer is eligible. Under an extreme 10-field food/wood imbalance,
		// IT14.35 may also release the third farmer, but never below two per field.
		const candidates = [];
		for (const item of workers)
		{
			const current = item.ent.getMetadata(PlayerID, JOB_METADATA);
			if (current !== "farm")
				continue;
			if (!Number.isFinite(item.lockedId))
			{
				candidates.push({ ...item, overflow: 999, emergency: false });
				continue;
			}
			const load = loads.get(item.lockedId) || 0;
			if (load > policy.farmersPerField)
				candidates.push({ ...item, overflow: load - policy.farmersPerField, emergency: false });
			else if (extremeWoodStarvation && load > policy.extremeFoodWoodReleaseMinimumFarmersPerField)
				candidates.push({ ...item, overflow: load - policy.extremeFoodWoodReleaseMinimumFarmersPerField, emergency: true });
		}
		candidates.sort((a, b) => Number(a.emergency) - Number(b.emergency) ||
			b.overflow - a.overflow || b.ordinal - a.ordinal || b.ent.id() - a.ent.id());
		const releaseBatch = extremeWoodStarvation ?
			Math.max(policy.foodSurplusFarmerReleaseBatch, policy.extremeFoodWoodReleaseBatch) :
			policy.foodSurplusFarmerReleaseBatch;
		const count = Math.min(releaseBatch, candidates.length);
		if (!count)
			return;

		for (let i = 0; i < count; ++i)
		{
			const item = candidates[i];
			const ent = item.ent;
			if (Number.isFinite(item.lockedId))
			{
				ent.setMetadata(PlayerID, FARM_LOCK, undefined);
				loads.set(item.lockedId, Math.max(0, (loads.get(item.lockedId) || 1) - 1));
			}
			ent.setMetadata(PlayerID, FOOD_HOME_FARMSTEAD, undefined);
			ent.setMetadata(PlayerID, FOOD_HOME_PERMANENT, undefined);
			ent.setMetadata(PlayerID, EXPERT_ADAPTIVE_FOOD, undefined);
			this.setDesiredJob(gameState, ent, "wood");
			aiWarn("[EXPERT-FEEDBACK] release farmer=" + ent.id() + " farm->wood mode=wood_release bank=" +
				Math.round(feedback.food) + "/" + Math.round(feedback.wood) +
				" rate=" + feedback.rateRatio.toFixed(2) +
				(Number.isFinite(item.lockedId) ? " field=" + item.lockedId : " temporary-overflow") +
				(item.emergency ? " emergency-two-per-field" : ""));
		}
		this.lastFoodSurplusWoodReleaseTime = now;
	}


	applyMiningTechBootstrap(gameState)
	{
		const policy = mergePolicy();
		if (!gameState.currentPhase || gameState.currentPhase() !== 1 ||
		    gameState.ai.elapsedTime < policy.miningTechBootstrapStartTime ||
		    gameState.getPopulation() < policy.miningTechBootstrapMinimumPopulation ||
		    this.builtByClass(gameState, "Field").length < policy.miningTechBootstrapMinimumFields)
			return;
		const bank = gameState.getResources();
		if ((Number(bank.stone) || 0) >= policy.miningTechBootstrapStoneBankTarget)
			return;
		let stoneWorkers = 0;
		const donors = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !entityPosition(ent) || !this.isExpertEconomyEntity(ent) ||
			    ent.getMetadata(PlayerID, TASK_KEY) !== undefined || ent.getMetadata(PlayerID, PENDING_JOB_METADATA) ||
			    ent.getMetadata(PlayerID, EXPERT_DEFENSE) !== undefined || !this.attackPlanAllowsEconomicWork(gameState, ent))
				continue;
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			if (job === "stone")
				++stoneWorkers;
			else if (hasClass(ent, "CitizenSoldier") && !hasClass(ent, "Cavalry") &&
			         (job === "wood" || job === "citizenSoldierWood" || job === "food_overflow_wood"))
				donors.push(ent);
		}
		let need = Math.max(0, Math.min(policy.miningTechBootstrapStoneWorkers - stoneWorkers, donors.length));
		if (!need)
			return;
		// Food/wood stay primary: bootstrap stone with only two flexible soldiers and do
		// not peel the wood line when the wood bank itself is under pressure.
		if ((Number(bank.wood) || 0) < 300)
			return;
		donors.sort((a,b) => b.id() - a.id());
		for (let i = 0; i < need; ++i)
		{
			this.setDesiredJob(gameState, donors[i], "stone");
			aiWarn("[EXPERT-MINING] bootstrap wood-soldier->stone worker=" + donors[i].id() +
				" bank=" + Math.round(bank.food) + "/" + Math.round(bank.wood) + "/" + Math.round(bank.stone) + "/" + Math.round(bank.metal));
		}
	}

	applyStrategicMetalRebalance(gameState, openingEnd)
	{
		const policy = mergePolicy();
		const now = Number(gameState.ai.elapsedTime) || 0;
		if (now < policy.strategicMetalRebalanceStartTime ||
		    now - (Number(this.lastStrategicMetalRebalanceTime) || 0) < policy.strategicMetalReassignCooldownSeconds)
			return;

		const phase = gameState.currentPhase ? Number(gameState.currentPhase()) || 1 : 1;
		const pop = Number(gameState.getPopulation()) || 0;
		const barracks = this.builtByClass(gameState, "Barracks").length;
		// IT14.38 metal floor: three miners once the two-barracks P1 economy exists,
		// six immediately in Town, and eight in a mature two-forge Town economy.
		// Forge research should not wait for a giant food bank before metal exists.
		let target = 0;
		if (phase >= 2)
			target = pop >= 120 && this.builtByClass(gameState, "Forge").length >= 2 ? 8 : 6;
		else if (barracks >= 2 && pop >= 65)
			target = 3;
		if (!target)
			return;

		const bank = gameState.getResources();
		let metalWorkers = 0;
		const stoneCandidates = [];
		const woodSoldiers = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !entityPosition(ent) || !this.isExpertEconomyEntity(ent) ||
			    ent.getMetadata(PlayerID, TASK_KEY) !== undefined || ent.getMetadata(PlayerID, PENDING_JOB_METADATA) ||
			    ent.getMetadata(PlayerID, EXPERT_DEFENSE) !== undefined || ent.getMetadata(PlayerID, EXPERT_CIVILIAN_EVAC) !== undefined ||
			    !this.attackPlanAllowsEconomicWork(gameState, ent))
				continue;
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			if (job === "metal")
				++metalWorkers;
			else if (job === "stone")
				stoneCandidates.push(ent);
			else if (hasClass(ent, "CitizenSoldier") && !hasClass(ent, "Cavalry") &&
			         (job === "wood" || job === "citizenSoldierWood" || job === "food_overflow_wood"))
				woodSoldiers.push(ent);
		}
		if (metalWorkers >= target && bank.metal >= policy.strategicMetalBankFloor * 0.75)
			return;

		let needed = Math.max(0, Math.min(policy.strategicMetalReassignBatch, target - metalWorkers));
		if (!needed)
			return;
		let moved = 0;

		// Stone is the first donor whenever it is ahead of metal.
		const stoneDonorFloor = phase === 1 ? Math.max(200, Number(policy.miningTechBootstrapStoneBankTarget) + 100) : 200;
		if (bank.stone >= Math.max(stoneDonorFloor, bank.metal * 1.10))
		{
			stoneCandidates.sort((a, b) => b.id() - a.id());
			for (const ent of stoneCandidates)
			{
				if (moved >= needed) break;
				this.setDesiredJob(gameState, ent, "metal");
				++moved;
				aiWarn("[EXPERT-METAL] stone->metal worker=" + ent.id() + " target=" + target + " bank=" + Math.round(bank.stone) + "/" + Math.round(bank.metal));
			}
		}

		// If metal is critically absent, peel a small number of citizen-soldier
		// lumberjacks. Never do this wholesale: wood remains the infrastructure fuel.
		if (moved < needed && (bank.wood >= 350 || metalWorkers + moved < 2))
		{
			woodSoldiers.sort((a, b) => b.id() - a.id());
			for (const ent of woodSoldiers)
			{
				if (moved >= needed) break;
				this.setDesiredJob(gameState, ent, "metal");
				++moved;
				aiWarn("[EXPERT-METAL] wood-soldier->metal worker=" + ent.id() + " target=" + target + " bank=" + Math.round(bank.wood) + "/" + Math.round(bank.metal));
			}
		}

		// Last resort: a mature food economy may release only the third farmer.
		if (moved < needed && bank.food >= Math.max(700, policy.strategicMetalFoodBank))
		{
			const fields = this.builtByClass(gameState, "Field");
			const fieldIds = new Set(fields.map(f => f.id()));
			const loads = new Map(fields.map(f => [f.id(), 0]));
			for (const ent of gameState.getOwnUnits().values())
			{
				if (!ent || !ent.getMetadata) continue;
				const id = Number(ent.getMetadata(PlayerID, FARM_LOCK));
				if (Number.isFinite(id) && fieldIds.has(id)) loads.set(id, (loads.get(id) || 0) + 1);
			}
			const farmers = [];
			for (const ent of gameState.getOwnUnits().values())
			{
				if (!ent || !entityPosition(ent) || !hasClass(ent, "Civilian") || hasClass(ent, "CitizenSoldier") ||
				    ent.getMetadata(PlayerID, JOB_METADATA) !== "farm" || ent.getMetadata(PlayerID, TASK_KEY) !== undefined ||
				    ent.getMetadata(PlayerID, PENDING_JOB_METADATA) || !this.attackPlanAllowsEconomicWork(gameState, ent))
					continue;
				const ordinal = Number(ent.getMetadata(PlayerID, CIVILIAN_ORDINAL));
				if (!Number.isFinite(ordinal) || ordinal <= openingEnd) continue;
				const lockedId = Number(ent.getMetadata(PlayerID, FARM_LOCK));
				if (!Number.isFinite(lockedId) || (loads.get(lockedId) || 0) <= policy.strategicMetalMinimumFarmersPerField) continue;
				farmers.push({ ent, lockedId, ordinal });
			}
			farmers.sort((a,b) => b.ordinal-a.ordinal || b.ent.id()-a.ent.id());
			for (const item of farmers)
			{
				if (moved >= needed) break;
				if ((loads.get(item.lockedId) || 0) <= policy.strategicMetalMinimumFarmersPerField) continue;
				item.ent.setMetadata(PlayerID, FARM_LOCK, undefined);
				item.ent.setMetadata(PlayerID, FOOD_HOME_FARMSTEAD, undefined);
				item.ent.setMetadata(PlayerID, FOOD_HOME_PERMANENT, undefined);
				this.setDesiredJob(gameState, item.ent, "metal");
				loads.set(item.lockedId, (loads.get(item.lockedId) || 1) - 1);
				++moved;
				aiWarn("[EXPERT-METAL] farm->metal worker=" + item.ent.id() + " target=" + target + " field=" + item.lockedId);
			}
		}

		if (moved)
			this.lastStrategicMetalRebalanceTime = now;
	}

	resourceJobForEntity(ent, generic)
	{
		if (generic === "food")
			return "food_owned";
		if (generic === "wood")
			return hasClass(ent, "CitizenSoldier") ? "citizenSoldierWood" : "wood";
		if (generic === "stone" || generic === "metal")
			return generic;
		return "wood";
	}

	rebalanceExistingWorkers(gameState, openingEnd, balance)
	{
		const policy = mergePolicy();
		const now = Number(gameState.ai.elapsedTime) || 0;
		if (!balance || !balance.active || !balance.strong || now < policy.resourceBalanceStartTime)
			return;
		const extreme = balance.ratio >= policy.resourceBalanceExtremeRatio;
		const cooldown = extreme ? policy.resourceBalanceExtremeCooldownSeconds : policy.resourceBalanceReassignCooldownSeconds;
		if (now - this.lastResourceRebalanceTime < cooldown)
			return;

		const candidates = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!entityPosition(ent) || !this.isExpertEconomyEntity(ent) || hasClass(ent, "Cavalry"))
				continue;
			if (ent.getMetadata(PlayerID, TASK_KEY) !== undefined || ent.getMetadata(PlayerID, PENDING_JOB_METADATA) ||
			    ent.getMetadata(PlayerID, "transport") !== undefined || ent.getMetadata(PlayerID, "PartOfArmy") ||
			    ent.getMetadata(PlayerID, EXPERT_DEFENSE) !== undefined || ent.getMetadata(PlayerID, EXPERT_CIVILIAN_EVAC) !== undefined ||
			    ent.getMetadata(PlayerID, NATURAL_FOOD_LOCK))
				continue;
			const state = ent.unitAIState ? ent.unitAIState() : "";
			if (state && state.includes(".COMBAT."))
				continue;
			const soldier = hasClass(ent, "CitizenSoldier") && !hasClass(ent, "Cavalry");
			const civilian = hasClass(ent, "Civilian") && !soldier;
			if (soldier && balance.target === "food")
				continue;
			// Permanent civilian wood ownership normally remains capped by the opening
			// tranche. IT14.51 exception: under an EXTREME live bank mismatch, post-opening
			// civilian miners may leave the surplus finite resource for wood. This is the
			// 4k-stone/50-wood escape hatch; ordinary balance still uses soldiers first.
			if (civilian && balance.target === "wood" && !extreme)
				continue;
			const lockedFieldId = Number(ent.getMetadata(PlayerID, FARM_LOCK));
			// Permanent civilian farmers remain sacred. A citizen-soldier may have used a
			// field as temporary food work and is still eligible for strategic rebalance.
			if (civilian && Number.isFinite(lockedFieldId))
				continue;
			const current = ent.getMetadata(PlayerID, JOB_METADATA);
			if (jobResourceType(current) !== balance.surplus)
				continue;

			if (!soldier && !civilian)
				continue;
			const ordinal = Number(ent.getMetadata(PlayerID, CIVILIAN_ORDINAL));
			if (civilian && (!Number.isFinite(ordinal) || ordinal <= openingEnd))
				continue;
			candidates.push({ ent, soldier, ordinal: Number.isFinite(ordinal) ? ordinal : 0 });
		}

		// Prefer the newest free citizen-soldiers first. That preserves the original
		// opening wood crew and uses the military workers that caused most of the late
		// wood inflation. Post-opening civilians are the secondary source.
		candidates.sort((a, b) => Number(b.soldier) - Number(a.soldier) || b.ent.id() - a.ent.id() || b.ordinal - a.ordinal);
		const count = Math.min(extreme ? policy.resourceBalanceExtremeBatch : policy.resourceBalanceReassignBatch, candidates.length);
		if (!count)
			return;
		for (let i = 0; i < count; ++i)
		{
			const ent = candidates[i].ent;
			const carrying = ent.resourceCarrying ? (ent.resourceCarrying() || []) : [];
			const carried = carrying.reduce((sum, item) => sum + Math.max(0, Number(item && item.amount) || 0), 0);
			const nextJob = this.resourceJobForEntity(ent, balance.target);
			this.setDesiredJob(gameState, ent, nextJob);
			aiWarn("[EXPERT-BALANCE] peel worker=" + ent.id() + " " + balance.surplus + "->" + balance.target +
				" ratio=" + balance.ratio.toFixed(2) + (carried > 0 ? " deposit-first=" + Math.round(carried) : ""));
		}
		this.lastResourceRebalanceTime = now;
	}

	setDesiredJob(gameState, ent, desired)
	{
		if (!ent || !ent.getMetadata || !ent.setMetadata)
			return;
		const current = ent.getMetadata(PlayerID, JOB_METADATA);
		const pending = ent.getMetadata(PlayerID, PENDING_JOB_METADATA);
		if (current === desired || pending === desired)
			return;
		const carrying = ent.resourceCarrying ? (ent.resourceCarrying() || []) : [];
		const amount = carrying.reduce((sum, item) => sum + Math.max(0, Number(item && item.amount) || 0), 0);
		if (amount > 0)
		{
			try
			{
				executeWorkerAction(gameState, ent.id(), { "action": "RETURN_RESOURCES", "nextJob": desired }, {}, { "returnResources": returnResources }, { "playerId": PlayerID });
				return;
			}
			catch (e)
			{
				return;
			}
		}
		if (isCrossResourceJobChange(current, desired))
		{
			if (ent.stopMoving)
				ent.stopMoving();
			ent.setMetadata(PlayerID, SUPPLY_ID, undefined);
			ent.setMetadata(PlayerID, "gather-type", undefined);
			ent.setMetadata(PlayerID, FOOD_SITE, undefined);
			ent.setMetadata(PlayerID, FOOD_SITE_CHANGED_AT, undefined);
			ent.setMetadata(PlayerID, FOOD_PREVIOUS_SITE, undefined);
		}
		ent.setMetadata(PlayerID, JOB_METADATA, desired);
		ent.setMetadata(PlayerID, PENDING_JOB_METADATA, undefined);
		if (ent.getMetadata(PlayerID, TASK_KEY) === undefined && !hasClass(ent, "Cavalry"))
			ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_IDLE);
	}

	finishPendingJob(ent)
	{
		if (!ent || !ent.getMetadata || !ent.setMetadata)
			return;
		const pending = ent.getMetadata(PlayerID, PENDING_JOB_METADATA);
		if (!pending)
			return;
		const carrying = ent.resourceCarrying ? (ent.resourceCarrying() || []) : [];
		if (carrying.some(item => item && Number(item.amount) > 0))
			return;
		ent.setMetadata(PlayerID, JOB_METADATA, pending);
		ent.setMetadata(PlayerID, PENDING_JOB_METADATA, undefined);
	}

	constructionWorkers(gameState, taskId)
	{
		const out = [];
		for (const ent of gameState.getOwnUnits().values())
			if (ent.getMetadata && ent.getMetadata(PlayerID, TASK_KEY) === taskId)
				out.push(ent);
		return out;
	}

	releaseConstructionWorker(ent, taskId)
	{
		if (!ent || !ent.getMetadata || !ent.setMetadata)
			return;
		if (ent.getMetadata(PlayerID, TASK_KEY) !== taskId)
			return;
		ent.setMetadata(PlayerID, TASK_KEY, undefined);
		ent.setMetadata(PlayerID, "target-foundation", undefined);
		if (!hasClass(ent, "Cavalry"))
			ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_IDLE);
	}

	releaseConstructionTeam(gameState, taskId)
	{
		for (const ent of this.constructionWorkers(gameState, taskId))
			this.releaseConstructionWorker(ent, taskId);
	}

	commitCompletedStorehouseBuilders(gameState, taskId, storehouseId)
	{
		const store = Number.isFinite(Number(storehouseId)) ? gameState.getEntityById(Number(storehouseId)) : undefined;
		const team = this.constructionWorkers(gameState, taskId);
		for (const ent of team)
			this.releaseConstructionWorker(ent, taskId);
		if (!store || !entityPosition(store))
			return;
		let committed = 0;
		for (const ent of team)
		{
			if (!ent || !ent.getMetadata || !ent.setMetadata || hasClass(ent, "Cavalry"))
				continue;
			ent.setMetadata(PlayerID, WORKSITE_ID, store.id());
			ent.setMetadata(PlayerID, SUPPLY_ID, undefined);
			ent.setMetadata(PlayerID, "gather-type", "wood");
			ent.setMetadata(PlayerID, JOB_METADATA, hasClass(ent, "CitizenSoldier") ? "citizenSoldierWood" : "wood");
			ent.setMetadata(PlayerID, PENDING_JOB_METADATA, undefined);
			ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_IDLE);
			if (ent.stopMoving) ent.stopMoving();
			++committed;
		}
		if (committed)
			aiWarn("[EXPERT-WOOD] completed storehouse crew committed site=" + store.id() + " workers=" + committed);
	}


	activeSecondStorehouseFoundation(gameState)
	{
		const taskId = this.activeTaskByKind.storehouse;
		if (!taskId || this.builtByClass(gameState, "Storehouse").length !== 1)
			return undefined;
		let observed;
		try { observed = this.foundationTracker.observeTask(gameState, taskId); }
		catch (e) { return undefined; }
		if (!observed || observed.state !== "foundation" || !Number.isFinite(observed.foundationId))
			return undefined;
		const foundation = gameState.getEntityById(observed.foundationId);
		if (!foundation || !entityPosition(foundation))
			return undefined;
		return { taskId, foundation };
	}

	commitNewWoodCivilianToSecondStorehouse(gameState, ent)
	{
		if (!ent || !ent.getMetadata || !ent.setMetadata || !hasClass(ent, "Civilian") ||
		    hasClass(ent, "CitizenSoldier") || hasClass(ent, "Cavalry"))
			return false;
		const active = this.activeSecondStorehouseFoundation(gameState);
		if (!active)
			return false;
		// New civilians have empty hands. Still guard the rare case where another system
		// handed them resources before this tick; deposit first rather than deleting cargo.
		const carrying = ent.resourceCarrying ? (ent.resourceCarrying() || []) : [];
		ent.setMetadata(PlayerID, WORKSITE_ID, undefined);
		ent.setMetadata(PlayerID, TASK_KEY, active.taskId);
		ent.setMetadata(PlayerID, "target-foundation", active.foundation.id());
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_BUILDER);
		if (carrying.some(item => item && Number(item.amount) > 0))
		{
			const queued = returnResources(gameState, ent);
			this.diagnoseWorkerOrder(ent, "build:storehouse", active.foundation.id(), queued ? "RETURNING_RESOURCES" : "NO_DROPSITE");
			return true;
		}
		const order = ensureRepairOrder(ent, active.foundation, false);
		this.diagnoseWorkerOrder(ent, "build:storehouse", active.foundation.id(), order.status);
		aiWarn("[EXPERT-WOOD] new civilian=" + ent.id() + " joins second storehouse foundation=" + active.foundation.id());
		return order.status !== "FAILED";
	}

	commitCompletedNaturalFarmsteadBuilders(gameState, taskId, cluster)
	{
		let team = this.constructionWorkers(gameState, taskId);
		const wickerBranch = !!(cluster && this.postWickerBranchCluster && this.clustersOverlap(cluster, this.postWickerBranchCluster));
		if (wickerBranch && this.postWickerBranchWorkerIds.length)
		{
			const byId = new Map(team.map(ent => [ent.id(), ent]));
			for (const id of this.postWickerBranchWorkerIds)
			{
				const ent = gameState.getEntityById(Number(id));
				if (ent) byId.set(ent.id(), ent);
			}
			team = [...byId.values()];
		}
		for (const ent of team)
			this.releaseConstructionWorker(ent, taskId);

		if (!cluster || !Array.isArray(cluster.ids) || !cluster.ids.length)
			return;
		const site = encodeFoodSite(cluster.ids);
		const now = Number(gameState.ai.elapsedTime) || 0;
		const clusterEntities = cluster.ids.map(id => gameState.getEntityById(Number(id))).filter(ent => ent && entityPosition(ent));
		const clusterCenter = Array.isArray(cluster.center) ? cluster.center : centerOf(clusterEntities);
		let homeFarmsteadId;
		if (clusterCenter)
		{
			const farmsteads = this.builtByClass(gameState, "Farmstead").filter(ent => ent && entityPosition(ent));
			farmsteads.sort((a, b) => SquareVectorDistance(a.position(), clusterCenter) - SquareVectorDistance(b.position(), clusterCenter) || a.id() - b.id());
			if (farmsteads[0] && SquareVectorDistance(farmsteads[0].position(), clusterCenter) <= 50 * 50)
				homeFarmsteadId = farmsteads[0].id();
		}
		let committed = 0;
		for (const ent of team)
		{
			if (!ent || !ent.getMetadata || !ent.setMetadata ||
			    !hasClass(ent, "Civilian") || hasClass(ent, "CitizenSoldier") || hasClass(ent, "Cavalry"))
				continue;

			const oldSite = encodeFoodSite(decodeFoodSite(ent.getMetadata(PlayerID, FOOD_SITE)));
			if (oldSite && oldSite !== site)
				ent.setMetadata(PlayerID, FOOD_PREVIOUS_SITE, oldSite);
			ent.setMetadata(PlayerID, FOOD_SITE, site);
			ent.setMetadata(PlayerID, FOOD_SITE_CHANGED_AT, now);
			ent.setMetadata(PlayerID, NATURAL_FOOD_LOCK, site);
			if (Number.isFinite(homeFarmsteadId))
				ent.setMetadata(PlayerID, FOOD_HOME_FARMSTEAD, homeFarmsteadId);
			ent.setMetadata(PlayerID, SUPPLY_ID, undefined);
			ent.setMetadata(PlayerID, "gather-type", "food");
			ent.setMetadata(PlayerID, JOB_METADATA,
				ent.getMetadata(PlayerID, JOB_METADATA) === "food_owned" ? "food_owned" : "food");
			ent.setMetadata(PlayerID, PENDING_JOB_METADATA, undefined);
			ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
			if (ent.stopMoving)
				ent.stopMoving();
			++committed;
		}
		if (committed)
			aiWarn("[EXPERT-FOOD] natural farmstead builders committed to new cluster workers=" + committed +
				(Number.isFinite(homeFarmsteadId) ? " homeFarmstead=" + homeFarmsteadId : ""));
	}

	lockCompletedFieldBuilders(gameState, taskId, fieldId)
	{
		const field = Number.isFinite(Number(fieldId)) ? gameState.getEntityById(Number(fieldId)) : undefined;
		const team = this.constructionWorkers(gameState, taskId);
		for (const ent of team)
			this.releaseConstructionWorker(ent, taskId);
		if (!field || !hasClass(field, "Field"))
			return;
		const policy = mergePolicy();
		const hard = field.maxGatherers ? Number(field.maxGatherers()) : policy.farmersPerField;
		const limit = Math.max(1, Math.min(policy.farmersPerField, Number.isFinite(hard) && hard > 0 ? hard : policy.farmersPerField));
		let locked = 0;
		for (const ent of team)
		{
			if (locked >= limit || !hasClass(ent, "Civilian") || hasClass(ent, "CitizenSoldier") || hasClass(ent, "Cavalry"))
				continue;
			ent.setMetadata(PlayerID, FARM_LOCK, field.id());
			ent.setMetadata(PlayerID, JOB_METADATA, "farm");
			ent.setMetadata(PlayerID, PENDING_JOB_METADATA, undefined);
			ent.setMetadata(PlayerID, SUPPLY_ID, field.id());
			ent.setMetadata(PlayerID, "gather-type", "food");
			ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
			++locked;
		}
		if (locked)
			aiWarn("[EXPERT-FARM] field=" + field.id() + " permanently locked builders=" + locked);
	}

	cancelQueuedConstructionTask(gameState, taskId)
	{
		let removed = 0;
		for (const name of ["house", "dropsites", "field", "militaryBuilding", "economicBuilding", "defenseBuilding"])
		{
			const queue = gameState.ai.queues[name];
			if (!queue || !queue.plans)
				continue;
			const before = queue.plans.length;
			queue.plans = queue.plans.filter(plan => !(plan.metadata && plan.metadata.expertTaskId === taskId));
			removed += before - queue.plans.length;
		}
		return removed;
	}

	retryStalledBarracksTask(gameState, taskId, observed, kind = "barracks")
	{
		if (!taskId || !observed || observed.state !== "awaiting-foundation")
			return false;
		const started = Number(this.taskStartedAt[taskId]);
		const policy = mergePolicy();
		const thirdBarracks = kind === "barracks" && this.builtByClass(gameState, "Barracks").length >= 2;
		const timeout = thirdBarracks ? policy.thirdBarracksAwaitingFoundationRetrySeconds : policy.barracksAwaitingFoundationRetrySeconds;
		if (!Number.isFinite(started) || gameState.ai.elapsedTime - started < timeout)
			return false;
		const removed = this.cancelQueuedConstructionTask(gameState, taskId);
		this.releaseConstructionTeam(gameState, taskId);
		delete this.activeTaskByKind[kind];
		delete this.activeTaskBuildIntent[taskId];
		delete this.taskStartedAt[taskId];
		delete this.pendingWoodSelectionByTask[taskId];
		delete this.taskDiagnostics[taskId];
		if (this.foundationTracker && this.foundationTracker.remove)
			this.foundationTracker.remove(taskId);
		aiWarn("[EXPERT-BUILD] retry stalled kind=" + kind + " task=" + taskId + " waited=" + Math.round(gameState.ai.elapsedTime - started) + "s removedPlans=" + removed);
		return true;
	}

	cleanupStaleConstructionAssignments(gameState)
	{
		const active = new Set([
			...Object.values(this.activeTaskByKind).filter(Boolean),
			...this.activeFieldTasks.filter(Boolean)
		]);
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !ent.getMetadata)
				continue;
			const taskId = ent.getMetadata(PlayerID, TASK_KEY);
			if (taskId === undefined || active.has(taskId))
				continue;
			this.releaseConstructionWorker(ent, taskId);
		}
	}

	refreshTasks(gameState)
	{
		const refreshOne = (kind, taskId, isField = false) =>
		{
			if (!taskId)
				return;
			let observed;
			try { observed = this.foundationTracker.observeTask(gameState, taskId); }
			catch (e) { return; }

			if (!isField && (kind === "barracks" || kind === "market" || kind === "forge" || kind === "temple" || kind === "arsenal" || kind === "gymnasium" || kind === "prytaneion") && this.retryStalledBarracksTask(gameState, taskId, observed, kind))
				return;

			// IT14.25 storehouse handoff contract: as soon as storehouse #2 has a real
			// foundation, that *position* becomes the primary destination for NEW wood
			// workers. Existing lumberjacks keep their explicit WORKSITE_ID and therefore
			// stay on the old line; the new cohort builds/chops at the expansion instead.
			if (!isField && kind === "storehouse" && observed.state === "foundation" &&
			    this.builtByClass(gameState, "Storehouse").length === 1 && this.pendingWoodSelectionByTask[taskId])
			{
				const foundation = Number.isFinite(observed.foundationId) ? gameState.getEntityById(observed.foundationId) : undefined;
				if (foundation && entityPosition(foundation) &&
				    (!this.primaryWoodWorksite || this.primaryWoodWorksite.taskId !== taskId || this.primaryWoodWorksite.foundationId !== foundation.id()))
				{
					this.primaryWoodWorksite = {
						"position": foundation.position(), "taskId": taskId, "foundationId": foundation.id()
					};
					aiWarn("[EXPERT-WOOD] second storehouse foundation active for new workers task=" + taskId + " foundation=" + foundation.id());
				}
			}

			if (observed.state === "completed" || observed.state === "missing-after-foundation")
			{
				const completedNaturalCluster = observed.state === "completed" && kind === "farmstead" ?
					this.pendingFoodSelectionByTask[taskId] : undefined;
				const completedWickerBranch = !!(completedNaturalCluster && this.postWickerBranchCluster &&
					this.clustersOverlap(completedNaturalCluster, this.postWickerBranchCluster));
				if (isField && observed.state === "completed")
					this.lockCompletedFieldBuilders(gameState, taskId, observed.completedEntityId);
				else if (completedNaturalCluster)
					this.commitCompletedNaturalFarmsteadBuilders(gameState, taskId, completedNaturalCluster);
				else if (observed.state === "completed" && kind === "storehouse" && this.pendingWoodSelectionByTask[taskId])
					this.commitCompletedStorehouseBuilders(gameState, taskId, observed.completedEntityId);
				else
					this.releaseConstructionTeam(gameState, taskId);
				if (completedWickerBranch)
				{
					this.postWickerBranchFarmsteadPending = false;
					aiWarn("[EXPERT-BERRIES] secondary food farmstead complete; branch workers locked");
				}
				delete this.taskStartedAt[taskId];
				delete this.activeTaskBuildIntent[taskId];

				if (isField)
				{
					this.activeFieldTasks = this.activeFieldTasks.filter(id => id !== taskId);
					delete this.pendingFieldPositions[taskId];
				}
				else
				{
					delete this.activeTaskByKind[kind];
					if (observed.state === "completed" && kind === "storehouse")
					{
						const ent = gameState.getEntityById(observed.completedEntityId);
						if (ent && entityPosition(ent) && (!this.primaryWoodWorksite || this.pendingWoodSelectionByTask[taskId]))
							this.primaryWoodWorksite = { "entityId": ent.id(), "position": ent.position(), "taskId": taskId };
					}
					if (observed.state === "completed" && kind === "farmstead" && this.pendingFoodSelectionByTask[taskId])
					{
						this.readyNextFoodCluster = this.pendingFoodSelectionByTask[taskId];
						this.activeNaturalExpansionCluster = this.pendingFoodSelectionByTask[taskId];
						aiWarn("[EXPERT-FOOD] sequential natural district locked remaining=" +
							Math.round(Number(this.activeNaturalExpansionCluster.remaining) || 0));
					}
				}
				delete this.pendingWoodSelectionByTask[taskId];
				delete this.pendingFoodSelectionByTask[taskId];
			}
			this.diagnoseTaskLifecycle(gameState, kind, taskId, observed);
		};

		for (const [kind, taskId] of Object.entries({ ...this.activeTaskByKind }))
			refreshOne(kind, taskId, false);
		for (const taskId of [...this.activeFieldTasks])
			refreshOne("field", taskId, true);
	}

	diagnoseTaskLifecycle(gameState, kind, taskId, observed)
	{
		const foundationId = Number.isFinite(observed.foundationId) ? observed.foundationId : "-";
		const key = observed.state + ":" + foundationId;
		if (this.taskDiagnostics[taskId] === key)
			return;
		this.taskDiagnostics[taskId] = key;
		aiWarn("[EXPERT-LIVE] task=" + taskId + " kind=" + kind + " state=" + observed.state +
			" foundation=" + foundationId + " queued=" + this.findQueuedTask(gameState, taskId));
	}

	diagnoseWorkerOrder(ent, desired, targetId, status)
	{
		const id = finiteId(ent);
		if (!Number.isFinite(id))
			return;
		const live = describeLiveOrder(ent);
		const key = desired + ":" + targetId + ":" + status + ":" + live.state + ":" + live.targets.join(",");
		if (this.orderDiagnostics[id] === key)
			return;
		this.orderDiagnostics[id] = key;
		aiWarn("[EXPERT-LIVE] worker=" + id + " desired=" + desired + " target=" + targetId +
			" status=" + status + " state=" + (live.state || "-") + " orders=" + (live.targets.join(",") || "-") +
			" idle=" + live.idle);
	}

	findQueuedTask(gameState, taskId)
	{
		for (const name of ["house", "dropsites", "field", "militaryBuilding", "economicBuilding", "defenseBuilding"])
		{
			const queue = gameState.ai.queues[name];
			if (queue && queue.plans && queue.plans.some(plan => plan.metadata && plan.metadata.expertTaskId === taskId))
				return true;
		}
		return false;
	}

	rebindQueuedStarters(gameState)
	{
		for (const name of ["house", "dropsites", "field", "militaryBuilding", "economicBuilding", "defenseBuilding"])
		{
			const queue = gameState.ai.queues[name];
			if (!queue || !queue.plans)
				continue;
			for (const plan of queue.plans)
			{
				if (!plan.metadata || !plan.metadata.expertDecisionLayer || !plan.metadata.expertTaskId || !plan.position)
					continue;
				const kind = plan.metadata.expertDecisionKind;
				if (!BUILDING_SPECS[kind])
					continue;
				const branch = kind === "farmstead" && plan.metadata.expertDecisionRole === "wicker_branch";
				const savedPool = Array.isArray(plan.metadata.expertBuilderPool) && plan.metadata.expertBuilderPool.length ?
					plan.metadata.expertBuilderPool : BUILDING_SPECS[kind].allowedBuilderJobs;
				const action = branch ? { "builderPool": ["food", "food_owned"], "requiredBuilderIds": [...this.postWickerBranchWorkerIds] } :
					{ "builderPool": savedPool };
				const options = { "playerId": PlayerID, "taskId": plan.metadata.expertTaskId };
				const starter = selectFoundationStarter(gameState, kind, plan.position, action, options);
				if (starter)
				{
					plan.metadata.expertBuilderId = starter.id();
					continue;
				}
				const candidate = selectFoundationStarterCandidate(gameState, kind, plan.position, action, options);
				if (!candidate)
					continue;
				const carrying = candidate.resourceCarrying ? (candidate.resourceCarrying() || []) : [];
				if (carrying.some(item => item && Number(item.amount) > 0))
				{
					if (returnResources(gameState, candidate))
						this.diagnoseWorkerOrder(candidate, "prime-build:" + kind, plan.metadata.expertTaskId, "RETURNING_RESOURCES");
					continue;
				}
				plan.metadata.expertBuilderId = candidate.id();
			}
		}
	}

	woodTreesAt(gameState, position, accessIndex, radius = 30)
	{
		return collectWoodTrees(gameState, {
			"getLandAccess": getLandAccess,
			"isSupplyFull": isSupplyFull,
			"territoryMap": this.HQ.territoryMap,
			"worksitePosition": position,
			"accessIndex": accessIndex,
			"playerId": PlayerID,
			"radius": radius
		});
	}

	findHealthyAlternativeWoodWorksite(gameState, accessIndex, currentEntityId)
	{
		const policy = mergePolicy();
		let best;
		for (const store of this.builtByClass(gameState, "Storehouse"))
		{
			if (store.id() === currentEntityId || !entityPosition(store))
				continue;
			const trees = this.woodTreesAt(gameState, store.position(), accessIndex);
			const metrics = summarizeWoodTrees(trees);
			if (metrics.localWoodAmount < policy.localWoodHealthyAmount)
				continue;
			if (!best || metrics.localWoodAmount > best.metrics.localWoodAmount)
				best = { "store": store, trees, metrics };
		}
		return best;
	}

	woodWorkerCenter(gameState)
	{
		const workers = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!entityPosition(ent) || !ent.getMetadata)
				continue;
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			if (["wood", "citizenSoldierWood", "food_overflow_wood"].includes(job))
				workers.push(ent);
		}
		return centerOf(workers);
	}

	woodWorkersForWorksite(gameState, worksiteId)
	{
		const out = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!entityPosition(ent) || !ent.getMetadata || ent.getMetadata(PlayerID, EXPERT_DEFENSE) !== undefined)
				continue;
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			if (!["wood", "citizenSoldierWood", "food_overflow_wood"].includes(job))
				continue;
			if (worksiteId !== undefined && ent.getMetadata(PlayerID, WORKSITE_ID) != worksiteId)
				continue;
			out.push(ent);
		}
		return out;
	}

	dominantWoodBuilderCenter(gameState)
	{
		const workers = this.woodWorkersForWorksite(gameState);
		if (!workers.length)
			return undefined;
		const soldiers = workers.filter(ent => hasClass(ent, "CitizenSoldier"));
		const pool = soldiers.length >= 2 ? soldiers : workers;
		const groups = new Map();
		for (const ent of pool)
		{
			const key = String(ent.getMetadata(PlayerID, WORKSITE_ID) ?? "unassigned");
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(ent);
		}
		const best = [...groups.values()].sort((a, b) => b.length - a.length || a[0].id() - b[0].id())[0];
		return centerOf(best || pool);
	}

	connectedWoodCluster(trees, seedPosition, linkDistance)
	{
		if (!trees || !trees.length || !seedPosition)
			return [];
		let seed = 0;
		let best = Infinity;
		for (let i = 0; i < trees.length; ++i)
		{
			const d = SquareVectorDistance(trees[i].position, seedPosition);
			if (d < best)
			{
				best = d;
				seed = i;
			}
		}
		const linkSq = linkDistance * linkDistance;
		const seen = new Set([seed]);
		const queue = [seed];
		while (queue.length)
		{
			const i = queue.shift();
			for (let j = 0; j < trees.length; ++j)
			{
				if (seen.has(j) || SquareVectorDistance(trees[i].position, trees[j].position) > linkSq)
					continue;
				seen.add(j);
				queue.push(j);
			}
		}
		return [...seen].map(i => trees[i]);
	}

	woodAmount(trees)
	{
		return (trees || []).reduce((sum, tree) => sum + Math.max(0, Number(tree.remaining) || 0), 0);
	}

	weightedWoodDistance(trees, position)
	{
		const amount = this.woodAmount(trees);
		if (!amount || !position)
			return 0;
		return trees.reduce((sum, tree) => sum + Math.sqrt(SquareVectorDistance(tree.position, position)) * Math.max(0, Number(tree.remaining) || 0), 0) / amount;
	}

	storehousesServingWoodCluster(gameState, trees, radius = 30)
	{
		if (!trees || !trees.length)
			return 0;
		const r2 = radius * radius;
		let count = 0;
		for (const store of this.builtByClass(gameState, "Storehouse"))
		{
			if (!entityPosition(store))
				continue;
			if (trees.some(tree => SquareVectorDistance(store.position(), tree.position) <= r2))
				++count;
		}
		return count;
	}

	woodServiceStorehouseCount(gameState, accessIndex)
	{
		// Count only Storehouses that can service LIVE wood. A mineral Storehouse on bare
		// ground, or an exhausted former lumber camp, must not block a new forest district.
		const radius = Math.max(24, Number(mergePolicy().fallbackWoodDropsiteRadius) || 36);
		const r2 = radius * radius;
		const trees = [];
		for (const supply of gameState.getResourceSupplies("wood").values())
		{
			if (!supply || !entityPosition(supply) || !supply.resourceSupplyAmount || supply.resourceSupplyAmount() <= 0)
				continue;
			if (getLandAccess(gameState, supply) !== accessIndex || this.HQ.territoryMap.getOwner(supply.position()) !== PlayerID)
				continue;
			trees.push(supply);
		}
		let count = 0;
		for (const store of this.builtByClass(gameState, "Storehouse"))
		{
			if (!entityPosition(store) || getLandAccess(gameState, store) !== accessIndex)
				continue;
			if (trees.some(tree => SquareVectorDistance(store.position(), tree.position()) <= r2))
				++count;
		}
		return count;
	}

	collectWoodsite(gameState, cc, accessIndex)
	{
		const policy = mergePolicy();
		let pos = this.getPrimaryWoodPosition(gameState) || cc.position();
		let entityId = this.primaryWoodWorksite && Number.isFinite(Number(this.primaryWoodWorksite.entityId)) ?
			Number(this.primaryWoodWorksite.entityId) : undefined;
		let trees = this.woodTreesAt(gameState, pos, accessIndex);
		let metrics = summarizeWoodTrees(trees);
		if (metrics.localWoodAmount <= policy.localWoodCriticalAmount)
		{
			// The tight cutting ring can be depleted while the same forest still has a
			// strong nearby front. Measure that broader committed forest before switching
			// the global primary site to a smaller/newer storehouse.
			const extendedTrees = this.woodTreesAt(gameState, pos, accessIndex, policy.woodMigrationSalvageRadius);
			const extendedMetrics = summarizeWoodTrees(extendedTrees);
			const alternative = this.findHealthyAlternativeWoodWorksite(gameState, accessIndex, entityId);
			const altWood = alternative && alternative.metrics ? Math.max(0, Number(alternative.metrics.localWoodAmount) || 0) : 0;
			const retainRichFront = extendedMetrics.localWoodAmount >= policy.localWoodHealthyAmount &&
				(!alternative || extendedMetrics.localWoodAmount >= altWood * policy.woodMigrationRetainWoodRatio);

			if (retainRichFront)
			{
				trees = extendedTrees;
				metrics = extendedMetrics;
			}
			else if (alternative)
			{
				this.primaryWoodWorksite = {
					"entityId": alternative.store.id(),
					"position": alternative.store.position(),
					"taskId": alternative.store.getMetadata ? alternative.store.getMetadata(PlayerID, "expertTaskId") : undefined
				};
				entityId = alternative.store.id();
				pos = alternative.store.position();
				trees = alternative.trees;
				metrics = alternative.metrics;
				aiWarn("[EXPERT-WOOD] switched to existing healthy storehouse=" + alternative.store.id());
			}
		}
		// IT14.20 retains entityId here, defeating the same-primary
		// migration guard in workerWoodsite and allowing needless staged migrations.
		return { trees, ...metrics, "position": pos, "entityId": entityId };
	}


	finishingState(gameState)
	{
		const policy = mergePolicy();
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
		const active = Number.isFinite(enemyPopulation) && enemyPopulation > 0 &&
			enemyPopulation <= policy.expertFinishingEnemyPopulation &&
			ownPopulation >= policy.expertFinishingMinimumOwnPopulation &&
			ownPopulation - enemyPopulation >= policy.expertFinishingMinimumPopulationLead;
		return { active, targetPlayer, enemyPopulation, ownPopulation };
	}

	// IT14.45: do not wait until the opponent is already below 50 population to begin
	// preparing siege.  If a healthy P3 attack is already on the field, one ram should
	// be entering the pipeline so it can arrive with the follow-up rather than after the
	// game is strategically over.
	p3SiegeContext(gameState, finishing)
	{
		if (!gameState.currentPhase || gameState.currentPhase() < 2)
			return { active: false };
		const policy = mergePolicy();
		const phase = gameState.currentPhase();
		if (phase >= 3 && finishing && finishing.active)
			return { ...finishing, active: true, finishing: true, desiredSiege: mergePolicy().expertFinishingSiegeTarget };
		const manager = this.HQ && this.HQ.attackManager;
		if (!manager)
			return { active: false };
		let best;
		for (const type of Object.keys(manager.startedAttacks || {}))
			for (const plan of manager.startedAttacks[type] || [])
				if (plan && plan.targetPlayer !== undefined && plan.unitCollection &&
				    plan.unitCollection.length >= Math.min(policy.expertP3SiegePrepArmy, policy.expertBrokenEnemySiegeArmy) &&
				    (!best || plan.unitCollection.length > best.unitCollection.length))
					best = plan;
		if (!best)
			return { active: false };
		let enemyPopulation = 999;
		const data = gameState.sharedScript && gameState.sharedScript.playersData && gameState.sharedScript.playersData[best.targetPlayer];
		if (data)
			enemyPopulation = Math.max(0, Number(data.popCount) || 0);
		if (phase === 2)
		{
			if (best.unitCollection.length < policy.expertBrokenEnemySiegeArmy ||
			    enemyPopulation > policy.expertBrokenEnemySiegePopulation)
				return { active: false };
			return { active: true, finishing: false, brokenTown: true, targetPlayer: best.targetPlayer, enemyPopulation,
				ownPopulation: gameState.getPopulation(), desiredSiege: 1 };
		}
		return { active: true, finishing: false, targetPlayer: best.targetPlayer, enemyPopulation,
			ownPopulation: gameState.getPopulation(), desiredSiege: mergePolicy().expertP3SiegePrepTarget };
	}

	frontierResourceAnchors(gameState, ccPos, accessIndex)
	{
		const policy = mergePolicy();
		if (!gameState.getResourceSupplies || !ccPos)
			return [];
		const anchors = [];
		for (const generic of ["food", "wood", "metal", "stone"])
		{
			for (const supply of gameState.getResourceSupplies(generic).values())
			{
				const pos = entityPosition(supply);
				if (!pos || !supply.resourceSupplyAmount || supply.resourceSupplyAmount() <= 0 ||
				    getLandAccess(gameState, supply) !== accessIndex)
					continue;
				if (generic === "food" && hasClass(supply, "Animal"))
					continue;
				// We want resources just beyond the current border, not deep enemy targets.
				if (this.HQ.territoryMap.getOwner(pos) === PlayerID)
					continue;
				const distance = Math.sqrt(SquareVectorDistance(pos, ccPos));
				if (distance < policy.forwardAnchorMinimumCCDistance || distance > policy.forwardAnchorMaximumCCDistance)
					continue;
				const amount = Math.max(0, Number(supply.resourceSupplyAmount()) || 0);
				const classBonus = generic === "food" ? 900 : generic === "wood" ? 700 : 500;
				anchors.push({ position: pos, generic, score: classBonus + amount - 2 * distance });
			}
		}
		anchors.sort((a, b) => b.score - a.score);
		const out = [];
		for (const anchor of anchors)
		{
			if (out.some(existing => SquareVectorDistance(existing.position, anchor.position) < 26 * 26))
				continue;
			out.push(anchor);
			if (out.length >= 10)
				break;
		}
		return out;
	}

	selectSiegeFinisher(gameState, trainer)
	{
		if (!trainer || !trainer.trainableEntities)
			return undefined;
		const candidates = [];
		for (const type of trainer.trainableEntities(gameState.getPlayerCiv()) || [])
		{
			if (gameState.isTemplateDisabled(type))
				continue;
			const template = gameState.getTemplate(type);
			if (!template || !template.available(gameState) || !template.hasClasses(["Siege"]) || template.hasClasses(["SiegeTower"]))
				continue;
			const cost = template.cost(trainer);
			const resources = {
				food: Number(cost && cost.food) || 0, wood: Number(cost && cost.wood) || 0,
				stone: Number(cost && cost.stone) || 0, metal: Number(cost && cost.metal) || 0
			};
			const ram = template.hasClasses(["Ram"]) || String(type).toLowerCase().includes("ram");
			candidates.push({ type, cost: resources, ram, score: (ram ? -10000 : 0) + resources.food + resources.wood + resources.stone + resources.metal });
		}
		candidates.sort((a, b) => a.score - b.score || a.type.localeCompare(b.type));
		return candidates[0];
	}

	trainExpertSiegeFinisher(gameState, queues, siegeContext)
	{
		if (!siegeContext || !siegeContext.active || typeof gameState.currentPhase !== "function" || gameState.currentPhase() < 2 ||
		    !queues || !queues.citizenSoldier)
			return;
		const policy = mergePolicy();
		const desiredSiege = Math.max(1, Number(siegeContext.desiredSiege) || policy.expertFinishingSiegeTarget);
		let existing = 0;
		for (const ent of gameState.getOwnUnits().values())
			if (ent && hasClass(ent, "Siege"))
				++existing;
		let queued = 0;
		for (const plan of queues.citizenSoldier.plans || [])
			if (plan && plan.metadata && plan.metadata.expertDecisionTraining === "siege")
				queued += Math.max(1, Number(plan.number) || 1);
		if (existing + queued >= desiredSiege)
			return;
		for (const arsenal of this.builtByClass(gameState, "Arsenal").sort((a, b) => a.id() - b.id()))
		{
			if (existing + queued >= desiredSiege)
				break;
			if (this.trainerHasExpertSoldierWork(queues, arsenal))
				continue;
			const selected = this.selectSiegeFinisher(gameState, arsenal);
			if (!selected)
				continue;
			const bank = gameState.getResources();
			if (bank.food < selected.cost.food || bank.wood < selected.cost.wood || bank.stone < selected.cost.stone || bank.metal < selected.cost.metal)
				continue;
			const plan = new TrainingPlan(gameState, selected.type, {
				"plan": -1, "trainer": arsenal.id(), "expertDecisionLayer": true,
				"expertDecisionTraining": "siege", "expertDecisionMilitary": true
			}, 1, 1);
			if (!plan)
				continue;
			queues.citizenSoldier.addPlan(plan);
			gameState.ai.queueManager.changePriority("citizenSoldier", Math.max(this.HQ.Config.priorities.citizenSoldier || 1, 980));
			++queued;
			aiWarn("[EXPERT-SIEGE] queued siege=" + selected.type + " trainer=" + arsenal.id() + " enemyPop=" + siegeContext.enemyPopulation +
				" mode=" + (siegeContext.finishing ? "finish" : siegeContext.brokenTown ? "broken-p2" : "p3-push"));
		}
	}


	lowestEnemyPopulation(gameState)
	{
		let best = Infinity;
		if (!gameState.sharedScript || !gameState.sharedScript.playersData)
			return best;
		for (let i = 1; i < gameState.sharedScript.playersData.length; ++i)
		{
			if (!gameState.isPlayerEnemy(i))
				continue;
			const data = gameState.sharedScript.playersData[i];
			if (!data || data.state === "defeated")
				continue;
			best = Math.min(best, Math.max(0, Number(data.popCount) || 0));
		}
		return best;
	}

	applyAthenianSpecialInfrastructure(gameState, frame)
	{
		if (gameState.getPlayerCiv() !== "athen" || !gameState.currentPhase)
			return frame;
		const phase = gameState.currentPhase();
		if (phase < 2)
			return frame;
		const policy = mergePolicy();
		const enemyPop = this.lowestEnemyPopulation(gameState);
		// When the opponent is already in finishing range, spend on the kill rather than
		// adding long-payback special infrastructure.
		if (Number.isFinite(enemyPop) && enemyPop <= policy.expertFinishingEnemyPopulation)
			return frame;
		const actions = [...(frame.actions || [])];
		const hasAction = kind => actions.some(action => action && action.kind === kind &&
			(action.type === "BUILD" || action.type === "MAINTAIN_CONSTRUCTION"));
		const pop = Number(gameState.getPopulation()) || 0;
		const now = Number(gameState.ai.elapsedTime) || 0;
		const doctrine = this.ensureStrategicDoctrine(gameState);

		const gymType = gameState.applyCiv("structures/{civ}/gymnasium");
		const gymTemplate = gameState.getTemplate(gymType);
		const gymMinTime = doctrine.id === "p2_tech_push" ?
			policy.athensGymnasiumMinimumTime : policy.athensGymnasiumRushMinimumTime;
		const gymReady = phase >= 2 && now >= gymMinTime &&
			pop >= policy.athensGymnasiumMinimumPopulation &&
			this.builtByClass(gameState, "Barracks").length >= 2 &&
			this.builtByClass(gameState, "Forge").length >= 1 &&
			this.builtByClass(gameState, "Temple").length >= 1;
		if (gymTemplate && gymReady && !hasAction("gymnasium") &&
		    this.specialStructurePipeline(gameState, "gymnasium") === 0 &&
		    this.HQ.canBuild && this.HQ.canBuild(gameState, gymType) &&
		    this.specialBuildingAffordable(gameState, gymType, {
			    food: policy.athensGymnasiumFoodReserve,
			    wood: policy.athensGymnasiumWoodReserve,
			    metal: policy.athensGymnasiumMetalReserve
		    }))
		{
			actions.push({
				type: "BUILD", kind: "gymnasium", role: "athens_p2_champions", priority: 94,
				builderCount: 4,
				builderPool: ["citizenSoldierWood", "wood", "food_overflow_wood", "farm", "food_owned", "food", "stone", "metal"],
				reason: "Athens Town-phase champion production after the timing army is established"
			});
			if (now - this.lastAthenianSpecialBuildDiag >= 15)
			{
				this.lastAthenianSpecialBuildDiag = now;
				aiWarn("[EXPERT-ATHENS] build=gymnasium phase=" + phase + " pop=" + pop +
					" strategy=" + doctrine.id);
			}
		}

		const pryType = gameState.applyCiv("structures/{civ}/prytaneion");
		const pryTemplate = gameState.getTemplate(pryType);
		if (phase >= 3 && pop >= 120 && pryTemplate && !hasAction("prytaneion") &&
		    this.specialStructurePipeline(gameState, "prytaneion") === 0 &&
		    this.HQ.canBuild && this.HQ.canBuild(gameState, pryType) &&
		    this.specialBuildingAffordable(gameState, pryType, {
			    food: policy.athensPrytaneionFoodReserve,
			    wood: policy.athensPrytaneionWoodReserve,
			    metal: policy.athensPrytaneionMetalReserve
		    }))
		{
			actions.push({
				type: "BUILD", kind: "prytaneion", role: "athens_p3_heroes", priority: 96,
				builderCount: 4,
				builderPool: ["citizenSoldierWood", "wood", "food_overflow_wood", "farm", "food_owned", "food", "stone", "metal"],
				reason: "Athens City-phase hero/command infrastructure"
			});
			if (now - this.lastAthenianSpecialBuildDiag >= 15)
			{
				this.lastAthenianSpecialBuildDiag = now;
				aiWarn("[EXPERT-ATHENS] build=prytaneion phase=3 pop=" + pop);
			}
		}
		return { ...frame, actions };
	}

	specialTrainableCandidates(gameState, trainer, predicate)
	{
		const out = [];
		if (!trainer || !trainer.trainableEntities)
			return out;
		for (const type of trainer.trainableEntities(gameState.getPlayerCiv()) || [])
		{
			if (gameState.isTemplateDisabled(type))
				continue;
			const template = gameState.getTemplate(type);
			if (!template || !template.available(gameState) || !predicate(template, type))
				continue;
			const cost = template.cost(trainer);
			out.push({
				type, template,
				cost: {
					food: Number(cost && cost.food) || 0,
					wood: Number(cost && cost.wood) || 0,
					stone: Number(cost && cost.stone) || 0,
					metal: Number(cost && cost.metal) || 0
				}
			});
		}
		return out;
	}

	hasQueuedHero(gameState)
	{
		for (const queue of Object.values(gameState.ai.queues || {}))
		{
			if (!queue || !Array.isArray(queue.plans))
				continue;
			for (const plan of queue.plans)
			{
				if (!plan || !plan.type)
					continue;
				const template = gameState.getTemplate(plan.type);
				if (template && template.hasClasses && template.hasClasses(["Hero"]))
					return true;
			}
		}
		return false;
	}

	queueAthenianSpecialUnit(gameState, queues, trainer, selected, label, reserve = {})
	{
		if (!selected || !trainer || !queues || !queues.citizenSoldier ||
		    this.trainerHasExpertSoldierWork(queues, trainer))
			return false;
		const bank = gameState.getResources();
		for (const resource of ["food", "wood", "stone", "metal"])
			if ((Number(bank[resource]) || 0) < (Number(selected.cost[resource]) || 0) + (Number(reserve[resource]) || 0))
				return false;
		const queuedCivilians = queues.villager ? queues.villager.countQueuedUnits() : 0;
		const queuedSoldiers = queues.citizenSoldier ? queues.citizenSoldier.countQueuedUnits() : 0;
		const free = gameState.getPopulationLimit() - this.HQ.getAccountedPopulation(gameState) -
			queuedCivilians - queuedSoldiers;
		if (free < 2)
			return false;
		const plan = new TrainingPlan(gameState, selected.type, {
			"role": Worker.ROLE_ATTACK, "base": 0, "plan": -1, "trainer": trainer.id(),
			"expertDecisionLayer": true, "expertDecisionTraining": "special",
			"expertDecisionMilitary": true, "expertDecisionSpecial": label
		}, 1, 1);
		if (!plan)
			return false;
		queues.citizenSoldier.addPlan(plan);
		gameState.ai.queueManager.changePriority("citizenSoldier",
			Math.max(this.HQ.Config.priorities.citizenSoldier || 1, label.includes("hero") ? 975 : 955));
		aiWarn("[EXPERT-ATHENS] queued " + label + "=" + selected.type + " trainer=" + trainer.id());
		return true;
	}

	trainAthenianSpecialUnits(gameState, queues)
	{
		if (gameState.getPlayerCiv() !== "athen" || !gameState.currentPhase || !queues || !queues.citizenSoldier)
			return;
		const phase = gameState.currentPhase();
		if (phase < 2)
			return;
		const policy = mergePolicy();
		const enemyPop = this.lowestEnemyPopulation(gameState);
		if (Number.isFinite(enemyPop) && enemyPop <= policy.expertCCExecutionEnemyPopulation)
			return;
		const heroAlive = [...gameState.getOwnUnits().values()].some(ent => ent && hasClass(ent, "Hero"));
		const heroQueued = heroAlive || this.hasQueuedHero(gameState);
		const now = Number(gameState.ai.elapsedTime) || 0;

		// P2 Forge-Tech Push gets a deliberate Hippocrates option if the current CWA
		// Temple exposes him. This preserves the user's liked healer-support behavior
		// without inventing a trainable unit on civ versions that do not offer it.
		if (!heroQueued && phase === 2 && this.ensureStrategicDoctrine(gameState).id === "p2_tech_push" &&
		    now >= policy.athensHippocratesMinimumTime)
		{
			for (const temple of this.builtByClass(gameState, "Temple").sort((a, b) => a.id() - b.id()))
			{
				const healers = this.specialTrainableCandidates(gameState, temple, (template, type) =>
					template.hasClasses(["Hero"]) &&
					(template.hasClasses(["Healer"]) || String(type).toLowerCase().includes("hippocr")));
				if (!healers.length)
					continue;
				healers.sort((a, b) => (a.cost.food + a.cost.wood + a.cost.stone + a.cost.metal) -
					(b.cost.food + b.cost.wood + b.cost.stone + b.cost.metal));
				if (this.queueAthenianSpecialUnit(gameState, queues, temple, healers[0], "p2-healer-hero",
					{ food: 300, wood: 250, metal: 150 }))
					return;
			}
		}

		// Gymnasium champions are a supplement, not the new army backbone. Dynamically
		// inspect the current CWA trainer roster: if an Epilektoi/champion spearman is
		// exposed here, prefer enough melee champions to reinforce the screen; otherwise
		// use only a few ranged Gastraphetes/javelineer champions and stop.
		const gymType = gameState.applyCiv("structures/{civ}/gymnasium");
		for (const gym of this.structuresByTemplate(gameState, gymType).sort((a, b) => a.id() - b.id()))
		{
			if (this.trainerHasExpertSoldierWork(queues, gym))
				continue;
			const candidates = this.specialTrainableCandidates(gameState, gym, template =>
				template.hasClasses(["Champion"]) && template.hasClasses(["Infantry"]));
			if (!candidates.length)
				continue;
			for (const c of candidates)
			{
				c.melee = c.template.hasClasses(["Melee"]);
				c.ranged = c.template.hasClasses(["Ranged"]);
				c.spear = c.template.hasClasses(["Spearman"]) || c.template.hasClasses(["Hoplite"]) ||
					/\/champion_infantry$/.test(c.type);
				c.crossbow = c.template.hasClasses(["Crossbowman"]) || String(c.type).toLowerCase().includes("crossbow");
				c.javelineer = c.template.hasClasses(["Javelineer"]) || String(c.type).toLowerCase().includes("javelineer");
			}
			const types = new Set(candidates.map(c => c.type));
			let existing = 0, melee = 0, ranged = 0, crossbows = 0;
			for (const ent of gameState.getOwnUnits().values())
			{
				if (!ent || !ent.templateName || !types.has(ent.templateName()))
					continue;
				++existing;
				if (hasClass(ent, "Melee")) ++melee;
				if (hasClass(ent, "Ranged")) ++ranged;
				if (hasClass(ent, "Crossbowman") || String(ent.templateName()).toLowerCase().includes("crossbow")) ++crossbows;
			}
			for (const plan of queues.citizenSoldier.plans || [])
				if (plan && types.has(plan.type))
				{
					++existing;
					const c = candidates.find(item => item.type === plan.type);
					if (c && c.melee) ++melee;
					if (c && c.ranged) ++ranged;
					if (c && c.crossbow) ++crossbows;
				}
			const meleeCandidates = candidates.filter(c => c.melee);
			let target = phase >= 3 ? policy.athensGymnasiumP3ChampionTarget : policy.athensGymnasiumP2ChampionTarget;
			if (!meleeCandidates.length)
				target = Math.min(target, policy.athensGymnasiumRangedCapWithoutMelee);
			if (existing >= target)
				break;

			const oneCost = c => c.cost.food + c.cost.wood + 2*c.cost.stone + 2*c.cost.metal;
			let preferred = [];
			const currentMeleeShare = existing > 0 ? melee / existing : 0;
			if (meleeCandidates.length && currentMeleeShare < policy.athensMeleeShare)
				preferred = meleeCandidates.filter(c => c.spear).length ?
					meleeCandidates.filter(c => c.spear) : meleeCandidates;
			else if (crossbows < policy.athensGymnasiumCrossbowTarget && candidates.some(c => c.crossbow))
				preferred = candidates.filter(c => c.crossbow);
			else if (candidates.some(c => c.ranged))
				preferred = candidates.filter(c => c.ranged);
			else
				preferred = candidates;
			preferred.sort((a, b) => oneCost(a) - oneCost(b) || a.type.localeCompare(b.type));
			const selected = preferred[0];
			if (this.queueAthenianSpecialUnit(gameState, queues, gym, selected, "gymnasium-champion",
				{ food: 300, wood: 300, metal: 125 }))
				return;
		}

		// City Phase: build/use the Prytaneion for Iphicrates when no hero is alive or
		// already queued. If Hippocrates survived the P2 push, keep him rather than
		// suiciding a useful support hero merely to switch names.
		if (phase >= 3 && ![...gameState.getOwnUnits().values()].some(ent => ent && hasClass(ent, "Hero")) &&
		    !this.hasQueuedHero(gameState))
		{
			const pryType = gameState.applyCiv("structures/{civ}/prytaneion");
			for (const pry of this.structuresByTemplate(gameState, pryType).sort((a, b) => a.id() - b.id()))
			{
				const heroes = this.specialTrainableCandidates(gameState, pry, (template, type) =>
					template.hasClasses(["Hero"]) && String(type).toLowerCase().includes("iphicrates"));
				if (!heroes.length)
					continue;
				heroes.sort((a, b) => a.type.localeCompare(b.type));
				if (this.queueAthenianSpecialUnit(gameState, queues, pry, heroes[0], "p3-hero-iphicrates",
					{ food: 300, wood: 300, metal: 150 }))
					return;
			}
		}
	}

	alternativeWoodWorksiteExists(gameState, accessIndex)
	{
		return !!this.findHealthyAlternativeWoodWorksite(gameState, accessIndex,
			this.primaryWoodWorksite && this.primaryWoodWorksite.entityId);
	}

	selectInfantrySoldier(gameState, trainer, source = "barracks", resourceBudget = undefined)
	{
		if (!trainer || !trainer.trainableEntities)
			return undefined;
		const candidates = [];
		for (const type of trainer.trainableEntities(gameState.getPlayerCiv()) || [])
		{
			if (gameState.isTemplateDisabled(type))
				continue;
			const template = gameState.getTemplate(type);
			if (!template || !template.available(gameState) || !template.hasClasses(["Infantry+CitizenSoldier"]))
				continue;
			const cost = template.cost(trainer);
			const food = Number(cost && cost.food) || 0;
			const wood = Number(cost && cost.wood) || 0;
			const stone = Number(cost && cost.stone) || 0;
			const metal = Number(cost && cost.metal) || 0;
			const melee = !!template.hasClasses(["Melee"]);
			const ranged = !!template.hasClasses(["Ranged"]);
			const hoplite = !!template.hasClasses(["Hoplite"]);
			const javelineer = !!template.hasClasses(["Javelineer"]);
			const slinger = !!template.hasClasses(["Slinger"]) || String(type).includes("slinger");
			const swordsman = !!template.hasClasses(["Swordsman"]) || String(type).includes("/infantry_swordsman_");
			const speed = typeof template.walkSpeed === "function" ? Number(template.walkSpeed()) || 0 : 0;
			const costScore = (stone + metal) * 20 + food + wood;
			candidates.push({ type, template, cost: { food, wood, stone, metal }, melee, ranged, hoplite, javelineer, slinger, swordsman, speed, costScore });
		}
		if (!candidates.length)
			return undefined;

		const cheapest = list => [...list].sort((a, b) => a.costScore - b.costScore || b.speed - a.speed || a.type.localeCompare(b.type))[0];
		const canAffordOne = candidate => !resourceBudget ||
			((Number(resourceBudget.food) || 0) >= candidate.cost.food &&
			 (Number(resourceBudget.wood) || 0) >= candidate.cost.wood &&
			 (Number(resourceBudget.stone) || 0) >= candidate.cost.stone &&
			 (Number(resourceBudget.metal) || 0) >= candidate.cost.metal);
		const affordable = list => list.filter(canAffordOne);
		const chooseAffordable = (preferred, fallback = candidates) =>
		{
			const preferredAffordable = affordable(preferred);
			if (preferredAffordable.length)
				return cheapest(preferredAffordable);
			const fallbackAffordable = affordable(fallback);
			if (fallbackAffordable.length)
				return cheapest(fallbackAffordable);
			return preferred.length ? cheapest(preferred) : cheapest(fallback);
		};
		const ranged = candidates.filter(c => c.ranged);
		const melee = candidates.filter(c => c.melee);
		const bankWood = Number(gameState.getResources().wood) || 0;
		const woodPressure = gameState.getPlayerCiv() === "athen" &&
			(this.phaseWoodCrisis || this.woodIncomeStalled || bankWood <= (Number(mergePolicy().athensSlingerLowWood) || 300));

		// Replay preference: the first deliberate military pulse is mobile ranged infantry
		// (Athens = javeliners), useful for fast building/gathering while the army masses.
		if ((source === "cc-opening" || source === "barracks-opening") && ranged.length)
		{
			const javs = ranged.filter(c => c.javelineer);
			return chooseAffordable(javs.length ? javs : ranged, candidates);
		}

		let meleeCount = 0, rangedCount = 0, hopliteCount = 0, swordsmanCount = 0;
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !hasClass(ent, "Infantry") || !hasClass(ent, "CitizenSoldier") || hasClass(ent, "Cavalry"))
				continue;
			if (hasClass(ent, "Melee"))
			{
				++meleeCount;
				if (hasClass(ent, "Hoplite"))
					++hopliteCount;
				if (hasClass(ent, "Swordsman"))
					++swordsmanCount;
			}
			if (hasClass(ent, "Ranged"))
				++rangedCount;
		}
		const policy = mergePolicy();
		const targetMeleeShare = gameState.getPlayerCiv() === "athen" ?
			(Number(policy.athensMeleeShare) || 0.58) :
			(this.isCityStateCiv(gameState) ? policy.cityStateMeleeShare : policy.genericMeleeShare);
		const total = meleeCount + rangedCount;
		const currentMeleeShare = total > 0 ? meleeCount / total : 0;
		const wantMelee = melee.length && (!ranged.length || currentMeleeShare < targetMeleeShare);

		if (wantMelee)
		{
			// IT14.48 Athens: keep Hoplites the majority of the melee line, but let Marines
			// appear organically when available. This is a preference, never a production gate.
			if (gameState.getPlayerCiv() === "athen" && String(source).startsWith("barracks"))
			{
				const hoplites = melee.filter(c => c.hoplite);
				const marines = melee.filter(c => c.swordsman);
				const meleeRoleTotal = hopliteCount + swordsmanCount;
				const marineShare = meleeRoleTotal > 0 ? swordsmanCount / meleeRoleTotal : 0;
				const targetMarineShare = Number(policy.athensMarineShareOfMelee) || 0.30;
				if (marines.length && marineShare < targetMarineShare)
					return chooseAffordable(marines, hoplites.length ? hoplites : melee);
				if (hoplites.length)
					return chooseAffordable(hoplites, marines.length ? marines : melee);
			}
			return chooseAffordable(melee, candidates);
		}
		if (ranged.length)
		{
			if (woodPressure)
			{
				const slingers = ranged.filter(c => c.slinger);
				const minWood = Math.min(...ranged.map(c => c.cost.wood));
				const woodLight = ranged.filter(c => c.cost.wood === minWood);
				return chooseAffordable(slingers.length ? slingers : woodLight, ranged);
			}
			return chooseAffordable(ranged, melee.length ? melee : candidates);
		}
		return chooseAffordable(candidates, candidates);
	}
	expertSoldierWorkCount(queues, trainer)
	{
		if (!trainer)
			return Infinity;
		let count = 0;
		for (const item of trainer.trainingQueue ? trainer.trainingQueue() || [] : [])
			if (item.metadata && (item.metadata.expertDecisionTraining === "soldier" || item.metadata.expertDecisionMilitary === true))
				++count;
		const queue = queues && queues.citizenSoldier;
		if (!queue || !Array.isArray(queue.plans))
			return count;
		for (const plan of queue.plans)
			if (plan && plan.metadata &&
			    (plan.metadata.expertDecisionTraining === "soldier" || plan.metadata.expertDecisionMilitary === true) &&
			    Number(plan.metadata.trainer) === trainer.id())
				++count;
		return count;
	}

	trainerHasExpertSoldierWork(queues, trainer)
	{
		return this.expertSoldierWorkCount(queues, trainer) > 0;
	}

	queueExpertSoldierBatch(gameState, queues, trainer, source, requestedBatch = 2, maxWorkDepth = 1)
	{
		if (!queues || !queues.citizenSoldier || !trainer ||
		    this.expertSoldierWorkCount(queues, trainer) >= Math.max(1, Math.floor(Number(maxWorkDepth) || 1)))
			return false;

		const policy = mergePolicy();
		const workers = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		// Before the civilian cap, leave one modest food reserve so the CC can resume
		// civilians after a military pulse. At the cap the CC may join military production.
		const reserve = workers.civilians >= this.currentCivilianCap(gameState) ? 0 : policy.soldierFoodReserve;
		const resources = gameState.getResources();
		const protectWood = this.phaseWoodCrisis ||
			(gameState.getPlayerCiv() === "athen" && this.woodIncomeStalled &&
			 (Number(resources.wood) || 0) <= (Number(policy.athensSlingerLowWood) || 300));
		const resourceBudget = {
			"food": Math.max(0, (Number(resources.food) || 0) - reserve),
			"wood": protectWood ? 0 : (Number(resources.wood) || 0),
			"stone": Number(resources.stone) || 0,
			"metal": Number(resources.metal) || 0
		};
		const selected = this.selectInfantrySoldier(gameState, trainer, source, resourceBudget);
		if (!selected)
			return false;

		const queuedCivilians = queues.villager ? queues.villager.countQueuedUnits() : 0;
		const queuedSoldiers = queues.citizenSoldier ? queues.citizenSoldier.countQueuedUnits() : 0;
		const free = gameState.getPopulationLimit() - this.HQ.getAccountedPopulation(gameState) - queuedCivilians - queuedSoldiers;
		const doctrineBatch = Number.isFinite(Number(selected.recommendedBatch)) ?
			Math.max(1, Math.floor(Number(selected.recommendedBatch))) : Math.floor(requestedBatch);
		let batch = Math.max(0, Math.min(Math.floor(requestedBatch), doctrineBatch, free));
		if (batch <= 0)
			return false;

		// IT14.35: do not idle a trainer merely because the preferred 2/3/4-unit batch
		// is one unit too expensive. Shrink to the largest affordable batch first.
		while (batch > 0 && ((Number(resourceBudget.food) || 0) < selected.cost.food * batch ||
		    (Number(resourceBudget.wood) || 0) < selected.cost.wood * batch ||
		    (Number(resourceBudget.stone) || 0) < selected.cost.stone * batch ||
		    (Number(resourceBudget.metal) || 0) < selected.cost.metal * batch))
			--batch;
		if (batch <= 0)
			return false;

		const plan = new TrainingPlan(gameState, selected.type, {
			// Replay contract: citizen soldiers are BOTH the growing army and productive
			// lumberjacks. Expert owns them as workers until defense/attack claims them.
			"role": Worker.ROLE_WORKER, "base": 0, "plan": -1, "trainer": trainer.id(),
			"expertDecisionLayer": true, "expertDecisionTraining": "soldier",
			"expertDecisionCitizenSoldierWood": true, "expertDecisionSource": source
		}, batch, batch);
		if (!plan)
			return false;
		queues.citizenSoldier.addPlan(plan);
		gameState.ai.queueManager.changePriority("citizenSoldier", Math.max(this.HQ.Config.priorities.citizenSoldier || 1, 950));
		aiWarn("[EXPERT-MIL] queued " + source + " soldiers=" + selected.type + " batch=" + batch + " trainer=" + trainer.id() +
			" depth=" + (this.expertSoldierWorkCount(queues, trainer)) + "/" + Math.max(1, Math.floor(Number(maxWorkDepth) || 1)) +
			(protectWood && selected.slinger && selected.cost.wood <= 0 ? " mode=low-wood-slinger" : ""));
		return true;
	}

	trainExpertMilitary(gameState, queues, cc)
	{
		const policy = mergePolicy(this.strategyPolicyOverrides(gameState));
		if (gameState.ai.elapsedTime < policy.soldierTrainingStartTime || !queues || !queues.citizenSoldier)
			return;
		const workers = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		const atCivilianCap = workers.civilians >= policy.civilianCap;

		// Expert keeps the CC on civilians continuously until 70. Barracks carry all
		// early military production; only at the civilian cap does the CC join them.
		if (cc && atCivilianCap)
			this.queueExpertSoldierBatch(gameState, queues, cc, "cc-cap", policy.soldierTrainingBatch);

		// Every completed barracks is a production building, not decoration. IT14.48
		// designates the oldest barracks as a "production floor": one-unit batches and a
		// standing queue depth of two (current + one next) emulate auto-queue without
		// handing control back to Petra. Other barracks remain opportunistic/manual and
		// may use larger batches when the bank supports them.
		const food = Number(gameState.getResources().food) || 0;
		const militaryBatch = food >= 1600 ? 4 : food >= 900 ? 3 : policy.soldierTrainingBatch;
		const barracksList = this.builtByClass(gameState, "Barracks").sort((a, b) => a.id() - b.id());
		const anchorId = barracksList.length ? barracksList[0].id() : undefined;
		for (const barracks of barracksList)
		{
			const now = Number(gameState.ai.elapsedTime) || 0;
			const workDepth = this.expertSoldierWorkCount(queues, barracks);
			const busy = workDepth > 0;
			if (busy)
				delete this.trainerIdleSince[barracks.id()];
			else if (!Number.isFinite(Number(this.trainerIdleSince[barracks.id()])))
				this.trainerIdleSince[barracks.id()] = now;

			const isAnchor = barracks.id() === anchorId;
			const source = this.firstBarracksSoldierBatchQueued ? (isAnchor ? "barracks-auto" : "barracks") : "barracks-opening";
			const requested = isAnchor && this.firstBarracksSoldierBatchQueued ? 1 : militaryBatch;
			const depth = isAnchor && this.firstBarracksSoldierBatchQueued ? 2 : 1;
			if (this.queueExpertSoldierBatch(gameState, queues, barracks, source, requested, depth))
			{
				const since = Number(this.trainerIdleSince[barracks.id()]);
				const gap = Number.isFinite(since) ? now - since : 0;
				if (gap > 2)
					aiWarn("[EXPERT-TRAIN] trainer-gap trainer=" + barracks.id() + " seconds=" + gap.toFixed(1));
				if (isAnchor && this.firstBarracksSoldierBatchQueued)
					aiWarn("[EXPERT-TRAIN] auto-queue anchor=" + barracks.id() + " depth=" +
						this.expertSoldierWorkCount(queues, barracks) + "/2");
				delete this.trainerIdleSince[barracks.id()];
				if (source === "barracks-opening")
					this.firstBarracksSoldierBatchQueued = true;
			}
		}
	}

	trainingExecution(gameState, cc)
	{
		const template = this.HQ.findBestTrainableUnit(gameState, ["Support+Worker"], [["costsResource", 1, "food"]]);
		if (!template || !cc)
			return undefined;
		return {
			"template": template,
			"trainerId": cc.id(),
			"metadata": { "role": Worker.ROLE_WORKER, "base": 0, "support": true }
		};
	}

	newTaskId(kind)
	{
		this.taskCounters[kind] = Number(this.taskCounters[kind] || 0) + 1;
		return `expert:${kind}:${this.taskCounters[kind]}`;
	}

	fieldRequestAt(gameState, farmPosition, farmsteadId, hubKind = "farmstead")
	{
		const geometry = readTemplateGeometry(gameState, "field");
		const farmGeom = readTemplateGeometry(gameState, hubKind);
		const failures = Number(this.fieldPlacementFailures[farmsteadId] || 0);
		return {
			"kind": "field",
			"anchor": farmPosition,
			"farmsteadId": farmsteadId,
			"foodHubId": farmsteadId,
			"foodHubKind": hubKind,
			"anchorHalfExtents": farmGeom.halfExtents || { "width": farmGeom.radius, "depth": farmGeom.radius },
			"templateHalfExtents": geometry.halfExtents || { "width": geometry.radius, "depth": geometry.radius },
			"templateRadius": geometry.radius,
			"gap": 0.0,
			"gaps": failures >= 3 ? [0.0, 0.25, 0.5, 0.75, 1.0, 1.25] : [0.0, 0.25, 0.5, 0.75],
			"maxBorderGap": failures >= 3 ? 1.30 : 0.80,
			"edgeSamples": 15
		};
	}

	fieldSlotsAt(gameState, farmPosition, farmsteadId, accessIndex, shared = undefined, slotLimit = undefined, maxBorderGapOverride = undefined, hubKind = "farmstead")
	{
		if (!Array.isArray(farmPosition))
			return [];
		const policy = mergePolicy();
		const request = this.fieldRequestAt(gameState, farmPosition, farmsteadId, hubKind);
		if (Number.isFinite(Number(maxBorderGapOverride)))
		{
			const limit = Math.max(0, Number(maxBorderGapOverride));
			request.maxBorderGap = limit;
			request.gaps = [];
			const step = limit <= 1.5 ? 0.25 : 0.5;
			for (let gap = 0; gap <= limit + 0.001; gap += step)
				request.gaps.push(Number(gap.toFixed(2)));
			if (limit > 4.0)
				request.allowWideTangents = true;
		}
		const fieldGeom = shared && shared.fieldGeom || readTemplateGeometry(gameState, "field");
		const farmGeom = shared && shared.hubGeomByKind && shared.hubGeomByKind[hubKind] ||
			readTemplateGeometry(gameState, hubKind);
		const ports = shared && shared.ports || createPetraPlacementPorts(gameState, "field", {
			"HQ": this.HQ,
			"createObstructionMap": createObstructionMap,
			"accessIndex": accessIndex
		});
		const candidates = generatePlacementCandidates(request);
		const fieldHalf = request.templateHalfExtents;
		const farmHalf = request.anchorHalfExtents;
		const nominal = Math.max(
			Number(farmHalf.width) + Number(fieldHalf.width),
			Number(farmHalf.depth) + Number(fieldHalf.depth)
		);
		const minCenterDistance = Math.max(8, nominal - 3);
		const maxCenterDistance = nominal + Math.max(7, request.allowWideTangents ? Number(request.maxBorderGap || 0) + 8 : 7);
		const minSeparation = Math.max(16, 1.8 * Math.max(Number(fieldHalf.width), Number(fieldHalf.depth)));
		const blockedPositions = [
			...this.builtByClass(gameState, "Field").map(ent => ent.position()),
			...this.foundationsByClass(gameState, "Field").map(ent => ent.position()),
			...Object.values(this.pendingFieldPositions).filter(Array.isArray)
		];
		const selected = [];
		const maximumSlots = Math.max(1, Math.floor(Number(slotLimit) || policy.fieldsPerFarmstead));
		for (const candidate of candidates)
		{
			const snapped = ports.snapToLegalPosition(candidate, request);
			if (!snapped || !Array.isArray(snapped) || snapped.length < 2)
				continue;
			const position = [Number(snapped[0]), Number(snapped[1])];
			if (!position.every(Number.isFinite))
				continue;
			if (this.HQ.territoryMap.getOwner(position) !== PlayerID ||
			    gameState.ai.accessibility.getAccessValue(position) !== accessIndex)
				continue;
			if (ports.isDangerous && ports.isDangerous(position, fieldGeom.radius, request))
				continue;
			const centerDistance = Math.sqrt(SquareVectorDistance(position, farmPosition));
			if (centerDistance < minCenterDistance || centerDistance > maxCenterDistance)
				continue;
			// Live capacity must use the SAME border-gap limit as real placement after
			// obstruction-map snapping. Otherwise the planner sees phantom field slots
			// that the actual resolver immediately rejects.
			const dx = Math.abs(position[0] - farmPosition[0]);
			const dz = Math.abs(position[1] - farmPosition[1]);
			const gapX = Math.max(0, dx - (Number(farmHalf.width) + Number(fieldHalf.width)));
			const gapZ = Math.max(0, dz - (Number(farmHalf.depth) + Number(fieldHalf.depth)));
			const maxBorderGap = Number.isFinite(Number(request.maxBorderGap)) ? Number(request.maxBorderGap) : 0.80;
			if (Math.hypot(gapX, gapZ) > maxBorderGap)
				continue;
			if (blockedPositions.some(pos => Array.isArray(pos) && SquareVectorDistance(position, pos) < minSeparation * minSeparation))
				continue;
			if (selected.some(pos => SquareVectorDistance(position, pos) < minSeparation * minSeparation))
				continue;
			selected.push(position);
			if (selected.length >= maximumSlots)
				break;
		}
		return selected;
	}

	farmCapacitySnapshot(gameState, accessIndex)
	{
		const policy = mergePolicy();
		const farms = this.builtByClass(gameState, "Farmstead");
		// IT14.46: fields belong to farmsteads. Markets may accept food, but treating them
		// as farm hubs created isolated fields with no coherent permanent-food district.
		const foodHubs = farms.map(farm => ({ "entity": farm, "kind": "farmstead" }));
		const committedFields = this.builtByClass(gameState, "Field").length + this.activeFieldTasks.length;
		if (!foodHubs.length)
			return { "known": true, "supportedFieldSlots": committedFields, "openFieldSlots": 0, "hubs": [] };
		let shared;
		try
		{
			const hubGeomByKind = { "farmstead": readTemplateGeometry(gameState, "farmstead") };
			shared = {
				"ports": createPetraPlacementPorts(gameState, "field", {
					"HQ": this.HQ,
					"createObstructionMap": createObstructionMap,
					"accessIndex": accessIndex
				}),
				"fieldGeom": readTemplateGeometry(gameState, "field"),
				"hubGeomByKind": hubGeomByKind
			};
		}
		catch (e)
		{
			return { "known": false, "supportedFieldSlots": committedFields, "openFieldSlots": 0, "hubs": [] };
		}
		const hubs = [];
		let openFieldSlots = 0;
		let maxSaturatedHubFields = 0;
		const builtFields = this.builtByClass(gameState, "Field");

		// IT14.27: a field belongs to its NEAREST farmstead for capacity accounting.
		// The old 42m-radius count could credit the same field to two nearby food districts,
		// making both hubs appear more saturated than they really were.
		const fieldHome = new Map();
		for (const field of builtFields)
		{
			if (!entityPosition(field))
				continue;
			let bestHub;
			let bestDistance = Infinity;
			for (const candidate of foodHubs)
			{
				const candidateHub = candidate.entity;
				if (!entityPosition(candidateHub))
					continue;
				const distance = SquareVectorDistance(field.position(), candidateHub.position());
				if (distance < bestDistance)
				{
					bestDistance = distance;
					bestHub = candidateHub;
				}
			}
			if (bestHub && bestDistance <= 60*60)
				fieldHome.set(field.id(), bestHub.id());
		}
		for (const descriptor of foodHubs)
		{
			const farm = descriptor.entity;
			const hubKind = descriptor.kind;
			const builtFieldCount = builtFields.filter(field => fieldHome.get(field.id()) === farm.id()).length;
			let slots = this.fieldSlotsAt(gameState, farm.position(), farm.id(), accessIndex, shared, undefined, undefined, hubKind);
			let fieldGapLimit = this.fieldRequestAt(gameState, farm.position(), farm.id(), hubKind).maxBorderGap;
			// Dedicated farm hubs still prefer near-touching fields. Existing natural-food
			// dropsites, however, must be reusable after their berries/fruit disappear.
			// Probe progressively wider but still-local rings before declaring the district full.
			if (!slots.length)
			{
				slots = this.fieldSlotsAt(gameState, farm.position(), farm.id(), accessIndex, shared, undefined, 1.30, hubKind);
				if (slots.length)
					fieldGapLimit = 1.30;
			}
			if (!slots.length)
			{
				slots = this.fieldSlotsAt(gameState, farm.position(), farm.id(), accessIndex, shared, undefined, 2.00, hubKind);
				if (slots.length)
					fieldGapLimit = 2.00;
			}
			if (!slots.length && builtFieldCount < policy.fieldsPerFarmstead)
			{
				const reuseGap = Math.max(2.0, Number(policy.existingFarmsteadReuseMaxBorderGap) || 4.0);
				slots = this.fieldSlotsAt(gameState, farm.position(), farm.id(), accessIndex, shared,
					Math.max(1, policy.fieldsPerFarmstead - builtFieldCount), reuseGap, hubKind);
				if (slots.length)
					fieldGapLimit = reuseGap;
			}
			// IT14.30: if the normal compact/reuse ring is geometrically blocked but the hub
			// still has fewer than four fields, probe the nearby corner/fill-in space before
			// declaring it saturated and paying for another farmstead.
			if (!slots.length && builtFieldCount < policy.fieldsPerFarmstead)
			{
				const fillGap = Math.max(Number(policy.existingFarmsteadReuseMaxBorderGap) || 4.0,
					Number(policy.existingFarmsteadFillInMaxBorderGap) || 10.0);
				slots = this.fieldSlotsAt(gameState, farm.position(), farm.id(), accessIndex, shared,
					Math.max(1, policy.fieldsPerFarmstead - builtFieldCount), fillGap, hubKind);
				if (slots.length)
					fieldGapLimit = fillGap;
			}
			let homeDemand = 0;
			if (hubKind === "farmstead")
				for (const worker of gameState.getOwnUnits().values())
				{
					if (!worker || !worker.getMetadata || !hasClass(worker, "Civilian") || hasClass(worker, "CitizenSoldier"))
						continue;
					if (Number(worker.getMetadata(PlayerID, FOOD_HOME_FARMSTEAD)) !== farm.id())
						continue;
					const lock = Number(worker.getMetadata(PlayerID, FARM_LOCK));
					if (!Number.isFinite(lock))
						++homeDemand;
				}
			hubs.push({ "farm": farm, "hubKind": hubKind, "slots": slots, "builtFieldCount": builtFieldCount, fieldGapLimit, homeDemand });
			openFieldSlots += slots.length;
			if (!slots.length)
				maxSaturatedHubFields = Math.max(maxSaturatedHubFields, builtFieldCount);
		}
		return {
			"known": true,
			"supportedFieldSlots": committedFields + openFieldSlots,
			"openFieldSlots": openFieldSlots,
			"maxSaturatedHubFields": maxSaturatedHubFields,
			"hubs": hubs
		};
	}

	farmsteadForNextField(gameState, accessIndex, offset = 0)
	{
		const snapshot = this.farmCapacitySnapshot(gameState, accessIndex);
		const usable = snapshot.hubs.filter(hub => hub.slots.length);
		if (!usable.length)
			return undefined;
		usable.sort((a, b) => {
			// A natural-food district with stranded home workers gets first claim on the
			// next field. Otherwise preserve the compact-farm preference from IT14.21.
			const da = Number(a.homeDemand) || 0;
			const db = Number(b.homeDemand) || 0;
			const ca = Number(a.builtFieldCount) || 0;
			const cb = Number(b.builtFieldCount) || 0;
			return db - da || cb - ca || b.farm.id() - a.farm.id() || b.slots.length - a.slots.length;
		});
		// Re-evaluate after each field is prepared. pendingFieldPositions immediately
		// removes the chosen slot, so capacity_2/3 can safely keep filling the same hub
		// until it is actually full instead of artificially fanning across farmsteads.
		return usable[0];
	}

	placementRequest(gameState, action, cc, accessIndex, foodObservation)
	{
		const kind = action.kind;
		const placementFailureKey = kind + ":" + (action.role || "primary");
		const placementFailures = Number(this.placementFailureCounts[placementFailureKey] || 0);
		const strategicFallback = placementFailures >= mergePolicy().strategicPlacementFallbackAfterFailures &&
			(kind === "barracks" || kind === "forge" || kind === "market" || kind === "temple" || kind === "arsenal" || kind === "gymnasium" || kind === "prytaneion");
		const taskId = kind === "field" ? this.newTaskId(kind) : (this.activeTaskByKind[kind] || this.newTaskId(kind));
		let request;
		const geometry = readTemplateGeometry(gameState, kind);
		if (kind === "storehouse" && (action.role || "primary") === "primary" &&
		    this.builtByClass(gameState, "Storehouse").length === 0)
		{
			if (!this.initialWoodSelection || !this.initialWoodSelection.position)
				return undefined;
			request = makeInitialStorehousePlacementRequest(this.initialWoodSelection, geometry.radius,
				{ "distances": [0, 4, 8, 12], "angleCount": 16 });
		}
		else if (kind === "storehouse" && action.role === "resource_service")
		{
			const anchor = Array.isArray(action.resourceAnchor) ? action.resourceAnchor : cc.position();
			const sourceIds = Array.isArray(action.resourceSourceIds) ? action.resourceSourceIds : [];
			const sources = sourceIds.map(id => gameState.getEntityById(Number(id))).filter(ent => ent && entityPosition(ent));
			const candidates = [];
			for (const source of sources.length ? sources : [{ position: () => anchor }])
				candidates.push(...generatePlacementCandidates({
					"kind": "storehouse", "anchor": source.position(), "toward": cc.position(),
					"distances": [Math.max(3, geometry.radius + 0.5), geometry.radius + 1.5, geometry.radius + 2.5, geometry.radius + 4.0, geometry.radius + 6.0],
					"angleCount": 32, "templateRadius": geometry.radius
				}));
			request = {
				kind, "role": "resource_service", "templateRadius": geometry.radius, candidates,
				"resourceService": true, "resourceGeneric": action.resourceGeneric,
				"pathSources": sources.map(source => source.position()),
				"worksiteAnchor": anchor, "minimumCCDistance": 0,
				"resourceSourceIds": sourceIds
			};
		}
		else if (kind === "storehouse")
		{
			const policy = mergePolicy();
			const current = this.getPrimaryWoodPosition(gameState) || cc.position();
			const currentId = this.primaryWoodWorksite && this.primaryWoodWorksite.entityId;
			const localWorkers = this.woodWorkersForWorksite(gameState, currentId);
			const workerAnchor = centerOf(localWorkers) || this.dominantWoodBuilderCenter(gameState) || current;

			// Identify the actual connected forest around the current dropsite. IT14.9
			// incorrectly summed every tree in a wide circle and called it one patch.
			const nearby = collectInitialWoodCandidates(gameState, {
				"getLandAccess": getLandAccess, "isSupplyFull": isSupplyFull,
				"territoryMap": this.HQ.territoryMap, "anchorPosition": current,
				"accessIndex": accessIndex, "playerId": PlayerID, "searchRadius": policy.woodClusterSearchRadius
			});
			const currentCluster = this.connectedWoodCluster(nearby, current, policy.woodClusterLinkDistance);
			const clusterIds = new Set(currentCluster.map(tree => tree.id));
			const samePatchAmount = this.woodAmount(currentCluster);
			const servingStores = Math.max(1, this.storehousesServingWoodCluster(gameState, currentCluster));
			const requiredWorkers = policy.woodDeepenMinimumWorkers + Math.max(0, servingStores - 1) * policy.woodDeepenExtraWorkersPerStorehouse;
			const requiredWood = policy.woodDeepenMinimumRemaining + Math.max(0, servingStores - 1) * policy.woodDeepenExtraRemainingPerStorehouse;
			let ranked = [];
			let mode = "new_patch";
			let improvement = 0;

			if (currentCluster.length && localWorkers.length >= requiredWorkers && samePatchAmount >= requiredWood)
			{
				const selection = selectInitialWoodWorksite(currentCluster, workerAnchor, { "radius": 30, "approachWeight": 5 });
				if (selection && selection.position)
				{
					improvement = this.weightedWoodDistance(currentCluster, current) - this.weightedWoodDistance(currentCluster, selection.position);
					if (improvement >= policy.woodDeepenMinimumDistanceImprovement)
					{
						ranked = (selection.ranked && selection.ranked.length ? selection.ranked : [selection])
							.filter(site => site && site.position && this.HQ.territoryMap.getOwner(site.position) === PlayerID &&
								SquareVectorDistance(site.position, current) >= policy.woodStorehouseMinimumSpacing * policy.woodStorehouseMinimumSpacing)
							.slice(0, 8);
						mode = ranked.length ? "deepen_patch" : mode;
					}
				}
			}

			if (!ranked.length)
			{
				const all = collectInitialWoodCandidates(gameState, {
					"getLandAccess": getLandAccess, "isSupplyFull": isSupplyFull,
					"territoryMap": this.HQ.territoryMap, "anchorPosition": workerAnchor,
					"accessIndex": accessIndex, "playerId": PlayerID, "searchRadius": 200
				}).filter(tree => !clusterIds.has(tree.id));
				const selection = selectInitialWoodWorksite(all, workerAnchor);
				if (!selection || !selection.position)
					return undefined;
				ranked = (selection.ranked && selection.ranked.length ? selection.ranked : [selection])
					.filter(site => site && site.position && this.HQ.territoryMap.getOwner(site.position) === PlayerID)
					.slice(0, 8);
			}

			const candidates = [];
			for (const site of ranked)
			{
				const local = initialStorehousePlacementCandidates({ "action": "SELECT_INITIAL_WOODSITE", ...site },
					{ "distances": [0, 4, 6, 8, 10, 12], "angleCount": 16 });
				const outer = initialStorehousePlacementCandidates({ "action": "SELECT_INITIAL_WOODSITE", ...site },
					{ "distances": [14, 18, 22, 26, 30], "angleCount": 32 });
				for (const candidate of [...local, ...outer])
					candidates.push(candidate);
			}
			if (!candidates.length)
				return undefined;
			request = {
				kind, "templateRadius": geometry.radius, candidates,
				"worksiteAnchor": ranked[0].position, "selectedTreeIds": [...(ranked[0].treeIds || [])],
				"minimumCCDistance": policy.storehouseMinimumCCDistance, "woodExpansionMode": mode
			};
			this.pendingWoodSelectionByTask[taskId] = { ...ranked[0], woodExpansionMode: mode };
			aiWarn("[EXPERT-WOOD] storehouse plan=" + mode + " connectedWood=" + Math.round(samePatchAmount) +
				" workers=" + localWorkers.length + " stores=" + servingStores + " improve=" + improvement.toFixed(1));
		}

		else if (kind === "farmstead")
		{
			let anchor = foodObservation.center || cc.position();
			let sourceIds = foodObservation.ids || [];
			if (action.role === "natural_expansion" || action.role === "wicker_branch" || action.role === "resource_service_food")
			{
				const foodContext = this.foodCaptureContext(gameState, cc, accessIndex);
				const alternative = action.role === "resource_service_food" && Array.isArray(action.resourceAnchor) ?
					{ "center": action.resourceAnchor, "ids": Array.isArray(action.resourceSourceIds) ? action.resourceSourceIds : [] } :
					action.role === "wicker_branch" ? this.postWickerBranchCluster :
					this.alternativeFoodInfo(gameState, foodContext, foodObservation).next;
				if (!alternative || !alternative.center)
					return undefined;
				anchor = alternative.center;
				sourceIds = alternative.ids;
				this.pendingFoodSelectionByTask[taskId] = alternative;
				const foodSources = sourceIds.map(id => gameState.getEntityById(Number(id))).filter(ent => ent && entityPosition(ent));
				const candidates = [];
				for (const source of foodSources)
					candidates.push(...generatePlacementCandidates({
						"kind": "farmstead", "anchor": source.position(), "toward": cc.position(),
						"distances": [Math.max(3, geometry.radius + 0.5), geometry.radius + 1.5, geometry.radius + 2.5, geometry.radius + 3.5],
						"angleCount": 24, "templateRadius": geometry.radius
					}));
				request = {
					kind, "candidates": candidates, "templateRadius": geometry.radius,
					"pathSources": this.foodPathSources(gameState, sourceIds),
					"naturalExpansionFood": true,
					"resourceServiceFood": action.role === "resource_service_food",
					// Natural-food farmsteads are dropsites first. Permanent farm hubs handle fields.
					"minimumFieldSlots": 0, "preferredFieldSlots": 0
				};
			}
			else if (this.builtByClass(gameState, "Farmstead").length === 0)
				request = {
					kind,
					anchor,
					"toward": cc.position(),
					// The OPENING farmstead is a berry dropsite first. Search right against the
					// cluster instead of sacrificing every gather trip for hypothetical fields.
					"distances": [0, 2, 4, 6, 8, 10, 12, 15, 18],
					"angleCount": 32,
					"templateRadius": geometry.radius,
					"pathSources": this.foodPathSources(gameState, sourceIds),
					"openingNaturalFood": true,
					// Future field room is only a preference for the opening dropsite. Permanent
					// farm hubs later are responsible for compact field blocks.
					"minimumFieldSlots": 0,
					"preferredFieldSlots": 1
				};
			else
			{
				// Permanent farm hubs are not chained to the exhausted berry patch.
				// Search a broad own-territory ring around the CC and require live legal
				// field capacity before accepting the hub.
				const failures = this.farmsteadPlacementFailures;
				const policy = mergePolicy();
				// IT14.29: four-field hubs remain the ideal. The IT14.28 replay proved that
				// keeping four as an absolute requirement can deadlock permanent food forever
				// (21 fields wanted, six built, thousands of rejected hub candidates). After
				// several real placement failures, accept a still-useful three-field hub.
				const constrainedOpeningHub = action.role === "farm_hub_constrained";
				const forcedDeadlockHub = action.role === "farm_hub_deadlock";
				const fallbackHub = constrainedOpeningHub || forcedDeadlockHub || failures >= policy.farmHubFallbackAfterFailures;
				const minimumFieldSlots = fallbackHub ?
					policy.minimumFarmHubFieldSlotsFallback : policy.minimumFarmHubFieldSlots;
				request = {
					kind,
					"role": action.role || "farm_hub",
					"anchor": cc.position(),
					"toward": anchor,
					// IT14.5 proved that a compact-ring-only search can deadlock permanent food.
					// Expand progressively into owned territory rather than rejecting candidates
					// forever while civilians idle. The 30m hub-spacing contract remains intact.
					"distances": failures >= 4 ?
						[24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 104, 112, 120, 128, 136, 144, 152] :
						[28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96],
					"angleCount": failures >= 4 ? 48 : 32,
					"templateRadius": geometry.radius,
					"minimumCCDistance": policy.farmHubMinimumCCDistance,
					"pathSources": [],
					"minimumFieldSlots": minimumFieldSlots,
					"preferredFieldSlots": Math.max(4, minimumFieldSlots),
					"compactFallback": fallbackHub
				};
			}
		}
		else if (kind === "house")
		{
			if (this.builtByClass(gameState, "House").length === 0)
			{
				const policy = mergePolicy();
				const ccPos = cc.position();
				const woodPos = this.getPrimaryWoodPosition(gameState) || [ccPos[0] + 1, ccPos[1]];
				const candidates = generatePlacementCandidates({
					"kind": "barracks", "anchor": ccPos, "toward": woodPos,
					"distances": [50, 54, 58, 62, 66, 70, 76, 82],
					"angleCount": 48, "templateRadius": geometry.radius
				});
				request = { kind, candidates, "templateRadius": geometry.radius,
					"minimumCCDistance": policy.independentBuildingMinimumCCDistance };
			}
			else
			{
				const policy = mergePolicy();
				const phase = typeof gameState.currentPhase === "function" ? Number(gameState.currentPhase()) || 1 : 1;
				const houses = this.builtByClass(gameState, "House").sort((a, b) => a.id() - b.id());
				const first = houses[0];
				const firstPos = first && entityPosition(first) ? first.position() : cc.position();
				const woodPos = this.getPrimaryWoodPosition(gameState) || [cc.position()[0] + 1, cc.position()[1]];

				// IT14.43: when farmers are the efficient temporary crew, put the house on the
				// outside of an existing farm district first. They can build it with almost no
				// travel and immediately return to their fields.
				const farmHouseCandidates = [];
				if (action.preferFarmDistrictHouse)
					for (const farm of this.builtByClass(gameState, "Farmstead").filter(ent => ent && entityPosition(ent)).slice(0, 6))
					{
						const pos = farm.position();
						let fdx = pos[0] - cc.position()[0], fdz = pos[1] - cc.position()[1];
						const flen = Math.hypot(fdx, fdz) || 1;
						const outwardFarm = [pos[0] + fdx / flen * 28, pos[1] + fdz / flen * 28];
						farmHouseCandidates.push(...generatePlacementCandidates({ "kind": "barracks", "anchor": pos, "toward": outwardFarm,
							"distances": [30, 34, 38, 42, 46], "angleCount": 20, "templateRadius": geometry.radius }));
					}

				if (phase >= 2)
				{
					// IT14.12 P2 housing: the P1 house line is a preference, not a prison.
					// Expand from the OUTER edges of already-developed work/military districts,
					// which also naturally lets houses push territory toward nearby resources.
					const ccPos = cc.position();
					const developed = [
						...houses,
						...this.builtByClass(gameState, "Barracks"),
						...this.builtByClass(gameState, "Storehouse")
					].filter(ent => ent && entityPosition(ent));
					developed.sort((a, b) => SquareVectorDistance(b.position(), ccPos) - SquareVectorDistance(a.position(), ccPos) || a.id() - b.id());
					const candidates = [...farmHouseCandidates];
					for (const anchorEnt of developed.slice(0, 8))
					{
						const pos = anchorEnt.position();
						let dx = pos[0] - ccPos[0], dz = pos[1] - ccPos[1];
						const len = Math.hypot(dx, dz) || 1;
						const outward = [pos[0] + dx / len * 20, pos[1] + dz / len * 20];
						candidates.push(...generatePlacementCandidates({
							"kind": "barracks", "anchor": pos, "toward": outward,
							"distances": [10, 14, 18, 22, 26, 30, policy.phase2HouseDistrictRadius],
							"angleCount": 24, "templateRadius": geometry.radius
						}));
					}
					const district = this.dominantWoodBuilderCenter(gameState) || woodPos;
					candidates.push(...generatePlacementCandidates({
						"kind": "barracks", "anchor": district, "toward": woodPos,
						"distances": [10, 14, 18, 22, 26, 30, 34], "angleCount": 32, "templateRadius": geometry.radius
					}));
					candidates.push(...generatePlacementCandidates({
						"kind": "barracks", "anchor": ccPos, "toward": woodPos,
						"distances": [28, 34, 40, 46, 52, 58, 64, 70, 76, 82, 88, policy.phase2HouseSearchMaximumDistance],
						"angleCount": 48, "templateRadius": geometry.radius
					}));
					const seen = new Set();
					const unique = candidates.filter(pos => {
						const key = pos[0].toFixed(2) + ":" + pos[1].toFixed(2);
						if (seen.has(key)) return false;
						seen.add(key); return true;
					});
					request = { kind, "candidates": unique, "templateRadius": geometry.radius,
						"minimumCCDistance": policy.independentBuildingMinimumCCDistance, "phase2Housing": true };
				}
				else
				{
					// Preserve the organized P1 house line as the first choice. IT14.14's
					// supposed broad fallback accidentally called the house-specific generator,
					// which ignores distances/angleCount and searched only ~100 tiny candidates.
					// IT14.15 keeps the line but, if terrain blocks it, searches real rings around
					// the outer developed/wood district so housing can never deadlock production.
					let dx = woodPos[0] - cc.position()[0], dz = woodPos[1] - cc.position()[1];
					const len = Math.hypot(dx, dz) || 1;
					dx /= len; dz /= len;
					const tangent = [-dz, dx];
					const spacing = Math.max(10, 2 * Number(geometry.radius || 4) + 2);
					const lineCandidates = [...farmHouseCandidates];
					for (let step = 1; step <= 10; ++step)
					{
						lineCandidates.push([firstPos[0] + tangent[0] * spacing * step, firstPos[1] + tangent[1] * spacing * step]);
						lineCandidates.push([firstPos[0] - tangent[0] * spacing * step, firstPos[1] - tangent[1] * spacing * step]);
					}

					const fallback = [];
					// Use the generic ring generator intentionally (kind=barracks for candidate
					// generation only); the final request remains kind=house and receives all
					// normal house legality/CC-distance validation.
					fallback.push(...generatePlacementCandidates({
						"kind": "barracks", "anchor": firstPos, "toward": woodPos,
						"distances": [10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58],
						"angleCount": 24, "templateRadius": geometry.radius
					}));
					const district = this.dominantWoodBuilderCenter(gameState) || woodPos;
					fallback.push(...generatePlacementCandidates({
						"kind": "barracks", "anchor": district, "toward": woodPos,
						"distances": [10, 14, 18, 22, 26, 30, 34, 40],
						"angleCount": 24, "templateRadius": geometry.radius
					}));
					const developed = [
						...houses, ...this.builtByClass(gameState, "Barracks"),
						...this.builtByClass(gameState, "Storehouse")
					].filter(ent => ent && entityPosition(ent));
					developed.sort((a, b) => SquareVectorDistance(b.position(), cc.position()) - SquareVectorDistance(a.position(), cc.position()) || a.id() - b.id());
					for (const anchorEnt of developed.slice(0, 4))
					{
						const pos = anchorEnt.position();
						fallback.push(...generatePlacementCandidates({
							"kind": "barracks", "anchor": pos, "toward": woodPos,
							"distances": [10, 14, 18, 22, 26], "angleCount": 16,
							"templateRadius": geometry.radius
						}));
					}
					const seen = new Set();
					const candidates = [...lineCandidates, ...fallback].filter(pos => {
						const key = pos[0].toFixed(2) + ":" + pos[1].toFixed(2);
						if (seen.has(key)) return false;
						seen.add(key); return true;
					});
					request = { kind, "candidates": candidates, "templateRadius": geometry.radius,
						"minimumCCDistance": policy.independentBuildingMinimumCCDistance };
				}
			}
		}

		else if (kind === "field")
		{
			const roleMatch = String(action.role || "").match(/capacity_(\d+)/);
			const offset = roleMatch ? Math.max(0, Number(roleMatch[1]) - 1) : 0;
			const hub = this.farmsteadForNextField(gameState, accessIndex, offset);
			if (!hub || !hub.farm || !hub.slots.length)
				return undefined;
			const hubKind = hub.hubKind || "farmstead";
			const fieldIntent = this.fieldRequestAt(gameState, hub.farm.position(), hub.farm.id(), hubKind);
			request = {
				kind,
				"candidates": hub.slots,
				"farmsteadId": hub.farm.id(),
				"foodHubId": hub.farm.id(),
				"foodHubKind": hubKind,
				"templateRadius": geometry.radius,
				"maxBorderGap": Number.isFinite(Number(hub.fieldGapLimit)) ? Number(hub.fieldGapLimit) : fieldIntent.maxBorderGap
			};
		}
		else if (kind === "barracks")
		{
			const policy = mergePolicy();
			const ccPos = cc.position();
			const builderAnchor = this.dominantWoodBuilderCenter(gameState) || this.getPrimaryWoodPosition(gameState) || ccPos;
			const dx = builderAnchor[0] - ccPos[0], dz = builderAnchor[1] - ccPos[1];
			const len = Math.hypot(dx, dz) || 1;
			const outward = [builderAnchor[0] + dx / len * 20, builderAnchor[1] + dz / len * 20];
			const primary = generatePlacementCandidates({
				"kind": "barracks", "anchor": builderAnchor, "toward": outward,
				"distances": [8, 12, 16, 20, 24, 28, 32, 36, 40], "angleCount": 32, "templateRadius": geometry.radius
			});
			// Robust fallback on the SAME SIDE of the settlement. This keeps the CC core
			// open but prevents one obstructed lumber district from deleting barracks all game.
			const fallbackAnchor = [ccPos[0] + dx / len * 38, ccPos[1] + dz / len * 38];
			const fallback = generatePlacementCandidates({
				"kind": "barracks", "anchor": fallbackAnchor, "toward": outward,
				"distances": [0, 6, 10, 14, 18, 22, 26], "angleCount": 32, "templateRadius": geometry.radius
			});
			let barracksCandidates = [];
			// IT14.43: Barracks #1/#2 may be economic territory tools, not just home-base
			// production boxes. If a worthwhile neutral berry/fruit/wood district sits just
			// beyond the border, first test legal inside-edge positions toward that resource.
			// This can bring the resource into territory without spending 100 wood on a
			// premature farmstead/field transition. Keep the normal lumber-side placement
			// immediately behind these candidates so bad frontier geometry cannot delay the
			// barracks timing.
			if (action.role !== "third_p2")
			{
				const earlyAnchors = this.frontierResourceAnchors(gameState, ccPos, accessIndex)
					.filter(anchor => anchor.generic === "food" || anchor.generic === "wood")
					.filter(anchor => Math.sqrt(SquareVectorDistance(anchor.position, ccPos)) <= 120)
					.slice(0, 4);
				for (const anchor of earlyAnchors)
					barracksCandidates.push(...generatePlacementCandidates({
						"kind": "barracks", "anchor": anchor.position, "toward": ccPos,
						"distances": [12, 16, 20, 24, 28, 32, 36, 40], "angleCount": 48, "templateRadius": geometry.radius
					}));
			}
			barracksCandidates.push(...primary, ...fallback);
			if (action.role === "second")
			{
				// IT14.32: the 3:50 second-barracks decision was correct, but every local
				// candidate could sit inside the 50m CC/farm exclusion. Give the second
				// barracks a true outer-settlement fallback immediately rather than retrying
				// the same 512 rejected points for five minutes.
				barracksCandidates.push(...generatePlacementCandidates({
					"kind": "barracks", "anchor": ccPos, "toward": outward,
					"distances": [52, 58, 64, 70, 76, 82, 90, 98, 108, 120], "angleCount": 64, "templateRadius": geometry.radius
				}));
			}
			if (action.role === "third_p2")
			{
				// IT14.41: Barracks #3 is a throughput building. Search the entire useful
				// outer settlement on the FIRST attempt, and deliberately test the inside
				// edge of neutral resource districts so the barracks can also claim territory.
				for (const anchor of this.frontierResourceAnchors(gameState, ccPos, accessIndex))
					barracksCandidates.push(...generatePlacementCandidates({
						"kind": "barracks", "anchor": anchor.position, "toward": ccPos,
						"distances": [16, 20, 24, 28, 32, 36, 40, 44], "angleCount": 48, "templateRadius": geometry.radius
					}));
				barracksCandidates.push(...generatePlacementCandidates({
					"kind": "barracks", "anchor": ccPos, "toward": outward,
					"distances": [52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 104, 112, 120, 128, 136, 144, 152, 160, 168, 176],
					"angleCount": 128, "templateRadius": geometry.radius
				}));
			}
			request = { kind, "candidates": barracksCandidates, "templateRadius": geometry.radius,
				"minimumCCDistance": policy.independentBuildingMinimumCCDistance };
		}

		else if (kind === "forge")
		{
			const policy = mergePolicy();
			const ccPos = cc.position();
			const developed = [
				...this.builtByClass(gameState, "Barracks"),
				...this.builtByClass(gameState, "Storehouse"),
				...this.builtByClass(gameState, "House")
			].filter(ent => ent && entityPosition(ent));
			developed.sort((a, b) => SquareVectorDistance(b.position(), ccPos) - SquareVectorDistance(a.position(), ccPos) || a.id() - b.id());
			const candidates = [];
			// IT14.41: a Town-phase forge is also a cheap territory anchor. Prefer a
			// legal edge position toward useful neutral resources before falling back
			// to the developed home ring.
			if (typeof gameState.currentPhase !== "function" || gameState.currentPhase() >= 2)
				for (const anchor of this.frontierResourceAnchors(gameState, ccPos, accessIndex).slice(0, 6))
					candidates.push(...generatePlacementCandidates({ "kind": "barracks", "anchor": anchor.position, "toward": ccPos,
						"distances": [16, 20, 24, 28, 32, 36], "angleCount": 40, "templateRadius": geometry.radius }));
			for (const ent of developed.slice(0, 8))
			{
				const pos = ent.position();
				let dx = pos[0] - ccPos[0], dz = pos[1] - ccPos[1];
				const len = Math.hypot(dx, dz) || 1;
				const outward = [pos[0] + dx / len * 24, pos[1] + dz / len * 24];
				// Use the generic ring generator; the final request remains kind=forge.
				candidates.push(...generatePlacementCandidates({ "kind": "barracks", "anchor": pos, "toward": outward,
					"distances": [10, 14, 18, 22, 26, 30, 34], "angleCount": 24, "templateRadius": geometry.radius }));
			}
			const toward = developed.length ? developed[0].position() :
				(this.getPrimaryWoodPosition(gameState) || [ccPos[0] + 1, ccPos[1]]);
			candidates.push(...generatePlacementCandidates({ "kind": "barracks", "anchor": ccPos, "toward": toward,
				"distances": [50, 56, 62, 68, 74, 80, 88, 96, 108], "angleCount": 48, "templateRadius": geometry.radius }));
			request = { kind, candidates, "templateRadius": geometry.radius,
				"minimumCCDistance": policy.independentBuildingMinimumCCDistance };
		}

		else if (kind === "market")
		{
			const policy = mergePolicy();
			const ccPos = cc.position();
			const candidates = [];

			// IT14.41: markets may intentionally push the border toward neutral food/wood
			// or mining districts. Candidate legality still requires the snapped building
			// footprint itself to remain inside our current territory.
			for (const anchor of this.frontierResourceAnchors(gameState, ccPos, accessIndex).slice(0, 8))
				candidates.push(...generatePlacementCandidates({ "kind": "market", "anchor": anchor.position, "toward": ccPos,
					"distances": [18, 22, 26, 30, 34, 38, 42], "angleCount": 48, "templateRadius": geometry.radius }));

			// IT14.29: markets are resource dropsites first. Prefer owned, same-land
			// stone/metal deposits and the active wood district, then retain the proven
			// outer-developed-settlement fallback from IT14.28.
			const resourceAnchors = [];
			if (gameState.getResourceSupplies)
			{
				for (const generic of ["metal", "stone"])
				{
					for (const supply of gameState.getResourceSupplies(generic).values())
					{
						const pos = entityPosition(supply);
						if (!pos || !supply.resourceSupplyAmount || supply.resourceSupplyAmount() <= 0 ||
						    getLandAccess(gameState, supply) !== accessIndex || this.HQ.territoryMap.getOwner(pos) !== PlayerID)
							continue;
						const amount = Math.max(0, Number(supply.resourceSupplyAmount()) || 0);
						const distance = Math.sqrt(SquareVectorDistance(pos, ccPos));
						// Mines beyond the CC core are much more valuable market anchors.
						resourceAnchors.push({ "position": pos, "score": amount + (distance >= policy.independentBuildingMinimumCCDistance ? 1200 : 0) });
					}
				}
			}
			const woodPos = this.getPrimaryWoodPosition(gameState);
			if (woodPos)
				resourceAnchors.push({ "position": woodPos, "score": 1000 });
			resourceAnchors.sort((a, b) => b.score - a.score);
			for (const anchor of resourceAnchors.slice(0, 8))
			{
				const pos = anchor.position;
				let dx = pos[0] - ccPos[0], dz = pos[1] - ccPos[1];
				const len = Math.hypot(dx, dz) || 1;
				const outward = [pos[0] + dx / len * 20, pos[1] + dz / len * 20];
				candidates.push(...generatePlacementCandidates({ "kind": "market", "anchor": pos, "toward": outward,
					"distances": [8, 12, 16, 20, 24, 28], "angleCount": 24, "templateRadius": geometry.radius }));
			}

			const developed = [
				...this.builtByClass(gameState, "House"), ...this.builtByClass(gameState, "Barracks"),
				...this.builtByClass(gameState, "Storehouse")
			].filter(ent => ent && entityPosition(ent));
			developed.sort((a, b) => SquareVectorDistance(b.position(), ccPos) - SquareVectorDistance(a.position(), ccPos) || a.id() - b.id());
			for (const ent of developed.slice(0, 8))
			{
				const pos = ent.position();
				let dx = pos[0] - ccPos[0], dz = pos[1] - ccPos[1];
				const len = Math.hypot(dx, dz) || 1;
				const outward = [pos[0] + dx / len * 24, pos[1] + dz / len * 24];
				candidates.push(...generatePlacementCandidates({ "kind": "market", "anchor": pos, "toward": outward,
					"distances": [14, 18, 22, 26, 30, 34, 38], "angleCount": 24, "templateRadius": geometry.radius }));
			}
			candidates.push(...generatePlacementCandidates({ "kind": "market", "anchor": ccPos,
				"toward": woodPos || [ccPos[0] + 1, ccPos[1]],
				"distances": [50, 56, 62, 68, 74, 80, 88, 96, 108], "angleCount": 48, "templateRadius": geometry.radius }));
			// IT14.35: the resource-aware anchors are still preferred, but a market is
			// too strategically important (dropsite + barter + P3 requirement) to fail
			// forever if every compact candidate is obstructed.
			candidates.push(...generatePlacementCandidates({ "kind": "market", "anchor": ccPos,
				"toward": woodPos || [ccPos[0] + 1, ccPos[1]],
				"distances": [54, 60, 66, 72, 78, 84, 90, 96, 104, 112, 120, 128, 136],
				"angleCount": 96, "templateRadius": geometry.radius }));
			request = { kind, candidates, "templateRadius": geometry.radius,
				"minimumCCDistance": policy.independentBuildingMinimumCCDistance };
			if (action.role === "phase3_town_support")
			{
				// IT14.38: the second Town building is phase progression, not decoration.
				// If the developed resource district is packed, search a farther owned-territory
				// belt instead of retrying the same 3,456 impossible positions forever.
				candidates.push(...generatePlacementCandidates({ "kind": "market", "anchor": ccPos,
					"toward": woodPos || [ccPos[0] + 1, ccPos[1]],
					"distances": [112, 120, 128, 136, 144, 152, 160, 168, 176],
					"angleCount": 128, "templateRadius": geometry.radius }));
				request.minimumMarketSpacing = policy.phase2SecondMarketSpacing;
			}
		}

		else if (kind === "temple")
		{
			const policy = mergePolicy();
			const ccPos = cc.position();
			const templeTemplate = gameState.applyCiv("structures/{civ}/temple");
			const vestaTemplate = gameState.applyCiv("structures/{civ}/temple_vesta");
			const templeTypes = [templeTemplate, vestaTemplate].filter(type => gameState.getTemplate(type));
			if (!this.HQ.canBuild || !templeTypes.some(type => this.HQ.canBuild(gameState, type)))
				return undefined;
			const candidates = [];
			// IT14.34: P1 has no market yet, so choose the economic district by actual
			// worker coverage rather than structure type alone. The 75m aura should land
			// where the current farm/mining/wood workforce is densest. In P2 the market
			// remains a natural candidate because it was itself resource-placed.
			const workers = [];
			for (const ent of gameState.getOwnUnits().values())
				if (ent && entityPosition(ent) && hasClass(ent, "Worker"))
					workers.push(ent);
			const auraRadiusSquared = policy.templeAuraPlanningRadius * policy.templeAuraPlanningRadius;
			const resourceAnchorPositions = [];
			if (gameState.getResourceSupplies)
				for (const generic of ["metal", "stone"])
					for (const supply of gameState.getResourceSupplies(generic).values())
					{
						const pos = entityPosition(supply);
						if (!pos || !supply.resourceSupplyAmount || supply.resourceSupplyAmount() <= 0 ||
						    getLandAccess(gameState, supply) !== accessIndex || this.HQ.territoryMap.getOwner(pos) !== PlayerID)
							continue;
						const coverage = workers.reduce((sum, worker) =>
							sum + (SquareVectorDistance(pos, worker.position()) <= auraRadiusSquared ? 1 : 0), 0);
						resourceAnchorPositions.push({ pos, score: coverage * 1000 + Math.max(0, Number(supply.resourceSupplyAmount()) || 0) });
					}
			resourceAnchorPositions.sort((a,b) => b.score-a.score);
			for (const anchor of resourceAnchorPositions.slice(0, 6))
			{
				const pos = anchor.pos;
				let dx = pos[0] - ccPos[0], dz = pos[1] - ccPos[1];
				const len = Math.hypot(dx, dz) || 1;
				const outward = [pos[0] + dx / len * 18, pos[1] + dz / len * 18];
				candidates.push(...generatePlacementCandidates({ "kind": "market", "anchor": pos, "toward": outward,
					"distances": [8, 12, 16, 20, 24, 28, 34], "angleCount": 32, "templateRadius": geometry.radius }));
			}
			const anchors = [
				...this.builtByClass(gameState, "Market"),
				...this.builtByClass(gameState, "Farmstead"),
				...this.builtByClass(gameState, "Storehouse")
			].filter(ent => ent && entityPosition(ent))
			 .map(ent => ({
				ent,
				score: workers.reduce((sum, worker) =>
					sum + (SquareVectorDistance(ent.position(), worker.position()) <= auraRadiusSquared ? 1 : 0), 0)
			 }))
			 .sort((a, b) => b.score - a.score || a.ent.id() - b.ent.id())
			 .map(entry => entry.ent);
			for (const ent of anchors)
			{
				const pos = ent.position();
				let dx = pos[0] - ccPos[0], dz = pos[1] - ccPos[1];
				const len = Math.hypot(dx, dz) || 1;
				const outward = [pos[0] + dx / len * 20, pos[1] + dz / len * 20];
				candidates.push(...generatePlacementCandidates({ "kind": "market", "anchor": pos, "toward": outward,
					"distances": [8, 12, 16, 20, 24, 28, 34], "angleCount": 32, "templateRadius": geometry.radius }));
			}
			// A temple may deliberately occupy the CC-side economic core if that is where
			// its aura reaches the most active workers. This is distinct from houses/forges.
			candidates.unshift(...generatePlacementCandidates({ "kind": "market", "anchor": ccPos,
				"toward": anchors.length ? anchors[0].position() : [ccPos[0] + 1, ccPos[1]],
				"distances": [16, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72], "angleCount": 64, "templateRadius": geometry.radius }));
			request = { kind, candidates, "templateRadius": geometry.radius,
				"minimumCCDistance": policy.templeMinimumCCDistance,
				"templeAuraRadius": policy.templeAuraPlanningRadius,
				"templeMinimumWorkerCoverage": policy.templeMinimumWorkerCoverage };
		}


		else if (kind === "arsenal" || kind === "gymnasium" || kind === "prytaneion")
		{
			const policy = mergePolicy();
			const ccPos = cc.position();
			const candidates = [];
			for (const anchor of this.frontierResourceAnchors(gameState, ccPos, accessIndex).slice(0, 6))
				candidates.push(...generatePlacementCandidates({ "kind": "barracks", "anchor": anchor.position, "toward": ccPos,
					"distances": [18, 22, 26, 30, 34, 38], "angleCount": 40, "templateRadius": geometry.radius }));
			const developed = [
				...this.builtByClass(gameState, "Barracks"), ...this.builtByClass(gameState, "Forge"),
				...this.builtByClass(gameState, "Market"), ...this.builtByClass(gameState, "Storehouse")
			].filter(ent => ent && entityPosition(ent));
			developed.sort((a, b) => SquareVectorDistance(b.position(), ccPos) - SquareVectorDistance(a.position(), ccPos) || a.id() - b.id());
			for (const ent of developed.slice(0, 8))
			{
				const pos = ent.position();
				let dx = pos[0] - ccPos[0], dz = pos[1] - ccPos[1];
				const len = Math.hypot(dx, dz) || 1;
				const outward = [pos[0] + dx / len * 24, pos[1] + dz / len * 24];
				candidates.push(...generatePlacementCandidates({ "kind": "barracks", "anchor": pos, "toward": outward,
					"distances": [12, 16, 20, 24, 28, 32, 36], "angleCount": 32, "templateRadius": geometry.radius }));
			}
			candidates.push(...generatePlacementCandidates({ "kind": "barracks", "anchor": ccPos,
				"toward": developed.length ? developed[0].position() : [ccPos[0] + 1, ccPos[1]],
				"distances": [52, 60, 68, 76, 84, 92, 104, 116, 128], "angleCount": 64, "templateRadius": geometry.radius }));
			request = { kind, candidates, "templateRadius": geometry.radius,
				"minimumCCDistance": policy.independentBuildingMinimumCCDistance };
		}

		else if (kind === "tower")
		{
			const policy = mergePolicy();
			request = {
				kind,
				// IT14.29: independent structures stay outside the 50m CC core.
				"anchor": cc.position(),
				"toward": this.expertDefenseState && this.expertDefenseState.threatPosition || [cc.position()[0] + 1, cc.position()[1]],
				"distances": [50, 56, 62, 68, 74, 80],
				"angleCount": 32,
				"templateRadius": geometry.radius,
				"minimumCCDistance": policy.independentBuildingMinimumCCDistance
			};
		}
		// IT14.43 emergency placement: after one failed strategic search, stop demanding a
		// beautiful city.  Add dense legal rings around every developed own structure;
		// engine obstruction/territory checks still decide legality.
		if (request && strategicFallback && kind !== "field" && kind !== "farmstead" && kind !== "storehouse" && kind !== "house")
		{
			const emergency = [];
			const ccPos = cc.position();
			const developed = [
				...this.builtByClass(gameState, "House"), ...this.builtByClass(gameState, "Barracks"),
				...this.builtByClass(gameState, "Storehouse"), ...this.builtByClass(gameState, "Farmstead"),
				...this.builtByClass(gameState, "Forge"), ...this.builtByClass(gameState, "Market")
			].filter(ent => ent && entityPosition(ent));
			for (const ent of developed.slice(0, 16))
			{
				const pos = ent.position();
				emergency.push(...generatePlacementCandidates({ "kind": kind === "market" ? "market" : "barracks",
					"anchor": pos, "toward": ccPos, "distances": [8, 12, 16, 20, 24, 28, 32, 36, 40],
					"angleCount": 32, "templateRadius": geometry.radius }));
			}
			emergency.push(...generatePlacementCandidates({ "kind": kind === "market" ? "market" : "barracks",
				"anchor": ccPos, "toward": this.getPrimaryWoodPosition(gameState) || [ccPos[0] + 1, ccPos[1]],
				"distances": [50, 54, 58, 62, 66, 70, 74, 78, 82, 86, 90, 96, 104], "angleCount": 72,
				"templateRadius": geometry.radius }));
			// IT14.45: the second market was still rejecting 7k-12k hand-generated
			// positions.  For phase progression, sample the territory map itself after the
			// first strategic failure.  These are only raw candidate centres; the normal
			// obstruction/access/50m-CC/market-spacing validation still has final say.
			if (kind === "market" && action.role === "phase3_town_support")
			{
				const territory = this.HQ.territoryMap;
				const firstMarket = this.builtByClass(gameState, "Market").find(ent => ent && entityPosition(ent));
				const firstPos = firstMarket && firstMarket.position();
				const spacing = Number(mergePolicy().phase2SecondMarketSpacing) || 30;
				const grid = [];
				if (territory && Number.isFinite(territory.width) && Number.isFinite(territory.cellSize) && territory.getOwnerIndex)
				{
					const step = 2;
					for (let z = 0; z < territory.width; z += step)
						for (let x = 0; x < territory.width; x += step)
						{
							const j = x + z * territory.width;
							if (territory.getOwnerIndex(j) !== PlayerID)
								continue;
							const pos = [(x + 0.5) * territory.cellSize, (z + 0.5) * territory.cellSize];
							const ccDist = Math.sqrt(SquareVectorDistance(pos, ccPos));
							if (ccDist < mergePolicy().independentBuildingMinimumCCDistance)
								continue;
							const marketDist = firstPos ? Math.sqrt(SquareVectorDistance(pos, firstPos)) : 999;
							if (firstPos && marketDist < spacing)
								continue;
							grid.push({ pos, score: Math.abs(ccDist - 72) + (firstPos ? 0.35 * Math.abs(marketDist - 55) : 0) });
						}
					grid.sort((a, b) => a.score - b.score);
					emergency.push(...grid.slice(0, 512).map(item => item.pos));
				}
			}
			request.candidates = [...(request.candidates || []), ...emergency];
			if (kind === "market" && action.role === "phase3_town_support")
				request.minimumMarketSpacing = Math.min(Number(request.minimumMarketSpacing) || 999, mergePolicy().phase2SecondMarketSpacing);
			request.preserveFarmDistrict = false;
		}

		if (!request)
			return undefined;
		const matureFarmDistrict = this.builtByClass(gameState, "Field").length >= mergePolicy().matureFarmDistrictRelaxFieldCount;
		if (!strategicFallback && (kind === "house" || kind === "forge" || kind === "arsenal" || kind === "gymnasium" || kind === "prytaneion"))
			request.preserveFarmDistrict = true;
		else if (!strategicFallback && kind === "barracks")
			request.preserveFarmDistrict = action.role !== "third_p2";
		else if (kind === "market" || kind === "temple")
			request.preserveFarmDistrict = false;
		request.taskId = taskId;
		request.role = request.role || action.role || "primary";
		return request;
	}

	placementPorts(gameState, kind, accessIndex)
	{
		const ports = createPetraPlacementPorts(gameState, kind, {
			"HQ": this.HQ,
			"createObstructionMap": createObstructionMap,
			"accessIndex": accessIndex
		});
		if (kind === "tower")
		{
			const threatPosition = this.expertDefenseState && this.expertDefenseState.threatPosition;
			// Generic Petra marks threatened base cells as dangerous, which is exactly where
			// an emergency tower belongs. Only reject a tower if enemies are already on top of it.
			ports.isDangerous = position => !!(threatPosition && SquareVectorDistance(position, threatPosition) < 32 * 32);
		}
		let farmCapacityAt;
		let farmDistrictReservation;
		const resourceCorridors = this.activeResourceCorridors(gameState, accessIndex);
		if (kind === "house" || kind === "barracks" || kind === "market" || kind === "forge" || kind === "temple" || kind === "arsenal" || kind === "gymnasium" || kind === "prytaneion")
		{
			const policy = mergePolicy();
			const fieldGeom = readTemplateGeometry(gameState, "field");
			const farmGeom = readTemplateGeometry(gameState, "farmstead");
			const buildingGeom = readTemplateGeometry(gameState, kind);
			const fieldPorts = createPetraPlacementPorts(gameState, "field", {
				"HQ": this.HQ,
				"createObstructionMap": createObstructionMap,
				"accessIndex": accessIndex
			});
			const shared = { "ports": fieldPorts, "fieldGeom": fieldGeom, "farmGeom": farmGeom };
			const farmsteads = [
				...this.builtByClass(gameState, "Farmstead"),
				...this.foundationsByClass(gameState, "Farmstead")
			].filter(ent => ent && entityPosition(ent));
			const reservedSlots = [];
			const reservedKeys = new Set();
			const reserveSlot = (slot, farmsteadId) =>
			{
				if (!Array.isArray(slot) || slot.length < 2)
					return;
				const key = farmsteadId + ":" + Number(slot[0]).toFixed(2) + ":" + Number(slot[1]).toFixed(2);
				if (reservedKeys.has(key))
					return;
				reservedKeys.add(key);
				reservedSlots.push({ "position": slot, "farmsteadId": farmsteadId });
			};
			for (const farm of farmsteads)
			{
				// Reserve the four IDEAL N/E/S/W field footprints even if berries currently
				// occupy one of them. Houses/barracks must not steal a future canonical slot.
				const idealRequest = this.fieldRequestAt(gameState, farm.position(), farm.id());
				idealRequest.gaps = [0.0];
				idealRequest.maxBorderGap = 0.80;
				const idealSlots = generatePlacementCandidates(idealRequest).slice(0, 4);
				for (const slot of idealSlots)
					reserveSlot(slot, farm.id());

				// Also reserve any currently legal fallback slot proved by the live scanner.
				const slots = this.fieldSlotsAt(gameState, farm.position(), farm.id(), accessIndex, shared,
					policy.fieldsPerFarmstead, Math.max(2.0, Number(policy.existingFarmsteadReuseMaxBorderGap) || 4.0));
				for (const slot of slots)
					reserveSlot(slot, farm.id());
			}

			// IT14.46: markets are no longer permanent-field hubs. Reserve field faces only
			// around farmsteads so permanent food remains visually and mechanically coherent.
			farmDistrictReservation = {
				"farmsteads": farmsteads,
				"reservedSlots": reservedSlots,
				"fieldHalf": fieldGeom.halfExtents || { "width": fieldGeom.radius, "depth": fieldGeom.radius },
				"farmHalf": farmGeom.halfExtents || { "width": farmGeom.radius, "depth": farmGeom.radius },
				"buildingHalf": buildingGeom.halfExtents || { "width": buildingGeom.radius, "depth": buildingGeom.radius },
				"minimumDistance": Number(policy.farmDistrictIndependentBuildingMinimumDistance) || 28,
				"preferredDistance": Number(policy.farmDistrictIndependentBuildingPreferredDistance) || 38,
				"slotMargin": Number(policy.farmDistrictReservedSlotMargin) || 2
			};
		}
		if (kind === "farmstead")
		{
			const fieldPorts = createPetraPlacementPorts(gameState, "field", {
				"HQ": this.HQ,
				"createObstructionMap": createObstructionMap,
				"accessIndex": accessIndex
			});
			const shared = {
				"ports": fieldPorts,
				"fieldGeom": readTemplateGeometry(gameState, "field"),
				"hubGeomByKind": { "farmstead": readTemplateGeometry(gameState, "farmstead") }
			};
			const cache = new Map();
			farmCapacityAt = position =>
			{
				const key = position[0].toFixed(2) + ":" + position[1].toFixed(2);
				if (!cache.has(key))
					cache.set(key, this.fieldSlotsAt(gameState, position, -1, accessIndex, shared, mergePolicy().fieldsPerFarmstead).length);
				return cache.get(key);
			};
		}
		ports.extraValidation = (position, request) =>
		{
			if (this.HQ.territoryMap.getOwner(position) !== PlayerID ||
			    gameState.ai.accessibility.getAccessValue(position) !== accessIndex)
				return false;
			const minimumCCDistance = Math.max(0, Number(request && request.minimumCCDistance) || 0);
			if (minimumCCDistance > 0)
			{
				const coreCC = this.findCC(gameState);
				if (coreCC && entityPosition(coreCC) && SquareVectorDistance(position, coreCC.position()) < minimumCCDistance * minimumCCDistance)
					return false;
			}
			if (kind !== "storehouse" && kind !== "farmstead" && kind !== "field" && resourceCorridors.length)
			{
				const geometry = readTemplateGeometry(gameState, kind);
				const clearance = (Number(mergePolicy().resourceCorridorClearance) || 3.5) + Math.max(1, Number(geometry.radius) || 1);
				for (const corridor of resourceCorridors)
					if (pointSegmentDistanceSquared(position, corridor.from, corridor.to) < clearance * clearance)
						return false;
			}
			if (kind === "temple" && request && Number(request.templeMinimumWorkerCoverage) > 0)
			{
				const radius = Number(request.templeAuraRadius) || 72;
				const r2 = radius * radius;
				let covered = 0;
				for (const worker of gameState.getOwnUnits().values())
					if (worker && entityPosition(worker) && hasClass(worker, "Worker") &&
					    !worker.getMetadata(PlayerID, "PartOfArmy") && SquareVectorDistance(position, worker.position()) <= r2)
						++covered;
				if (covered < Number(request.templeMinimumWorkerCoverage))
					return false;
			}
			if (request && request.preserveFarmDistrict && farmDistrictReservation)
			{
				const margin = farmDistrictReservation.slotMargin;
				const buildingHalf = farmDistrictReservation.buildingHalf;
				const fieldHalf = farmDistrictReservation.fieldHalf;
				const farmHalf = farmDistrictReservation.farmHalf;
				// Reserve the FUTURE farm district, not only slots that happen to be legal
				// while berries/fruit still occupy the ground. This is the key IT14.24 fix:
				// houses/barracks cannot claim the space that an exhausted natural dropsite
				// will need for its permanent fields a minute later.
				for (const farm of farmDistrictReservation.farmsteads)
				{
					const distance = Math.sqrt(SquareVectorDistance(position, farm.position()));
					if (distance < farmDistrictReservation.minimumDistance)
						return false;
					const dx = Math.abs(position[0] - farm.position()[0]);
					const dz = Math.abs(position[1] - farm.position()[1]);
					if (dx < Number(farmHalf.width) + Number(buildingHalf.width) + margin &&
					    dz < Number(farmHalf.depth) + Number(buildingHalf.depth) + margin)
						return false;
				}
				// More importantly, reserve every currently legal touching-field footprint.
				// Houses/barracks/markets may live outside the farm block, but may not consume
				// a slot that the field planner can already prove is usable.
				for (const slot of farmDistrictReservation.reservedSlots)
				{
					const dx = Math.abs(position[0] - slot.position[0]);
					const dz = Math.abs(position[1] - slot.position[1]);
					if (dx < Number(fieldHalf.width) + Number(buildingHalf.width) + margin &&
					    dz < Number(fieldHalf.depth) + Number(buildingHalf.depth) + margin)
						return false;
				}
			}
			if (kind === "field")
			{
				// A field is useful only when it is genuinely adjacent to its farmstead.
				// Engine snapping is allowed, but the snapped footprint may not drift beyond
				// the selected farmstead's approved local border-gap limit.
				const farmsteadId = Number(request && (request.foodHubId !== undefined ? request.foodHubId : request.farmsteadId));
				const farmstead = Number.isFinite(farmsteadId) ? gameState.getEntityById(farmsteadId) : undefined;
				if (!farmstead || !entityPosition(farmstead))
					return false;
				const hubKind = request && request.foodHubKind || "farmstead";
				const farmGeom = readTemplateGeometry(gameState, hubKind);
				const fieldGeom = readTemplateGeometry(gameState, "field");
				const farmHalf = farmGeom.halfExtents || { "width": farmGeom.radius, "depth": farmGeom.radius };
				const fieldHalf = fieldGeom.halfExtents || { "width": fieldGeom.radius, "depth": fieldGeom.radius };
				const dx = Math.abs(position[0] - farmstead.position()[0]);
				const dz = Math.abs(position[1] - farmstead.position()[1]);
				const gapX = Math.max(0, dx - (Number(farmHalf.width) + Number(fieldHalf.width)));
				const gapZ = Math.max(0, dz - (Number(farmHalf.depth) + Number(fieldHalf.depth)));
				const borderGap = Math.hypot(gapX, gapZ);
				const maxBorderGap = Number.isFinite(Number(request && request.maxBorderGap)) ? Number(request.maxBorderGap) : 0.80;
				if (borderGap > maxBorderGap)
					return false;
				for (const pending of Object.values(this.pendingFieldPositions))
					if (Array.isArray(pending) && SquareVectorDistance(position, pending) < 22*22)
						return false;
			}
			if (kind === "house")
			{
				// IT14.46: never spend a prime wood-dropsite/workflow position on housing.
				const radius = Number(mergePolicy().houseWoodWorksiteExclusionRadius) || 24;
				for (const store of [...this.builtByClass(gameState, "Storehouse"), ...this.foundationsByClass(gameState, "Storehouse")])
					if (entityPosition(store) && SquareVectorDistance(position, store.position()) < radius * radius)
						return false;
			}
			if (kind === "farmstead")
			{
				const farmsteadSpacing = request && request.resourceServiceFood ? 14 : 30;
				for (const ent of [...this.builtByClass(gameState, "Farmstead"), ...this.foundationsByClass(gameState, "Farmstead")])
					if (entityPosition(ent) && SquareVectorDistance(position, ent.position()) < farmsteadSpacing * farmsteadSpacing)
						return false;
				const minimumFieldSlots = Number(request && request.minimumFieldSlots) || 0;
				if (minimumFieldSlots > 0 && farmCapacityAt && farmCapacityAt(position) < minimumFieldSlots)
					return false;
			}
			if (kind === "storehouse" && this.builtByClass(gameState, "Storehouse").length)
			{
				const spacing = request && request.resourceService ?
					(Number(mergePolicy().resourceServiceStorehouseMinimumSpacing) || 10) : mergePolicy().woodStorehouseMinimumSpacing;
				for (const ent of this.builtByClass(gameState, "Storehouse"))
					if (SquareVectorDistance(position, ent.position()) < spacing * spacing)
						return false;
			}
			if (kind === "market" && Number(request && request.minimumMarketSpacing) > 0)
			{
				const spacing = Number(request.minimumMarketSpacing);
				for (const ent of [...this.builtByClass(gameState, "Market"), ...this.foundationsByClass(gameState, "Market")])
					if (entityPosition(ent) && SquareVectorDistance(position, ent.position()) < spacing * spacing)
						return false;
			}
			if (kind === "tower")
				for (const ent of [...this.builtByClass(gameState, "Tower"), ...this.foundationsByClass(gameState, "Tower")])
					if (entityPosition(ent) && SquareVectorDistance(position, ent.position()) < 34*34)
						return false;
			return true;
		};
		if (kind === "storehouse")
			ports.scoreCandidate = (position, request, index) =>
			{
				if (!request || !request.resourceService)
					return Number(index) || 0;
				const sources = Array.isArray(request.pathSources) ? request.pathSources : [];
				let score = Number(index) || 0;
				for (const source of sources)
				{
					const distance = Math.sqrt(SquareVectorDistance(source, position));
					score += 150 * distance;
					score += 35 * this.lineObstructionPenalty(ports.obstructionMap, source, position);
				}
				return score / Math.max(1, sources.length || 1);
			};
		else if (kind === "temple")
			ports.scoreCandidate = (position, request, index) =>
			{
				const radius = Number(request && request.templeAuraRadius) || 72;
				const r2 = radius * radius;
				let covered = 0;
				for (const worker of gameState.getOwnUnits().values())
					if (worker && entityPosition(worker) && hasClass(worker, "Worker") &&
					    !worker.getMetadata(PlayerID, "PartOfArmy") &&
					    SquareVectorDistance(position, worker.position()) <= r2)
						++covered;
				// Coverage dominates candidate order; one extra long-lived worker in aura is
				// worth much more than a small geometric preference.
				return (Number(index) || 0) - covered * 10000;
			};
		else if (kind === "market")
			ports.scoreCandidate = (position, request, index) =>
			{
				// IT14.48: IT14.47 accidentally referenced `request` while constructing
				// placement ports, before the request callback argument existed. That caused
				// the post-P2 market attempt to throw every update. `request` is only valid
				// inside this callback. Preserve the normal farm-district exclusion score for
				// Market #1, then add long-route scoring only to the Town-support Market #2.
				let score = Number(index) || 0;
				if (farmDistrictReservation)
					for (const farm of farmDistrictReservation.farmsteads)
					{
						const distance = Math.sqrt(SquareVectorDistance(position, farm.position()));
						if (distance < farmDistrictReservation.preferredDistance)
							score += 100000 + 1000 * (farmDistrictReservation.preferredDistance - distance);
					}
				if (!request || request.role !== "phase3_town_support")
					return score;

				const first = this.builtByClass(gameState, "Market").find(ent => ent && entityPosition(ent));
				const cc = this.findCC(gameState);
				const firstPos = first && first.position();
				const ccPos = cc && cc.position();
				const marketDistance = firstPos ? Math.sqrt(SquareVectorDistance(position, firstPos)) : 0;
				const ccDistance = ccPos ? Math.sqrt(SquareVectorDistance(position, ccPos)) : 0;
				const leashPenalty = Math.max(0, ccDistance - 180);
				// IT14.51: zero-pop traders make route length materially useful. Prefer a
				// farther safe endpoint much more strongly, while keeping a hard practical
				// leash so Market #2 does not chase the map edge.
				return score - 400 * marketDistance + 2 * ccDistance + 5000 * leashPenalty;
			};
		else if (kind === "farmstead")
			ports.scoreCandidate = (position, request) =>
			{
				const sources = request && Array.isArray(request.pathSources) ? request.pathSources : [];
				let score = 0;
				let nearestSource = Infinity;
				for (const source of sources)
				{
					const distance = Math.sqrt(SquareVectorDistance(source, position));
					nearestSource = Math.min(nearestSource, distance);
					score += distance;
					score += 25 * this.lineObstructionPenalty(ports.obstructionMap, source, position);
				}
				// Opening berries are special: at least one bush should be effectively on the
				// doorstep. Field geometry is only a tiebreaker for this first dropsite.
				if (request && request.openingNaturalFood && Number.isFinite(nearestSource))
					score += 80 * nearestSource;
				if (request && request.naturalExpansionFood && Number.isFinite(nearestSource))
					score += 140 * nearestSource;
				// Live field capacity is the strongest score for permanent farm hubs.
				// This prevents IT7's "three farmsteads, three fields" starvation pattern.
				const capacity = farmCapacityAt ? farmCapacityAt(position) : 0;
				const preferredCapacity = Number(request && request.preferredFieldSlots) || 0;
				if (preferredCapacity > 0 && capacity < preferredCapacity)
					score += (request && request.openingNaturalFood ? 40 : 300) * (preferredCapacity - capacity);
				for (let i = 0; i < 16; ++i)
				{
					const a = 2 * Math.PI * i / 16;
					const sample = [position[0] + 24 * Math.cos(a), position[1] + 24 * Math.sin(a)];
					score += 8 * this.lineObstructionPenalty(ports.obstructionMap, position, sample);
				}
				score -= (request && (request.openingNaturalFood || request.naturalExpansionFood) ? 15 : 120) * capacity;
				return score / Math.max(1, sources.length || 1);
			};
		else if ((kind === "house" || kind === "barracks" || kind === "market" || kind === "forge" || kind === "temple" || kind === "arsenal" || kind === "gymnasium" || kind === "prytaneion") && farmDistrictReservation)
			ports.scoreCandidate = (position, request, index) =>
			{
				// Preserve each building's existing candidate ordering once it is outside the
				// food district. Candidates inside the preferred farm radius receive a large
				// penalty, so houses form the outer edge and military/economic buildings do
				// not steal the farmstead's near-field ring merely because they are legal.
				let score = Number(index) || 0;
				for (const farm of farmDistrictReservation.farmsteads)
				{
					const distance = Math.sqrt(SquareVectorDistance(position, farm.position()));
					if (distance < farmDistrictReservation.preferredDistance)
						score += 100000 + 1000 * (farmDistrictReservation.preferredDistance - distance);
				}
				return score;
			};
		return ports;
	}

	prepareExecution(gameState, frame, cc, accessIndex, foodObservation)
	{
		const policy = mergePolicy();
		const merged = { "builds": {}, "maintenance": {}, "training": this.trainingExecution(gameState, cc) };
		const executableActions = [];
		const builtFields = this.builtByClass(gameState, "Field").length;
		const missingFields = Math.max(0, Number(frame.economy && frame.economy.derived && frame.economy.derived.desiredFields || 0) - builtFields);
		const phase = typeof gameState.currentPhase === "function" ? Number(gameState.currentPhase()) || 1 : 1;
		const wood = Number(gameState.getResources().wood) || 0;
		const fieldTaskCap = (phase >= 2 || wood >= policy.fieldParallelExpansionWoodBank) && missingFields >= 4 ?
			policy.maxConcurrentFieldTasksSurplus : policy.maxConcurrentFieldTasks;
		for (const action of frame.actions)
		{
			if (action.type === "BUILD")
			{
				if (action.kind === "field")
				{
					if (this.activeFieldTasks.length >= fieldTaskCap)
						continue;
				}
				else if (this.activeTaskByKind[action.kind])
					continue;

				const request = this.placementRequest(gameState, action, cc, accessIndex, foodObservation);
				if (!request)
					continue;
				const oneFrame = { ...frame, "actions": [action], "training": { "action": "NONE", "batch": 0 } };
				const prepared = prepareMechanicalExecution(gameState, oneFrame, {
					"placements": { [buildKey(action)]: request }, "training": {}
				}, { "placement": this.placementPorts(gameState, action.kind, accessIndex) }, this.foundationTracker, { "playerId": PlayerID });
				const exec = prepared.execution.builds[buildKey(action)];
				if (!exec)
				{
					const blocked = prepared.blocked && prepared.blocked.find(item => item.key === buildKey(action));
					const rejected = prepared.diagnostics && prepared.diagnostics[buildKey(action)] || [];
					if (action.kind === "field" && Number.isFinite(Number(request.farmsteadId)))
						this.fieldPlacementFailures[request.farmsteadId] = Number(this.fieldPlacementFailures[request.farmsteadId] || 0) + 1;
					if (action.kind === "farmstead" && ((action.role || "") === "farm_hub" || (action.role || "") === "farm_hub_constrained"))
						++this.farmsteadPlacementFailures;
					const placementKey = action.kind + ":" + (action.role || "primary");
					this.placementFailureCounts[placementKey] = Number(this.placementFailureCounts[placementKey] || 0) + 1;
					aiWarn("[EXPERT-PLACE] blocked kind=" + action.kind + " role=" + (action.role || "primary") +
						" reason=" + (blocked && blocked.reason || "unknown") + " rejected=" + rejected.length);
					delete this.pendingWoodSelectionByTask[request.taskId];
					delete this.pendingFoodSelectionByTask[request.taskId];
					continue;
				}
				if (action.kind === "farmstead" && ((action.role || "") === "farm_hub" || (action.role || "") === "farm_hub_constrained"))
					this.farmsteadPlacementFailures = 0;
				if (action.kind === "tower")
				{
					this.lastEmergencyTowerTime = Number(gameState.ai.elapsedTime) || 0;
					++this.emergencyTowerCount;
					aiWarn("[EXPERT-DEF] emergency tower queued count=" + this.emergencyTowerCount +
						" foe=" + (this.expertDefenseState.foeCount || 0));
				}
				this.placementFailureCounts[action.kind + ":" + (action.role || "primary")] = 0;
				this.activeTaskBuildIntent[exec.taskId] = {
					"builderPool": Array.isArray(action.builderPool) ? [...action.builderPool] : undefined,
					"builderCount": Number(action.builderCount) || undefined,
					"builderJobPriority": action.builderJobPriority ? { ...action.builderJobPriority } : undefined,
					"priority": Number(action.priority) || undefined,
					"role": action.role || "primary"
				};
				if (action.kind === "field")
				{
					if (Number.isFinite(Number(request.farmsteadId)))
						this.fieldPlacementFailures[request.farmsteadId] = 0;
					this.activeFieldTasks.push(exec.taskId);
					this.pendingFieldPositions[exec.taskId] = [...exec.position];
				}
				else
					this.activeTaskByKind[action.kind] = exec.taskId;
				this.taskStartedAt[exec.taskId] = gameState.ai.elapsedTime;
				merged.builds[buildKey(action)] = exec;
				executableActions.push(action);
			}
			else if (action.type === "MAINTAIN_CONSTRUCTION")
			{
				if (action.kind === "field")
					continue;
				const taskId = this.activeTaskByKind[action.kind];
				if (!taskId)
					continue;
				const existing = this.constructionWorkers(gameState, taskId).map(ent => ent.id());
				const oneFrame = { ...frame, "actions": [action], "training": { "action": "NONE", "batch": 0 } };
				const prepared = prepareMechanicalExecution(gameState, oneFrame, {
					"taskIds": { [buildKey(action)]: taskId, [action.kind]: taskId },
					"existingBuilderIds": { [buildKey(action)]: existing, [action.kind]: existing },
					"training": {}
				}, { "placement": {} }, this.foundationTracker, { "playerId": PlayerID });
				if (!prepared.execution.maintenance[action.kind])
					continue;
				merged.maintenance[action.kind] = prepared.execution.maintenance[action.kind];
				executableActions.push(action);
			}
			else
				executableActions.push(action);
		}
		return {
			"frame": { ...frame, "actions": executableActions },
			"execution": merged
		};
	}

	applySecondaryDepletionFieldTrigger(gameState, frame)
	{
		if (!this.secondaryNaturalDepletionFieldPending)
			return frame;
		if (this.builtByClass(gameState, "Field").length > 0)
		{
			this.secondaryNaturalDepletionFieldPending = false;
			return frame;
		}
		if (this.foundationsByClass(gameState, "Field").length > 0 || this.activeFieldTasks.length > 0 ||
		    (frame.actions || []).some(action => action.kind === "field" && action.type !== "RESERVE"))
			return frame;
		return { ...frame, "actions": [...(frame.actions || []), {
			"type": "BUILD", "kind": "field", "role": "secondary_depletion", "priority": 98,
			"builderPool": ["food", "food_owned", "farm"],
			"reason": "secondary natural-food branch exhausted; establish first permanent field"
		}] };
	}

	actionPorts()
	{
		return {
			"returnResources": returnResources,
			"createFixedConstructionPlan": (gameState, type, metadata, position, angle) =>
				new ExpertFixedConstructionPlan(gameState, type, metadata, position, angle),
			"createTrainingPlan": (gameState, type, metadata, number, maxMerge) =>
				new TrainingPlan(gameState, type, metadata, number, maxMerge)
		};
	}

	setFoodHomeForCluster(gameState, ent, cluster)
	{
		if (!ent || !cluster)
			return;
		const sources = (cluster.ids || []).map(id => gameState.getEntityById(Number(id))).filter(source => source && entityPosition(source));
		const clusterCenter = Array.isArray(cluster.center) ? cluster.center : centerOf(sources);
		if (!clusterCenter)
			return;
		const farms = this.builtByClass(gameState, "Farmstead").filter(farm => farm && entityPosition(farm));
		farms.sort((a, b) => SquareVectorDistance(a.position(), clusterCenter) - SquareVectorDistance(b.position(), clusterCenter) || a.id() - b.id());
		const nearest = farms[0];
		if (nearest && SquareVectorDistance(nearest.position(), clusterCenter) <= 50 * 50)
			ent.setMetadata(PlayerID, FOOD_HOME_FARMSTEAD, nearest.id());
		else
		{
			const oldId = Number(ent.getMetadata(PlayerID, FOOD_HOME_FARMSTEAD));
			const old = Number.isFinite(oldId) ? gameState.getEntityById(oldId) : undefined;
			if (!old || !entityPosition(old) || SquareVectorDistance(old.position(), clusterCenter) > 50 * 50)
				ent.setMetadata(PlayerID, FOOD_HOME_FARMSTEAD, undefined);
		}
	}

	assignFoodWorker(gameState, ent, foodNetwork, accessIndex)
	{
		const network = foodNetwork && Array.isArray(foodNetwork.clusters) ? foodNetwork : { clusters: [] };
		const clusters = network.clusters;
		const siteIds = decodeFoodSite(ent.getMetadata(PlayerID, FOOD_SITE));
		const previousSiteIds = decodeFoodSite(ent.getMetadata(PlayerID, FOOD_PREVIOUS_SITE));
		let lockedSiteIds = decodeFoodSite(ent.getMetadata(PlayerID, NATURAL_FOOD_LOCK));
		let lockedCluster = matchingFoodCluster(clusters, lockedSiteIds);
		if (lockedSiteIds.length)
		{
			// IT14.29: the lock is authoritative at the SUPPLY level. IT14.27 trusted
			// the connected-cluster snapshot; when that snapshot temporarily stopped
			// reporting the covered secondary branch, workers abandoned berries that
			// were visibly still alive and started fields. Verify every locked entity
			// directly before declaring the branch exhausted.
			const lockedLive = lockedSiteIds.map(id => gameState.getEntityById(Number(id))).filter(supply =>
				supply && entityPosition(supply) && supply.resourceSupplyAmount &&
				supply.resourceSupplyAmount() > 0 && this.HQ.territoryMap.getOwner(supply.position()) === PlayerID);
			const lockedRemaining = lockedLive.reduce((sum, supply) =>
				sum + Math.max(0, Number(supply.resourceSupplyAmount()) || 0), 0);
			if (lockedRemaining > 0)
			{
				const liveIds = lockedLive.map(supply => supply.id());
				lockedCluster = {
					...(lockedCluster || {}),
					ids: liveIds,
					center: centerOf(lockedLive) || lockedCluster && lockedCluster.center,
					remaining: lockedRemaining,
					availableIds: lockedLive.filter(supply => !isSupplyFull(gameState, supply)).map(supply => supply.id())
				};
			}
			else
			{
				// Release only after the actual locked supplies are genuinely exhausted.
				if (this.builtByClass(gameState, "Field").length === 0 && !this.secondaryNaturalDepletionFieldPending)
				{
					this.secondaryNaturalDepletionFieldPending = true;
					aiWarn("[EXPERT-FARM] secondary natural branch exhausted; forcing first field");
				}
				ent.setMetadata(PlayerID, NATURAL_FOOD_LOCK, undefined);
				ent.setMetadata(PlayerID, EXPERT_WICKER_BRANCH, undefined);
				if (Number.isFinite(Number(ent.getMetadata(PlayerID, FOOD_HOME_FARMSTEAD))))
					ent.setMetadata(PlayerID, FOOD_HOME_PERMANENT, true);
				lockedSiteIds = [];
				lockedCluster = undefined;
			}
		}

		// Once a dedicated natural-food district converts to permanent farming,
		// keep its civilians local. They take/construct a nearby field first; while
		// the planner creates that capacity they may chop wood temporarily, but they
		// do not walk across the territory to another berry patch or distant farm.
		if (ent.getMetadata(PlayerID, FOOD_HOME_PERMANENT) === true)
		{
			const homeId = Number(ent.getMetadata(PlayerID, FOOD_HOME_FARMSTEAD));
			const home = Number.isFinite(homeId) ? gameState.getEntityById(homeId) : undefined;
			if (home && entityPosition(home))
			{
				if (this.assignFarmWorker(gameState, ent, accessIndex))
					return true;
				if (this.assignFoodInfrastructureWorker(gameState, ent))
					return true;

				// Locality is strong, not suicidal. Once this home district really has the
				// user's 3+ fields AND no legal local slot remains even with the modest
				// exhausted-dropsite reuse ring, release the crew to the next food district.
				const policy = mergePolicy();
				const localFields = this.builtByClass(gameState, "Field").filter(field =>
					entityPosition(field) && SquareVectorDistance(field.position(), home.position()) <= 42 * 42).length;
				const localPendingFields = this.foundationsByClass(gameState, "Field").filter(field =>
					entityPosition(field) && SquareVectorDistance(field.position(), home.position()) <= 42 * 42).length;
				const localSlots = this.fieldSlotsAt(gameState, home.position(), home.id(), accessIndex, undefined,
					Math.max(1, policy.fieldsPerFarmstead - localFields - localPendingFields), Math.max(2.0, Number(policy.existingFarmsteadReuseMaxBorderGap) || 4.0));
				const normalSaturatedHome = localFields >= policy.minimumFieldsBeforeNextFarmHub;
				const constrainedOpeningHome = this.builtByClass(gameState, "Farmstead").length === 1 &&
					localFields >= policy.minimumFieldsBeforeConstrainedOpeningFarmHub;
				if ((normalSaturatedHome || constrainedOpeningHome) && localPendingFields === 0 && !localSlots.length)
				{
					ent.setMetadata(PlayerID, FOOD_HOME_PERMANENT, undefined);
					ent.setMetadata(PlayerID, FOOD_HOME_FARMSTEAD, undefined);
					aiWarn("[EXPERT-FARM-DISTRICT] released saturated home=" + homeId + " worker=" + ent.id() + " fields=" + localFields +
						(constrainedOpeningHome && !normalSaturatedHome ? " constrained-opening=true" : ""));
				}
				else
				{
					if (ent.getMetadata(PlayerID, JOB_METADATA) !== "food_owned")
						ent.setMetadata(PlayerID, JOB_METADATA, "food_owned");
					this.assignSafeFallback(gameState, ent, accessIndex, ["wood"]);
					this.diagnoseWorkerOrder(ent, "food-home-wait", homeId, "LOCAL_FARM_DISTRICT_WAIT");
					return false;
				}
			}
			ent.setMetadata(PlayerID, FOOD_HOME_FARMSTEAD, undefined);
			ent.setMetadata(PlayerID, FOOD_HOME_PERMANENT, undefined);
		}

		const metadataTargetId = Number(ent.getMetadata(PlayerID, SUPPLY_ID));
		const existingTarget = Number.isFinite(metadataTargetId) ? gameState.getEntityById(metadataTargetId) : undefined;
		const existingTargetLive = !!(existingTarget && existingTarget.resourceSupplyAmount &&
			existingTarget.resourceSupplyAmount() > 0 && entityPosition(existingTarget) &&
			this.HQ.territoryMap.getOwner(existingTarget.position()) === PlayerID);
		let cluster = lockedCluster || matchingFoodCluster(clusters, siteIds);
		const now = Number(gameState.ai.elapsedTime) || 0;
		const lastSwitch = Number(ent.getMetadata(PlayerID, FOOD_SITE_CHANGED_AT));
		// A worker already gathering/approaching a live source counts as having capacity
		// even when isSupplyFull() says the source is full -- that worker is part of the
		// occupancy. This is the IT14.13 oscillation fix.
		const stickyCurrentTarget = !!(cluster && existingTargetLive && cluster.ids.includes(metadataTargetId));
		const currentAllowed = !!(cluster && this.naturalFoodClusterAllowsWorker(gameState, cluster, ent));
		const currentHasCapacity = !!(cluster && (stickyCurrentTarget ||
			currentAllowed && this.naturalFoodClusterHasPreferredSlot(gameState, cluster, ent)));
		const currentRemaining = cluster ? Math.max(0, Number(cluster.remaining) || 0) : 0;

		let ranked = lockedCluster ? [lockedCluster] : clusters.filter(candidate =>
			candidate.availableIds && candidate.availableIds.length &&
			this.naturalFoodClusterAllowsWorker(gameState, candidate, ent) &&
			this.naturalFoodClusterHasPreferredSlot(gameState, candidate, ent));
		// Hard anti-A-B-A invariant: while the CURRENT committed site still contains food,
		// never switch straight back to the site this worker just abandoned. A natural-food
		// lock is even stronger: no other cluster is eligible until that branch is exhausted.
		if (!lockedCluster && cluster && currentRemaining > 0 && previousSiteIds.length)
			ranked = ranked.filter(candidate => !matchingFoodCluster([candidate], previousSiteIds));
		if (!lockedCluster)
			ranked.sort((a, b) => this.foodClusterScore(gameState, ent, b) - this.foodClusterScore(gameState, ent, a) || a.ids[0] - b.ids[0]);
		const best = ranked[0];
		if (!lockedCluster && (!cluster || !currentHasCapacity))
		{
			const canSwitch = shouldSwitchFoodSite({
				currentCluster: cluster, currentHasCapacity, currentRemaining, bestCluster: best,
				lastSwitchTime: Number.isFinite(lastSwitch) ? lastSwitch : -99999, now,
				minimumCommitSeconds: mergePolicy().foodSiteMinimumCommitSeconds
			});
			if (canSwitch || !cluster && best)
			{
				const oldSite = encodeFoodSite(siteIds);
				const newSite = encodeFoodSite(best.ids);
				if (cluster && oldSite && oldSite !== newSite)
					ent.setMetadata(PlayerID, FOOD_PREVIOUS_SITE, oldSite);
				cluster = best;
				ent.setMetadata(PlayerID, FOOD_SITE, newSite);
				ent.setMetadata(PlayerID, FOOD_SITE_CHANGED_AT, now);
				if (oldSite && oldSite !== newSite)
					aiWarn("[EXPERT-FOOD-SITE] worker=" + ent.id() + " committed " + oldSite + " -> " + newSite);
			}
		}

		if (!cluster || (!stickyCurrentTarget && (!cluster.availableIds || !cluster.availableIds.length ||
			!this.naturalFoodClusterAllowsWorker(gameState, cluster, ent) ||
			!this.naturalFoodClusterHasPreferredSlot(gameState, cluster, ent))))
		{
			// Hysteresis is never allowed to create an idle worker. If another natural
			// cluster has capacity, commit to it immediately. Locked branch workers do not
			// enter this path while their assigned source remains live.
			if (!lockedCluster && best && best.availableIds && best.availableIds.length)
			{
				const oldSite = encodeFoodSite(siteIds);
				const newSite = encodeFoodSite(best.ids);
				if (cluster && oldSite && oldSite !== newSite)
					ent.setMetadata(PlayerID, FOOD_PREVIOUS_SITE, oldSite);
				cluster = best;
				ent.setMetadata(PlayerID, FOOD_SITE, newSite);
				ent.setMetadata(PlayerID, FOOD_SITE_CHANGED_AT, now);
			}
		}

		if (!cluster || (!stickyCurrentTarget && (!cluster.availableIds || !cluster.availableIds.length ||
			!this.naturalFoodClusterAllowsWorker(gameState, cluster, ent) ||
			!this.naturalFoodClusterHasPreferredSlot(gameState, cluster, ent))))
		{
			// Natural food is exhausted or this connected patch has reached the preferred
			// eight-worker ceiling. Prefer a productive permanent-food slot.
			// If the preferred three-worker slots are temporarily full, assignFarmWorker
			// may use an unused hard engine slot rather than leave this civilian idle.
			if (this.assignFarmWorker(gameState, ent, accessIndex))
				return true;
			// A food civilian with no completed slot helps finish the next field/farmstead.
			// This is productive work on its own food infrastructure, not a resource shuffle.
			if (this.assignFoodInfrastructureWorker(gameState, ent))
				return true;
			// Do not park a ninth civilian beside a full berry patch. Keep this worker
			// FOOD-OWNED, but let it chop at the primary woodsite temporarily. Because
			// the metadata remains food_owned, the next update immediately retries food
			// and claims a newly opened farm slot instead of inflating woodCivilians.
			if (ent.getMetadata(PlayerID, JOB_METADATA) !== "food_owned")
				ent.setMetadata(PlayerID, JOB_METADATA, "food_owned");
			// assignSafeFallback issues a wood gather order without changing JOB_METADATA.
			// That is the exact temporary-overflow distinction we need here.
			this.assignSafeFallback(gameState, ent, accessIndex, ["wood"]);
			this.diagnoseWorkerOrder(ent, "food-capacity-miss", 0, currentRemaining > 0 ? "NATURAL_PATCH_CAP_TEMP_WOOD" : "NO_FOOD_CAPACITY_TEMP_WOOD");
			return false;
		}

		// Every civilian working a natural-food district remembers the nearby farmstead,
		// not just the two/three workers who happened to construct it. When the natural
		// source expires, that locality becomes the worker's preferred permanent farm district.
		this.setFoodHomeForCluster(gameState, ent, cluster);

		let target = Number.isFinite(metadataTargetId) && cluster.ids.includes(metadataTargetId) ? existingTarget : undefined;
		if (!(target && target.resourceSupplyAmount && target.resourceSupplyAmount() > 0))
		{
			let candidates = cluster.availableIds.map(id => gameState.getEntityById(id)).filter(s => s && entityPosition(s));
			// IT14.22: NEW natural-food assignments are one civilian per live supply.
			// When every bush/tree already has its preferred worker, the next food-owned
			// civilian starts/helps a field instead of becoming worker #2 on a berry.
			const loads = this.naturalFoodSupplyLoads(gameState, cluster, ent.id());
			candidates = candidates.filter(s => {
				const limit = this.naturalFoodSupplyWorkerLimit(gameState, s.id(), cluster);
				return !Number.isFinite(limit) || (loads.get(s.id()) || 0) < limit;
			});
			candidates.sort((a, b) =>
				(loads.get(a.id()) || 0) - (loads.get(b.id()) || 0) ||
				SquareVectorDistance(ent.position(), a.position()) - SquareVectorDistance(ent.position(), b.position()) ||
				a.id() - b.id());
			target = candidates[0];
			if (target)
				aiWarn("[EXPERT-BERRIES] worker=" + ent.id() + " supply=" + target.id() + " priorLoad=" + (loads.get(target.id()) || 0));
			else
			{
				if (this.assignFarmWorker(gameState, ent, accessIndex))
					return true;
				if (this.assignFoodInfrastructureWorker(gameState, ent))
					return true;
				if (ent.getMetadata(PlayerID, JOB_METADATA) !== "food_owned")
					ent.setMetadata(PlayerID, JOB_METADATA, "food_owned");
				this.assignSafeFallback(gameState, ent, accessIndex, ["wood"]);
				this.diagnoseWorkerOrder(ent, "food-capacity-miss", 0, "ONE_PER_NATURAL_SUPPLY_TEMP_WOOD");
				return false;
			}
		}
		if (!target)
			return false;

		if (this.depositBeforeResourceRetarget(gameState, ent, "food", "food-site"))
			return true;
		ent.setMetadata(PlayerID, SUPPLY_ID, target.id());
		ent.setMetadata(PlayerID, "gather-type", "food");
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
		if (hasLiveGatherOrder(ent, target.id()))
		{
			this.diagnoseWorkerOrder(ent, "food-site", target.id(), "CONFIRMED");
			return true;
		}
		if (this.HQ.basesManager && this.HQ.basesManager.AddTCGatherer)
			this.HQ.basesManager.AddTCGatherer(target.id());
		const order = ensureGatherOrder(ent, target);
		this.diagnoseWorkerOrder(ent, "food-site", target.id(), order.status);
		return order.status !== "FAILED";
	}

	assignFoodInfrastructureWorker(gameState, ent)
	{
		if (!ent || !entityPosition(ent))
			return false;
		let foundations = [
			...this.foundationsByClass(gameState, "Field").map(foundation => ({ foundation, rank: 0, kind: "field" })),
			...this.foundationsByClass(gameState, "Farmstead").map(foundation => ({ foundation, rank: 1, kind: "farmstead" }))
		].filter(item => item.foundation && entityPosition(item.foundation));
		if (!foundations.length)
			return false;
		const homeFarmsteadId = Number(ent.getMetadata(PlayerID, FOOD_HOME_FARMSTEAD));
		const homeFarmstead = Number.isFinite(homeFarmsteadId) ? gameState.getEntityById(homeFarmsteadId) : undefined;
		if (homeFarmstead && entityPosition(homeFarmstead))
		{
			const radius = Math.max(30, Number(mergePolicy().farmWorkerHomeRadius) || 55);
			const local = foundations.filter(item =>
				SquareVectorDistance(item.foundation.position(), homeFarmstead.position()) <= radius * radius);
			// A natural-food crew should build its OWN district, not cross the territory
			// to finish somebody else's field. If no local foundation exists yet, stay
			// productive temporarily and let the field planner create one here.
			if (!local.length)
				return false;
			foundations = local;
		}
		else if (Number.isFinite(homeFarmsteadId))
			ent.setMetadata(PlayerID, FOOD_HOME_FARMSTEAD, undefined);
		foundations.sort((a, b) =>
			a.rank - b.rank ||
			SquareVectorDistance(ent.position(), a.foundation.position()) - SquareVectorDistance(ent.position(), b.foundation.position()) ||
			a.foundation.id() - b.foundation.id());
		const target = foundations[0];
		const carrying = ent.resourceCarrying ? (ent.resourceCarrying() || []) : [];
		if (carrying.some(item => item && Number(item.amount) > 0))
		{
			const queued = returnResources(gameState, ent);
			this.diagnoseWorkerOrder(ent, "food-build:" + target.kind, target.foundation.id(), queued ? "RETURNING_RESOURCES" : "NO_DROPSITE");
			return queued;
		}
		if (hasLiveRepairOrder(ent, target.foundation.id()))
		{
			this.diagnoseWorkerOrder(ent, "food-build:" + target.kind, target.foundation.id(), "CONFIRMED");
			return true;
		}
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_BUILDER);
		const order = ensureRepairOrder(ent, target.foundation, false);
		this.diagnoseWorkerOrder(ent, "food-build:" + target.kind, target.foundation.id(), order.status);
		return order.status !== "FAILED";
	}

	assignFarmWorker(gameState, ent, accessIndex)
	{
		const policy = mergePolicy();
		const fields = this.builtByClass(gameState, "Field").filter(field =>
			entityPosition(field) && field.resourceSupplyAmount && field.resourceSupplyAmount() > 0);
		if (!fields.length)
			return false;

		const lockedId = Number(ent.getMetadata(PlayerID, FARM_LOCK));
		if (Number.isFinite(lockedId))
		{
			const locked = fields.find(field => field.id() === lockedId);
			if (locked)
			{
				if (this.depositBeforeResourceRetarget(gameState, ent, "food", "locked-farm"))
					return true;
				ent.setMetadata(PlayerID, JOB_METADATA, "farm");
				ent.setMetadata(PlayerID, SUPPLY_ID, locked.id());
				ent.setMetadata(PlayerID, "gather-type", "food");
				ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
				if (hasLiveGatherOrder(ent, locked.id()))
				{
					this.diagnoseWorkerOrder(ent, "farm-lock", locked.id(), "CONFIRMED");
					return true;
				}
				const order = ensureGatherOrder(ent, locked);
				this.diagnoseWorkerOrder(ent, "farm-lock", locked.id(), order.status);
				return order.status !== "FAILED";
			}
			ent.setMetadata(PlayerID, FARM_LOCK, undefined);
		}

		// Count permanent field assignments. A civilian becomes permanently bound to
		// the first completed field it successfully takes. This eliminates the IT9
		// farm->wood->farm churn completely.
		const loads = new Map(fields.map(field => [field.id(), 0]));
		for (const worker of gameState.getOwnUnits().values())
		{
			if (!worker || !worker.getMetadata)
				continue;
			const targetId = Number(worker.getMetadata(PlayerID, FARM_LOCK));
			if (loads.has(targetId))
				loads.set(targetId, loads.get(targetId) + 1);
		}
		const preferredCapacity = field => {
			const hard = field.maxGatherers ? Number(field.maxGatherers()) : policy.farmersPerField;
			return Math.max(1, Math.min(policy.farmersPerField, Number.isFinite(hard) && hard > 0 ? hard : policy.farmersPerField));
		};

		let available = fields.filter(field => (loads.get(field.id()) || 0) < preferredCapacity(field));
		let overflow = false;
		if (!available.length)
		{
			// Preferred capacity is three farmers, but zero productivity is worse than a
			// fourth/fifth farmer. Use an unused hard engine slot as the emergency
			// no-idle fallback. The planner is simultaneously building more fields, so this
			// path should be rare in a healthy opening.
			available = fields.filter(field => {
				const hard = field.maxGatherers ? Number(field.maxGatherers()) : policy.farmersPerField;
				return Number.isFinite(hard) && hard > 0 && (loads.get(field.id()) || 0) < hard && !isSupplyFull(gameState, field);
			});
			overflow = available.length > 0;
		}
		const homeFarmsteadId = Number(ent.getMetadata(PlayerID, FOOD_HOME_FARMSTEAD));
		const homeFarmstead = Number.isFinite(homeFarmsteadId) ? gameState.getEntityById(homeFarmsteadId) : undefined;
		if (homeFarmstead && entityPosition(homeFarmstead))
		{
			const radius = Math.max(30, Number(policy.farmWorkerHomeRadius) || 55);
			const local = available.filter(field =>
				SquareVectorDistance(field.position(), homeFarmstead.position()) <= radius * radius);
			if (!local.length)
				return false;
			available = local;
		}
		else if (Number.isFinite(homeFarmsteadId))
			ent.setMetadata(PlayerID, FOOD_HOME_FARMSTEAD, undefined);
		if (!available.length)
			return false;
		available.sort((a, b) => {
			const loadDiff = (loads.get(a.id()) || 0) - (loads.get(b.id()) || 0);
			if (loadDiff)
				return loadDiff;
			return SquareVectorDistance(ent.position(), a.position()) - SquareVectorDistance(ent.position(), b.position()) || a.id() - b.id();
		});
		const target = available[0];
		if (overflow)
			aiWarn("[EXPERT-NO-IDLE] worker=" + ent.id() + " using emergency hard field capacity field=" + target.id());

		if (this.depositBeforeResourceRetarget(gameState, ent, "food", "farm"))
			return true;
		// IT14.31: preferred 1st-3rd farmers are permanent. Emergency 4th/5th-slot
		// gatherers are productive overflow only and must remain releasable when wood
		// becomes the constrained resource.
		if (overflow)
			ent.setMetadata(PlayerID, FARM_LOCK, undefined);
		else
			ent.setMetadata(PlayerID, FARM_LOCK, target.id());
		ent.setMetadata(PlayerID, FOOD_SITE, undefined);
		ent.setMetadata(PlayerID, FOOD_SITE_CHANGED_AT, undefined);
		ent.setMetadata(PlayerID, FOOD_PREVIOUS_SITE, undefined);
		ent.setMetadata(PlayerID, JOB_METADATA, "farm");
		ent.setMetadata(PlayerID, PENDING_JOB_METADATA, undefined);
		ent.setMetadata(PlayerID, SUPPLY_ID, target.id());
		ent.setMetadata(PlayerID, "gather-type", "food");
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
		if (this.HQ.basesManager && this.HQ.basesManager.AddTCGatherer)
			this.HQ.basesManager.AddTCGatherer(target.id());
		const order = ensureGatherOrder(ent, target);
		this.diagnoseWorkerOrder(ent, "farm-lock", target.id(), order.status);
		return order.status !== "FAILED";
	}

	workerWoodsite(gameState, ent, primaryWoodsite, accessIndex)
	{
		if (!ent || !ent.getMetadata)
			return primaryWoodsite;
		const assigned = ent.getMetadata(PlayerID, WORKSITE_ID);
		let position;
		let entityId;
		if (assigned === "opening" && this.initialWoodSelection && this.initialWoodSelection.position)
			position = this.initialWoodSelection.position;
		else
		{
			const id = Number(assigned);
			const store = Number.isFinite(id) ? gameState.getEntityById(id) : undefined;
			if (store && entityPosition(store) && hasClass(store, "Storehouse"))
			{
				position = store.position();
				entityId = store.id();
			}
		}
		if (!position)
			return primaryWoodsite;

		const policy = mergePolicy();
		const trees = this.woodTreesAt(gameState, position, accessIndex);
		const metrics = summarizeWoodTrees(trees);
		// Keep the worker at the assigned site while any usable local wood remains.
		// A new storehouse is for NEW workers, not a reason to march the old woodline.
		if (metrics.availableTargets > 0 || metrics.localWoodAmount > policy.localWoodCriticalAmount)
			return { trees, ...metrics, position, entityId };

		// If the tight 30m ring is empty but the old cluster still has salvageable trees
		// nearby, move only a few established lumberjacks per window. This avoids the
		// IT14.6 "whole woodline marches at once" transition while new workers immediately
		// exploit the newly-built dropsite.
		const salvageTrees = this.woodTreesAt(gameState, position, accessIndex, policy.woodMigrationSalvageRadius);
		const salvage = summarizeWoodTrees(salvageTrees);
		const primaryId = primaryWoodsite && Number.isFinite(Number(primaryWoodsite.entityId)) ? Number(primaryWoodsite.entityId) : undefined;
		// Do not "migrate" a worker away from a site only to assign the exact same site
		// again. IT14.9 repeatedly did this and created apparent A->B->A churn.
		if (Number.isFinite(primaryId) && Number.isFinite(Number(entityId)) && primaryId === Number(entityId))
			return { trees: salvageTrees, ...salvage, position, entityId };
		const now = Number(gameState.ai.elapsedTime) || 0;
		if (salvage.availableTargets > 0 && salvage.localWoodAmount > 0)
		{
			if (now - this.woodMigrationWindowStart >= policy.woodMigrationWindowSeconds)
			{
				this.woodMigrationWindowStart = now;
				this.woodMigrationsThisWindow = 0;
			}
			if (this.woodMigrationsThisWindow >= policy.woodMigrationBatch)
				return { trees: salvageTrees, ...salvage, position, entityId };
			++this.woodMigrationsThisWindow;
			aiWarn("[EXPERT-WOOD] staged migration worker=" + ent.id() + " oldSite=" + (entityId || assigned) +
				" batch=" + this.woodMigrationsThisWindow + "/" + policy.woodMigrationBatch);
		}

		ent.setMetadata(PlayerID, WORKSITE_ID, undefined);
		return primaryWoodsite;
	}

	recoverWoodWorker(gameState, ent, accessIndex)
	{
		// Permanent lumberjacks stay lumberjacks. Stone/metal have their own strategic
		// worker lanes; silently turning a dead woodline into a mineral boom hid IT14.53.
		if (this.assignSafeFallback(gameState, ent, accessIndex, ["wood"]))
			return true;
		if (this.phaseWoodCrisis || this.woodIncomeStalled)
			return this.assignEmergencyWood(gameState, ent, accessIndex);
		return false;
	}

	assignWoodWorker(gameState, ent, woodsite, accessIndex)
	{
		woodsite = this.workerWoodsite(gameState, ent, woodsite, accessIndex) || woodsite;
		const trees = woodsite.trees || [];
		const metadataTargetId = ent.getMetadata(PlayerID, SUPPLY_ID);
		const currentId = metadataTargetId ?? currentTargetId(ent);
		const current = currentId !== undefined ? gameState.getEntityById(currentId) : undefined;
		let currentIsLiveWood = false;
		if (current && current.resourceSupplyAmount && current.resourceSupplyAmount() > 0 && current.resourceSupplyType)
		{
			const type = current.resourceSupplyType();
			currentIsLiveWood = !!(type && type.generic === "wood");
		}
		const currentTreeValid = !!(current && currentIsLiveWood && trees.some(tree => tree.id === current.id()) &&
			current.resourceSupplyAmount && current.resourceSupplyAmount() > 0);

		// Preserve a productive tree only while it belongs to THIS worker's committed
		// worksite. A live tree in an old/different forest is no longer sufficient reason
		// to send the worker back across the map.
		if (currentTreeValid && hasLiveGatherOrder(ent, current.id()))
		{
			this.diagnoseWorkerOrder(ent, "wood", current.id(), "CONFIRMED");
			return;
		}

		let target = currentTreeValid ? current : undefined;
		if (!target)
		{
			const observation = {
				"currentTreeValid": false,
				"availableLocalTargets": trees.filter(tree => !tree.saturated).length,
				"saturatedLocalTargets": trees.filter(tree => tree.saturated).length
			};
			const action = decideWoodWorkerTarget(observation);
			if (action.action !== "TAKE_LOCAL_TREE")
			{
				this.recoverWoodWorker(gameState, ent, accessIndex);
				return;
			}
			const candidates = trees.filter(tree => !tree.saturated).map(tree => ({
				...tree,
				"workerDistance": Math.sqrt(SquareVectorDistance(ent.position(), tree.position))
			}));
			candidates.sort((a, b) => (a.dropDistance*10 + a.workerDistance) - (b.dropDistance*10 + b.workerDistance) || a.id - b.id);
			if (!candidates.length)
			{
				this.recoverWoodWorker(gameState, ent, accessIndex);
				return;
			}
			target = gameState.getEntityById(candidates[0].id);
			if (!target)
			{
				this.recoverWoodWorker(gameState, ent, accessIndex);
				return;
			}
		}

		if (this.depositBeforeResourceRetarget(gameState, ent, "wood", "wood"))
			return;
		const targetChanged = metadataTargetId !== target.id();
		ent.setMetadata(PlayerID, SUPPLY_ID, target.id());
		ent.setMetadata(PlayerID, "gather-type", "wood");
		const worksiteId = woodsite && Number.isFinite(Number(woodsite.entityId)) ? Number(woodsite.entityId) :
			(this.primaryWoodWorksite && this.primaryWoodWorksite.entityId || "opening");
		ent.setMetadata(PlayerID, WORKSITE_ID, worksiteId);
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
		if (targetChanged && this.HQ.basesManager && this.HQ.basesManager.AddTCGatherer)
			this.HQ.basesManager.AddTCGatherer(target.id());
		const order = ensureGatherOrder(ent, target);
		this.diagnoseWorkerOrder(ent, "wood", target.id(), order.status);
	}

	resourceGenericForSupply(supply)
	{
		if (!supply || !supply.resourceSupplyType)
			return undefined;
		try
		{
			const type = supply.resourceSupplyType();
			return type && type.generic;
		}
		catch (e) {}
		return undefined;
	}

	resourceDropsites(gameState, generic)
	{
		const out = [];
		for (const ent of gameState.getOwnStructures().values())
		{
			if (!ent || !entityPosition(ent) || !ent.resourceDropsiteTypes ||
			    ent.foundationProgress && ent.foundationProgress() !== undefined)
				continue;
			const types = ent.resourceDropsiteTypes();
			if (types && types.includes(generic))
				out.push(ent);
		}
		return out;
	}

	resourceDropsiteForSupply(gameState, supply, generic, radius = Infinity)
	{
		if (!supply || !entityPosition(supply))
			return undefined;
		const r2 = Number.isFinite(radius) ? radius * radius : Infinity;
		let best;
		let bestDist = Infinity;
		for (const dropsite of this.resourceDropsites(gameState, generic))
		{
			const d = SquareVectorDistance(supply.position(), dropsite.position());
			if (d <= r2 && d < bestDist)
			{
				best = dropsite;
				bestDist = d;
			}
		}
		return best ? { "dropsite": best, "distance": bestDist } : undefined;
	}

	trackResourceRoundTrip(gameState, ent)
	{
		if (!ent || !ent.getMetadata)
			return;
		const now = Number(gameState.ai.elapsedTime) || 0;
		const state = ent.unitAIState ? String(ent.unitAIState() || "") : "";
		const supplyId = Number(ent.getMetadata(PlayerID, SUPPLY_ID));
		const supply = Number.isFinite(supplyId) ? gameState.getEntityById(supplyId) : undefined;
		const generic = this.resourceGenericForSupply(supply) || ent.getMetadata(PlayerID, "gather-type");

		if (state.includes("RETURNRESOURCE") || state.includes("RETURNINGRESOURCE"))
		{
			if (!Number.isFinite(Number(ent.getMetadata(PlayerID, EXPERT_RETURN_STARTED_AT))) &&
			    Number.isFinite(supplyId) && ["wood", "stone", "metal", "food"].includes(generic))
			{
				ent.setMetadata(PlayerID, EXPERT_RETURN_STARTED_AT, now);
				ent.setMetadata(PlayerID, EXPERT_RETURN_SUPPLY_ID, supplyId);
				ent.setMetadata(PlayerID, EXPERT_RETURN_GENERIC, generic);
			}
			return;
		}

		const started = Number(ent.getMetadata(PlayerID, EXPERT_RETURN_STARTED_AT));
		const measuredSupplyId = Number(ent.getMetadata(PlayerID, EXPERT_RETURN_SUPPLY_ID));
		const measuredGeneric = ent.getMetadata(PlayerID, EXPERT_RETURN_GENERIC);
		if (!Number.isFinite(started))
			return;
		if (state.includes("GATHER.GATHERING") && Number.isFinite(measuredSupplyId) && measuredSupplyId === supplyId)
		{
			const duration = Math.max(0, now - started);
			if (duration > 0.25 && duration < 60)
			{
				const old = this.resourceRoundTripBySupply[measuredSupplyId];
				const previous = old && Number(old.seconds);
				this.resourceRoundTripBySupply[measuredSupplyId] = {
					"seconds": Number.isFinite(previous) ? previous * 0.65 + duration * 0.35 : duration,
					"generic": measuredGeneric,
					"at": now
				};
			}
			ent.setMetadata(PlayerID, EXPERT_RETURN_STARTED_AT, undefined);
			ent.setMetadata(PlayerID, EXPERT_RETURN_SUPPLY_ID, undefined);
			ent.setMetadata(PlayerID, EXPERT_RETURN_GENERIC, undefined);
			return;
		}
		// After depositing, UnitAI normally walks back to the same supply before
		// gathering again. Keep the timer alive through that approach so the measured
		// value reflects the real round trip, including obstacle detours.
		if ((state.includes("GATHER.APPROACHING") || state.includes("GATHER.WALKING") || state.includes("WALKING")) &&
		    Number.isFinite(measuredSupplyId) && measuredSupplyId === supplyId && now - started < 60)
			return;
		ent.setMetadata(PlayerID, EXPERT_RETURN_STARTED_AT, undefined);
		ent.setMetadata(PlayerID, EXPERT_RETURN_SUPPLY_ID, undefined);
		ent.setMetadata(PlayerID, EXPERT_RETURN_GENERIC, undefined);
	}

	activeResourceDistricts(gameState, accessIndex)
	{
		const policy = mergePolicy();
		const radius2 = Math.pow(Number(policy.resourceServiceClusterRadius) || 18, 2);
		const workerTargets = [];
		for (const worker of gameState.getOwnUnits().values())
		{
			if (!worker || !worker.getMetadata || !entityPosition(worker) || !this.isExpertEconomyEntity(worker))
				continue;
			if (worker.getMetadata(PlayerID, "PartOfArmy") || worker.getMetadata(PlayerID, TASK_KEY) !== undefined)
				continue;
			const supplyId = Number(worker.getMetadata(PlayerID, SUPPLY_ID));
			const supply = Number.isFinite(supplyId) ? gameState.getEntityById(supplyId) : undefined;
			if (!supply || !entityPosition(supply) || !supply.resourceSupplyAmount || supply.resourceSupplyAmount() <= 0)
				continue;
			const generic = this.resourceGenericForSupply(supply);
			if (!["stone", "metal", "food"].includes(generic))
				continue;
			if (generic === "food" && (hasClass(supply, "Field") || hasClass(supply, "Animal")))
				continue;
			if (getLandAccess(gameState, supply) !== accessIndex || this.HQ.territoryMap.getOwner(supply.position()) !== PlayerID)
				continue;
			workerTargets.push({ worker, supply, generic });
		}

		const districts = [];
		for (const item of workerTargets)
		{
			let district = districts.find(d => d.generic === item.generic &&
				d.sources.some(source => SquareVectorDistance(source.position(), item.supply.position()) <= radius2));
			if (!district)
			{
				district = { "generic": item.generic, "workers": [], "sources": [] };
				districts.push(district);
			}
			district.workers.push(item.worker);
			if (!district.sources.some(source => source.id() === item.supply.id()))
				district.sources.push(item.supply);
		}

		for (const district of districts)
		{
			district.center = centerOf(district.sources);
			district.remaining = district.sources.reduce((sum, source) => sum + Math.max(0, Number(source.resourceSupplyAmount()) || 0), 0);
			district.sourceIds = district.sources.map(source => source.id());
			district.dropDistance = 0;
			district.roundTripSeconds = 0;
			district.dropsite = undefined;
			for (const source of district.sources)
			{
				const service = this.resourceDropsiteForSupply(gameState, source, district.generic);
				if (service)
				{
					const distance = Math.sqrt(service.distance);
					if (distance >= district.dropDistance)
					{
						district.dropDistance = distance;
						district.dropsite = service.dropsite;
					}
				}
				else
					district.dropDistance = Infinity;
				const observed = this.resourceRoundTripBySupply[source.id()];
				if (observed && Number.isFinite(Number(observed.seconds)))
					district.roundTripSeconds = Math.max(district.roundTripSeconds, Number(observed.seconds));
			}
		}
		return districts;
	}

	resourceServiceNeed(gameState, accessIndex)
	{
		const policy = mergePolicy();
		const now = Number(gameState.ai.elapsedTime) || 0;
		if (now < (Number(policy.resourceServiceStartTime) || 120) ||
		    now - this.lastResourceServiceBuildTime < (Number(policy.resourceServiceRetryCooldownSeconds) || 16))
			return undefined;
		const minimumWorkers = Math.max(2, Number(policy.resourceServiceMinimumWorkers) || 3);
		const hardDistance = Math.max(6, Number(policy.resourceServiceHardDropDistance) || 11);
		const slowRoundTrip = Math.max(2, Number(policy.resourceServiceObservedRoundTripSeconds) || 3.5);
		const foodHardDistance = Math.max(hardDistance, Number(policy.resourceServiceFoodHardDropDistance) || 15);
		const foodSlowRoundTrip = Math.max(slowRoundTrip, Number(policy.resourceServiceFoodObservedRoundTripSeconds) || 4.5);
		const foodSpacing = Math.max(18, Number(policy.resourceServiceFoodFarmsteadSpacing) || 30);
		const farmsteads = this.builtByClass(gameState, "Farmstead");
		const candidates = this.activeResourceDistricts(gameState, accessIndex).filter(district =>
		{
			if (district.workers.length < minimumWorkers ||
			    district.remaining < (district.generic === "food" ?
				(Number(policy.resourceServiceMinimumNaturalFoodRemaining) || 300) :
				(Number(policy.resourceServiceMinimumMineralRemaining) || 250)))
				return false;
			if (district.generic !== "food")
				return district.dropDistance > hardDistance || district.roundTripSeconds > slowRoundTrip;
			// IT14.55: natural-food dropsites must represent a genuinely distinct district.
			// A nearby 12-13m carry is not worth another 100-wood Farmstead if another
			// Farmstead is already within the established 30m food-district spacing.
			if (!district.center || farmsteads.some(farm => entityPosition(farm) &&
			    SquareVectorDistance(farm.position(), district.center) < foodSpacing * foodSpacing))
				return false;
			return district.dropDistance > foodHardDistance || district.roundTripSeconds > foodSlowRoundTrip;
		});
		if (!candidates.length)
			return undefined;
		candidates.sort((a, b) =>
			(b.workers.length * Math.max(1, b.dropDistance) + b.roundTripSeconds * 8) -
			(a.workers.length * Math.max(1, a.dropDistance) + a.roundTripSeconds * 8));
		return candidates[0];
	}

	applyResourceServiceConstruction(gameState, frame, accessIndex)
	{
		// IT14.55: a zero-slot permanent-food deadlock outranks mineral convenience.
		// economyPlanner has already inserted the forced farm hub at higher priority.
		const deadlock = frame && frame.state && frame.economy && frame.economy.derived &&
			Number(frame.state.food.totalNaturalRemaining || 0) <= mergePolicy().foodCapacityDeadlockNaturalRemaining &&
			Number(frame.state.food.openFieldSlots || 0) <= 0 && Number(frame.economy.derived.desiredFields || 0) > this.builtByClass(gameState, "Field").length;
		if (deadlock)
			return frame;
		const need = this.resourceServiceNeed(gameState, accessIndex);
		if (!need || !need.center)
			return frame;
		const kind = need.generic === "food" ? "farmstead" : "storehouse";
		// Never cancel another dropsite obligation that this same planning frame has
		// already selected (for example natural-food expansion or wood rollover).
		// Service auditing will retry as soon as that same-kind structure is settled.
		if ((frame.actions || []).some(existing => existing && existing.kind === kind &&
		    (existing.type === "BUILD" || existing.type === "RESERVE")) ||
		    this.activeTaskByKind[kind] ||
		    this.foundationsByClass(gameState, kind === "farmstead" ? "Farmstead" : "Storehouse").length)
			return frame;
		const policy = mergePolicy();
		const cost = Number(policy.costs && policy.costs[kind] && policy.costs[kind].wood) || 100;
		const bank = Number(gameState.getResources().wood) || 0;
		if (bank < cost + (Number(policy.resourceServiceWoodReserve) || 100))
			return frame;
		const action = {
			"type": "BUILD", "kind": kind,
			"role": need.generic === "food" ? "resource_service_food" : "resource_service",
			"priority": 98,
			"builderCount": 3,
			"builderPool": need.generic === "food" ? ["food", "food_owned", "farm"] : [need.generic, "wood", "citizenSoldierWood"],
			"resourceGeneric": need.generic,
			"resourceAnchor": [...need.center],
			"resourceSourceIds": [...need.sourceIds],
			"reason": "shorten " + need.generic + " dropsite travel"
		};
		const filtered = frame.actions || [];
		if (gameState.ai.elapsedTime - this.lastResourceServiceDiag >= 8)
		{
			this.lastResourceServiceDiag = gameState.ai.elapsedTime;
			aiWarn("[EXPERT-SERVICE] build=" + kind + " resource=" + need.generic +
				" workers=" + need.workers.length + " remaining=" + Math.round(need.remaining) +
				" drop=" + (Number.isFinite(need.dropDistance) ? need.dropDistance.toFixed(1) : "none") +
				" roundTrip=" + need.roundTripSeconds.toFixed(1));
		}
		this.lastResourceServiceBuildTime = Number(gameState.ai.elapsedTime) || 0;
		return { ...frame, "actions": [action, ...filtered] };
	}

	activeResourceCorridors(gameState, accessIndex)
	{
		const minimumWorkers = Math.max(2, Number(mergePolicy().resourceServiceMinimumWorkers) || 3);
		const corridors = [];
		for (const district of this.activeResourceDistricts(gameState, accessIndex))
		{
			if (district.workers.length < minimumWorkers || !district.center || !district.dropsite || !entityPosition(district.dropsite))
				continue;
			if (SquareVectorDistance(district.center, district.dropsite.position()) < 8*8)
				continue;
			corridors.push({ "from": district.center, "to": district.dropsite.position(), "generic": district.generic });
		}
		return corridors;
	}

	woodDropsiteForSupply(gameState, supply, radius)
	{
		if (!supply || !entityPosition(supply))
			return undefined;
		const r2 = radius * radius;
		const dropsites = [
			...this.builtByClass(gameState, "Storehouse"),
			...this.builtByClass(gameState, "Market")
		].filter(ent => ent && entityPosition(ent));
		let best;
		let bestDist = Infinity;
		for (const dropsite of dropsites)
		{
			const d = SquareVectorDistance(supply.position(), dropsite.position());
			if (d <= r2 && d < bestDist)
			{
				best = dropsite;
				bestDist = d;
			}
		}
		return best ? { dropsite: best, distance: bestDist } : undefined;
	}

	emergencyWoodCandidate(gameState, ent, accessIndex)
	{
		if (!ent || !entityPosition(ent))
			return undefined;
		const dropsites = this.resourceDropsites(gameState, "wood");
		if (!dropsites.length)
			return undefined;
		const candidates = [];
		for (const supply of gameState.getResourceSupplies("wood").values())
		{
			if (!supply || !entityPosition(supply) || !supply.resourceSupplyAmount || supply.resourceSupplyAmount() <= 0 || isSupplyFull(gameState, supply))
				continue;
			if (getLandAccess(gameState, supply) !== accessIndex || this.HQ.territoryMap.getOwner(supply.position()) !== PlayerID)
				continue;
			let drop = Infinity;
			for (const site of dropsites)
				drop = Math.min(drop, Math.sqrt(SquareVectorDistance(supply.position(), site.position())));
			const walk = Math.sqrt(SquareVectorDistance(ent.position(), supply.position()));
			candidates.push({ supply, score: walk + 4 * drop, drop });
		}
		candidates.sort((a, b) => a.score - b.score || a.supply.id() - b.supply.id());
		return candidates[0];
	}

	assignEmergencyWood(gameState, ent, accessIndex)
	{
		const candidate = this.emergencyWoodCandidate(gameState, ent, accessIndex);
		if (!candidate)
			return false;
		const target = candidate.supply;
		if (this.depositBeforeResourceRetarget(gameState, ent, "wood", "emergency-wood"))
			return true;
		ent.setMetadata(PlayerID, SUPPLY_ID, target.id());
		ent.setMetadata(PlayerID, "gather-type", "wood");
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
		if (this.HQ.basesManager && this.HQ.basesManager.AddTCGatherer)
			this.HQ.basesManager.AddTCGatherer(target.id());
		const order = ensureGatherOrder(ent, target);
		this.diagnoseWorkerOrder(ent, "wood-emergency-longhaul", target.id(), order.status);
		return order.status !== "FAILED";
	}

	resourceCandidatesInOwnTerritory(gameState, ent, accessIndex, generic)
	{
		const out = [];
		const serviceDistance = new Map();
		if (!ent || !entityPosition(ent) || !gameState.getResourceSupplies)
			return out;
		if (ent.canGather && !ent.canGather(generic))
			return out;
		for (const supply of gameState.getResourceSupplies(generic).values())
		{
			const pos = entityPosition(supply);
			if (!pos || !supply.resourceSupplyAmount || supply.resourceSupplyAmount() <= 0 || isSupplyFull(gameState, supply))
				continue;
			if (generic === "food" && hasClass(supply, "Animal"))
				continue;
			if (getLandAccess(gameState, supply) !== accessIndex)
				continue;
			if (this.HQ.territoryMap.getOwner(pos) !== PlayerID)
				continue;
			if (generic === "wood")
			{
				const service = this.woodDropsiteForSupply(gameState, supply, Math.max(20, Number(mergePolicy().fallbackWoodDropsiteRadius) || 36));
				if (!service)
					continue;
				serviceDistance.set(supply.id(), service.distance);
			}
			else if (generic === "stone" || generic === "metal" || generic === "food")
			{
				const service = this.resourceDropsiteForSupply(gameState, supply, generic);
				serviceDistance.set(supply.id(), service ? service.distance : Infinity);
			}
			out.push(supply);
		}
		out.sort((a, b) => {
			const workerA = Math.sqrt(SquareVectorDistance(ent.position(), a.position()));
			const workerB = Math.sqrt(SquareVectorDistance(ent.position(), b.position()));
			const da = Number(serviceDistance.get(a.id()));
			const db = Number(serviceDistance.get(b.id()));
			if (generic === "wood")
			{
				const aService = Number.isFinite(da) ? Math.sqrt(da) : Infinity;
				const bService = Number.isFinite(db) ? Math.sqrt(db) : Infinity;
				if (aService !== bService) return aService - bService;
			}
			else if (Number.isFinite(da) || Number.isFinite(db))
			{
				// Minerals/food care about both one-time worker travel and every repeated
				// dropsite trip. Repeated carry distance gets a heavier weight.
				const aService = Number.isFinite(da) ? Math.sqrt(da) : 9999;
				const bService = Number.isFinite(db) ? Math.sqrt(db) : 9999;
				const scoreA = workerA + 4 * aService;
				const scoreB = workerB + 4 * bService;
				if (scoreA !== scoreB) return scoreA - scoreB;
			}
			return workerA - workerB || a.id() - b.id();
		});
		return out;
	}

	depositBeforeResourceRetarget(gameState, ent, targetGeneric, label)
	{
		const carrying = ent && ent.resourceCarrying ? (ent.resourceCarrying() || []) : [];
		if (!needsDepositBeforeRetarget(carrying, targetGeneric))
			return false;
		const queued = returnResources(gameState, ent);
		this.diagnoseWorkerOrder(ent, "deposit:" + label, 0, queued ? "ISSUED" : "NO_DROPSITE");
		// Never issue a cross-resource gather order in the same update.  The worker
		// must deposit first; otherwise carried food/wood can be lost on retarget.
		return true;
	}

	assignSafeFallback(gameState, ent, accessIndex, preferred = ["wood", "food", "stone", "metal"])
	{
		// IT14.39: temporary fallback work is still real work. If the worker already
		// has a live, legal gather order in one of the requested resource classes,
		// finish that target instead of recomputing the nearest supply every decision
		// tick. This removes the visible A->B->A walking churn while an army is away.
		const currentId = Number(ent.getMetadata(PlayerID, SUPPLY_ID));
		const current = Number.isFinite(currentId) ? gameState.getEntityById(currentId) : undefined;
		if (current && entityPosition(current) && current.resourceSupplyAmount && current.resourceSupplyAmount() > 0 &&
		    current.resourceSupplyType && getLandAccess(gameState, current) === accessIndex &&
		    this.HQ.territoryMap.getOwner(current.position()) === PlayerID)
		{
			const type = current.resourceSupplyType();
			const generic = type && type.generic;
			const serviced = generic !== "wood" || !!this.woodDropsiteForSupply(gameState, current,
				Math.max(20, Number(mergePolicy().fallbackWoodDropsiteRadius) || 36));
			if (preferred.includes(generic) && serviced && hasLiveGatherOrder(ent, current.id()))
			{
				ent.setMetadata(PlayerID, "gather-type", generic);
				if (ent.getMetadata(PlayerID, JOB_METADATA) === "food_owned" && generic === "wood")
				{
					ent.setMetadata(PlayerID, EXPERT_FALLBACK_LEASE_RESOURCE, "wood");
					if (!Number.isFinite(Number(ent.getMetadata(PlayerID, EXPERT_FALLBACK_LEASE_UNTIL))))
						ent.setMetadata(PlayerID, EXPERT_FALLBACK_LEASE_UNTIL, gameState.ai.elapsedTime + mergePolicy().temporaryFallbackLeaseSeconds);
				}
				ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
				this.diagnoseWorkerOrder(ent, "fallback:" + generic, current.id(), "CONFIRMED_STICKY");
				return true;
			}
		}

		for (const generic of preferred)
		{
			const candidates = this.resourceCandidatesInOwnTerritory(gameState, ent, accessIndex, generic);
			if (!candidates.length)
				continue;
			const target = candidates[0];
			if (this.depositBeforeResourceRetarget(gameState, ent, generic, "fallback-" + generic))
				return true;
			ent.setMetadata(PlayerID, SUPPLY_ID, target.id());
			ent.setMetadata(PlayerID, "gather-type", generic);
			if (ent.getMetadata(PlayerID, JOB_METADATA) === "food_owned" && generic === "wood")
			{
				ent.setMetadata(PlayerID, EXPERT_FALLBACK_LEASE_RESOURCE, "wood");
				ent.setMetadata(PlayerID, EXPERT_FALLBACK_LEASE_UNTIL, gameState.ai.elapsedTime + mergePolicy().temporaryFallbackLeaseSeconds);
			}
			ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
			if (this.HQ.basesManager && this.HQ.basesManager.AddTCGatherer)
				this.HQ.basesManager.AddTCGatherer(target.id());
			const order = ensureGatherOrder(ent, target);
			this.diagnoseWorkerOrder(ent, "fallback:" + generic, target.id(), order.status);
			return true;
		}
		return false;
	}

	captureOpeningChickens(gameState, cc, accessIndex)
	{
		if (this.openingChickensCaptured)
			return;
		const named = [];
		const domestic = [];
		for (const supply of gameState.getResourceSupplies("food").values())
		{
			const pos = entityPosition(supply);
			if (!pos || !hasClass(supply, "Animal") || getLandAccess(gameState, supply) !== accessIndex)
				continue;
			if (SquareVectorDistance(pos, cc.position()) > 50*50)
				continue;
			const name = supply.templateName ? String(supply.templateName()) : "";
			if (name.includes("chicken"))
				named.push(supply.id());
			else if (hasClass(supply, "Domestic"))
				domestic.push(supply.id());
		}
		this.openingChickenIds = (named.length ? named : domestic).sort((a, b) => a - b);
		this.openingChickensCaptured = true;
		aiWarn("[EXPERT-CAV] captured opening chickens=" + this.openingChickenIds.length);
	}

	scoutCavalry(gameState, ent, cc, accessIndex)
	{
		const issuedAt = Number(ent.getMetadata(PlayerID, "expertScoutIssuedAt"));
		const dx = Number(ent.getMetadata(PlayerID, "expertScoutX"));
		const dz = Number(ent.getMetadata(PlayerID, "expertScoutZ"));
		if (Number.isFinite(issuedAt) && Number.isFinite(dx) && Number.isFinite(dz))
		{
			if (SquareVectorDistance(ent.position(), [dx, dz]) <= 8*8)
			{
				ent.setMetadata(PlayerID, "expertScoutIssuedAt", undefined);
			}
			else if (gameState.ai.elapsedTime - issuedAt < 12)
				return true;
		}
		const state = ent.unitAIState ? ent.unitAIState() : "";
		if (state && state.includes("WALKING") && !(ent.isIdle && ent.isIdle()))
			return true;
		const radii = [70, 100, 130, 160];
		let index = Number(ent.getMetadata(PlayerID, "expertScoutIndex")) || 0;
		for (let attempt = 0; attempt < radii.length * 16; ++attempt)
		{
			const step = index + attempt;
			const radius = radii[Math.floor(step / 16) % radii.length];
			const angle = 2 * Math.PI * (step % 16) / 16;
			const position = [cc.position()[0] + Math.cos(angle) * radius, cc.position()[1] + Math.sin(angle) * radius];
			if (gameState.ai.accessibility.getAccessValue(position) !== accessIndex)
				continue;
			const owner = this.HQ.territoryMap.getOwner(position);
			if (owner !== 0 && owner !== PlayerID)
				continue;
			if (this.HQ.isDangerousLocation && this.HQ.isDangerousLocation(gameState, position, 8))
				continue;
			ent.setMetadata(PlayerID, "expertScoutIndex", step + 1);
			ent.setMetadata(PlayerID, "expertScoutIssuedAt", gameState.ai.elapsedTime);
			ent.setMetadata(PlayerID, "expertScoutX", position[0]);
			ent.setMetadata(PlayerID, "expertScoutZ", position[1]);
			ent.setMetadata(PlayerID, SUPPLY_ID, undefined);
			ent.move(position[0], position[1]);
			this.diagnoseWorkerOrder(ent, "scout", step + 1, "ISSUED");
			return true;
		}
		return false;
	}

	assignChickenCavalry(gameState, ent, cc, accessIndex)
	{
		this.captureOpeningChickens(gameState, cc, accessIndex);
		const policy = mergePolicy();

		const carryingFood = (ent.resourceCarrying ? (ent.resourceCarrying() || []) : [])
			.reduce((sum, item) => sum + (item && item.type === "food" ? Math.max(0, Number(item.amount) || 0) : 0), 0);
		const isHomeChickenMeat = supply =>
		{
			const pos = entityPosition(supply);
			if (!pos || getLandAccess(gameState, supply) !== accessIndex ||
			    SquareVectorDistance(pos, cc.position()) > 55*55 ||
			    !supply.resourceSupplyAmount || supply.resourceSupplyAmount() <= 0)
				return false;
			const name = supply.templateName ? String(supply.templateName()).toLowerCase() : "";
			let specific = "";
			try
			{
				const type = supply.resourceSupplyType ? supply.resourceSupplyType() : undefined;
				specific = type && String(type.specific || "").toLowerCase() || "";
			}
			catch (e) {}
			const originalChicken = this.openingChickenIds.includes(supply.id()) || name.includes("chicken");
			const carcassMeat = specific === "meat" && (!hasClass(supply, "Animal") || name.includes("resource|"));
			return originalChicken || carcassMeat;
		};

		if (!this.openingChickenPhaseComplete)
		{
			const state = ent.unitAIState ? ent.unitAIState() : "";
			const liveTargetId = currentTargetId(ent);
			const liveTarget = Number.isFinite(liveTargetId) ? gameState.getEntityById(liveTargetId) : undefined;

			// Most important IT6 correction: when a chicken dies, UnitAI switches to the
			// spawned carcass entity. Do NOT choose another chicken or hunt while the horse
			// is gathering that carcass or returning its meat to the CC.
			if ((liveTarget && isHomeChickenMeat(liveTarget) &&
			     (state.includes("GATHER.GATHERING") || state.includes("GATHER.APPROACHING"))) ||
			    state.includes("GATHER.RETURNINGRESOURCE") || carryingFood > 0)
			{
				if (carryingFood > 0 && ent.isIdle && ent.isIdle())
					returnResources(gameState, ent);
				if (liveTarget && isHomeChickenMeat(liveTarget))
				{
					ent.setMetadata(PlayerID, SUPPLY_ID, liveTarget.id());
					ent.setMetadata(PlayerID, "gather-type", "food");
				}
				this.diagnoseWorkerOrder(ent, "chicken_finish", liveTargetId || 0, carryingFood > 0 ? "CARRYING_OR_RETURNING" : "CONFIRMED");
				return true;
			}

			const homeFood = [];
			for (const supply of gameState.getResourceSupplies("food").values())
				if (isHomeChickenMeat(supply))
					homeFood.push(supply);
			if (homeFood.length)
			{
				homeFood.sort((a, b) => {
					const aCarcass = !hasClass(a, "Animal") ? 0 : 1;
					const bCarcass = !hasClass(b, "Animal") ? 0 : 1;
					return aCarcass - bCarcass ||
						SquareVectorDistance(ent.position(), a.position()) - SquareVectorDistance(ent.position(), b.position()) ||
						a.id() - b.id();
				});
				const currentMetadata = Number(ent.getMetadata(PlayerID, SUPPLY_ID));
				let target = homeFood.find(supply => supply.id() === currentMetadata && !isSupplyFull(gameState, supply));
				if (!target)
					target = homeFood.find(supply => !isSupplyFull(gameState, supply)) || homeFood[0];
				ent.setMetadata(PlayerID, SUPPLY_ID, target.id());
				ent.setMetadata(PlayerID, "gather-type", "food");
				ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_HUNTER);
				if (hasLiveGatherOrder(ent, target.id()))
				{
					this.diagnoseWorkerOrder(ent, "chicken", target.id(), "CONFIRMED");
					return true;
				}
				const order = ensureGatherOrder(ent, target);
				this.diagnoseWorkerOrder(ent, "chicken", target.id(), order.status);
				return true;
			}

			this.openingChickenPhaseComplete = true;
			ent.setMetadata(PlayerID, SUPPLY_ID, undefined);
			aiWarn("[EXPERT-CAV] opening chickens fully harvested; hunt/scout unlocked");
		}

		const hunt = [];
		for (const supply of gameState.getResourceSupplies("food").values())
		{
			const pos = entityPosition(supply);
			if (!pos || !hasClass(supply, "Animal") || !supply.resourceSupplyAmount || supply.resourceSupplyAmount() <= 0 || isSupplyFull(gameState, supply))
				continue;
			if (getLandAccess(gameState, supply) !== accessIndex || hasClass(supply, "Domestic"))
				continue;
			const owner = this.HQ.territoryMap.getOwner(pos);
			if (owner !== 0 && owner !== PlayerID)
				continue;
			if (SquareVectorDistance(pos, cc.position()) > policy.cavalryHuntSearchRadius * policy.cavalryHuntSearchRadius)
				continue;
			hunt.push(supply);
		}
		if (hunt.length)
		{
			hunt.sort((a, b) => SquareVectorDistance(ent.position(), a.position()) - SquareVectorDistance(ent.position(), b.position()) || a.id() - b.id());
			const metadataTargetId = Number(ent.getMetadata(PlayerID, SUPPLY_ID));
			let target = hunt.find(supply => supply.id() === metadataTargetId) || hunt[0];
			ent.setMetadata(PlayerID, SUPPLY_ID, target.id());
			ent.setMetadata(PlayerID, "gather-type", "food");
			ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_HUNTER);
			if (hasLiveGatherOrder(ent, target.id()))
			{
				this.diagnoseWorkerOrder(ent, "hunt", target.id(), "CONFIRMED");
				return true;
			}
			const order = ensureGatherOrder(ent, target);
			this.diagnoseWorkerOrder(ent, "hunt", target.id(), order.status);
			return true;
		}
		return this.scoutCavalry(gameState, ent, cc, accessIndex);
	}

	constructionBuilderContext(gameState, kind)
	{
		const policy = mergePolicy();
		if (kind === "house")
		{
			const cc = this.findCC(gameState);
			const trigger = cc ? predictiveHouseTrigger({ "housing": this.housingMetrics(gameState, cc) }, policy) : policy.houseTriggerFreePopulation;
			const queuedVillagers = gameState.ai.queues.villager ? gameState.ai.queues.villager.countQueuedUnits() : 0;
			const queuedSoldiers = gameState.ai.queues.citizenSoldier ? gameState.ai.queues.citizenSoldier.countQueuedUnits() : 0;
			const free = gameState.getPopulationLimit() - this.HQ.getAccountedPopulation(gameState) - queuedVillagers - queuedSoldiers;
			return {
				"emergency": free <= policy.houseEmergencyFreePopulation,
				"urgent": free <= trigger,
				"comfortable": free > trigger + 3
			};
		}
		if (kind === "field")
		{
			const workers = this.economyWorkerMetrics(gameState);
			const builtFields = this.builtByClass(gameState, "Field").length;
			const capacity = builtFields * policy.farmersPerField;
			const freeSlots = Math.max(0, capacity - workers.farm);
			const missingFieldCapacity = Math.max(0, Number(this.lastDesiredFields || 0) - builtFields);
			return {
				// Missing permanent fields are an actual food-capacity deficit, even when
				// food-owned civilians have correctly NOT been dumped onto wood.
				"capacityDeficit": Math.max(workers.overflowWood, missingFieldCapacity),
				"transition": missingFieldCapacity > 0 || workers.overflowWood > 0 || workers.foodOwnedCivilians > 0 && freeSlots <= 2,
				"prebuild": workers.woodCivilians >= policy.farmPrebuildWoodCivilians
			};
		}
		if (kind === "farmstead")
			return { "opening": this.builtByClass(gameState, "Farmstead").length === 0 };
		if (kind === "storehouse")
			return { "opening": this.builtByClass(gameState, "Storehouse").length === 0 };
		if (kind === "barracks")
			return { "urgent": gameState.ai.elapsedTime >= policy.barracksTargetTime };
		if (kind === "market")
			return { "urgent": false };
		if (kind === "forge")
			return { "urgent": false };
		if (kind === "temple")
			return { "urgent": false };
		if (kind === "arsenal")
			return { "urgent": true };
		if (kind === "gymnasium")
			return { "urgent": false };
		if (kind === "prytaneion")
			return { "urgent": true };
		if (kind === "tower")
			return { "emergency": true, "urgent": true };
		return {};
	}

	ensureConstructionOrders(gameState)
	{
		const policy = mergePolicy();
		const foundations = [];
		const activeTasks = [
			...Object.entries(this.activeTaskByKind),
			...this.activeFieldTasks.map(taskId => ["field", taskId])
		];
		for (const [kind, taskId] of activeTasks)
		{
			if (!taskId)
				continue;
			let observed;
			try { observed = this.foundationTracker.observeTask(gameState, taskId); }
			catch (e) { continue; }
			this.diagnoseTaskLifecycle(gameState, kind, taskId, observed);
			if (observed.state !== "foundation" || !Number.isFinite(observed.foundationId))
				continue;
			const foundation = gameState.getEntityById(observed.foundationId);
			if (!foundation || !entityPosition(foundation))
				continue;
			const context = this.constructionBuilderContext(gameState, kind);
			const intent = this.activeTaskBuildIntent[taskId] || {};
			foundations.push({
				key: taskId, kind, taskId, observed, foundation, context, intent,
				wanted: Math.max(1, Number(intent.builderCount) || desiredBuilders(kind, context)),
				priority: Math.max(constructionPriority(kind, context), Number(intent.priority) || 0)
			});
		}
		// EVERY construction crew is sticky now. Once a worker starts a foundation, that
		// worker finishes it. Existing commitments consume the global builder budget first;
		// only the remaining budget may add builders to those crews or start other tasks.
		const existingByTask = {};
		let committedBuilders = 0;
		const extraNeeds = [];
		for (const item of foundations)
		{
			const existing = this.constructionWorkers(gameState, item.taskId);
			existingByTask[item.taskId] = existing;
			committedBuilders += existing.length;
			const extra = Math.max(0, item.wanted - existing.length);
			if (extra > 0)
				extraNeeds.push({ ...item, wanted: extra });
		}
		const remainingBuilderBudget = Math.max(0, policy.maxConcurrentBuilders - committedBuilders);
		const extras = remainingBuilderBudget > 0 ? allocateBuilderBudget(extraNeeds, remainingBuilderBudget) : {};

		for (const item of foundations)
		{
			const { kind, taskId, observed, foundation } = item;
			const existingWorkers = existingByTask[taskId] || [];
			const wanted = existingWorkers.length + Math.max(0, extras[taskId] || 0);
			if (wanted <= 0)
				continue;

			let team = [...existingWorkers];
			if (team.length < wanted)
			{
				const candidates = selectMaintenanceTeam(gameState, kind, foundation.position(), wanted, item.intent || {}, {
					"playerId": PlayerID, "taskId": taskId, "existingBuilderIds": existingWorkers.map(ent => ent.id())
				});
				const seen = new Set(team.map(ent => ent.id()));
				for (const candidate of candidates)
				{
					if (seen.has(candidate.id()))
						continue;
					team.push(candidate);
					seen.add(candidate.id());
					if (team.length >= wanted)
						break;
				}
			}
			if (team.length)
				commitBuilders(team, taskId, PlayerID);

			for (const builder of team)
			{
				const carrying = builder.resourceCarrying ? (builder.resourceCarrying() || []) : [];
				if (carrying.some(resource => resource && Number(resource.amount) > 0))
				{
					if (returnResources(gameState, builder))
						this.diagnoseWorkerOrder(builder, "build:" + kind, observed.foundationId, "RETURNING_RESOURCES");
					continue;
				}
				builder.setMetadata(PlayerID, "target-foundation", observed.foundationId);
				builder.setMetadata(PlayerID, "subrole", Worker.SUBROLE_BUILDER);
				if (hasLiveRepairOrder(builder, observed.foundationId))
				{
					this.diagnoseWorkerOrder(builder, "build:" + kind, observed.foundationId, "CONFIRMED");
					continue;
				}
				const order = ensureRepairOrder(builder, foundation, kind === "house");
				this.diagnoseWorkerOrder(builder, "build:" + kind, observed.foundationId, order.status);
			}
		}

	}

	updateWorkers(gameState, cc, foodNetwork, woodsite, accessIndex)
	{
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!entityPosition(ent) || !this.isExpertEconomyEntity(ent))
				continue;
			this.trackResourceRoundTrip(gameState, ent);
			if (ent.getMetadata(PlayerID, EXPERT_DEFENSE) !== undefined || ent.getMetadata(PlayerID, EXPERT_CIVILIAN_EVAC) !== undefined)
				continue;
			const pendingJob = ent.getMetadata(PlayerID, PENDING_JOB_METADATA);
			const carrying = ent.resourceCarrying ? (ent.resourceCarrying() || []) : [];
			const pendingDecision = pendingTransitionDecision(pendingJob, carrying);
			if (pendingDecision.action === "DEPOSIT_ONLY")
			{
				const stateNow = ent.unitAIState ? ent.unitAIState() : "";
				// Hard transition state: the OLD job is forbidden to issue another
				// gather command until the carried resource is safely deposited.
				if (!stateNow.includes("RETURNRESOURCE") && !stateNow.includes("RETURNINGRESOURCE"))
					returnResources(gameState, ent);
				this.diagnoseWorkerOrder(ent, "deposit-for:" + pendingJob, 0, "PENDING");
				continue;
			}
			if (pendingDecision.action === "COMMIT_PENDING")
				this.finishPendingJob(ent);
			if (ent.getMetadata(PlayerID, TASK_KEY) !== undefined || ent.getMetadata(PlayerID, "transport") !== undefined ||
			    ent.getMetadata(PlayerID, "PartOfArmy") || !this.attackPlanAllowsEconomicWork(gameState, ent))
				continue;
			const state = ent.unitAIState ? ent.unitAIState() : "";
			if (state && state.includes(".COMBAT."))
				continue;
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			if (job === "food")
				this.assignFoodWorker(gameState, ent, foodNetwork, accessIndex);
			else if (job === "food_owned")
			{
				// IT14.41: when food capacity temporarily overflows, do not bounce this
				// civilian back and forth every time a field slot flickers open. A 30-second
				// wood lease is honored while the overall food controller is not in recovery.
				const leaseUntil = Number(ent.getMetadata(PlayerID, EXPERT_FALLBACK_LEASE_UNTIL));
				const leaseResource = ent.getMetadata(PlayerID, EXPERT_FALLBACK_LEASE_RESOURCE);
				const foodRecovery = this.lastFoodWoodFeedback && this.lastFoodWoodFeedback.mode === "food_recovery";
				if (!foodRecovery && leaseResource === "wood" && Number.isFinite(leaseUntil) && gameState.ai.elapsedTime < leaseUntil)
					this.assignSafeFallback(gameState, ent, accessIndex, ["wood"]);
				else
				{
					ent.setMetadata(PlayerID, EXPERT_FALLBACK_LEASE_UNTIL, undefined);
					ent.setMetadata(PlayerID, EXPERT_FALLBACK_LEASE_RESOURCE, undefined);
					// Natural food is always attempted first. assignFoodWorker performs a one-way
					// fallback to a field only when the entire in-territory natural network has no
					// available capacity. This prevents new food civilians from skipping berries.
					this.assignFoodWorker(gameState, ent, foodNetwork, accessIndex);
				}
			}
			else if (job === "farm")
			{
				if (!this.assignFarmWorker(gameState, ent, accessIndex))
					this.assignFoodWorker(gameState, ent, foodNetwork, accessIndex);
			}
			else if (job === "wood" || job === "citizenSoldierWood" || job === "food_overflow_wood")
				this.assignWoodWorker(gameState, ent, woodsite, accessIndex);
			else if (job === "stone")
				this.assignSafeFallback(gameState, ent, accessIndex, ["stone"]);
			else if (job === "metal")
				this.assignSafeFallback(gameState, ent, accessIndex, ["metal"]);
			else if (job === "chicken")
				this.assignChickenCavalry(gameState, ent, cc, accessIndex);
		}
	}

	cleanExpertQueues(gameState)
	{
		for (const name of ["house", "dropsites", "field", "militaryBuilding", "economicBuilding", "defenseBuilding", "villager", "citizenSoldier", "minorTech"])
		{
			const queue = gameState.ai.queues[name];
			if (!queue || !queue.plans)
				continue;
			queue.plans = queue.plans.filter(plan => plan.metadata && plan.metadata.expertDecisionLayer);
		}
	}


	setDecisionPriorities(gameState, frame)
	{
		const map = { house: "house", storehouse: "dropsites", farmstead: "dropsites", field: "field", barracks: "militaryBuilding", forge: "militaryBuilding", market: "economicBuilding", temple: "economicBuilding", arsenal: "militaryBuilding", gymnasium: "militaryBuilding", prytaneion: "militaryBuilding", tower: "defenseBuilding" };
		if (this.activeTaskByKind.barracks || this.activeTaskByKind.forge || this.activeTaskByKind.arsenal ||
		    this.activeTaskByKind.gymnasium || this.activeTaskByKind.prytaneion)
			gameState.ai.queueManager.changePriority("militaryBuilding", Math.max(this.HQ.Config.priorities.militaryBuilding || 1, 990));
		for (const action of frame.actions)
		{
			if ((action.type !== "BUILD" && action.type !== "MAINTAIN_CONSTRUCTION") || !map[action.kind])
				continue;
			const p = Math.max(this.HQ.Config.priorities[map[action.kind]] || 1, Number(action.priority || 1) * 10);
			gameState.ai.queueManager.changePriority(map[action.kind], p);
		}
		if (frame.training && frame.training.action === "TRAIN_CIVILIANS")
			gameState.ai.queueManager.changePriority("villager", Math.max(this.HQ.Config.priorities.villager || 1, 800));
	}

	update(gameState, queues, events)
	{
		if (!this.isExpert() || this.released)
			return false;
		if (this.lastUpdateTurn === gameState.ai.playedTurn)
			return true;
		this.lastUpdateTurn = gameState.ai.playedTurn;
		const doctrine = this.ensureStrategicDoctrine(gameState);
		if (!this.strategyP2TransitionLogged && gameState.currentPhase && gameState.currentPhase() >= 2)
		{
			this.strategyP2TransitionLogged = true;
			aiWarn("[EXPERT-STRATEGY] transition=" +
				(doctrine.id === "p2_tech_push" ? "p2_tech_push" : "p2_followup") +
				" from=" + doctrine.id + " civ=" + gameState.getPlayerCiv());
		}
		if (this.HQ.basesManager)
			this.HQ.basesManager.turnCache = {};

		const cc = this.findCC(gameState);
		if (!cc)
			return true;
		const accessIndex = this.baseAccess(gameState, cc);
		const foodContext = this.foodCaptureContext(gameState, cc, accessIndex);
		this.ensureInitialWoodSelection(gameState, cc, accessIndex);
		this.refreshTasks(gameState);
		this.cleanupStaleConstructionAssignments(gameState);
		this.ensureConstructionOrders(gameState);
		this.cleanExpertQueues(gameState);
		this.rebindQueuedStarters(gameState);
		// IT14.54: read an already-queued phase BEFORE making the next economic frame.
		// This turns a stuck 298/300 wood phase into an explicit continuity emergency.
		this.refreshPhase2QueueWatchdog(gameState, queues);
		const foodObservation = this.advanceFoodTracker(gameState, foodContext);
		const foodNetwork = this.foodClusterNetwork(gameState, foodContext);
		const territoryNaturalFood = this.territoryNaturalFoodMetrics(gameState, foodNetwork);
		// Military reaction happens before economy assignment. Mobilized citizen-soldiers are
		// then invisible to worker retargeting while they deposit, retreat, assemble and fight.
		const defenseState = this.coordinateExpertDefense(gameState, cc);
		this.coordinateCivilianSafety(gameState, cc);

		// Compute the current production burn BEFORE assigning newly-created civilians.
		// New permanent jobs are based on how many food workers the active CC/barracks
		// actually need, not on "CC is still below 70, so make another farmer".
		const preAssignmentFoodThroughput = this.foodThroughputMetrics(gameState, cc, foodNetwork);
		this.syncJobs(gameState, foodNetwork, preAssignmentFoodThroughput);
		const foodAlternative = this.alternativeFoodInfo(gameState, foodContext, foodObservation);
		this.applyPostWickerBerryPeel(gameState, foodObservation, foodAlternative);
		const allFoodClusters = foodNetwork.clusters;
		const woodsite = this.collectWoodsite(gameState, cc, accessIndex);
		const workers = this.economyWorkerMetrics(gameState);
		const woodContinuity = this.updateWoodContinuityWatchdog(gameState, workers, woodsite);
		this.resetPhaseWoodRecoveryPriority(gameState, queues);
		const woodServiceStorehouses = this.woodServiceStorehouseCount(gameState, accessIndex);
		const farmCapacity = this.farmCapacitySnapshot(gameState, accessIndex);
		this.lastFarmCapacitySnapshot = farmCapacity;
		const foodThroughput = this.foodThroughputMetrics(gameState, cc, foodNetwork);
		const aiPending = countPendingCivilianTraining(gameState);
		const livePending = this.countLiveCivilianTraining(gameState);
		const pendingTraining = {
			"pendingCivilians": aiPending.pendingCivilians + livePending.pendingCivilians,
			"pendingBatches": aiPending.pendingBatches + livePending.pendingBatches
		};
		const queuedExpertSoldiers = queues.citizenSoldier ? queues.citizenSoldier.countQueuedUnits() : 0;
		const queuedPopulation = Math.max(0, this.HQ.getAccountedPopulation(gameState) - gameState.getPopulation()) +
			aiPending.pendingCivilians + queuedExpertSoldiers;
		const templeCandidates = [gameState.applyCiv("structures/{civ}/temple"), gameState.applyCiv("structures/{civ}/temple_vesta")];
		const templeBuildable = !!(this.HQ.canBuild && templeCandidates.some(type =>
			gameState.getTemplate(type) && this.HQ.canBuild(gameState, type)));
		const marketType = gameState.applyCiv("structures/{civ}/market");
		const marketBuildable = !!(this.HQ.canBuild && gameState.getTemplate(marketType) && this.HQ.canBuild(gameState, marketType));
		let phase3TownRequired = 0;
		if (typeof gameState.getPhaseEntityRequirements === "function" && typeof gameState.currentPhase === "function" && gameState.currentPhase() === 2)
		{
			for (const requirement of gameState.getPhaseEntityRequirements(3) || [])
				if (requirement && requirement.class === "Town")
					phase3TownRequired = Math.max(phase3TownRequired, Number(requirement.count) || 0);
		}
		const phase3TownCount = this.builtByClass(gameState, "Town").length;
		const observation = observePetra(gameState, {
			"HQ": this.HQ,
			"filters": filters,
			"time": gameState.ai.elapsedTime,
			"queuedPopulation": queuedPopulation,
			"training": pendingTraining,
			"housing": this.housingMetrics(gameState, cc),
			"food": {
				"primaryRatio": foodObservation.ratio,
				"primaryRemaining": foodObservation.remaining,
				"totalNaturalRemaining": foodNetwork.totalRemaining,
				"territoryNaturalDiscovered": territoryNaturalFood.discovered,
				"territoryNaturalRatio": territoryNaturalFood.ratio,
				"immediateFoodSlots": this.lastImmediateFoodSlots,
				"targetFoodWorkers": Math.max(7, workers.food + workers.farm),
				"naturalFoodWorkers": workers.food,
				"farmWorkers": workers.farm,
				"alternativeRemaining": foodAlternative.remaining,
				"alternativeClusters": foodAlternative.clusters.length,
				"alternativeCovered": foodAlternative.covered,
				"fieldCapacityKnown": farmCapacity.known,
				"supportedFieldSlots": farmCapacity.supportedFieldSlots,
				"openFieldSlots": farmCapacity.openFieldSlots,
				"maxSaturatedHubFields": farmCapacity.maxSaturatedHubFields || 0,
				...foodThroughput
			},
			"woodsite": {
				...summarizeWoodTrees(woodsite.trees),
				"alternativeExistingWorksite": this.alternativeWoodWorksiteExists(gameState, accessIndex)
			},
			"workers": workers,
			"flags": {
				"templeBuildable": templeBuildable,
				"marketBuildable": marketBuildable,
				"phase3TownRequired": phase3TownRequired,
				"phase3TownCount": phase3TownCount,
				"phaseWoodCrisis": this.phaseWoodCrisis,
				"woodIncomeStalled": this.woodIncomeStalled,
				"woodServiceStorehouses": woodServiceStorehouses,
				"measuredWoodIncomeRate": woodContinuity.delivered.rate,
				"measuredWoodIncomeAvailable": woodContinuity.delivered.measured
			}
		});
		// IT14.51: strategy-level operating population ceiling. A 300-pop lobby may
		// become useful in a long game, but the timing build must stop laying houses at
		// the normal 200-pop operating ceiling instead of converting every resource into
		// a 250+ population boom before the opponent is finished.
		const operatingPopulationCap = Math.min(Number(observation.population.max) || 200,
			Number(mergePolicy().expertOperatingPopulationCap) || 200);
		observation.population.max = Math.max(1, operatingPopulationCap);
		let frame = stepDecision(this.memory, observation, this.strategyPolicyOverrides(gameState));
		this.memory = frame.memory;
		this.lastDesiredFields = Number(frame && frame.derived && frame.derived.desiredFields) || 0;
		// Once the mature P1 economy is ready, phase reservation outranks optional eco
		// research. During the opening this returns false, so Wicker/Axe still run before
		// the first house exactly as before. IT14.55 gives the first-tier mining pair its
		// own protected lane before the broad sweep, while still preserving the full P2 cost.
		this.researchExpertMiningEcoTech(gameState, queues, frame);
		this.researchExpertP1EcoSweep(gameState, queues);
		const phasePending = this.researchExpertPhase2(gameState, queues, frame);
		// Athens-specific pressure valve: once the Forge exposes the intended zero-wood
		// slinger unlock, surplus food/stone can keep barracks productive through a wood dip.
		// This is intentionally independent of phasePending because it consumes no wood.
		this.researchExpertAthenianSlingerUnlock(gameState, queues);
		if (phasePending)
			this.researchExpertP1EcoSweep(gameState, queues);
		if (!phasePending && !(defenseState && defenseState.active))
		{
			// IT14.44: if a real P2 push is already assembling, purchase its two broad
			// forge upgrades first. As soon as those are in the pipeline, establish the
			// food+wood eco pair so a failed push transitions directly into a reboom.
			// Without a meaningful push, keep the prior eco-first behavior.
			const p2Push = this.expertP2PushInPreparation();
			let coreP2Eco = false;
			const militaryBefore = this.expertObservedTechCount(gameState, this.expertObservedP2MilitaryTechs);
			if (p2Push && militaryBefore.queued < mergePolicy().expertP2MilitaryTechsBeforeEco)
				this.researchExpertP2MilitaryTech(gameState, queues);
			const militaryAfter = this.expertObservedTechCount(gameState, this.expertObservedP2MilitaryTechs);
			if (!p2Push || militaryAfter.queued >= mergePolicy().expertP2MilitaryTechsBeforeEco)
				coreP2Eco = this.researchExpertP2CoreEcoTech(gameState, queues);
			// If the Village pair was missed, catch it immediately in Town. Food/wood core
			// lanes remain slightly higher priority, so primary-resource continuity still wins.
			this.researchExpertMiningEcoTech(gameState, queues, frame);
			const hopliteTradition = this.researchExpertHopliteTradition(gameState, queues, frame);
			this.researchExpertP2MilitaryTech(gameState, queues);
			if (!hopliteTradition && !coreP2Eco)
				this.researchExpertEcoTech(gameState, queues, allFoodClusters, cc);
		}
		frame = this.filterFrameForOpeningTech(gameState, queues, allFoodClusters, frame);
		frame = this.applyPostWickerBranchConstruction(frame);
		frame = this.applySecondaryDepletionFieldTrigger(gameState, frame);
		// IT14.52: resource-service construction is a hard logistics correction.
		frame = this.applyResourceServiceConstruction(gameState, frame, accessIndex);
		const forcedFoodHub = (frame.actions || []).find(action => action && action.kind === "farmstead" && action.role === "farm_hub_deadlock");
		if (forcedFoodHub && gameState.ai.elapsedTime - this.lastFoodCapacityDeadlockDiag >= 8)
		{
			this.lastFoodCapacityDeadlockDiag = gameState.ai.elapsedTime;
			aiWarn("[EXPERT-FOOD-CAP] FORCE FARM HUB " + forcedFoodHub.reason +
				" pop=" + gameState.getPopulation() + " bank=" + Math.round(gameState.getResources().food) + "/" + Math.round(gameState.getResources().wood));
		}
		// IT14.53: Athens may add one Gymnasium in Town and one Prytaneion in City,
		// but only from genuine surplus after the core timing infrastructure exists.
		frame = this.applyAthenianSpecialInfrastructure(gameState, frame);
		if (defenseState && defenseState.shouldBuildTower)
			frame = { ...frame, "actions": [...frame.actions, { "type": "BUILD", "kind": "tower", "role": "emergency_defense",
				"builderPool": ["wood", "citizenSoldierWood"] }] };
		const finishing = this.finishingState(gameState);
		const siegeContext = this.p3SiegeContext(gameState, finishing);
		if (siegeContext.active && gameState.currentPhase && gameState.currentPhase() >= 2)
		{
			const arsenalType = gameState.applyCiv("structures/{civ}/arsenal");
			const arsenalBuildable = !!(gameState.getTemplate(arsenalType) && this.HQ.canBuild && this.HQ.canBuild(gameState, arsenalType));
			const arsenalPipeline = this.builtByClass(gameState, "Arsenal").length + this.foundationsByClass(gameState, "Arsenal").length + (this.activeTaskByKind.arsenal ? 1 : 0);
			if (arsenalBuildable && !arsenalPipeline)
				frame = { ...frame, "actions": [...frame.actions, { "type": "BUILD", "kind": "arsenal", "role": siegeContext.finishing ? "finishing_siege" : siegeContext.brokenTown ? "broken_p2_siege" : "p3_attack_siege",
					"priority": siegeContext.finishing ? 99 : 96, "builderPool": ["wood", "citizenSoldierWood", "food", "farm", "stone", "metal"] }] };
			if (gameState.ai.elapsedTime - this.lastFinishingDiag >= 15)
			{
				this.lastFinishingDiag = gameState.ai.elapsedTime;
				aiWarn("[EXPERT-SIEGE] active enemy=" + siegeContext.targetPlayer + " enemyPop=" + siegeContext.enemyPopulation +
					" ownPop=" + siegeContext.ownPopulation + " arsenal=" + arsenalPipeline + " mode=" +
					(siegeContext.finishing ? "finish" : siegeContext.brokenTown ? "broken-p2" : "p3-push"));
			}
		}
		this.setDecisionPriorities(gameState, frame);
		const prepared = this.prepareExecution(gameState, frame, cc, accessIndex, foodObservation);
		try
		{
			executeDecisionFrame(gameState, prepared.frame, prepared.execution, this.actionPorts(), { "playerId": PlayerID });
		}
		catch (e)
		{
			aiWarn("[EXPERT-DECISION] execution blocked: " + e);
		}
		// executeDecisionFrame has now placed the exact-position Storehouse plan into the
		// dropsites queue. If Town Phase itself is holding the missing wood, move ONLY that
		// Storehouse's cost out of majorTech so the new forest district can restore income.
		this.fundPhaseWoodRecoveryStorehouse(gameState, queues);
		this.trainExpertMilitary(gameState, queues, cc);
		this.trainAthenianSpecialUnits(gameState, queues);
		this.trainExpertSiegeFinisher(gameState, queues, siegeContext);
		this.ensureConstructionOrders(gameState);
		this.updateWorkers(gameState, cc, foodNetwork, woodsite, accessIndex);
		this.diagnose(gameState, frame, foodObservation, woodsite);
		return true;
	}

	actualWorkerOrders(gameState)
	{
		const out = { "food": 0, "farm": 0, "wood": 0, "stone": 0, "metal": 0, "chicken": 0, "builders": 0, "idle": 0, "returning": 0, "approaching": 0, "unproductive": 0, "scout": 0 };
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !ent.getMetadata || !this.isExpertEconomyEntity(ent))
				continue;
			if (ent.getMetadata(PlayerID, "PartOfArmy") || ent.getMetadata(PlayerID, EXPERT_DEFENSE) !== undefined ||
			    !this.attackPlanAllowsEconomicWork(gameState, ent))
				continue;
			if (ent.isIdle && ent.isIdle())
				++out.idle;
			const taskId = ent.getMetadata(PlayerID, TASK_KEY);
			const foundationId = ent.getMetadata(PlayerID, "target-foundation");
			if (taskId !== undefined && Number.isFinite(Number(foundationId)) && hasLiveRepairOrder(ent, Number(foundationId)))
			{
				++out.builders;
				continue;
			}
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			const supplyId = ent.getMetadata(PlayerID, SUPPLY_ID);
			const state = ent.unitAIState ? String(ent.unitAIState() || "") : "";
			if (state.includes("RETURNRESOURCE") || state.includes("RETURNINGRESOURCE"))
			{
				++out.returning;
				continue;
			}
			if (Number.isFinite(Number(supplyId)) && (state.includes("GATHER.APPROACHING") || state.includes("GATHER.WALKING")))
			{
				++out.approaching;
				continue;
			}
			if (!Number.isFinite(Number(supplyId)) || !hasLiveGatherOrder(ent, Number(supplyId)))
			{
				if (job === "chicken" && Number.isFinite(Number(ent.getMetadata(PlayerID, "expertScoutIssuedAt"))))
					++out.scout;
				else
					++out.unproductive;
				continue;
			}
			const gatherType = ent.getMetadata(PlayerID, "gather-type");
			const target = gameState.getEntityById(Number(supplyId));
			const actualGeneric = this.resourceGenericForSupply(target) || gatherType;
			if (target && hasClass(target, "Field"))
				++out.farm;
			else if (job === "chicken" && actualGeneric === "food")
				++out.chicken;
			else if (actualGeneric === "food") ++out.food;
			else if (actualGeneric === "wood") ++out.wood;
			else if (actualGeneric === "stone") ++out.stone;
			else if (actualGeneric === "metal") ++out.metal;
			else ++out.unproductive;
		}
		return out;
	}

	diagnose(gameState, frame, food, woodsite)
	{
		if (gameState.ai.elapsedTime - this.lastDiag < 15)
			return;
		this.lastDiag = gameState.ai.elapsedTime;
		const workers = this.economyWorkerMetrics(gameState);
		const actual = this.actualWorkerOrders(gameState);
		const res = gameState.getResources();
		aiWarn("[EXPERT-IT14.55] t=" + Math.round(gameState.ai.elapsedTime) +
			" strat=" + (this.strategyDoctrine && this.strategyDoctrine.id || "-") +
			" stage=" + frame.stage.stage + " pop=" + gameState.getPopulation() + "/" + gameState.getPopulationLimit() +
			" opCap=" + Math.min(gameState.getPopulationMax(), Number(mergePolicy().expertOperatingPopulationCap) || 200) + "/" + gameState.getPopulationMax() +
			" res=" + Math.round(res.food) + "/" + Math.round(res.wood) + "/" + Math.round(res.stone) + "/" + Math.round(res.metal) +
			" desired f=" + workers.food + " farm=" + workers.farm + " w=" + workers.wood + " woodCiv=" + workers.woodCivilians + " overflow=" + workers.overflowWood + " b=" + workers.builders + " army=" + (workers.attackCommitted || 0) +
			" actual f=" + actual.food + " farm=" + actual.farm + " w=" + actual.wood + " s=" + actual.stone + " m=" + actual.metal + " hunt=" + actual.chicken + " scout=" + actual.scout + " b=" + actual.builders + " walk=" + actual.approaching + " ret=" + actual.returning + " idle=" + actual.idle + " unprod=" + actual.unproductive +
			" built H=" + this.builtByClass(gameState, "House").length + " F=" + this.builtByClass(gameState, "Farmstead").length +
			" fld=" + this.builtByClass(gameState, "Field").length + " S=" + this.builtByClass(gameState, "Storehouse").length +
			" B=" + this.builtByClass(gameState, "Barracks").length +
			" G=" + this.builtByClass(gameState, "Forge").length +
			" T=" + this.builtByClass(gameState, "Temple").length +
			" foundations H=" + this.foundationsByClass(gameState, "House").length + " F=" + this.foundationsByClass(gameState, "Farmstead").length +
			" fld=" + this.foundationsByClass(gameState, "Field").length + " S=" + this.foundationsByClass(gameState, "Storehouse").length +
			" fruit=" + Math.round(100 * food.ratio) + "% altFruit=" + Math.round(frame.state.food.alternativeRemaining || 0) +
			" wood=" + Math.round(woodsite.localWoodAmount) + " woodStatus=" + frame.economy.derived.woodsiteStatus +
			" woodRate=" + (this.woodIncomeMeasured ? this.woodIncomeEMA.toFixed(1) + "M" : "NA") +
			" woodCrisis=" + (this.phaseWoodCrisis ? "phase:" + Math.round(this.phase2Shortfall.wood || 0) : this.woodIncomeStalled ? "stall" : "no") +
			" houseTrig=" + frame.economy.derived.houseTriggerFreePopulation + " farmPrebuild=" + frame.economy.derived.farmPrebuild +
			" wantFld=" + frame.economy.derived.desiredFields +
			" need2B=" + frame.economy.derived.requiredSecondFields + " bridge2B=" + Math.round(frame.economy.derived.secondBarracksBridgeSeconds || 0) + "s ready2B=" + frame.economy.derived.secondBarracksFoodReady +
			" foodSlots=" + Math.round(this.lastImmediateFoodSlots || 0) + " bal=" + (this.lastResourceBalance && this.lastResourceBalance.active ? this.lastResourceBalance.surplus + ">" + this.lastResourceBalance.target + "@" + this.lastResourceBalance.ratio.toFixed(1) : "off") +
			" fw=" + (this.lastFoodWoodFeedback && this.lastFoodWoodFeedback.mode || "opening") +
			(this.lastFoodWoodFeedback && Number.isFinite(this.lastFoodWoodFeedback.rateRatio) ? "@" + Math.min(99, this.lastFoodWoodFeedback.rateRatio).toFixed(2) : "") +
			" p2=" + (this.lastPhase2Decision && this.lastPhase2Decision.state || "waiting") +
			" def=" + (this.expertDefenseState && this.expertDefenseState.active ? this.expertDefenseState.stage + ":" +
				(this.expertDefenseState.assembled || 0) + "/" + (this.expertDefenseState.defenderCount || 0) +
				(this.expertDefenseState.outmatched ? ":out" : "") : "idle") +
			" foodRate=" + frame.state.food.naturalIncomeRate.toFixed(1) + "+" + frame.state.food.farmIncomeRate.toFixed(1) +
			" delivered=" + frame.state.food.measuredFoodIncomeRate.toFixed(1) + (frame.state.food.measuredFoodIncomeAvailable ? "M" : "A") +
			" natRemain=" + Math.round(frame.state.food.totalNaturalRemaining) +
			" natRatio=" + Math.round((Number(frame.state.food.territoryNaturalRatio) || 0) * 100) + "%" +
			" runway=" + Math.round(frame.state.food.naturalRunwaySeconds) + "s" +
			" burn=" + frame.state.food.ccFoodBurnRate.toFixed(1) + "/" + frame.state.food.oneBarracksFoodBurnRate.toFixed(1) + "/" + frame.state.food.twoBarracksFoodBurnRate.toFixed(1) +
			" fieldCap=" + frame.state.food.supportedFieldSlots + "/" + frame.state.food.openFieldSlots +
			" hubCap=" + (this.lastFarmCapacitySnapshot && this.lastFarmCapacitySnapshot.hubs ?
				this.lastFarmCapacitySnapshot.hubs.map(hub => hub.builtFieldCount + "+" + hub.slots.length).join(",") : "-"));
	}

	releaseAll(gameState, reason)
	{
		if (this.released)
			return;
		this.released = true;
		this.releaseReason = reason;
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !ent.getMetadata || !ent.setMetadata)
				continue;
			if (ent.getMetadata(PlayerID, DEFAULT_OWNERSHIP_METADATA) !== true)
				continue;
			for (const key of [DEFAULT_OWNERSHIP_METADATA, JOB_METADATA, PENDING_JOB_METADATA, TASK_KEY, CIVILIAN_ORDINAL, WORKSITE_ID, FOOD_SITE, FOOD_SITE_CHANGED_AT, FOOD_PREVIOUS_SITE, SUPPLY_ID, EXPERT_DEFENSE, EXPERT_DEFENSE_ORDER_AT, EXPERT_DEFENSE_ORDER_STAGE, EXPERT_CIVILIAN_EVAC, EXPERT_CIVILIAN_DANGER_AT, EXPERT_WICKER_PEELED, EXPERT_WICKER_BRANCH, NATURAL_FOOD_LOCK, FOOD_HOME_FARMSTEAD, FOOD_HOME_PERMANENT, EXPERT_ADAPTIVE_FOOD, EXPERT_FALLBACK_LEASE_UNTIL, EXPERT_FALLBACK_LEASE_RESOURCE, "target-foundation", "expertWoundedReturnUntil", "expertWoundedFromPlan", "expertCombatRetreatUntil", "expertCombatRetreatReason", "expertRamAttackPlan"])
				ent.setMetadata(PlayerID, key, undefined);
		}
		for (const name of Object.keys(this.HQ.Config.priorities || {}))
			if (gameState.ai.queues[name])
				gameState.ai.queueManager.changePriority(name, this.HQ.Config.priorities[name]);
		if (!this.HQ.firstBaseConfig && this.HQ.hasPotentialBase())
			this.HQ.configFirstBase(gameState);
		aiWarn("[EXPERT-IT14.55] manual Expert release at t=" + Math.round(gameState.ai.elapsedTime) + " reason=" + reason);
	}

	Serialize()
	{
		return {
			"controlUntil": this.controlUntil,
			"released": this.released,
			"releaseReason": this.releaseReason,
			"memory": this.memory,
			"civilianRoster": serializeCivilianRoster(this.civilianRoster),
			"foodTracker": { "ids": [...this.foodTracker.ids], "initialAmount": this.foodTracker.initialAmount },
			"foundationTracker": this.foundationTracker.serialize(),
			"initialWoodSelection": this.initialWoodSelection,
			"primaryWoodWorksite": this.primaryWoodWorksite,
			"activeTaskByKind": { ...this.activeTaskByKind },
			"activeTaskBuildIntent": { ...this.activeTaskBuildIntent },
			"placementFailureCounts": { ...this.placementFailureCounts },
			"activeFieldTasks": [...this.activeFieldTasks],
			"pendingFieldPositions": { ...this.pendingFieldPositions },
			"taskCounters": { ...this.taskCounters },
			"taskStartedAt": { ...this.taskStartedAt },
			"pendingWoodSelectionByTask": { ...this.pendingWoodSelectionByTask },
			"pendingFoodSelectionByTask": { ...this.pendingFoodSelectionByTask },
			"readyNextFoodCluster": this.readyNextFoodCluster,
			"activeNaturalExpansionCluster": this.activeNaturalExpansionCluster,
			"openingChickenIds": [...this.openingChickenIds],
			"openingChickensCaptured": this.openingChickensCaptured,
			"openingChickenPhaseComplete": this.openingChickenPhaseComplete,
			"fieldPlacementFailures": { ...this.fieldPlacementFailures },
			"farmsteadPlacementFailures": this.farmsteadPlacementFailures,
			"firstCCSoldierBatchQueued": this.firstCCSoldierBatchQueued,
			"secondCCEmergencyBatchQueued": this.secondCCEmergencyBatchQueued,
			"firstBarracksSoldierBatchQueued": this.firstBarracksSoldierBatchQueued,
			"foodIncomeSample": this.foodIncomeSample,
			"foodIncomeEMA": this.foodIncomeEMA,
			"foodIncomeMeasured": this.foodIncomeMeasured,
			"woodIncomeSample": this.woodIncomeSample,
			"woodIncomeEMA": this.woodIncomeEMA,
			"woodIncomeMeasured": this.woodIncomeMeasured,
			"woodLastDeliveryAt": this.woodLastDeliveryAt,
			"woodIncomeStalled": this.woodIncomeStalled,
			"phaseWoodCrisis": this.phaseWoodCrisis,
			"phase2QueuedAt": this.phase2QueuedAt,
			"phase2Shortfall": { ...this.phase2Shortfall },
			"lastResourceRebalanceTime": this.lastResourceRebalanceTime,
			"lastFoodPressureRebalanceTime": this.lastFoodPressureRebalanceTime,
			"lastFoodWoodFeedback": this.lastFoodWoodFeedback,
			"lastPhase2Decision": this.lastPhase2Decision,
			"woodMigrationWindowStart": this.woodMigrationWindowStart,
			"woodMigrationsThisWindow": this.woodMigrationsThisWindow,
			"expertDefenseState": { ...this.expertDefenseState },
			"lastEmergencyTowerTime": this.lastEmergencyTowerTime,
			"emergencyTowerCount": this.emergencyTowerCount,
			"postWickerBerryPeelDone": this.postWickerBerryPeelDone,
			"postWickerBranchCluster": this.postWickerBranchCluster,
			"postWickerBranchWorkerIds": [...this.postWickerBranchWorkerIds],
			"postWickerBranchFarmsteadPending": this.postWickerBranchFarmsteadPending,
			"secondaryNaturalDepletionFieldPending": this.secondaryNaturalDepletionFieldPending,
			"naturalFoodDiscoveredAmounts": { ...this.naturalFoodDiscoveredAmounts },
			"lastTerritoryNaturalFoodRatio": this.lastTerritoryNaturalFoodRatio,
			"trainerIdleSince": { ...this.trainerIdleSince },
			"athensP2TrainingCursor": this.athensP2TrainingCursor,
			"lastStrategicMetalRebalanceTime": this.lastStrategicMetalRebalanceTime,
			"resourceRoundTripBySupply": { ...this.resourceRoundTripBySupply },
			"lastResourceServiceBuildTime": this.lastResourceServiceBuildTime,
			"lastFoodCapacityDeadlockDiag": this.lastFoodCapacityDeadlockDiag,
			"lastAthenianSlingerDiag": this.lastAthenianSlingerDiag,
			"expertObservedP2MilitaryTechs": { ...this.expertObservedP2MilitaryTechs },
			"expertObservedCoreEcoTechs": { ...this.expertObservedCoreEcoTechs },
			"strategyDoctrine": this.strategyDoctrine ? { "id": this.strategyDoctrine.id } : undefined,
			"strategyP2TransitionLogged": this.strategyP2TransitionLogged
		};
	}

	Deserialize(gameState, data)
	{
		if (!data)
			return;
		this.controlUntil = Number.isFinite(data.controlUntil) ? data.controlUntil : CONTROL_UNTIL;
		this.released = !!data.released;
		this.releaseReason = data.releaseReason;
		this.memory = createMemory(data.memory || {});
		this.civilianRoster = deserializeCivilianRoster(data.civilianRoster || {});
		this.foodTracker = new PrimaryFoodClusterTracker(data.foodTracker || {});
		this.foundationTracker = FoundationTracker.deserialize(data.foundationTracker || {});
		this.initialWoodSelection = data.initialWoodSelection;
		this.primaryWoodWorksite = data.primaryWoodWorksite;
		this.activeTaskByKind = { ...(data.activeTaskByKind || {}) };
		this.activeTaskBuildIntent = { ...(data.activeTaskBuildIntent || {}) };
		this.placementFailureCounts = { ...(data.placementFailureCounts || {}) };
		this.activeFieldTasks = Array.isArray(data.activeFieldTasks) ? [...data.activeFieldTasks] : [];
		this.pendingFieldPositions = { ...(data.pendingFieldPositions || {}) };
		this.taskCounters = { ...(data.taskCounters || {}) };
		this.taskStartedAt = { ...(data.taskStartedAt || {}) };
		this.pendingWoodSelectionByTask = { ...(data.pendingWoodSelectionByTask || {}) };
		this.pendingFoodSelectionByTask = { ...(data.pendingFoodSelectionByTask || {}) };
		this.readyNextFoodCluster = data.readyNextFoodCluster;
		this.activeNaturalExpansionCluster = data.activeNaturalExpansionCluster;
		this.openingChickenIds = Array.isArray(data.openingChickenIds) ? [...data.openingChickenIds] : [];
		this.openingChickensCaptured = !!data.openingChickensCaptured;
		this.openingChickenPhaseComplete = !!data.openingChickenPhaseComplete;
		this.fieldPlacementFailures = { ...(data.fieldPlacementFailures || {}) };
		this.farmsteadPlacementFailures = Number(data.farmsteadPlacementFailures) || 0;
		this.firstCCSoldierBatchQueued = !!data.firstCCSoldierBatchQueued;
		this.secondCCEmergencyBatchQueued = !!data.secondCCEmergencyBatchQueued;
		this.firstBarracksSoldierBatchQueued = !!data.firstBarracksSoldierBatchQueued;
		this.foodIncomeSample = data.foodIncomeSample;
		this.foodIncomeEMA = Number(data.foodIncomeEMA) || 0;
		this.foodIncomeMeasured = !!data.foodIncomeMeasured;
		this.woodIncomeSample = data.woodIncomeSample;
		this.woodIncomeEMA = Number(data.woodIncomeEMA) || 0;
		this.woodIncomeMeasured = !!data.woodIncomeMeasured;
		this.woodLastDeliveryAt = Number.isFinite(data.woodLastDeliveryAt) ? data.woodLastDeliveryAt : -99999;
		this.woodIncomeStalled = !!data.woodIncomeStalled;
		this.phaseWoodCrisis = !!data.phaseWoodCrisis;
		this.phase2QueuedAt = Number.isFinite(data.phase2QueuedAt) ? data.phase2QueuedAt : -99999;
		this.phase2Shortfall = { food: 0, wood: 0, stone: 0, metal: 0, ...(data.phase2Shortfall || {}) };
		this.lastPhaseStallDiag = -99999;
		this.lastWoodStallDiag = -99999;
		this.lastResourceRebalanceTime = Number.isFinite(data.lastResourceRebalanceTime) ? data.lastResourceRebalanceTime : -99999;
		this.lastFoodPressureRebalanceTime = Number.isFinite(data.lastFoodPressureRebalanceTime) ? data.lastFoodPressureRebalanceTime : -99999;
		this.lastFoodWoodFeedback = data.lastFoodWoodFeedback || { "mode": "load" };
		this.lastPhase2Decision = data.lastPhase2Decision || { "state": "waiting", "reason": "load" };
		this.woodMigrationWindowStart = Number.isFinite(data.woodMigrationWindowStart) ? data.woodMigrationWindowStart : -99999;
		this.woodMigrationsThisWindow = Number(data.woodMigrationsThisWindow) || 0;
		this.expertDefenseState = data.expertDefenseState ? { ...data.expertDefenseState } : { "active": false, "stage": "idle", "startedAt": -99999, "lastSeen": -99999 };
		this.lastEmergencyTowerTime = Number.isFinite(data.lastEmergencyTowerTime) ? data.lastEmergencyTowerTime : -99999;
		this.emergencyTowerCount = Number(data.emergencyTowerCount) || 0;
		this.postWickerBerryPeelDone = !!data.postWickerBerryPeelDone;
		this.postWickerBranchCluster = data.postWickerBranchCluster;
		this.postWickerBranchWorkerIds = Array.isArray(data.postWickerBranchWorkerIds) ? data.postWickerBranchWorkerIds.map(Number).filter(Number.isFinite) : [];
		this.postWickerBranchFarmsteadPending = !!data.postWickerBranchFarmsteadPending;
		this.secondaryNaturalDepletionFieldPending = !!data.secondaryNaturalDepletionFieldPending;
		this.naturalFoodDiscoveredAmounts = { ...(data.naturalFoodDiscoveredAmounts || {}) };
		this.lastTerritoryNaturalFoodRatio = Number.isFinite(data.lastTerritoryNaturalFoodRatio) ? data.lastTerritoryNaturalFoodRatio : 1;
		this.trainerIdleSince = { ...(data.trainerIdleSince || {}) };
		this.athensP2TrainingCursor = Math.max(0, Math.min(2, Number(data.athensP2TrainingCursor) || 0));
		this.lastStrategicMetalRebalanceTime = Number.isFinite(data.lastStrategicMetalRebalanceTime) ? data.lastStrategicMetalRebalanceTime : -99999;
		this.resourceRoundTripBySupply = { ...(data.resourceRoundTripBySupply || {}) };
		this.lastResourceServiceBuildTime = Number.isFinite(data.lastResourceServiceBuildTime) ? data.lastResourceServiceBuildTime : -99999;
		this.lastFoodCapacityDeadlockDiag = Number.isFinite(data.lastFoodCapacityDeadlockDiag) ? data.lastFoodCapacityDeadlockDiag : -99999;
		this.lastAthenianSlingerDiag = Number.isFinite(data.lastAthenianSlingerDiag) ? data.lastAthenianSlingerDiag : -99999;
		this.expertObservedP2MilitaryTechs = { ...(data.expertObservedP2MilitaryTechs || {}) };
		this.expertObservedCoreEcoTechs = { ...(data.expertObservedCoreEcoTechs || {}) };
		this.strategyDoctrine = data.strategyDoctrine && data.strategyDoctrine.id ? doctrineById(data.strategyDoctrine.id) : undefined;
		this.strategyLogged = !!this.strategyDoctrine;
		this.strategyP2TransitionLogged = !!data.strategyP2TransitionLogged;
		this.lastUpdateTurn = -1;
	}
}
