var elephantinePlayerID = 0;

Trigger.prototype.InitElephantine = function()
{
	this.InitElephantine_DefenderStance();
	this.InitElephantine_GarrisonBuildings();
};

Trigger.prototype.InitElephantine_DefenderStance = function()
{
	for (const ent of TriggerHelper.GetPlayerEntitiesByClass(elephantinePlayerID, "Soldier"))
		TriggerHelper.SetUnitStance(ent, "defensive");
};

Trigger.prototype.InitElephantine_GarrisonBuildings = function()
{
	const kushInfantryUnits = TriggerHelper.GetTemplateNamesByClasses("CitizenSoldier+Infantry", "kush", undefined, "Elite", true);
	const kushSupportUnits = TriggerHelper.GetTemplateNamesByClasses("Civilian Healer", "kush", undefined, "Elite", true);

	TriggerHelper.SpawnAndGarrisonAtClasses(elephantinePlayerID, "Tower", kushInfantryUnits, 1);
	TriggerHelper.SpawnAndGarrisonAtClasses(elephantinePlayerID, "Wonder Temple Pyramid", kushInfantryUnits.concat(kushSupportUnits), 1);
};

{
	Engine.QueryInterface(SYSTEM_ENTITY, IID_Trigger).RegisterTrigger("OnInitGame", "InitElephantine", { "enabled": true });
}
