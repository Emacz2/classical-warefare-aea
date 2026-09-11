/**
 * If the button that this class manages is pressed, the input state is switched to 'flare', letting the player send a flare by left-clicking on the map.
 */
class MiniMapFlareButton
{
	constructor(playerViewControl)
	{
		this.flareButton = Engine.GetGUIObjectByName("flareButton");

		this.flareButton.enabled = !g_IsReplay;
		if (g_IsReplay)
			return;

		this.flareButton.onPress = this.onPress.bind(this);
		registerHotkeyChangeHandler(this.onHotkeyChange.bind(this));
		playerViewControl.registerViewedPlayerChangeHandler(this.rebuild.bind(this));
	}

	rebuild()
	{
		if (g_IsObserver)
		{
			this.flareButton.sprite = "stretched:session/minimap-observer-flare.png";
			this.flareButton.sprite_over = "stretched:session/minimap-observer-flare-highlight.png";
		}
		else
		{
			this.flareButton.sprite = "stretched:session/minimap-player-flare.png";
			this.flareButton.sprite_over = "stretched:session/minimap-player-flare-highlight.png";
		}
		this.updateTooltip();
	}

	onHotkeyChange()
	{
		this.colorizedHotkey = colorizeHotkey("%(hotkey)s" + " ", "session.flare");
		this.updateTooltip();
	}

	updateTooltip()
	{
		this.flareButton.tooltip = this.colorizedHotkey + (g_IsObserver ? this.ObserverTooltip : this.PlayerTooltip);
	}

	onPress()
	{
		if (inputState == INPUT_NORMAL)
			inputState = INPUT_FLARE;
	}
}

MiniMapFlareButton.prototype.PlayerTooltip = markForTranslation("Send a flare to your allies.");
MiniMapFlareButton.prototype.ObserverTooltip = markForTranslation("Send a flare to other observers.");
