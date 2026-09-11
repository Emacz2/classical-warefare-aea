var g_TermsButtonHeight = 38;

function initLobbyTerms()
{
	const termsURL = Engine.ConfigDB_GetValue("user", "lobby.terms_url");

	const terms = {
		"Service": {
			"title": translate("Terms of Service"),
			"instruction": translate("Please read and accept the Terms of Service."),
			"file": "gui/prelobby/common/terms/Terms_of_Service.txt",
			"termsURL": termsURL + "Terms_of_Service.txt",
			"config": "lobby.terms_of_service",
			"salt": () => Engine.GetGUIObjectByName("username").caption,
			"accepted": false,
			"callback": updateFeedback
		},
		"Use": {
			"title": translate("Terms of Use"),
			"instruction": translate("Please read and accept the Terms of Use."),
			"file": "gui/prelobby/common/terms/Terms_of_Use.txt",
			"termsURL": termsURL + "Terms_of_Use.txt",
			"config": "lobby.terms_of_use",
			"salt": () => Engine.GetGUIObjectByName("username").caption,
			"accepted": false,
			"callback": updateFeedback
		},
		"Privacy": {
			"title": translate("Privacy Policy"),
			"instruction": translate("Please read and accept the Privacy Policy."),
			"file": "gui/prelobby/common/terms/Privacy_Policy.txt",
			"termsURL": termsURL + "Privacy_Policy.txt",
			"config": "lobby.privacy_policy",
			"salt": () => Engine.GetGUIObjectByName("username").caption,
			"accepted": false,
			"callback": updateFeedback
		}
	};

	Object.keys(terms).forEach((page, i) => {

		const button = Engine.GetGUIObjectByName("termsButton[" + i + "]");

		button.caption = terms[page].title;

		button.onPress = () => {
			openTerms(page);
		};

		button.size.top = i * g_TermsButtonHeight;
		button.size.bottom = i * g_TermsButtonHeight + 28;
	});

	initTerms(terms);
	loadTermsAcceptance();
}
