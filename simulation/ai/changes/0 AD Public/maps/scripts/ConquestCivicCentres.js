{
	const cmpTrigger = Engine.QueryInterface(SYSTEM_ENTITY, IID_Trigger);
	cmpTrigger.ConquestAddVictoryCondition({
		"classFilter": "CivilCentre+!Foundation",
		"defeatReason": markForTranslation("%(player)s has been defeated (lost all civic centers).")
	});
	cmpTrigger.ConquestAddVictoryCondition({
		"classFilter": "ConquestCritical CivilCentre+!Foundation",
		"defeatReason": markForTranslation("%(player)s has been defeated (lost all civic centers and critical units and structures).")
	});
}
