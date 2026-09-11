class PhaseIdentManager
{
	constructor(page)
	{
		this.page = page;
		this.idents = [];

		this.PhaseIdents = Engine.GetGUIObjectByName("phaseIdents");
		this.Idents = [];
		for (const identIdx in this.PhaseIdents.children)
			this.Idents.push(new PhaseIdent(this.page, identIdx));
	}

	draw(phaseList, civCode)
	{
		for (let i = 0; i < phaseList.length; ++i)
			this.Idents[i].draw(phaseList, civCode);

		hideRemaining(this.PhaseIdents.name, phaseList.length);
	}
}
