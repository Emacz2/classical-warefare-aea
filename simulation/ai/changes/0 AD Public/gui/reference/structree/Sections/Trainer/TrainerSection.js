class TrainerSection
{
	constructor(page)
	{
		this.page = page;
		this.width = 0;
		this.widthChangedHandlers = new Set();

		this.TrainerSection = Engine.GetGUIObjectByName("trainerSection");
		this.Trainers = Engine.GetGUIObjectByName("trainers");

		this.TrainerSectionHeading = Engine.GetGUIObjectByName("trainerSectionHeading");
		this.TrainerSectionHeading.caption = this.Caption;

		this.trainerBoxes = [];
		for (const boxIdx in this.Trainers.children)
			this.trainerBoxes.push(new TrainerBox(this.page, boxIdx));
	}

	registerWidthChangedHandler(handler)
	{
		this.widthChangedHandlers.add(handler);
	}

	draw(units, civCode)
	{
		const caption = this.TrainerSectionHeading;
		this.width = caption.getPreferredTextSize().width + caption.size.left;
		let count = 0;

		for (const unitCode of units.keys())
		{
			const unitTemplate = this.page.TemplateParser.getEntity(unitCode, civCode);
			if (!unitTemplate.production.units.length && !unitTemplate.production.techs.length && !unitTemplate.upgrades)
				continue;

			if (count > this.trainerBoxes.length)
			{
				error("\"" + this.activeCiv + "\" has more unit trainers than can be supported by the current GUI layout");
				break;
			}

			this.width = Math.max(
				this.width,
				this.trainerBoxes[count].draw(unitCode, civCode)
			);

			++count;
		}
		hideRemaining(this.Trainers.name, count);

		// Update width and visibility of section
		this.width += EntityBox.prototype.HMargin;
		this.TrainerSection.size.left = -this.width + this.TrainerSection.size.right;
		this.TrainerSection.hidden = count == 0;

		for (const handler of this.widthChangedHandlers)
			handler(this.width, !this.TrainerSection.hidden);
	}

	isVisible()
	{
		return !this.TrainerSection.hidden;
	}
}

TrainerSection.prototype.Caption =
	translate("Trainer Units");
