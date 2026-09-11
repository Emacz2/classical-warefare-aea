GameSettingControls.GameSpeed = class GameSpeed extends GameSettingControlDropdown
{
	constructor(...args)
	{
		super(...args);

		this.previousAllowFastForward = undefined;

		g_GameSettings.gameSpeed.watch(() => this.render(), ["gameSpeed"]);
		this.render();
	}

	onLoad()
	{
		// We may need to reset after deserializing attributes.
		this.previousAllowFastForward = undefined;
		this.render();
	}

	onPlayerAssignmentsChange()
	{
		this.render();
	}

	render()
	{
		let allowFastForward = true;
		for (const guid in g_PlayerAssignments)
			if (g_PlayerAssignments[guid].player != -1)
			{
				allowFastForward = false;
				break;
			}

		if (this.previousAllowFastForward === allowFastForward)
		{
			this.setSelectedValue(g_GameSettings.gameSpeed.gameSpeed);
			return;
		}
		this.previousAllowFastForward = allowFastForward;
		const values = prepareForDropdown(
			g_Settings.GameSpeeds.filter(speed => !speed.FastForward || allowFastForward));
		const currentSpeed = +this.dropdown.list_data?.[this.dropdown.selected];
		const resetToDefault = values.Speed.indexOf(currentSpeed) === -1;

		this.dropdown.list = values.Title;
		this.dropdown.list_data = values.Speed;

		if (resetToDefault)
			g_GameSettings.gameSpeed.setSpeed(this.dropdown.list_data[values.Default]);
	}

	onSelectionChange(itemIdx)
	{
		g_GameSettings.gameSpeed.setSpeed(this.dropdown.list_data[itemIdx]);
		this.gameSettingsController.setNetworkInitAttributes();
	}
};

GameSettingControls.GameSpeed.prototype.TitleCaption =
	translate("Game Speed");

GameSettingControls.GameSpeed.prototype.Tooltip =
	translate("Select game speed.");
