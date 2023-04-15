/// <reference path="./app.d.ts" />

import { Command } from 'commander'
import Redis from './redis.js'
import io from 'socket.io-client'
import fs from 'node:fs'
import Bot from './scripts/bot.js'
import { Log } from './utils'
import crypto from 'crypto'

// configuration

const BOT_TYPE = 'flobot'
const GAME_SERVER_URL = 'wss://botws.generals.io/'
const DEFAULT_CUSTOM_GAME_SPEED = 4

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'))
const gameConfig: Config.Game = config.gameConfig
const redisConfig: Config.Redis = config.redisConfig
// create a unique botId by hashing gameConfig.userId
let botId = crypto.createHash('sha256').update(gameConfig.userId).digest('base64').replace(/[^\w\s]/gi, '').slice(-7)
gameConfig.customGameSpeed = gameConfig.customGameSpeed || DEFAULT_CUSTOM_GAME_SPEED
redisConfig.CHANNEL_PREFIX = BOT_TYPE + '-' + botId

let redis = new Redis(redisConfig)

// program flow setup

process.once('SIGINT', async (code) => {
	Log.stderr('Interrupted. Exiting gracefully.')
	if (gameJoined) {
		await socket.emit('leave_game')
		Log.debug('sent: leave_game')
	}
	await socket.disconnect()
	await redis.quit()
})

process.once('SIGTERM', async (code) => {
	Log.stderr('Terminated. Exiting gracefully.')
	if (gameJoined) {
		socket.emit('leave_game')
		Log.debug('sent: leave_game')
	}
	await socket.disconnect()
	await redis.quit()
})

// data structures and definitions

let gameType: Game.Type
let bot: Bot
let playerIndex: number
let replay_id: string = ""
let usernames: string[]
let currentGameNumber: number = 0
let gameJoined: boolean = false

// redis setup


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
	.option('-n, --number-of-games <number>', 'number of games to play', '1')
	.option('-d, --debug', 'enable debugging', false)
	.option('-s, --set-username', `attempt to set username: ${gameConfig.username}`, false)
	.showHelpAfterError()

program
	.command(Game.Type.FFA)
	.description('free for all')
	.action(() => {
		gameType = Game.Type.FFA
		gameConfig.customGameId = null
	})

program
	.command(Game.Type.DUEL)
	.description('one vs one')
	.action(() => { gameType = Game.Type.DUEL })

program
	.command(Game.Type.CUSTOM)
	.argument('[id]', 'custom game id', gameConfig.customGameId)
	.description('custom game')
	.action((id) => {
		gameType = Game.Type.CUSTOM
		gameConfig.customGameId = id
	})

program.parse()
const options = program.opts()
options.numberOfGames = parseInt(options.numberOfGames) || 1

Log.stdout(`[initilizing] ${pkg.name} v${pkg.version}`)
Log.stdout(`[initilizing] botId: ${botId}`)

Log.setDebugOutput(options.debug)
Log.debug("[debug] debugging enabled")
Log.debugObject("gameConfig", gameConfig)
Log.debugObject("options", options)

// handle game events

socket.on('connect', async () => {
	Log.stdout(`[connected] ${gameConfig.username}`)
	if (options.setUsername) {
		socket.emit('set_username', gameConfig.userId, gameConfig.username)
		Log.debug(`sent: set_username, ${gameConfig.userId}, ${gameConfig.username}`)
	}
	redis.publish(RedisData.CHANNEL.STATE, { connected: gameConfig.username })
	joinGame()
})

socket.on('disconnect', async (reason: string) => {
	// exit if disconnected intentionally; auto-reconnect otherwise
	await redis.publish(RedisData.CHANNEL.STATE, { disconnected: reason })
	switch (reason) {
		case 'io server disconnect':
			console.error("disconnected: " + reason)
			if (redis !== undefined)
				await redis.quit()
			process.exit(3)
		case 'io client disconnect':
			if (redis !== undefined)
				await redis.quit()
			process.exit(0)
		default:
			console.error("disconnected: " + reason)
	}
})

socket.on('error_set_username', (message: string) => {
	if (message === '')
		Log.stdout(`[set_username] username set to ${gameConfig.username}`)
	else
		Log.stdout(`[error_set_username] ${message}`)
})

socket.on('game_start', (data: GeneralsIO.GameStart) => {
	// Get ready to start playing the game.
	playerIndex = data.playerIndex
	bot = undefined
	replay_id = data.replay_id
	usernames = data.usernames
	Log.stdout(`[game_start] replay: ${replay_id}, users: ${usernames}`)
	redis.publish(RedisData.CHANNEL.STATE, { game_start: data })
	redis.setKeyspaceName(data.replay_id)
	redis.setKeys(data)
	redis.expireKeyspace(60 * 60 * 24)

	// iterate over gameConfig.warCry to send chat messages
	function later(delay: number) {
		return new Promise(function (resolve) {
			setTimeout(resolve, delay)
		})
	}

	for (let i = 0; i < gameConfig.warCry.length; i++) {
		later(1000 * i).then(() => {
			socket.emit('chat_message', data.chat_room, gameConfig.warCry[i])
			Log.debug(`sent: [chat_message] ${gameConfig.warCry[i]}`)
		})
	}
})

socket.on('game_update', (data: GeneralsIO.GameUpdate) => {
	if (bot === undefined) {
		// create the bot on first game update
		bot = new Bot(socket, playerIndex, data)
		Log.debug('recv: first game update')
	} else {
		bot.update(data)
	}
	redis.publish(RedisData.CHANNEL.GAME_UPDATE, data)

	if (data.turn === 1) {
		redis.setKeys({
			[RedisData.KEY.WIDTH]: bot.gameState.width,
			[RedisData.KEY.HEIGHT]: bot.gameState.height,
			[RedisData.KEY.SIZE]: bot.gameState.size,
			[RedisData.KEY.OWN_GENERAL]: bot.gameState.ownGeneral,
		})
	}

	redis.setKeys({
		[RedisData.KEY.TURN]: bot.gameState.turn,
		[RedisData.KEY.CITIES]: bot.gameState.cities,
		[RedisData.KEY.DISCOVERED_TILES]: bot.gameState.discoveredTiles,
		[RedisData.KEY.ARMIES]: bot.gameState.armies,
		[RedisData.KEY.TERRAIN]: bot.gameState.terrain,
		[RedisData.KEY.ENEMY_GENERAL]: bot.gameState.enemyGeneral,
		[RedisData.KEY.OWN_TILES]: Array.from(bot.gameState.ownTiles.entries()),
		[RedisData.KEY.ENEMY_TILES]: Array.from(bot.gameState.enemyTiles.entries()),
	})

	let maxArmyOnTile = 0
	// get the max value from this.gameState.ownTiles
	for (let [key, value] of bot.gameState.ownTiles) {
		if (value > maxArmyOnTile) {
			maxArmyOnTile = value
		}
	}

	redis.listPush(RedisData.LIST.SCORES, data.scores)
	redis.listPush(RedisData.LIST.MAX_ARMY_ON_TILE, maxArmyOnTile)
	redis.listPush(RedisData.LIST.MOVE_COUNT, bot.moveCount)
})

socket.on('game_lost', (data: { killer: string }) => {
	Log.stdout(`[game_lost] ${replay_id}, killer: ${usernames[data.killer]}`)
	redis.publish(RedisData.CHANNEL.STATE, {
		game_lost: {
			replay_id: replay_id,
			killer: data.killer,
			killer_name: usernames[data.killer],
		}
	})
	leaveGame()
})

socket.on('game_won', () => {
	Log.stdout(`[game_won] ${replay_id}`)
	redis.publish(RedisData.CHANNEL.STATE, {
		game_won: {
			replay_id: replay_id
		}
	})
	leaveGame()
})

let queueNumPlayers: number = 0
let forceStartSet: boolean = false
let customOptionsSet: boolean = false

socket.on('queue_update', (data) => {
	if (!data.isForcing) {
		forceStartSet = false
		setTimeout(setForceStart, 1000)
	}
	// if we are the first player in the queue and number of players has changed, set the game speed
	if (gameType === Game.Type.CUSTOM
		&& data.usernames[0] === gameConfig.username
		&& data.numPlayers != queueNumPlayers
		&& data.options.game_speed != gameConfig.customGameSpeed) {
		customOptionsSet = false
		setTimeout(setCustomOptions, 100)
	}
	queueNumPlayers = data.numPlayers
})

function joinGame() {
	currentGameNumber++
	Log.stdout(`[joining] game ${currentGameNumber} of ${options.numberOfGames}`)

	switch (gameType) {
		case Game.Type.FFA:
			socket.emit('play', gameConfig.userId)
			Log.stdout('[joined] FFA')
			redis.publish(RedisData.CHANNEL.STATE, {
				joined: {
					gameType: 'FFA',
				}
			})
			break
		case Game.Type.DUEL:
			socket.emit('join_1v1', gameConfig.userId)
			Log.stdout('[joined] 1v1')
			redis.publish(RedisData.CHANNEL.STATE, {
				joined: {
					gameType: '1v1',
				}
			})
			break
		case Game.Type.CUSTOM:
			socket.emit('join_private', gameConfig.customGameId, gameConfig.userId)
			setTimeout(setCustomOptions, 100)
			setTimeout(setForceStart, 2000)
			Log.stdout(`[joined] custom: ${gameConfig.customGameId}`)
			redis.publish(RedisData.CHANNEL.STATE, {
				joined: {
					gameType: 'custom',
					gameId: gameConfig.customGameId,
				}
			})
			break
	}
	gameJoined = true
}

function leaveGame() {
	socket.emit('leave_game')
	Log.debug('sent: leave_game')
	gameJoined = false
	forceStartSet = false
	customOptionsSet = false
	bot = undefined

	// if we have played enough games, exit
	if (currentGameNumber >= options.numberOfGames) {
		Log.stdout(`Played ${options.numberOfGames} games. Exiting.`)
		socket.close()
	}
	else {
		joinGame()
	}
}

function setForceStart() {
	// use mutex to ensure that we only set force start once
	if (!forceStartSet) {
		forceStartSet = true
		socket.emit('set_force_start', gameConfig.customGameId, true)
		Log.debug('sent: set_force_start')
	}
}

function setCustomOptions() {
	// use mutex to ensure that we only set custom options once
	if (gameType === Game.Type.CUSTOM && !customOptionsSet) {
		customOptionsSet = true
		socket.emit('set_custom_options', gameConfig.customGameId, {
			"game_speed": gameConfig.customGameSpeed
		})
		Log.debug('sent: set_custom_options')
	}
}
