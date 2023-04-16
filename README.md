# Flobot

[generals.io](https://generals.io/) is a fast-paced strategy game where you expand your land and battle with enemies over theirs. You lose when your general is taken, but capturing an opponent's general gives you control of their entire empire.

This bot is an AI agent that competes on the [generals.io bot server](https://bot.generals.io/).

See [developer documentation](https://dev.generals.io/).

## Build

```sh
$ npm clean-install # install required packages
$ npm run build # compile app.ts to app.js
```

## Configuration

Copy `config.json.example` to `config.json` and make updates.

1. Change `userId` to a random string.
2. Change `username` to the bot's name. According to the developer documentation, bot names must start with `[Bot]`.
3. On first run, use the `--set-username` flag to set the desired username. This flag is not required for subsequent runs.

## Usage

```
	Usage: node app.js [options] [command]

	Options:
	-V, --version          output the version number
	-n, --number <number>  number of games to play (default: 3)
	-d, --debug            enable debugging (default: false)
	-s, --set-username     attempt to set username: [Bot] Floatbot (default: false)
	-h, --help             display help for command

	Commands:
	ffa                    free for all
	1v1                    one vs one
	custom [id]            custom game
```
