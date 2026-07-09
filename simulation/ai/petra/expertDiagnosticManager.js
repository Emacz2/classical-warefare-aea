import * as difficulty from "simulation/ai/petra/difficultyLevel.js";

/**
 * ExpertDiagnosticManager
 *
 * Temporary diagnostic-only manager. It should not change behavior. It only
 * prints compact state snapshots so we can see where Expert loses ownership to
 * Petra during the opening/transition.
 */
export function ExpertDiagnosticManager(HQ)
{
	this.HQ = HQ;
	this.lastLogBucket = -1;
	this.prevJobs = new Map();
}

ExpertDiagnosticManager.prototype.isActive = function(gameState)
{
	return this.HQ.Config.difficulty >= difficulty.EXPERT && gameState.ai.elapsedTime <= 420;
};

ExpertDiagnosticManager.prototype.update = function(gameState, queues, label = "post")
{
	if (!this.isActive(gameState))
		return;

	const bucket = Math.floor(gameState.ai.elapsedTime / 10);
	if (bucket == this.lastLogBucket)
		return;
	this.lastLogBucket = bucket;

	const roles = this.countRoles(gameState);
	const q = this.countQueues(queues);
	const tasks = this.countConstruction(gameState, queues);
	const res = gameState.getResources();
	const freePop = gameState.getPopulationLimit() - this.HQ.getAccountedPopulation(gameState);

	warn("[EXPERT-DIAG " + label + "] t=" + Math.round(gameState.ai.elapsedTime) +
		" pop=" + gameState.getPopulation() + "/" + gameState.getPopulationLimit() +
		" free=" + freePop +
		" res(F/W/S/M)=" + Math.round(res.food || 0) + "/" + Math.round(res.wood || 0) + "/" + Math.round(res.stone || 0) + "/" + Math.round(res.metal || 0) +
		" roles total=" + roles.total + " food=" + roles.food + " wood=" + roles.wood + " farm=" + roles.farm +
		" berryBuild=" + roles.berryBuilder + " builder=" + roles.builder + " idle=" + roles.idle + " unowned=" + roles.unowned +
		" CSwood=" + roles.csWood + " cavFood=" + roles.cavFood +
		" queue vill=" + q.villager + " villPlans=" + q.villagerPlans + " villSizes=" + q.villagerSizes +
		" house=" + q.house + " dropsites=" + q.dropsites + " field=" + q.field + " milBuild=" + q.militaryBuilding +
		" foundations house=" + tasks.houseFoundations + " farmstead=" + tasks.farmsteadFoundations + " storehouse=" + tasks.storehouseFoundations + " barracks=" + tasks.barracksFoundations +
		" targets house=" + tasks.houseTargets + " farmstead=" + tasks.farmsteadTargets + " field=" + tasks.fieldTargets + " storehouse=" + tasks.storehouseTargets);

	this.logSuspiciousWorkers(gameState);
};

ExpertDiagnosticManager.prototype.countRoles = function(gameState)
{
	const out = {
		"total": 0,
		"food": 0,
		"wood": 0,
		"farm": 0,
		"berryBuilder": 0,
		"builder": 0,
		"idle": 0,
		"unowned": 0,
		"csWood": 0,
		"cavFood": 0
	};

	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position || !ent.position())
			continue;
		const isSupport = ent.hasClass && ent.hasClass("Support") && ent.hasClass("Worker");
		const isCS = ent.hasClass && ent.hasClass("CitizenSoldier") && !ent.hasClass("Cavalry");
		const isCav = ent.hasClass && ent.hasClass("Cavalry");
		const job = ent.getMetadata(PlayerID, "expertOpeningJob");
		const subrole = ent.getMetadata(PlayerID, "subrole");
		const target = ent.getMetadata(PlayerID, "target-foundation");
		const supply = ent.getMetadata(PlayerID, "supply");

		if (isSupport)
		{
			++out.total;
			if (job === undefined)
				++out.unowned;
			if (!target && (subrole === undefined || subrole == "idle" || subrole == 0))
				++out.idle;
			if (job == "berries" || job == "berriesBuilder")
				++out.food;
			if (job == "farm")
			{
				++out.food;
				++out.farm;
			}
			if (job == "wood")
				++out.wood;
			if (job == "berriesBuilder")
				++out.berryBuilder;
			if (target)
				++out.builder;
		}
		else if (isCS)
		{
			if (job == "wood" || supply)
				++out.csWood;
			if (target)
				++out.builder;
		}
		else if (isCav)
		{
			if (supply || job == "hunt")
				++out.cavFood;
		}
	}
	return out;
};

ExpertDiagnosticManager.prototype.countQueues = function(queues)
{
	const out = { "villager": 0, "villagerPlans": 0, "villagerSizes": "-", "house": 0, "dropsites": 0, "field": 0, "militaryBuilding": 0 };
	if (!queues)
		return out;
	for (const name of ["villager", "house", "dropsites", "field", "militaryBuilding"])
	{
		if (!queues[name] || !queues[name].plans)
			continue;
		out[name == "villager" ? "villagerPlans" : name] = queues[name].plans.length;
		if (name == "villager")
		{
			let sizes = [];
			let count = 0;
			for (const plan of queues[name].plans)
			{
				const n = plan.number || plan.count || plan.max || plan.min || "?";
				sizes.push(String(n));
				if (typeof n == "number")
					count += n;
			}
			out.villager = count;
			out.villagerSizes = sizes.join(",");
		}
	}
	return out;
};

ExpertDiagnosticManager.prototype.countConstruction = function(gameState, queues)
{
	const out = {
		"houseFoundations": 0,
		"farmsteadFoundations": 0,
		"storehouseFoundations": 0,
		"barracksFoundations": 0,
		"houseTargets": 0,
		"farmsteadTargets": 0,
		"fieldTargets": 0,
		"storehouseTargets": 0
	};

	const foundationTypes = new Map();
	for (const ent of gameState.getOwnStructures().values())
	{
		if (!ent || !ent.foundationProgress || ent.foundationProgress() === undefined)
			continue;
		let type = "other";
		if (ent.hasClass && ent.hasClass("House"))
			type = "house";
		else if (ent.hasClass && ent.hasClass("DropsiteFood"))
			type = "farmstead";
		else if (ent.hasClass && ent.hasClass("DropsiteWood"))
			type = "storehouse";
		else if (ent.hasClass && ent.hasClass("Barracks"))
			type = "barracks";
		foundationTypes.set(ent.id(), type);
		if (type == "house") ++out.houseFoundations;
		else if (type == "farmstead") ++out.farmsteadFoundations;
		else if (type == "storehouse") ++out.storehouseFoundations;
		else if (type == "barracks") ++out.barracksFoundations;
	}

	for (const ent of gameState.getOwnUnits().values())
	{
		const target = ent.getMetadata(PlayerID, "target-foundation");
		if (!target)
			continue;
		const type = foundationTypes.get(target);
		if (type == "house") ++out.houseTargets;
		else if (type == "farmstead") ++out.farmsteadTargets;
		else if (type == "storehouse") ++out.storehouseTargets;
		else if (ent.getMetadata(PlayerID, "expertOpeningJob") == "farm") ++out.fieldTargets;
	}
	return out;
};

ExpertDiagnosticManager.prototype.logSuspiciousWorkers = function(gameState)
{
	let idle = [];
	let changed = [];
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position || !ent.position() || !ent.hasClass || !ent.hasClass("Support") || !ent.hasClass("Worker"))
			continue;
		const id = ent.id();
		const job = ent.getMetadata(PlayerID, "expertOpeningJob");
		const subrole = ent.getMetadata(PlayerID, "subrole");
		const target = ent.getMetadata(PlayerID, "target-foundation");
		const supply = ent.getMetadata(PlayerID, "supply");
		const prev = this.prevJobs.get(id);
		const cur = String(job) + "/" + String(subrole) + "/" + String(target) + "/" + String(supply);
		if (prev !== undefined && prev != cur)
			changed.push(id + ":" + prev + "->" + cur);
		this.prevJobs.set(id, cur);
		if (!target && (job === undefined || subrole === undefined || subrole == "idle" || subrole == 0))
			idle.push(id + ":job=" + String(job) + ":supply=" + String(supply));
	}
	if (idle.length)
		warn("[EXPERT-DIAG idle] " + idle.slice(0, 12).join(" "));
	if (changed.length)
		warn("[EXPERT-DIAG changed] " + changed.slice(0, 12).join(" | "));
};
