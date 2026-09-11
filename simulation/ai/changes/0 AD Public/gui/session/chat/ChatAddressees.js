/**
 * This class is concerned with building and propagating the chat addressee selection.
 */
class ChatAddressees
{
	constructor(alignmentHelper)
	{
		this.selectionChangeHandlers = [];

		this.chatAddresseeCaption = Engine.GetGUIObjectByName("chatAddresseeCaption");
		resizeGUIObjectToCaption(this.chatAddresseeCaption, { "horizontal": "right" });

		this.chatAddressee = Engine.GetGUIObjectByName("chatAddressee");
		this.chatAddressee.onSelectionChange = this.onSelectionChange.bind(this);

		alignmentHelper.setObject(this.chatAddressee, "left", this.chatAddresseeCaption.size.right + this.DropdownMargin);
	}

	registerSelectionChangeHandler(handler)
	{
		this.selectionChangeHandlers.push(handler);
	}

	onSelectionChange()
	{
		const selection = this.getSelection();
		for (const handler of this.selectionChangeHandlers)
			handler(selection);
	}

	getSelection()
	{
		return this.chatAddressee.list_data[this.chatAddressee.selected] || "";
	}

	select(command)
	{
		this.chatAddressee.selected = this.chatAddressee.list_data.indexOf(command);
	}

	onUpdatePlayers()
	{
		// Remember previously selected item
		let selectedName = this.getSelection();
		selectedName = selectedName.startsWith("/msg ") && selectedName.substr("/msg ".length);

		const addressees = this.AddresseeTypes.filter(
			addresseeType => addresseeType.isSelectable()).map(
			addresseeType => ({
				"label": translateWithContext("chat addressee", addresseeType.label),
				"cmd": addresseeType.command
			}));

		// Add playernames for private messages
		const guids = sortGUIDsByPlayerID();
		for (const guid of guids)
		{
			if (guid == Engine.GetPlayerGUID())
				continue;

			const playerID = g_PlayerAssignments[guid].player;

			// Don't provide option for PM from observer to player
			if (g_IsObserver && !isPlayerObserver(playerID))
				continue;

			const colorBox = isPlayerObserver(playerID) ? "" : colorizePlayernameHelper("■", playerID) + " ";

			addressees.push({
				"cmd": "/msg " + g_PlayerAssignments[guid].name,
				"label": colorBox + g_PlayerAssignments[guid].name
			});
		}

		// Select mock item if the selected addressee went offline
		if (selectedName && guids.every(guid => g_PlayerAssignments[guid].name != selectedName))
			addressees.push({
				"cmd": "/msg " + selectedName,
				"label": sprintf(translate("\\[OFFLINE] %(player)s"), { "player": selectedName })
			});

		const oldChatAddressee = this.getSelection();
		this.chatAddressee.list = addressees.map(adressee => adressee.label);
		this.chatAddressee.list_data = addressees.map(adressee => adressee.cmd);
		this.chatAddressee.selected = Math.max(0, this.chatAddressee.list_data.indexOf(oldChatAddressee));
	}
}

/**
 * isAddressee is used to determine the receiverGUIDs when sending and
 * when displaying deciding whether to display network chat.
 *
 * The code may assume sender != receiver.
 *
 * The function must return true when the message should be sent from X to Y and
 * it must return true when the message should be received by Y if sent by X and
 * return false otherwise.
 */
ChatAddressees.prototype.AddresseeTypes = [
	{
		"command": "",
		"isSelectable": () => true,
		"label": markForTranslationWithContext("chat addressee", "Everyone"),
		"isAddressee": () => true
	},
	{
		"command": "/allies",
		"isSelectable": () => !g_IsObserver,
		"label": markForTranslationWithContext("chat addressee", "Allies"),
		"context": markForTranslationWithContext("chat message context", "Ally"),
		"isAddressee": (senderID, receiverID) =>
			g_Players[senderID] &&
			g_Players[receiverID] &&
			g_Players[senderID].isMutualAlly[receiverID]
	},
	{
		"command": "/enemies",
		"isSelectable": () => !g_IsObserver,
		"label": markForTranslationWithContext("chat addressee", "Enemies"),
		"context": markForTranslationWithContext("chat message context", "Enemy"),
		"isAddressee": (senderID, receiverID) =>
			g_Players[senderID] &&
			g_Players[receiverID] &&
			g_Players[senderID].isEnemy[receiverID]
	},
	{
		"command": "/observers",
		"isSelectable": () => true,
		"label": markForTranslationWithContext("chat addressee", "Observers"),
		"context": markForTranslationWithContext("chat message context", "Observer"),
		"isAddressee": (_, receiverID) => isPlayerObserver(receiverID)
	},
	{
		"command": "/msg",
		"isSelectable": () => false,
		"label": undefined,
		"context": markForTranslationWithContext("chat message context", "Private"),
		"isAddressee": (senderID, receiverID) =>
			!isPlayerObserver(senderID) || isPlayerObserver(receiverID)
	}
];

ChatAddressees.prototype.DropdownMargin = 5;
