const { Command } = require('commander')
import Redis = require('redis')
import io = require('socket.io-client')
import fs = require('node:fs')
import Bot = require('./scripts/bot')

// configuration

const GAME_SERVER_URL = 'wss://botws.generals.io/'
const DEFAULT_NUMBER_OF_GAMES = 3
const DEFAULT_CUSTOM_GAME_SPEED = 4

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'))
const gameConfig = config.gameConfig
const redisConfig = config.redisConfig
// create a unique botId by hashing gameConfig.userId
gameConfig.botId = require('crypto').createHash('sha256').update(gameConfig.userId).digest('base64').replace(/[^\w\s]/gi, '').slice(-7)
gameConfig.customGameSpeed = gameConfig.customGameSpeed || DEFAULT_CUSTOM_GAME_SPEED
const REDIS_CHANNEL = 'flobot-' + gameConfig.botId
redisConfig.PORT = redisConfig.PORT || 443

// program flow setup

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
	if (gameJoined) {
		await socket.emit('leave_game')
		log.debug('sent: leave_game')
	}
	await socket.disconnect()
	redisClient.quit()
})

process.once('SIGTERM', async (code) => {
	log.stderr('Terminated. Exiting gracefully.')
	if (gameJoined) {
		socket.emit('leave_game')
		log.debug('sent: leave_game')
	}
	await socket.disconnect()
	redisClient.quit()
})

// data structures and definitions

const enum GameType {
	FFA,
	OneVsOne,
	Custom
}

let gameType: GameType
let bot: Bot
let playerIndex: number
let replay_id: string = ""
let usernames: string[]
let currentGameNumber: number = 0
let numberOfGames: number
let gameJoined: boolean = false

// redis setup

let redisClient = undefined
if (redisConfig.HOST !== undefined) {
	redisClient = Redis.createClient({
		url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:${redisConfig.PORT}`,
		socket: {
			tls: true,
			servername: redisConfig.HOST,
		}
	})
	redisClient.on('error', (error: Error) => console.error('[Redis]', error))
	redisClient.connect()

	// TODO: deconflict with Redis pub/sub to ensure globally unique botId
}

// socket.io setup

let socket = io(GAME_SERVER_URL, {
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
	.option('-n, --number-of-games <number>', 'number of games to play', DEFAULT_NUMBER_OF_GAMES)
	.option('-d, --debug', 'enable debugging', false)
	.option('-s, --set-username', `attempt to set username: ${gameConfig.username}`, false)
	.showHelpAfterError()

program
	.command('ffa')
	.description('free for all')
	.action(() => {
		gameType = GameType.FFA
		gameConfig.customGameId = null
	})

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
options.numberOfGames = parseInt(options.numberOfGames) || DEFAULT_NUMBER_OF_GAMES

log.debug("debugging enabled")
log.debug("gameConfig: ")
log.debug(gameConfig)
log.debug("options: ")
log.debug(options)

// handle game events

socket.on('connect', async () => {
	log.stdout(`[connected] ${gameConfig.username}`)
	if (options.setUsername) {
		socket.emit('set_username', gameConfig.userId, gameConfig.username)
		log.debug(`sent: set_username, ${gameConfig.userId}, ${gameConfig.username}`)
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
		log.stdout(`[set_username] username set to ${gameConfig.username}`)
	else
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
			log.debug(`sent: [chat_message] ${gameConfig.warCry[i]}`)
		})
	}
})

socket.on('game_update', (data: object) => {
	if (bot === undefined) {
		// create the bot on first game update
		bot = new Bot(socket, playerIndex, data)
		log.debug('recv: first game update')
	} else {
		bot.update(data)
	}
})

socket.on('game_lost', (data: { killer: string }) => {
	log.stdout(`[game_lost] ${replay_id}, killer: ${usernames[data.killer]}`)
	log.redis(`game_lost ${replay_id}, killer: ${usernames[data.killer]}`)
	leaveGame()
})

socket.on('game_won', () => {
	log.stdout(`[game_won] ${replay_id}`)
	log.redis(`game_won ${replay_id}`)
	leaveGame()
})

socket.on('chat_message', (chat_room: string, data: { username: string, playerIndex: number, text: string }) => {
	if (data.username)
		log.redis(`chat_message [${data.username}] ${data.text}`)
});

let queueNumPlayers: number = 0
socket.on('queue_update', (data) => {
	if (!data.isForcing) {
		socket.emit('set_force_start', gameConfig.customGameId, true)
		log.debug('sent: set_force_start')
	}
	// if we are the first player in the queue and number of players has changed, set the game speed
	if (gameType === GameType.Custom
		&& data.usernames[0] === gameConfig.username
		&& data.numPlayers != queueNumPlayers
		&& data.options.game_speed != gameConfig.customGameSpeed)
		setTimeout(() => {
			socket.emit(
				'set_custom_options',
				gameConfig.customGameId, {
				"game_speed": gameConfig.customGameSpeed
			})
			log.debug('sent: set_custom_options')
		}, 100)
	queueNumPlayers = data.numPlayers
})

function joinGame() {
	currentGameNumber++
	log.stdout(`[joining] game ${currentGameNumber} of ${options.numberOfGames}`)

	switch (gameType) {
		case GameType.FFA:
			socket.emit('play', gameConfig.userId)
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
			setTimeout(() => {
				socket.emit(
					'set_custom_options',
					gameConfig.customGameId, {
					"game_speed": gameConfig.customGameSpeed
				})
				log.debug('sent: set_custom_options')
			}, 100)
			log.stdout(`[joined] custom: ${gameConfig.customGameId}`)
			log.redis(`joined custom: ${gameConfig.customGameId}`)
			break
	}
	gameJoined = true
}

function leaveGame() {
	socket.emit('leave_game')
	log.debug('sent: leave_game')
	gameJoined = false
	bot = undefined

	if (currentGameNumber >= options.numberOfGames) {
		log.stdout(`Played ${options.numberOfGames} games. Exiting.`)
		socket.close()
	}
	else {
		setTimeout(joinGame, 100)
	}
}
