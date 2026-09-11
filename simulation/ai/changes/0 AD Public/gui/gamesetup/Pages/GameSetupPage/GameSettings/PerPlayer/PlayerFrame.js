PlayerSettingControls.PlayerFrame = class PlayerFrame extends GameSettingControl
{
	constructor(...args)
	{
		super(...args);

		this.playerFrame = Engine.GetGUIObjectByName("playerFrame[" + this.playerIndex + "]");

		this.playerFrame.size.top = this.Height * this.playerIndex;
		this.playerFrame.size.bottom = this.Height * (this.playerIndex + 1);

		g_GameSettings.playerCount.watch(() => this.render(), ["nbPlayers"]);
		this.render();
	}

	render()
	{
		this.playerFrame.hidden = this.playerIndex >= g_GameSettings.playerCount.nbPlayers;
	}
};

PlayerSettingControls.PlayerFrame.prototype.Height = 32;
