# Flobot

[generals.io](https://generals.io/) is a fast-paced strategy game where you expand your land and battle with enemies over theirs. You lose when your general is taken, but capturing an opponent's general gives you control of their entire empire.

This bot is an AI agent that competes on the [generals.io bot server](https://bot.generals.io/).

See [developer documentation](https://dev.generals.io/).

## Compilation

```sh
$ npm clean-install # install required packages
$ npm i -g typescript # install typescript compiler, tsc, globally
$ tsc # compile app.ts to app.js
```

## Configuration

Rename `config.json.example` to `config.json` and make updates.

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
