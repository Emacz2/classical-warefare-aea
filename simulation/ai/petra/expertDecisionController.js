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
import { predictiveHouseTrigger } from "simulation/ai/petra/expertDecision/economyPlanner.js";
import {
	createCivilianRoster, reconcileCivilianRoster, decideCivilianJob, decidePostOpeningCivilianJob, resourceBalanceDirective,
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
const CONTROL_UNTIL = -1; // save-compatibility only: Expert no longer auto-hands off to Petra.
const CITY_STATE_CIVS = new Set(["athen", "spart", "theb"]);
const EARLY_AXE_CIVS = new Set(["athen", "theb"]);

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
		this.activeFieldTasks = [];
		this.pendingFieldPositions = {};
		this.taskCounters = {};
		this.taskStartedAt = {};
		this.pendingWoodSelectionByTask = {};
		this.pendingFoodSelectionByTask = {};
		this.readyNextFoodCluster = undefined;
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
		this.lastResourceRebalanceTime = -99999;
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
		// Preserve the proven pre-Wicker opening and single-source fruit branches. The
		// one-per-supply rule is specifically for multi-bush/multi-tree patches after
		// Wicker, where piling workers onto the same berry is wasted movement.
		const enforcePerSupply = this.wickerCompleted(gameState) && (cluster.ids || []).length > 1;
		if (!enforcePerSupply)
			return !!(cluster.availableIds && cluster.availableIds.length);
		const loads = this.naturalFoodSupplyLoads(gameState, cluster, ent.id());
		const perSupply = Math.max(1, Number(mergePolicy().naturalFoodMaxWorkersPerSupply) || 1);
		return (cluster.availableIds || []).some(id => (loads.get(Number(id)) || 0) < perSupply);
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
			const perSupply = Math.max(1, Number(policy.naturalFoodMaxWorkersPerSupply) || 1);
			const enforcePerSupply = this.wickerCompleted(gameState) && (cluster.ids || []).length > 1;
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
					preferredSupplySlots += enforcePerSupply ?
						Math.max(0, perSupply - (loads.get(Number(id)) || 0)) : engineOpen;
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

	playerGatheredFood(gameState)
	{
		const candidates = [
			gameState && gameState.playerData,
			gameState && gameState.sharedScript && gameState.sharedScript.playersData && gameState.sharedScript.playersData[PlayerID],
			gameState && gameState.ai && gameState.ai.sharedScript && gameState.ai.sharedScript.playersData && gameState.ai.sharedScript.playersData[PlayerID]
		];
		for (const data of candidates)
		{
			const value = data && data.statistics && data.statistics.resourcesGathered && Number(data.statistics.resourcesGathered.food);
			if (Number.isFinite(value))
				return value;
		}
		return undefined;
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
		const alternatives = this.foodClusters(gameState, foodContext).filter(cluster =>
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
			"ccSoldierActive": workers.civilians >= mergePolicy().civilianCap
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
		const ccFoodBurnRate = workers.civilians < policy.civilianCap && civilianExecution && civilianExecution.template ?
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
			let score = 0;
			for (const value of values)
			{
				if (value.includes("food.grain")) score += 120;
				else if (value.includes("food.fruit")) score += 110;
				else if (value.includes("wood.tree")) score += 105;
				else if (value.includes("stone.rock")) score += 85;
				else if (value.includes("metal.ore")) score += 85;
				else if (value.startsWith("ResourceGatherer/Capacities")) score += 75;
				else score += 50;
			}
			const totalCost = cost.food + cost.wood + cost.stone + cost.metal;
			economic.push({ name, score: score * 1000 - totalCost });
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
		aiWarn("[EXPERT-TECH] queued surplus eco upgrade " + pick);
	}

	researchExpertP2MilitaryTech(gameState, queues)
	{
		if (!gameState || !gameState.currentPhase || gameState.currentPhase() < 2 ||
		    !queues || !queues.minorTech || queues.minorTech.hasQueuedUnits())
			return false;
		const policy = mergePolicy();
		const resources = gameState.getResources();
		const candidates = [];
		for (const tech of gameState.findAvailableTech() || [])
		{
			const name = tech && tech[0], data = tech && tech[1];
			if (!name || !data || !data._template || !Array.isArray(data._template.modifications))
				continue;
			const affects = String(data._template.affects || "");
			if (!/(CitizenSoldier|Infantry|Soldier|Spearman|Javelineer|Cavalry)/i.test(affects))
				continue;
			let score = 0;
			for (const mod of data._template.modifications)
			{
				const value = String(mod && mod.value || "");
				if (value.startsWith("Attack/")) score += 130;
				else if (value.startsWith("Resistance/")) score += 115;
				else if (value.includes("Health/Max")) score += 105;
				else if (value.startsWith("UnitMotion/")) score += 70;
			}
			if (!score)
				continue;
			const raw = data._template.cost || {};
			const cost = { food: Number(raw.food) || 0, wood: Number(raw.wood) || 0, stone: Number(raw.stone) || 0, metal: Number(raw.metal) || 0 };
			if (resources.food < cost.food + policy.phase2MilitaryTechFoodReserve ||
			    resources.wood < cost.wood + policy.phase2MilitaryTechWoodReserve ||
			    resources.metal < cost.metal + policy.phase2MilitaryTechMetalReserve ||
			    resources.stone < cost.stone)
				continue;
			const totalCost = cost.food + cost.wood + cost.stone + cost.metal;
			candidates.push({ name, score: score * 1000 - totalCost });
		}
		if (!candidates.length)
			return false;
		candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
		const pick = candidates[0].name;
		const plan = new ResearchPlan(gameState, pick, false);
		if (!plan)
			return false;
		plan.metadata = { "expertDecisionLayer": true, "expertMilitaryTech": "p2" };
		queues.minorTech.addPlan(plan);
		gameState.ai.queueManager.changePriority("minorTech", Math.max(this.HQ.Config.priorities.minorTech || 1, 720));
		aiWarn("[EXPERT-P2] queued military tech " + pick);
		return true;
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
		if (enemies.length < policy.defenseThreatMinimumUnits)
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
		const policy = mergePolicy();
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
		const foodInfrastructureHealthy = fieldPipeline >= policy.phase2PreferredFields;
		const lateFoodFloor = fieldPipeline >= policy.phase2LateMinimumFields;
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
			reason: `t=${Math.round(now)} pop=${pop} fields=${fields}/${fieldPipeline} barracks=${barracks} coverage=${coverage.toFixed(2)} canResearch=${info.canResearch}`,
			name: info.name, cost: info.cost, coverage, fields, fieldPipeline, barracks, pop, time: now
		};
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
			this.lastPhase2Decision = { "state": "queued", "reason": "phase research already queued" };
			return true;
		}
		const decision = this.phase2Readiness(gameState, frame);
		this.lastPhase2Decision = decision;
		if (!decision.ready)
			return false;
		const plan = new ResearchPlan(gameState, decision.name, true);
		if (!plan)
			return false;
		plan.metadata = { "expertDecisionLayer": true, "expertPhase2": true, "lane": decision.state };
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
		let metrics = collectWorkerMetrics(gameState, { "playerId": PlayerID });
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
		// IT14.20: preserve the 20-civilian food-first opening. Once the permanent food
		// economy is mature and food is clearly surplus, NEW civilians may reinforce wood.
		// Existing farmers are never stripped off food by this release.
		const matureFoodWoodRelease = fields >= policy.matureFoodWoodReleaseFields &&
			resources.food >= policy.matureFoodWoodReleaseBank &&
			resources.food >= Math.max(1, resources.wood) * policy.matureFoodWoodReleaseRatio;
		const civilianTargets = miningUnlocked ?
			(foodAllowed ? (matureFoodWoodRelease ? ["food", "wood", "metal", "stone"] : ["food", "metal", "stone"]) :
				(matureFoodWoodRelease ? ["wood", "metal", "stone"] : ["metal", "stone"])) :
			(matureFoodWoodRelease ? ["food", "wood"] : ["food"]);
		const civilianBalance = balancingActive && miningUnlocked ?
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
			let desired;

			if (entry.ordinal <= openingEnd)
			{
				if (ent.getMetadata(PlayerID, EXPERT_WICKER_BRANCH) === true && ent.getMetadata(PlayerID, NATURAL_FOOD_LOCK))
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
						"foodSurplusRedirectThreshold": policy.foodSurplusRedirectThreshold, "miningStartCivilians": policy.miningStartCivilians,
						"miningMinimumCompletedFields": policy.miningMinimumCompletedFields,
						"miningFoodFloor": policy.miningFoodFloor, "miningWoodFloor": policy.miningWoodFloor,
						"miningTargetStoneWorkers": policy.miningTargetStoneWorkers, "miningTargetMetalWorkers": policy.miningTargetMetalWorkers
					});
					desired = d.job;
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
						"foodSurplusRedirectThreshold": policy.foodSurplusRedirectThreshold, "miningStartCivilians": policy.miningStartCivilians,
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
				++woodCivilians;
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

		this.rebalanceExistingWorkers(gameState, openingEnd, genericBalance);
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
			// Permanent civilian wood ownership is capped by the opening tranche.
			// Strategic wood correction should use citizen-soldiers instead.
			if (civilian && balance.target === "wood")
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
			aiWarn("[EXPERT-FOOD] natural farmstead builders committed to new cluster workers=" + committed);
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
		const timeout = mergePolicy().barracksAwaitingFoundationRetrySeconds;
		if (!Number.isFinite(started) || gameState.ai.elapsedTime - started < timeout)
			return false;
		const removed = this.cancelQueuedConstructionTask(gameState, taskId);
		this.releaseConstructionTeam(gameState, taskId);
		delete this.activeTaskByKind[kind];
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

			if (!isField && (kind === "barracks" || kind === "market") && this.retryStalledBarracksTask(gameState, taskId, observed, kind))
				return;

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
						this.readyNextFoodCluster = this.pendingFoodSelectionByTask[taskId];
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
				const action = branch ? { "builderPool": ["food", "food_owned"], "requiredBuilderIds": [...this.postWickerBranchWorkerIds] } :
					{ "builderPool": BUILDING_SPECS[kind].allowedBuilderJobs };
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

	alternativeWoodWorksiteExists(gameState, accessIndex)
	{
		return !!this.findHealthyAlternativeWoodWorksite(gameState, accessIndex,
			this.primaryWoodWorksite && this.primaryWoodWorksite.entityId);
	}

	selectInfantrySoldier(gameState, trainer, source = "barracks")
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
			const speed = typeof template.walkSpeed === "function" ? Number(template.walkSpeed()) || 0 : 0;
			const costScore = (stone + metal) * 20 + food + wood;
			candidates.push({ type, template, cost: { food, wood, stone, metal }, melee, ranged, hoplite, javelineer, speed, costScore });
		}
		if (!candidates.length)
			return undefined;

		const cheapest = list => [...list].sort((a, b) => a.costScore - b.costScore || b.speed - a.speed || a.type.localeCompare(b.type))[0];
		const ranged = candidates.filter(c => c.ranged);
		const melee = candidates.filter(c => c.melee);

		// Replay preference: the first deliberate military pulse is mobile ranged infantry
		// (Athens = javeliners), useful for fast building/gathering while the army masses.
		if ((source === "cc-opening" || source === "barracks-opening") && ranged.length)
		{
			const javs = ranged.filter(c => c.javelineer);
			return cheapest(javs.length ? javs : ranged);
		}

		let meleeCount = 0, rangedCount = 0;
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent || !hasClass(ent, "Infantry") || !hasClass(ent, "CitizenSoldier") || hasClass(ent, "Cavalry"))
				continue;
			if (hasClass(ent, "Melee")) ++meleeCount;
			if (hasClass(ent, "Ranged")) ++rangedCount;
		}
		const policy = mergePolicy();
		const targetMeleeShare = this.isCityStateCiv(gameState) ? policy.cityStateMeleeShare : policy.genericMeleeShare;
		const total = meleeCount + rangedCount;
		const currentMeleeShare = total > 0 ? meleeCount / total : 0;
		if (melee.length && (!ranged.length || currentMeleeShare < targetMeleeShare))
		{
			const hoplites = this.isCityStateCiv(gameState) ? melee.filter(c => c.hoplite) : [];
			return cheapest(hoplites.length ? hoplites : melee);
		}
		if (ranged.length)
			return cheapest(ranged);
		return cheapest(candidates);
	}
	trainerHasExpertSoldierWork(queues, trainer)
	{
		if (!trainer)
			return true;
		for (const item of trainer.trainingQueue ? trainer.trainingQueue() || [] : [])
			if (item.metadata && (item.metadata.expertDecisionTraining === "soldier" || item.metadata.expertDecisionMilitary === true))
				return true;
		const queue = queues && queues.citizenSoldier;
		if (!queue || !Array.isArray(queue.plans))
			return false;
		return queue.plans.some(plan => plan && plan.metadata &&
			(plan.metadata.expertDecisionTraining === "soldier" || plan.metadata.expertDecisionMilitary === true) &&
			Number(plan.metadata.trainer) === trainer.id());
	}

	queueExpertSoldierBatch(gameState, queues, trainer, source, requestedBatch = 2)
	{
		if (!queues || !queues.citizenSoldier || !trainer || this.trainerHasExpertSoldierWork(queues, trainer))
			return false;
		const selected = this.selectInfantrySoldier(gameState, trainer, source);
		if (!selected)
			return false;

		const policy = mergePolicy();
		const workers = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		const queuedCivilians = queues.villager ? queues.villager.countQueuedUnits() : 0;
		const queuedSoldiers = queues.citizenSoldier ? queues.citizenSoldier.countQueuedUnits() : 0;
		const free = gameState.getPopulationLimit() - this.HQ.getAccountedPopulation(gameState) - queuedCivilians - queuedSoldiers;
		const batch = Math.max(0, Math.min(Math.floor(requestedBatch), free));
		if (batch <= 0)
			return false;

		const resources = gameState.getResources();
		// Before the 75-civilian cap, leave one modest food reserve so the CC can resume
		// civilians after the deliberate ~3:00 soldier pulse.  At the cap, the CC is
		// military production and no civilian reserve is necessary.
		const reserve = workers.civilians >= policy.civilianCap ? 0 : policy.soldierFoodReserve;
		if (resources.food < reserve + selected.cost.food * batch ||
		    resources.wood < selected.cost.wood * batch || resources.stone < selected.cost.stone * batch ||
		    resources.metal < selected.cost.metal * batch)
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
		aiWarn("[EXPERT-MIL] queued " + source + " soldiers=" + selected.type + " batch=" + batch + " trainer=" + trainer.id());
		return true;
	}

	trainExpertMilitary(gameState, queues, cc)
	{
		const policy = mergePolicy();
		if (gameState.ai.elapsedTime < policy.soldierTrainingStartTime || !queues || !queues.citizenSoldier)
			return;
		const workers = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		const atCivilianCap = workers.civilians >= policy.civilianCap;

		// Expert keeps the CC on civilians continuously until 75. Barracks carry all
		// early military production; only at the civilian cap does the CC join them.
		if (cc && atCivilianCap)
			this.queueExpertSoldierBatch(gameState, queues, cc, "cc-cap", policy.soldierTrainingBatch);

		// Every completed barracks is a production building, not decoration. Large food
		// surpluses increase batch size instead of sitting untouched in the bank.
		const food = Number(gameState.getResources().food) || 0;
		const militaryBatch = food >= 1600 ? 4 : food >= 900 ? 3 : policy.soldierTrainingBatch;
		for (const barracks of this.builtByClass(gameState, "Barracks").sort((a, b) => a.id() - b.id()))
		{
			const now = Number(gameState.ai.elapsedTime) || 0;
			const busy = this.trainerHasExpertSoldierWork(queues, barracks);
			if (busy)
				delete this.trainerIdleSince[barracks.id()];
			else if (!Number.isFinite(Number(this.trainerIdleSince[barracks.id()])))
				this.trainerIdleSince[barracks.id()] = now;
			const source = this.firstBarracksSoldierBatchQueued ? "barracks" : "barracks-opening";
			if (this.queueExpertSoldierBatch(gameState, queues, barracks, source, militaryBatch))
			{
				const since = Number(this.trainerIdleSince[barracks.id()]);
				const gap = Number.isFinite(since) ? now - since : 0;
				if (gap > 2)
					aiWarn("[EXPERT-TRAIN] trainer-gap trainer=" + barracks.id() + " seconds=" + gap.toFixed(1));
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

	fieldRequestAt(gameState, farmPosition, farmsteadId)
	{
		const geometry = readTemplateGeometry(gameState, "field");
		const farmGeom = readTemplateGeometry(gameState, "farmstead");
		const failures = Number(this.fieldPlacementFailures[farmsteadId] || 0);
		return {
			"kind": "field",
			"anchor": farmPosition,
			"farmsteadId": farmsteadId,
			"anchorHalfExtents": farmGeom.halfExtents || { "width": farmGeom.radius, "depth": farmGeom.radius },
			"templateHalfExtents": geometry.halfExtents || { "width": geometry.radius, "depth": geometry.radius },
			"templateRadius": geometry.radius,
			"gap": 0.0,
			"gaps": failures >= 3 ? [0.0, 0.25, 0.5, 0.75, 1.0, 1.25] : [0.0, 0.25, 0.5, 0.75],
			"maxBorderGap": failures >= 3 ? 1.30 : 0.80,
			"edgeSamples": 15
		};
	}

	fieldSlotsAt(gameState, farmPosition, farmsteadId, accessIndex, shared = undefined, slotLimit = undefined, maxBorderGapOverride = undefined)
	{
		if (!Array.isArray(farmPosition))
			return [];
		const policy = mergePolicy();
		const request = this.fieldRequestAt(gameState, farmPosition, farmsteadId);
		if (Number.isFinite(Number(maxBorderGapOverride)))
		{
			request.maxBorderGap = Number(maxBorderGapOverride);
			request.gaps = maxBorderGapOverride > 1.30 ?
				[0.0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0] :
				[0.0, 0.25, 0.5, 0.75, 1.0, 1.25];
		}
		const fieldGeom = shared && shared.fieldGeom || readTemplateGeometry(gameState, "field");
		const farmGeom = shared && shared.farmGeom || readTemplateGeometry(gameState, "farmstead");
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
		const maxCenterDistance = nominal + 7;
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
		const farms = this.builtByClass(gameState, "Farmstead");
		const committedFields = this.builtByClass(gameState, "Field").length + this.activeFieldTasks.length;
		if (!farms.length)
			return { "known": true, "supportedFieldSlots": committedFields, "openFieldSlots": 0, "hubs": [] };
		let shared;
		try
		{
			shared = {
				"ports": createPetraPlacementPorts(gameState, "field", {
					"HQ": this.HQ,
					"createObstructionMap": createObstructionMap,
					"accessIndex": accessIndex
				}),
				"fieldGeom": readTemplateGeometry(gameState, "field"),
				"farmGeom": readTemplateGeometry(gameState, "farmstead")
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
		for (const farm of farms)
		{
			let slots = this.fieldSlotsAt(gameState, farm.position(), farm.id(), accessIndex, shared);
			let fieldGapLimit = this.fieldRequestAt(gameState, farm.position(), farm.id()).maxBorderGap;
			// The capacity scanner used to deadlock at maxBorderGap=0.8: if it saw zero
			// strict slots it never issued a field, so placement failures could never relax
			// the search. Probe the approved ~1.3m fallback, then the existing <=2m hard
			// geometry contract before declaring a farmstead incapable of taking a field.
			if (!slots.length)
			{
				slots = this.fieldSlotsAt(gameState, farm.position(), farm.id(), accessIndex, shared, undefined, 1.30);
				if (slots.length)
					fieldGapLimit = 1.30;
			}
			if (!slots.length)
			{
				slots = this.fieldSlotsAt(gameState, farm.position(), farm.id(), accessIndex, shared, undefined, 2.00);
				if (slots.length)
					fieldGapLimit = 2.00;
			}
			const builtFieldCount = builtFields.filter(field =>
				entityPosition(field) && SquareVectorDistance(field.position(), farm.position()) <= 42*42).length;
			hubs.push({ "farm": farm, "slots": slots, "builtFieldCount": builtFieldCount, fieldGapLimit });
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
			// IT14.21: compact farms first. Finish the farmstead that already has the
			// strongest field block before spreading fields across newer/emptier hubs.
			// Ties prefer the most recently built farmstead, then the one with more live slots.
			const ca = Number(a.builtFieldCount) || 0;
			const cb = Number(b.builtFieldCount) || 0;
			return cb - ca || b.farm.id() - a.farm.id() || b.slots.length - a.slots.length;
		});
		// Re-evaluate after each field is prepared. pendingFieldPositions immediately
		// removes the chosen slot, so capacity_2/3 can safely keep filling the same hub
		// until it is actually full instead of artificially fanning across farmsteads.
		return usable[0];
	}

	placementRequest(gameState, action, cc, accessIndex, foodObservation)
	{
		const kind = action.kind;
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
				for (const candidate of local)
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
			if (action.role === "natural_expansion" || action.role === "wicker_branch")
			{
				const foodContext = this.foodCaptureContext(gameState, cc, accessIndex);
				const alternative = action.role === "wicker_branch" ? this.postWickerBranchCluster :
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
				request = {
					kind,
					"role": action.role || "farm_hub",
					"anchor": cc.position(),
					"toward": anchor,
					// IT14.5 proved that a compact-ring-only search can deadlock permanent food.
					// Expand progressively into owned territory rather than rejecting 480 candidates
					// forever while civilians idle. The 30m hub-spacing contract remains intact.
					"distances": failures >= 4 ?
						[24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 104, 112] :
						[28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96],
					"angleCount": 32,
					"templateRadius": geometry.radius,
					"minimumCCDistance": mergePolicy().farmHubMinimumCCDistance,
					"pathSources": [],
					// IT14.21: a permanent farm hub is only worth buying if it can support a
					// real compact farm block. Do not relax down to one-field/two-field hubs,
					// which was the main cause of farmstead spam.
					"minimumFieldSlots": mergePolicy().minimumFarmHubFieldSlots,
					"preferredFieldSlots": Math.max(5, mergePolicy().minimumFarmHubFieldSlots)
				};
			}
		}
		else if (kind === "house")
		{
			if (this.builtByClass(gameState, "House").length === 0)
				request = {
					kind,
					"anchor": this.getPrimaryWoodPosition(gameState) || cc.position(),
					"avoid": cc.position(),
					"anchorRadius": 5,
					"templateRadius": geometry.radius,
					"maxBorderGap": 5,
					"minimumCCDistance": mergePolicy().houseMinimumCCDistance
				};
			else
			{
				const policy = mergePolicy();
				const phase = typeof gameState.currentPhase === "function" ? Number(gameState.currentPhase()) || 1 : 1;
				const houses = this.builtByClass(gameState, "House").sort((a, b) => a.id() - b.id());
				const first = houses[0];
				const firstPos = first && entityPosition(first) ? first.position() : cc.position();
				const woodPos = this.getPrimaryWoodPosition(gameState) || [cc.position()[0] + 1, cc.position()[1]];

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
					const candidates = [];
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
						"minimumCCDistance": policy.houseMinimumCCDistance, "phase2Housing": true };
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
					const lineCandidates = [];
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
						"minimumCCDistance": policy.houseMinimumCCDistance };
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
			const fieldIntent = this.fieldRequestAt(gameState, hub.farm.position(), hub.farm.id());
			request = {
				kind,
				"candidates": hub.slots,
				"farmsteadId": hub.farm.id(),
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
			let barracksCandidates = [...primary, ...fallback];
			if (action.role === "third_p2")
			{
				barracksCandidates.push(...generatePlacementCandidates({
					"kind": "barracks", "anchor": ccPos, "toward": outward,
					"distances": [34, 40, 46, 52, 58, 64, 72, 80, 88, 96, 108, 120], "angleCount": 48, "templateRadius": geometry.radius
				}));
			}
			request = { kind, "candidates": barracksCandidates, "templateRadius": geometry.radius,
				"minimumCCDistance": policy.barracksMinimumCCDistance };
		}

		else if (kind === "market")
		{
			const policy = mergePolicy();
			const ccPos = cc.position();
			const developed = [
				...this.builtByClass(gameState, "House"), ...this.builtByClass(gameState, "Barracks"),
				...this.builtByClass(gameState, "Storehouse")
			].filter(ent => ent && entityPosition(ent));
			developed.sort((a, b) => SquareVectorDistance(b.position(), ccPos) - SquareVectorDistance(a.position(), ccPos) || a.id() - b.id());
			const candidates = [];
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
				"toward": this.getPrimaryWoodPosition(gameState) || [ccPos[0] + 1, ccPos[1]],
				"distances": [34, 40, 46, 52, 58, 64, 72, 80, 88, 96], "angleCount": 48, "templateRadius": geometry.radius }));
			request = { kind, candidates, "templateRadius": geometry.radius, "minimumCCDistance": policy.barracksMinimumCCDistance };
		}

		else if (kind === "tower")
			request = {
				kind,
				// Emergency towers sit between the CC/rally point and the incoming army.
				// Ordered-angle placement tries the threat-facing side first, then fans out.
				"anchor": cc.position(),
				"toward": this.expertDefenseState && this.expertDefenseState.threatPosition || [cc.position()[0] + 1, cc.position()[1]],
				"distances": [16, 20, 24, 28, 32, 36],
				"angleCount": 24,
				"templateRadius": geometry.radius
			};
		if (!request)
			return undefined;
		if (kind === "house" || kind === "barracks" || kind === "market")
			request.preserveFarmDistrict = true;
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
		if (kind === "house" || kind === "barracks" || kind === "market")
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
			for (const farm of farmsteads)
			{
				const slots = this.fieldSlotsAt(gameState, farm.position(), farm.id(), accessIndex, shared,
					policy.fieldsPerFarmstead, 2.00);
				for (const slot of slots)
					reservedSlots.push({ "position": slot, "farmsteadId": farm.id() });
			}
			farmDistrictReservation = {
				"farmsteads": farmsteads,
				"reservedSlots": reservedSlots,
				"fieldHalf": fieldGeom.halfExtents || { "width": fieldGeom.radius, "depth": fieldGeom.radius },
				"farmHalf": farmGeom.halfExtents || { "width": farmGeom.radius, "depth": farmGeom.radius },
				"buildingHalf": buildingGeom.halfExtents || { "width": buildingGeom.radius, "depth": buildingGeom.radius },
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
				"farmGeom": readTemplateGeometry(gameState, "farmstead")
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
			if (request && request.preserveFarmDistrict && farmDistrictReservation)
			{
				const margin = farmDistrictReservation.slotMargin;
				const buildingHalf = farmDistrictReservation.buildingHalf;
				const fieldHalf = farmDistrictReservation.fieldHalf;
				const farmHalf = farmDistrictReservation.farmHalf;
				// Never let an independent building sit directly against the farmstead itself.
				// That immediate perimeter belongs to the first touching fields.
				for (const farm of farmDistrictReservation.farmsteads)
				{
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
				// the replay/user contract of <=2m border gap.
				const farmsteadId = Number(request && request.farmsteadId);
				const farmstead = Number.isFinite(farmsteadId) ? gameState.getEntityById(farmsteadId) : undefined;
				if (!farmstead || !entityPosition(farmstead))
					return false;
				const farmGeom = readTemplateGeometry(gameState, "farmstead");
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
			if (kind === "farmstead")
			{
				for (const ent of [...this.builtByClass(gameState, "Farmstead"), ...this.foundationsByClass(gameState, "Farmstead")])
					if (entityPosition(ent) && SquareVectorDistance(position, ent.position()) < 30*30)
						return false;
				const minimumFieldSlots = Number(request && request.minimumFieldSlots) || 0;
				if (minimumFieldSlots > 0 && farmCapacityAt && farmCapacityAt(position) < minimumFieldSlots)
					return false;
			}
			if (kind === "storehouse" && this.builtByClass(gameState, "Storehouse").length)
			{
				const spacing = mergePolicy().woodStorehouseMinimumSpacing;
				for (const ent of this.builtByClass(gameState, "Storehouse"))
					if (SquareVectorDistance(position, ent.position()) < spacing * spacing)
						return false;
			}
			if (kind === "tower")
				for (const ent of [...this.builtByClass(gameState, "Tower"), ...this.foundationsByClass(gameState, "Tower")])
					if (entityPosition(ent) && SquareVectorDistance(position, ent.position()) < 34*34)
						return false;
			return true;
		};
		if (kind === "farmstead")
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
		else if ((kind === "house" || kind === "barracks" || kind === "market") && farmDistrictReservation)
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
		for (const action of frame.actions)
		{
			if (action.type === "BUILD")
			{
				if (action.kind === "field")
				{
					if (this.activeFieldTasks.length >= policy.maxConcurrentFieldTasks)
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
					if (action.kind === "farmstead" && (action.role || "") === "farm_hub")
						++this.farmsteadPlacementFailures;
					aiWarn("[EXPERT-PLACE] blocked kind=" + action.kind + " role=" + (action.role || "primary") +
						" reason=" + (blocked && blocked.reason || "unknown") + " rejected=" + rejected.length);
					delete this.pendingWoodSelectionByTask[request.taskId];
					delete this.pendingFoodSelectionByTask[request.taskId];
					continue;
				}
				if (action.kind === "farmstead" && (action.role || "") === "farm_hub")
					this.farmsteadPlacementFailures = 0;
				if (action.kind === "tower")
				{
					this.lastEmergencyTowerTime = Number(gameState.ai.elapsedTime) || 0;
					++this.emergencyTowerCount;
					aiWarn("[EXPERT-DEF] emergency tower queued count=" + this.emergencyTowerCount +
						" foe=" + (this.expertDefenseState.foeCount || 0));
				}
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

	assignFoodWorker(gameState, ent, foodNetwork, accessIndex)
	{
		const network = foodNetwork && Array.isArray(foodNetwork.clusters) ? foodNetwork : { clusters: [] };
		const clusters = network.clusters;
		const siteIds = decodeFoodSite(ent.getMetadata(PlayerID, FOOD_SITE));
		const previousSiteIds = decodeFoodSite(ent.getMetadata(PlayerID, FOOD_PREVIOUS_SITE));
		let lockedSiteIds = decodeFoodSite(ent.getMetadata(PlayerID, NATURAL_FOOD_LOCK));
		let lockedCluster = matchingFoodCluster(clusters, lockedSiteIds);
		if (lockedSiteIds.length && (!lockedCluster || !(Number(lockedCluster.remaining) > 0)))
		{
			// A natural branch is sacred while food remains, but the lock must disappear
			// once the source is genuinely exhausted so the civilian can rejoin the economy.
			// If field #1 does not exist yet, this depletion is also the explicit handoff
			// from free food to permanent food requested by the opening doctrine.
			if (this.builtByClass(gameState, "Field").length === 0 && !this.secondaryNaturalDepletionFieldPending)
			{
				this.secondaryNaturalDepletionFieldPending = true;
				aiWarn("[EXPERT-FARM] secondary natural branch exhausted; forcing first field");
			}
			ent.setMetadata(PlayerID, NATURAL_FOOD_LOCK, undefined);
			ent.setMetadata(PlayerID, EXPERT_WICKER_BRANCH, undefined);
			lockedSiteIds = [];
			lockedCluster = undefined;
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

		let target = Number.isFinite(metadataTargetId) && cluster.ids.includes(metadataTargetId) ? existingTarget : undefined;
		if (!(target && target.resourceSupplyAmount && target.resourceSupplyAmount() > 0))
		{
			let candidates = cluster.availableIds.map(id => gameState.getEntityById(id)).filter(s => s && entityPosition(s));
			// IT14.22: NEW natural-food assignments are one civilian per live supply.
			// When every bush/tree already has its preferred worker, the next food-owned
			// civilian starts/helps a field instead of becoming worker #2 on a berry.
			const loads = this.naturalFoodSupplyLoads(gameState, cluster, ent.id());
			const perSupply = Math.max(1, Number(mergePolicy().naturalFoodMaxWorkersPerSupply) || 1);
			const enforcePerSupply = this.wickerCompleted(gameState) && (cluster.ids || []).length > 1;
			if (enforcePerSupply)
				candidates = candidates.filter(s => (loads.get(s.id()) || 0) < perSupply);
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
		const foundations = [
			...this.foundationsByClass(gameState, "Field").map(foundation => ({ foundation, rank: 0, kind: "field" })),
			...this.foundationsByClass(gameState, "Farmstead").map(foundation => ({ foundation, rank: 1, kind: "farmstead" }))
		].filter(item => item.foundation && entityPosition(item.foundation));
		if (!foundations.length)
			return false;
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
				this.assignSafeFallback(gameState, ent, accessIndex, ["wood", "food", "stone", "metal"]);
				return;
			}
			const candidates = trees.filter(tree => !tree.saturated).map(tree => ({
				...tree,
				"workerDistance": Math.sqrt(SquareVectorDistance(ent.position(), tree.position))
			}));
			candidates.sort((a, b) => (a.dropDistance*10 + a.workerDistance) - (b.dropDistance*10 + b.workerDistance) || a.id - b.id);
			if (!candidates.length)
			{
				this.assignSafeFallback(gameState, ent, accessIndex, ["wood", "food", "stone", "metal"]);
				return;
			}
			target = gameState.getEntityById(candidates[0].id);
			if (!target)
			{
				this.assignSafeFallback(gameState, ent, accessIndex, ["wood", "food", "stone", "metal"]);
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

	resourceCandidatesInOwnTerritory(gameState, ent, accessIndex, generic)
	{
		const out = [];
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
			out.push(supply);
		}
		out.sort((a, b) => SquareVectorDistance(ent.position(), a.position()) - SquareVectorDistance(ent.position(), b.position()) || a.id() - b.id());
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
			const workers = collectWorkerMetrics(gameState, { "playerId": PlayerID });
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
			foundations.push({
				key: taskId, kind, taskId, observed, foundation, context,
				wanted: Math.max(1, desiredBuilders(kind, context)),
				priority: constructionPriority(kind, context)
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
				const candidates = selectMaintenanceTeam(gameState, kind, foundation.position(), wanted, {}, {
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
			    ent.getMetadata(PlayerID, "PartOfArmy"))
				continue;
			const state = ent.unitAIState ? ent.unitAIState() : "";
			if (state && state.includes(".COMBAT."))
				continue;
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			if (job === "food")
				this.assignFoodWorker(gameState, ent, foodNetwork, accessIndex);
			else if (job === "food_owned")
			{
				// Natural food is always attempted first. assignFoodWorker performs a one-way
				// fallback to a field only when the entire in-territory natural network has no
				// available capacity. This prevents new food civilians from skipping berries.
				this.assignFoodWorker(gameState, ent, foodNetwork, accessIndex);
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
		const map = { house: "house", storehouse: "dropsites", farmstead: "dropsites", field: "field", barracks: "militaryBuilding", market: "economicBuilding", tower: "defenseBuilding" };
		if (this.activeTaskByKind.barracks)
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
		const foodObservation = this.advanceFoodTracker(gameState, foodContext);
		const foodNetwork = this.foodClusterNetwork(gameState, foodContext);
		const territoryNaturalFood = this.territoryNaturalFoodMetrics(gameState, foodNetwork);
		// Military reaction happens before economy assignment. Mobilized citizen-soldiers are
		// then invisible to worker retargeting while they deposit, retreat, assemble and fight.
		const defenseState = this.coordinateExpertDefense(gameState, cc);
		this.coordinateCivilianSafety(gameState, cc);

		// Compute the current production burn BEFORE assigning newly-created civilians.
		// New permanent jobs are based on how many food workers the active CC/barracks
		// actually need, not on "CC is still below 75, so make another farmer".
		const preAssignmentFoodThroughput = this.foodThroughputMetrics(gameState, cc, foodNetwork);
		this.syncJobs(gameState, foodNetwork, preAssignmentFoodThroughput);
		const foodAlternative = this.alternativeFoodInfo(gameState, foodContext, foodObservation);
		this.applyPostWickerBerryPeel(gameState, foodObservation, foodAlternative);
		const allFoodClusters = foodNetwork.clusters;
		const woodsite = this.collectWoodsite(gameState, cc, accessIndex);
		const workers = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		const farmCapacity = this.farmCapacitySnapshot(gameState, accessIndex);
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
			"workers": workers
		});
		let frame = stepDecision(this.memory, observation);
		this.memory = frame.memory;
		this.lastDesiredFields = Number(frame && frame.derived && frame.derived.desiredFields) || 0;
		// Once the mature P1 economy is ready, phase reservation outranks optional eco
		// research. During the opening this returns false, so Wicker/Axe still run before
		// the first house exactly as before.
		const phasePending = this.researchExpertPhase2(gameState, queues, frame);
		if (!phasePending && !(defenseState && defenseState.active))
		{
			const militaryTech = this.researchExpertP2MilitaryTech(gameState, queues);
			if (!militaryTech)
				this.researchExpertEcoTech(gameState, queues, allFoodClusters, cc);
		}
		frame = this.filterFrameForOpeningTech(gameState, queues, allFoodClusters, frame);
		frame = this.applyPostWickerBranchConstruction(frame);
		frame = this.applySecondaryDepletionFieldTrigger(gameState, frame);
		if (defenseState && defenseState.shouldBuildTower)
			frame = { ...frame, "actions": [...frame.actions, { "type": "BUILD", "kind": "tower", "role": "emergency_defense",
				"builderPool": ["wood", "citizenSoldierWood"] }] };
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
		this.trainExpertMilitary(gameState, queues, cc);
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
			if (target && hasClass(target, "Field"))
				++out.farm;
			else if (job === "food" || job === "food_owned")
				(gatherType === "wood" ? ++out.wood : ++out.food);
			else if (job === "farm") ++out.farm;
			else if (job === "wood" || job === "citizenSoldierWood" || job === "food_overflow_wood") ++out.wood;
			else if (job === "stone") ++out.stone;
			else if (job === "metal") ++out.metal;
			else if (job === "chicken") ++out.chicken;
		}
		return out;
	}

	diagnose(gameState, frame, food, woodsite)
	{
		if (gameState.ai.elapsedTime - this.lastDiag < 15)
			return;
		this.lastDiag = gameState.ai.elapsedTime;
		const workers = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		const actual = this.actualWorkerOrders(gameState);
		const res = gameState.getResources();
		aiWarn("[EXPERT-IT14.23] t=" + Math.round(gameState.ai.elapsedTime) +
			" stage=" + frame.stage.stage + " pop=" + gameState.getPopulation() + "/" + gameState.getPopulationLimit() +
			" res=" + Math.round(res.food) + "/" + Math.round(res.wood) + "/" + Math.round(res.stone) + "/" + Math.round(res.metal) +
			" desired f=" + workers.food + " farm=" + workers.farm + " w=" + workers.wood + " woodCiv=" + workers.woodCivilians + " overflow=" + workers.overflowWood + " b=" + workers.builders +
			" actual f=" + actual.food + " farm=" + actual.farm + " w=" + actual.wood + " hunt=" + actual.chicken + " scout=" + actual.scout + " b=" + actual.builders + " walk=" + actual.approaching + " ret=" + actual.returning + " idle=" + actual.idle + " unprod=" + actual.unproductive +
			" built H=" + this.builtByClass(gameState, "House").length + " F=" + this.builtByClass(gameState, "Farmstead").length +
			" fld=" + this.builtByClass(gameState, "Field").length + " S=" + this.builtByClass(gameState, "Storehouse").length +
			" B=" + this.builtByClass(gameState, "Barracks").length +
			" foundations H=" + this.foundationsByClass(gameState, "House").length + " F=" + this.foundationsByClass(gameState, "Farmstead").length +
			" fld=" + this.foundationsByClass(gameState, "Field").length + " S=" + this.foundationsByClass(gameState, "Storehouse").length +
			" fruit=" + Math.round(100 * food.ratio) + "% altFruit=" + Math.round(frame.state.food.alternativeRemaining || 0) +
			" wood=" + Math.round(woodsite.localWoodAmount) + " woodStatus=" + frame.economy.derived.woodsiteStatus +
			" houseTrig=" + frame.economy.derived.houseTriggerFreePopulation + " farmPrebuild=" + frame.economy.derived.farmPrebuild +
			" wantFld=" + frame.economy.derived.desiredFields +
			" need2B=" + frame.economy.derived.requiredSecondFields + " bridge2B=" + Math.round(frame.economy.derived.secondBarracksBridgeSeconds || 0) + "s ready2B=" + frame.economy.derived.secondBarracksFoodReady +
			" foodSlots=" + Math.round(this.lastImmediateFoodSlots || 0) + " bal=" + (this.lastResourceBalance && this.lastResourceBalance.active ? this.lastResourceBalance.surplus + ">" + this.lastResourceBalance.target + "@" + this.lastResourceBalance.ratio.toFixed(1) : "off") +
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
			" fieldCap=" + frame.state.food.supportedFieldSlots + "/" + frame.state.food.openFieldSlots);
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
			for (const key of [DEFAULT_OWNERSHIP_METADATA, JOB_METADATA, PENDING_JOB_METADATA, TASK_KEY, CIVILIAN_ORDINAL, WORKSITE_ID, FOOD_SITE, FOOD_SITE_CHANGED_AT, FOOD_PREVIOUS_SITE, SUPPLY_ID, EXPERT_DEFENSE, EXPERT_DEFENSE_ORDER_AT, EXPERT_DEFENSE_ORDER_STAGE, EXPERT_CIVILIAN_EVAC, EXPERT_CIVILIAN_DANGER_AT, EXPERT_WICKER_PEELED, EXPERT_WICKER_BRANCH, NATURAL_FOOD_LOCK, "target-foundation"])
				ent.setMetadata(PlayerID, key, undefined);
		}
		for (const name of Object.keys(this.HQ.Config.priorities || {}))
			if (gameState.ai.queues[name])
				gameState.ai.queueManager.changePriority(name, this.HQ.Config.priorities[name]);
		if (!this.HQ.firstBaseConfig && this.HQ.hasPotentialBase())
			this.HQ.configFirstBase(gameState);
		aiWarn("[EXPERT-IT14.23] manual Expert release at t=" + Math.round(gameState.ai.elapsedTime) + " reason=" + reason);
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
			"activeFieldTasks": [...this.activeFieldTasks],
			"pendingFieldPositions": { ...this.pendingFieldPositions },
			"taskCounters": { ...this.taskCounters },
			"taskStartedAt": { ...this.taskStartedAt },
			"pendingWoodSelectionByTask": { ...this.pendingWoodSelectionByTask },
			"pendingFoodSelectionByTask": { ...this.pendingFoodSelectionByTask },
			"readyNextFoodCluster": this.readyNextFoodCluster,
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
			"lastResourceRebalanceTime": this.lastResourceRebalanceTime,
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
			"trainerIdleSince": { ...this.trainerIdleSince }
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
		this.activeFieldTasks = Array.isArray(data.activeFieldTasks) ? [...data.activeFieldTasks] : [];
		this.pendingFieldPositions = { ...(data.pendingFieldPositions || {}) };
		this.taskCounters = { ...(data.taskCounters || {}) };
		this.taskStartedAt = { ...(data.taskStartedAt || {}) };
		this.pendingWoodSelectionByTask = { ...(data.pendingWoodSelectionByTask || {}) };
		this.pendingFoodSelectionByTask = { ...(data.pendingFoodSelectionByTask || {}) };
		this.readyNextFoodCluster = data.readyNextFoodCluster;
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
		this.lastResourceRebalanceTime = Number.isFinite(data.lastResourceRebalanceTime) ? data.lastResourceRebalanceTime : -99999;
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
		this.lastUpdateTurn = -1;
	}
}
