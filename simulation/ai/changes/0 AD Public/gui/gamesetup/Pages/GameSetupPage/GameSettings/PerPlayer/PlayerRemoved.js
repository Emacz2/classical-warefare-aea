GameSettings.prototype.Attributes.PlayerRemoved = class PlayerRemoved extends GameSetting
{
	init()
	{
		// NB: watchers aren't auto-triggered when modifying array elements.
		this.values = [];
		this.settings.playerCount.watch(() => this.maybeUpdate(), ["nbPlayers"]);
	}

	toInitAttributes(attribs)
	{
		if (!attribs.settings.PlayerData)
			attribs.settings.PlayerData = [];
		while (attribs.settings.PlayerData.length < this.values.length)
			attribs.settings.PlayerData.push({});
		for (let i = 0; i < this.values.length; ++i)
			attribs.settings.PlayerData[i].Removed = this.values[i] ?? false;
	}

	fromInitAttributes(attribs)
	{
		if (!this.getLegacySetting(attribs, "PlayerData"))
			return;
		const pData = this.getLegacySetting(attribs, "PlayerData");
		for (let i = 0; i < this.values.length; ++i)
		{
			if (!pData[i])
			{
				this.set(+i, false);
				continue;
			}
			this.set(+i, pData[i].Removed);
		}
	}

	_resize(nb)
	{
		while (this.values.length > nb)
			this.values.pop();
		while (this.values.length < nb)
			this.values.push(false);
	}

	maybeUpdate()
	{
		if (this.values.length === this.settings.playerCount.nbPlayers)
			return;
		this._resize(this.settings.playerCount.nbPlayers);
		this.trigger("values");
	}

	swap(sourceIndex, targetIndex)
	{
		[this.values[sourceIndex], this.values[targetIndex]] = [this.values[targetIndex], this.values[sourceIndex]];
		this.trigger("values");
	}

	set(playerIndex, removed)
	{
		this.values[playerIndex] = removed;
		this.trigger("values");
	}

	get(playerIndex)
	{
		return this.values[playerIndex] ?? false;
	}
};