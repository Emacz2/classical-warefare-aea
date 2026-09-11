function init()
{
	const mainText = Engine.GetGUIObjectByName("mainText");
	const text = Engine.TranslateLines(Engine.ReadFile("gui/manual/intro.txt"));

	const hotkeys = Engine.GetHotkeyMap();

	// Replace anything starting with 'hotkey.' with its hotkey.
	mainText.caption = text.replace(/hotkey.([a-z0-9_.]+)/g, (_, k) => formatHotkeyCombinations(hotkeys[k]));

	return new Promise(closePageCallback => {
		Engine.GetGUIObjectByName("closeButton").onPress = closePageCallback;
	});
}
