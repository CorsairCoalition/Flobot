export function later(delay: number) {
	return new Promise(function (resolve) {
		setTimeout(resolve, delay)
	})
}

export function random(min: number, max: number) {
	return Math.floor(Math.random() * (max - min + 1) + min)
}

export class Log {

	static debugEnabled: boolean = false

	static setDebugOutput(debug: boolean) {
		Log.debugEnabled = debug
	}

	static stdout(...args: string[]) {
		console.log(new Date().toISOString(), args.join(' '))
	}

	static stderr(...args: string[]) {
		// output red text
		process.stderr.write('\x1b[31m')
		console.error(new Date().toISOString(), args.join(' '))
		process.stderr.write('\x1b[0m')
	}

	static debug(...args: string[]) {
		if (!Log.debugEnabled) return
		// output blue text
		process.stdout.write('\x1b[34m')
		console.log(new Date().toISOString(), args.join(' '))
		process.stdout.write('\x1b[0m')
	}

	static debugObject(label: string, obj: any) {
		if (!Log.debugEnabled) return
		process.stdout.write('\x1b[34m')
		console.log(new Date().toISOString(), label)
		console.log(JSON.stringify(obj, null, 2))
		process.stdout.write('\x1b[0m')
	}
}
