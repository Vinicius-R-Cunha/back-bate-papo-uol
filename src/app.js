import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from 'mongodb';
import joi from 'joi';
import dotenv from 'dotenv';
import dayjs from 'dayjs';
import { stripHtml } from "string-strip-html";

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

setInterval(handleInactive, 15000);

app.post('/participants', async (req, res) => {
    try {
        const name = stripHtml(req.body.name).result.trim();
        const validation = participantsSchema.validate(req.body, { abortEarly: false });

        if (validation.error) {
            res.status(422).send(validation.error.details.map(error => error.message));
            return;
        }

        const alreadyTaken = await db.collection('participants').find({ name: name }).collation({ locale: 'pt', strength: 2 }).toArray();

        if (alreadyTaken.length !== 0) {
            res.sendStatus(409);
            return;
        }

        await db.collection('participants').insertOne({ name, lastStatus: Date.now() });
        await db.collection('messages').insertOne({
            from: name,
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
        const user = stripHtml(req.header('User')).result.trim();
        const trimmedText = { ...req.body, text: stripHtml(req.body.text).result.trim() };
        const validation = messagesSchema.validate(req.body, { abortEarly: false });
        const userExists = await db.collection('participants').findOne({ name: user });

        if (validation.error || !userExists) {
            res.status(422).send(validation.error.details.map(error => error.message));
            return;
        }

        const message = { from: user, ...trimmedText, time: formatTime(dayjs()) };
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
        const user = stripHtml(req.header('User')).result.trim();;
        const limit = req.query.limit;
        const messages = await db.collection('messages').find().toArray();
        const filteredMessages = messages.filter(msg => (msg.from === user || msg.to === user || msg.type !== 'private_message'));

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
        const user = stripHtml(req.header('User')).result.trim();;
        const userExists = await db.collection('participants').findOne({ name: user });

        if (!userExists) {
            res.sendStatus(404);
        }

        await db.collection('participants').updateOne({ _id: userExists._id, },
            {
                $set: { ...userExists, lastStatus: Date.now() }
            });
        res.sendStatus(200);
    } catch (error) {
        res.status(500).send(error);
    }
});

async function handleInactive(req, res) {
    try {
        const participants = await db.collection('participants').find({}).toArray();
        if (participants.length !== 0) {
            for (let i = 0; i < participants.length; i++) {
                if (Date.now() - participants[i].lastStatus > 10000) {
                    await db.collection('messages').insertOne({
                        from: participants[i].name,
                        to: "Todos",
                        text: "sai da sala...",
                        type: "status",
                        time: formatTime(dayjs())
                    });
                    await db.collection('participants').deleteOne({ _id: participants[i]._id });
                }
            }
        }
    } catch {
        res.status(500).send(error);
    }
}

app.delete('/messages/:id', async (req, res) => {
    try {
        const user = stripHtml(req.header('User')).result.trim();
        const id = new ObjectId(req.params.id);
        const message = await db.collection('messages').findOne({ _id: id });

        if (!message) {
            res.sendStatus(404);
            return;
        }

        if (user !== message.from) {
            res.sendStatus(401);
            return;
        }

        await db.collection('messages').deleteOne({ _id: id });
        res.sendStatus(201);
    } catch (error) {
        res.status(500).send(error);
    }
});

app.put('/messages/:id', async (req, res) => {
    try {
        const user = stripHtml(req.header('User')).result.trim();
        const id = new ObjectId(req.params.id);
        const trimmedText = { ...req.body, text: stripHtml(req.body.text).result.trim() };
        const validation = messagesSchema.validate(req.body, { abortEarly: false });
        const userExists = await db.collection('participants').findOne({ name: user });
        const message = await db.collection('messages').findOne({ _id: id });

        if (!message) {
            res.sendStatus(404);
            return;
        }

        if (validation.error || !userExists) {
            res.status(422).send(validation.error.details.map(error => error.message));
            return;
        }

        if (user !== message.from) {
            res.sendStatus(401);
            return;
        }

        await db.collection('messages').updateOne({ _id: id, },
            {
                $set: { from: user, ...trimmedText, time: formatTime(dayjs()) }
            });

        res.sendStatus(201);
    } catch (error) {
        res.status(500).send(error);
    }
});

app.listen(5000);