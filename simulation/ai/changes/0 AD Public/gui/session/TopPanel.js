/**
 * This class owns all classes that are part of the top panel.
 */
class TopPanel
{
	constructor(playerViewControl, diplomacyDialog, tradeDialog, matchSettingsDialog, gameSpeedControl)
	{
		this.counterManager = new CounterManager(playerViewControl);
		this.civIcon = new CivIcon(playerViewControl);
		this.buildLabel = new BuildLabel(playerViewControl);

		this.followPlayer = new FollowPlayer(playerViewControl);

		this.diplomacyDialogButton = new DiplomacyDialogButton(playerViewControl, diplomacyDialog);
		this.gameSpeedButton = new GameSpeedButton(gameSpeedControl);
		this.matchSettingsDialogButton = new MatchSettingsDialogButton(matchSettingsDialog);
		this.tradeDialogButton = new TradeDialogButton(playerViewControl, tradeDialog);
	}
}
