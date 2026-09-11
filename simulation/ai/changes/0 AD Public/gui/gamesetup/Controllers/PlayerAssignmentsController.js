/**
 * This class provides a property independent interface to g_PlayerAssignment events and actions.
 */
class PlayerAssignmentsController
{
	constructor(setupWindow, netMessages, isSavedGame)
	{
		this.clientJoinHandlers = new Set();
		this.clientLeaveHandlers = new Set();
		this.playerAssignmentsChangeHandlers = new Set();

		if (!g_IsNetworked)
		{
			const name = singleplayerName();

			// Replace empty player name when entering a single-player match for the first time.
			Engine.ConfigDB_CreateAndSaveValue("user", this.ConfigNameSingleplayer, name);

			// By default, assign the player to the first slot.
			g_PlayerAssignments = {
				"local": {
					"name": name,
					"player": 1
				}
			};
		}

		// Keep a list of last assigned slot for each player, so we can try to re-assign them
		// if they disconnect/rejoin.
		this.lastAssigned = {};

		g_GameSettings.playerCount.watch(() => this.unassignInvalidPlayers(), ["nbPlayers"]);

		setupWindow.registerLoadHandler(this.onLoad.bind(this));
		setupWindow.registerGetHotloadDataHandler(this.onGetHotloadData.bind(this));
		netMessages.registerNetMessageHandler("players", this.onPlayerAssignmentMessage.bind(this));

		this.registerClientJoinHandler(this.onClientJoin.bind(this, isSavedGame));
	}

	registerPlayerAssignmentsChangeHandler(handler)
	{
		this.playerAssignmentsChangeHandlers.add(handler);
	}

	unregisterPlayerAssignmentsChangeHandler(handler)
	{
		this.playerAssignmentsChangeHandlers.delete(handler);
	}

	registerClientJoinHandler(handler)
	{
		this.clientJoinHandlers.add(handler);
	}

	unregisterClientJoinHandler(handler)
	{
		this.clientJoinHandlers.delete(handler);
	}

	registerClientLeaveHandler(handler)
	{
		this.clientLeaveHandlers.add(handler);
	}

	unregisterClientLeaveHandler(handler)
	{
		this.clientLeaveHandlers.delete(handler);
	}

	onLoad(initData, hotloadData)
	{
		if (hotloadData)
		{
			g_PlayerAssignments = hotloadData.playerAssignments;
			this.updatePlayerAssignments();
		}
		else if (!g_IsNetworked)
		{
			// Simulate a net message for the local player to keep a common path.
			this.onPlayerAssignmentMessage({
				"newAssignments": g_PlayerAssignments
			});
		}
	}

	onGetHotloadData(object)
	{
		object.playerAssignments = g_PlayerAssignments;
	}

	/**
	 * On client join, try to assign them to a free slot.
	 * (This is called before g_PlayerAssignments is updated).
	 */
	onClientJoin(isSavedGame, newGUID, newAssignments)
	{
		if (!g_IsController || newAssignments[newGUID].player !== -1)
			return;

		// Assign the client (or only buddies if prefered) to a free slot
		if (newGUID != Engine.GetPlayerGUID())
		{
			const assignOption = Engine.ConfigDB_GetValue("user", this.ConfigAssignPlayers);
			if (assignOption == "disabled" ||
				assignOption == "buddies" && g_Buddies.indexOf(splitRatingFromNick(newAssignments[newGUID].name).nick) == -1)
				return;
		}

		const slot = this.findAssignmentSlot(isSavedGame, newGUID, newAssignments);

		if (slot === undefined)
			return;

		this.assignClient(newGUID, slot);
	}

	findAssignmentSlot(isSavedGame, newGUID, newAssignments)
	{
		const newAssignmentsArray = Object.values(newAssignments);
		const isSlotAvailable = slot =>
			newAssignmentsArray.every(elem => elem.player !== slot) &&
			(!isSavedGame || !g_GameSettings.playerAI.get(slot - 1));

		const newName = newAssignments[newGUID].name;
		// First check if we know them and try to give them their old assignment back.
		if (this.lastAssigned[newName] > 0 &&
			this.lastAssigned[newName] <= g_GameSettings.playerCount.nbPlayers &&
			isSlotAvailable(this.lastAssigned[newName]))
		{
			return this.lastAssigned[newName];
		}

		// If we can't restore the previous slot, try to give them the slot stored in the savegame.
		if (isSavedGame)
		{
			const saveSlot = g_GameSettings.playerName.values.indexOf(newName) + 1;
			if (saveSlot > 0 && isSlotAvailable(saveSlot))
				return saveSlot;
		}

		// If we can't restore the slot, assign the client to the first free slot.
		return Array.from(Array(g_GameSettings.playerCount.nbPlayers).keys(), i => i + 1).find(
			isSlotAvailable);
	}

	/**
	 * To be called when g_PlayerAssignments is modified.
	 */
	updatePlayerAssignments()
	{
		Engine.ProfileStart("updatePlayerAssignments");
		for (const guid in g_PlayerAssignments)
			this.lastAssigned[g_PlayerAssignments[guid].name] = g_PlayerAssignments[guid].player;
		for (const handler of this.playerAssignmentsChangeHandlers)
			handler();
		Engine.ProfileStop();
	}

	/**
	 * Called whenever a client joins or leaves or any game setting is changed.
	 */
	onPlayerAssignmentMessage(message)
	{
		const newAssignments = message.newAssignments;
		for (const guid in newAssignments)
			if (!g_PlayerAssignments[guid])
				for (const handler of this.clientJoinHandlers)
					handler(guid, message.newAssignments);

		for (const guid in g_PlayerAssignments)
			if (!newAssignments[guid])
				for (const handler of this.clientLeaveHandlers)
					handler(guid);

		g_PlayerAssignments = newAssignments;
		this.updatePlayerAssignments();
	}

	assignClient(guid, playerIndex)
	{
		if (g_IsNetworked)
			Engine.AssignNetworkPlayer(playerIndex, guid);
		else
		{
			g_PlayerAssignments[guid].player = playerIndex;
			this.updatePlayerAssignments();
		}
	}

	/**
	 * If both clients are assigned players, this will swap their assignments.
	 */
	assignPlayer(guidToAssign, playerIndex)
	{
		if (g_PlayerAssignments[guidToAssign].player != -1)
		{
			for (const guid in g_PlayerAssignments)
				if (g_PlayerAssignments[guid].player == playerIndex + 1)
				{
					this.assignClient(guid, g_PlayerAssignments[guidToAssign].player);
					break;
				}
		}
		this.assignClient(guidToAssign, playerIndex + 1);
	}

	unassignClient(playerID)
	{
		if (g_IsNetworked)
			Engine.AssignNetworkPlayer(playerID, "");
		else if (g_PlayerAssignments.local.player == playerID)
		{
			g_PlayerAssignments.local.player = -1;
			this.updatePlayerAssignments();
		}
	}

	unassignInvalidPlayers()
	{
		if (g_IsNetworked)
		{
			for (const guid in g_PlayerAssignments)
				if (g_PlayerAssignments[guid].player > g_GameSettings.playerCount.nbPlayers)
					Engine.AssignNetworkPlayer(g_PlayerAssignments[guid].player, "");
		}
		else if (g_PlayerAssignments.local.player > g_GameSettings.playerCount.nbPlayers)
		{
			g_PlayerAssignments.local.player = -1;
			this.updatePlayerAssignments();
		}
	}
}

PlayerAssignmentsController.prototype.ConfigNameSingleplayer =
	"playername.singleplayer";

PlayerAssignmentsController.prototype.ConfigAssignPlayers =
	"gui.gamesetup.assignplayers";
