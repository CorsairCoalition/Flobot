import Redis = require('redis')
import fs = require('node:fs')
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'))
const redisConfig = config.redisConfig

const CHANNELS: string[] = ['flobot-yHYMxsA', 'flobot-QqUNr6s']

const redisClient = Redis.createClient({
	url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:${redisConfig.PORT}`,
	socket: {
		tls: true,
		servername: redisConfig.HOST,
	}
})
redisClient.on('error', (error: Error) => console.error(new Date().toISOString(), '[Redis]', error))
redisClient.connect()

process.once('SIGINT', async (code) => {
	console.error(new Date().toISOString(), 'Interrupted. Exiting gracefully.')
	await redisClient.quit()
})

// listen to redis channel and output to stdout
const listener = (message: string, channel: string) => {
	let msgObj: object
	try {
		msgObj = JSON.parse(message)
	} catch (error) {
		console.error(new Date().toISOString(), '[JSON]', error)
		return
	}

	// check if msgObj has a 'game_update' key
	// if not, print the channel and the message
	if (!('game_update' in msgObj))
		console.log(new Date().toISOString(), channel, msgObj)
}

for (const CHANNEL of CHANNELS) {
	redisClient.subscribe(CHANNEL, listener).then(() => {
		console.log('Listening for updates on', CHANNEL, '...')
	})
}
