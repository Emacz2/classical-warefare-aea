import * as filters from "simulation/ai/common-api/filters.js";
import { ResourcesManager } from "simulation/ai/common-api/resources.js";
import { SquareVectorDistance, aiWarn } from "simulation/ai/common-api/utils.js";
import { Config } from "simulation/ai/petra/config.js";
import { ExpertOpeningConstants } from "simulation/ai/petra/expertEconomyManager.js";
import * as difficulty from "simulation/ai/petra/difficultyLevel.js";
import { gatherTreasure, getBuiltEntity, getHolder, getLandAccess, isFastMoving } from
	"simulation/ai/petra/entityExtend.js";
import { Headquarters } from "simulation/ai/petra/headquarters.js";
import { ConstructionPlan } from "simulation/ai/petra/queueplanBuilding.js";
import { ResearchPlan } from "simulation/ai/petra/queueplanResearch.js";
import { Worker } from "simulation/ai/petra/worker.js";

/**
 * Determines the strategy to adopt when starting a new game,
 * depending on the initial conditions
 */

Headquarters.prototype.gameAnalysis = function(gameState)
{
	// Analysis of the terrain and the different access regions
	if (!this.regionAnalysis(gameState))
		return false;

	this.attackManager.init(gameState);
	this.buildManager.init(gameState);
	this.navalManager.init(gameState);
	this.tradeManager.init(gameState);
	this.diplomacyManager.init(gameState);

	// Make a list of buildable structures from the config file
	this.structureAnalysis(gameState);

	// Let's get our initial situation here.
	this.basesManager.init(gameState);
	this.updateTerritories(gameState);

	// Assign entities and resources in the different bases
	this.assignStartingEntities(gameState);


	// Sandbox difficulty should not try to expand
	this.canExpand = this.Config.difficulty != difficulty.SANDBOX;
	// If no base yet, check if we can construct one. If not, dispatch our units to possible tasks/attacks
	this.canBuildUnits = true;
	if (!gameState.getOwnStructures().filter(filters.byClass("CivCentre")).hasEntities())
	{
		const template = gameState.applyCiv("structures/{civ}/civil_centre");
		if (!gameState.isTemplateAvailable(template) || !gameState.getTemplate(template).available(gameState))
		{
			if (this.Config.debug > 1)
				aiWarn(" this AI is unable to produce any units");
			this.canBuildUnits = false;
			this.dispatchUnits(gameState);
		}
		else
			this.buildFirstBase(gameState);
	}

	// configure our first base strategy
	if (this.hasPotentialBase())
	{
		this.configFirstBase(gameState);
		this.applyExpertEconomyRules(gameState);
	}

	return true;
};




/**
 * Expert economy rules are incremental behavior improvements layered on top of Petra.
 *
 * Opening redesign: Petra still owns normal worker execution, but Expert owns the
 * opening jobs.  We assign stable jobs, then every update enforces only those jobs:
 *   - cavalry hunts chickens;
 *   - starting civilians build/gather at the berry farmstead;
 *   - starting men build the wood storehouse, then chop that woodline;
 *   - newly trained civilians follow the requested batch pattern.
 */
Headquarters.prototype.applyExpertEconomyRules = function(gameState, queues)
{
	if (!this.isExpertOpeningPhaseActive(gameState))
		return;

	if (queues)
	{
		// Opening rule: no citizen-soldier training, no phase techs, and no early
		// military-building plans. The only allowed early research is the berry/basket
		// economy tech queued by researchExpertOpeningBerryTech below.
		if (queues.citizenSoldier)
			queues.citizenSoldier.empty();
		if (queues.majorTech)
			queues.majorTech.empty();
		if (queues.militaryBuilding)
			queues.militaryBuilding.empty();

		// Petra's normal economy can decide that a second storehouse is useful while
		// the Expert opening is still locked.  For the first 180 seconds, keep only our
		// two opening dropsites: the first wood storehouse and the berry farmstead.
		if (queues.dropsites)
			queues.dropsites.plans = queues.dropsites.plans.filter(plan =>
				plan.metadata && plan.metadata.expertOpening);

		if (queues.minorTech && queues.minorTech.plans.length)
		{
			const metadata = queues.minorTech.plans[0].metadata;
			if (!metadata || !metadata.expertOpeningBerryTech && !metadata.expertOpeningWoodTech)
				queues.minorTech.empty();
		}
	}

	if (this.expertFoodClusterManager)
		this.expertFoodClusterManager.update(gameState);
	if (this.expertConstructionManager)
		this.expertConstructionManager.update(gameState, queues);

	this.ensureExpertOpeningPlan(gameState);
	this.ensureExpertOpeningWoodDropsite(gameState);
	this.ensureExpertOpeningFoodDropsite(gameState);
	if (queues)
	{
		// Eco tech decisions come before optional expansion dropsites so Expert
		// upgrades fruit gatherers before spending wood on a second farmstead.
		this.researchExpertOpeningBerryTech(gameState, queues);
		this.researchExpertOpeningWoodTech(gameState, queues);
	}
	this.ensureExpertOpeningAdditionalFoodDropsites(gameState, queues);
	if (queues)
		this.ensureExpertOpeningHouse(gameState, queues);
	this.ensureExpertOpeningFarms(gameState, queues);
	if (this.expertConstructionManager)
		this.expertConstructionManager.update(gameState, queues);
	this.assignExpertOpeningWorkers(gameState);
	if (this.expertEconomyManager)
		this.expertEconomyManager.update(gameState, queues);
};

Headquarters.prototype.isExpertOpeningPhaseActive = function(gameState)
{
	// Keep the opening lock active through the first three minutes so cavalry can
	// finish the chickens before Petra lets other workers hunt, and so workers
	// continue saturating the first woodline instead of asking for a second storehouse.
	return this.Config.difficulty >= difficulty.EXPERT && gameState.ai.elapsedTime <= 300;
};

Headquarters.prototype.ensureExpertOpeningPlan = function(gameState)
{
	if (this.expertOpeningPlanReady)
		return;

	this.expertOpeningPlanReady = true;
	this.expertOpeningNewFemaleCount = 0;
	this.expertOpeningInitialFruit = undefined;
	this.expertOpeningInitialPrimaryFruit = undefined;

	const base = this.baseManagers()[0];
	if (!base)
		return;

	this.expertOpeningInitialFruit = this.getExpertOpeningTerritoryFruitAmount(gameState);

	const civilians = [];
	const citizenSoldiers = [];
	const cavalry = [];

	for (const ent of gameState.getOwnUnits().values())
	{
		if (!this.isExpertOpeningEconomyUnit(ent))
			continue;

		this.claimExpertOpeningWorker(gameState, base, ent);

		if (ent.hasClass("Cavalry") && ent.canGather("food") && ent.canAttackClass("Animal"))
			cavalry.push(ent);
		else if (ent.hasClass("Civilian") && ent.canGather("food"))
			civilians.push(ent);
		else if (!ent.hasClass("Cavalry") && (ent.hasClass("CitizenSoldier") || ent.canGather("wood") || ent.isBuilder()))
			citizenSoldiers.push(ent);
	}

	cavalry.sort((a, b) => a.id() - b.id());
	civilians.sort((a, b) => a.id() - b.id());
	citizenSoldiers.sort((a, b) => a.id() - b.id());

	if (cavalry.length)
		cavalry[0].setMetadata(PlayerID, "expertOpeningJob", "chicken");

	let foodAssigned = 0;
	for (const ent of civilians)
	{
		if (foodAssigned < 4)
			ent.setMetadata(PlayerID, "expertOpeningJob", "berriesBuilder");
		else if (foodAssigned < 8)
			ent.setMetadata(PlayerID, "expertOpeningJob", "berries");
		else
			ent.setMetadata(PlayerID, "expertOpeningJob", "wood");
		++foodAssigned;
	}
	for (const ent of citizenSoldiers)
		ent.setMetadata(PlayerID, "expertOpeningJob", "woodBuilder");

	this.expertOpeningFoodAssigned = foodAssigned;
};

Headquarters.prototype.isExpertOpeningEconomyUnit = function(ent)
{
	if (!ent || !ent.position())
		return false;
	if (ent.hasClass("FishingBoat") || ent.hasClass("Ship"))
		return false;
	return ent.hasClass("Worker") || ent.hasClass("CitizenSoldier") || ent.canGather("food") ||
		ent.canGather("wood") || ent.isBuilder();
};

Headquarters.prototype.claimExpertOpeningWorker = function(gameState, base, ent)
{
	ent.setMetadata(PlayerID, "role", Worker.ROLE_WORKER);
	ent.setMetadata(PlayerID, "base", base.ID);
	base.units.updateEnt(ent);
	base.workers.updateEnt(ent);
};

Headquarters.prototype.ensureExpertOpeningWoodDropsite = function(gameState)
{
	if (!this.baseManagers().length)
		return;
	const base = this.baseManagers()[0];
	const existing = this.findExpertOpeningDropsite(gameState, "wood", base);
	if (existing && existing.position())
	{
		this.expertOpeningWoodPos = existing.position();
		return;
	}

	if (gameState.ai.queues.dropsites.plans.some(plan => plan.metadata && plan.metadata.expertOpening && plan.metadata.type == "wood"))
		return;

	// The opening wants exactly one first storehouse. Once its target position is
	// chosen, do not queue a second storehouse during the opening even if Petra has
	// not registered the finished structure yet.
	if (this.expertOpeningWoodPos)
		return;

	const newDP = base.findBestDropsiteAndLocation(gameState, "wood");
	if (newDP.quality <= 30 || !this.canBuild(gameState, newDP.templateName))
		return;

	this.expertOpeningWoodPos = newDP.pos;
	gameState.ai.queues.dropsites.addPlan(new ConstructionPlan(gameState, newDP.templateName,
		{ "base": base.ID, "type": "wood", "expertOpening": true }, newDP.pos));
};

Headquarters.prototype.ensureExpertOpeningFoodDropsite = function(gameState)
{
	if (!this.baseManagers().length)
		return;
	const base = this.baseManagers()[0];
	const existing = this.findExpertOpeningDropsite(gameState, "food", base);
	if (existing && existing.position())
	{
		this.expertOpeningFoodPos = existing.position();
		return;
	}

	if (gameState.ai.queues.dropsites.plans.some(plan => plan.metadata && plan.metadata.expertOpening && plan.metadata.type == "food"))
		return;

	if (this.expertOpeningFoodPos)
		return;

	const berries = this.findExpertOpeningSupply(gameState, base, "food",
		supply => !supply.hasClasses(["Animal", "Field"]));
	if (!berries || !berries.position())
		return;

	const templateName = "structures/{civ}/farmstead";
	if (!this.canBuild(gameState, templateName))
		return;

	this.expertOpeningFoodPos = berries.position();
	this.expertOpeningInitialPrimaryFruit = this.getExpertOpeningPrimaryFruitAmount(gameState);
	gameState.ai.queues.dropsites.addPlan(new ConstructionPlan(gameState, templateName,
		{ "base": base.ID, "type": "food", "expertOpening": true }, berries.position()));
};


Headquarters.prototype.ensureExpertOpeningAdditionalFoodDropsites = function(gameState, queues)
{
	// Expert should not spend wood on a second/third farmstead just because it
	// sees another fruit patch.  First use the starting farmstead and rush Wicker
	// Baskets when there are multiple fruit clusters.  Expand to new farmsteads
	// only when the starting fruit cluster is nearly exhausted.
	if (!queues || !queues.dropsites || queues.dropsites.hasQueuedUnits())
		return;
	if (!this.shouldExpertOpeningFoodExpansion(gameState))
		return;
	if (!this.canBuild(gameState, "structures/{civ}/farmstead"))
		return;

	// v0.3.5 task commitment: finish the current food dropsite task before
	// placing another farmstead foundation.
	if (this.findExpertOpeningDropsiteFoundation(gameState, "food", this.baseManagers()[0]))
		return;

	const base = this.baseManagers()[0];
	if (!base)
		return;

	// If there is more than one fruit cluster, baskets should come before the
	// extra farmstead unless the tech is already researched or currently queued.
	if (this.countExpertOpeningFruitClusters(gameState) >= 2 &&
	    !gameState.isResearched("gather_wicker_baskets") &&
	    !gameState.isResearching("gather_wicker_baskets"))
		return;

	const target = this.findExpertOpeningUnservedFruitCluster(gameState, base, ExpertOpeningConstants.farmsteadSpacing);
	if (!target)
		return;

	queues.dropsites.addPlan(new ConstructionPlan(gameState, "structures/{civ}/farmstead",
		{ "base": base.ID, "type": "food", "expertOpening": true, "expertExtraFoodDropsite": true },
		target.position()));
};

Headquarters.prototype.findExpertOpeningUnservedFruitCluster = function(gameState, base, maxWalkDistance)
{
	const supplies = gameState.getResourceSupplies("food");
	if (!supplies.length)
		return undefined;

	const maxDistSquare = maxWalkDistance * maxWalkDistance;
	let bestSupply;
	let bestAmount = 0;

	for (const supply of supplies.values())
	{
		if (!supply.position() || supply.hasClasses(["Animal", "Field"]))
			continue;
		if (getLandAccess(gameState, supply) != base.accessIndex)
			continue;
		if (this.territoryMap.getOwner(supply.position()) != PlayerID)
			continue;

		const supplyType = supply.resourceSupplyType();
		if (!supplyType || supplyType.generic != "food")
			continue;

		const nearest = this.getNearestExpertFoodDropsiteDistance(gameState, base, supply.position());
		if (nearest !== undefined && nearest <= maxDistSquare)
			continue;

		const amount = supply.resourceSupplyAmount();
		if (amount <= bestAmount)
			continue;
		bestSupply = supply;
		bestAmount = amount;
	}

	return bestSupply;
};

Headquarters.prototype.getNearestExpertFoodDropsiteDistance = function(gameState, base, pos)
{
	let bestDist;
	const candidates = [];

	for (const foundation of gameState.getOwnFoundations().values())
		candidates.push(foundation);
	for (const structure of gameState.getOwnStructures().values())
		candidates.push(structure);

	for (const ent of candidates)
	{
		if (!ent || !ent.position())
			continue;
		if (getLandAccess(gameState, ent) != base.accessIndex)
			continue;
		const built = ent.foundationProgress() === undefined ? ent : getBuiltEntity(gameState, ent);
		if (!built || built.hasClass && built.hasClass("CivCentre"))
			continue;
		if (typeof built.resourceDropsiteTypes !== "function")
			continue;
		const dropsiteTypes = built.resourceDropsiteTypes();
		if (!dropsiteTypes || dropsiteTypes.indexOf("food") == -1)
			continue;

		const dist = SquareVectorDistance(pos, ent.position());
		if (bestDist === undefined || dist < bestDist)
			bestDist = dist;
	}

	return bestDist;
};

Headquarters.prototype.ensureExpertOpeningHouse = function(gameState, queues)
{
	if (!queues.house)
		return;

	const base = this.baseManagers()[0];
	if (!base)
		return;

	const houseTemplate = gameState.isTemplateAvailable(gameState.applyCiv("structures/{civ}/apartment")) &&
		this.canBuild(gameState, "structures/{civ}/apartment") ?
		"structures/{civ}/apartment" : "structures/{civ}/house";
	if (!gameState.isTemplateAvailable(gameState.applyCiv(houseTemplate)) || !this.canBuild(gameState, houseTemplate))
		return;

	// Expert v0.3.1: every opening house should support the active work area,
	// not just the first one.  Do not return merely because one house exists;
	// later population houses were drifting back to Petra's generic CC layout.
	const popBonus = gameState.getTemplate(gameState.applyCiv(houseTemplate)).getPopulationBonus();
	const plannedPop = queues.house.length() * popBonus;
	const freeSlots = gameState.getPopulationLimit() + plannedPop - this.getAccountedPopulation(gameState);

	// Queue the opening house before we are housed, but do not spam houses.
	if (freeSlots > 12)
		return;

	const pos = this.findExpertOpeningHouseAnchorPosition(gameState, base);
	if (!pos)
		return;

	// Replace generic house plans during the opening with one positioned near the
	// first storehouse/woodline, then citizen soldiers will pick up that foundation.
	queues.house.plans = queues.house.plans.filter(plan =>
		plan.metadata && plan.metadata.expertOpeningHouse);

	if (queues.house.hasQueuedUnits())
		return;

	const avoidPos = this.findExpertOpeningSupplyNear(gameState, base, "wood", pos,
		supply => !supply.hasClasses(["Animal", "Field"]));
	const anchor = this.findExpertOpeningDropsite(gameState, "wood", base) ||
		this.findExpertOpeningDropsiteFoundation(gameState, "wood", base);
	const anchorRadius = anchor && anchor.obstructionRadius ? anchor.obstructionRadius().max : 0;
	const plan = new ConstructionPlan(gameState, houseTemplate,
		{ "base": base.ID, "expertOpeningHouse": true,
		  "expertOpeningHouseAvoid": avoidPos && avoidPos.position() ? avoidPos.position() : undefined,
		  "expertOpeningHouseAnchorRadius": anchorRadius,
		  "expertOpeningHouseMaxDistance": ExpertOpeningConstants.maxHouseDistance }, pos);
	plan.goRequirement = undefined;
	queues.house.addPlan(plan);
};


Headquarters.prototype.findExpertOpeningHouseAnchorPosition = function(gameState, base)
{
	// Expert v0.3.2 behavioral rule: houses are worksite support buildings.
	// Anchor them to the actual first wood dropsite/foundation, not to the CC and
	// not to the current average worker position.  The average worker position was
	// unstable: when citizen soldiers were temporarily pulled to another job, house
	// placement drifted across the base.
	const dropsite = this.findExpertOpeningDropsite(gameState, "wood", base);
	if (dropsite && dropsite.position())
		return dropsite.position();

	const foundation = this.findExpertOpeningDropsiteFoundation(gameState, "wood", base);
	if (foundation && foundation.position())
		return foundation.position();

	return this.expertOpeningWoodPos || undefined;
};

Headquarters.prototype.getExpertOpeningTerritoryFruitAmount = function(gameState)
{
	const base = this.baseManagers()[0];
	if (!base)
		return 0;

	let amount = 0;
	const supplies = gameState.getResourceSupplies("food");
	if (!supplies.length)
		return 0;

	for (const supply of supplies.values())
	{
		if (!supply.position() || supply.hasClasses(["Animal", "Field"]))
			continue;
		if (getLandAccess(gameState, supply) != base.accessIndex)
			continue;
		if (this.territoryMap.getOwner(supply.position()) != PlayerID)
			continue;
		const supplyType = supply.resourceSupplyType();
		if (!supplyType || supplyType.generic != "food")
			continue;
		amount += supply.resourceSupplyAmount();
	}
	return amount;
};

Headquarters.prototype.getExpertOpeningPrimaryFruitAmount = function(gameState)
{
	const base = this.baseManagers()[0];
	if (!base || !this.expertOpeningFoodPos)
		return this.getExpertOpeningTerritoryFruitAmount(gameState);

	let amount = 0;
	const supplies = gameState.getResourceSupplies("food");
	if (!supplies.length)
		return 0;

	// Count the starting berry/apple cluster served by the first farmstead.
	// Other separated food patches are ignored for the 25% transition test so
	// Expert does not overbuild farmsteads before the starting patch is depleted.
	const clusterDistance = 26 * 26;
	for (const supply of supplies.values())
	{
		if (!supply.position() || supply.hasClasses(["Animal", "Field"]))
			continue;
		if (getLandAccess(gameState, supply) != base.accessIndex)
			continue;
		if (this.territoryMap.getOwner(supply.position()) != PlayerID)
			continue;
		if (SquareVectorDistance(this.expertOpeningFoodPos, supply.position()) > clusterDistance)
			continue;
		const supplyType = supply.resourceSupplyType();
		if (!supplyType || supplyType.generic != "food")
			continue;
		amount += supply.resourceSupplyAmount();
	}
	return amount;
};

Headquarters.prototype.shouldExpertOpeningFarmTransition = function(gameState)
{
	// v0.3.5: farms are a committed transition, not an early placeholder.
	// Do not place fields while owned natural fruit/berries/apples are still
	// above 30% of the opening amount.
	if (!this.expertOpeningInitialFruit)
		this.expertOpeningInitialFruit = this.getExpertOpeningTerritoryFruitAmount(gameState);
	if (!this.expertOpeningInitialFruit)
		return false;

	const remaining = this.getExpertOpeningTerritoryFruitAmount(gameState);
	return remaining <= ExpertOpeningConstants.berryTransition * this.expertOpeningInitialFruit;
};

Headquarters.prototype.shouldExpertOpeningFoodExpansion = function(gameState)
{
	// A second farmstead may serve a new natural food cluster once the primary
	// starting cluster is low.  Farms themselves still wait for the all-natural
	// food transition above.
	if (!this.expertOpeningInitialPrimaryFruit)
		this.expertOpeningInitialPrimaryFruit = this.getExpertOpeningPrimaryFruitAmount(gameState);
	if (!this.expertOpeningInitialPrimaryFruit)
		return false;

	const remaining = this.getExpertOpeningPrimaryFruitAmount(gameState);
	return remaining <= ExpertOpeningConstants.berryTransition * this.expertOpeningInitialPrimaryFruit;
};

Headquarters.prototype.hasExpertOpeningCivilianFoodBuilder = function(gameState)
{
	const base = this.baseManagers()[0];
	if (!base)
		return false;

	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent || !ent.position())
			continue;
		if (!ent.hasClass("Worker") || !ent.hasClass("Civilian"))
			continue;
		if (ent.hasClass("CitizenSoldier"))
			continue;
		if (!ent.isBuilder || !ent.isBuilder())
			continue;
		if (ent.getMetadata(PlayerID, "base") != base.ID)
			continue;
		if (getLandAccess(gameState, ent) != base.accessIndex)
			continue;

		// Only civilians already assigned to the farm transition may trigger a new
		// field foundation.  Idle berry workers should not start farm construction
		// and then return to berries.
		const job = ent.getMetadata(PlayerID, "expertOpeningJob");
		if (job == "farm")
			return true;
	}

	return false;
};


Headquarters.prototype.ensureExpertOpeningFarms = function(gameState, queues)
{
	if (!queues || !queues.field)
		return;
	if (!this.shouldExpertOpeningFarmTransition(gameState))
	{
		// v0.3.5: no frozen field resources.  If Petra or an earlier Expert
		// rule queued farms before natural food is under 30%, remove them.
		queues.field.empty();
		return;
	}
	if (!this.canBuild(gameState, "structures/{civ}/field"))
		return;

	const base = this.baseManagers()[0];
	if (!base)
		return;

	const fields = gameState.getOwnEntitiesByClass("Field", true).filter(filters.byMetadata(PlayerID, "base", base.ID)).length;
	const foundations = gameState.getOwnFoundations().filter(filters.byClass("Field")).filter(filters.byMetadata(PlayerID, "base", base.ID)).length;
	const queued = queues.field.countQueuedUnits();
	const wanted = 4;
	if (fields >= wanted || foundations + queued >= 1)
		return;

	// Expert v0.3: do not drop empty field foundations. Wait until at least one
	// civilian food worker exists so a field can be built and worked immediately.
	if (!this.hasExpertOpeningCivilianFoodBuilder(gameState))
		return;

	const foodDropsite = this.findExpertOpeningDropsite(gameState, "food", base) ||
		this.findExpertOpeningDropsiteFoundation(gameState, "food", base);
	const farmAnchor = foodDropsite && foodDropsite.position() ? foodDropsite.position() :
		(this.expertOpeningFoodPos || (base.anchor && base.anchor.position() ? base.anchor.position() : undefined));
	queues.field.addPlan(new ConstructionPlan(gameState,
		"structures/{civ}/field", { "base": base.ID, "favoredBase": base.ID, "expertOpeningFarm": true },
		farmAnchor));
	gameState.ai.HQ.needFarm = true;
};

Headquarters.prototype.findExpertOpeningFieldFoundation = function(gameState, base)
{
	let bestFoundation;
	let bestDist = Math.min();
	const basePos = this.expertOpeningFoodPos || (base.anchor && base.anchor.position() ? base.anchor.position() : undefined);
	// A field center is normally around 20-24m from the farmstead center when the
	// field edge touches the dropsite area.  This cap prevents Expert food builders
	// from crossing the base to finish unrelated/generic field foundations.
	const maxDist = 35 * 35;

	for (const foundation of gameState.getOwnFoundations().values())
	{
		if (!foundation || !foundation.position() || !foundation.hasClass("Field"))
			continue;
		if (foundation.getMetadata(PlayerID, "base") != base.ID)
			continue;
		if (this.getExpertOpeningFoundationBuilderCount(gameState, foundation) >= 2)
			continue;
		const dist = basePos ? SquareVectorDistance(basePos, foundation.position()) : 0;
		if (basePos && dist > maxDist)
			continue;
		if (dist > bestDist)
			continue;
		bestFoundation = foundation;
		bestDist = dist;
	}
	return bestFoundation;
};

Headquarters.prototype.findExpertOpeningField = function(gameState, base, ent)
{
	let bestField;
	let bestDist = Math.min();
	for (const field of gameState.getOwnEntitiesByClass("Field", true).filter(filters.isBuilt()).filter(filters.byMetadata(PlayerID, "base", base.ID)).values())
	{
		if (!field.position())
			continue;
		if (this.expertFoodManager &&
		    this.expertFoodManager.countFieldWorkers(gameState, field) >= this.expertFoodManager.maxFieldWorkers)
			continue;
		const dist = ent && ent.position() ? SquareVectorDistance(ent.position(), field.position()) : 0;
		if (dist > bestDist)
			continue;
		bestField = field;
		bestDist = dist;
	}
	return bestField;
};

Headquarters.prototype.isExpertOpeningGatheringField = function(gameState, ent)
{
	if (!ent || ent.getMetadata(PlayerID, "subrole") !== Worker.SUBROLE_GATHERER)
		return false;
	const supplyId = ent.getMetadata(PlayerID, "supply");
	if (!supplyId)
		return false;
	const supply = gameState.getEntityById(supplyId);
	return !!(supply && supply.hasClass && supply.hasClass("Field"));
};

Headquarters.prototype.getExpertOpeningFoundationBuilderCount = function(gameState, foundation)
{
	if (!foundation)
		return 0;
	let count = 0;
	for (const ent of gameState.getOwnUnits().values())
		if (ent.getMetadata(PlayerID, "target-foundation") == foundation.id())
			++count;
	return count;
};


Headquarters.prototype.assignExpertOpeningWorkers = function(gameState)
{
	const base = this.baseManagers()[0];
	if (!base)
		return;

	// ExpertFoodManager v0.3.4 owns civilian food roles before Petra/Expert
	// enforcement issues orders.  This is where we stop oversaturating berries and
	// keep active food workers locked to their current resource.
	if (this.expertFoodManager)
		this.expertFoodManager.update(gameState);

	for (const ent of gameState.getOwnUnits().values())
	{
		if (!this.isExpertOpeningEconomyUnit(ent))
			continue;

		this.claimExpertOpeningWorker(gameState, base, ent);

		if (ent.getMetadata(PlayerID, "expertOpeningJob") === undefined)
		{
			if (ent.hasClass("Cavalry") && ent.canGather("food") && ent.canAttackClass("Animal"))
				ent.setMetadata(PlayerID, "expertOpeningJob", "chicken");
			else if (ent.hasClass("Civilian") && ent.canGather("food"))
			{
				const foodAssigned = this.countExpertOpeningFoodCivilians(gameState);
				const woodAssigned = this.countExpertOpeningCivilianWoodWorkers(gameState);
				const foodFoundation = this.findExpertOpeningDropsiteFoundation(gameState, "food", this.baseManagers()[0]);
				if (foodFoundation && foodAssigned < 8)
				{
					const berryBuilders = this.countExpertOpeningJob(gameState, "berriesBuilder");
					if (berryBuilders < 4)
						ent.setMetadata(PlayerID, "expertOpeningJob", "berriesBuilder");
					else
						ent.setMetadata(PlayerID, "expertOpeningJob", "berries");
				}
				else if (foodFoundation)
					ent.setMetadata(PlayerID, "expertOpeningJob", "foodDropsiteBuilder");
				else
				{
					const bias = this.expertEconomyManager ? this.expertEconomyManager.getOpeningResourceBias(gameState) : "balanced";
					if (bias != "food" && !this.shouldExpertOpeningFarmTransition(gameState) &&
					    woodAssigned < ExpertOpeningConstants.firstWoodSaturation)
						ent.setMetadata(PlayerID, "expertOpeningJob", "wood");
					else if (this.shouldExpertOpeningFarmTransition(gameState))
						ent.setMetadata(PlayerID, "expertOpeningJob", "farm");
					else
						ent.setMetadata(PlayerID, "expertOpeningJob", "berries");
				}
			}
			else if (!ent.hasClass("Cavalry") && (ent.hasClass("CitizenSoldier") || ent.canGather("wood") || ent.isBuilder()))
				ent.setMetadata(PlayerID, "expertOpeningJob", "woodBuilder");
		}

		this.enforceExpertOpeningPhase(gameState, ent);
	}
};

Headquarters.prototype.countExpertOpeningFoodCivilians = function(gameState)
{
	let count = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent.position() || !ent.hasClass("Civilian"))
			continue;
		const job = ent.getMetadata(PlayerID, "expertOpeningJob");
		if (job == "berries" || job == "berriesBuilder")
			++count;
	}
	return count;
};

Headquarters.prototype.countExpertOpeningCivilianWoodWorkers = function(gameState)
{
	let count = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent.position() || !ent.hasClass("Civilian"))
			continue;
		if (ent.getMetadata(PlayerID, "expertOpeningJob") == "wood")
			++count;
	}
	return count;
};

Headquarters.prototype.countExpertOpeningJob = function(gameState, jobName)
{
	let count = 0;
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent.position())
			continue;
		if (ent.getMetadata(PlayerID, "expertOpeningJob") == jobName)
			++count;
	}
	return count;
};

Headquarters.prototype.assignExpertOpeningIdleWorker = function(gameState, base, ent)
{
	if (!this.isExpertOpeningPhaseActive(gameState))
		return false;
	if (!this.isExpertOpeningEconomyUnit(ent))
		return false;
	this.ensureExpertOpeningPlan(gameState);
	this.claimExpertOpeningWorker(gameState, base, ent);
	if (ent.getMetadata(PlayerID, "expertOpeningJob") === undefined)
		this.assignExpertOpeningWorkers(gameState);
	return this.enforceExpertOpeningPhase(gameState, ent);
};

Headquarters.prototype.enforceExpertOpeningPhase = function(gameState, ent)
{
	if (!this.isExpertOpeningPhaseActive(gameState))
		return false;
	if (!this.isExpertOpeningEconomyUnit(ent))
		return false;

	const base = this.baseManagers()[0];
	if (!base)
		return false;

	this.ensureExpertOpeningWoodDropsite(gameState);
	this.ensureExpertOpeningFoodDropsite(gameState);
	this.claimExpertOpeningWorker(gameState, base, ent);

	let job = ent.getMetadata(PlayerID, "expertOpeningJob");

	// Berry saturation is handled by ExpertFoodManager before enforcement.
	// Do not redirect active berry workers here; doing so caused food workers to
	// walk away from their current patch and then come back again.

	if (job == "chicken")
	{
		const chicken = this.findExpertOpeningChicken(gameState, base);
		if (!chicken)
			return true;
		return this.setExpertOpeningGatherTarget(gameState, base, ent, chicken,
			Worker.SUBROLE_HUNTER, "food");
	}

	if (job == "berriesBuilder")
	{
		const foodFoundation = this.findExpertOpeningDropsiteFoundation(gameState, "food", base);
		if (foodFoundation)
			return this.setExpertOpeningBuildTarget(gameState, base, ent, foodFoundation);

		const foodDropsite = this.findExpertOpeningDropsite(gameState, "food", base);
		if (foodDropsite && foodDropsite.position && foodDropsite.position())
		{
			ent.setMetadata(PlayerID, "expertOpeningJob", "berries");
			const naturalFood = this.findExpertOpeningAvailableNaturalFood(gameState, base, ent);
			if (naturalFood)
				return this.setExpertOpeningGatherTarget(gameState, base, ent, naturalFood,
					Worker.SUBROLE_GATHERER, "food");
		}

		// v0.3.6 commitment rule: the first four civilians remain committed to
		// building the opening farmstead.  Do not downgrade them to berry gatherers
		// while the construction plan is merely waiting to place its foundation.
		if (this.expertOpeningFoodPos && ent.position && ent.position())
		{
			ent.stopMoving();
			ent.setMetadata(PlayerID, "base", base.ID);
			ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_IDLE);
			ent.moveToRange(this.expertOpeningFoodPos[0], this.expertOpeningFoodPos[1], 0, 3);
		}
		return true;
	}

	if (job == "foodDropsiteBuilder")
	{
		const foodFoundation = this.findExpertOpeningDropsiteFoundation(gameState, "food", base);
		if (foodFoundation)
			return this.setExpertOpeningBuildTarget(gameState, base, ent, foodFoundation);
		ent.setMetadata(PlayerID, "expertOpeningJob", "berries");
		const naturalFood = this.findExpertOpeningAvailableNaturalFood(gameState, base, ent);
		if (naturalFood)
			return this.setExpertOpeningGatherTarget(gameState, base, ent, naturalFood,
				Worker.SUBROLE_GATHERER, "food");
		return true;
	}

	if (job == "farmBuilder")
	{
		const fieldFoundation = this.findExpertOpeningFieldFoundation(gameState, base);
		if (fieldFoundation && this.getExpertOpeningFoundationBuilderCount(gameState, fieldFoundation) < 2)
			return this.setExpertOpeningBuildTarget(gameState, base, ent, fieldFoundation);
		ent.setMetadata(PlayerID, "expertOpeningJob", "farm");
	}

	if (ent.getMetadata(PlayerID, "expertOpeningJob") == "farm")
	{
		// Current farmers stay on their current field.  Only new/idle farm civilians
		// are allowed to build the next field.
		const lockedSupplyId = ent.getMetadata(PlayerID, "expertFoodLockedSupply");
		const lockedSupply = lockedSupplyId ? gameState.getEntityById(lockedSupplyId) : undefined;
		if (lockedSupply && lockedSupply.position && lockedSupply.position() &&
		    lockedSupply.hasClass && lockedSupply.hasClass("Field") &&
		    (!lockedSupply.resourceSupplyAmount || lockedSupply.resourceSupplyAmount() > 0))
			return this.setExpertOpeningGatherTarget(gameState, base, ent, lockedSupply,
				Worker.SUBROLE_GATHERER, "food");

		if (this.isExpertOpeningGatheringField(gameState, ent))
			return true;

		const fieldFoundation = this.findExpertOpeningFieldFoundation(gameState, base);
		const subrole = ent.getMetadata(PlayerID, "subrole");
		const supplyId = ent.getMetadata(PlayerID, "supply");
		const assignedSupply = supplyId ? gameState.getEntityById(supplyId) : undefined;
		const mayBuildField = job == "farmBuilder" || subrole === Worker.SUBROLE_IDLE ||
			!assignedSupply ||
			(assignedSupply.hasClass && !assignedSupply.hasClass("Field") &&
			 (!assignedSupply.resourceSupplyAmount || assignedSupply.resourceSupplyAmount() <= 0));
		if (fieldFoundation && mayBuildField && ent.hasClass("Civilian") && ent.isBuilder() &&
		    this.getExpertOpeningFoundationBuilderCount(gameState, fieldFoundation) < 2)
			return this.setExpertOpeningBuildTarget(gameState, base, ent, fieldFoundation);

		const field = this.findExpertOpeningField(gameState, base, ent);
		if (field)
			return this.setExpertOpeningGatherTarget(gameState, base, ent, field,
				Worker.SUBROLE_GATHERER, "food");
		const naturalFood = this.findExpertOpeningAvailableNaturalFood(gameState, base, ent);
		if (naturalFood)
			return this.setExpertOpeningGatherTarget(gameState, base, ent, naturalFood,
				Worker.SUBROLE_GATHERER, "food");
		return true;
	}

	if (ent.getMetadata(PlayerID, "expertOpeningJob") == "berries")
	{
		// Existing berry workers should finish their locked berry source before
		// transitioning.  This prevents Petra-style churn where berry workers walk away
		// to build new farms and then walk back.
		const lockedSupplyId = ent.getMetadata(PlayerID, "expertFoodLockedSupply");
		const lockedSupply = lockedSupplyId ? gameState.getEntityById(lockedSupplyId) : undefined;
		if (lockedSupply && lockedSupply.position && lockedSupply.position() &&
		    lockedSupply.resourceSupplyAmount && lockedSupply.resourceSupplyAmount() > 0)
			return this.setExpertOpeningGatherTarget(gameState, base, ent, lockedSupply,
				Worker.SUBROLE_GATHERER, "food");

		// Existing berry workers should finish the current patch.  When the patch
		// drops below the transition threshold, new civilians switch to the farm
		// job, but the original berry workers do not abandon remaining fruit.
		// Do not pull normal berry gatherers into construction.  Food dropsite
		// foundations are handled by the explicit berriesBuilder role.

		const naturalFood = this.findExpertOpeningAvailableNaturalFood(gameState, base, ent);
		if (naturalFood)
			return this.setExpertOpeningGatherTarget(gameState, base, ent, naturalFood,
				Worker.SUBROLE_GATHERER, "food");

		// Existing berry workers do not leave their berry area to build farms.
		// If their local berries are gone, convert them to the farm role; otherwise
		// they simply wait for the next tick to find fruit in the same area.
		if (this.shouldExpertOpeningFarmTransition(gameState) && ent.hasClass("Civilian"))
			ent.setMetadata(PlayerID, "expertOpeningJob", "farm");
		return true;
	}

	if (job == "woodBuilder" || job == "wood")
	{
		const woodFoundation = this.findExpertOpeningDropsiteFoundation(gameState, "wood", base);
		// A28 unit classes vary by civ/mod.  For the Expert opening, any non-civilian,
		// non-cavalry builder assigned to wood must finish the first storehouse before
		// chopping.  This keeps citizen soldiers from walking back to the CC trees.
		if (woodFoundation && !ent.hasClass("Civilian") && !ent.hasClass("Cavalry") && ent.isBuilder())
			return this.setExpertOpeningBuildTarget(gameState, base, ent, woodFoundation);

		const houseFoundation = this.findExpertOpeningHouseFoundation(gameState, base);
		if (houseFoundation && !ent.hasClass("Civilian") && !ent.hasClass("Cavalry") && ent.isBuilder())
			return this.setExpertOpeningBuildTarget(gameState, base, ent, houseFoundation);

		if (job == "woodBuilder")
			ent.setMetadata(PlayerID, "expertOpeningJob", "wood");
	}

	if (ent.getMetadata(PlayerID, "expertOpeningJob") == "wood" && ent.canGather("wood"))
	{
		const wood = this.findExpertOpeningSupplyNear(gameState, base, "wood",
			this.expertOpeningWoodPos, supply => !supply.hasClasses(["Animal", "Field"]));
		if (!wood)
			return true;
		return this.setExpertOpeningGatherTarget(gameState, base, ent, wood,
			Worker.SUBROLE_GATHERER, "wood");
	}

	return true;
};

Headquarters.prototype.setExpertOpeningBuildTarget = function(gameState, base, ent, foundation)
{
	if (ent.getMetadata(PlayerID, "subrole") === Worker.SUBROLE_BUILDER &&
	    ent.getMetadata(PlayerID, "target-foundation") == foundation.id())
	{
		ent.repair(foundation);
		return true;
	}

	ent.stopMoving();
	ent.setMetadata(PlayerID, "base", base.ID);
	ent.setMetadata(PlayerID, "subrole", Worker.SUBROLE_BUILDER);
	ent.setMetadata(PlayerID, "target-foundation", foundation.id());
	ent.repair(foundation);
	return true;
};

Headquarters.prototype.setExpertOpeningGatherTarget = function(gameState, base, ent, supply, subrole, resource)
{
	if (ent.getMetadata(PlayerID, "subrole") === subrole &&
	    ent.getMetadata(PlayerID, "supply") == supply.id())
	{
		if (subrole == Worker.SUBROLE_HUNTER || ent.isIdle())
			ent.gather(supply);
		return true;
	}

	const oldSupply = ent.getMetadata(PlayerID, "supply");
	if (oldSupply && oldSupply != supply.id())
		base.RemoveTCGatherer(oldSupply);

	ent.stopMoving();
	ent.setMetadata(PlayerID, "base", base.ID);
	ent.setMetadata(PlayerID, "subrole", subrole);
	ent.setMetadata(PlayerID, "gather-type", resource);
	ent.setMetadata(PlayerID, "target-foundation", undefined);
	ent.setMetadata(PlayerID, "supply", supply.id());
	if (resource == "food" && ent.hasClass("Civilian") && !ent.hasClass("CitizenSoldier"))
		ent.setMetadata(PlayerID, "expertFoodLockedSupply", supply.id());
	base.AddTCGatherer(supply.id());
	ent.gather(supply);
	return true;
};

Headquarters.prototype.findExpertOpeningDropsite = function(gameState, resource, base)
{
	let bestDropsite;
	let bestDist = Math.min();
	const nearPos = resource == "wood" ? this.expertOpeningWoodPos : this.expertOpeningFoodPos;
	const basePos = nearPos || (base.anchor && base.anchor.position() ? base.anchor.position() : undefined);

	const candidates = [];
	for (const foundation of gameState.getOwnFoundations().values())
		candidates.push(foundation);
	for (const structure of gameState.getOwnStructures().values())
		candidates.push(structure);

	for (const ent of candidates)
	{
		if (!ent || !ent.position())
			continue;
		const built = ent.foundationProgress() === undefined ? ent : getBuiltEntity(gameState, ent);
		// Do not let the starting Civic Centre count as the Expert opening dropsite.
		// Otherwise expertOpeningWoodPos/foodPos gets reset to the CC and workers walk
		// back to CC-adjacent trees instead of using the new storehouse/farmstead.
		if (!built || built.hasClass && built.hasClass("CivCentre") || ent.id && ent.id() == base.anchorId)
			continue;
		if (typeof built.resourceDropsiteTypes !== "function")
			continue;
		const dropsiteTypes = built.resourceDropsiteTypes();
		if (!dropsiteTypes || dropsiteTypes.indexOf(resource) == -1)
			continue;
		if (getLandAccess(gameState, ent) != base.accessIndex)
			continue;

		const dist = basePos ? SquareVectorDistance(basePos, ent.position()) : 0;
		if (dist > bestDist)
			continue;
		bestDropsite = ent;
		bestDist = dist;
	}
	return bestDropsite;
};

Headquarters.prototype.findExpertOpeningHouseFoundation = function(gameState, base)
{
	let bestFoundation;
	let bestDist = Math.min();
	const basePos = this.findExpertOpeningHouseAnchorPosition ?
		this.findExpertOpeningHouseAnchorPosition(gameState, base) :
		(this.expertOpeningWoodPos || (base.anchor && base.anchor.position() ? base.anchor.position() : undefined));
	const anchor = this.findExpertOpeningDropsite(gameState, "wood", base) ||
		this.findExpertOpeningDropsiteFoundation(gameState, "wood", base);
	const houseTemplate = gameState.applyCiv("structures/{civ}/house");
	const houseRadius = gameState.getTemplate(houseTemplate) ?
		gameState.getTemplate(houseTemplate).obstructionRadius().max : 4;
	const anchorRadius = anchor && anchor.obstructionRadius ? anchor.obstructionRadius().max : 0;
	const maxDist = (anchorRadius + houseRadius + ExpertOpeningConstants.maxHouseDistance);
	const maxDistSq = maxDist * maxDist;

	for (const foundation of gameState.getOwnFoundations().values())
	{
		if (!foundation || !foundation.position() || !foundation.hasClass("House"))
			continue;
		if (getLandAccess(gameState, foundation) != base.accessIndex)
			continue;

		const dist = basePos ? SquareVectorDistance(basePos, foundation.position()) : 0;
		if (basePos && dist > maxDistSq)
			continue;
		if (dist > bestDist)
			continue;
		bestFoundation = foundation;
		bestDist = dist;
	}
	return bestFoundation;
};

Headquarters.prototype.findExpertOpeningDropsiteFoundation = function(gameState, resource, base)
{
	let bestFoundation;
	let bestDist = Math.min();
	const nearPos = resource == "wood" ? this.expertOpeningWoodPos : this.expertOpeningFoodPos;
	const basePos = nearPos || (base.anchor && base.anchor.position() ? base.anchor.position() : undefined);

	for (const foundation of gameState.getOwnFoundations().values())
	{
		if (!foundation || !foundation.position())
			continue;
		const structure = getBuiltEntity(gameState, foundation);
		if (!structure || typeof structure.resourceDropsiteTypes !== "function")
			continue;
		const dropsiteTypes = structure.resourceDropsiteTypes();
		if (!dropsiteTypes || dropsiteTypes.indexOf(resource) == -1)
			continue;
		if (getLandAccess(gameState, foundation) != base.accessIndex)
			continue;

		const dist = basePos ? SquareVectorDistance(basePos, foundation.position()) : 0;
		if (dist > bestDist)
			continue;
		bestFoundation = foundation;
		bestDist = dist;
	}
	return bestFoundation;
};

Headquarters.prototype.findExpertOpeningChicken = function(gameState, base)
{
	const resources = gameState.getHuntableSupplies();
	if (!resources.hasEntities())
		return undefined;

	const position = base.anchor && base.anchor.position() ? base.anchor.position() : undefined;
	let bestSupply;
	let bestDist = Math.min();
	for (const supply of resources.values())
	{
		if (!supply.position() || !supply.hasClass("Domestic"))
			continue;
		if (getLandAccess(gameState, supply) != base.accessIndex)
			continue;
		const supplyType = supply.resourceSupplyType();
		if (!supplyType || supplyType.generic != "food")
			continue;
		const territoryOwner = this.territoryMap.getOwner(supply.position());
		if (territoryOwner != 0 && !gameState.isPlayerAlly(territoryOwner))
			continue;
		const dist = position ? SquareVectorDistance(position, supply.position()) : 0;
		if (dist > bestDist)
			continue;
		bestSupply = supply;
		bestDist = dist;
	}
	return bestSupply;
};


Headquarters.prototype.findExpertOpeningAvailableNaturalFood = function(gameState, base, ent)
{
	const supplies = gameState.getResourceSupplies("food");
	if (!supplies.length)
		return undefined;

	if (this.expertFoodClusterManager)
	{
		const clustered = this.expertFoodClusterManager.findBestServedClusterSupply(gameState, base, ent);
		if (clustered)
			return clustered;
	}

	const referencePos = ent && ent.position ? ent.position() :
		(this.expertOpeningFoodPos || (base.anchor && base.anchor.position() ? base.anchor.position() : undefined));
	let bestSupply;
	let bestDist = Math.min();

	for (const supply of supplies.values())
	{
		if (!supply.position() || supply.hasClasses(["Animal", "Field"]))
			continue;
		if (getLandAccess(gameState, supply) != base.accessIndex)
			continue;
		if (this.territoryMap.getOwner(supply.position()) != PlayerID)
			continue;
		const type = supply.resourceSupplyType();
		if (!type || type.generic != "food")
			continue;
		// v0.3.6: do not send civilians on long natural-food walks.  If a
		// berry/apple cluster is not served by a nearby farmstead, wait for the
		// food-dropsite task instead of walking back and forth across the base.
		const nearestDropsite = this.getNearestExpertFoodDropsiteDistance(gameState, base, supply.position());
		const nearOpeningPatch = this.expertOpeningFoodPos &&
			SquareVectorDistance(this.expertOpeningFoodPos, supply.position()) <= 26 * 26;
		if (!nearOpeningPatch && (nearestDropsite === undefined || nearestDropsite > 16 * 16))
			continue;

		if (this.expertFoodManager)
		{
			const cap = this.expertFoodManager.getNaturalFoodClusterLimit(supply);
			if (this.expertFoodManager.countClusterWorkers(gameState, supply, 14) >= cap)
				continue;
		}
		const dist = referencePos ? SquareVectorDistance(referencePos, supply.position()) : 0;
		if (dist > bestDist)
			continue;
		bestSupply = supply;
		bestDist = dist;
	}
	return bestSupply;
};

Headquarters.prototype.findExpertOpeningSupply = function(gameState, base, resource, predicate)
{
	const basePos = base.anchor && base.anchor.position() ? base.anchor.position() : undefined;
	return this.findExpertOpeningSupplyNear(gameState, base, resource, basePos, predicate);
};

Headquarters.prototype.findExpertOpeningSupplyNear = function(gameState, base, resource, nearPos, predicate)
{
	const supplies = gameState.getResourceSupplies(resource);
	if (!supplies.length)
		return undefined;

	const referencePos = nearPos || (base.anchor && base.anchor.position() ? base.anchor.position() : undefined);
	let bestSupply;
	let bestDist = Math.min();
	for (const supply of supplies.values())
	{
		if (!supply.position() || !predicate(supply))
			continue;
		if (getLandAccess(gameState, supply) != base.accessIndex)
			continue;
		const supplyType = supply.resourceSupplyType();
		if (!supplyType || supplyType.generic != resource)
			continue;
		const territoryOwner = this.territoryMap.getOwner(supply.position());
		// Opening rule: only cavalry may leave territory to hunt.  Civilian fruit
		// gatherers and citizen-soldier woodcutters must use resources inside our
		// own territory, so they do not walk out to sheep/deer or remote trees.
		if (territoryOwner != PlayerID)
			continue;
		if (this.expertFoodManager && resource == "food")
		{
			const type = supply.resourceSupplyType();
			if (type && type.specific == "fruit" &&
			    this.expertFoodManager.countClusterWorkers(gameState, supply, 14) >= this.expertFoodManager.maxBerryWorkers)
				continue;
		}
		const dist = referencePos ? SquareVectorDistance(referencePos, supply.position()) : 0;
		if (dist > bestDist)
			continue;
		bestSupply = supply;
		bestDist = dist;
	}
	return bestSupply;
};


Headquarters.prototype.countExpertOpeningFruitClusters = function(gameState)
{
	const base = this.baseManagers()[0];
	if (!base)
		return 0;

	const clusterDistance = 45 * 45;
	const clusters = [];
	const supplies = gameState.getResourceSupplies("food");
	for (const supply of supplies.values())
	{
		if (!supply.position() || supply.hasClasses(["Animal", "Field"]))
			continue;
		if (getLandAccess(gameState, supply) != base.accessIndex)
			continue;
		if (this.territoryMap.getOwner(supply.position()) != PlayerID)
			continue;
		const supplyType = supply.resourceSupplyType();
		if (!supplyType || supplyType.generic != "food")
			continue;

		let foundCluster = false;
		for (const pos of clusters)
		{
			if (SquareVectorDistance(pos, supply.position()) < clusterDistance)
			{
				foundCluster = true;
				break;
			}
		}
		if (!foundCluster)
			clusters.push(supply.position());
	}
	return clusters.length;
};

Headquarters.prototype.researchExpertOpeningBerryTech = function(gameState, queues)
{
	if (!queues.minorTech || queues.minorTech.hasQueuedUnits())
		return;
	if (gameState.isResearched("gather_wicker_baskets") || gameState.isResearching("gather_wicker_baskets"))
		return;

	// Rush basket tech only when Expert sees multiple separated fruit patches in
	// our starting territory.  Several bushes in the same berry patch count as one
	// cluster, so a normal single starting berry patch does not delay the first house
	// or Iron Axe Heads.
	if (this.countExpertOpeningFruitClusters(gameState) < 2)
		return;

	for (const tech of gameState.findAvailableTech())
	{
		if (tech[0] != "gather_wicker_baskets")
			continue;
		const plan = new ResearchPlan(gameState, "gather_wicker_baskets", true);
		if (!plan)
			return;
		plan.metadata = { "expertOpeningBerryTech": true };
		queues.minorTech.addPlan(plan);
		return;
	}
}


Headquarters.prototype.researchExpertOpeningWoodTech = function(gameState, queues)
{
	if (!queues.minorTech || queues.minorTech.hasQueuedUnits())
		return;
	if (gameState.isResearched("gather_lumbering_ironaxes") ||
	    gameState.isResearching("gather_lumbering_ironaxes"))
		return;
	// Basket tech has priority over Iron Axe Heads only when there are multiple
	// separated fruit patches worth upgrading immediately.
	if (this.countExpertOpeningFruitClusters(gameState) >= 2 &&
	    !gameState.isResearched("gather_wicker_baskets") &&
	    !gameState.isResearching("gather_wicker_baskets"))
		return;

	// Do not delay the first house: Expert only rushes Iron Axe Heads after a
	// house has been queued, placed, or built.
	const hasFirstHouse = gameState.getOwnFoundations().filter(filters.byClass("House")).hasEntities() ||
		gameState.getOwnStructures().filter(filters.byClass("House")).hasEntities() ||
		gameState.ai.queues.house && gameState.ai.queues.house.hasQueuedUnits();
	if (!hasFirstHouse)
		return;

	for (const tech of gameState.findAvailableTech())
	{
		if (tech[0] != "gather_lumbering_ironaxes")
			continue;
		const plan = new ResearchPlan(gameState, "gather_lumbering_ironaxes", true);
		if (!plan)
			return;
		plan.metadata = { "expertOpeningWoodTech": true };
		queues.minorTech.addPlan(plan);
		return;
	}
};


;


/**
 * Assign the starting entities to the different bases
 */
Headquarters.prototype.assignStartingEntities = function(gameState)
{
	for (const ent of gameState.getOwnEntities().values())
	{
		// do not affect merchant ship immediately to trade as they may-be useful for transport
		if (ent.hasClasses(["Trader+!Ship"]))
			this.tradeManager.assignTrader(ent);

		const pos = ent.position();
		if (!pos)
		{
			// TODO should support recursive garrisoning. Make a warning for now
			if (ent.isGarrisonHolder() && ent.garrisoned().length)
			{
				aiWarn("Petra warning: support for garrisoned units inside garrisoned holders " +
					"not yet implemented");
			}
			continue;
		}

		// make sure we have not rejected small regions with units (TODO should probably also check with other non-gaia units)
		const gamepos = gameState.ai.accessibility.gamePosToMapPos(pos);
		const index = gamepos[0] + gamepos[1]*gameState.ai.accessibility.width;
		const land = gameState.ai.accessibility.landPassMap[index];
		if (land > 1 && !this.landRegions[land])
			this.landRegions[land] = true;
		const sea = gameState.ai.accessibility.navalPassMap[index];
		if (sea > 1 && !this.navalRegions[sea])
			this.navalRegions[sea] = true;

		// if garrisoned units inside, ungarrison them except if a ship in which case we will make a transport
		// when a construction will start (see createTransportIfNeeded)
		if (ent.isGarrisonHolder() && ent.garrisoned().length && !ent.hasClass("Ship"))
			for (const id of ent.garrisoned())
				ent.unload(id);

		const territorypos = this.territoryMap.gamePosToMapPos(pos);
		const territoryIndex = territorypos[0] + territorypos[1]*this.territoryMap.width;

		this.basesManager.assignEntity(gameState, ent, territoryIndex);
	}
};

/**
 * determine the main land Index (or water index if none)
 * as well as the list of allowed (land andf water) regions
 */
Headquarters.prototype.regionAnalysis = function(gameState)
{
	const accessibility = gameState.ai.accessibility;
	let landIndex;
	let seaIndex;
	const ccEnts = gameState.getOwnStructures().filter(filters.byClass("CivCentre"));
	for (const cc of ccEnts.values())
	{
		const land = accessibility.getAccessValue(cc.position());
		if (land > 1)
		{
			landIndex = land;
			break;
		}
	}
	if (!landIndex)
	{
		const civ = gameState.getPlayerCiv();
		for (const ent of gameState.getOwnEntities().values())
		{
			if (!ent.position() || !ent.hasClass("Unit") && !ent.trainableEntities(civ))
				continue;
			const land = accessibility.getAccessValue(ent.position());
			if (land > 1)
			{
				landIndex = land;
				break;
			}
			const sea = accessibility.getAccessValue(ent.position(), true);
			if (!seaIndex && sea > 1)
				seaIndex = sea;
		}
	}
	if (!landIndex && !seaIndex)
	{
		aiWarn("Petra error: it does not know how to interpret this map");
		return false;
	}

	const passabilityMap = gameState.getPassabilityMap();
	const totalSize = passabilityMap.width * passabilityMap.width;
	const minLandSize = Math.floor(0.1*totalSize);
	const minWaterSize = Math.floor(0.2*totalSize);
	const cellArea = passabilityMap.cellSize * passabilityMap.cellSize;
	for (let i = 0; i < accessibility.regionSize.length; ++i)
	{
		if (landIndex && i == landIndex)
			this.landRegions[i] = true;
		else if (accessibility.regionType[i] === "land" && cellArea*accessibility.regionSize[i] > 320)
		{
			if (landIndex)
			{
				const sea = this.getSeaBetweenIndices(gameState, landIndex, i);
				if (sea && (accessibility.regionSize[i] > minLandSize || accessibility.regionSize[sea] > minWaterSize))
				{
					this.navalMap = true;
					this.landRegions[i] = true;
					this.navalRegions[sea] = true;
				}
			}
			else
			{
				const traject = accessibility.getTrajectToIndex(seaIndex, i);
				if (traject && traject.length === 2)
				{
					this.navalMap = true;
					this.landRegions[i] = true;
					this.navalRegions[seaIndex] = true;
				}
			}
		}
		else if (accessibility.regionType[i] === "water" && accessibility.regionSize[i] > minWaterSize)
		{
			this.navalMap = true;
			this.navalRegions[i] = true;
		}
		else if (accessibility.regionType[i] === "water" && cellArea*accessibility.regionSize[i] > 3600)
			this.navalRegions[i] = true;
	}

	if (this.Config.debug < 3)
		return true;
	for (const region in this.landRegions)
	{
		aiWarn(" >>> zone " + region + " taille " +
			cellArea * gameState.ai.accessibility.regionSize[region]);
	}
	aiWarn(" navalMap " + this.navalMap);
	aiWarn(" landRegions " + uneval(this.landRegions));
	aiWarn(" navalRegions " + uneval(this.navalRegions));
	return true;
};

/**
 * load units and buildings from the config files
 * TODO: change that to something dynamic
 */
Headquarters.prototype.structureAnalysis = function(gameState)
{
	const civref = gameState.playerData.civ;
	const civ = civref in this.Config.buildings ? civref : 'default';
	this.bAdvanced = [];
	for (const building of this.Config.buildings[civ])
		if (gameState.isTemplateAvailable(gameState.applyCiv(building)))
			this.bAdvanced.push(gameState.applyCiv(building));
};

/**
 * build our first base
 * if not enough resource, try first to do a dock
 */
Headquarters.prototype.buildFirstBase = function(gameState)
{
	if (gameState.ai.queues.civilCentre.hasQueuedUnits())
		return;
	let templateName = gameState.applyCiv("structures/{civ}/civil_centre");
	if (gameState.isTemplateDisabled(templateName))
		return;
	let template = gameState.getTemplate(templateName);
	if (!template)
		return;
	const total = gameState.getResources();
	let goal = "civil_centre";
	if (!total.canAfford(new ResourcesManager(template.cost())))
	{
		const totalExpected = gameState.getResources();
		// Check for treasures around available in some maps at startup
		for (const ent of gameState.getOwnUnits().values())
		{
			if (!ent.position())
				continue;
			// If we can get a treasure around, just do it
			if (ent.isIdle())
				gatherTreasure(gameState, ent);
			// Then count the resources from the treasures being collected
			const treasureId = ent.getMetadata(PlayerID, "treasure");
			if (!treasureId)
				continue;
			const treasure = gameState.getEntityById(treasureId);
			if (!treasure)
				continue;
			const types = treasure.treasureResources();
			for (const type in types)
				if (type in totalExpected)
					totalExpected[type] += types[type];
			// If we can collect enough resources from these treasures, wait for them.
			if (totalExpected.canAfford(new ResourcesManager(template.cost())))
				return;
		}

		// not enough resource to build a cc, try with a dock to accumulate resources if none yet
		if (!this.navalManager.docks.filter(filters.byClass("Dock")).hasEntities())
		{
			if (gameState.ai.queues.dock.hasQueuedUnits())
				return;
			templateName = gameState.applyCiv("structures/{civ}/dock");
			if (gameState.isTemplateDisabled(templateName))
				return;
			template = gameState.getTemplate(templateName);
			if (!template || !total.canAfford(new ResourcesManager(template.cost())))
				return;
			goal = "dock";
		}
	}
	if (!this.canBuild(gameState, templateName))
		return;

	// We first choose as startingPoint the point where we have the more units
	const startingPoint = [];
	for (const ent of gameState.getOwnUnits().values())
	{
		if (!ent.hasClass("Worker"))
			continue;
		if (isFastMoving(ent))
			continue;
		let pos = ent.position();
		if (!pos)
		{
			const holder = getHolder(gameState, ent);
			if (!holder || !holder.position())
				continue;
			pos = holder.position();
		}
		const gamepos = gameState.ai.accessibility.gamePosToMapPos(pos);
		const index = gamepos[0] + gamepos[1] * gameState.ai.accessibility.width;
		const land = gameState.ai.accessibility.landPassMap[index];
		const sea = gameState.ai.accessibility.navalPassMap[index];
		let found = false;
		for (const point of startingPoint)
		{
			if (land !== point.land || sea !== point.sea)
				continue;
			if (SquareVectorDistance(point.pos, pos) > 2500)
				continue;
			point.weight += 1;
			found = true;
			break;
		}
		if (!found)
			startingPoint.push({ "pos": pos, "land": land, "sea": sea, "weight": 1 });
	}
	if (!startingPoint.length)
		return;

	let imax = 0;
	for (let i = 1; i < startingPoint.length; ++i)
		if (startingPoint[i].weight > startingPoint[imax].weight)
			imax = i;

	if (goal == "dock")
	{
		const sea = startingPoint[imax].sea > 1 ? startingPoint[imax].sea : undefined;
		gameState.ai.queues.dock.addPlan(new ConstructionPlan(gameState, "structures/{civ}/dock",
			{ "sea": sea, "proximity": startingPoint[imax].pos }));
	}
	else
	{
		gameState.ai.queues.civilCentre.addPlan(new ConstructionPlan(gameState,
			"structures/{civ}/civil_centre",
			{ "base": -1, "resource": "wood", "proximity": startingPoint[imax].pos }));
	}
};

/**
 * set strategy if game without construction:
 *   - if one of our allies has a cc, affect a small fraction of our army for his defense, the rest will attack
 *   - otherwise all units will attack
 */
Headquarters.prototype.dispatchUnits = function(gameState)
{
	const allycc = gameState.getExclusiveAllyEntities().filter(filters.byClass("CivCentre"))
		.toEntityArray();
	if (allycc.length)
	{
		if (this.Config.debug > 1)
		{
			aiWarn(" We have allied cc " + allycc.length + " and " + gameState.getOwnUnits().length +
				" units ");
		}
		const units = gameState.getOwnUnits();
		let num = Math.max(Math.min(Math.round(0.08*(1+this.Config.personality.cooperative)*units.length), 20), 5);
		let num1 = Math.floor(num / 2);
		let num2 = num1;
		// first pass to affect ranged infantry
		units.filter(filters.byClasses(["Infantry+Ranged"])).forEach(ent => {
			if (!num || !num1)
				return;
			if (ent.getMetadata(PlayerID, "allied"))
				return;
			const access = getLandAccess(gameState, ent);
			for (const cc of allycc)
			{
				if (!cc.position() || getLandAccess(gameState, cc) != access)
					continue;
				--num;
				--num1;
				ent.setMetadata(PlayerID, "allied", true);
				const range = 1.5 * cc.footprintRadius();
				ent.moveToRange(cc.position()[0], cc.position()[1], range, range + 5);
				break;
			}
		});
		// second pass to affect melee infantry
		units.filter(filters.byClasses(["Infantry+Melee"])).forEach(ent => {
			if (!num || !num2)
				return;
			if (ent.getMetadata(PlayerID, "allied"))
				return;
			const access = getLandAccess(gameState, ent);
			for (const cc of allycc)
			{
				if (!cc.position() || getLandAccess(gameState, cc) != access)
					continue;
				--num;
				--num2;
				ent.setMetadata(PlayerID, "allied", true);
				const range = 1.5 * cc.footprintRadius();
				ent.moveToRange(cc.position()[0], cc.position()[1], range, range + 5);
				break;
			}
		});
		// and now complete the affectation, including all support units
		units.forEach(ent => {
			if (!num && !ent.hasClass("Support"))
				return;
			if (ent.getMetadata(PlayerID, "allied"))
				return;
			const access = getLandAccess(gameState, ent);
			for (const cc of allycc)
			{
				if (!cc.position() || getLandAccess(gameState, cc) != access)
					continue;
				if (!ent.hasClass("Support"))
					--num;
				ent.setMetadata(PlayerID, "allied", true);
				const range = 1.5 * cc.footprintRadius();
				ent.moveToRange(cc.position()[0], cc.position()[1], range, range + 5);
				break;
			}
		});
	}
};

/**
 * configure our first base expansion
 *   - if on a small island, favor fishing
 *   - count the available wood resource, and allow rushes only if enough (we should otherwise favor expansion)
 */
Headquarters.prototype.configFirstBase = function(gameState)
{
	if (!this.hasPotentialBase())
		return;

	this.firstBaseConfig = true;

	let startingSize = 0;
	const startingLand = [];
	for (const region in this.landRegions)
	{
		for (const base of this.baseManagers())
		{
			if (!base.anchor || base.accessIndex != +region)
				continue;
			startingSize += gameState.ai.accessibility.regionSize[region];
			startingLand.push(base.accessIndex);
			break;
		}
	}
	const cell = gameState.getPassabilityMap().cellSize;
	startingSize = startingSize * cell * cell;
	if (this.Config.debug > 1)
		aiWarn("starting size " + startingSize + "(cut at 24000 for fish pushing)");
	if (startingSize < 25000)
	{
		this.saveSpace = true;
		this.Config.Economy.popForDock = Math.min(this.Config.Economy.popForDock, 16);
		const num = Math.max(this.Config.Economy.targetNumFishers, 2);
		for (const land of startingLand)
		{
			for (const sea of gameState.ai.accessibility.regionLinks[land])
				if (gameState.ai.HQ.navalRegions[sea])
					this.navalManager.updateFishingBoats(sea, num);
		}
		this.maxFields = 1;
		this.needCorral = true;
	}
	else if (startingSize < 60000)
		this.maxFields = 2;
	else
		this.maxFields = false;

	// - count the available food resource, and react accordingly
	let startingFood = gameState.getResources().food;
	startingFood += this.getTotalResourceLevel(gameState, ["food"], ["nearby", "medium", "faraway"]).food;

	if (startingFood < 800)
	{
		if (startingSize < 25000)
		{
			this.needFish = true;
			this.Config.Economy.popForDock = 1;
		}
		else
			this.needFarm = true;
	}
	// - count the available wood resource, and allow rushes only if enough (we should otherwise favor expansion)
	let startingWood = gameState.getResources().wood;
	startingWood += this.getTotalResourceLevel(gameState, ["wood"], ["nearby", "medium", "faraway"]).wood;

	if (this.Config.debug > 1)
	{
		aiWarn("startingWood: " + startingWood +
			" (cut at 8500 for no rush and 6000 for saveResources)");
	}
	if (startingWood < 6000)
	{
		this.saveResources = true;
		this.Config.Economy.popPhase2 = Math.floor(0.75 * this.Config.Economy.popPhase2);	// Switch to town phase sooner to be able to expand

		if (startingWood < 2000 && this.needFarm)
		{
			this.needCorral = true;
			this.needFarm = false;
		}
	}
	if (startingWood > 8500 && this.canBuildUnits)
	{
		let allowed = Math.ceil((startingWood - 8500) / 3000);
		// Not useful to prepare rushing if too long ceasefire
		if (gameState.isCeasefireActive())
		{
			if (gameState.ceasefireTimeRemaining > 900)
				allowed = 0;
			else if (gameState.ceasefireTimeRemaining > 600 && allowed > 1)
				allowed = 1;
		}
		this.attackManager.setRushes(allowed);
	}

	// immediatly build a wood dropsite if possible.
	if (!gameState.getOwnEntitiesByClass("DropsiteWood", true).hasEntities())
	{
		const newDP = this.baseManagers()[0].findBestDropsiteAndLocation(gameState, "wood");
		if (newDP.quality > 40 && this.canBuild(gameState, newDP.templateName))
		{
			// if we start with enough workers, put our available resources in this first dropsite
			// same thing if our pop exceed the allowed one, as we will need several houses
			const numWorkers = gameState.getOwnUnits().filter(filters.byClass("Worker")).length;
			if (numWorkers > 12 && newDP.quality > 60 ||
				gameState.getPopulation() > gameState.getPopulationLimit() + 20)
			{
				const cost = new ResourcesManager(gameState.getTemplate(newDP.templateName).cost());
				gameState.ai.queueManager.setAccounts(gameState, cost, "dropsites");
			}
			gameState.ai.queues.dropsites.addPlan(new ConstructionPlan(gameState, newDP.templateName,
				{ "base": this.baseManagers()[0].ID }, newDP.pos));
		}
	}
	// and build immediately a corral if needed
	if (this.needCorral)
	{
		const template = gameState.applyCiv("structures/{civ}/corral");
		if (!gameState.getOwnEntitiesByClass("Corral", true).hasEntities() &&
			this.canBuild(gameState, template))
		{
			gameState.ai.queues.corral.addPlan(
				new ConstructionPlan(gameState, template, { "base": this.baseManagers()[0].ID }));
		}
	}
};
