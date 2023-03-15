const { Command } = require('commander')
import Redis = require('redis')
import io = require('socket.io-client')

import fs = require('node:fs')
import util = require('node:util')

import Bot = require('./scripts/bot')

// program flow setup

let gameType: GameType
let customGameId: string

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'))
const gameConfig = config.gameConfig
const redisConfig = config.redisConfig

interface Log {
	out: (msg: string) => void,
	err: (msg: string) => void,
	debug: (msg: string) => void,
}

const log: Log = {
	out: (msg: string) => console.log(new Date().toISOString(), msg),
	err: (msg: string) => console.error(new Date().toISOString(), msg),
	debug: (msg: string) => { if (options.debug) console.error(new Date().toISOString(), msg) },
}

process.once('SIGINT', async (code) => {
	log.err('Interrupted. Exiting gracefully.')
	await socket.disconnect()
	redisClient.quit()
})

process.once('SIGTERM', async (code) => {
	log.err('Terminated. Exiting gracefully.')
	redisClient.quit()
	socket.disconnect()
})

// data structures and definitions

const enum GameType {
	FFA,
	OneVsOne,
	Custom
}

// redis setup

const REDIS_CHANNEL = 'flobot-' + gameConfig.username
const redisClient = Redis.createClient({
	url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:443`,
	socket: {
		tls: true,
		servername: redisConfig.HOST,
	}
})
redisClient.on('error', (error: Error) => console.error('[Redis]', error))
redisClient.connect()

// socket.io setup
let socket = io(gameConfig.endpoint, {
	rejectUnauthorized: false,
	transports: ['websocket']
})

socket.on("error", (error: Error) => console.error('[socket.io]', error))
socket.on("connect_error", (error: Error) => console.error('[socket.io]', error))

// parse commands and options

const program = new Command()
program
	.name(pkg.name)
	.version(pkg.version)
	.description(pkg.description)
	.option('-n, --number <number>', 'number of games to play', parseInt, 3)
	.option('-d, --debug', 'enable debugging', false)
	.showHelpAfterError()

program
	.command('ffa')
	.description('free for all')
	.action(() => gameType = GameType.FFA)

program
	.command('1v1')
	.description('one vs one')
	.action(() => gameType = GameType.OneVsOne)

program
	.command('custom')
	.argument('[id]', 'custom game id', gameConfig.customGameId)
	.description('custom game')
	.action((id) => {
		gameType = GameType.Custom
		customGameId = id
	})

program.parse()
const options = program.opts()

log.debug("debugging enabled")
log.debug(gameConfig)

// gameplay setup

let bot: Bot
let playerIndex: number
let replay_id: string = ""
let usernames: string[]
let numberOfGames = options.number

socket.on('connect', async () => {
	log.out('connected')
	redisClient.publish(REDIS_CHANNEL, 'connected')
	joinGame()
})

socket.on('disconnect', async (reason: string) => {
	// exit if disconnected intentionally; auto-reconnect otherwise
	await redisClient.publish(REDIS_CHANNEL, 'disconnected ' + reason)
	switch (reason) {
		case 'io server disconnect':
			console.error("disconnected: " + reason)
			process.exit(3)
		case 'io client disconnect':
			process.exit(0)
		default:
			console.error("disconnected: " + reason)
	}
})

socket.on('game_start', (data: { playerIndex: number; replay_id: string; usernames: string[]; chat_room: string; }) => {
	// Get ready to start playing the game.
	playerIndex = data.playerIndex
	bot = undefined
	replay_id = data.replay_id
	usernames = data.usernames
	redisClient.publish(REDIS_CHANNEL, 'game_start ' + replay_id)
	log.out(`[game_start] replay: ${replay_id}, users: ${usernames}`)
	socket.emit('chat_message', data.chat_room, gameConfig.warCry)
})

socket.on('game_update', (data: object) => {
	if (bot === undefined) {
		// create the bot on first game update
		bot = new Bot(socket, playerIndex, data)
	} else {
		bot.update(data)
	}
})

socket.on('game_lost', (data: { killer: string }) => {
	redisClient.publish(REDIS_CHANNEL, `game_lost ${replay_id}, killer: ${usernames[data.killer]}`)
	log.out(`[game_lost] ${replay_id}, killer: ${usernames[data.killer]}`)
	socket.emit('leave_game')
	bot = undefined
	playAgain()
})

socket.on('game_won', () => {
	redisClient.publish(REDIS_CHANNEL, `game_won ${replay_id}`)
	log.out(`[game_won] ${replay_id}`)
	socket.emit('leave_game')
	bot = undefined
	playAgain()
})

socket.on('chat_message', (chat_room: string, data: { username: string, playerIndex: number, text: string }) => {
	if(data.username)
		redisClient.publish(REDIS_CHANNEL, `chat_message [${data.username}] ${data.text}`)
});

function joinGame() {
	switch (gameType) {
		case GameType.FFA:
			socket.emit('set_username', gameConfig.userId, gameConfig.username)
			socket.emit('play', gameConfig.userId)
			socket.emit('set_force_start', null, true)
			log.out('[joined] FFA')
			redisClient.publish(REDIS_CHANNEL, 'joined FFA')
			break
		case GameType.OneVsOne:
			socket.emit('set_username', gameConfig.userId, gameConfig.username)
			socket.emit('join_1v1', gameConfig.userId)
			log.out('[joined] 1v1')
			redisClient.publish(REDIS_CHANNEL, 'joined 1v1')
			break
		case GameType.Custom:
			socket.emit('set_username', gameConfig.userId, gameConfig.username)
			socket.emit('join_private', customGameId, gameConfig.userId)
			setTimeout(() => socket.emit('set_force_start', customGameId, true), 1000)
			// socket.emit('set_force_start', customGameId, true)
			log.out(`[joined] custom: ${customGameId}`)
			redisClient.publish(REDIS_CHANNEL, `joined custom: ${customGameId}`)
			break
	}
}

function playAgain() {
	numberOfGames--
	if (numberOfGames > 0) {
		setTimeout(() => joinGame(), 1000)
	} else {
		socket.disconnect()
	}
}
