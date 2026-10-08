// Every multiplayer room game. Each engine lives in its own file (see .amp/in/rooms-contract.md).
import { coinflip } from "./coinflip.js";
import { blackjack } from "./blackjack.js";
import { poker } from "./poker.js";
import { russianRoulette } from "./russian-roulette.js";

export const ROOM_ENGINES = [coinflip, blackjack, poker, russianRoulette];
