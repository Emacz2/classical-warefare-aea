function orderData(ent)
{
	if (!ent || typeof ent.unitAIOrderData !== "function")
		return [];
	return ent.unitAIOrderData() || [];
}

function orderTargets(ent)
{
	return orderData(ent)
		.map(order => order && Number(order.target))
		.filter(Number.isFinite);
}

function unitState(ent)
{
	return ent && typeof ent.unitAIState === "function" ? String(ent.unitAIState() || "") : "";
}

function targetIsQueued(ent, targetId)
{
	const id = Number(targetId);
	return Number.isFinite(id) && orderTargets(ent).includes(id);
}

function hasLiveGatherOrder(ent, targetId)
{
	const state = unitState(ent);
	if (!targetIsQueued(ent, targetId))
		return false;
	return state.includes(".GATHER.") || state.includes(".COMBAT.");
}

function hasLiveRepairOrder(ent, targetId)
{
	const state = unitState(ent);
	if (!targetIsQueued(ent, targetId))
		return false;
	return state.includes(".REPAIR.");
}

function describeLiveOrder(ent)
{
	return {
		state: unitState(ent),
		targets: orderTargets(ent),
		idle: !!(ent && typeof ent.isIdle === "function" && ent.isIdle())
	};
}

function ensureGatherOrder(ent, target)
{
	if (!ent || !target || typeof target.id !== "function")
		throw new Error("ensureGatherOrder requires entity and target");
	const targetId = Number(target.id());
	if (!Number.isFinite(targetId))
		throw new Error("ensureGatherOrder target requires finite id");
	if (hasLiveGatherOrder(ent, targetId))
		return { status: "CONFIRMED", targetId, issued: false };
	if (typeof ent.gather !== "function")
		throw new Error("ensureGatherOrder requires ent.gather(target)");
	ent.gather(target);
	return { status: "ISSUED", targetId, issued: true };
}

function ensureRepairOrder(ent, foundation, autocontinue = false)
{
	if (!ent || !foundation || typeof foundation.id !== "function")
		throw new Error("ensureRepairOrder requires builder and foundation");
	const targetId = Number(foundation.id());
	if (!Number.isFinite(targetId))
		throw new Error("ensureRepairOrder foundation requires finite id");
	if (hasLiveRepairOrder(ent, targetId))
		return { status: "CONFIRMED", targetId, issued: false };
	if (typeof ent.repair !== "function")
		throw new Error("ensureRepairOrder requires ent.repair(foundation, autocontinue)");
	ent.repair(foundation, !!autocontinue);
	return { status: "ISSUED", targetId, issued: true };
}

export { orderData, orderTargets, unitState, targetIsQueued, hasLiveGatherOrder, hasLiveRepairOrder, ensureGatherOrder, ensureRepairOrder, describeLiveOrder };
