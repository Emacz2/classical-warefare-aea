/**
 * This code wraps the gui representing "trainer units" (a unit that can train other units) within the structree.
 *
 * An instance of this class is created for each child of the gui element named "trainers".
 */
class TrainerBox extends EntityBox
{
	constructor(page, trainerIdx)
	{
		super(page);

		this.gui = Engine.GetGUIObjectByName("trainer[" + trainerIdx + "]");
		this.ProductionRows = new ProductionRowManager(this.page, "trainer[" + trainerIdx + "]_productionRows", false);

		const rowHeight = ProductionIcon.Size().rowHeight;

		// Adjust height to accommodate production row
		this.gui.size.bottom += rowHeight;

		// We make the assumuption that all trainer boxes have the same height
		const boxHeight = (this.VMargin / 2 + (this.gui.size.bottom - this.gui.size.top + this.VMargin)) * trainerIdx;
		Object.assign(this.gui.size, {
			"top": this.gui.size.top + boxHeight,
			"bottom": this.gui.size.bottom + boxHeight,
			// Make the box adjust automatically to column width
			"rright": 100,
			"right": -this.gui.size.left,
		});
	}

	draw(templateName, civCode)
	{
		super.draw(templateName, civCode);

		this.ProductionRows.draw(this.template, civCode);

		// Return the box width
		return Math.max(this.MinWidth, this.captionWidth(), this.ProductionRows.width);
	}
}
