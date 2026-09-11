PlayerSettingControls.AIConfigButton = class AIConfigButton extends GameSettingControl
{
	constructor(...args)
	{
		super(...args);

		this.aiConfigButton = Engine.GetGUIObjectByName("aiConfigButton[" + this.playerIndex + "]");
		this.aiConfigButton.onPress = () => {
			this.setupWindow.pages.AIConfigPage.openPage(this.playerIndex, this.enabled);
		};

		g_GameSettings.playerAI.watch(() => this.render(), ["values"]);
		// Save little performance by not reallocating every call
		this.sprintfArgs = {};
		this.render();
	}

	render()
	{
		this.aiConfigButton.hidden = !g_GameSettings.playerAI.get(this.playerIndex);
		if (this.aiConfigButton.hidden)
			return;
		this.sprintfArgs.description = g_GameSettings.playerAI.describe(this.playerIndex);
		this.aiConfigButton.tooltip = sprintf(this.Tooltip, this.sprintfArgs);
	}
};

PlayerSettingControls.AIConfigButton.prototype.Tooltip =
	translate("Configure AI: %(description)s.");
