/**
 * Properties of this prototype are classes that subscribe to one or more events and
 * construct a formatted chat message to be displayed on that event.
 *
 * Important: Apply escapeText on player provided input to avoid players breaking the game for everybody.
 */
class ChatMessageEvents
{
}

class ChatPanel
{
	constructor(xmppMessages)
	{
		this.systemMessageFormat = new SystemMessageFormat();
		this.statusMessageFormat = new StatusMessageFormat();

		this.chatMessagesPanel = new ChatMessagesPanel(xmppMessages);
		this.chatInputPanel = new ChatInputPanel(xmppMessages, this.chatMessagesPanel, this.systemMessageFormat);

		this.chatMessageEvents = {};
		for (const name in ChatMessageEvents)
			this.chatMessageEvents[name] = new ChatMessageEvents[name](
				xmppMessages, this.chatMessagesPanel, this.statusMessageFormat, this.systemMessageFormat);

		this.chatSubmit = Engine.GetGUIObjectByName("chatSubmit");
		resizeGUIObjectToCaption(this.chatSubmit, { "horizontal": "left" }, { "horizontal": 8 });

		this.chatInput = Engine.GetGUIObjectByName("chatInput");
		this.chatInput.size.right = this.chatSubmit.size.left;
	}
}
