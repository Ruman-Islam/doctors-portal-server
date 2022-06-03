require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);



// Configuration of SendInBlue Emailer //
// const nodemailer = require('nodemailer');
// const sendinBlue = require('nodemailer-sendinblue-transport');
const Sib = require('sib-api-v3-sdk');
const sendinBlueClient = Sib.ApiClient.instance

const apiKey = sendinBlueClient.authentications['api-key'];
apiKey.apiKey = process.env.EMAIL_SENDER_KEY
const tranEmailApi = new Sib.TransactionalEmailsApi();
// ------------------------------- //

const sendAppointmentEmail = (booking) => {
    const { treatment, date, slot, patientEmail, patientName } = booking;

    const sender = {
        email: process.env.EMAIL_SENDER
    }

    tranEmailApi.sendTransacEmail({
        sender,
        to: [{ email: patientEmail }],
        subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
        textContent: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
        htmlContent: `
      <div>
        <h1> Hello ${patientName}, </h1>
        <h2>Your Appointment for ${treatment} is confirmed</h2>
        <p>Looking forward to seeing you on ${date} at ${slot}.</p>
        <p>Our Address</p>
        <p>Andor Killa Bandorban</p>
        <p>Bangladesh</p>
        <p>
            Visit our website <a href="https://doctors-portal-67683.web.app/">Doctors Portal</a>
        </p>
      </div>
    `
    })
    // .then(console.log)
    // .catch(console.log)
}

const sendPaymentConfirmationEmail = (booking) => {
    const { treatment, date, slot, patientEmail, patientName, transactionId } = booking;

    const sender = {
        email: process.env.EMAIL_SENDER
    }

    tranEmailApi.sendTransacEmail({
        sender,
        to: [{ email: patientEmail }],
        subject: `We have received your payment for ${treatment} is on ${date} at ${slot}`,
        textContent: `Your payment for  this Appointment ${treatment} is on ${date} at ${slot}`,
        htmlContent: `
      <div>
        <h1> Hello ${patientName}, </h1>
        <h1> Thank Your for your payment</h1>
        <h2>Your Appointment for ${treatment} has confirmed</h2>
        <p>Looking forward to seeing you on ${date} at ${slot}.</p>
        <p>Your transaction Id is ${transactionId}</p>
        <p>Andor Killa Bandorban</p>
        <p>Bangladesh</p>
        <p>
            Visit our website <a href="https://doctors-portal-67683.web.app/">Doctors Portal</a>
        </p>
      </div>
    `
    })
    // .then(console.log)
    // .catch(console.log)
}

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
        const doctorCollection = client.db("doctors-portal").collection("doctors");
        const paymentCollection = client.db("doctors-portal").collection("payments");

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            } else {
                res.status(403).send({ success: false, message: 'Forbidden' })
            }
        }

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

        // getting all available appointments on specific day
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
                res.send(error)
            }
        })

        // getting all available appointments
        app.get('/all-appointments', async (req, res) => {
            const query = req.query;
            const appointments = await appointmentCollection.find(query).project({ name: 1 }).toArray();
            const appointmentNames = [];
            for (const ap of appointments) {
                if (!appointmentNames.includes(ap.name)) {
                    appointmentNames.push(ap.name);
                }
            }
            res.send(appointmentNames);
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
                sendAppointmentEmail(booking);
                return res.send({ success: true, result });
            }
        })

        app.get('/my-bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if (email === decodedEmail) {
                const query = { patientEmail: email }
                const bookings = await bookingCollection.find(query).toArray();
                res.send(bookings);
            } else {
                return res.status(403).send({ success: false, message: 'Forbidden Access' })
            }
        })

        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        })

        app.patch('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
            const booking = await bookingCollection.findOne({ transactionId: payment.transactionId });
            sendPaymentConfirmationEmail(booking);
            res.send(updatedDoc);
        })

        app.get('/all-users', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        })

        app.get('/doctor', verifyJWT, async (req, res) => {
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        })

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        })

        app.put('/user/add-admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updatedDoc = { $set: { role: 'admin' } };
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result);
        })

        app.put('/user/remove-admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updatedDoc = { $set: { role: 'user' } };
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result);
        })

        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);
        })

        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);
        })

        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        })

        app.get('/test', async (req, res) => {
            res.send('Working Well')
        })

    } finally {
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Doctors Portal server is running running well')
})

app.listen(port, () => {
    console.log('Doctors Portal server is running on port -', port);
})

// http://localhost:5000/
// https://hidden-peak-72687.herokuapp.com/