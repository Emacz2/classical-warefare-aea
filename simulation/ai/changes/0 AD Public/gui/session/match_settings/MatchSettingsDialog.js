class MatchSettingsDialog
{
	constructor(playerViewControl, mapCache)
	{
		this.gameDescription = Engine.GetGUIObjectByName("gameDescription");
		this.matchSettingsPlayerstate = Engine.GetGUIObjectByName("matchSettingsPlayerstate");
		this.matchSettingsPanel = Engine.GetGUIObjectByName("matchSettingsPanel");
		this.matchSettingsTitle = Engine.GetGUIObjectByName("matchSettingsTitle");

		// TODO: atlas should support this
		if (!Engine.IsAtlasRunning())
			Engine.GetGUIObjectByName("gameDescriptionText").caption = getGameDescription(g_InitAttributes, mapCache);

		Engine.GetGUIObjectByName("matchSettingsCloseButton").onPress = this.close.bind(this);

		registerPlayersInitHandler(this.rebuild.bind(this));
		registerPlayersFinishedHandler(this.rebuild.bind(this));
		playerViewControl.registerPlayerIDChangeHandler(this.rebuild.bind(this));
	}

	open()
	{
		this.matchSettingsPanel.hidden = false;
	}

	close()
	{
		this.matchSettingsPanel.hidden = true;
	}

	isOpen()
	{
		return !this.matchSettingsPanel.hidden;
	}

	toggle()
	{
		const open = this.isOpen();

		closeOpenDialogs();

		if (!open)
			this.open();
	}

	rebuild()
	{
		const player = g_Players[Engine.GetPlayerID()];
		const playerState = player && player.state;
		const isActive = !playerState || playerState == "active";

		this.matchSettingsPlayerstate.hidden = isActive;
		this.matchSettingsPlayerstate.caption = g_PlayerStateMessages[playerState] || "";

		this.gameDescription.size.top = (isActive ? this.matchSettingsTitle : this.matchSettingsPlayerstate).size.bottom;
	}
}
