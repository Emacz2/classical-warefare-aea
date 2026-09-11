GameSettingControls.PlayerPlacement = class PlayerPlacement extends GameSettingControlDropdown
{
	constructor(...args)
	{
		super(...args);
		this.values = undefined;

		g_GameSettings.playerPlacement.watch(() => this.render(), ["value", "available"]);
		this.render();
	}

	onHoverChange()
	{
		this.dropdown.tooltip = this.values.Description[this.dropdown.hovered] || this.Tooltip;
	}

	render()
	{
		this.setHidden(!g_GameSettings.playerPlacement.value);
		if (!g_GameSettings.playerPlacement.value)
			return;

		const randomItem = clone(this.RandomItem);
		randomItem.Name = setStringTags(randomItem.Name, this.RandomItemTags);

		const patterns = [randomItem];

		for (const pattern of g_GameSettings.playerPlacement.available)
			patterns.push(g_Settings.PlayerPlacements
				.find(pObj => pObj.Id == pattern));

		this.values = prepareForDropdown(patterns);

		this.dropdown.list = this.values.Name;
		this.dropdown.list_data = this.values.Id;

		this.setSelectedValue(g_GameSettings.playerPlacement.value);
	}

	getAutocompleteEntries()
	{
		return this.values && this.values.Name.slice(1);
	}

	onSelectionChange(itemIdx)
	{
		g_GameSettings.playerPlacement.setValue(this.values.Id[itemIdx]);
		this.gameSettingsController.setNetworkInitAttributes();
	}
};

GameSettingControls.PlayerPlacement.prototype.TitleCaption =
	translate("Player Placement");

GameSettingControls.PlayerPlacement.prototype.Tooltip =
	translate("Select one of the starting position patterns of this map.");

GameSettingControls.PlayerPlacement.prototype.RandomItem = {
	"Id": "random",
	"Name": translateWithContext("player placement", "Random"),
	"Description": translateWithContext("player placement", "Select a random player placement pattern when starting the game.")
};

GameSettingControls.PlayerPlacement.prototype.AutocompleteOrder = 0;
