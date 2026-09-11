function init()
{
	var languageList = Engine.GetGUIObjectByName("languageList");
	const displayLanguages = Engine.GetSupportedLocaleDisplayNames();
	const displayLanguagesData = Engine.GetSupportedLocaleBaseNames();
	languageList.list = displayLanguages.map((name, index) => {
		return `[locale="${displayLanguagesData[index]}"]${name}[/locale]`;
	});
	languageList.list_data = displayLanguagesData;

	var currentLocale = Engine.GetCurrentLocale();
	var currentLocaleDictName = Engine.GetFallbackToAvailableDictLocale(currentLocale);
	var index = languageList.list_data.indexOf(currentLocaleDictName);

	if (index != -1)
		languageList.selected = index;

	var localeText = Engine.GetGUIObjectByName("localeText");
	localeText.caption = currentLocale;

	return new Promise(closePageCallback => {
		Engine.GetGUIObjectByName("cancelButton").onPress = closePageCallback;
	});
}

function applySelectedLocale()
{
	var localeText = Engine.GetGUIObjectByName("localeText");
	if (!Engine.SaveLocale(localeText.caption))
	{
		warn("Selected locale could not be saved in the configuration!");
		return;
	}
	Engine.ReevaluateCurrentLocaleAndReload();
	Engine.SwitchGuiPage("page_pregame.xml");
}

function languageSelectionChanged()
{
	var languageList = Engine.GetGUIObjectByName("languageList");
	var locale = languageList.list_data[languageList.selected];
	if (locale == "long")
		warn("'long' is not an actual language, just a collection of all longest strings extracted from some languages");
	else if (!Engine.ValidateLocale(locale))
		warn("Selected locale is not valid! This is not expected, please report the issue.");
	var localeText = Engine.GetGUIObjectByName("localeText");
	localeText.caption = locale;
}

async function openAdvancedMenu()
{
	const localeText = Engine.GetGUIObjectByName("localeText");
	const locale = await Engine.OpenChildPage("page_locale_advanced.xml", { "locale": localeText.caption });

	if (!locale)
		return;

	var languageList = Engine.GetGUIObjectByName("languageList");

	var currentLocaleDictName = Engine.GetFallbackToAvailableDictLocale(locale);
	const index = languageList.list_data.indexOf(currentLocaleDictName);

	if (index != -1)
		languageList.selected = index;

	localeText.caption = locale;
}
