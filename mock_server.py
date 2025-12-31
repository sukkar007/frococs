#!/usr/bin/env python3
"""
Mock WebSocket Server for FruitWheel Game
This server provides mock data for the game to function properly
"""

import asyncio
import json
import struct
import websockets
import random
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from functools import partial
import threading
import os

# Game state
game_state = {
    "stage": 1,  # FRUITWHEEL_STAGE_BET
    "round_id": f"{int(time.time())}-{random.randint(1000, 9999)}",
    "countdown": 30,
    "result": 0,
    "user_coin": 10000,
    "user_nickname": "Player",
    "user_avatar": "",
    "today_win": 0,
    "bet_records": [],
    "history": []
}

# Protobuf-like message encoding (simplified)
def encode_message(msg_name, data):
    """Encode a message in a format the game expects"""
    # The game uses protobuf, we'll create a simple JSON wrapper
    message = {
        "type": msg_name,
        "data": data
    }
    return json.dumps(message).encode('utf-8')

def decode_message(data):
    """Decode incoming message"""
    try:
        if isinstance(data, bytes):
            data = data.decode('utf-8')
        return json.loads(data)
    except:
        return {"type": "unknown", "data": {}}

# Game stages
STAGE_NONE = 0
STAGE_BET = 1
STAGE_SPIN = 2
STAGE_FINISH = 3

# Fruit wheel configuration (8 slots)
FRUIT_WHEEL = [
    {"id": 0, "name": "apple", "rate": 2},
    {"id": 1, "name": "orange", "rate": 2},
    {"id": 2, "name": "banana", "rate": 5},
    {"id": 3, "name": "grape", "rate": 8},
    {"id": 4, "name": "watermelon", "rate": 10},
    {"id": 5, "name": "cherry", "rate": 20},
    {"id": 6, "name": "lemon", "rate": 50},
    {"id": 7, "name": "star", "rate": 100}
]

async def handle_game_info(websocket, game_state):
    """Send game info to client"""
    response = {
        "code": 0,
        "stage": game_state["stage"],
        "roundId": game_state["round_id"],
        "countdown": game_state["countdown"],
        "coin": game_state["user_coin"],
        "nickname": game_state["user_nickname"],
        "avatar": game_state["user_avatar"],
        "todayWin": game_state["today_win"],
        "history": game_state["history"][-10:] if game_state["history"] else [],
        "bets": {},
        "myselfBets": {}
    }
    await websocket.send(json.dumps({"type": "pb.FruitwheelGameInfoS2C", "data": response}))

async def handle_bet(websocket, data, game_state):
    """Handle bet request"""
    bet_id = data.get("id", 0)
    bet_amount = data.get("bet", 0)
    round_id = data.get("roundId", "")
    
    if game_state["user_coin"] >= bet_amount:
        game_state["user_coin"] -= bet_amount
        game_state["bet_records"].append({"id": bet_id, "bet": bet_amount})
        
        response = {
            "code": 0,
            "id": bet_id,
            "bet": bet_amount,
            "coin": game_state["user_coin"]
        }
    else:
        response = {
            "code": 1,  # COIN_NOT_ENOUGH
            "id": bet_id,
            "bet": 0,
            "coin": game_state["user_coin"]
        }
    
    await websocket.send(json.dumps({"type": "pb.FruitwheelGameBetS2C", "data": response}))

async def handle_self_record(websocket, game_state):
    """Send self record history"""
    records = []
    for i in range(5):
        records.append({
            "roundTime": int(time.time()) - i * 60,
            "result": random.randint(0, 7),
            "reward": random.randint(-100, 500),
            "detail": json.dumps({str(random.randint(0, 3)): random.randint(10, 100)})
        })
    
    response = {
        "code": 0,
        "records": records
    }
    await websocket.send(json.dumps({"type": "pb.FruitwheelGameSelfRecordS2C", "data": response}))

async def handle_today_win(websocket, game_state):
    """Send today's winnings"""
    response = {
        "code": 0,
        "todayWin": game_state["today_win"]
    }
    await websocket.send(json.dumps({"type": "pb.GetTodayWinS2C", "data": response}))

async def handle_rank(websocket, game_state):
    """Send rank data"""
    ranks = []
    for i in range(10):
        ranks.append({
            "uid": 1000 + i,
            "nickname": f"Player{i+1}",
            "avatar": "",
            "win": random.randint(1000, 10000)
        })
    
    response = {
        "code": 0,
        "ranks": ranks
    }
    await websocket.send(json.dumps({"type": "pb.FruitwheelRankS2C", "data": response}))

async def game_loop(websocket, game_state):
    """Main game loop - broadcasts game stages"""
    while True:
        try:
            # Betting stage
            game_state["stage"] = STAGE_BET
            game_state["round_id"] = f"{int(time.time())}-{random.randint(1000, 9999)}"
            game_state["countdown"] = 15
            game_state["bet_records"] = []
            
            stage_msg = {
                "stage": STAGE_BET,
                "roundId": game_state["round_id"],
                "countdown": game_state["countdown"]
            }
            await websocket.send(json.dumps({"type": "pb.FruitwheelGameStageBrc", "data": stage_msg}))
            
            # Countdown during betting
            for i in range(15, 0, -1):
                game_state["countdown"] = i
                await asyncio.sleep(1)
            
            # Spin stage
            game_state["stage"] = STAGE_SPIN
            result = random.randint(0, 7)
            game_state["result"] = result
            
            stage_msg = {
                "stage": STAGE_SPIN,
                "roundId": game_state["round_id"],
                "result": result,
                "countdown": 5
            }
            await websocket.send(json.dumps({"type": "pb.FruitwheelGameStageBrc", "data": stage_msg}))
            
            await asyncio.sleep(5)
            
            # Finish stage - calculate winnings
            game_state["stage"] = STAGE_FINISH
            total_win = 0
            for bet in game_state["bet_records"]:
                if bet["id"] == result * 2 or bet["id"] == result * 2 + 1:
                    win = bet["bet"] * FRUIT_WHEEL[result]["rate"]
                    total_win += win
            
            game_state["user_coin"] += total_win
            game_state["today_win"] += total_win
            
            # Add to history
            game_state["history"].append(result)
            if len(game_state["history"]) > 20:
                game_state["history"] = game_state["history"][-20:]
            
            stage_msg = {
                "stage": STAGE_FINISH,
                "roundId": game_state["round_id"],
                "result": result,
                "reward": total_win,
                "coin": game_state["user_coin"]
            }
            await websocket.send(json.dumps({"type": "pb.FruitwheelGameStageBrc", "data": stage_msg}))
            
            # Coin update
            coin_msg = {
                "coin": game_state["user_coin"]
            }
            await websocket.send(json.dumps({"type": "pb.CoinUpdateBrc", "data": coin_msg}))
            
            await asyncio.sleep(3)
            
            # Reset to none stage briefly
            game_state["stage"] = STAGE_NONE
            stage_msg = {
                "stage": STAGE_NONE,
                "roundId": game_state["round_id"]
            }
            await websocket.send(json.dumps({"type": "pb.FruitwheelGameStageBrc", "data": stage_msg}))
            
            await asyncio.sleep(2)
            
        except websockets.exceptions.ConnectionClosed:
            break
        except Exception as e:
            print(f"Game loop error: {e}")
            await asyncio.sleep(1)

async def websocket_handler(websocket, path):
    """Handle WebSocket connections"""
    print(f"New connection from {websocket.remote_address}, path: {path}")
    
    # Create a copy of game state for this connection
    local_game_state = game_state.copy()
    local_game_state["user_coin"] = 10000
    local_game_state["today_win"] = 0
    local_game_state["bet_records"] = []
    local_game_state["history"] = [random.randint(0, 7) for _ in range(10)]
    
    # Send initial game info
    await handle_game_info(websocket, local_game_state)
    
    # Start game loop in background
    game_task = asyncio.create_task(game_loop(websocket, local_game_state))
    
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type", "")
                msg_data = data.get("data", {})
                
                print(f"Received: {msg_type}")
                
                if "GameInfo" in msg_type:
                    await handle_game_info(websocket, local_game_state)
                elif "GameBet" in msg_type:
                    await handle_bet(websocket, msg_data, local_game_state)
                elif "SelfRecord" in msg_type:
                    await handle_self_record(websocket, local_game_state)
                elif "TodayWin" in msg_type:
                    await handle_today_win(websocket, local_game_state)
                elif "Rank" in msg_type:
                    await handle_rank(websocket, local_game_state)
                elif "Heartbeat" in msg_type or "Ping" in msg_type:
                    await websocket.send(json.dumps({"type": "pb.HeartbeatS2C", "data": {"time": int(time.time())}}))
                else:
                    print(f"Unknown message type: {msg_type}")
                    
            except json.JSONDecodeError:
                print(f"Invalid JSON: {message[:100]}")
            except Exception as e:
                print(f"Error handling message: {e}")
                
    except websockets.exceptions.ConnectionClosed:
        print("Connection closed")
    finally:
        game_task.cancel()

class CORSHTTPRequestHandler(SimpleHTTPRequestHandler):
    """HTTP handler with CORS support"""
    
    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)
    
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()
    
    def do_POST(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"code": 0}).encode())

def run_http_server(port, directory):
    """Run HTTP server in a thread"""
    handler = partial(CORSHTTPRequestHandler, directory=directory)
    server = HTTPServer(('0.0.0.0', port), handler)
    print(f"HTTP server running on port {port}")
    server.serve_forever()

async def main():
    """Main entry point"""
    # Get the directory of this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Start HTTP server in a thread
    http_thread = threading.Thread(
        target=run_http_server, 
        args=(8080, script_dir),
        daemon=True
    )
    http_thread.start()
    
    # Start WebSocket server
    print("Starting WebSocket server on port 8081...")
    async with websockets.serve(websocket_handler, "0.0.0.0", 8081):
        print("WebSocket server running on port 8081")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
