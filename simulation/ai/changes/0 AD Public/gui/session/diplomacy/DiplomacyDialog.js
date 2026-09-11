/**
 * This class is concerned with opening, closing and resizing the diplomacy dialog and
 * relaying events to the classes that update individual elements of the dialog.
 */
class DiplomacyDialog
{
	constructor(playerViewControl, diplomacyColors)
	{
		this.diplomacyDialogCeasefireCounter = new DiplomacyDialogCeasefireCounter();
		this.diplomacyDialogColorsButton = new DiplomacyDialogColorsButton(diplomacyColors);
		this.diplomacyDialogPlayerControlManager = undefined;

		this.diplomacyDialogPanel = Engine.GetGUIObjectByName("diplomacyDialogPanel");
		Engine.GetGUIObjectByName("diplomacyClose").onPress = this.close.bind(this);

		registerPlayersInitHandler(this.onPlayersInit.bind(this));
		registerSimulationUpdateHandler(this.onViewedPlayerChange.bind(this));
		playerViewControl.registerViewedPlayerChangeHandler(this.updateIfOpen.bind(this));
	}

	onPlayersInit()
	{
		this.diplomacyDialogPlayerControlManager = new DiplomacyDialogPlayerControlManager();
		this.resize();
	}

	onViewedPlayerChange()
	{
		if (g_ViewedPlayer >= 1)
			this.updateIfOpen();
		else
			this.close();
	}

	onSpyResponse(notification, player)
	{
		this.diplomacyDialogPlayerControlManager.onSpyResponse(notification, player);
	}

	updateIfOpen()
	{
		if (this.isOpen())
			this.updatePanels();
	}

	updatePanels()
	{
		this.diplomacyDialogCeasefireCounter.update();
		this.diplomacyDialogPlayerControlManager.update();
	}

	open()
	{
		closeOpenDialogs();

		if (g_ViewedPlayer < 1)
			return;

		this.updatePanels();
		this.diplomacyDialogPanel.hidden = false;
	}

	close()
	{
		this.diplomacyDialogPanel.hidden = true;
	}

	isOpen()
	{
		return !this.diplomacyDialogPanel.hidden;
	}

	toggle()
	{
		const open = this.isOpen();

		closeOpenDialogs();

		if (!open)
			this.open();
	}

	resize()
	{
		const widthOffset = DiplomacyDialogPlayerControl.prototype.TributeButtonManager.getWidthOffset() / 2;
		const heightOffset = DiplomacyDialogPlayerControl.prototype.DiplomacyPlayerText.getHeightOffset() / 2;

		this.diplomacyDialogPanel.size.left -= widthOffset;
		this.diplomacyDialogPanel.size.right += widthOffset;
		this.diplomacyDialogPanel.size.top -= heightOffset;
		this.diplomacyDialogPanel.size.bottom += heightOffset;
	}
}
