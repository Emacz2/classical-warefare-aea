export async function init(data)
{
	const paragraphObjects = Engine.GetGUIObjectByName("paragraphs").children;

	const iconSize = 32;
	const iconMargin = 15;
	const textIndent = iconMargin * 2 + iconSize - 5;
	const paragraphSpacing = 20;
	let verticalOffset = paragraphSpacing * 3;

	for (const paragraphObject of paragraphObjects)
	{
		const text = paragraphObject.children.find(object => object.toString().startsWith("text"));
		const icon = paragraphObject.children.find(object => object.toString().startsWith("icon"));

		text.size = {
			"left": textIndent,
			"top": verticalOffset,
			"right": -10,
			"bottom": 0,
			"rleft": 0,
			"rtop": 0,
			"rright": 100,
			"rbottom": 100
		};
		const paragraphHeight = Math.max(text.getTextSize().height, iconSize);
		const sizeTop = Math.min(verticalOffset + 5, verticalOffset + paragraphHeight / 2 - iconSize / 2);
		icon.size = {
			"left": iconMargin,
			"top": sizeTop,
			"right": iconMargin + iconSize,
			"bottom": sizeTop + iconSize
		};
		verticalOffset += paragraphHeight + paragraphSpacing;
	}

	Engine.GetGUIObjectByName("displaySplashScreen").checked = Engine.ConfigDB_GetValue("user", "gui.splashscreen.enable") === "true";

	await new Promise(resolve => {
		Engine.GetGUIObjectByName("btnOK").onPress = resolve;
	});

	Engine.ConfigDB_CreateValue("user", "gui.splashscreen.enable", String(Engine.GetGUIObjectByName("displaySplashScreen").checked));
	Engine.ConfigDB_CreateValue("user", "gui.splashscreen.version", Engine.CalculateMD5(Engine.ReadFile("gui/splashscreen/splashscreen.xml")));
	Engine.ConfigDB_SaveChanges("user");
}
