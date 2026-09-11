Resources = new Resources();

export function ResourcesManager(amounts = {}, population = 0)
{
	for (const key of Resources.GetCodes())
		this[key] = amounts[key] || 0;

	this.population = population > 0 ? population : 0;
}

ResourcesManager.prototype.reset = function()
{
	for (const key of Resources.GetCodes())
		this[key] = 0;
	this.population = 0;
};

ResourcesManager.prototype.canAfford = function(that)
{
	for (const key of Resources.GetCodes())
		if (this[key] < that[key])
			return false;
	return true;
};

ResourcesManager.prototype.add = function(that)
{
	for (const key of Resources.GetCodes())
		this[key] += that[key];
	this.population += that.population;
};

ResourcesManager.prototype.subtract = function(that)
{
	for (const key of Resources.GetCodes())
		this[key] -= that[key];
	this.population += that.population;
};

ResourcesManager.prototype.multiply = function(n)
{
	for (const key of Resources.GetCodes())
		this[key] *= n;
	this.population *= n;
};

ResourcesManager.prototype.Serialize = function()
{
	const amounts = {};
	for (const key of Resources.GetCodes())
		amounts[key] = this[key];
	return { "amounts": amounts, "population": this.population };
};

ResourcesManager.prototype.Deserialize = function(data)
{
	for (const key in data.amounts)
		this[key] = data.amounts[key];
	this.population = data.population;
};
