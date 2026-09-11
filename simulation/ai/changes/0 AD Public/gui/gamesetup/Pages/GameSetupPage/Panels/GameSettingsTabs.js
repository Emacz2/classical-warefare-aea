class GameSettingTabs
{
	constructor(setupWindow, lobbyButton)
	{
		this.lobbyButton = lobbyButton;

		this.tabSelectHandlers = new Set();
		this.tabsResizeHandlers = new Set();

		this.settingsTabButtonsFrame = Engine.GetGUIObjectByName("settingTabButtonsFrame");

		for (const tab in g_GameSettingsLayout)
			g_GameSettingsLayout[tab].tooltip = sprintf(this.ToggleTooltip, { "name": g_GameSettingsLayout[tab].label });

		setupWindow.registerLoadHandler(this.onLoad.bind(this));
		Engine.SetGlobalHotkey("cancel", "Press", selectPanel);
	}

	registerTabsResizeHandler(handler)
	{
		this.tabsResizeHandlers.add(handler);
	}

	registerTabSelectHandler(handler)
	{
		this.tabSelectHandlers.add(handler);
	}

	onLoad()
	{
		placeTabButtons(
			g_GameSettingsLayout,
			false,
			this.TabButtonHeight,
			this.TabButtonMargin,
			this.onTabPress.bind(this),
			this.onTabSelect.bind(this));

		this.resize();

		if (!g_IsController)
			selectPanel();
	}

	resize()
	{
		this.settingsTabButtonsFrame.size.bottom =
			this.settingsTabButtonsFrame.size.top +
			g_GameSettingsLayout.length * (this.TabButtonHeight + this.TabButtonMargin);

		if (!this.lobbyButton.lobbyButton.hidden)
		{
			const lobbyButtonSize = this.lobbyButton.lobbyButton.parent.size;
			this.settingsTabButtonsFrame.size.right -= lobbyButtonSize.right - lobbyButtonSize.left + this.LobbyButtonMargin;
		}

		for (const handler of this.tabsResizeHandlers)
			handler(this.settingsTabButtonsFrame);
	}

	onTabPress(category)
	{
		selectPanel(category == g_TabCategorySelected ? undefined : category);
	}

	onTabSelect()
	{
		for (const handler of this.tabSelectHandlers)
			handler();
	}
}

GameSettingTabs.prototype.ToggleTooltip =
	translate("Click to toggle the %(name)s settings tab.");

GameSettingTabs.prototype.TabButtonHeight = 34;

GameSettingTabs.prototype.TabButtonMargin = 4;

/**
 * Horizontal space between tab buttons and lobby button.
 */
GameSettingTabs.prototype.LobbyButtonMargin = 8;
