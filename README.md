# Flobot

[generals.io](https://generals.io/) is a fast-paced strategy game where you expand your land and battle with enemies over theirs. You lose when your general is taken, but capturing an opponent's general gives you control of their entire empire.

This bot is an AI agent that competes on the [generals.io bot server](https://bot.generals.io/). It is used to provide a consistent adversary while testing other bots.

See [Generally Genius](https://corsaircoalition.github.io/) (GG) framework to develop your own bot!

## Configuration

Download `config.example.json` from the [documentation repository](https://github.com/CorsairCoalition/docs) and make desired changes.

## Execution

Install and run the executable:

```sh
npm install -g @corsaircoalition/flobot
flobot config.json
```

or run directly from npm library:

```sh
npx @corsaircoalition/flobot config.json
```

or use docker:

```sh
docker run -it -v ./config.json:/config.json ghcr.io/corsaircoalition/flobot:latest
```

## Usage

```
Usage: @corsaircoalition/flobot [options] <configFile>

reference bot implementation for generals.io using a combination of heuristics and graph algorithms

Options:
  -V, --version                   output the version number
  -n, --number-of-games <number>  number of games to play (default: "1")
  -d, --debug                     enable debugging (default: false)
  -h, --help                      display help for command
```
