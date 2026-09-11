class AutoStartClient
{
	constructor(cmdLineArgs)
	{
		this.playerAssignments = {};

		try
		{
			const playerName = cmdLineArgs['autostart-playername'] || "anonymous";
			const ip = cmdLineArgs['autostart-client'] ?? "127.0.0.1";
			const port = +(cmdLineArgs['autostart-port'] ?? 5073);
			Engine.StartNetworkJoin(playerName, ip, port, !('autostart-disable-replay' in cmdLineArgs));
		}
		catch (e)
		{
			const message = sprintf(translate("Cannot join game: %(message)s."), { "message": e.message });
			messageBox(400, 200, message, translate("Error"));
		}
	}

	onTick()
	{
		while (true)
		{
			const message = Engine.PollNetworkClient();
			if (!message)
				break;

			switch (message.type)
			{
			case "players":
				this.playerAssignments = message.newAssignments;
				Engine.SendNetworkReady(2);
				break;
			case "start":
				this.onLaunch(message);
				// Process further pending netmessages in the session page.
				return true;
			default:
			}
		}
		return false;
	}

	/**
	 * In the visual autostart path, we need to show the loading screen.
	 * Overload this as appropriate, the default implementation works for the public mod.
	 */
	onLaunch(message)
	{
		Engine.SwitchGuiPage("page_loading.xml", {
			"attribs": message.initAttributes,
			"isRejoining": true,
			"playerAssignments": this.playerAssignments
		});
	}
}
