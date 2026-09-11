function init(initData)
{
	const languageList = Engine.GetGUIObjectByName("languageList");
	const countryList = Engine.GetGUIObjectByName("countryList");
	const resultingLocaleText = Engine.GetGUIObjectByName("resultingLocale");
	const scriptInput = Engine.GetGUIObjectByName("scriptInput");

	// get languageList data. Only list languages for which we have a dictionary.
	const languageListData = [];
	const languageListTmp = Engine.GetSupportedLocaleBaseNames();
	const currentLocaleLanguage = Engine.GetLocaleLanguage(initData.locale);
	for (let i = 0; i < languageListTmp.length; ++i)
	{
		const lang = Engine.GetLocaleLanguage(languageListTmp[i]);
		if (lang != "" && languageListData.indexOf(lang) == -1)
			languageListData.push(lang);
	}


	// get countryList data (we get all countries and not only the ones we have dictionaries for)
	var countryListData = [];
	var countryListTmp = Engine.GetAllLocales();
	var currentLocaleCountry = Engine.GetLocaleCountry(initData.locale);
	for (let i = 0; i < countryListTmp.length; ++i)
	{
		const country = Engine.GetLocaleCountry(countryListTmp[i]);
		if (country != "" && countryListData.indexOf(country) == -1)
			countryListData.push(country);
	}
	countryListData.sort();
	countryListData.unshift(translateWithContext("localeCountry", "None"));

	// fill the languageList
	languageList.list = languageListData;
	languageList.list_data = languageListData;
	if (languageList.list_data.indexOf(currentLocaleLanguage) != -1)
		languageList.selected = languageList.list_data.indexOf(currentLocaleLanguage);

	// fill the country list
	countryList.list = countryListData;
	countryList.list_data = countryListData;
	if (currentLocaleCountry != "")
		countryList.selected = countryList.list_data.indexOf(currentLocaleCountry);
	else
		countryList.selected = 0;

	// fill the script
	scriptInput.caption = Engine.GetLocaleScript(initData.locale);

	return new Promise(closePageCallback => {
		Engine.GetGUIObjectByName("cancelButton").onPress = closePageCallback;
		Engine.GetGUIObjectByName("acceptButton").onPress = () => {
			closePageCallback(applySelectedLocale());
		};
	});
}

// TODO: an onChanged event for input boxes would be useful and would allow us to avoid a tick event here.
function onTick()
{
	updateResultingLocale();
}

function updateResultingLocale()
{
	var languageList = Engine.GetGUIObjectByName("languageList");
	var countryList = Engine.GetGUIObjectByName("countryList");
	var resultingLocaleText = Engine.GetGUIObjectByName("resultingLocale");
	var scriptInput = Engine.GetGUIObjectByName("scriptInput");
	var variantInput = Engine.GetGUIObjectByName("variantInput");
	var dictionaryFile = Engine.GetGUIObjectByName("dictionaryFile");

	var resultingLocaleTmp = languageList.list_data[languageList.selected];

	if (scriptInput.caption != "")
		resultingLocaleTmp = resultingLocaleTmp + "_" + scriptInput.caption;

	if (countryList.selected != -1 && countryList.list_data[countryList.selected] != translateWithContext("localeCountry", "None"))
		resultingLocaleTmp = resultingLocaleTmp + "_" + countryList.list_data[countryList.selected];

	const acceptButton = Engine.GetGUIObjectByName("acceptButton");
	if (Engine.ValidateLocale(resultingLocaleTmp))
	{
		resultingLocaleText.caption = resultingLocaleTmp;
		const dictionaryFileList = Engine.GetDictionariesForLocale(Engine.GetDictionaryLocale(resultingLocaleTmp));
		let dictionaryFileString = "";
		dictionaryFileList.forEach(entry => { dictionaryFileString = dictionaryFileString + entry + "\n"; });
		dictionaryFile.caption = dictionaryFileString;
		acceptButton.enabled = true;
	}
	else
	{
		resultingLocaleText.caption = translate("invalid locale");
		dictionaryFile.caption = "";
		acceptButton.enabled = false;
	}
}

function autoDetectLocale()
{
	var languageList = Engine.GetGUIObjectByName("languageList");
	var countryList = Engine.GetGUIObjectByName("countryList");
	var scriptInput = Engine.GetGUIObjectByName("scriptInput");
	var variantInput = Engine.GetGUIObjectByName("variantInput");
	var dictionaryFile = Engine.GetGUIObjectByName("dictionaryFile");

	variantInput.caption = "";
	dictionaryFile.caption = "";
	var locale = Engine.GetDictionaryLocale("");

	languageList.selected = languageList.list_data.indexOf(Engine.GetLocaleLanguage(locale));
	countryList.selected = countryList.list_data.indexOf(Engine.GetLocaleCountry(locale));
	scriptInput.caption = Engine.GetLocaleScript(locale);
}

function applySelectedLocale()
{
	return Engine.GetGUIObjectByName("resultingLocale").caption;
}
