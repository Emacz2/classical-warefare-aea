/**
 * Each property of this class is a class that inherits GameSettingControl and is
 * instantiated by the GameSettingControlManager.
 */
class GameSettingControls
{
}

/**
 * The GameSettingControlManager owns all GUI controls.
 */
class GameSettingControlManager
{
	constructor(setupWindow, isSavedGame)
	{
		this.setupWindow = setupWindow;

		this.rows = {};
		this.gameSettingControls = {};

		const getCategory = name =>
			g_GameSettingsLayout.findIndex(category => category.settings.indexOf(name) != -1);

		for (const name in GameSettingControls)
			this.gameSettingControls[name] =
				new GameSettingControls[name](
					this, getCategory(name), undefined, setupWindow, isSavedGame);

		for (const victoryCondition of g_VictoryConditions)
			this.gameSettingControls[victoryCondition.Name] =
				new VictoryConditionCheckbox(
					victoryCondition, this, getCategory(victoryCondition.Name), undefined,
					setupWindow, isSavedGame);

		this.playerSettingControlManagers = Array.from(
			new Array(g_MaxPlayers),
			(value, playerIndex) =>
				new PlayerSettingControlManager(playerIndex, setupWindow, isSavedGame));
	}

	getNextRow(name)
	{
		if (this.rows[name] === undefined)
			this.rows[name] = 0;
		else
			++this.rows[name];

		return this.rows[name];
	}

	updateSettingVisibility()
	{
		for (const name in this.gameSettingControls)
			this.gameSettingControls[name].updateVisibility();
	}

	addAutocompleteEntries(entries)
	{
		for (const name in this.gameSettingControls)
			this.gameSettingControls[name].addAutocompleteEntries(name, entries);

		for (const playerSettingControlManager of this.playerSettingControlManagers)
			playerSettingControlManager.addAutocompleteEntries(entries);
	}
}
