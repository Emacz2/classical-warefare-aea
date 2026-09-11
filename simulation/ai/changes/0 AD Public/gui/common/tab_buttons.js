/**
 * Number of categories.
 */
var g_TabCategoryCount;

/**
 * Align the buttons horizontally or vertically.
 */
var g_TabHorizontal;

/**
 * Index of the currently visible tab, set first tab as default.
 */
var g_TabCategorySelected = 0;

/**
 * Function to be executed when selecting a tab. The new category index is passed.
 */
var g_OnSelectTab;

/**
 * Create tab buttons.
 *
 * @param {Array} categoriesData - Arrays of objects containing for every tab a (translated) label and tooltip.
 * @param {boolean} horizontal - Have the tabs horizontally or vertically aligned.
 * @param {number} buttonSize - Size of a button in the specified direction.
 * @param {number} spacing - Distance between two buttons in the specified direction.
 * @param {function} onPress - Function to be executed when a button is pressed, it gets the new category index passed.
 * @param {function} onSelect - Function to be executed whenever the selection changes (so also for scrolling), it gets the new category index passed.
 */
function placeTabButtons(categoriesData, horizontal, buttonSize, spacing, onPress, onSelect)
{
	g_TabCategoryCount = categoriesData.length;
	g_TabHorizontal = horizontal;
	g_OnSelectTab = onSelect;

	for (const category in categoriesData)
	{
		const button = Engine.GetGUIObjectByName("tabButton[" + category + "]");
		if (!button)
		{
			warn("Too few tab-buttons!");
			break;
		}

		button.style = "ModernTabButton" + (horizontal ? "Horizontal" : "Vertical");
		button.hidden = false;

		if (horizontal)
		{
			button.size.left = category * (buttonSize + spacing) + spacing / 2;
			button.size.right = button.size.left + buttonSize;
			button.size.rright = 0;
		}
		else
		{
			button.size.top = category * (buttonSize + spacing) + spacing / 2;
			button.size.bottom = button.size.top + buttonSize;
			button.size.rbottom = 0;
		}

		button.tooltip = (categoriesData[category].tooltip ? categoriesData[category].tooltip + "\n" : "") +
			(g_TabHorizontal ?
				colorizeHotkey(translate("Scroll down or use %(hotkey)s to move a tab right."), "tab.next") + "\n" + colorizeHotkey(translate("Scroll up or use %(hotkey)s to move a tab left."), "tab.prev"):
				colorizeHotkey(translate("Scroll down or use %(hotkey)s to move a tab down."), "tab.next") + "\n" + colorizeHotkey(translate("Scroll up or use %(hotkey)s to move a tab up."), "tab.prev"));

		const categoryNum = +category;
		button.onPress = () => { onPress(categoryNum); };

		Engine.GetGUIObjectByName("tabButtonText[" + category + "]").caption = categoriesData[category].label;
	}

	selectPanel(g_TabCategorySelected);
}

/**
 * Show next/previous panel.
 * @param direction - +1/-1 for forward/backward.
 */
function selectNextTab(direction)
{
	if (g_TabCategoryCount)
		selectPanel(g_TabCategorySelected === undefined ?
			direction > 0 ?
				0 :
				g_TabCategoryCount - 1 :
			(g_TabCategorySelected + direction + g_TabCategoryCount) % g_TabCategoryCount);
}

function selectPanel(category)
{
	g_TabCategorySelected = category;
	Engine.GetGUIObjectByName("tabButtons").children.forEach((button, j) => {
		button.sprite = g_TabHorizontal ?
			category == j ?
				"ModernTabHorizontalForeground" :
				"ModernTabHorizontalBackground" :
			category == j ?
				"ModernTabVerticalForeground" :
				"ModernTabVerticalBackground";
	});

	if (g_OnSelectTab)
		g_OnSelectTab(category);
}
