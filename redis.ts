/// <reference path="./app.d.ts" />

import { createClient, RedisClientType } from '@redis/client'
import { Log } from './utils.js'

export default class Redis {

	private publisher: RedisClientType
	private subscriber: RedisClientType
	private CHANNEL_PREFIX: string
	private EXPIRATION_TIME = 60 * 60 * 24 * 14 // default 2 weeks
	private gameKeyspace: string

	constructor(redisConfig: Config.Redis) {
		this.CHANNEL_PREFIX = redisConfig.CHANNEL_PREFIX
		this.EXPIRATION_TIME = redisConfig.EXPIRATION_TIME || this.EXPIRATION_TIME
		this.subscriber = createClient({
			url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:${redisConfig.PORT}`,
			socket: {
				tls: true,
				servername: redisConfig.HOST,
			}
		})
		this.subscriber.on('error', (error: Error) => Log.stderr(`[Redis] {error}`))
		this.subscriber.connect()

		this.publisher = createClient({
			url: `rediss://${redisConfig.USERNAME}:${redisConfig.PASSWORD}@${redisConfig.HOST}:${redisConfig.PORT}`,
			socket: {
				tls: true,
				servername: redisConfig.HOST,
			}
		})
		this.publisher.on('error', (error: Error) => Log.stderr(`[Redis] ${error}`))
		this.publisher.connect()
	}

	public listPush(list: RedisData.LIST, data: any) {
		this.publisher.rPush(this.gameKeyspace + '-' + list, JSON.stringify(data))
		this.publisher.expire(this.gameKeyspace + '-' + list, this.EXPIRATION_TIME)
	}

	public setKeys(keyValues: Record<string, any>) {
		// JSON.stringify each value
		for (let key in keyValues) {
			keyValues[key] = JSON.stringify(keyValues[key])
		}
		this.publisher.expire(this.gameKeyspace, this.EXPIRATION_TIME)
		return this.publisher.hSet(this.gameKeyspace, keyValues)
	}

	public async getKeys(...keys: Array<string>) {
		// JSON.parse each value
		let values = await this.publisher.hmGet(this.gameKeyspace, keys)
		for (let key in values) {
			values[key] = JSON.parse(values[key])
		}
		return values
	}

	public async getAllKeys() {
		// JSON.parse each value
		let values = await this.publisher.hGetAll(this.gameKeyspace)
		for (let key in values) {
			values[key] = JSON.parse(values[key])
		}
		return values
	}

	public publish(channel: RedisData.CHANNEL, data: any) {
		return this.publisher.publish(this.CHANNEL_PREFIX + '-' + channel, JSON.stringify(data))
	}

	public setKeyspaceName(keyspace: string) {
		this.gameKeyspace = `${this.CHANNEL_PREFIX}-${keyspace}`
	}

	public async subscribe(channel: RedisData.CHANNEL, callback: (data: any) => void) {
		const CHANNEL_NAME: string = this.CHANNEL_PREFIX + '-' + channel
		Log.debug('[Redis] subscribe:', CHANNEL_NAME)
		let handleResponse = (message: string) => {
			let data: any
			try {
				data = JSON.parse(message)
			} catch (error) {
				Log.stderr('[JSON] received:', message, ', error:', error)
				return
			}
			callback(data)
		}
		await this.subscriber.subscribe(CHANNEL_NAME, handleResponse)
		Log.debug('[Redis] subscribed:', CHANNEL_NAME)
		return CHANNEL_NAME
	}

	public quit() {
		this.subscriber.quit()
		return this.publisher.quit()
	}
}