const { Command } = require('commander')
import Redis = require('redis')
import io = require('socket.io-client')

import fs = require('node:fs')

import Bot = require('./scripts/bot')

// program flow setup

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'))
const gameConfig = config.gameConfig
const redisConfig = config.redisConfig
// create a unique botId by hashing gameConfig.userId
gameConfig.botId = require('crypto').createHash('sha256').update(gameConfig.userId).digest('base64').replace(/[^\w\s]/gi, '').slice(-7)
const REDIS_CHANNEL = 'flobot-' + gameConfig.botId

interface Log {
	stdout: (msg: string) => void,
	stderr: (msg: string) => void,
	debug: (msg: string) => void,
	redis: (msg: string) => void,
}

const log: Log = {
	stdout: (msg: string) => console.log(new Date().toISOString(), msg),
	stderr: (msg: string) => console.error(new Date().toISOString(), msg),
	debug: (msg: string) => { if (options.debug) console.error(new Date().toISOString(), msg) },
	redis: (msg: string) => { if (redisClient !== undefined) redisClient.publish(REDIS_CHANNEL, msg) },
}

process.once('SIGINT', async (code) => {
	log.stderr('Interrupted. Exiting gracefully.')
	await socket.disconnect()
	redisClient.quit()
})

process.once('SIGTERM', async (code) => {
	log.stderr('Terminated. Exiting gracefully.')
	redisClient.quit()
	socket.disconnect()
})

// data structures and definitions

const enum GameType {
	FFA,
	OneVsOne,
	Custom
}

let gameType: GameType

// redis setup

let redisClient = undefined
if (redisConfig.HOST !== undefined) {
	redisClient = Redis.createClient({
		url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:443`,
		socket: {
			tls: true,
			servername: redisConfig.HOST,
		}
	})
	redisClient.on('error', (error: Error) => console.error('[Redis]', error))
	redisClient.connect()
}

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
	.option('-s, --set-username', `attempt to set username: ${gameConfig.username}`, false)
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
		gameConfig.customGameId = id
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
	log.stdout(`[connected] ${gameConfig.username}`)
	if (options.setUsername) {
		socket.emit('set_username', gameConfig.userId, gameConfig.username)
	}
	log.redis(`connected ${gameConfig.username}`)
	joinGame()
})

socket.on('disconnect', async (reason: string) => {
	// exit if disconnected intentionally; auto-reconnect otherwise
	await log.redis('disconnected ' + reason)
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

socket.on('error_set_username', (message: string) => {
	if (message === '')
		message = `username set to ${gameConfig.username}`
	log.stdout(`[error_set_username] ${message}`)
})

socket.on('game_start', (data: { playerIndex: number; replay_id: string; usernames: string[]; chat_room: string; }) => {
	// Get ready to start playing the game.
	playerIndex = data.playerIndex
	bot = undefined
	replay_id = data.replay_id
	usernames = data.usernames
	log.stdout(`[game_start] replay: ${replay_id}, users: ${usernames}`)
	log.redis('game_start ' + replay_id)

	// iterate over gameConfig.warCry to send chat messages
	function later(delay: number) {
		return new Promise(function (resolve) {
			setTimeout(resolve, delay)
		})
	}

	for (let i = 0; i < gameConfig.warCry.length; i++) {
		later(1000 * i).then(() => {
			socket.emit('chat_message', data.chat_room, gameConfig.warCry[i])
		})
	}
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
	log.stdout(`[game_lost] ${replay_id}, killer: ${usernames[data.killer]}`)
	log.redis(`game_lost ${replay_id}, killer: ${usernames[data.killer]}`)
	socket.emit('leave_game')
	bot = undefined
	playAgain()
})

socket.on('game_won', () => {
	log.stdout(`[game_won] ${replay_id}`)
	log.redis(`game_won ${replay_id}`)
	socket.emit('leave_game')
	bot = undefined
	playAgain()
})

socket.on('chat_message', (chat_room: string, data: { username: string, playerIndex: number, text: string }) => {
	if (data.username)
		log.redis(`chat_message [${data.username}] ${data.text}`)
});

function joinGame() {
	switch (gameType) {
		case GameType.FFA:
			socket.emit('play', gameConfig.userId)
			socket.emit('set_force_start', null, true)
			log.stdout('[joined] FFA')
			log.redis('joined FFA')
			break
		case GameType.OneVsOne:
			socket.emit('join_1v1', gameConfig.userId)
			log.stdout('[joined] 1v1')
			log.redis('joined 1v1')
			break
		case GameType.Custom:
			socket.emit('join_private', gameConfig.customGameId, gameConfig.userId)
			setTimeout(() => socket.emit('set_force_start', gameConfig.customGameId, true), 1000)
			// socket.emit('set_force_start', gameConfig.customGameId, true)
			log.stdout(`[joined] custom: ${gameConfig.customGameId}`)
			log.redis(`joined custom: ${gameConfig.customGameId}`)
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
