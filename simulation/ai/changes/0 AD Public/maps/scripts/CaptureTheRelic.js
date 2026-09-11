Trigger.prototype.InitCaptureTheRelic = function()
{
	const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	const catafalqueTemplates = shuffleArray(cmpTemplateManager.FindAllTemplates(false).filter(
		name => GetIdentityClasses(cmpTemplateManager.GetTemplate(name).Identity || {}).indexOf("Relic") != -1));

	const potentialSpawnPoints = TriggerHelper.GetLandSpawnPoints();
	if (!potentialSpawnPoints.length)
	{
		error("No gaia entities found on this map that could be used as spawn points!");
		return;
	}

	const cmpEndGameManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager);
	const numSpawnedRelics = cmpEndGameManager.GetGameSettings().relicCount;
	this.playerRelicsCount = new Array(TriggerHelper.GetNumberOfPlayers()).fill(0, 1);
	this.playerRelicsCount[0] = numSpawnedRelics;

	for (let i = 0; i < numSpawnedRelics; ++i)
	{
		this.relics[i] = TriggerHelper.SpawnUnits(pickRandom(potentialSpawnPoints), catafalqueTemplates[i], 1, 0)[0];

		const cmpPositionRelic = Engine.QueryInterface(this.relics[i], IID_Position);
		cmpPositionRelic.SetYRotation(randomAngle());
	}
};

Trigger.prototype.CheckCaptureTheRelicVictory = function(data)
{
	const cmpIdentity = Engine.QueryInterface(data.entity, IID_Identity);
	if (!cmpIdentity || !cmpIdentity.HasClass("Relic") || data.from == INVALID_PLAYER)
		return;

	--this.playerRelicsCount[data.from];

	if (data.to == -1)
	{
		warn("Relic entity " + data.entity + " has been destroyed.");
		this.relics.splice(this.relics.indexOf(data.entity), 1);
	}
	else
		++this.playerRelicsCount[data.to];

	this.DeleteCaptureTheRelicVictoryMessages();
	this.CheckCaptureTheRelicCountdown();
};

/**
 * Check if a group of mutually allied players have acquired all relics.
 * The winning players are the relic owners and all players mutually allied to all relic owners.
 * Reset the countdown if the group of winning players changes or extends.
 */
Trigger.prototype.CheckCaptureTheRelicCountdown = function()
{
	if (this.playerRelicsCount[0])
	{
		this.DeleteCaptureTheRelicVictoryMessages();
		return;
	}

	const activePlayers = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager).GetActivePlayers();
	const relicOwners = activePlayers.filter(playerID => this.playerRelicsCount[playerID]);
	if (!relicOwners.length)
	{
		this.DeleteCaptureTheRelicVictoryMessages();
		return;
	}

	const winningPlayers = Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager).GetAlliedVictory() ?
		activePlayers.filter(playerID => relicOwners.every(owner => QueryPlayerIDInterface(playerID, IID_Diplomacy).IsMutualAlly(owner))) :
		[relicOwners[0]];

	// All relicOwners should be mutually allied
	if (relicOwners.some(owner => winningPlayers.indexOf(owner) == -1))
	{
		this.DeleteCaptureTheRelicVictoryMessages();
		return;
	}

	// Reset the timer when playerAndAllies isn't the same as this.relicsVictoryCountdownPlayers
	if (winningPlayers.length != this.relicsVictoryCountdownPlayers.length ||
	    winningPlayers.some(player => this.relicsVictoryCountdownPlayers.indexOf(player) == -1))
	{
		this.relicsVictoryCountdownPlayers = winningPlayers;
		this.StartCaptureTheRelicCountdown(winningPlayers);
	}
};

Trigger.prototype.DeleteCaptureTheRelicVictoryMessages = function()
{
	if (!this.relicsVictoryTimer)
		return;

	Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer).CancelTimer(this.relicsVictoryTimer);
	this.relicsVictoryTimer = undefined;

	const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
	cmpGuiInterface.DeleteTimeNotification(this.ownRelicsVictoryMessage);
	cmpGuiInterface.DeleteTimeNotification(this.othersRelicsVictoryMessage);
	this.relicsVictoryCountdownPlayers = [];
};

Trigger.prototype.StartCaptureTheRelicCountdown = function(winningPlayers)
{
	const cmpTimer = Engine.QueryInterface(SYSTEM_ENTITY, IID_Timer);
	const cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);

	if (this.relicsVictoryTimer)
	{
		cmpTimer.CancelTimer(this.relicsVictoryTimer);
		cmpGuiInterface.DeleteTimeNotification(this.ownRelicsVictoryMessage);
		cmpGuiInterface.DeleteTimeNotification(this.othersRelicsVictoryMessage);
	}

	if (!this.relics.length)
		return;

	const others = [-1];
	for (let playerID = 1; playerID < TriggerHelper.GetNumberOfPlayers(); ++playerID)
	{
		const cmpPlayer = QueryPlayerIDInterface(playerID);
		if (cmpPlayer.GetState() == "won")
			return;

		if (winningPlayers.indexOf(playerID) == -1)
			others.push(playerID);
	}

	const cmpPlayer = QueryOwnerInterface(this.relics[0], IID_Player);
	if (!cmpPlayer)
	{
		warn("Relic entity " + this.relics[0] + " has no owner.");
		this.relics.splice(0, 1);

		this.CheckCaptureTheRelicCountdown();
		return;
	}
	const cmpEndGameManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager);
	const captureTheRelicDuration = cmpEndGameManager.GetGameSettings().relicDuration;

	const isTeam = winningPlayers.length > 1;
	this.ownRelicsVictoryMessage = cmpGuiInterface.AddTimeNotification({
		"message": isTeam ?
			markForTranslation("%(_player_)s and their allies have captured all relics and will win in %(time)s.") :
			markForTranslation("%(_player_)s has captured all relics and will win in %(time)s."),
		"players": others,
		"parameters": {
			"_player_": cmpPlayer.GetPlayerID()
		},
		"translateMessage": true,
		"translateParameters": []
	}, captureTheRelicDuration);

	this.othersRelicsVictoryMessage = cmpGuiInterface.AddTimeNotification({
		"message": isTeam ?
			markForTranslation("You and your allies have captured all relics and will win in %(time)s.") :
			markForTranslation("You have captured all relics and will win in %(time)s."),
		"players": winningPlayers,
		"translateMessage": true
	}, captureTheRelicDuration);

	this.relicsVictoryTimer = cmpTimer.SetTimeout(SYSTEM_ENTITY, IID_Trigger,
		"CaptureTheRelicVictorySetWinner", captureTheRelicDuration, winningPlayers);
};

Trigger.prototype.CaptureTheRelicVictorySetWinner = function(winningPlayers)
{
	const cmpEndGameManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_EndGameManager);
	cmpEndGameManager.MarkPlayersAsWon(
		winningPlayers,
		n => markForPluralTranslation(
			"%(lastPlayer)s has won (Capture the Relic).",
			"%(players)s and %(lastPlayer)s have won (Capture the Relic).",
			n),
		n => markForPluralTranslation(
			"%(lastPlayer)s has been defeated (Capture the Relic).",
			"%(players)s and %(lastPlayer)s have been defeated (Capture the Relic).",
			n));
};

{
	const cmpTrigger = Engine.QueryInterface(SYSTEM_ENTITY, IID_Trigger);
	cmpTrigger.relics = [];
	cmpTrigger.playerRelicsCount = [];
	cmpTrigger.relicsVictoryTimer = undefined;
	cmpTrigger.ownRelicsVictoryMessage = undefined;
	cmpTrigger.othersRelicsVictoryMessage = undefined;
	cmpTrigger.relicsVictoryCountdownPlayers = [];

	cmpTrigger.DoAfterDelay(0, "InitCaptureTheRelic", {});
	cmpTrigger.RegisterTrigger("OnDiplomacyChanged", "CheckCaptureTheRelicCountdown", { "enabled": true });
	cmpTrigger.RegisterTrigger("OnOwnershipChanged", "CheckCaptureTheRelicVictory", { "enabled": true });
	cmpTrigger.RegisterTrigger("OnPlayerWon", "DeleteCaptureTheRelicVictoryMessages", { "enabled": true });
	cmpTrigger.RegisterTrigger("OnPlayerDefeated", "CheckCaptureTheRelicCountdown", { "enabled": true });
}
