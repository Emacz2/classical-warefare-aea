/**
 * Take ownership of a Control/Label setup, and resize them horizontally
 * depending on the size of the label.
 * TODO: we should let JS components like that generate their XML
 * so they can be easily reused, and then move this to another folder.
 */
class LabelledControl
{
	constructor(guiObjectName)
	{
		this.control = Engine.GetGUIObjectByName(guiObjectName + "Control");
		this.label = Engine.GetGUIObjectByName(guiObjectName + "Label");
		this.resizeLabel();
	}

	setupEvents()
	{
		return this;
	}

	resizeLabel()
	{
		const labelWidth = this.label.getPreferredTextSize().width + 15;
		this.label.size.right = labelWidth;
		this.control.size.left = labelWidth;
	}
}

class LabelledDropdown extends LabelledControl
{
	setupEvents(onSelectionChange)
	{
		this.control.onSelectionChange = onSelectionChange;
		return this;
	}

	render(names, data)
	{
		const selected = this.getSelected();
		this.control.list = names;
		this.control.list_data = data;
		this.select(selected);
	}

	select(data)
	{
		this.control.selected = this.control.list_data.indexOf(data);
	}

	getSelected()
	{
		if (this.control.selected === -1)
			return undefined;
		return this.control.list_data[this.control.selected];
	}
}

class LabelledInput extends LabelledControl
{
	setupEvents(onTextEdit, onTab = () => this.blur())
	{
		this.control.onTab = onTab;
		this.control.onTextEdit = onTextEdit;
		return this;
	}

	focus()
	{
		this.control.focus();
		// focus resets cursor position
		this.control.buffer_position = this.control.caption.length;
	}

	blur()
	{
		this.control.blur();
	}

	getText()
	{
		return this.control.caption.trim();
	}
}
