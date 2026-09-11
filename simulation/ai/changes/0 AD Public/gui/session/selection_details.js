function layoutSelectionSingle()
{
	Engine.GetGUIObjectByName("detailsAreaSingle").hidden = false;
	Engine.GetGUIObjectByName("detailsAreaMultiple").hidden = true;
}

function layoutSelectionMultiple()
{
	Engine.GetGUIObjectByName("detailsAreaMultiple").hidden = false;
	Engine.GetGUIObjectByName("detailsAreaSingle").hidden = true;
}

// Updates the health bar of garrisoned units
function updateGarrisonHealthBar(entState, selection)
{
	if (!entState.garrisonHolder)
		return;

	// Summing up the Health of every single unit
	let totalGarrisonHealth = 0;
	let maxGarrisonHealth = 0;
	for (const selEnt of selection)
	{
		const selEntState = GetEntityState(selEnt);
		if (selEntState.garrisonHolder)
			for (const ent of selEntState.garrisonHolder.entities)
			{
				const state = GetEntityState(ent);
				totalGarrisonHealth += state.hitpoints || 0;
				maxGarrisonHealth += state.maxHitpoints || 0;
			}
	}

	// Configuring the health bar
	const healthGarrison = Engine.GetGUIObjectByName("healthGarrison");
	healthGarrison.hidden = totalGarrisonHealth <= 0;
	if (totalGarrisonHealth > 0)
	{
		const healthBarGarrison = Engine.GetGUIObjectByName("healthBarGarrison");
		healthBarGarrison.size.rtop = 100 - 100 * Math.max(0, Math.min(1, totalGarrisonHealth / maxGarrisonHealth));
		healthGarrison.tooltip = getCurrentHealthTooltip({
			"hitpoints": totalGarrisonHealth,
			"maxHitpoints": maxGarrisonHealth
		});
	}
}

// Fills out information that most entities have
function displaySingle(entState)
{
	const template = GetTemplateData(entState.template);

	const primaryName = g_SpecificNamesPrimary ? template.name.specific : template.name.generic;
	let secondaryName;
	if (g_ShowSecondaryNames)
		secondaryName = g_SpecificNamesPrimary ? template.name.generic : template.name.specific;

	// If packed, add that to the generic name (reduces template clutter).
	if (template.pack && template.pack.state == "packed")
	{
		if (secondaryName && g_ShowSecondaryNames)
			secondaryName = sprintf(translate("%(secondaryName)s — Packed"), { "secondaryName": secondaryName });
		else
			secondaryName = sprintf(translate("Packed"));
	}
	const playerState = g_Players[entState.player];

	const civName = g_CivData[playerState.civ].Name;
	const civEmblem = g_CivData[playerState.civ].Emblem;

	let playerName = playerState.name;

	// Indicate disconnected players by prefixing their name
	if (g_Players[entState.player].offline)
		playerName = sprintf(translate("\\[OFFLINE] %(player)s"), { "player": playerName });

	// Rank
	if (entState.identity && entState.identity.rank && entState.identity.classes)
	{
		const rankObj = GetTechnologyData(entState.identity.rankTechName, playerState.civ);
		Engine.GetGUIObjectByName("rankIcon").tooltip = sprintf(translate("%(rank)s Rank"), {
			"rank": translateWithContext("Rank", entState.identity.rank)
		}) + (rankObj ? "\n" + rankObj.tooltip : "");
		Engine.GetGUIObjectByName("rankIcon").sprite = "stretched:session/icons/ranks/" + entState.identity.rank + ".png";
		Engine.GetGUIObjectByName("rankIcon").hidden = false;
	}
	else
	{
		Engine.GetGUIObjectByName("rankIcon").hidden = true;
		Engine.GetGUIObjectByName("rankIcon").tooltip = "";
	}

	if (entState.statusEffects)
	{
		const statusEffectsSection = Engine.GetGUIObjectByName("statusEffectsIcons");
		statusEffectsSection.hidden = false;
		const statusIcons = statusEffectsSection.children;
		let i = 0;
		for (const effectCode in entState.statusEffects)
		{
			const effect = entState.statusEffects[effectCode];
			statusIcons[i].hidden = false;
			statusIcons[i].sprite = "stretched:session/icons/status_effects/" + g_StatusEffectsMetadata.getIcon(effect.baseCode) + ".png";
			statusIcons[i].tooltip = getStatusEffectsTooltip(effect.baseCode, effect, false);
			statusIcons[i].size.top = i * 18;
			statusIcons[i].size.bottom = i * 18 + 16;

			if (++i >= statusIcons.length)
				break;
		}
		for (; i < statusIcons.length; ++i)
			statusIcons[i].hidden = true;
	}
	else
		Engine.GetGUIObjectByName("statusEffectsIcons").hidden = true;

	const showHealth = entState.hitpoints;
	const showResource = entState.resourceSupply;
	const showCapture = entState.capturePoints;

	const healthSection = Engine.GetGUIObjectByName("healthSection");
	const captureSection = Engine.GetGUIObjectByName("captureSection");
	const resourceSection = Engine.GetGUIObjectByName("resourceSection");
	const sectionPosTop = Engine.GetGUIObjectByName("sectionPosTop");
	const sectionPosMiddle = Engine.GetGUIObjectByName("sectionPosMiddle");
	const sectionPosBottom = Engine.GetGUIObjectByName("sectionPosBottom");

	// Hitpoints
	healthSection.hidden = !showHealth;
	if (showHealth)
	{
		Engine.GetGUIObjectByName("healthBar").size.rright = 100 * Math.max(0, Math.min(1, entState.hitpoints / entState.maxHitpoints));
		Engine.GetGUIObjectByName("healthStats").caption = sprintf(translate("%(hitpoints)s / %(maxHitpoints)s"), {
			"hitpoints": Math.ceil(entState.hitpoints),
			"maxHitpoints": Math.ceil(entState.maxHitpoints)
		});

		healthSection.size = sectionPosTop.size;
		captureSection.size = showResource ? sectionPosMiddle.size : sectionPosBottom.size;
		resourceSection.size = showResource ? sectionPosBottom.size : sectionPosMiddle.size;
	}
	else if (showResource)
	{
		captureSection.size = sectionPosBottom.size;
		resourceSection.size = sectionPosTop.size;
	}
	else if (showCapture)
		captureSection.size = sectionPosTop.size;

	// CapturePoints
	captureSection.hidden = !entState.capturePoints;
	if (entState.capturePoints)
	{
		const setCaptureBarPart = function(playerID, startSize) {
			const unitCaptureBar = Engine.GetGUIObjectByName("captureBar[" + playerID + "]");

			const width = 100 * Math.max(0, Math.min(1, entState.capturePoints[playerID] / entState.maxCapturePoints));
			unitCaptureBar.size.rleft = startSize;
			unitCaptureBar.size.rright = startSize + width;

			unitCaptureBar.sprite = "color:" + g_DiplomacyColors.getPlayerColor(playerID, 128);
			unitCaptureBar.hidden = false;
			return startSize + width;
		};

		// first handle the owner's points, to keep those points on the left for clarity
		let size = setCaptureBarPart(entState.player, 0);

		for (const i in entState.capturePoints)
			if (i != entState.player)
				size = setCaptureBarPart(i, size);

		const captureText = sprintf(translate("%(capturePoints)s / %(maxCapturePoints)s"), {
			"capturePoints": Math.ceil(entState.capturePoints[entState.player]),
			"maxCapturePoints": Math.ceil(entState.maxCapturePoints)
		});

		const showSmallCapture = showResource && showHealth;
		Engine.GetGUIObjectByName("captureStats").caption = showSmallCapture ? "" : captureText;
		Engine.GetGUIObjectByName("captureTooltip").tooltip = showSmallCapture ? getCurrentCaptureTooltip(entState) : translate("Capture Points");
	}

	// Experience
	Engine.GetGUIObjectByName("experience").hidden = !entState.promotion;
	if (entState.promotion)
	{
		Engine.GetGUIObjectByName("experienceBar").size.rtop = 100 - (100 * Math.max(0, Math.min(1, 1.0 * +entState.promotion.curr / (+entState.promotion.req || 1))));

		if (entState.promotion.curr < entState.promotion.req)
			Engine.GetGUIObjectByName("experience").tooltip = sprintf(translate("%(experience)s %(current)s / %(required)s"), {
				"experience": "[font=\"sans-bold-13\"]" + translate("Experience:") + "[/font]",
				"current": Math.floor(entState.promotion.curr),
				"required": Math.ceil(entState.promotion.req)
			});
		else
			Engine.GetGUIObjectByName("experience").tooltip = sprintf(translate("%(experience)s %(current)s"), {
				"experience": "[font=\"sans-bold-13\"]" + translate("Experience:") + "[/font]",
				"current": Math.floor(entState.promotion.curr)
			});
	}

	// Resource stats
	resourceSection.hidden = !showResource;
	if (entState.resourceSupply)
	{
		const resources = entState.resourceSupply.isInfinite ? translate("∞") :  // Infinity symbol
			sprintf(translate("%(amount)s / %(max)s"), {
				"amount": Math.ceil(+entState.resourceSupply.amount),
				"max": entState.resourceSupply.max
			});

		Engine.GetGUIObjectByName("resourceBar").size.rright = entState.resourceSupply.isInfinite ? 100 :
			100 * Math.max(0, Math.min(1, +entState.resourceSupply.amount / +entState.resourceSupply.max));

		Engine.GetGUIObjectByName("resourceLabel").caption = sprintf(translate("%(resource)s:"), {
			"resource": resourceNameFirstWord(entState.resourceSupply.type.generic)
		});
		Engine.GetGUIObjectByName("resourceStats").caption = resources;

	}

	const resourceCarryingIcon = Engine.GetGUIObjectByName("resourceCarryingIcon");
	const resourceCarryingText = Engine.GetGUIObjectByName("resourceCarryingText");
	resourceCarryingIcon.hidden = false;
	resourceCarryingText.hidden = false;

	// Resource carrying
	if (entState.resourceCarrying && entState.resourceCarrying.length)
	{
		// We should only be carrying one resource type at once, so just display the first
		const carried = entState.resourceCarrying[0];
		resourceCarryingIcon.sprite = "stretched:session/icons/resources/" + carried.type + ".png";
		resourceCarryingText.caption = sprintf(translate("%(amount)s / %(max)s"), { "amount": carried.amount, "max": carried.max });
		resourceCarryingIcon.tooltip = "";
	}
	// Use the same indicators for traders
	else if (entState.trader && entState.trader.goods.amount)
	{
		resourceCarryingIcon.sprite = "stretched:session/icons/resources/" + entState.trader.goods.type + ".png";
		let totalGain = entState.trader.goods.amount.traderGain;
		if (entState.trader.goods.amount.market1Gain)
			totalGain += entState.trader.goods.amount.market1Gain;
		if (entState.trader.goods.amount.market2Gain)
			totalGain += entState.trader.goods.amount.market2Gain;
		resourceCarryingText.caption = totalGain;
		resourceCarryingIcon.tooltip = sprintf(translate("Gain: %(gain)s"), {
			"gain": getTradingTooltip(entState.trader.goods.amount)
		});
	}
	// And for number of workers
	else if (entState.foundation)
	{
		resourceCarryingIcon.sprite = "stretched:session/icons/repair.png";
		resourceCarryingIcon.tooltip = getBuildTimeTooltip(entState);
		resourceCarryingText.caption = entState.foundation.numBuilders ? sprintf(translate("(%(number)s)\n%(time)s"), {
			"number": entState.foundation.numBuilders,
			"time": Engine.FormatMillisecondsIntoDateStringGMT(entState.foundation.buildTime.timeRemaining * 1000, translateWithContext("countdown format", "m:ss"))
		}) : "";
	}
	else if (entState.resourceSupply && (!entState.resourceSupply.killBeforeGather || !entState.hitpoints))
	{
		resourceCarryingIcon.sprite = "stretched:session/icons/repair.png";
		resourceCarryingText.caption = sprintf(translate("%(amount)s / %(max)s"), {
			"amount": entState.resourceSupply.numGatherers,
			"max": entState.resourceSupply.maxGatherers
		});
		Engine.GetGUIObjectByName("resourceCarryingIcon").tooltip = translate("Current/max gatherers");
	}
	else if (entState.repairable && entState.needsRepair)
	{
		resourceCarryingIcon.sprite = "stretched:session/icons/repair.png";
		resourceCarryingIcon.tooltip = getRepairTimeTooltip(entState);
		resourceCarryingText.caption = entState.repairable.numBuilders ? sprintf(translate("(%(number)s)\n%(time)s"), {
			"number": entState.repairable.numBuilders,
			"time": Engine.FormatMillisecondsIntoDateStringGMT(entState.repairable.buildTime.timeRemaining * 1000, translateWithContext("countdown format", "m:ss"))
		}) : "";
	}
	else
	{
		resourceCarryingIcon.hidden = true;
		resourceCarryingText.hidden = true;
	}

	Engine.GetGUIObjectByName("player").caption = playerName;

	Engine.GetGUIObjectByName("playerColorBackground").sprite =
		"color:" + g_DiplomacyColors.getPlayerColor(entState.player, 128);

	const hideSecondary = !secondaryName || primaryName == secondaryName;

	const primaryObject = Engine.GetGUIObjectByName("primary");
	primaryObject.caption = primaryName;
	primaryObject.size.rbottom = hideSecondary ? 100 : 50;

	const secondaryObject = Engine.GetGUIObjectByName("secondary");
	secondaryObject.caption = hideSecondary ? "" :
		sprintf(translate("(%(secondaryName)s)"), {
			"secondaryName": secondaryName
		});
	secondaryObject.hidden = hideSecondary;

	const isGaia = playerState.civ == "gaia";
	Engine.GetGUIObjectByName("playerCivIcon").sprite = isGaia ? "" : "cropped:1.0, 0.15625 center:grayscale:" + civEmblem;

	if (isGaia)
	{
		Engine.GetGUIObjectByName("phaseEmblems").sprite = "";
		Engine.GetGUIObjectByName("civilizationTooltip").tooltip = "";
	}
	else
	{
		let civilizationTooltip = civName;
		let civPhaseEmblems = "session/panel_phase_emblems_hidden.png";

		// Reveal phases to mutual allies and observers
		if (g_ViewedPlayer == -1 || playerState.isMutualAlly[g_ViewedPlayer])
		{
			const civPhase = g_SimState.players[entState.player].phase;
			civPhaseEmblems = "session/panel_phase_emblems_" + civPhase + ".png";
			const civPhaseData = GetTechnologyData("phase_" + civPhase + "_" + playerState.civ, playerState.civ) ||
				GetTechnologyData("phase_" + civPhase, playerState.civ);
			civilizationTooltip += " — " + getEntityNames(civPhaseData);
		}
		Engine.GetGUIObjectByName("phaseEmblems").sprite = "cropped:1.0, 1.0 center:" + civPhaseEmblems;
		Engine.GetGUIObjectByName("civilizationTooltip").tooltip = civilizationTooltip;
	}

	// TODO: we should require all entities to have icons
	Engine.GetGUIObjectByName("icon").sprite = template.icon ? ("stretched:session/portraits/" + template.icon) : "BackgroundBlack";
	if (template.icon)
	{
		const iconBorder = Engine.GetGUIObjectByName("iconBorder");

		iconBorder.onPress = () => {
			setCameraFollow(entState.id);
		};

		iconBorder.onPressRight = () => {
			showTemplateDetails(entState.template, playerState.civ);
		};
	}

	const detailedTooltip = [
		getAttackTooltip,
		getHealerTooltip,
		getResistanceTooltip,
		getGatherTooltip,
		getSpeedTooltip,
		getGarrisonTooltip,
		getTurretsTooltip,
		getPopulationBonusTooltip,
		getProjectilesTooltip,
		getResourceTrickleTooltip,
		getUpkeepTooltip,
		getLootTooltip
	].map(func => func(entState)).filter(tip => tip).join("\n");
	if (detailedTooltip)
	{
		Engine.GetGUIObjectByName("attackAndResistanceStats").hidden = false;
		Engine.GetGUIObjectByName("attackAndResistanceStats").tooltip = detailedTooltip;
	}
	else
		Engine.GetGUIObjectByName("attackAndResistanceStats").hidden = true;

	let iconTooltips = [];

	iconTooltips.push(setStringTags(primaryName, g_TooltipTextFormats.namePrimaryBig));
	iconTooltips = iconTooltips.concat([
		getVisibleEntityClassesFormatted,
		getAurasTooltip,
		getEntityTooltip,
		getTreasureTooltip
	].map(func => func(template)));

	const leftClickTooltip = hasClass(entState, "Unit") ? getFollowOnLeftClickTooltip() : getFocusOnLeftClickTooltip();
	iconTooltips.push(leftClickTooltip + " " + getTemplateViewerOnRightClickTooltip());

	Engine.GetGUIObjectByName("iconBorder").tooltip = iconTooltips.filter(tip => tip).join("\n");

	Engine.GetGUIObjectByName("detailsAreaSingle").hidden = false;
	Engine.GetGUIObjectByName("detailsAreaMultiple").hidden = true;
}

// Fills out information for multiple entities
function displayMultiple(entStates)
{
	let averageHealth = 0;
	let maxHealth = 0;
	let maxCapturePoints = 0;
	let capturePoints = (new Array(g_MaxPlayers + 1)).fill(0);
	let playerID = 0;
	const totalCarrying = {};
	const totalLoot = {};
	let garrisonSize = 0;

	for (const entState of entStates)
	{
		playerID = entState.player; // trust that all selected entities have the same owner
		if (entState.hitpoints)
		{
			averageHealth += entState.hitpoints;
			maxHealth += entState.maxHitpoints;
		}
		if (entState.capturePoints)
		{
			maxCapturePoints += entState.maxCapturePoints;
			capturePoints = entState.capturePoints.map((v, i) => v + capturePoints[i]);
		}

		const carrying = calculateCarriedResources(
			entState.resourceCarrying || null,
			entState.trader && entState.trader.goods
		);

		if (entState.loot)
			for (const type in entState.loot)
				totalLoot[type] = (totalLoot[type] || 0) + entState.loot[type];

		for (const type in carrying)
		{
			totalCarrying[type] = (totalCarrying[type] || 0) + carrying[type];
			totalLoot[type] = (totalLoot[type] || 0) + carrying[type];
		}

		if (entState.garrisonable)
			garrisonSize += entState.garrisonable.size;

		if (entState.garrisonHolder)
			garrisonSize += entState.garrisonHolder.occupiedSlots;
	}

	Engine.GetGUIObjectByName("healthMultiple").hidden = averageHealth <= 0;
	if (averageHealth > 0)
	{
		Engine.GetGUIObjectByName("healthBarMultiple").size.rtop = 100 - 100 * Math.max(0, Math.min(1, averageHealth / maxHealth));

		Engine.GetGUIObjectByName("healthMultiple").tooltip = getCurrentHealthTooltip({
			"hitpoints": averageHealth,
			"maxHitpoints": maxHealth
		});
	}

	Engine.GetGUIObjectByName("captureMultiple").hidden = maxCapturePoints <= 0;
	if (maxCapturePoints > 0)
	{
		const setCaptureBarPart = function(pID, startSize)
		{
			const unitCaptureBar = Engine.GetGUIObjectByName("captureBarMultiple[" + pID + "]");

			const height = 100 * Math.max(0, Math.min(1, capturePoints[pID] / maxCapturePoints));
			unitCaptureBar.size.rtop = startSize;
			unitCaptureBar.size.rbottom = startSize + height;

			unitCaptureBar.sprite = "color:" + g_DiplomacyColors.getPlayerColor(pID, 128);
			unitCaptureBar.hidden = false;
			return startSize + height;
		};

		let size = 0;
		for (const i in capturePoints)
			if (i != playerID)
				size = setCaptureBarPart(i, size);

		// last handle the owner's points, to keep those points on the bottom for clarity
		setCaptureBarPart(playerID, size);

		Engine.GetGUIObjectByName("captureMultiple").tooltip = getCurrentHealthTooltip(
			{
				"hitpoints": capturePoints[playerID],
				"maxHitpoints": maxCapturePoints
			},
			translate("Capture Points:"));
	}

	const numberOfUnits = Engine.GetGUIObjectByName("numberOfUnits");
	numberOfUnits.caption = entStates.length;
	numberOfUnits.tooltip = "";

	if (garrisonSize)
		numberOfUnits.tooltip = sprintf(translate("%(label)s: %(details)s\n"), {
			"label": headerFont(translate("Garrison Size")),
			"details": bodyFont(garrisonSize)
		});

	if (Object.keys(totalCarrying).length)
		numberOfUnits.tooltip = sprintf(translate("%(label)s %(details)s\n"), {
			"label": headerFont(translate("Carrying:")),
			"details": bodyFont(Object.keys(totalCarrying).filter(
				res => totalCarrying[res] != 0).map(
				res => sprintf(translate("%(type)s %(amount)s"),
					{ "type": resourceIcon(res), "amount": totalCarrying[res] })).join("  "))
		});

	if (Object.keys(totalLoot).length)
		numberOfUnits.tooltip += sprintf(translate("%(label)s %(details)s"), {
			"label": headerFont(translate("Loot:")),
			"details": bodyFont(Object.keys(totalLoot).filter(
				res => totalLoot[res] != 0).map(
				res => sprintf(translate("%(type)s %(amount)s"),
					{ "type": resourceIcon(res), "amount": totalLoot[res] })).join("  "))
		});

	// Unhide Details Area
	Engine.GetGUIObjectByName("detailsAreaMultiple").hidden = false;
	Engine.GetGUIObjectByName("detailsAreaSingle").hidden = true;
}

// Updates middle entity Selection Details Panel and left Unit Commands Panel
function updateSelectionDetails()
{
	const supplementalDetailsPanel = Engine.GetGUIObjectByName("supplementalSelectionDetails");
	const detailsPanel = Engine.GetGUIObjectByName("selectionDetails");
	const commandsPanel = Engine.GetGUIObjectByName("unitCommands");

	const entStates = [];

	for (const sel of g_Selection.toList())
	{
		const entState = GetEntityState(sel);
		if (!entState)
			continue;
		entStates.push(entState);
	}

	if (entStates.length == 0)
	{
		Engine.GetGUIObjectByName("detailsAreaMultiple").hidden = true;
		Engine.GetGUIObjectByName("detailsAreaSingle").hidden = true;
		hideUnitCommands();

		supplementalDetailsPanel.hidden = true;
		detailsPanel.hidden = true;
		commandsPanel.hidden = true;
		return;
	}

	// Fill out general info and display it
	if (entStates.length == 1)
		displaySingle(entStates[0]);
	else
		displayMultiple(entStates);

	// Show basic details.
	detailsPanel.hidden = false;

	// Fill out commands panel for specific unit selected (or first unit of primary group)
	updateUnitCommands(entStates, supplementalDetailsPanel, commandsPanel);

	// Show health bar for garrisoned units if the garrison panel is visible
	if (Engine.GetGUIObjectByName("unitGarrisonPanel") && !Engine.GetGUIObjectByName("unitGarrisonPanel").hidden)
		updateGarrisonHealthBar(entStates[0], g_Selection.toList());
}

function tradingGainString(gain, owner)
{
	// Translation: Used in the trading gain tooltip
	return sprintf(translate("%(gain)s (%(player)s)"), {
		"gain": gain,
		"player": GetSimState().players[owner].name
	});
}

/**
 * Returns a message with the details of the trade gain.
 */
function getTradingTooltip(gain)
{
	if (!gain)
		return "";

	const markets = [
		{ "gain": gain.market1Gain, "owner": gain.market1Owner },
		{ "gain": gain.market2Gain, "owner": gain.market2Owner }
	];

	let primaryGain = gain.traderGain;

	for (const market of markets)
		if (market.gain && market.owner == gain.traderOwner)
			// Translation: Used in the trading gain tooltip to concatenate profits of different players
			primaryGain += translate("+") + market.gain;

	let tooltip = tradingGainString(primaryGain, gain.traderOwner);

	for (const market of markets)
		if (market.gain && market.owner != gain.traderOwner)
			tooltip +=
				translateWithContext("Separation mark in an enumeration", ", ") +
				tradingGainString(market.gain, market.owner);

	return tooltip;
}
