class GameSettingWarning
{
	constructor(setupWindow, cancelButton)
	{
		if (!g_IsNetworked)
			return;

		this.bottomRightPanel = Engine.GetGUIObjectByName("bottomRightPanel");
		this.gameSettingWarning = Engine.GetGUIObjectByName("gameSettingWarning");
		this.savedGameLabel = Engine.GetGUIObjectByName("savedGameLabel");

		g_GameSettings.cheats.watch(() => this.onSettingsChange(), ["enabled"]);
		g_GameSettings.rating.watch(() => this.onSettingsChange(), ["enabled"]);
		this.onSettingsChange();
	}

	onSettingsChange()
	{
		const maxWidth = this.savedGameLabel.hidden ? 260 : 180;
		const marginRight = 8;

		const caption =
			g_GameSettings.cheats.enabled ?
				this.CheatsEnabled :
				g_GameSettings.rating.enabled ?
					this.RatingEnabled :
					"";

		this.gameSettingWarning.caption = caption;

		const labelWidth = Math.min(this.gameSettingWarning.getPreferredTextSize().width + 10, maxWidth);

		const neighborElement = !this.savedGameLabel.hidden ? this.savedGameLabel.parent : this.bottomRightPanel;
		this.gameSettingWarning.parent.size = {
			"left": neighborElement.size.left - labelWidth - marginRight,
			"top": this.gameSettingWarning.parent.size.top,
			"right": neighborElement.size.left - marginRight,
			"bottom": this.gameSettingWarning.parent.size.bottom,
			"rleft": neighborElement.size.rleft,
			"rtop": this.gameSettingWarning.parent.size.rtop,
			"rright": neighborElement.size.rright,
			"rbottom": this.gameSettingWarning.parent.size.rbottom
		};
		this.gameSettingWarning.hidden = !caption;
	}
}

GameSettingWarning.prototype.CheatsEnabled =
	translate("Cheats enabled.");

GameSettingWarning.prototype.RatingEnabled =
	translate("Rated game.");
