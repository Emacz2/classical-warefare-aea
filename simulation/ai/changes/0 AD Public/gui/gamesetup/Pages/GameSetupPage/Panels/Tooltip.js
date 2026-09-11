class Tooltip
{
	constructor()
	{
		this.onScreenTooltip = Engine.GetGUIObjectByName("onscreenToolTip");
		this.gameSettingWarning = Engine.GetGUIObjectByName("gameSettingWarning");
		this.bottomRightPanel = Engine.GetGUIObjectByName("bottomRightPanel");

		g_GameSettings.cheats.watch(() => this.onSettingsChange(), ["enabled"]);
		g_GameSettings.rating.watch(() => this.onSettingsChange(), ["enabled"]);
		this.onSettingsChange();
	}

	onSettingsChange()
	{
		const marginRight = 8;
		const neighborElement = !g_IsNetworked ? this.bottomRightPanel : this.gameSettingWarning.parent;

		Object.assign(this.onScreenTooltip.parent.size, {
			"right": neighborElement.size.left - marginRight,
			"rleft": this.onScreenTooltip.size.rleft,
			"rright": neighborElement.size.rleft,
		});
	}
}
