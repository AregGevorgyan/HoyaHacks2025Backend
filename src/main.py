import asyncio
import websockets
import numpy as np
import torch
import torchaudio
from torchaudio.transforms import MuLawDecoding

VOICE_TEMPERATURE = 0.5 # this is a random constant, change to better one
SYSTEM_PROMPT = "You are an AI interviewer" # make prompt better
JOB_INFO = ''

def set_job_info(job_info: str):
    JOB_INFO = job_info

vad_model, utils = torch.hub.load(repo_or_dir='snakers4/silero-vad',
                              model='silero_vad', force_reload=True)
(get_speech_timestamps,
 save_audio,
 read_audio,
 VADIterator,
 collect_chunks) = utils

mu_law_decoder = MuLawDecoding()

def get_vad_probabilities(audio_bytes):
    audio_tensor = torch.tensor(np.frombuffer(audio_bytes, dtype=np.uint8), dtype=torch.float32)
    pcm_audio = mu_law_decoder(audio_tensor)
    chunks = torch.split(audio_tensor, 80)  # Process in 10 ms chunks (80 samples at 8 kHz)
    probabilities = [vad_model(chunk.unsqueeze(0)) for chunk in chunks]
    return probabilities

def is_voice(probabilities):
    return sum(probabilities) / len(probabilities) > 0.5 # potentially better algo exists

# WebSocket server to receive audio packets from Twilio
async def audio_stream_handler(websocket, path):
    print("Client connected")
    try:
        async for message in websocket:
            if is_voice(get_vad_probabilities(message)):
                return {"status": "voice_detected", "data": message}
            
            return {"status": "no_voice", "data": None}
            
    except websockets.exceptions.ConnectionClosed:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")

def voice_to_text(audio_bytes):
    pass

def get_llm_response(text):
    pass

def text_to_voice(text):
    pass

def send_audio(audio_bytes):
    pass

start_server = websockets.serve(audio_stream_handler, "0.0.0.0", 8765)

if __name__ == "__main__":
    print("WebSocket server listening on ws://0.0.0.0:8765")
    asyncio.get_event_loop().run_until_complete(start_server)
    asyncio.get_event_loop().run_forever()