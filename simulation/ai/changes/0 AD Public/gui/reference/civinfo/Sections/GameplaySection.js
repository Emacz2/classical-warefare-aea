class GameplaySection
{
	constructor(page)
	{
		this.page = page;

		this.BonusesSubsection = new BonusesSubsection(this.page);
		this.HeroesSubsection = new HeroesSubsection(this.page);
		this.StructuresSubsection = new StructuresSubsection(this.page);
		this.TechnologiesSubsection = new TechnologiesSubsection(this.page);
	}

	update(civCode, civInfo)
	{
		this.BonusesSubsection.update(civCode, civInfo);
		this.TechnologiesSubsection.update(civCode);
		this.StructuresSubsection.update(civCode);
		this.HeroesSubsection.update(civCode);
	}
}
