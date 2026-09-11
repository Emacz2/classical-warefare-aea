GameSettings.prototype.Attributes.PlayerPlacement = class PlayerPlacement extends GameSetting
{
	init()
	{
		this.available = undefined;
		this.value = undefined;
		this.settings.map.watch(() => this.onMapChange(), ["map"]);
	}

	toInitAttributes(attribs)
	{
		if (this.value !== undefined)
			attribs.settings.PlayerPlacement = this.value;
	}

	fromInitAttributes(attribs)
	{
		if (this.getLegacySetting(attribs, "PlayerPlacement"))
			this.value = this.getLegacySetting(attribs, "PlayerPlacement");
	}

	onMapChange()
	{
		if (!this.getMapSetting("PlayerPlacements"))
		{
			this.value = undefined;
			this.available = undefined;
			return;
		}
		// TODO: should probably validate that they fit one of the known schemes.
		this.available = this.getMapSetting("PlayerPlacements");
		this.value = "random";
	}

	setValue(val)
	{
		if (this.available)
		{
			this.value = val ?? "random";
			return;
		}

		if (val !== undefined)
			throw new Error("This map doesn't support player placements");
	}

	pickRandomItems()
	{
		// If the map is random, we need to wait until it is selected.
		if (this.settings.map.map === "random" || this.value !== "random" || !this.available)
			return false;

		this.value = pickRandom(this.available);
		return true;
	}
};
