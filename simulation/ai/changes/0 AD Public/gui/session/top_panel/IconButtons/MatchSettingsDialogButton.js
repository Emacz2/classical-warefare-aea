/**
 * This class handles the button that displays the active match's settings.
 */
class MatchSettingsDialogButton
{
	constructor(matchSettingsDialog)
	{
		this.button = Engine.GetGUIObjectByName("matchSettingsButton");
		this.button.enabled = !Engine.IsAtlasRunning();
		this.button.onPress = matchSettingsDialog.toggle.bind(matchSettingsDialog);

		registerHotkeyChangeHandler(this.onHotkeyChange.bind(this));
	}

	onHotkeyChange()
	{
		this.button.tooltip =
			colorizeHotkey("%(hotkey)s" + " ", "session.gui.matchsettings.toggle") +
			translate(this.Tooltip);
	}
}

MatchSettingsDialogButton.prototype.Tooltip = markForTranslation("Match Settings");
