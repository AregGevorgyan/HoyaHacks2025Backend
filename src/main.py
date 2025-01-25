import asyncio
import websockets
import numpy as np
import torch
import torchaudio
from torchaudio.transforms import MuLawDecoding
from typing import List, Dict, Any, Optional


class VADProcessor:
    def __init__(self, model_path: str = 'snakers4/silero-vad'):
        self.model, self.utils = torch.hub.load(repo_or_dir=model_path, model='silero_vad', force_reload=True)
        self.get_speech_timestamps, self.save_audio, self.read_audio, self.VADIterator, self.collect_chunks = self.utils
        self.mu_law_decoder = MuLawDecoding()

    def get_vad_probabilities(self, audio_bytes: bytes) -> List[float]:
        audio_tensor = torch.tensor(np.frombuffer(audio_bytes, dtype=np.uint8), dtype=torch.float32)
        pcm_audio = self.mu_law_decoder(audio_tensor)
        chunks = torch.split(pcm_audio, 80)  # 10 ms chunks (80 samples at 8 kHz)
        probabilities = [self.model(chunk.unsqueeze(0)).item() for chunk in chunks]
        return probabilities

    def is_voice(self, probabilities: List[float], threshold: float = 0.5) -> bool:
        return sum(probabilities) / len(probabilities) > threshold


class AudioHandler:
    def __init__(self, vad_processor: VADProcessor):
        self.vad_processor = vad_processor

    def process_audio(self, audio_bytes: bytes) -> Dict[str, Any]:
        probabilities = self.vad_processor.get_vad_probabilities(audio_bytes)
        if self.vad_processor.is_voice(probabilities):
            return {"status": "voice_detected", "data": audio_bytes}
        return {"status": "no_voice", "data": None}
    
class SpeechToText:
    def __init__(self):
        pass

    def transcribe(self, audio_bytes: bytes) -> str:
        return 'placeholder text'


class Response:
    SYSTEM_PROMPT = "You are an AI candidate screener to help recuiters" # make better

    def __init__(self, job_info: str):
        self.prompt = Response.SYSTEM_PROMPT + job_info

    def get_llm_response(self, text: str) -> str:
        # Placeholder for LLM call
        return f"LLM Response to: {text}"
    
    def text_to_voice(self, text: str) -> bytes:
        # Placeholder for TTS implementation
        return b"audio_bytes"


class WebSocketServer:
    def __init__(self, host: str, port: int, audio_handler: AudioHandler):
        self.host = host
        self.port = port
        self.audio_handler = audio_handler

    async def audio_stream_handler(self, websocket, path):
        print("Client connected")
        try:
            async for message in websocket:
                response = self.audio_handler.process_audio(message)
                if response["status"] == "voice_detected":
                    stt = SpeechToText()
                    text = stt.transcribe(response["data"])
                    response_text = Response(system_prompt="Placeholder system prompt")
                    llm_response = response_text.get_llm_response(text)
                    audio_bytes = response_text.text_to_voice(llm_response)
                    await websocket.send(audio_bytes)
        except websockets.exceptions.ConnectionClosed:
            print("Client disconnected")
        except Exception as e:
            print(f"Error: {e}")

    def start(self):
        print(f"WebSocket server listening on ws://{self.host}:{self.port}")
        start_server = websockets.serve(self.audio_stream_handler, self.host, self.port)
        asyncio.get_event_loop().run_until_complete(start_server)
        asyncio.get_event_loop().run_forever()


if __name__ == "__main__":
    # Initialize components
    vad_processor = VADProcessor()
    audio_handler = AudioHandler(vad_processor=vad_processor)
    websocket_server = WebSocketServer(host="0.0.0.0", port=8765, audio_handler=audio_handler)

    # Start the server
    websocket_server.start()