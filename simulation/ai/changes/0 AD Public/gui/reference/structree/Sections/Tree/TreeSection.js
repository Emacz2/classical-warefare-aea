class TreeSection
{
	constructor(page)
	{
		this.page = page;

		this.TreeSection = Engine.GetGUIObjectByName("treeSection");
		this.Structures = Engine.GetGUIObjectByName("structures");

		this.PhaseIdents = new PhaseIdentManager(this.page);

		this.rightMargin = this.TreeSection.size.right;
		this.vMargin = this.TreeSection.size.top + -this.TreeSection.size.bottom;

		this.structureBoxes = [];
		for (const boxIdx in this.Structures.children)
			this.structureBoxes.push(new StructureBox(this.page, boxIdx));

		page.TrainerSection.registerWidthChangedHandler(this.onTrainerSectionWidthChange.bind(this));
	}

	draw(structures, civCode)
	{
		if (structures.size > this.structureBoxes.length)
			error("\"" + this.activeCiv + "\" has more structures than can be supported by the current GUI layout");

		this.Structures.resetScrollPosition();

		// Draw structures
		const phaseList = this.page.TemplateParser.phaseList;
		const count = Math.min(structures.size, this.structureBoxes.length);
		const runningWidths = Array(phaseList.length).fill(0);
		const structureIterator = structures.keys();
		for (let idx = 0; idx < count; ++idx)
			this.structureBoxes[idx].draw(structureIterator.next().value, civCode, runningWidths);
		hideRemaining(this.Structures.name, count);

		// Position phase idents
		this.PhaseIdents.draw(phaseList, civCode);
	}

	drawPhaseIcon(phaseIcon, phaseIndex, civCode)
	{
		const phaseName = this.page.TemplateParser.phaseList[phaseIndex];
		const prodPhaseTemplate = this.page.TemplateParser.getTechnology(phaseName + "_" + civCode, civCode) || this.page.TemplateParser.getTechnology(phaseName, civCode);

		phaseIcon.sprite = "stretched:" + this.page.IconPath + prodPhaseTemplate.icon;
		phaseIcon.tooltip = getEntityNamesFormatted(prodPhaseTemplate);
	}

	onTrainerSectionWidthChange(trainerSectionWidth, trainerSectionVisible)
	{
		this.TreeSection.size.right = this.rightMargin;
		if (trainerSectionVisible)
			this.TreeSection.size.right -= trainerSectionWidth + this.page.SectionGap;
	}

	/**
	 * Calculate row position offset (accounting for different number of prod rows per phase).
	 *
	 * This is a static method as it is also used from within the StructureBox and PhaseIdent classes.
	 *
	 * @param {number} idx
	 * @return {number}
	 */
	static getPositionOffset(idx, TemplateParser)
	{
		const phases = TemplateParser.phaseList.length;
		const rowHeight = ProductionIcon.Size().rowHeight;

		let size = EntityBox.IconAndCaptionHeight() * idx; // text, image and offset
		size += EntityBox.prototype.VMargin * (idx + 1); // Margin above StructureBoxes
		size += rowHeight * (phases * idx - (idx - 1) * idx / 2); // phase rows (phase-currphase+1 per row)

		return size;
	}

}
