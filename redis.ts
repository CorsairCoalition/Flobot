import Redis = require('redis')
import fs = require('node:fs')
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'))
const redisConfig = config.redisConfig

const redisClient = Redis.createClient({
	url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:${redisConfig.PORT}`,
	socket: {
		tls: true,
		servername: redisConfig.HOST,
	}
})
redisClient.on('error', (error: Error) => console.error(new Date().toISOString(), '[Redis]', error))

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

	console.log(new Date().toISOString(), channel, msgObj)
}

async function connectAndSubscribe(channels: string[]) {
	await redisClient.connect()
	for (const channel of channels) {
		redisClient.subscribe(channel, listener).then(() => {
			console.log('Listening for updates on', channel, '...')
		})
	}
}

if (process.argv.length > 2) {
	let channels = process.argv.slice(2)
	connectAndSubscribe(channels)
} else {
	console.log("Usage: coffee redis-watch.coffee <channel...>")
}
