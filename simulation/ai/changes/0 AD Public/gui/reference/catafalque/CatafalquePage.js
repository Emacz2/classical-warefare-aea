class CatafalquePage extends ReferencePage
{
	constructor(closePageCallback)
	{
		super(closePageCallback);

		this.Canvas = Engine.GetGUIObjectByName("canvas");
		this.Emblems = [];
		for (const emblem in this.Canvas.children)
			this.Emblems.push(new Emblem(this, this.Emblems.length));

		const civs = [];
		for (const civCode in this.civData)
			if (this.Emblems[civs.length].setCiv(civCode, this.civData[civCode]))
				civs.push(civCode);

		const canvasSize = this.Canvas.getComputedSize();
		const canvasCenterX = (canvasSize.right - canvasSize.left) / 2;
		const canvasCenterY = (canvasSize.bottom - canvasSize.top) / 2;
		const radius = Math.min(canvasCenterX, canvasCenterY) / 5 * 4;
		const angle = 2 * Math.PI / civs.length;

		for (let i = 0; i < civs.length; ++i)
			this.Emblems[i].setPosition(
				canvasCenterX + radius * Math.sin(angle * i),
				canvasCenterY + radius * -Math.cos(angle * i)
			);

		const closeButton = new CloseButton(this);
	}

	closePage()
	{
		this.closePageCallback({ "page": "page_catafalque.xml" });
	}

}


CatafalquePage.prototype.CloseButtonTooltip =
	translate("%(hotkey)s: Close Catafalque Bonuses.");
