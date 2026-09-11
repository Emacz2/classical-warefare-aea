class ResetTeamsButton
{
	constructor(setupWindow, isSavedGame)
	{
		this.gameSettingsController = setupWindow.controls.gameSettingsController;

		this.teamResetButton = Engine.GetGUIObjectByName("teamResetButton");
		this.teamResetButton.tooltip = this.Tooltip;
		this.teamResetButton.onPress = this.onPress.bind(this);

		if (isSavedGame)
			this.teamResetButton.hidden = true;
		else
			g_GameSettings.map.watch(() => this.render(), ["type"]);
	}

	render()
	{
		this.teamResetButton.hidden = g_GameSettings.map.type === "scenario" || !g_IsController;
	}

	onPress()
	{
		for (let i = 0; i < g_GameSettings.playerCount.nbPlayers; ++i)
			g_GameSettings.playerTeam.setValue(i, -1);

		this.gameSettingsController.setNetworkInitAttributes();
	}
}

ResetTeamsButton.prototype.Tooltip =
	translate("Reset all teams to the default.");
