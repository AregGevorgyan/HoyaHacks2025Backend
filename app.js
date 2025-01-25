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
const https = require("https")
const WebSocket = require("ws");






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
        origin: "http://localhost:3000",
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
        credentials: true
    }))
} else {
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
    email: {
        index: true,
        type: String,
        required: true
    },
    emailHash: {
        type: String,
        required: true,
        index: true
    }
})





const User = new mongoose.model("User", userSchema)














app.get("/", (req,res) => {
    console.log(options)
    res.send("hello world");

})







server.listen(process.env.PORT, (req,res) => {
    console.log("Server is listening on port: ", process.env.PORT)
})
