Engine.LoadComponentScript("interfaces/BuildRestrictions.js");
Engine.LoadComponentScript("BuildRestrictions.js");

{
	const entity = 10;
	const QueryOwnerInterface = () => ({
		"GetPlayerID": () => 1,
		"IsAI": () => false
	});
	Engine.RegisterGlobal("QueryOwnerInterface", QueryOwnerInterface);
	const cmpBuildRestrictions = ConstructComponent(entity, "BuildRestrictions", {
		"PlacementType": "land"
	});

	AddMock(SYSTEM_ENTITY, IID_RangeManager, {
		"GetLosVisibility": (_, __) => "visible",
		"GetEntitiesByPlayer": () => []
	});

	AddMock(entity, IID_Ownership, {
		"GetOwner": () => 1
	});

	AddMock(entity, IID_Obstruction, {
		"CheckFoundation": () => "fail_obstructs_foundation"
	});

	const result = cmpBuildRestrictions.CheckPlacement();
	TS_ASSERT_EQUALS(result.success, false);
}
