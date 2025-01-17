import GameState from './gameState.js'
import GameMap from './gameMap.js'
import Strategy from './strategy.js'
import { Log, later, random } from '@corsaircoalition/common'

export default class Bot {

	moveCount = 0

	constructor(socket, playerIndex, data) {
		this.socket = socket;

		this.queuedMoves = 0;
		this.lastAttackedIndex = -1;
		this.moveCount = 0;

		//true if an area was calculated where units should be gathered
		this.isCollecting = false;
		this.collectArea = [];

		//true, if bot found an adjacent enemy line with low values
		this.isInfiltrating = false;

		this.gameState = new GameState(data, playerIndex);
		this.gameMap = new GameMap(this.gameState.width, this.gameState.height, playerIndex, this.gameState.generals);
	}

	update(data) {
		this.gameState.update(data);
		//decrement queued moves
		this.queuedMoves = this.queuedMoves > 0 ? this.queuedMoves - 1 : 0;
		Strategy.pickStrategy(this);
	}

	queueMoves(moves) {
		for(let move of moves) {
			this.move(move);
		}
	}

	move(move) {
		if(move.end != -1) {
			this.queuedMoves++;
			this.lastAttackedIndex = move.end;
			this.socket.emit('attack', move.start, move.end);
			this.moveCount++;
		}
	}
}
