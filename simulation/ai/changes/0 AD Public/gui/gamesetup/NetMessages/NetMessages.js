/**
 * Convenience wrapper to poll messages from the C++ NetClient.
 */
class NetMessages
{
	constructor(setupWindow)
	{
		this.netMessageHandlers = {};

		for (const messageType of this.MessageTypes)
			this.netMessageHandlers[messageType] = new Set();
	}

	registerNetMessageHandler(messageType, handler)
	{
		if (this.netMessageHandlers[messageType])
			this.netMessageHandlers[messageType].add(handler);
		else
			error("Unknown net message type: " + uneval(messageType));
	}

	unregisterNetMessageHandler(messageType, handler)
	{
		if (this.netMessageHandlers[messageType])
			this.netMessageHandlers[messageType].delete(handler);
		else
			error("Unknown net message type: " + uneval(messageType));
	}

	pollPendingMessages()
	{
		while (true)
		{
			const message = Engine.PollNetworkClient();
			if (!message)
				break;

			log("Net message: " + uneval(message));

			if (this.netMessageHandlers[message.type])
				for (const handler of this.netMessageHandlers[message.type])
					handler(message);
			else
				error("Unrecognized net message type " + message.type);
		}
	}
}

/**
 * List of message types sent by C++ (keep this in sync with NetClient.cpp).
 */
NetMessages.prototype.MessageTypes = [
	"chat",
	"ready",
	"gamesetup",
	"kicked",
	"netstatus",
	"netwarn",
	"players",
	"start"
];
