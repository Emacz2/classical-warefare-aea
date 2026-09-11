/**
 * This is a transient page, triggered at the end of a game session,
 * to perform custom computations on the endgame data.
 */

function init(endGameData)
{
	const run = CampaignRun.getCurrentRun();
	if (endGameData.won)
		markLevelComplete(run, endGameData.initData.levelID);
}
