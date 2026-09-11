class BackgroundLayer
{
	constructor(layer, i)
	{
		this.layer = layer;

		this.background = Engine.GetGUIObjectByName("background[" + i + "]");
		this.background.sprite = this.layer.sprite;
		this.background.z = i;
		this.background.hidden = false;
	}

	update(time, backgroundsSize)
	{
		const height = backgroundsSize.bottom - backgroundsSize.top;
		const width = height * this.AspectRatio;
		const offset = this.layer.offset(time / 1000, width);

		if (this.layer.tiling)
		{
			const iw = height * 2;
			let left = offset % iw;
			if (left >= 0)
				left -= iw;
			this.background.size = {
				"left": left,
				"top": backgroundsSize.top,
				"right": backgroundsSize.right,
				"bottom": backgroundsSize.bottom
			};
		}
		else
		{
			const right = backgroundsSize.right / 2 + offset;
			this.background.size = {
				"left": right - height,
				"top": backgroundsSize.top,
				"right": right + height,
				"bottom": backgroundsSize.bottom
			};
		}
	}
}

export class BackgroundHandler
{
	constructor(layers)
	{
		this.backgroundLayers = layers.map((layer, i) =>
			new BackgroundLayer(layer, i));

		this.initTime = Date.now();

		this.backgrounds = Engine.GetGUIObjectByName("backgrounds");
		this.backgrounds.onTick = this.onTick.bind(this);
		this.backgrounds.onWindowResized = this.onWindowResized.bind(this);
		this.onWindowResized();
	}

	onWindowResized()
	{
		const size = this.backgrounds.getComputedSize();
		this.backgroundsSize = { "left": size.top, "top": size.left, "right": size.right, "bottom": size.bottom };
	}

	onTick()
	{
		const time = Date.now() - this.initTime;
		for (const background of this.backgroundLayers)
			background.update(time, this.backgroundsSize);
	}
}

BackgroundLayer.prototype.AspectRatio = 16 / 9;
