const Spread = require('./strategies/spread.js');
const Discover = require('./strategies/discover.js');
const Collect = require('./strategies/collect.js');
const Infiltrate = require('./strategies/infiltrate.js');
const Heuristics = require('./heuristics.js');
const Algorithms = require('./algorithms.js');

//armies are always given at even turn numbers
//turn 1 -> 1 turn 2 -> 2, turn 4 -> 3, turn 24 -> 13 (turn / 2 + 1) = army count
let INITIAL_WAIT_TURNS = 23;
let REINFORCEMENT_INTERVAL = 50;
let ATTACK_TURNS_BEFORE_REINFORCEMENTS = 10;

class Strategy {

	static pickStrategy(bot) {
		let turn = bot.gameState.turn;

		//enemy general found. ignore other strategies and straight on attack
		if(bot.gameState.enemyGeneral != -1) {
			this.endGame(bot, turn);
		} else if(bot.isInfiltrating) {
			//ignore every other strategies and attack enemy until no more attacks are possible
			Infiltrate.infiltrate(bot);
		} else if(turn % REINFORCEMENT_INTERVAL == 0) {
			Spread.spread(bot);
		} else if(turn < REINFORCEMENT_INTERVAL) {
			this.earlyGame(bot, turn);
		} else {
			this.midGame(bot, turn);
		}
	}

	static earlyGame(bot, turn) {
		if(turn <= INITIAL_WAIT_TURNS) {
			//wait for some armies to develop
		} else if(turn == INITIAL_WAIT_TURNS + 1) {
			//discover new tiles towards the center
			Discover.first(bot, INITIAL_WAIT_TURNS);
		} else if(bot.queuedMoves == 0) {
			//take as many new tiles as possible till reinforcements come
			Discover.second(bot, INITIAL_WAIT_TURNS);
		} 
	}

	static midGame(bot, turn) {
		//enemy tile was detected and a path was found. check further if attack should start already
		//collectArea of 1 lenghts means there is no endNode to attack anymore
		if(bot.gameState.enemyTiles.size > 0 && bot.collectArea.length > 1 &&
			(turn + ATTACK_TURNS_BEFORE_REINFORCEMENTS + bot.collectArea.length - 1) % REINFORCEMENT_INTERVAL == 0) {
			//reinforcements from general along the found path should be there a fixed amount of turns before new reinforcements come
			//turn the "attack" should start from general
			//e.g. path is 7 long. atk_turns_before_reinfocements are 10. 34 + 10 + 7 - 1 % 50 == 0 (start at turn 34 to arrive at turn 40)
			
			if(bot.collectArea.length == 2) {
				//gathered units moved next to enemy tile. start to attack
				//infiltrating is true until no adjacent enemies to attack found. focus moves on them
				bot.isInfiltrating = true;
				//TODO:check if move is possible maybe
			}
			let start = bot.collectArea.shift();
			let end = bot.collectArea[0];
			bot.move({"start": start, "end": end});
		} else if(!bot.isInfiltrating) {
			//bot isn't moving to enemy tile and isn't infiltrating enemy -> collect armies to prepare for those strategies
			bot.collectArea = Collect.getCollectArea(bot);
			if(bot.queuedMoves == 0) {
				Collect.collect(bot);
			}
		}
	}

	//enemy general spotted
	static endGame(bot, turn) {
		let start = Collect.getHighestArmyIndex(bot.gameState.ownTiles, []);
		let pathFromHighestArmyToGeneral = Algorithms.aStar(bot.gameState, bot.gameMap, start, [bot.gameState.enemyGeneral]);

		if(pathFromHighestArmyToGeneral.length > 1) {
			bot.move({"start": start, "end": pathFromHighestArmyToGeneral[1]});
		}
	}
}

module.exports = Strategy;