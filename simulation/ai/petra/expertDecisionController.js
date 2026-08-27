import * as filters from "simulation/ai/common-api/filters.js";
import { aiWarn, SquareVectorDistance } from "simulation/ai/common-api/utils.js";
import * as difficulty from "simulation/ai/petra/difficultyLevel.js";
import { getLandAccess, isSupplyFull, returnResources } from "simulation/ai/petra/entityExtend.js";
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
import { selectInitialWoodWorksite, makeInitialStorehousePlacementRequest } from
	"simulation/ai/petra/expertDecision/initialWoodWorksite.js";
import { FoundationTracker } from "simulation/ai/petra/expertDecision/foundationTracker.js";
import { observePetra, BUILDING_SPECS, countPendingCivilianTraining } from
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
const CONTROL_UNTIL = -1; // save-compatibility only: Expert no longer auto-hands off to Petra.
const CITY_STATE_CIVS = new Set(["athen", "spart", "theb"]);

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
		const next = alternatives[0];
		const physicallyCovered = next ? this.foodClusterCovered(gameState, next) : false;
		const farmsteadWorthwhile = next ? this.foodClusterFarmsteadWorthwhile(gameState, next) : false;
		return {
			"clusters": alternatives,
			"next": next,
			"remaining": next ? next.remaining : 0,
			"covered": next ? physicallyCovered || !farmsteadWorthwhile : false,
			"physicallyCovered": physicallyCovered,
			"farmsteadWorthwhile": farmsteadWorthwhile
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
		if (!this.deferFirstHouseForCityStateWicker(gameState, queues, foodClusters))
			return frame;
		return {
			...frame,
			"actions": frame.actions.filter(action => action.kind !== "house" && action.type !== "PAUSE_POPULATION_TRAINING")
		};
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

		// Preserve the existing doctrine for Iron Axe: the first house must at least be
		// committed, so wood-tech spending cannot create a population block.
		if (!houseSecured)
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
				gameState.ai.queueManager.changePriority("minorTech", Math.max(this.HQ.Config.priorities.minorTech || 1, 700));
				aiWarn("[EXPERT-TECH] queued " + axe);
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
		const balance = gameState.ai.elapsedTime >= policy.resourceBalanceStartTime ? resourceBalanceDirective({
			"food": resources.food, "wood": resources.wood, "stone": resources.stone, "metal": resources.metal,
			"activationBank": policy.resourceBalanceActivationBank,
			"ratioFloor": policy.resourceBalanceRatioFloor,
			"newWorkerRatio": policy.resourceBalanceNewWorkerRatio,
			"strongRatio": policy.resourceBalanceStrongRatio,
			"foodPriorityBank": policy.resourceBalanceFoodPriorityBank
		}) : { "active": false };
		const civilians = [];
		const explicit = {};
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!entityPosition(ent) || !this.isExpertEconomyEntity(ent))
				continue;
			this.claimWorker(gameState, ent);
			if (hasClass(ent, "Civilian") && !hasClass(ent, "CitizenSoldier") && !hasClass(ent, "Cavalry"))
			{
				civilians.push(ent);
				const ord = ent.getMetadata(PlayerID, CIVILIAN_ORDINAL);
				if (Number.isFinite(ord) && ord > 0)
					explicit[String(ent.id())] = ord;
			}
			else if (hasClass(ent, "CitizenSoldier") && !hasClass(ent, "Cavalry"))
			{
				// Starting citizen-soldiers still begin on wood. After the opening, a newly
				// trained citizen-soldier joins the CURRENT deficit instead of automatically
				// inflating wood forever. Existing assignments remain sticky unless the bank
				// governor later detects a severe imbalance.
				const current = ent.getMetadata(PlayerID, JOB_METADATA);
				const pending = ent.getMetadata(PlayerID, PENDING_JOB_METADATA);
				if (!["citizenSoldierWood", "wood", "food", "food_owned", "farm", "stone", "metal"].includes(current) && !pending)
				{
					const desired = balance.active ? this.resourceJobForEntity(ent, balance.target) : "citizenSoldierWood";
					this.setDesiredJob(gameState, ent, desired);
					if (balance.active)
						aiWarn("[EXPERT-BALANCE] new citizen-soldier=" + ent.id() + " -> " + balance.target + " bank=" +
						Math.round(resources.food) + "/" + Math.round(resources.wood) + "/" + Math.round(resources.stone) + "/" + Math.round(resources.metal));
				}
			}
			else if (hasClass(ent, "Cavalry") && ent.canGather && ent.canGather("food"))
				this.setDesiredJob(gameState, ent, "chicken");
		}

		const throughput = foodThroughput || {};
		const activeBurn = this.builtByClass(gameState, "Barracks").length > 0 ?
			(Number(throughput.oneBarracksFoodBurnRate) || 0) : (Number(throughput.ccFoodBurnRate) || 0);
		const steadyFarmerRate = Math.max(0.5, Number(throughput.averageFarmerRate) || 0.7);
		const requiredFoodWorkers = Math.max(
			policy.openingNaturalFoodCivilians,
			Math.ceil(activeBurn * Math.max(1, policy.foodRateSafetyMargin) / steadyFarmerRate)
		);
		const reconciled = reconcileCivilianRoster(this.civilianRoster, civilians.map(ent => ent.id()), explicit);
		this.civilianRoster = reconciled.roster;
		const byId = new Map(civilians.map(ent => [String(ent.id()), ent]));
		const fields = this.builtByClass(gameState, "Field").length;
		let metrics = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		let farmWorkers = metrics.farm;
		let woodCivilians = metrics.woodCivilians;
		let foodWorkers = metrics.food + metrics.farm;
		let stoneWorkers = metrics.stone;
		let metalWorkers = metrics.metal;
		const openingEnd = policy.startingNaturalFoodCivilians + policy.secondTrainedFoodCivilians + policy.targetWoodCivilians;

		for (const entry of reconciled.civilians)
		{
			const ent = byId.get(entry.id);
			if (!ent)
				continue;
			ent.setMetadata(PlayerID, CIVILIAN_ORDINAL, entry.ordinal);

			// Permanent farmers are a hard invariant. Once a civilian has a valid field
			// lock, strategic balancing is forbidden from touching that civilian again.
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
				const d = decideCivilianJob({
					"ordinal": entry.ordinal,
					"fields": fields,
					"farmWorkers": farmWorkers,
					"farmersPerField": policy.farmersPerField,
					"startingNaturalFoodCivilians": policy.startingNaturalFoodCivilians,
					"firstTrainedWoodCivilians": policy.firstTrainedWoodCivilians,
					"secondTrainedFoodCivilians": policy.secondTrainedFoodCivilians,
					"targetWoodCivilians": policy.targetWoodCivilians
				});
				desired = d.job;
				// The opening food civilians stay on ANY worthwhile in-territory natural food.
				// The old primary-cluster-only check caused them to abandon secondary fruit
				// and oscillate between sources. Transition only after the whole network is gone.
				if (desired === "food" && (!foodNetwork || foodNetwork.totalRemaining <= 0))
					desired = farmWorkers < fields * policy.farmersPerField ? "farm" : "food_owned";
			}
			else
			{
				// Existing post-opening civilian jobs remain sticky during mild imbalance.
				// Only NEW civilians use the bank governor; severe imbalance is corrected below
				// in tiny cooldown-controlled batches.
				if (["wood", "food", "food_owned", "farm", "stone", "metal"].includes(current))
					continue;
				if (balance.active)
				{
					desired = this.resourceJobForEntity(ent, balance.target);
					aiWarn("[EXPERT-BALANCE] new civilian=" + ent.id() + " -> " + balance.target + " ratio=" + balance.ratio.toFixed(2));
				}
				else
				{
					const d = decidePostOpeningCivilianJob({
						"food": resources.food, "wood": resources.wood, "stone": resources.stone, "metal": resources.metal,
						"civilians": civilians.length,
						"woodCivilians": woodCivilians,
						"foodWorkers": foodWorkers,
						"requiredFoodWorkers": requiredFoodWorkers,
						"naturalFoodAvailable": !!(foodNetwork && foodNetwork.totalRemaining > 0),
						"stoneWorkers": stoneWorkers, "metalWorkers": metalWorkers,
						"fields": fields, "farmWorkers": farmWorkers,
						"farmersPerField": policy.farmersPerField,
						"postOpeningFoodFloor": policy.postOpeningFoodFloor,
						"postOpeningWoodFloor": policy.postOpeningWoodFloor,
						"postOpeningFoodWoodRatioForWood": policy.postOpeningFoodWoodRatioForWood,
						"maxDynamicWoodCivilians": policy.maxDynamicWoodCivilians,
						"dynamicWoodShortageBank": policy.dynamicWoodShortageBank,
						"foodSurplusRedirectThreshold": policy.foodSurplusRedirectThreshold,
						"miningStartCivilians": policy.miningStartCivilians,
						"miningFoodFloor": policy.miningFoodFloor,
						"miningWoodFloor": policy.miningWoodFloor,
						"miningTargetStoneWorkers": policy.miningTargetStoneWorkers,
						"miningTargetMetalWorkers": policy.miningTargetMetalWorkers
					});
					desired = d.job;
					if (desired === "farm" && foodNetwork && foodNetwork.totalRemaining > 0)
						desired = "food_owned";
				}
			}

			if (!desired)
				continue;
			this.setDesiredJob(gameState, ent, desired);
			if (desired === "wood")
				++woodCivilians;
			else if (desired === "farm")
			{
				++farmWorkers;
				++foodWorkers;
			}
			else if (desired === "food" || desired === "food_owned")
				++foodWorkers;
			else if (desired === "stone")
				++stoneWorkers;
			else if (desired === "metal")
				++metalWorkers;
		}

		this.rebalanceExistingWorkers(gameState, openingEnd, balance);
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
		if (!balance || !balance.active || !balance.strong || now < policy.resourceBalanceStartTime ||
		    now - this.lastResourceRebalanceTime < policy.resourceBalanceReassignCooldownSeconds)
			return;

		const candidates = [];
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!entityPosition(ent) || !this.isExpertEconomyEntity(ent) || hasClass(ent, "Cavalry"))
				continue;
			if (ent.getMetadata(PlayerID, TASK_KEY) !== undefined || ent.getMetadata(PlayerID, PENDING_JOB_METADATA) ||
			    ent.getMetadata(PlayerID, "transport") !== undefined || ent.getMetadata(PlayerID, "PartOfArmy"))
				continue;
			const state = ent.unitAIState ? ent.unitAIState() : "";
			if (state && state.includes(".COMBAT."))
				continue;
			const soldier = hasClass(ent, "CitizenSoldier") && !hasClass(ent, "Cavalry");
			const civilian = hasClass(ent, "Civilian") && !soldier;
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
		const count = Math.min(policy.resourceBalanceReassignBatch, candidates.length);
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

	commitCompletedNaturalFarmsteadBuilders(gameState, taskId, cluster)
	{
		const team = this.constructionWorkers(gameState, taskId);
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

			if (observed.state === "completed" || observed.state === "missing-after-foundation")
			{
				const completedNaturalCluster = observed.state === "completed" && kind === "farmstead" ?
					this.pendingFoodSelectionByTask[taskId] : undefined;
				if (isField && observed.state === "completed")
					this.lockCompletedFieldBuilders(gameState, taskId, observed.completedEntityId);
				else if (completedNaturalCluster)
					this.commitCompletedNaturalFarmsteadBuilders(gameState, taskId, completedNaturalCluster);
				else
					this.releaseConstructionTeam(gameState, taskId);
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
		for (const name of ["house", "dropsites", "field", "militaryBuilding"])
		{
			const queue = gameState.ai.queues[name];
			if (queue && queue.plans && queue.plans.some(plan => plan.metadata && plan.metadata.expertTaskId === taskId))
				return true;
		}
		return false;
	}

	rebindQueuedStarters(gameState)
	{
		for (const name of ["house", "dropsites", "field", "militaryBuilding"])
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
				const action = { "builderPool": BUILDING_SPECS[kind].allowedBuilderJobs };
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

	woodTreesAt(gameState, position, accessIndex)
	{
		return collectWoodTrees(gameState, {
			"getLandAccess": getLandAccess,
			"isSupplyFull": isSupplyFull,
			"territoryMap": this.HQ.territoryMap,
			"worksitePosition": position,
			"accessIndex": accessIndex,
			"playerId": PlayerID,
			"radius": 30
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

	collectWoodsite(gameState, cc, accessIndex)
	{
		let pos = this.getPrimaryWoodPosition(gameState) || cc.position();
		let trees = this.woodTreesAt(gameState, pos, accessIndex);
		let metrics = summarizeWoodTrees(trees);
		if (metrics.localWoodAmount <= mergePolicy().localWoodCriticalAmount)
		{
			const alternative = this.findHealthyAlternativeWoodWorksite(gameState, accessIndex,
				this.primaryWoodWorksite && this.primaryWoodWorksite.entityId);
			if (alternative)
			{
				this.primaryWoodWorksite = {
					"entityId": alternative.store.id(),
					"position": alternative.store.position(),
					"taskId": alternative.store.getMetadata ? alternative.store.getMetadata(PlayerID, "expertTaskId") : undefined
				};
				pos = alternative.store.position();
				trees = alternative.trees;
				metrics = alternative.metrics;
				aiWarn("[EXPERT-WOOD] switched to existing healthy storehouse=" + alternative.store.id());
			}
		}
		return { trees, ...metrics, "position": pos };
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
			const source = this.firstBarracksSoldierBatchQueued ? "barracks" : "barracks-opening";
			if (this.queueExpertSoldierBatch(gameState, queues, barracks, source, militaryBatch) && source === "barracks-opening")
				this.firstBarracksSoldierBatchQueued = true;
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
		return {
			"kind": "field",
			"anchor": farmPosition,
			"farmsteadId": farmsteadId,
			"anchorHalfExtents": farmGeom.halfExtents || { "width": farmGeom.radius, "depth": farmGeom.radius },
			"templateHalfExtents": geometry.halfExtents || { "width": geometry.radius, "depth": geometry.radius },
			"templateRadius": geometry.radius,
			"gap": 0.5,
			"gaps": [0.5, 1.0, 1.5, 2.0],
			"edgeSamples": 13
		};
	}

	fieldSlotsAt(gameState, farmPosition, farmsteadId, accessIndex, shared = undefined, slotLimit = undefined)
	{
		if (!Array.isArray(farmPosition))
			return [];
		const policy = mergePolicy();
		const request = this.fieldRequestAt(gameState, farmPosition, farmsteadId);
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
			// Live capacity must count only fields that remain <=2m from the farmstead
			// AFTER obstruction-map snapping. Otherwise the planner believes it has farm
			// slots that the actual placement resolver will later (correctly) reject.
			const dx = Math.abs(position[0] - farmPosition[0]);
			const dz = Math.abs(position[1] - farmPosition[1]);
			const gapX = Math.max(0, dx - (Number(farmHalf.width) + Number(fieldHalf.width)));
			const gapZ = Math.max(0, dz - (Number(farmHalf.depth) + Number(fieldHalf.depth)));
			if (Math.hypot(gapX, gapZ) > 2.05)
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
		for (const farm of farms)
		{
			const slots = this.fieldSlotsAt(gameState, farm.position(), farm.id(), accessIndex, shared);
			hubs.push({ "farm": farm, "slots": slots });
			openFieldSlots += slots.length;
		}
		return {
			"known": true,
			"supportedFieldSlots": committedFields + openFieldSlots,
			"openFieldSlots": openFieldSlots,
			"hubs": hubs
		};
	}

	farmsteadForNextField(gameState, accessIndex)
	{
		const snapshot = this.farmCapacitySnapshot(gameState, accessIndex);
		const usable = snapshot.hubs.filter(hub => hub.slots.length);
		if (!usable.length)
			return undefined;
		const fields = this.builtByClass(gameState, "Field");
		usable.sort((a, b) => {
			const ca = fields.filter(f => SquareVectorDistance(f.position(), a.farm.position()) <= 42*42).length;
			const cb = fields.filter(f => SquareVectorDistance(f.position(), b.farm.position()) <= 42*42).length;
			return cb - ca ? ca - cb : b.slots.length - a.slots.length || a.farm.id() - b.farm.id();
		});
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
			const current = this.getPrimaryWoodPosition(gameState) || cc.position();
			const all = collectInitialWoodCandidates(gameState, {
				"getLandAccess": getLandAccess, "isSupplyFull": isSupplyFull,
				"territoryMap": this.HQ.territoryMap, "anchorPosition": cc.position(),
				"accessIndex": accessIndex, "playerId": PlayerID, "searchRadius": 180
			}).filter(tree => SquareVectorDistance(tree.position, current) > 35*35);
			const selection = selectInitialWoodWorksite(all, cc.position());
			if (!selection || !selection.position)
				return undefined;

			// IT4 could repeatedly choose one neutral/out-of-territory wood cluster, then
			// have placement validation reject every candidate.  The collector is now
			// own-territory-only, and expansion placement also carries candidates from
			// several ranked in-territory clusters so one obstruction cannot kill rollover.
			const ranked = (selection.ranked && selection.ranked.length ? selection.ranked : [selection])
				.filter(site => site && site.position && this.HQ.territoryMap.getOwner(site.position) === PlayerID)
				.slice(0, 8);
			const candidates = [];
			for (const site of ranked)
			{
				const candidateSelection = { "action": "SELECT_INITIAL_WOODSITE", ...site };
				const one = makeInitialStorehousePlacementRequest(candidateSelection, geometry.radius,
					{ "distances": [0, 4, 8, 12, 16], "angleCount": 16 });
				candidates.push(...one.candidates);
			}
			if (!candidates.length)
				return undefined;
			request = {
				kind,
				"templateRadius": geometry.radius,
				candidates,
				"worksiteAnchor": ranked[0].position,
				"selectedTreeIds": [...(ranked[0].treeIds || [])]
			};
			this.pendingWoodSelectionByTask[taskId] = ranked[0];
		}
		else if (kind === "farmstead")
		{
			let anchor = foodObservation.center || cc.position();
			let sourceIds = foodObservation.ids || [];
			if (action.role === "natural_expansion")
			{
				const foodContext = this.foodCaptureContext(gameState, cc, accessIndex);
				const alternative = this.alternativeFoodInfo(gameState, foodContext, foodObservation).next;
				if (!alternative || !alternative.center)
					return undefined;
				anchor = alternative.center;
				sourceIds = alternative.ids;
				this.pendingFoodSelectionByTask[taskId] = alternative;
				request = {
					kind,
					"anchor": anchor,
					"toward": cc.position(),
					"distances": [8, 10, 12, 15, 18, 21, 24],
					"angleCount": 24,
					"templateRadius": geometry.radius,
					"pathSources": this.foodPathSources(gameState, sourceIds),
					// A fruit dropsite must also be useful later. Do not spend 100 wood on a
					// farmstead that cannot anchor at least some touching fields after the fruit.
					"minimumFieldSlots": 1,
					"preferredFieldSlots": mergePolicy().minimumNaturalExpansionFieldSlots
				};
			}
			else if (this.builtByClass(gameState, "Farmstead").length === 0)
				request = {
					kind,
					anchor,
					"toward": cc.position(),
					"distances": [8, 10, 12, 15, 18, 21, 24],
					"angleCount": 24,
					"templateRadius": geometry.radius,
					"pathSources": this.foodPathSources(gameState, sourceIds),
					// Opening berries matter, but so does the farm transition. Prefer room for
					// three touching fields and require two unless repeated placement failure
					// proves the map cannot support it.
					"minimumFieldSlots": this.farmsteadPlacementFailures >= 2 ? 1 : 2,
					"preferredFieldSlots": 3
				};
			else
			{
				// Permanent farm hubs are not chained to the exhausted berry patch.
				// Search a broad own-territory ring around the CC and require live legal
				// field capacity before accepting the hub.
				request = {
					kind,
					"role": action.role || "farm_hub",
					"anchor": cc.position(),
					"toward": anchor,
					"distances": [28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84],
					"angleCount": 32,
					"templateRadius": geometry.radius,
					"pathSources": [],
					// Prefer a roomy hub, but never turn a merely imperfect map into starvation.
					// Measured capacity will request another hub immediately if this one only fits
					// one or two fields.
					"minimumFieldSlots": this.farmsteadPlacementFailures >= 4 ? 3 : mergePolicy().minimumFarmHubFieldSlots,
					"preferredFieldSlots": action.role === "natural_expansion" ?
						mergePolicy().minimumNaturalExpansionFieldSlots : Math.max(5, mergePolicy().minimumFarmHubFieldSlots)
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
					"maxBorderGap": 5
				};
			else
			{
				// Build later houses as an organized line first, with the old broad search as
				// fallback. This keeps the base legible and turns housing into a partial wall.
				const houses = this.builtByClass(gameState, "House").sort((a, b) => a.id() - b.id());
				const first = houses[0];
				const firstPos = first && entityPosition(first) ? first.position() : cc.position();
				const woodPos = this.getPrimaryWoodPosition(gameState) || [cc.position()[0] + 1, cc.position()[1]];
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
				const fallback = generatePlacementCandidates({
					"kind": "barracks", "anchor": cc.position(),
					"toward": woodPos,
					"distances": [14, 18, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62, 66, 70, 74, 78, 82], "angleCount": 32,
					"templateRadius": geometry.radius
				});
				request = { kind, "candidates": [...lineCandidates, ...fallback], "templateRadius": geometry.radius };
			}
		}
		else if (kind === "field")
		{
			const hub = this.farmsteadForNextField(gameState, accessIndex);
			if (!hub || !hub.farm || !hub.slots.length)
				return undefined;
			request = {
				kind,
				"candidates": hub.slots,
				"farmsteadId": hub.farm.id(),
				"templateRadius": geometry.radius
			};
		}
		else if (kind === "barracks")
			request = {
				kind,
				// Search outward from the CC, not from the woodline. The old 64-point
				// woodline ring repeatedly failed and delayed the army by minutes.
				"anchor": cc.position(),
				"toward": this.getPrimaryWoodPosition(gameState) || [cc.position()[0] + 1, cc.position()[1]],
				"distances": [18, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62, 66, 70],
				"angleCount": 32,
				"templateRadius": geometry.radius
			};
		if (!request)
			return undefined;
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
		let farmCapacityAt;
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
					cache.set(key, this.fieldSlotsAt(gameState, position, -1, accessIndex, shared, mergePolicy().minimumFarmHubFieldSlots).length);
				return cache.get(key);
			};
		}
		ports.extraValidation = (position, request) =>
		{
			if (this.HQ.territoryMap.getOwner(position) !== PlayerID ||
			    gameState.ai.accessibility.getAccessValue(position) !== accessIndex)
				return false;
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
				if (borderGap > 2.05)
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
				for (const ent of this.builtByClass(gameState, "Storehouse"))
					if (SquareVectorDistance(position, ent.position()) < 30*30)
						return false;
			return true;
		};
		if (kind === "farmstead")
			ports.scoreCandidate = (position, request) =>
			{
				const sources = request && Array.isArray(request.pathSources) ? request.pathSources : [];
				let score = 0;
				for (const source of sources)
				{
					score += Math.sqrt(SquareVectorDistance(source, position));
					score += 25 * this.lineObstructionPenalty(ports.obstructionMap, source, position);
				}
				// Live field capacity is the strongest score for permanent farm hubs.
				// This prevents IT7's "three farmsteads, three fields" starvation pattern.
				const capacity = farmCapacityAt ? farmCapacityAt(position) : 0;
				const preferredCapacity = Number(request && request.preferredFieldSlots) || 0;
				if (preferredCapacity > 0 && capacity < preferredCapacity)
					score += 300 * (preferredCapacity - capacity);
				for (let i = 0; i < 16; ++i)
				{
					const a = 2 * Math.PI * i / 16;
					const sample = [position[0] + 24 * Math.cos(a), position[1] + 24 * Math.sin(a)];
					score += 8 * this.lineObstructionPenalty(ports.obstructionMap, position, sample);
				}
				score -= 120 * capacity;
				return score / Math.max(1, sources.length || 1);
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
		let cluster = matchingFoodCluster(clusters, siteIds);
		const now = Number(gameState.ai.elapsedTime) || 0;
		const lastSwitch = Number(ent.getMetadata(PlayerID, FOOD_SITE_CHANGED_AT));
		const currentHasCapacity = !!(cluster && cluster.availableIds && cluster.availableIds.length);
		const currentRemaining = cluster ? Math.max(0, Number(cluster.remaining) || 0) : 0;

		let ranked = clusters.filter(candidate => candidate.availableIds && candidate.availableIds.length);
		// Hard anti-A-B-A invariant: while the CURRENT committed site still contains food,
		// never switch straight back to the site this worker just abandoned. That is the
		// exact 1924<->1825 loop seen in IT12. Once the current site is exhausted, returning
		// later is legitimate and the previous site becomes eligible again.
		if (cluster && currentRemaining > 0 && previousSiteIds.length)
			ranked = ranked.filter(candidate => !matchingFoodCluster([candidate], previousSiteIds));
		ranked.sort((a, b) => this.foodClusterScore(gameState, ent, b) - this.foodClusterScore(gameState, ent, a) || a.ids[0] - b.ids[0]);
		const best = ranked[0];
		if (!cluster || !currentHasCapacity)
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

		if (!cluster || !cluster.availableIds || !cluster.availableIds.length)
		{
			// Hysteresis is never allowed to create an idle worker. If another natural
			// cluster has capacity, commit to it immediately; the previous-site filter
			// above still prevents the IT12 A->B->A bounce.
			if (best && best.availableIds && best.availableIds.length)
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

		if (!cluster || !cluster.availableIds || !cluster.availableIds.length)
		{
			// Natural food is exhausted/saturated. Prefer an efficient permanent field.
			// If the preferred three-worker slots are temporarily full, assignFarmWorker
			// may use an unused hard engine slot rather than leave this civilian idle.
			if (this.assignFarmWorker(gameState, ent, accessIndex))
				return true;
			// A food civilian with no completed slot helps finish the next field/farmstead.
			// This is productive work on its own food infrastructure, not a resource shuffle.
			if (this.assignFoodInfrastructureWorker(gameState, ent))
				return true;
			this.diagnoseWorkerOrder(ent, "food-capacity-miss", 0, currentRemaining > 0 ? "ALL_NATURAL_SATURATED" : "NO_FOOD_CAPACITY");
			return false;
		}

		const metadataTargetId = Number(ent.getMetadata(PlayerID, SUPPLY_ID));
		let target = Number.isFinite(metadataTargetId) && cluster.ids.includes(metadataTargetId) ? gameState.getEntityById(metadataTargetId) : undefined;
		if (!(target && target.resourceSupplyAmount && target.resourceSupplyAmount() > 0 && !isSupplyFull(gameState, target)))
		{
			const candidates = cluster.availableIds.map(id => gameState.getEntityById(id)).filter(s => s && entityPosition(s));
			candidates.sort((a, b) => SquareVectorDistance(ent.position(), a.position()) - SquareVectorDistance(ent.position(), b.position()) || a.id() - b.id());
			target = candidates[0];
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

		const trees = this.woodTreesAt(gameState, position, accessIndex);
		const metrics = summarizeWoodTrees(trees);
		// Keep the worker at the assigned site while any usable local wood remains.
		// A new storehouse is for NEW workers, not a reason to march the old woodline.
		if (metrics.availableTargets > 0 || metrics.localWoodAmount > mergePolicy().localWoodCriticalAmount)
			return { trees, ...metrics, position, entityId };

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
		const currentTreeValid = !!(current && (currentIsLiveWood || trees.some(tree => tree.id === current.id())) &&
			current.resourceSupplyAmount && current.resourceSupplyAmount() > 0);

		// Productive lumberjacks are sacred: if the engine is still gathering a live
		// tree, keep that order even if a newer storehouse has become globally preferred.
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
		for (const name of ["house", "dropsites", "field", "militaryBuilding", "villager", "citizenSoldier", "minorTech"])
		{
			const queue = gameState.ai.queues[name];
			if (!queue || !queue.plans)
				continue;
			queue.plans = queue.plans.filter(plan => plan.metadata && plan.metadata.expertDecisionLayer);
		}
	}


	setDecisionPriorities(gameState, frame)
	{
		const map = { house: "house", storehouse: "dropsites", farmstead: "dropsites", field: "field", barracks: "militaryBuilding" };
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

		// Compute the current production burn BEFORE assigning newly-created civilians.
		// New permanent jobs are based on how many food workers the active CC/barracks
		// actually need, not on "CC is still below 75, so make another farmer".
		const preAssignmentFoodThroughput = this.foodThroughputMetrics(gameState, cc, foodNetwork);
		this.syncJobs(gameState, foodNetwork, preAssignmentFoodThroughput);
		const foodAlternative = this.alternativeFoodInfo(gameState, foodContext, foodObservation);
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
				"targetFoodWorkers": Math.max(7, workers.food + workers.farm),
				"naturalFoodWorkers": workers.food,
				"farmWorkers": workers.farm,
				"alternativeRemaining": foodAlternative.remaining,
				"alternativeClusters": foodAlternative.clusters.length,
				"alternativeCovered": foodAlternative.covered,
				"fieldCapacityKnown": farmCapacity.known,
				"supportedFieldSlots": farmCapacity.supportedFieldSlots,
				"openFieldSlots": farmCapacity.openFieldSlots,
				...foodThroughput
			},
			"woodsite": {
				...summarizeWoodTrees(woodsite.trees),
				"alternativeExistingWorksite": this.alternativeWoodWorksiteExists(gameState, accessIndex)
			},
			"workers": workers
		});
		// Queue opening techs before authorizing the same tick's house. For Greek city
		// states with multiple fruit sources, Wicker is an explicit first-house gate.
		this.researchExpertEcoTech(gameState, queues, allFoodClusters, cc);
		let frame = stepDecision(this.memory, observation);
		this.memory = frame.memory;
		this.lastDesiredFields = Number(frame && frame.derived && frame.derived.desiredFields) || 0;
		frame = this.filterFrameForOpeningTech(gameState, queues, allFoodClusters, frame);
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
		aiWarn("[EXPERT-IT14.4] t=" + Math.round(gameState.ai.elapsedTime) +
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
			" foodRate=" + frame.state.food.naturalIncomeRate.toFixed(1) + "+" + frame.state.food.farmIncomeRate.toFixed(1) +
			" delivered=" + frame.state.food.measuredFoodIncomeRate.toFixed(1) + (frame.state.food.measuredFoodIncomeAvailable ? "M" : "A") +
			" natRemain=" + Math.round(frame.state.food.totalNaturalRemaining) + " runway=" + Math.round(frame.state.food.naturalRunwaySeconds) + "s" +
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
			for (const key of [DEFAULT_OWNERSHIP_METADATA, JOB_METADATA, PENDING_JOB_METADATA, TASK_KEY, CIVILIAN_ORDINAL, WORKSITE_ID, FOOD_SITE, FOOD_SITE_CHANGED_AT, FOOD_PREVIOUS_SITE, SUPPLY_ID, "target-foundation"])
				ent.setMetadata(PlayerID, key, undefined);
		}
		for (const name of Object.keys(this.HQ.Config.priorities || {}))
			if (gameState.ai.queues[name])
				gameState.ai.queueManager.changePriority(name, this.HQ.Config.priorities[name]);
		if (!this.HQ.firstBaseConfig && this.HQ.hasPotentialBase())
			this.HQ.configFirstBase(gameState);
		aiWarn("[EXPERT-IT14.4] manual Expert release at t=" + Math.round(gameState.ai.elapsedTime) + " reason=" + reason);
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
			"lastResourceRebalanceTime": this.lastResourceRebalanceTime
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
		this.lastUpdateTurn = -1;
	}
}
