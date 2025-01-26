require('dotenv').config()
const express = require("express");
const bodyParser = require("body-parser");
const bcrypt = require('bcrypt');
const md5 = require("md5")
const cors = require("cors")
const nodemailer = require("nodemailer")
const mongoose = require("mongoose")
const { v4: uuidv4 } = require('uuid');
const Cryptr = require('cryptr');
const session = require("express-session");
const MemoryStore = require('memorystore')(session)
const fs = require("fs")
const csv = require('csv-parser')
const Call = require("./Call.js");
const https = require("https")
const WebSocket = require("ws");




const saltRounds = 10;



const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require("twilio")(accountSid, authToken);

const app = express();






const cmod = new Cryptr(process.env.SECRET, { encoding: 'base64', pbkdf2Iterations: 10000, saltLength: 20 });

app.use(session({
    secret: process.env.COOKIE_SECRET,
    cookie: {
        path: "/",
        maxAge: 2628000000,
        httpOnly: true , // This is because i want to track if the cookie changes so i can change accordingly.
        sameSite: "none",
        secure: true, // Set the Secure attribute
    },
    resave: false,
    saveUninitialized: true,
    store: new MemoryStore({
        checkPeriod: 86400000 // prune expired entries every 24h
    }), 
}));

app.use(bodyParser.json({limit: "10mb"}))

function authenticateUser(req) {

    return new Promise((resolve) => {
        let sessionId = req.sessionID;

        if (!sessionId) {
            resolve("No user found");
        } else {
            req.sessionStore.get(sessionId, (err, session) => {
                if (err) {
                    console.log(err);
                    resolve("No user found");
                } else {
                    if (!session) {
                        resolve("No user found");
                    } else {
                        const currentUser = session.user;
                        if (!currentUser) {
                            resolve("No user found");
                        } else {
                            resolve(currentUser);
                        }
                    }
                }
            });
        }
    });
}

let options = {};
if (process.env.NODE_ENV === "DEV") {
    console.log('\x1b[31m%s\x1b[0m', 'Currently in development mode (switch to PROD when deploying)'); 
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    options = {
        key: fs.readFileSync('C:\\Users\\marac\\code\\hackathon-quhacks\\key.pem'),
        cert: fs.readFileSync('C:\\Users\\marac\\code\\hackathon-quhacks\\cert.pem'),
        // Remove this line once done with production
        rejectUnauthorized: false
    };

    app.use(cors({
        origin: "http://localhost:5173",
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
        credentials: true
    }))
} else {

    options = {
        key: fs.readFileSync("/etc/letsencrypt/live/api.hicruit.us/privkey.pem"),
        cert: fs.readFileSync("/etc/letsencrypt/live/api.hicruit.us/fullchain.pem")
    }

    app.use(cors({
        origin: "https://hicruit.us",
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
        credentials: true
    }))
    // PROD credentials.
}

console.log(options)
const server = https.createServer(options, app);


// mongoose.connect(`mongodb+srv://${process.env.MONGODB_USER}:${process.env.MONGODB_PASS}@hoyahacks.88863.mongodb.net/`);
mongoose.connect("mongodb://localhost:27017/hoyahacks")


const userSchema = new mongoose.Schema({


    uuid: {
        index: true,
        type: String,
        required: true,
    },
    name: {
        type: String,
        required: false
    },
    email: {
        index: true,
        type: String,
        required: true
    },
    emailHash: {
        type: String,
        required: true,
        index: true
    },
    password: {
        type: String,
        required: true,
    }
})


const campaignSchema = new mongoose.Schema({
    id: {
        type: String,
        unique: true,
        index: true,
    },
    uuid: {
        type: String,
        index: true
    },
    jobListing: {
        type: String,
        unique: false,
    },
    applicants: {
        type: Array,
        unique: false
    },
    numberOfApplicants: {
        type: Number,
        unique: false,
    },
    criteria: {
        type: String,
        unique: false,
    }



})





const User = new mongoose.model("User", userSchema)
const Campaign = new mongoose.model("Campaign", campaignSchema)






app.post("/signup", (req,res) => {
    const {name, email, password} = req.body;

    let inputs = {};


    if (name && email && password) {
        inputs = {
            name: name.trim().toLowerCase(),
            email: email.trim().toLowerCase(),
            password: password.trim().toLowerCase(),
        }
    } else {
        res.status(400).send(JSON.stringify({
            code: "err",
            message: "invalid request"
        }))
    }

    
    
    console.log(inputs)
    authenticateUser(req).then((id) => {
        if (id === "No user found") {
            // This is expected

            User.findOne({emailHash: md5(inputs.email)}).then(async(user,err) => {
                if (err) {
                    console.log(err);
                    res.status(500).send(JSON.stringify({
                        code: "err",
                        message: "invalid request"
                    }))
                } else {

                    if (user) {
                        req.session.user = user.uuid;
                        res.status(200).send(JSON.stringify({
                            code: "ok",
                            message: "account exists"
                        }))
                    } else {

                        const uuid = uuidv4()

                        bcrypt.hash(inputs.password, saltRounds, async function(err, hash) {
                            if (err) {
                                console.log(err)
                                res.status(400).send(JSON.stringify({
                                    code: "err",
                                    message: "invalid request"
                                }))
                            } else {

                                const newUser = new User({
                                    uuid: uuid,
                                    name: cmod.encrypt(inputs.name),
                                    email: cmod.encrypt(inputs.email),
                                    emailHash: md5(inputs.email),
                                    password: hash
        
        
                                })
                                
                                await newUser.save(); 
                                req.session.user = uuid;

                        


                                res.status(200).send(JSON.stringify({
                                    code: "ok",
                                    message: "user created"
                                }))
      

                            }
                        });
                        

                        

                       

                    }


                }
            })







        } else {
            res.status(200).send(JSON.stringify({
                code: "ok",
                message: "logged in"
            }))
        }
    })










})



app.post("/login", (req,res) => {
    const {email, password} = req.body;

    if (email && password) {
        User.findOne({emailHash: md5(email)}).then((user,err) => {
            if (err) {
                console.log(err)
                res.status(400).send(JSON.stringify({
                    code: "err",
                    message: "invalid request"
                }))
            } else {
                if (user !== null) {



                    bcrypt.compare(password, user.password, function(err, result) {

                        if (err) {
                            console.log(err)
                            res.status(400).send(JSON.stringify({
                                code: "err",
                                message: "invalid request"
                            }))
                        } else {
                            if (result) {
                                req.session.user = user.uuid
                                res.status(200).send(JSON.stringify({
                                    code: "ok",
                                    message: "success"
                                }))
                            } else {
                                res.status(403).send(JSON.stringify({
                                    code: "err",
                                    message: "invalid credentials"
                                }))
                            }
                        }
                        // result == true
                    });
                    

                    




                } else {

                    res.status(403).send(JSON.stringify({
                        code: "err",
                        message: "invalid credentials"
                    }))



                }
            }
        })
    } else {
        res.status(400).send(JSON.stringify({
            code: "err",
            message: "invalid request"
        }))
    }

    



})



app.get("/getUser", (req,res) => {
    authenticateUser(req).then((id) => {
        if (id === "No user found") {
            res.status(403).send(JSON.stringify({
                code: "err",
                message: "invalid request"
            }))
        } else {
            User.findOne({uuid: id}).then((user,err) => {
                if (err) {
                    console.log(err)
                    res.status(500).send(JSON.stringify({
                        code: "err",
                        message: "invalid request"
                    }))
                } else {
                    if (user!==null) {
                        const decryptedUser = {
                            name: cmod.decrypt(user.name),
                            email: cmod.decrypt(user.email),
                        }

                        Campaign.find({uuid: user.uuid}).then((listings, err) => {
                            if (err) {
                                console.log(err)
                                res.status(500).send(JSON.stringify({
                                    code: "err",
                                    message: "invalid request"
                                }))
                            } else {
                                
                                const things = []

                                listings.map(async(listing, i) => {
                                    let decryptedDetails = {
                                        jobListing: cmod.decrypt(listing.jobListing),
                                        numberOfApplicants: listing.numberOfApplicants,
                                        uuid: user.uuid,
                                        id: listing.id,
                                    }

                                    const allApplicants = []

                                    listing.applicants.map((applicant,i) => {

                                        


                                        allApplicants.push({
                                            id: i,
                                            name: cmod.decrypt(applicant.name),
                                            email: cmod.decrypt(applicant.email),
                                            phone: cmod.decrypt(applicant.phone),
                                            role: cmod.decrypt(applicant.role),
                                            experience: cmod.decrypt(applicant.experience),
                                            skills: applicant.skills,
                                            compatibilityScore: applicant.compatibilityScore,
                                            status: cmod.decrypt(applicant.status)
                                        })    

                                              
                                        
                                    })

                                    decryptedDetails["applicants"] = allApplicants
                                    things.push(decryptedDetails)



                                })

                                res.status(200).send(JSON.stringify({
                                    code: "ok",
                                    message: {user: decryptedUser, campaigns: things}
                                }))
                            }
                        })



                    }
                }
            })
        }
    })
})



function processCsv(plainText) {
    // Full Name, Email, Phone Number, Current Role, Years of Experience, Skills
    // 6 different ideas
    const applicants = []


    
        //     id: 1,
        //     name: "Sarah Johnson",
        //     email: "sarah.j@email.com",
        //     phone: "+1234567890",
        //     role: "Senior Frontend Developer",
        //     experience: "5 years",
        //     skills: ["React", "TypeScript", "Node.js", "AWS"],
        //     compatibilityScore: 92,
        //     status: "new"
        //   },
    
    
    plainText.split('\n').forEach((content,i) => {

        const skills = []
        // console.log(content)
        if (i!==0) {
            const list = content.split(",")
            // console.log("heres the list",list)
            // console.log(applicants)
       
                
                list[5].split(";").forEach((val) => {
                    
                    console.log(val)
                    skills.push(val)
                })
                

                //     id: 1,
                        //     name: "Sarah Johnson",
                        //     email: "sarah.j@email.com",
                        //     phone: "+1234567890",
                        //     role: "Senior Frontend Developer",
                        //     experience: "5 years",
                        //     skills: ["React", "TypeScript", "Node.js", "AWS"],
                        //     compatibilityScore: 92,
                        //     status: "new"
                        //   },
            
                    applicants.push({
                        name: cmod.encrypt(list[0]),
                        email: cmod.encrypt(list[1]),
                        phone: cmod.encrypt(list[2]),
                        role: cmod.encrypt(list[3]),
                        experience: cmod.encrypt(list[4]),
                        skills: skills,
                        status: cmod.encrypt("new"),

                    })

            

            
        
        }
       
        // console.log(content[5].split(";"))
        
    })

    return applicants


}

const wss = new WebSocket.Server({ server: server });



wss.on("connection", function (ws) {
    // technically anyone could just connect and then we r fucked so we need to figure out a better way to do this in the future. For testing is fine though.
    twilioWs = ws;

    console.log("Just connected");

    ws.on("close", () => {
        console.log("The connection was closed and interval was cleared");
        
    });

    ws.on("message", (message) => {
        try {
            let parsedMsg = JSON.parse(message.toString());
            streamId = parsedMsg.streamSid;

            if (parsedMsg.event === "start") {
                const callSid = parsedMsg["start"]["callSid"];
                // Ensure the callSid exists in dynamicCalls

                // dynamicCalls[callSid].setWebsocket(ws);

                // Renaming the class instance key from callSid to streamId
                dynamicCalls[streamId] = dynamicCalls[callSid];
                dynamicCalls[streamId].streamSid = streamId;
                delete dynamicCalls[callSid];

                dynamicCalls[streamId].startInterval();
                dynamicCalls[streamId].setWebsocket(ws);
            } else if (parsedMsg.event === "stop") {
                console.log("The call has ended");
                dynamicCalls[streamId].stopProcessing();
            } else if (
                parsedMsg.event === "media" &&
                parsedMsg.media &&
                parsedMsg.media.track === "inbound"
            ) {
                if (parsedMsg.media.payload !== undefined) {
                    if (!dynamicCalls[streamId].aiTalking) {
                        dynamicCalls[streamId].addData(
                            parsedMsg.sequenceNumber,
                            parsedMsg.media.payload,
                        );
                    } else {
                        dynamicCalls[streamId].resetData();
                    }
                }
            }
        } catch (e) {
            console.log("Error parsing message:", e);
        }
    });
});
function callApplicants(applicants, criteria, jobListing,uuid) {

    return new Promise(async(resolve) => {
        await applicants.forEach((applicant) => {
            const phoneNumber = cmod.decrypt(applicant.phoneNumber)
            const fileOfApplicant = {
                name: cmod.decrypt(applicant.name),
                previousWork: cmod.decrypt(applicant.role),
                experience: cmod.encrypt(applicant.experience),
                skills: applicant.skills
                
    
            }
            
        client.calls
        .create({
            url: "https://api.hicruit.us/xml",
            to: `+1${phoneNumber}`,
            from: `+12403660377`,
        })
        .then((call) => {
            dynamicCalls[call.sid] = new Call(
                call.sid,
                phoneNumber,
                agentAction,
                agentArea,
                agentName,
                uuid,
                criteria,
                fileOfApplicant,
                jobListing
            );
            // globalSid = call.sid;
    
            console.log(call);
          
        });
    
    
        })

        resolve(true)

    })

   




}




app.post("/sendCalls", (req,res) => {
    authenticateUser(req).then((id) => {
        if (id === "No user found") {
            res.status(500).send(JSON.stringify({
                code: "err",
                message: "invalid request"
            }))
        } else {
            User.findOne({uuid: id}).then((user,err) => {
                if (err) {
                    console.log(err)
                    res.status(400).send(JSON.stringify({
                        code: "err",
                        message: "invalid request"
                    }))
                } else {
                    if (user) {

                        try {
                            const {campaignId} = req.body;

                            Campaign.findOne({id: campaignId}).then(async(campaign,err) => {
                                if (err) {
                                    console.log(err);
                                    res.status(500).send(JSON.stringify({
                                        code: "err",
                                        message: "invalid request"
                                    }))
                                } else {


                                    if (campaign) {

                                        callApplicants(applicants, cmod.decrypt(campaign.criteria), cmod.decrypt(campaign.jobListing), user.uuid).then(() => {
                                            res.status(200).send(JSON.stringify({
                                                code: "ok",
                                                message: "success"
                                            }))
                                        })
                                    
                                    }




                                }
                            })



                            
                        } catch(e) {
                            console.log(e)
                            res.status(400).send(JSON.stringify({
                                code: "err",
                                message: "invalid request"
                            }))
                        }




                    } else {
                        res.status(400).send(JSON.stringify({
                            code: "err",
                            message: "invalid request"
                        }))
                    }
                }
            })
            

        


        }
    })
    
    

})

app.post("/xml", (req,res) => {
    console.log("xml called");
    res.sendFile(__dirname + "/call.xml");
})

app.post("/uploadListing", async(req,res) => {

    authenticateUser(req).then(async(id) => {
        if (id === "No user found") {
            res.status(403).send(JSON.stringify({
                code: "err",
                message: "invalid request"
            }))
        } else {
            const {positionName, criteria, csvFile, manual} = req.body;


            if (!manual) {
                // when recruiters do the batch upload
                console.log(csvFile.split(",").length)
                console.log("bool value", csvFile.split(",").length % 2)
                if ((csvFile.split(",").length >6) && (positionName.length >0) && (criteria.length>0) ) {
                    const applicants = await processCsv(csvFile);

                    console.log(applicants)
                    

                    // uuid: {
                    //     type: String,
                    //     index: true
                    // },
                    // jobListing: {
                    //     type: String,
                    //     unique: false,
                    // },
                    // applicants: {
                    //     type: Array,
                    //     unique: false
                    // },
                    // numberOfApplicants: {
                    //     type: Number,
                    //     unique: false,
                    // }
                





                    
                        

                    const newCampaign = new Campaign({
                        id: uuidv4(),
                        uuid: id,
                        jobListing: cmod.encrypt(positionName.toLowerCase()),
                        criteria: criteria,
                        applicants: applicants,
                        numberOfApplicants: applicants.length,



                    })
                    newCampaign.save();
                    


                    res.status(200).send(JSON.stringify({
                        code: "ok",
                        message: "success"
                    }))





                }




            }
    
        }
        })
})

















app.get("/", (req,res) => {
    console.log(options)
    res.send("hello world");

})
















server.listen(process.env.PORT, (req,res) => {
    console.log("Server is listening on port: ", process.env.PORT)
})
