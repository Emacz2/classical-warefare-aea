import { aiWarn } from "simulation/ai/common-api/utils.js";
import { ConstructionPlan } from "simulation/ai/petra/queueplanBuilding.js";

/**
 * Exact-position construction plan used only by the tested Expert Decision layer.
 * Strategic placement and builder selection have already happened before this plan
 * reaches Petra's queue.  The plan therefore fails closed instead of falling back
 * to Petra's generic builder/placement search.
 */
export function ExpertFixedConstructionPlan(gameState, type, metadata, position, angle = 3 * Math.PI / 4)
{
	if (!ConstructionPlan.call(this, gameState, type, metadata, position))
		return false;
	this.expertFixedAngle = angle;
	return true;
}

ExpertFixedConstructionPlan.prototype = Object.create(ConstructionPlan.prototype);
ExpertFixedConstructionPlan.prototype.constructor = ExpertFixedConstructionPlan;

ExpertFixedConstructionPlan.prototype.findGoodPosition = function(gameState)
{
	if (!Array.isArray(this.position) || this.position.length != 2 || !this.position.every(Number.isFinite))
		return false;
	return {
		"x": this.position[0],
		"z": this.position[1],
		"angle": Number.isFinite(this.expertFixedAngle) ? this.expertFixedAngle : 3 * Math.PI / 4,
		"base": this.metadata && this.metadata.base
	};
};

ExpertFixedConstructionPlan.prototype.getExplicitBuilder = function(gameState)
{
	if (!this.metadata || !Number.isFinite(Number(this.metadata.expertBuilderId)))
		return undefined;
	const builder = gameState.getEntityById(Number(this.metadata.expertBuilderId));
	if (!builder || !builder.position || !builder.position() || !builder.isBuilder || !builder.isBuilder())
		return undefined;
	const carrying = builder.resourceCarrying ? builder.resourceCarrying() || [] : [];
	if (carrying.some(item => item && Number(item.amount) > 0))
		return undefined;
	return builder;
};

ExpertFixedConstructionPlan.prototype.canStart = function(gameState)
{
	if (!ConstructionPlan.prototype.canStart.call(this, gameState))
		return false;
	return !!this.getExplicitBuilder(gameState);
};

ExpertFixedConstructionPlan.prototype.start = function(gameState)
{
	Engine.ProfileStart("Expert fixed building construction start");
	const builder = this.getExplicitBuilder(gameState);
	const pos = this.findGoodPosition(gameState);
	if (!builder || !pos)
	{
		aiWarn("Expert Decision construction refused: explicit builder/position unavailable for " + this.type);
		Engine.ProfileStop();
		return;
	}

	gameState.ai.HQ.turnCache.buildingBuilt = true;
	if (this.metadata === undefined)
		this.metadata = {};
	if (this.metadata.base === undefined)
	{
		const base = gameState.ai.HQ.baseManagers().find(candidate =>
			candidate.anchor && candidate.anchor.position && candidate.anchor.position() &&
			candidate.accessIndex == gameState.ai.accessibility.getAccessValue(this.position));
		this.metadata.base = base ? base.ID : 0;
	}
	this.metadata.access = gameState.ai.accessibility.getAccessValue(this.position);

	// Queue/runtime builder selectors are not simulation task metadata.
	const commandMetadata = {};
	for (const key in this.metadata)
		if (key !== "expertBuilderId" && key !== "expertBuilderPool")
			commandMetadata[key] = this.metadata[key];

	builder.construct(this.type, pos.x, pos.z, pos.angle, commandMetadata);
	this.onStart(gameState);
	Engine.ProfileStop();
};

ExpertFixedConstructionPlan.prototype.Serialize = function()
{
	const data = ConstructionPlan.prototype.Serialize.call(this);
	data.expertFixedConstruction = true;
	data.expertFixedAngle = this.expertFixedAngle;
	return data;
};

ExpertFixedConstructionPlan.prototype.Deserialize = function(gameState, data)
{
	ConstructionPlan.prototype.Deserialize.call(this, gameState, data);
	this.expertFixedAngle = Number.isFinite(data.expertFixedAngle) ? data.expertFixedAngle : 3 * Math.PI / 4;
};
