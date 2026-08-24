import * as filters from "simulation/ai/common-api/filters.js";
import { aiWarn, SquareVectorDistance } from "simulation/ai/common-api/utils.js";
import * as difficulty from "simulation/ai/petra/difficultyLevel.js";
import { getLandAccess, isSupplyFull, returnResources } from "simulation/ai/petra/entityExtend.js";
import { createObstructionMap } from "simulation/ai/petra/mapModule.js";
import { ExpertFixedConstructionPlan } from "simulation/ai/petra/expertFixedConstructionPlan.js";
import { TrainingPlan } from "simulation/ai/petra/queueplanTraining.js";
import { Worker } from "simulation/ai/petra/worker.js";

import { createMemory, stepDecision } from "simulation/ai/petra/expertDecision/decisionEngine.js";
import {
	createCivilianRoster, reconcileCivilianRoster, decideCivilianJob,
	serializeCivilianRoster, deserializeCivilianRoster
} from "simulation/ai/petra/expertDecision/civilianAssignmentPolicy.js";
import {
	PrimaryFoodClusterTracker, collectInitialWoodCandidates, collectWoodTrees,
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
import { selectFoundationStarter, releaseBuilders, TASK_KEY } from
	"simulation/ai/petra/expertDecision/petraBuilderResolver.js";
import { decideWoodWorkerTarget } from "simulation/ai/petra/expertDecision/workerPolicy.js";
import { DEFAULT_OWNERSHIP_METADATA, isExpertOpeningEconomyEntity } from
	"simulation/ai/petra/expertDecision/petraOwnershipGate.js";

const CIVILIAN_ORDINAL = "expertDecisionCivilianOrdinal";
const WORKSITE_ID = "expertDecisionWoodWorksite";
const SUPPLY_ID = "supply";
const CONTROL_UNTIL = 300;

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
		this.taskCounters = {};
		this.taskStartedAt = {};
		this.pendingWoodSelectionByTask = {};
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

	syncJobs(gameState, foodObservation)
	{
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
				this.setDesiredJob(gameState, ent, "citizenSoldierWood");
			else if (hasClass(ent, "Cavalry") && ent.canGather && ent.canGather("food"))
				this.setDesiredJob(gameState, ent, "chicken");
		}

		const reconciled = reconcileCivilianRoster(this.civilianRoster, civilians.map(ent => ent.id()), explicit);
		this.civilianRoster = reconciled.roster;
		const byId = new Map(civilians.map(ent => [String(ent.id()), ent]));
		const fields = this.builtByClass(gameState, "Field").length;
		let farmWorkers = 0;
		for (const ent of civilians)
			if (ent.getMetadata(PlayerID, JOB_METADATA) === "farm")
				++farmWorkers;

		for (const entry of reconciled.civilians)
		{
			const ent = byId.get(entry.id);
			if (!ent)
				continue;
			ent.setMetadata(PlayerID, CIVILIAN_ORDINAL, entry.ordinal);
			let desired;
			if (entry.ordinal <= 7 && foodObservation.remaining <= 0)
			{
				const capacity = fields * 5;
				desired = farmWorkers < capacity ? "farm" : "food_waiting_for_capacity";
				if (desired === "farm")
					++farmWorkers;
			}
			else
			{
				const d = decideCivilianJob({
					"ordinal": entry.ordinal,
					"primaryFoodRemaining": foodObservation.remaining,
					"fields": fields,
					"farmWorkers": farmWorkers,
					"farmersPerField": 5
				});
				desired = d.job;
				if (desired === "farm")
					++farmWorkers;
			}
			this.setDesiredJob(gameState, ent, desired);
		}
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

	refreshTasks(gameState)
	{
		for (const [kind, taskId] of Object.entries({ ...this.activeTaskByKind }))
		{
			if (!taskId)
				continue;
			let observed;
			try { observed = this.foundationTracker.observeTask(gameState, taskId); }
			catch (e) { continue; }
			if (observed.state === "completed")
			{
				releaseBuilders(this.constructionWorkers(gameState, taskId), taskId, PlayerID);
				delete this.activeTaskByKind[kind];
				delete this.taskStartedAt[taskId];
				if (kind === "storehouse")
				{
					const ent = gameState.getEntityById(observed.completedEntityId);
					if (ent && entityPosition(ent) && (!this.primaryWoodWorksite || this.pendingWoodSelectionByTask[taskId]))
						this.primaryWoodWorksite = { "entityId": ent.id(), "position": ent.position(), "taskId": taskId };
					delete this.pendingWoodSelectionByTask[taskId];
				}
			}
			else if (observed.state === "missing-after-foundation")
			{
				releaseBuilders(this.constructionWorkers(gameState, taskId), taskId, PlayerID);
				delete this.activeTaskByKind[kind];
				delete this.taskStartedAt[taskId];
			}
			else if (observed.state === "awaiting-foundation")
			{
				const age = gameState.ai.elapsedTime - Number(this.taskStartedAt[taskId] || gameState.ai.elapsedTime);
				const stillQueued = this.findQueuedTask(gameState, taskId);
				if (!stillQueued && age > 12)
				{
					releaseBuilders(this.constructionWorkers(gameState, taskId), taskId, PlayerID);
					delete this.activeTaskByKind[kind];
					delete this.taskStartedAt[taskId];
				}
			}
		}
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
				// Use the exact tested resolver on every pass.  Never trust a previously
				// bound starter merely because it still exists; transport/army/plan/carry
				// state can make that worker ineligible after the plan was queued.
				const starter = selectFoundationStarter(gameState, kind, plan.position, {
					"builderPool": BUILDING_SPECS[kind].allowedBuilderJobs
				}, { "playerId": PlayerID, "taskId": plan.metadata.expertTaskId });
				if (starter)
					plan.metadata.expertBuilderId = starter.id();
			}
		}
	}

	collectWoodsite(gameState, cc, accessIndex)
	{
		const pos = this.getPrimaryWoodPosition(gameState) || cc.position();
		const trees = collectWoodTrees(gameState, {
			"getLandAccess": getLandAccess,
			"isSupplyFull": isSupplyFull,
			"territoryMap": this.HQ.territoryMap,
			"worksitePosition": pos,
			"accessIndex": accessIndex,
			"playerId": PlayerID,
			"radius": 30
		});
		return { trees, ...summarizeWoodTrees(trees), "position": pos };
	}

	alternativeWoodWorksiteExists(gameState)
	{
		return this.builtByClass(gameState, "Storehouse").length > 1;
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

	farmsteadForNextField(gameState)
	{
		const farms = this.builtByClass(gameState, "Farmstead");
		if (!farms.length)
			return undefined;
		const fields = this.builtByClass(gameState, "Field");
		farms.sort((a, b) => {
			const ca = fields.filter(f => SquareVectorDistance(f.position(), a.position()) <= 45*45).length;
			const cb = fields.filter(f => SquareVectorDistance(f.position(), b.position()) <= 45*45).length;
			return ca - cb || a.id() - b.id();
		});
		return farms[0];
	}

	placementRequest(gameState, action, cc, accessIndex, foodObservation)
	{
		const kind = action.kind;
		const taskId = this.activeTaskByKind[kind] || this.newTaskId(kind);
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
				"accessIndex": accessIndex, "playerId": PlayerID, "searchRadius": 120
			}).filter(tree => SquareVectorDistance(tree.position, current) > 35*35);
			const selection = selectInitialWoodWorksite(all, cc.position());
			if (!selection || !selection.position)
				return undefined;
			request = makeInitialStorehousePlacementRequest(selection, geometry.radius,
				{ "distances": [0, 4, 8, 12], "angleCount": 16 });
			this.pendingWoodSelectionByTask[taskId] = selection;
		}
		else if (kind === "farmstead")
		{
			const anchor = foodObservation.center || cc.position();
			if (this.builtByClass(gameState, "Farmstead").length === 0)
				request = { kind, anchor, "toward": cc.position(), "templateRadius": geometry.radius };
			else
			{
				const current = this.builtByClass(gameState, "Farmstead");
				const away = current[0].position();
				const dx = anchor[0] - away[0], dz = anchor[1] - away[1];
				const mag = Math.sqrt(dx*dx + dz*dz) || 1;
				const secondAnchor = [away[0] + 38*dx/mag, away[1] + 38*dz/mag];
				request = { kind, "anchor": secondAnchor, "toward": anchor, "distances": [0, 4, 8, 12], "templateRadius": geometry.radius };
			}
		}
		else if (kind === "house")
		{
			request = {
				kind,
				"anchor": this.getPrimaryWoodPosition(gameState) || cc.position(),
				"avoid": cc.position(),
				"anchorRadius": 5,
				"templateRadius": geometry.radius,
				"maxBorderGap": 5
			};
		}
		else if (kind === "field")
		{
			const farm = this.farmsteadForNextField(gameState);
			if (!farm)
				return undefined;
			const farmGeom = readTemplateGeometry(gameState, "farmstead");
			request = {
				kind,
				"anchor": farm.position(),
				"anchorHalfExtents": farmGeom.halfExtents || { "width": farmGeom.radius, "depth": farmGeom.radius },
				"templateHalfExtents": geometry.halfExtents || { "width": geometry.radius, "depth": geometry.radius },
				"templateRadius": geometry.radius,
				"gap": 0.5,
				"diagonals": true
			};
		}
		else if (kind === "barracks")
			request = { kind, "anchor": this.getPrimaryWoodPosition(gameState) || cc.position(), "toward": cc.position(), "templateRadius": geometry.radius };
		if (!request)
			return undefined;
		request.taskId = taskId;
		return request;
	}

	placementPorts(gameState, kind, accessIndex)
	{
		const ports = createPetraPlacementPorts(gameState, kind, {
			"HQ": this.HQ,
			"createObstructionMap": createObstructionMap,
			"accessIndex": accessIndex
		});
		ports.extraValidation = position =>
		{
			if (this.HQ.territoryMap.getOwner(position) !== PlayerID ||
			    gameState.ai.accessibility.getAccessValue(position) !== accessIndex)
				return false;
			if (kind === "farmstead")
				for (const ent of [...this.builtByClass(gameState, "Farmstead"), ...this.foundationsByClass(gameState, "Farmstead")])
					if (entityPosition(ent) && SquareVectorDistance(position, ent.position()) < 30*30)
						return false;
			if (kind === "storehouse" && this.builtByClass(gameState, "Storehouse").length)
				for (const ent of this.builtByClass(gameState, "Storehouse"))
					if (SquareVectorDistance(position, ent.position()) < 30*30)
						return false;
			return true;
		};
		return ports;
	}

	prepareExecution(gameState, frame, cc, accessIndex, foodObservation)
	{
		const merged = { "builds": {}, "maintenance": {}, "training": this.trainingExecution(gameState, cc) };
		const executableActions = [];
		for (const action of frame.actions)
		{
			if (action.type === "BUILD")
			{
				if (this.activeTaskByKind[action.kind])
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
					continue;
				this.activeTaskByKind[action.kind] = exec.taskId;
				this.taskStartedAt[exec.taskId] = gameState.ai.elapsedTime;
				merged.builds[buildKey(action)] = exec;
				executableActions.push(action);
			}
			else if (action.type === "MAINTAIN_CONSTRUCTION")
			{
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

	assignFoodWorker(gameState, ent, foodObservation, accessIndex)
	{
		const ids = foodObservation.ids || [];
		let current = ent.getMetadata(PlayerID, SUPPLY_ID);
		let target = current !== undefined ? gameState.getEntityById(current) : undefined;
		if (target && ids.includes(target.id()) && target.resourceSupplyAmount && target.resourceSupplyAmount() > 0 && !isSupplyFull(gameState, target))
			return;
		const candidates = ids.map(id => gameState.getEntityById(id)).filter(s => s && entityPosition(s) && s.resourceSupplyAmount && s.resourceSupplyAmount() > 0 && !isSupplyFull(gameState, s));
		if (!candidates.length)
			return;
		candidates.sort((a, b) => SquareVectorDistance(ent.position(), a.position()) - SquareVectorDistance(ent.position(), b.position()) || a.id() - b.id());
		target = candidates[0];
		ent.setMetadata(PlayerID, SUPPLY_ID, target.id());
		ent.setMetadata(PlayerID, "gather-type", "food");
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
		if (this.HQ.basesManager && this.HQ.basesManager.AddTCGatherer)
			this.HQ.basesManager.AddTCGatherer(target.id());
		ent.gather(target);
	}

	assignFarmWorker(gameState, ent)
	{
		const fields = this.builtByClass(gameState, "Field");
		if (!fields.length)
			return;
		let target = gameState.getEntityById(ent.getMetadata(PlayerID, SUPPLY_ID));
		if (target && hasClass(target, "Field") && target.resourceSupplyAmount && target.resourceSupplyAmount() > 0 && !isSupplyFull(gameState, target))
			return;
		const available = fields.filter(field => !isSupplyFull(gameState, field));
		if (!available.length)
			return;
		available.sort((a, b) => SquareVectorDistance(ent.position(), a.position()) - SquareVectorDistance(ent.position(), b.position()) || a.id() - b.id());
		target = available[0];
		ent.setMetadata(PlayerID, SUPPLY_ID, target.id());
		ent.setMetadata(PlayerID, "gather-type", "food");
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
		if (this.HQ.basesManager && this.HQ.basesManager.AddTCGatherer)
			this.HQ.basesManager.AddTCGatherer(target.id());
		ent.gather(target);
	}

	assignWoodWorker(gameState, ent, woodsite, accessIndex)
	{
		const trees = woodsite.trees || [];
		const currentId = ent.getMetadata(PlayerID, SUPPLY_ID) ?? currentTargetId(ent);
		const current = currentId !== undefined ? gameState.getEntityById(currentId) : undefined;
		const currentTreeValid = !!(current && trees.some(tree => tree.id === current.id()) &&
			current.resourceSupplyAmount && current.resourceSupplyAmount() > 0);
		const observation = {
			"currentTreeValid": currentTreeValid,
			"availableLocalTargets": trees.filter(tree => !tree.saturated).length,
			"saturatedLocalTargets": trees.filter(tree => tree.saturated).length
		};
		const action = decideWoodWorkerTarget(observation);
		if (action.action === "KEEP_CURRENT_TREE")
			return;
		if (action.action !== "TAKE_LOCAL_TREE")
			return;
		const candidates = trees.filter(tree => !tree.saturated).map(tree => ({
			...tree,
			"workerDistance": Math.sqrt(SquareVectorDistance(ent.position(), tree.position))
		}));
		candidates.sort((a, b) => (a.dropDistance*10 + a.workerDistance) - (b.dropDistance*10 + b.workerDistance) || a.id - b.id);
		if (!candidates.length)
			return;
		const target = gameState.getEntityById(candidates[0].id);
		if (!target)
			return;
		ent.setMetadata(PlayerID, SUPPLY_ID, target.id());
		ent.setMetadata(PlayerID, "gather-type", "wood");
		ent.setMetadata(PlayerID, WORKSITE_ID, this.primaryWoodWorksite && this.primaryWoodWorksite.entityId || "opening");
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_GATHERER);
		if (this.HQ.basesManager && this.HQ.basesManager.AddTCGatherer)
			this.HQ.basesManager.AddTCGatherer(target.id());
		executeWorkerAction(gameState, ent.id(), action, { "targetId": target.id() }, {}, { "playerId": PlayerID });
	}

	assignChickenCavalry(gameState, ent, cc)
	{
		const supplies = [];
		for (const supply of gameState.getResourceSupplies("food").values())
		{
			if (!entityPosition(supply) || !hasClass(supply, "Animal") ||
			    !supply.resourceSupplyAmount || supply.resourceSupplyAmount() <= 0)
				continue;
			if (SquareVectorDistance(supply.position(), cc.position()) > 40*40)
				continue;
			supplies.push(supply);
		}
		if (!supplies.length)
			return;
		let current = gameState.getEntityById(ent.getMetadata(PlayerID, SUPPLY_ID));
		if (current && supplies.some(s => s.id() === current.id()))
			return;
		supplies.sort((a, b) => SquareVectorDistance(ent.position(), a.position()) - SquareVectorDistance(ent.position(), b.position()) || a.id() - b.id());
		current = supplies[0];
		ent.setMetadata(PlayerID, SUPPLY_ID, current.id());
		ent.setMetadata(PlayerID, "gather-type", "food");
		ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_HUNTER);
		ent.gather(current);
	}

	updateWorkers(gameState, cc, foodObservation, woodsite, accessIndex)
	{
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!entityPosition(ent) || !this.isExpertEconomyEntity(ent))
				continue;
			this.finishPendingJob(ent);
			if (ent.getMetadata(PlayerID, TASK_KEY) !== undefined || ent.getMetadata(PlayerID, "transport") !== undefined ||
			    ent.getMetadata(PlayerID, "PartOfArmy"))
				continue;
			const state = ent.unitAIState ? ent.unitAIState() : "";
			if (state && state.includes(".COMBAT."))
				continue;
			const job = ent.getMetadata(PlayerID, JOB_METADATA);
			if (job === "food")
				this.assignFoodWorker(gameState, ent, foodObservation, accessIndex);
			else if (job === "farm")
				this.assignFarmWorker(gameState, ent);
			else if (job === "wood" || job === "citizenSoldierWood")
				this.assignWoodWorker(gameState, ent, woodsite, accessIndex);
			else if (job === "chicken")
				this.assignChickenCavalry(gameState, ent, cc);
		}
	}

	cleanExpertQueues(gameState)
	{
		for (const name of ["house", "dropsites", "field", "militaryBuilding", "villager"])
		{
			const queue = gameState.ai.queues[name];
			if (!queue || !queue.plans)
				continue;
			queue.plans = queue.plans.filter(plan => plan.metadata && plan.metadata.expertDecisionLayer);
		}
	}

	hasOutstandingExpertConstruction(gameState)
	{
		if (Object.keys(this.activeTaskByKind).length)
			return true;
		for (const name of ["house", "dropsites", "field", "militaryBuilding"])
		{
			const queue = gameState.ai.queues[name];
			if (queue && queue.plans && queue.plans.some(plan => plan.metadata && plan.metadata.expertDecisionLayer))
				return true;
		}
		return false;
	}

	handoffFrame(frame)
	{
		return {
			...frame,
			"actions": frame.actions.filter(action => action.type === "MAINTAIN_CONSTRUCTION"),
			"training": { "action": "WAIT", "batch": 0, "reason": "handoff_pending" }
		};
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
		const foodObservation = this.foodTracker.observe(gameState, foodContext);
		this.ensureInitialWoodSelection(gameState, cc, accessIndex);
		this.refreshTasks(gameState);
		this.cleanExpertQueues(gameState);
		this.rebindQueuedStarters(gameState);

		// At the tested five-minute boundary, stop creating new economic obligations.
		// Finish any already-authorized construction task, then perform a clean one-way
		// handoff to Petra.  isActive() deliberately remains true until releaseAll()
		// runs so metadata/priorities cannot leak into a normal-Petra tick.
		const handoffPending = gameState.ai.elapsedTime >= this.controlUntil;
		if (handoffPending && !this.hasOutstandingExpertConstruction(gameState))
		{
			this.releaseAll(gameState, "tested-five-minute-handoff");
			return false;
		}

		this.syncJobs(gameState, foodObservation);
		const woodsite = this.collectWoodsite(gameState, cc, accessIndex);
		const workers = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		const aiPending = countPendingCivilianTraining(gameState);
		const livePending = this.countLiveCivilianTraining(gameState);
		const pendingTraining = {
			"pendingCivilians": aiPending.pendingCivilians + livePending.pendingCivilians,
			"pendingBatches": aiPending.pendingBatches + livePending.pendingBatches
		};
		const queuedPopulation = Math.max(0, this.HQ.getAccountedPopulation(gameState) - gameState.getPopulation()) + aiPending.pendingCivilians;
		const observation = observePetra(gameState, {
			"HQ": this.HQ,
			"filters": filters,
			"time": gameState.ai.elapsedTime,
			"queuedPopulation": queuedPopulation,
			"training": pendingTraining,
			"food": {
				"primaryRatio": foodObservation.ratio,
				"primaryRemaining": foodObservation.remaining,
				"targetFoodWorkers": Math.max(7, workers.food + workers.farm),
				"naturalFoodWorkers": workers.food,
				"farmWorkers": workers.farm
			},
			"woodsite": {
				...summarizeWoodTrees(woodsite.trees),
				"alternativeExistingWorksite": this.alternativeWoodWorksiteExists(gameState)
			},
			"workers": workers
		});
		let frame = stepDecision(this.memory, observation);
		this.memory = frame.memory;
		if (handoffPending)
			frame = this.handoffFrame(frame);
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
		this.updateWorkers(gameState, cc, foodObservation, woodsite, accessIndex);
		this.diagnose(gameState, frame, foodObservation, woodsite);
		return true;
	}

	diagnose(gameState, frame, food, woodsite)
	{
		if (gameState.ai.elapsedTime - this.lastDiag < 15)
			return;
		this.lastDiag = gameState.ai.elapsedTime;
		const workers = collectWorkerMetrics(gameState, { "playerId": PlayerID });
		const res = gameState.getResources();
		aiWarn("[EXPERT-RC1] t=" + Math.round(gameState.ai.elapsedTime) +
			" stage=" + frame.stage.stage + " pop=" + gameState.getPopulation() + "/" + gameState.getPopulationLimit() +
			" res=" + Math.round(res.food) + "/" + Math.round(res.wood) + "/" + Math.round(res.stone) + "/" + Math.round(res.metal) +
			" jobs f=" + workers.food + " farm=" + workers.farm + " w=" + workers.wood + " b=" + workers.builders +
			" sites H=" + this.builtByClass(gameState, "House").length + " F=" + this.builtByClass(gameState, "Farmstead").length +
			" fld=" + this.builtByClass(gameState, "Field").length + " S=" + this.builtByClass(gameState, "Storehouse").length +
			" B=" + this.builtByClass(gameState, "Barracks").length +
			" fruit=" + Math.round(100 * food.ratio) + "% wood=" + Math.round(woodsite.localWoodAmount));
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
			for (const key of [DEFAULT_OWNERSHIP_METADATA, JOB_METADATA, PENDING_JOB_METADATA, TASK_KEY, CIVILIAN_ORDINAL, WORKSITE_ID])
				ent.setMetadata(PlayerID, key, undefined);
		}
		for (const name of Object.keys(this.HQ.Config.priorities || {}))
			if (gameState.ai.queues[name])
				gameState.ai.queueManager.changePriority(name, this.HQ.Config.priorities[name]);
		if (!this.HQ.firstBaseConfig && this.HQ.hasPotentialBase())
			this.HQ.configFirstBase(gameState);
		aiWarn("[EXPERT-RC1] economy handoff to Petra at t=" + Math.round(gameState.ai.elapsedTime) + " reason=" + reason);
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
			"taskCounters": { ...this.taskCounters },
			"taskStartedAt": { ...this.taskStartedAt },
			"pendingWoodSelectionByTask": { ...this.pendingWoodSelectionByTask }
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
		this.taskCounters = { ...(data.taskCounters || {}) };
		this.taskStartedAt = { ...(data.taskStartedAt || {}) };
		this.pendingWoodSelectionByTask = { ...(data.pendingWoodSelectionByTask || {}) };
		this.lastUpdateTurn = -1;
	}
}
