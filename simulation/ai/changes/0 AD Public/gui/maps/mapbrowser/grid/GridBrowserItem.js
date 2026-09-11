class GridBrowserItem
{
	constructor(gridBrowser, imageObject, itemIndex)
	{
		this.gridBrowser = gridBrowser;
		this.itemIndex = itemIndex;
		this.imageObject = imageObject;

		imageObject.onMouseLeftPress = this.select.bind(this);
		imageObject.onMouseWheelDown = () => gridBrowser.nextPage(false);
		imageObject.onMouseWheelUp = () => gridBrowser.previousPage(false);

		gridBrowser.registerGridResizeHandler(this.onGridResize.bind(this));
		gridBrowser.registerPageChangeHandler(this.updateVisibility.bind(this));
	}

	updateVisibility()
	{
		this.imageObject.hidden =
			this.itemIndex >= Math.min(
				this.gridBrowser.itemsPerPage,
				this.gridBrowser.itemCount - this.gridBrowser.currentPage * this.gridBrowser.itemsPerRow);
	}

	onGridResize()
	{
		const gridBrowser = this.gridBrowser;
		const x = this.itemIndex % gridBrowser.columnCount;
		const y = Math.floor(this.itemIndex / gridBrowser.columnCount);
		Object.assign(this.imageObject.size, {
			"left": gridBrowser.itemWidth * x,
			"top": gridBrowser.itemHeight * y,
			"right": gridBrowser.itemWidth * (x + 1),
			"bottom": gridBrowser.itemHeight * (y + 1)
		});
		this.updateVisibility();
	}

	select()
	{
		this.gridBrowser.setSelectedIndex(
			this.itemIndex + this.gridBrowser.currentPage * this.gridBrowser.itemsPerRow);
	}
}
