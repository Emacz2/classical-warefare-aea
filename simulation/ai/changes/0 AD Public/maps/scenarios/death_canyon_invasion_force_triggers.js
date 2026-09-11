Trigger.prototype.DisableBuilding = function()
{
	const cmpModifiersManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_ModifiersManager);

	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);

	let playerEnt = cmpPlayerManager.GetPlayerByID(2);
	cmpModifiersManager.AddModifiers("no_building", {
		"Builder/Entities/_string": [{ "affects": ["Unit"], "replace": "" }],
	}, playerEnt);

	playerEnt = cmpPlayerManager.GetPlayerByID(4);
	cmpModifiersManager.AddModifiers("no_building", {
		"Builder/Entities/_string": [{ "affects": ["Unit"], "replace": "" }],
	}, playerEnt);
};

{
	const cmpTrigger = Engine.QueryInterface(SYSTEM_ENTITY, IID_Trigger);
	cmpTrigger.RegisterTrigger("OnInitGame", "DisableBuilding", { "enabled": true });
}
