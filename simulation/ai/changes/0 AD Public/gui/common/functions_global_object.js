/**
 * Update the overlay with the most recent network warning of each client.
 */
function displayGamestateNotifications()
{
	let messages = [];
	// Add network warnings
	if (Engine.ConfigDB_GetValue("user", "overlay.netwarnings") == "true")
	{
		const netwarnings = getNetworkWarnings();
		messages = messages.concat(netwarnings);
	}

	const gameStateNotifications = Engine.GetGUIObjectByName("gameStateNotifications");
	gameStateNotifications.caption = messages.join("\n");

	const maxTextWidth = gameStateNotifications.getPreferredTextSize().width;
	// Resize textbox
	const width = maxTextWidth + 20;
	const height = 14 * messages.length;

	// Position left of the dataCounter
	const top = "40";
	const right = Engine.GetGUIObjectByName("dataCounter").hidden ? "100%-15" : "100%-110";

	const bottom = top + "+" + height;
	const left = right + "-" + width;

	gameStateNotifications.hidden = !messages.length;
	gameStateNotifications.size = left + " " + top + " " + right + " " + bottom;

	setTimeout(displayGamestateNotifications, 1000);
}

/**
 * This function is called from the engine whenever starting a game fails.
 */
function cancelOnLoadGameError(msg)
{
	Engine.EndGame();

	if (Engine.HasXmppClient())
		Engine.StopXmppClient();

	Engine.SwitchGuiPage("page_pregame.xml");

	if (msg)
		Engine.OpenChildPage("page_msgbox.xml", {
			"width": 500,
			"height": 200,
			"message": msg,
			"title": translate("Loading Aborted"),
			"mode": 2
		});

	Engine.ResetCursor();
}
