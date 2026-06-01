function init()
{
	let mainText = Engine.GetGUIObjectByName("mainText");
	let text = Engine.TranslateLines(Engine.ReadFile("gui/infomenu/info.txt"));

	mainText.caption = text;

	return new Promise(closePageCallback => {
		Engine.GetGUIObjectByName("closeButton").onPress = closePageCallback;
	});
}
