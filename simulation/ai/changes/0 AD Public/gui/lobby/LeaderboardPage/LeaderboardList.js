/**
 * This is class manages the content of the leaderboardlist, i.e. the list of highest rated players.
 */
class LeaderboardList
{
	constructor(xmppMessages)
	{
		this.selectionChangeHandlers = new Set();

		this.leaderboardBox = Engine.GetGUIObjectByName("leaderboardBox");
		this.leaderboardBox.onSelectionChange = this.onSelectionChange.bind(this);

		const rebuild = this.rebuild.bind(this);
		xmppMessages.registerXmppMessageHandler("game", "leaderboard", rebuild);
		xmppMessages.registerXmppMessageHandler("system", "disconnected", rebuild);

		this.rebuild();
	}

	registerSelectionChangeHandler(handler)
	{
		this.selectionChangeHandlers.add(handler);
	}

	onSelectionChange()
	{
		const playerName = this.selectedPlayer();
		for (const handler of this.selectionChangeHandlers)
			handler(playerName);
	}

	selectedPlayer()
	{
		return this.leaderboardBox.list[this.leaderboardBox.selected] || undefined;
	}

	/**
	 * Update the leaderboard from data cached in C++.
	 */
	rebuild()
	{
		// TODO: Display placeholder if the data is not available
		const boardList = Engine.GetBoardList().sort(
			(a, b) => b.rating - a.rating);

		const list_name = [];
		const list_rank = [];
		const list_rating = [];

		boardList.forEach((entry, i) => {
			list_name.push(escapeText(entry.name));
			list_rating.push(entry.rating);
			list_rank.push(i + 1);
		});

		this.leaderboardBox.list_name = list_name;
		this.leaderboardBox.list_rating = list_rating;
		this.leaderboardBox.list_rank = list_rank;
		this.leaderboardBox.list = list_name;

		if (this.leaderboardBox.selected >= this.leaderboardBox.list.length)
			this.leaderboardBox.selected = -1;
	}
}
