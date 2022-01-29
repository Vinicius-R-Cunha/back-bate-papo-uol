import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from 'mongodb';
import joi from 'joi';
import dotenv from 'dotenv';
import dayjs from 'dayjs';

dotenv.config();

const participantsSchema = joi.object({
    name: joi.string().required(),
    lastStatus: joi.number()
});

const messagesSchema = joi.object({
    to: joi.string().required(),
    text: joi.string().required(),
    type: joi.string().valid('message', 'private_message').required()
});

const mongoclient = new MongoClient(process.env.MONGO_URI);
let db;
mongoclient.connect(() => {
    db = mongoclient.db("bate-papo-uol");
});

const app = express();
app.use(express.json());
app.use(cors());

app.post('/participants', async (req, res) => {
    try {
        const participant = req.body;
        const validation = participantsSchema.validate(participant, { abortEarly: false });

        if (validation.error) {
            res.status(422).send(validation.error.details.map(error => error.message));
            return;
        }

        const standardizedName = { name: firstLettersToUpperCase(participant.name) };
        const alreadyTaken = await db.collection('participants').findOne({ name: standardizedName.name });

        if (alreadyTaken) {
            res.sendStatus(409);
            return;
        }

        await db.collection('participants').insertOne({ ...standardizedName, lastStatus: Date.now() });

        await db.collection('messages').insertOne({
            from: standardizedName.name,
            to: "Todos",
            text: "entra na sala...",
            type: "status",
            time: formatTime(dayjs())
        });
        res.sendStatus(201);
    } catch (error) {
        res.status(500).send(error);
    }
});

function firstLettersToUpperCase(str) {
    // const arr = str.split(" ");
    // for (var i = 0; i < arr.length; i++) {
    //     arr[i] = arr[i].charAt(0).toUpperCase() + arr[i].slice(1).toLowerCase();
    // }
    // return arr.join(" ");
    return str;
}

app.get('/participants', async (req, res) => {
    try {
        const participants = await db.collection('participants').find().toArray();
        res.send(participants);
    } catch (error) {
        res.status(500).send(error);
    }
});

app.post('/messages', async (req, res) => {
    try {
        const user = firstLettersToUpperCase(req.header('User'));
        const validation = messagesSchema.validate(req.body, { abortEarly: false });
        const userExists = await db.collection('participants').findOne({ name: user });

        if (validation.error || !userExists) {
            res.status(422).send(validation.error.details.map(error => error.message));
            return;
        }

        const message = { from: user, ...req.body, time: formatTime(dayjs()) };
        await db.collection('messages').insertOne(message);

        res.sendStatus(201);
    } catch (error) {
        res.status(500).send(error);
    }
});

function formatTime(dayjs) {
    const h = dayjs.hour();
    const m = dayjs.minute();
    const s = dayjs.second();
    return `${h < 10 ? `0${h}` : h}:${m < 10 ? `0${m}` : m}:${s < 10 ? `0${s}` : s}`;
}

app.get('/messages', async (req, res) => {
    try {
        const user = firstLettersToUpperCase(req.header('User'));
        const limit = req.query.limit;
        const messages = await db.collection('messages').find().toArray();
        const filteredMessages = messages.filter(msg => (msg.from === user || msg.to === user || msg.type === 'message' || msg.type === 'status'));

        if (!limit) {
            res.status(201).send(filteredMessages);
        } else {
            res.status(201).send(filteredMessages.slice(-limit));
        }
    } catch (error) {
        res.status(500).send(error);
    }
});

app.post('/status', async (req, res) => {
    try {
        const user = firstLettersToUpperCase(req.header('User'));
        const userExists = await db.collection('participants').findOne({ name: user });

        if (!userExists) {
            res.sendStatus(404);
        }

        await db.collection('participants').updateOne({
            _id: userExists._id,
        }, {
            $set: { ...userExists, lastStatus: Date.now() }
        });
        res.sendStatus(200);
    } catch (error) {
        res.status(500).send(error);
    }
});

app.listen(5000);