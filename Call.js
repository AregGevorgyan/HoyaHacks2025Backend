require("dotenv").config();
const speech = require("@google-cloud/speech");
const { GoogleGenerativeAI } = require("@google/generative-ai");
// const { default: CredentialProvider } = require("twilio/lib/credential_provider/CredentialProvider");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);




const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
        temperature: 0.2,
        // 0.2
    },
});



const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require("twilio")(accountSid, authToken);

class Call {
    constructor(callSid, phoneNumber, uuid, criteria,applicant) {
        this.uuid = uuid
        this.criteria
        this.callSid = callSid;
        this.transcript = [];
        this.lastWords = "";
        this.data = [];
        this.rating = 0;
        this.markMessage = "";
        this.phoneNumber = phoneNumber;
        this.streamSid = "";
        this.aiTalking = false;
        this.ws = null;
        this.convoSummary = "";
        this.isLead = false;
        this.messageNumber = 0;
        this.aiDuration = 0;
        this.interval;
        this.resetAudio;
        this.criteria = criteria
        this.applicant = applicant
        setTimeout(() => {
            this.hangup();
        }, 300 * 1000); // 3 minutes
    }

    stopProcessing() {
        clearInterval(this.interval);
        this.interval = "";
    }

    async detectSilence(windowSize = 5000, energyThreshold = 0.17) {
        // payload make it a string of all the data.
        console.log(
            "length of data going into detectSilence",
            this.data.length,
        );
        let allData = [];
        this.data.map((load) => {
            allData.push(Buffer.from(load.payload, "base64"));
        });

        allData = Buffer.concat(allData);

        const pcmData = await this.convertToPcm(allData);

        const energies = [];

        for (let i = 0; i < pcmData.length; i += windowSize) {
            const window = pcmData.slice(
                i,
                Math.min(i + windowSize, pcmData.length),
            );
            const energy =
                window.reduce((sum, val) => sum + val, 0) / window.length;
            energies.push(energy);
        }

        const isSilent = energies.map((energy) => energy > energyThreshold);

        console.log("Heres the thing tho...", energies);
        console.log("heres the silent array", isSilent);

        return isSilent;
    }

    calculatePlayback(audioDataLength, sample) {
        const duration = audioDataLength / (sample * 1);
        this.aiDuration += duration;
    }


    async removeMessages() {
        sendAudio(
            JSON.stringify({ 
                "event": "clear",
                "streamSid": this.streamSid,
            })
        )
        
    }

    async convertToPcm(mulawData) {
        const mu = 255;
        const pcmData = new Float32Array(mulawData.length);

        for (let i = 0; i < mulawData.length; i++) {
            const y = mulawData[i];
            const x =
                Math.sign(y - 128) *
                (1 / mu) *
                ((1 + mu) ** (Math.abs(y - 128) / 128) - 1);
            pcmData[i] = x;
        }

        return pcmData;
    }

    async hangup() {

        if (this.uuid === "demo") {
            client.calls(this.callSid).update({ status: "completed" });
            return
        } else {

            if (this.rating > 75) {
                this.isLead = true;
    
                
    
                client.calls(this.callSid).update({ status: "completed" });
                let readableTranscript = "";
                this.transcript.map((message) => {
                    readableTranscript +=
                        message.sender + ": " + message.message + "\n\n";
                });
                const prompt = `Attached to this text is the transcript of a whole phone call converesation. You will be given the criteria of a job. I want you to generate a score from 0-100, 0 meaning the person isn't a good candidate at all for the position and 100 meaning that the candidate is a perfect match.
                Here's the criteria you want to base it off of: ${this.criteria}
                
                Here's the full transcript of the conversation so you can base it off of: ${readableTranscript}
                `
    
                const result = await model.generateContent(prompt);
                const aiSummary = result.response.text();
                
                this.convoSummary = aiSummary;
                console.log("AI summary", aiSummary);
    
             
            } else {
                client.calls(this.callSid).update({ status: "completed" });
            }







        }

        
        







    }

    async addData(sequenceNumber, payload) {
        const dataAdded = {
            sequenceNumber: sequenceNumber,
            payload: payload,
        };

        


        this.data.push(dataAdded);
    }

    async setWebsocket(ws) {
        this.ws = ws;
    }

    async resetData() {
        this.data = [];
    }

    async startInterval() {
        this.interval = setInterval(async () => {
            if (this.data.length > 0) {

                if (!this.aiTalking) {
                    const speechClient = new speech.SpeechClient();
                    const request = {
                        config: {
                            encoding: "MULAW",
                            sampleRateHertz: 8000,
                            languageCode: "en-US",
                        },
                        single_utterance: true,
                    };
                    const recognizeStream = speechClient
                        .streamingRecognize(request)
                        .on("error", console.error)
                        .on("data", (data) => {
                            const result = data.results[0];
                            console.log(data.results);

                            if (result.alternatives[0]) {
                                this.lastWords =
                                    result.alternatives[0].transcript;
                                console.log(
                                    `Transcription: ${result.alternatives[0].transcript}`,
                                );
                            }
                        });
                    const bufferStream = new require("stream").Readable();
                    this.data.map((piece) => {
                        bufferStream.push(Buffer.from(piece.payload, "base64"));
                    });

                    bufferStream.push(null);
                    bufferStream.pipe(recognizeStream);

                    let silenceArray = await this.detectSilence();
                    // console.log(silenceArray)
                    console.log("is the ai currently talking", this.aiTalking);
                    let silenceStreak = 0;

                    for (let i = 0; i < silenceArray.length; i++) {
                        let value = silenceArray[i];
                        if (value === false) {
                            silenceStreak = 0;
                        } else {
                            silenceStreak += 1;
                        }
                        console.log(silenceArray);
                        // used to be a 7 lets see how it be going
                        if (silenceStreak >= 2) {
                            // console.log("silence detected")
                            if (this.aiTalking === false) {
                                silenceStreak = 0;
                                console.log(silenceArray);
                                console.log("called for some texting");

                                if (
                                    this.lastWords !== "" ||
                                    this.transcript.length === 0
                                ) {
                                    this.transcript.push({
                                        sender: "Person on the phone",
                                        message: this.lastWords,
                                        order: this.messageNumber,
                                    });

                                    this.messageNumber++;
                                    this.lastWords = "";
                                    this.processInterval();

                                    break;
                                } else {
                                    console.log("nothing was said?");
                                }
                            } else {
                                console.log("silence but ai is talking rn");
                            }
                        } else {
                            console.log("we are silent rn");
                        }
                    }
                    

                }
                // else {
                //     let words = "";
                //     const speechClient = new speech.SpeechClient();
                //     const request = {
                //         config: {
                //             encoding: "MULAW",
                //             sampleRateHertz: 8000,
                //             languageCode: "en-US",
                //         },
                //         single_utterance: true,
                //     };
                //     const recStream = speechClient
                //         .streamingRecognize(request)
                //         .on("error", console.error)
                //         .on("data", (data) => {
                //             const result = data.results[0];
                //             console.log(data.results);

                //             if (result.alternatives[0]) {
                //                 words =
                //                     result.alternatives[0].transcript;
                //                 console.log(
                //                     `Transcription: ${result.alternatives[0].transcript}`,
                //                 );
                //             }
                //         });
                //     const streamBuffer = new require("stream").Readable();
                //     console.log(this.data.length)
                //     this.data.map((piece) => {
                //         streamBuffer.push(Buffer.from(piece.payload, "base64"));
                //     });

                //     streamBuffer.push(null);
                //     streamBuffer.pipe(recStream);



                //     if (words.split(" ").length > 2) {
                //         // bookmark
                //         this.transcript.splice(length-1, 1)
                        

                //         let silenceArray = await this.detectSilence();
                //         console.log(silenceArray)
                //         console.log("is the ai currently talking", this.aiTalking);
                //         let silenceStreak = 0;

                //         for (let i = 0; i < silenceArray.length; i++) {
                //             let value = silenceArray[i];
                //             if (value === false) {
                //                 silenceStreak = 0;
                //             } else {
                //                 silenceStreak += 1;
                //             }
                //             console.log(silenceArray);
                //             // used to be a 7 lets see how it be going
                //             if (silenceStreak >= 2) {
                //                 // console.log("silence detected")
                    
                //                     silenceStreak = 0;
                //                     console.log(silenceArray);
                //                     console.log("called for some texting");

                                    
                //                         let prevWords = this.transcript[this.transcript.length-1].message + " " +words


                //                         this.transcript[this.transcript.length-1].message = prevWords

                //                         this.lastWords = "";
                //                         this.removeMessages()
                //                         clearTimeout(this.resetAudio)
                //                         this.resetAudio();
                //                         this.processInterval();
                                        

                //                         break;
                                    
                //                 } else {
                //                     console.log("silence but ai is talking rn");
                //                 }
                //             }
                //         }
                        
                        
                        

                        
                        

                        
                    
                    
                // }
                    

            } else {
                console.log("No data to process");
            }
        }, 500);
    }

    async processInterval() {
        // console.log("talking to the ai now");
        if (this.data.length === 0) {
            console.log("No data to process");
            return;
        }

        this.aiTalking = true;

        // let convertedData = "";

        this.resetData(); // Clear data after processing
        try {
            let readableTranscript = "";
            this.transcript.map((message) => {
                readableTranscript +=
                    message.sender + ": " + message.message + "\n\n";
            });
            // console.log(readableTranscript);
            // console.log(
            //     "heres the transcription that was sent as param: " +
            //         transcription,
            // );

            if (this.transcript.length !== 0) {
        
            
                
                const prompt = `
                        You are an interviewer named Jack. You are in a phone call, calling a candidate that signed up for a job that you are the recruiter for.
                        Before asking any questions about the job, establish rapport by asking about their day and such. Here's the criteria that you are quizzing for.

                        Criteria: ${this.criteria}

                        Ask at maximum five questions that you believe aligns with the criteria. These questions should be based off of the criteria and should allow you to assess the candidate.
                        After you ask the five questions, say goodbye to the candidate and hangup the call.

                        Here's what you know about the candidate:

                            -The Candidate is named ${this.applicant.name}, refer to them by their name and start the call by asking if you are speaking to the right person.
                            -The Candidate has worked in ${this.applicant.previousWork}.
                            -The Candidate has ${this.applicant.experience} years of experience. 
                            
                        Output your response in JSON format with two fields:

                        1. "response": The next statement or question you will say based on the conversation so far.
                        2. "rating": A number from 1 to 100 indicating if you think the person is a good or bad candidate so far.
                        3. "hangUp": A boolean value indicating whether you should hangup from the call. Only make this value true after saying goodbye or the person is being rude. If you deem the person is being inappropriate, set this value to true. 

                        If a transcript is provided, continue the conversation from where it left off, responding naturally to the last message. If no transcript is provided, start by introducing yourself and establishing rapport.

                        Example response:
                        \`\`\`json
                        {
                          "response": "I'm doing well, thank you. What can I assist you with today?",
                          "rating": 50,
                          "hangUp": false
                        }
                        \`\`\`

                        Here’s the transcript of the conversation so far:
                        \`\`\`
                        ${readableTranscript}
                        \`\`\`
                        `;

                console.log("AI IS BEING CALLED HELP!");
                const result = await model.generateContent(prompt);
                const geminiResponse = result.response.text();
                console.log("Already generated Audio");
                this.processResponse(geminiResponse);
            } else {
                console.log(
                    "Empty response from transcript so we are going to wait.\nResetting data value",
                );
                this.aiTalking = false;
                this.resetData();
            }
        } catch (error) {
            console.error("Error converting file:", error);
        }
    }

    async sendAudio(payload) {
        this.ws.send(payload);
    }

    async updateConversation(response) {
        return new Promise(async (resolve) => {
            this.aiTalking = true;
            await this.generateAudio(response).then(async (res) => {
                const processStream = async () => {
                    const reader = res.getReader();

                    try {
                        // aiTalking = true;
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) {
                                break;
                            }

                            let audioLength = Buffer.from(value).length;
                            this.calculatePlayback(audioLength, 8000);

                            const buffer =
                                Buffer.from(value).toString("base64");

                            new Promise((resolve) => {
                                this.aiTalking = true;
                                console.log(
                                    "we r sending audio rn!",
                                    this.streamSid,
                                );

                                this.sendAudio(
                                    JSON.stringify({
                                        event: "media",
                                        streamSid: this.streamSid,
                                        media: {
                                            payload: buffer,
                                        },
                                        
                                    }),
                                );
                                resolve;
                            });
                        }
                    } finally {
                        reader.releaseLock();
                    }
                };

                await processStream();
                this.messageNumber++;
                resolve(response);
            });
        });
    }

    async processResponse(response) {
        try {
            let checkedResponse = response.replace(/\n/g, "");
            checkedResponse = response.replace(/(\w+):/g, '"$1":');
            let fedToTwilio = JSON.parse(checkedResponse);

            if (fedToTwilio.response.trim() === "") {
                return;
            } else {
                await this.updateConversation(fedToTwilio).then((res) => {
                    this.aiDuration = Math.ceil(this.aiDuration);
                    // console.log("you need to wait this long now", aiDuration);
                    clearTimeout(this.resetAudio);
                    this.resetAudio = setTimeout(() => {
                        this.aiDuration = 0;
                        // console.log("AI TALKING IS FALSE");
                        this.aiTalking = false;
                        if (fedToTwilio.hangUp) {
                            hangup();
                            return;
                        }
                    }, this.aiDuration * 1000);
                    this.rating = res.rating;
                    this.transcript.push({
                        sender: "You",
                        message: res.response,
                        order: this.messageNumber,
                    });
                });
            }
        } catch (e) {
            console.log(e);
            console.log(response);
            let cleanedResponse =
                "{" + response.split("{")[1].split("}")[0].trim() + "}";
            cleanedResponse = cleanedResponse.replace(/\n/g, "");
            cleanedResponse = cleanedResponse.replace(/(\w+):/g, '"$1":');
            cleanedResponse = JSON.parse(cleanedResponse);

            if (cleanedResponse.response.trim() === "") {
                return;
            } else {
                await this.updateConversation(cleanedResponse).then((res) => {
                    this.aiDuration = Math.ceil(this.aiDuration);
                    // console.log("you need to wait this long now", aiDuration);
                    clearTimeout(this.resetAudio);
                    this.resetAudio = setTimeout(() => {
                        this.aiDuration = 0;
                        // console.log("AI TALKING IS FALSE");

                        this.aiTalking = false;
                        if (cleanedResponse.hangUp) {
                            this.hangup();
                            return;
                        }
                    }, this.aiDuration * 1000);
                    this.rating = res.rating;

                    this.transcript.push({
                        sender: "You",
                        message: res.response,
                        order: this.messageNumber,
                    });
                });
            }
        }
    }

    async generateAudio(response) {
        return new Promise(async (resolve) => {
            const url =
                "https://api.elevenlabs.io/v1/text-to-speech/03vEurziQfq3V8WZhQvn?optimize_streaming_latency=4&output_format=ulaw_8000";
            let textNeeded = response.response;
            console.log("heres the audio that is being generated", textNeeded);
            const body = {
                method: "POST",
                // url: "https://api.elevenlabs.io/v1/text-to-speech/IKne3meq5aSn9XLyUdCD",
                headers: {
                    "xi-api-key": process.env.ELEVENLABS_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model_id: "eleven_turbo_v2",
                    text: textNeeded,
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        style: 0,
                        use_speaker_boost: false,
                    },
                }),
            };

            console.log("Generated audio");
            const request = await fetch(url, body);

            const audio = await request.body;

            resolve(audio);
        });
    }
}

module.exports = Call;
