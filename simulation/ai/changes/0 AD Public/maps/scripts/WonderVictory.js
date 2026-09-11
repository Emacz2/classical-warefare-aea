Trigger.prototype.WonderVictoryEntityRenamed = function(data)
{
	if (this.wonderVictoryMessages[data.entity] && Engine.QueryInterface(data.newentity, IID_Wonder))
	{
		// When an entity is renamed, we first create a new entity,
		// which in case it is a wonder will receive a timer.
		// However on a rename we want to use the timer from the old entity,
		// so we need to remove the timer of the new entity.
		this.WonderVictoryDeleteTimer(data.newentity);

		this.wonderVictoryMessages[data.newentity] = this.wonderVictoryMessages[data.entity];
		delete this.wonderVictoryMessages[data.entity];
	}
};

Trigger.prototype.WonderVictoryOwnershipChanged = function(data)
{
	if (!Engine.QueryInterface(data.entity, IID_Wonder))
		return;

	this.WonderVictoryDeleteTimer(data.entity);

	if (data.to > 0)
		this.WonderVictoryStartTimer(data.entity, data.to);
};

Trigger.prototype.WonderVictoryDiplomacyChanged = function(data)
{
	if (!Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager).GetAlliedVictory())
		return;

	for (const ent in this.wonderVictoryMessages)
	{
		if (this.wonderVictoryMessages[ent].playerID != data.player && this.wonderVictoryMessages[ent].playerID != data.otherPlayer)
			continue;

		const owner = this.wonderVictoryMessages[ent].playerID;
		const otherPlayer = owner == data.player ? data.otherPlayer : data.player;
		const newAllies = new Set(QueryPlayerIDInterface(owner, IID_Diplomacy).GetPlayersByDiplomacy("IsExclusiveMutualAlly"));
		if (newAllies.has(otherPlayer) && !this.wonderVictoryMessages[ent].allies.has(otherPlayer) ||
		    !newAllies.has(otherPlayer) && this.wonderVictoryMessages[ent].allies.has(otherPlayer))
		{
			this.WonderVictoryDeleteTimer(ent);
			this.WonderVictoryStartTimer(ent, owner);
		}
	}
};

/**
 * Create new messages, and start timer to register defeat.
 */
Trigger.prototype.WonderVictoryStartTimer = function(ent, player)
{
	const cmpEndGameManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager);
	const allies = cmpEndGameManager.GetAlliedVictory() ?
		QueryPlayerIDInterface(player, IID_Diplomacy).GetPlayersByDiplomacy("IsExclusiveMutualAlly") : [];

	const others = [-1];
	for (let playerID = 1; playerID < TriggerHelper.GetNumberOfPlayers(); ++playerID)
	{
		const cmpPlayer = QueryPlayerIDInterface(playerID);
		if (cmpPlayer.GetState() == "won")
			return;
		if (allies.indexOf(playerID) == -1 && playerID != player)
			others.push(playerID);
	}

	const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);

	const wonderDuration = cmpEndGameManager.GetGameSettings().wonderDuration;
	this.wonderVictoryMessages[ent] = {
		"playerID": player,
		"allies": new Set(allies),
		"timer": cmpTimer.SetTimeout(SYSTEM_ENTITY, IID_Trigger, "WonderVictorySetWinner", wonderDuration, player),
		"messages": [
			cmpGuiInterface.AddTimeNotification(
				{
					"message": allies.length ?
						markForTranslation("%(_player_)s owns a Wonder and %(_player_)s and their allies will win in %(time)s.") :
						markForTranslation("%(_player_)s owns a Wonder and will win in %(time)s."),
					"players": others,
					"parameters": {
						"_player_": player
					},
					"translateMessage": true,
					"translateParameters": []
				},
				wonderDuration),
			cmpGuiInterface.AddTimeNotification(
				{
					"message": markForTranslation("%(_player_)s owns a Wonder and you will win in %(time)s."),
					"players": allies,
					"parameters": {
						"_player_": player
					},
					"translateMessage": true,
					"translateParameters": []
				},
				wonderDuration),
			cmpGuiInterface.AddTimeNotification(
				{
					"message": allies.length ?
						markForTranslation("You own a Wonder and you and your allies will win in %(time)s.") :
						markForTranslation("You own a Wonder and will win in %(time)s."),
					"players": [player],
					"translateMessage": true
				},
				wonderDuration)
		]
	};
};

Trigger.prototype.WonderVictoryDeleteTimer = function(ent)
{
	if (!this.wonderVictoryMessages[ent])
		return;

	const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);

	for (const message of this.wonderVictoryMessages[ent].messages)
		cmpGuiInterface.DeleteTimeNotification(message);
	cmpTimer.CancelTimer(this.wonderVictoryMessages[ent].timer);
	delete this.wonderVictoryMessages[ent];
};

Trigger.prototype.WonderVictoryPlayerWon = function(data)
{
	for (const ent in this.wonderVictoryMessages)
		this.WonderVictoryDeleteTimer(ent);
};

Trigger.prototype.WonderVictorySetWinner = function(playerID)
{
	const cmpEndGameManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager);
	cmpEndGameManager.MarkPlayerAndAlliesAsWon(
		playerID,
		n => markForPluralTranslation(
			"%(lastPlayer)s has won (wonder victory).",
			"%(players)s and %(lastPlayer)s have won (wonder victory).",
			n),
		n => markForPluralTranslation(
			"%(lastPlayer)s has been defeated (wonder victory).",
			"%(players)s and %(lastPlayer)s have been defeated (wonder victory).",
			n));
};

{
	const cmpTrigger = Engine.QueryInterface(SYSTEM_ENTITY, IID_Trigger);
	cmpTrigger.RegisterTrigger("OnEntityRenamed", "WonderVictoryEntityRenamed", { "enabled": true });
	cmpTrigger.RegisterTrigger("OnOwnershipChanged", "WonderVictoryOwnershipChanged", { "enabled": true });
	cmpTrigger.RegisterTrigger("OnDiplomacyChanged", "WonderVictoryDiplomacyChanged", { "enabled": true });
	cmpTrigger.RegisterTrigger("OnPlayerWon", "WonderVictoryPlayerWon", { "enabled": true });
	cmpTrigger.wonderVictoryMessages = {};
}
