class CampaignSession
{
	constructor(data, closePageCallback)
	{
		this.run = new CampaignRun(data.run).load();
		registerPlayersFinishedHandler(this.onFinish.bind(this, closePageCallback));
		this.endGameData = {
			"won": false,
			"initData": data,
			"custom": {}
		};
	}

	onFinish(closePageCallback, players, won)
	{
		const playerID = Engine.GetPlayerID();
		if (players.indexOf(playerID) === -1)
			return;

		this.endGameData.custom = Engine.GuiInterfaceCall("GetCampaignGameEndData", {
			"player": playerID
		});
		this.endGameData.won = won;

		// Run the endgame script.
		Engine.OpenChildPage(this.getEndGame(), this.endGameData);
		closePageCallback();
	}

	getMenu()
	{
		return this.run.getMenuPath();
	}

	getEndGame()
	{
		return this.run.getEndGamePath();
	}
}

var g_CampaignSession;
