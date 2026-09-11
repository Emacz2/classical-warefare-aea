GameSettingControls.PopulationCapType = class PopulationCapType extends GameSettingControlDropdown
{
	constructor(...args)
	{
		super(...args);

		this.dropdown.list = g_PopulationCapacities.Title;
		this.dropdown.list_data = g_PopulationCapacities.Name;

		g_GameSettings.population.watch(() => this.render(), ["capType"]);
		g_GameSettings.map.watch(() => this.render(), ["type"]);

		this.render();
	}

	render()
	{
		this.setSelectedValue(g_GameSettings.population.capType);
		this.setEnabled(g_GameSettings.map.type != "scenario");
	}

	onHoverChange()
	{
		this.dropdown.tooltip = g_PopulationCapacities.Tooltip[this.dropdown.hovered] || this.Tooltip;
	}

	onSelectionChange(itemIdx)
	{
		g_GameSettings.population.setPopCapType(g_PopulationCapacities.Name[itemIdx]);
		this.gameSettingsController.setNetworkInitAttributes();
	}
};

GameSettingControls.PopulationCapType.prototype.TitleCaption =
	translate("Population Cap Type");

GameSettingControls.PopulationCapType.prototype.Tooltip =
	translate("Select a population capacity type.");
