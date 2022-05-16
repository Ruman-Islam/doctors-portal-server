const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion } = require('mongodb');

// Middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vzdnu.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

const verifyJWT = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('Unauthorized Access')
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).send({ success: false, message: 'Forbidden Access' })
        }
        req.decoded = decoded;
        next();
    });

}

const run = async () => {
    try {
        await client.connect();
        const appointmentCollection = client.db("doctors-portal").collection("appointments");
        const bookingCollection = client.db("doctors-portal").collection("booking");
        const userCollection = client.db("doctors-portal").collection("users");

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const updatedDoc = { $set: { user: user } };
            const options = { upsert: true };
            const result = await userCollection.updateOne(filter, updatedDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1d' })
            res.send({ result, accessToken: token });
        })

        // getting all available appointment
        app.get('/available-appointments', async (req, res) => {
            try {
                const date = req.query.date;
                const query = { date: date };
                const appointments = await appointmentCollection.find(query).toArray();
                const bookings = await bookingCollection.find(query).toArray();
                appointments.forEach(service => {
                    const appointmentBookings = bookings.filter(b => b.treatment === service.name)
                    const booked = appointmentBookings.map(s => s.slot);
                    service.availableSlots = service.slots.filter(s => !booked.includes(s));
                })
                if (appointments.length === 0) {
                    res.send({ success: false, message: `No appointment on ${date}` });
                } else {
                    res.send({ success: true, appointments: appointments });
                }
            }
            catch (error) {
                console.log(error);
                res.send(error)
            }
        })

        /**
    * API Naming Convention
    * app.get('/booking') // get all bookings in this collection. or get more than one or by filter
    * app.get('/booking/:id') // get a specific booking 
    * app.post('/booking') // add a new booking
    * app.patch('/booking/:id) //
    * app.put('/booking/:id') // upsert ==> update (if exists) or insert (if doesn't exist)
    * app.delete('/booking/:id) //
   */

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = {
                treatment: booking.treatment,
                date: booking.date,
                patient: booking.patient,
                slot: booking.slot
            }
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            } else {
                const result = await bookingCollection.insertOne(booking);
                return res.send({ success: true, result });
            }
        })

        app.get('/my-bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            console.log(decodedEmail, email);
            if (email === decodedEmail) {
                const query = { patientEmail: email }
                const bookings = await bookingCollection.find(query).toArray();
                res.send(bookings);
            } else {
                return res.status(403).send({ success: false, message: 'Forbidden Access' })
            }

        })

        app.get('/all-users', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        })

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        })

        app.put('/user/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                const filter = { email: email };
                const updatedDoc = { $set: { role: 'admin' } };
                const result = await userCollection.updateOne(filter, updatedDoc);
                res.send(result);
            } else {
                res.status(403).send({ success: false, message: 'Forbidden' })
            }
        })

    } finally {
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Server is running well')
})

app.listen(port, () => {
    console.log('Doctors Portal server is running on port -', port);
})

// http://localhost:5000/