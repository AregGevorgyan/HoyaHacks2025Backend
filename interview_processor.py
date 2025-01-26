from typing import List, Dict, Any, Optional, AsyncGenerator
from collections import deque
import queue
import io
import json
import os
import sys
import asyncio
import websockets
import numpy as np
import torch
import torchaudio
from torchaudio.transforms import MuLawDecoding
import base64
from google.cloud import speech
from groq import Groq
from elevenlabs import generate, set_api_key
from concurrent.futures import ThreadPoolExecutor

def load_config() -> Dict[str, Any]:
    config_path = "config.json"
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading config: {e}")
        sys.exit(1)

class VADProcessor:
    def __init__(self, sample_rate: int = 8000):
        self.sample_rate = sample_rate
        self.model, _ = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=True,
            force_sample_rate=sample_rate
        )
        self.mu_law_decoder = MuLawDecoding()
        self.chunk_size = int(0.03 * sample_rate)
        self.voice_history = deque(maxlen=10)  # 300ms window

    def process_audio(self, audio_bytes: bytes) -> bool:
        audio = torch.tensor(np.frombuffer(audio_bytes, dtype=np.uint8))
        pcm = self.mu_law_decoder(audio)
        chunks = torch.split(pcm, self.chunk_size)
        
        probs = []
        for chunk in chunks:
            if len(chunk) == self.chunk_size:
                probs.append(self.model(chunk).item())
        
        self.voice_history.extend(probs)
        return len([p for p in probs if p > 0.5]) / len(probs) > 0.7 if probs else False

class InterviewProcessor:
    def __init__(self, job_info: str):
        self.job_info = job_info
        self.vad = VADProcessor()
        self.stt_client = speech.SpeechClient()
        self.groq = Groq(api_key=os.environ["GROQ_API_KEY"])
        set_api_key(os.environ["ELEVENLABS_API_KEY"])
        
        self.config = speech.StreamingRecognitionConfig(
            config=speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.MULAW,
                sample_rate_hertz=8000,
                language_code="en-US",
                enable_automatic_punctuation=True,
            ),
            interim_results=False
        )
        
        self.conversation = [
            {"role": "system", "content": f"You are conducting a technical interview for: {job_info}"},
            {"role": "assistant", "content": "Hello! Let's start with your background."}
        ]
        
        self.transcript = []
        self.executor = ThreadPoolExecutor()
        self.audio_queue = asyncio.Queue()
        self.lock = asyncio.Lock()

    async def process_audio_chunk(self, chunk: bytes):
        if self.vad.process_audio(chunk):
            await self.audio_queue.put(chunk)

    async def stt_stream(self):
        requests = (
            speech.StreamingRecognizeRequest(audio_content=chunk)
            async for chunk in self._generate_audio()
        )
        
        responses = self.stt_client.streaming_recognize(self.config, requests)
        
        async for response in responses:
            if not response.results:
                continue
            result = response.results[0]
            if result.is_final and result.alternatives:
                transcript = result.alternatives[0].transcript
                self.transcript.append(transcript)
                yield transcript

    async def _generate_audio(self):
        while True:
            chunk = await self.audio_queue.get()
            if chunk is None:
                break
            yield chunk

    async def generate_response(self, transcript: str) -> bytes:
        self.conversation.append({"role": "user", "content": transcript})
        
        try:
            completion = self.groq.chat.completions.create(
                model="llama-3-70b-8192",  # Groq's official model name
                messages=self.conversation,
                temperature=0.7,
                max_tokens=500
            )
            
            response = completion.choices[0].message.content
            self.conversation.append({"role": "assistant", "content": response})
            
            audio = generate(
                text=response,
                voice="Bella",
                model="eleven_monolingual_v1"
            )
            return audio
            
        except Exception as e:
            print(f"Generation error: {e}")
            return b""

    async def evaluate(self) -> str:
        full_transcript = "\n".join(self.transcript)
        
        evaluation = await asyncio.get_event_loop().run_in_executor(
            self.executor,
            self._create_evaluation,
            full_transcript
        )
        
        return evaluation

    def _create_evaluation(self, transcript: str) -> str:
        prompt = f"""Analyze this interview transcript for a {self.job_info} position:
{transcript}

Provide a 1-paragraph assessment starting with [STRONG], [NEUTRAL], or [WEAK] 
followed by key qualifications and recommendations:"""
        
        try:
            completion = self.groq.chat.completions.create(
                model="llama-3-70b-8192",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=300
            )
            return completion.choices[0].message.content
        except Exception as e:
            return f"[ERROR] Evaluation failed: {str(e)}"

async def main():
    config = load_config()
    for k, v in config.items():
        os.environ[k] = v
        
    job_info = sys.stdin.read()
    processor = InterviewProcessor(job_info)
    
    # Initial greeting
    initial_audio = generate(
        text="Thank you for your time today. Let's begin with your experience.",
        voice="Bella",
        model="eleven_monolingual_v1"
    )
    sys.stdout.buffer.write(initial_audio)
    sys.stdout.buffer.flush()
    
    # Process input stream
    while True:
        line = await asyncio.get_event_loop().run_in_executor(
            None, sys.stdin.buffer.readline
        )
        if not line:
            break
            
        try:
            message = json.loads(line)
            if message['type'] == 'audio':
                await processor.process_audio_chunk(
                    base64.b64decode(message['data'])
                )
                
                async for transcript in processor.stt_stream():
                    response_audio = await processor.generate_response(transcript)
                    sys.stdout.buffer.write(response_audio)
                    sys.stdout.buffer.flush()
                    
            elif message['type'] == 'end':
                evaluation = await processor.evaluate()
                print(json.dumps({"type": "evaluation", "data": evaluation}))
                break
                
        except Exception as e:
            print(json.dumps({"type": "error", "data": str(e)}))

if __name__ == "__main__":
    if "--child" in sys.argv:
        asyncio.run(main())
    else:
        print("This service should be run as a child process", file=sys.stderr)
        sys.exit(1)