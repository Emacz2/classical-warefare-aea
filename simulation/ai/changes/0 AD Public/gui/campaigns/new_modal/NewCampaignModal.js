/**
 * Modal screen that pops up when you start a new campaign from the setup screen.
 * asking you to name it.
 * Will then create the file with the according name and start everything up.
 */
class NewCampaignModal
{
	constructor(campaignTemplate, closePageCallback)
	{
		this.template = campaignTemplate;

		Engine.GetGUIObjectByName('cancelButton').onPress = closePageCallback;
		Engine.GetGUIObjectByName('startButton').onPress = () => this.createAndStartCampaign();
		Engine.GetGUIObjectByName('runDescription').caption = translateWithContext("Campaign Template", this.template.Name);
		Engine.GetGUIObjectByName('runDescription').onTextEdit = () => {
			Engine.GetGUIObjectByName('startButton').enabled = Engine.GetGUIObjectByName('runDescription').caption.length > 0;
		};
		Engine.GetGUIObjectByName('runDescription').focus();
	}

	createAndStartCampaign()
	{
		const filename = this.template.identifier + "_" + Date.now() + "_" + Math.floor(Math.random()*100000);
		const run = new CampaignRun(filename)
			.setTemplate(this.template)
			.setMeta(Engine.GetGUIObjectByName('runDescription').caption)
			.save()
			.setCurrent();

		Engine.SwitchGuiPage(run.getMenuPath(), {
			"filename": run.filename
		});
	}
}


var g_NewCampaignModal;

function init(campaign_template_data)
{
	return new Promise(closePageCallback => {
		g_NewCampaignModal = new NewCampaignModal(campaign_template_data, closePageCallback);
	});
}
