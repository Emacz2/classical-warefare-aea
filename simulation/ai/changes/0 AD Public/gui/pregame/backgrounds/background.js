export const backgrounds = {
	"carthage": [
		{
			"offset": (time, width) => 0.02 * width * Math.cos(0.05 * time),
			"sprite": "background-carthage1-1",
			"tiling": true,
		},
		{
			"offset": (time, width) => 0.04 * width * Math.cos(0.05 * time),
			"sprite": "background-carthage1-2",
			"tiling": true,
		},
		{
			"offset": (time, width) => 0.10 * width * Math.cos(0.05 * time),
			"sprite": "background-carthage1-3",
			"tiling": false,
		},
		{
			"offset": (time, width) => 0.18 * width * Math.cos(0.05 * time),
			"sprite": "background-carthage1-4",
			"tiling": false,
		},
	],

	"hellenes": [
		{
			"offset": (time, width) => 0.02 * width * Math.cos(0.05 * time),
			"sprite": "background-hellenes1-1",
			"tiling": true,
		},
		{
			"offset": (time, width) => 0.12 * width * Math.cos(0.05 * time) - width / 10,
			"sprite": "background-hellenes1-2",
			"tiling": false,
		},
		{
			"offset": (time, width) => 0.16 * width * Math.cos(0.05 * time) + width / 4,
			"sprite": "background-hellenes1-3",
			"tiling": false,
		},
	],

	"kush": [
		{
			"offset": (time, width) => 0.07 * width * Math.cos(0.1 * time),
			"sprite": "background-kush1-1",
			"tiling": true
		},
		{
			"offset": (time, width) => 0.05 * width * Math.cos(0.1 * time),
			"sprite": "background-kush1-2",
			"tiling": true
		},
		{
			"offset": (time, width) => 0.04 * width * Math.cos(0.1 * time) + 0.01 * width * Math.cos(0.04 * time),
			"sprite": "background-kush1-3",
			"tiling": true
		},
		{
			"offset": (time, width) => -0.1,
			"sprite": "background-kush1-4",
			"tiling": true
		}
	],

	"seleucid": [
		{
			"offset": (time, width) => 0.05 * width * Math.cos(0.02 * time),
			"sprite": "background-seleucid1_1",
			"tiling": true,
		},
		{
			"offset": (time, width) => 0.10 * width * Math.cos(0.04 * time),
			"sprite": "background-seleucid1_2",
			"tiling": true,
		},
		{
			"offset": (time, width) => 0.17 * width * Math.cos(0.05 * time) + width / 8,
			"sprite": "background-seleucid1_3",
			"tiling": false,
		},
	]
};
