/**
 * This class sets up the main menu buttons, animates submenu that opens when
 * clicking on category buttons, assigns the defined actions and hotkeys to every button.
 */
export class MainMenuItemHandler
{
	constructor(closePageCallback, menuItems)
	{
		this.closePageCallback = closePageCallback;
		this.menuItems = menuItems;
		this.lastTickTime = Date.now();

		this.lastOpenItem = undefined;

		this.mainMenu = Engine.GetGUIObjectByName("mainMenu");
		this.mainMenuButtons = Engine.GetGUIObjectByName("mainMenuButtons");
		this.submenu = Engine.GetGUIObjectByName("submenu");
		this.submenuButtons = Engine.GetGUIObjectByName("submenuButtons");
		this.MainMenuPanelRightBorderTop = Engine.GetGUIObjectByName("MainMenuPanelRightBorderTop");
		this.MainMenuPanelRightBorderBottom = Engine.GetGUIObjectByName("MainMenuPanelRightBorderBottom");

		this.setupMenuButtons(this.mainMenuButtons.children, this.menuItems);
		this.setupHotkeys(this.menuItems);

		Engine.GetGUIObjectByName("closeMenuButton").onPress = this.closeSubmenu.bind(this);
	}

	setupMenuButtons(buttons, menuItems)
	{
		buttons.forEach((button, i) => {
			const item = menuItems[i];
			button.hidden = !item;
			if (button.hidden)
				return;

			button.size = {
				"top": (this.ButtonHeight + this.Margin) * i,
				"bottom": (this.ButtonHeight + this.Margin) * i + this.ButtonHeight,
				"rright": 100
			};
			button.caption = item.caption;
			button.tooltip = item.tooltip;
			button.enabled = item.enabled === undefined || item.enabled();
			button.onPress = this.pressButton.bind(this, item, i);
			button.hidden = false;
		});

		if (buttons.length < menuItems.length)
			error("GUI page has space for " + buttons.length + " menu buttons, but " + menuItems.length + " items are provided!");
	}

	/**
	 * Expand selected submenu, or collapse if it already is expanded.
	 */
	pressButton(item, i)
	{
		if (this.submenu.hidden)
		{
			this.performButtonAction(item, i);
		}
		else
		{
			this.closeSubmenu();
			if (this.lastOpenItem && this.lastOpenItem != item)
				this.performButtonAction(item, i);
			else
				this.lastOpenItem = undefined;
		}
	}

	/**
	 * Expand submenu or perform action specified by the button object.
	 */
	performButtonAction(item, i)
	{
		this.lastOpenItem = item;

		if (item.onPress)
			item.onPress(this.closePageCallback);
		else
			this.openSubmenu(i);
	}

	setupHotkeys(menuItems)
	{
		for (const i in menuItems)
		{
			const item = menuItems[i];
			if (item.onPress && item.hotkey)
				Engine.SetGlobalHotkey(item.hotkey, "Press", () => {
					this.closeSubmenu();
					item.onPress();
				});

			if (item.submenu)
				this.setupHotkeys(item.submenu);
		}
	}

	openSubmenu(i)
	{
		this.setupMenuButtons(this.submenuButtons.children, this.menuItems[i].submenu);

		const top = this.mainMenuButtons.children[i].getComputedSize().top;

		this.submenu.size = {
			"left": this.submenu.size.left,
			"right": this.mainMenu.size.right,
			"top": top - this.Margin,
			"bottom": top + (this.ButtonHeight + this.Margin) * this.menuItems[i].submenu.length
		};

		this.submenu.hidden = false;

		this.MainMenuPanelRightBorderTop.size.bottom = this.submenu.size.top + this.Margin;
		this.MainMenuPanelRightBorderTop.size.rbottom = 0;
		this.MainMenuPanelRightBorderBottom.size.top = this.submenu.size.bottom;

		// Start animation
		this.lastTickTime = Date.now();
		this.mainMenu.onTick = this.onTick.bind(this);
	}

	closeSubmenu()
	{
		this.submenu.hidden = true;
		this.submenu.size = this.mainMenu.size;

		Object.assign(this.MainMenuPanelRightBorderTop.size, {
			"top": 0,
			"bottom": 0,
			"rbottom": 100
		});
	}

	onTick()
	{
		const now = Date.now();
		if (now == this.lastTickTime)
			return;

		const maxOffset = this.mainMenu.size.right - this.submenu.size.left;
		const offset = Math.min(this.MenuSpeed * (now - this.lastTickTime), maxOffset);

		this.lastTickTime = now;

		if (this.submenu.hidden || !offset)
		{
			delete this.mainMenu.onTick;
			return;
		}

		this.submenu.size.left += offset;
		this.submenu.size.right += offset;
	}
}

/**
 * Vertical size per button.
 */
MainMenuItemHandler.prototype.ButtonHeight = 28;

/**
 * Distance between consecutive buttons.
 */
MainMenuItemHandler.prototype.Margin = 4;

/**
 * Collapse / expansion speed in pixels per milliseconds used when animating the button menu size.
 */
MainMenuItemHandler.prototype.MenuSpeed = 1.2;
