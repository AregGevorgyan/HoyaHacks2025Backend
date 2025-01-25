from typing import List, Dict, Any, Optional
from collections import deque
import queue
import io
import json
import aiohttp
import os
import sys

import asyncio
import websockets
import numpy as np
import torch
import torchaudio
from torchaudio.transforms import MuLawDecoding
from google.cloud import speech # TODO figure out where api key for this goes
from groq import Groq
from elevenlabs import generate, set_api_key

def load_config():
    with open("config.json", "r") as f:
        config = json.load(f)
        for key, value in config.items():
            os.environ[key] = value

class VADProcessor:
    def __init__(self, sample_rate: int = 8000):
        self.sample_rate = sample_rate
        self.model, self.utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=True,
            force_sample_rate=sample_rate
        )
        self.mu_law_decoder = MuLawDecoding()
        self.voice_threshold = 0.5
        self.chunk_size = int(0.03 * sample_rate)  # 30ms chunks

    def get_vad_probabilities(self, audio_bytes: bytes) -> List[float]:
        audio_tensor = torch.tensor(np.frombuffer(audio_bytes, dtype=np.uint8), dtype=torch.float32)
        pcm_audio = self.mu_law_decoder(audio_tensor)
        chunks = torch.split(pcm_audio, 80)
        probabilities = []
        batch_size = 16
        for i in range(0, len(chunks), batch_size):
            batch = torch.stack([chunk for chunk in chunks[i:i+batch_size]])
            batch_probs = self.model(batch).tolist()
            probabilities.extend(batch_probs)
        return probabilities

    def is_voice(self, probabilities: List[float], threshold: float = None) -> bool:
        if threshold is None:
            threshold = self.voice_threshold
        is_voice_detected = sum(probabilities) / len(probabilities) > threshold
        self.voice_history.append(is_voice_detected)
        return is_voice_detected


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
        self.client = speech.SpeechClient()
        self.text_buffer = []
        self.streaming_config = speech.StreamingRecognitionConfig(
            config=speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
                sample_rate_hertz=16000,# TODO make sure these settings are correct (prolly not)
                language_code="en-US",
                enable_automatic_punctuation=True,
            ),
            interim_results=True,
        )
        self.streaming_queue = queue.Queue()
        
    def _create_stream(self):
        while True:
            chunk = self.streaming_queue.get()
            if chunk is None:
                break
            yield speech.StreamingRecognizeRequest(audio_content=chunk)

    async def process_audio_stream(self, audio_bytes: bytes):
        """Process incoming audio stream and update text buffer"""
        self.streaming_queue.put(audio_bytes)
        
        responses = self.client.streaming_recognize(
            config=self.streaming_config,
            requests=self._create_stream()
        )

        for response in responses:
            if not response.results:
                continue

            result = response.results[0]
            if not result.alternatives:
                continue

            transcript = result.alternatives[0].transcript

            if result.is_final:
                self.text_buffer.append(transcript)
            
            yield transcript

    def get_full_transcript(self) -> str:
        """Get complete transcript from buffer"""
        return ' '.join(self.text_buffer)

    def clear_buffer(self):
        """Clear the text buffer"""
        self.text_buffer = []


class Response:
    # TODO promp engineering
    SYSTEM_PROMPT = "You are an AI candidate screener to help recruiters. Ask the candidate questions for a short interview to see if they are qualified for the following job description"

    def __init__(self, job_info: str):
        self.prompt = Response.SYSTEM_PROMPT + job_info# TODO add transcript to this
        self.groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
        self.conversation_history = []
        set_api_key(os.getenv("ELEVENLABS_API_KEY")) # TODO make 11labs import correctly

    async def get_llm_response(self, text: str) -> str:
        try:
            # Add user message to history
            self.conversation_history.append({"role": "user", "content": text})
            
            # Create full conversation with system prompt
            messages = [
                {"role": "system", "content": self.prompt},
                *self.conversation_history
            ]

            # TODO change settings!!!!
            completion = self.groq_client.chat.completions.create(
                model="mixtral-8x7b-32768",
                messages=messages,
                temperature=0.7,
                max_tokens=4096,
                top_p=1,
                stream=False
            )

            response = completion.choices[0].message.content
            # Add assistant response to history
            self.conversation_history.append({"role": "assistant", "content": response})
            return response

        except Exception as e:
            print(f"Error in LLM call: {e}")
            return "I apologize, but I'm having trouble processing your response right now."

    async def text_to_voice(self, text: str) -> bytes:
        try:
            # TODO better voice
            audio = generate(
                text=text,
                voice="Josh", 
                model="eleven_monolingual_v1"
            )
            return audio

        except Exception as e:
            print(f"Error in text-to-speech conversion: {e}")
            return b""
class Evaluation:
    pass #TODO finish this implementation

class WebSocketServer:
    def __init__(self, host: str, port: int, audio_handler: AudioHandler):
        self.host = host
        self.port = port
        self.audio_handler = audio_handler

    async def audio_stream_handler(self, websocket, path):
        print("Client connected")
        close_task = asyncio.create_task(self.close_connection_after_delay(websocket, delay_minutes=30))
        stt = SpeechToText()
        # TODO ensure that start of call is good with AI starting off
        try:
            async for message in websocket:
                response = self.audio_handler.process_audio(message)
                if response["status"] == "voice_detected":
                    async for transcript in stt.process_audio_stream(response["data"]):
                        if transcript:
                            response_text = Response(job_info="Placeholder")# TODO take info in as placeholder
                            llm_response = await response_text.get_llm_response(transcript)
                            audio_bytes = await response_text.text_to_voice(llm_response)
                            await websocket.send(audio_bytes)
        except websockets.exceptions.ConnectionClosed:
            print("Client disconnected")
        except Exception as e:
            print(f"Error: {e}")
            stt.clear_buffer()
        finally:
            close_task.cancel()

    async def close_connection_after_delay(self, websocket, delay_minutes):
        """User can't talk with ai for more than 30 minutes"""
        await asyncio.sleep(delay_minutes * 60)  # Convert minutes to seconds
        await websocket.close()
        print(f"Connection closed after {delay_minutes} minutes.")

    def start(self):
        print(f"WebSocket server listening on ws://{self.host}:{self.port}")
        start_server = websockets.serve(self.audio_stream_handler, self.host, self.port)
        asyncio.get_event_loop().run_until_complete(start_server)
        asyncio.get_event_loop().run_forever()


if __name__ == "__main__":
    load_config()
    # Initialize components
    vad_processor = VADProcessor()
    audio_handler = AudioHandler(vad_processor=vad_processor)
    websocket_server = WebSocketServer(host="0.0.0.0", port=8765, audio_handler=audio_handler)
    # TODO allow for this script to be set up as a node.js child process that takes input job discription and returns text about candinate

    websocket_server.start()