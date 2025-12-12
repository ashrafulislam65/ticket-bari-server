const express = require('express')
const cors = require('cors')
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000
const admin = require("firebase-admin");

const serviceAccount = require("./ticket-bari-firebase-adminsdk-fbsvc.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// middlewares
app.use(express.json())
app.use(cors());

const verifyFBToken = async (req, res, next) => {

    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: "Unauthorized access" });
    }
    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        console.log('decoded token', decoded);
        req.decoded_email = decoded.email;

    }
    catch (err) {
        return res.status(401).send({ message: "Unauthorized access" });

    }
    next();
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fcejyck.mongodb.net/?appName=Cluster0`;
const stripe = require('stripe')(process.env.STRIPE_SECRET);
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();


        const db = client.db('ticket_bari_DB');
        const usersCollection = db.collection('users');
        const ticketsCollection = db.collection('tickets');
        const bookingsCollection = db.collection('bookings');
        const paymentsCollection = db.collection('payments');
        // user related APIs
        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user'; // default role
            user.createdAt = new Date();
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });
        // ticket related APIs
        app.post('/tickets', async (req, res) => {
            try {
                const newTicket = req.body;

                // Just insert
                const result = await ticketsCollection.insertOne(newTicket);

                res.json({
                    success: true,
                    message: "Ticket created successfully!",
                    ticketId: result.insertedId
                });

            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: "Something went wrong!",
                    error: error.message
                });
            }
        });
        app.get('/tickets', async (req, res) => {
            try {
                const tickets = await ticketsCollection.find().toArray();

                res.json({
                    success: true,
                    count: tickets.length,
                    data: tickets
                });

            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: "Failed to fetch tickets",
                    error: error.message
                });
            }
        });
        //  specific ticket API
        app.get('/tickets/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const ticket = await ticketsCollection.findOne({ _id: new ObjectId(id) });

                if (!ticket) {
                    return res.status(404).json({
                        success: false,
                        message: "Ticket not found"
                    });
                }

                res.json({
                    success: true,
                    data: ticket
                });

            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: "Failed to fetch ticket",
                    error: error.message
                });
            }
        });
        // update ticket API
        app.patch('/tickets/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const updatedData = req.body;

                // If departureDate or departureTime changes, rebuild full datetime
                if (updatedData.departureDate && updatedData.departureTime) {
                    updatedData.departureDateTime = new Date(`${updatedData.departureDate}T${updatedData.departureTime}:00`);
                }

                const result = await ticketsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedData }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({
                        success: false,
                        message: "Ticket not found"
                    });
                }

                res.json({
                    success: true,
                    message: "Ticket updated successfully"
                });

            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: "Failed to update ticket",
                    error: error.message
                });
            }
        });
        //  Delete ticket API
        app.delete('/tickets/:id', async (req, res) => {
            try {
                const id = req.params.id;

                const result = await ticketsCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) {
                    return res.status(404).json({
                        success: false,
                        message: "Ticket not found"
                    });
                }

                res.json({
                    success: true,
                    message: "Ticket deleted successfully"
                });

            } catch (error) {
                res.status(500).json({
                    success: false,
                    message: "Failed to delete ticket",
                    error: error.message
                });
            }
        });
        // ticket Booking related APIs
        app.get('/bookings', async (req, res) => {
            const { userEmail } = req.query;

            if (!userEmail) {
                return res.send("userEmail is required");
            }

            const bookings = await bookingsCollection
                .find({ userEmail })
                .toArray();

            res.send(bookings);
        });

        app.post('/bookings', async (req, res) => {
            const { ticketId, userEmail, quantity } = req.body;

            // 1. Load main ticket
            const ticket = await ticketsCollection.findOne({ _id: new ObjectId(ticketId) });
            if (!ticket) {
                return res.status(404).json({ message: "Ticket not found" });
            }

            // Build full departure datetime
            const departureDateTime = new Date(`${ticket.departureDate}T${ticket.departureTime}:00`);

            // 2. Check if event expired
            if (departureDateTime < new Date()) {
                return res.status(400).json({ message: "Departure time already passed!" });
            }

            // 3. Quantity check
            if (ticket.quantity === 0) {
                return res.status(400).json({ message: "Ticket is out of stock" });
            }

            if (quantity > ticket.quantity) {
                return res.status(400).json({ message: "Not enough tickets available" });
            }

            // 4. Create booking entry
            const newBooking = {
                ticketId,
                title: ticket.title,
                transport: ticket.transport,
                from: ticket.from,
                to: ticket.to,

                // FIXED 🚀 Save full schedule
                departureDate: ticket.departureDate,
                departureTime: ticket.departureTime,
                departureDateTime, // saved as ISO date

                price: ticket.price,
                quantity,
                totalPrice: ticket.price * quantity,
                userEmail,
                status: "Pending",
                bookedAt: new Date()
            };

            const bookingResult = await bookingsCollection.insertOne(newBooking);

            // 5. Reduce ticket quantity
            await ticketsCollection.updateOne(
                { _id: new ObjectId(ticketId) },
                { $inc: { quantity: -quantity } }
            );

            res.json({
                success: true,
                message: "Booking successful!",
                bookingId: bookingResult.insertedId
            });
        });
        // Vendor related APIs can be added here
        // GET vendor requested bookings
        app.get("/vendor/bookings", async (req, res) => {
            try {
                const vendorEmail = req.query.vendorEmail;

                if (!vendorEmail) {
                    return res.status(400).json({
                        success: false,
                        message: "vendorEmail is required",
                    });
                }

                // 1. Get all tickets created by this vendor
                const vendorTickets = await ticketsCollection
                    .find({ vendorEmail })
                    .project({ _id: 1 }) // only need ticket IDs
                    .toArray();

                const ticketIds = vendorTickets.map(t => t._id.toString());

                // 2. Find all bookings for these tickets
                const bookings = await bookingsCollection
                    .find({ ticketId: { $in: ticketIds } })
                    .toArray();

                res.json({
                    success: true,
                    count: bookings.length,
                    data: bookings,
                });

            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // ACCEPT booking
        app.patch("/bookings/accept/:id", async (req, res) => {
            try {
                const id = req.params.id;

                const result = await bookingsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "accepted" } }
                );

                res.json({
                    success: true,
                    message: "Booking accepted!",
                });

            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // REJECT booking
        app.patch("/bookings/reject/:id", async (req, res) => {
            try {
                const id = req.params.id;

                const result = await bookingsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "rejected" } }
                );

                res.json({
                    success: true,
                    message: "Booking rejected!",
                });

            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // Get a specific booking by ID
        app.get("/bookings/:id", async (req, res) => {
            try {
                const id = req.params.id;

                const booking = await bookingsCollection.findOne({
                    _id: new ObjectId(id),
                });

                if (!booking) {
                    return res.status(404).json({
                        success: false,
                        message: "Booking not found",
                    });
                }

                res.json(booking);

            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message,
                });
            }
        });
        // payment related APIs can be added here
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.totalPrice) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: paymentInfo.ticketTitle,
                            },
                        },
                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.userEmail,
                mode: 'payment',

                metadata: {
                    bookingId: paymentInfo.bookingId,
                    ticketTitle: paymentInfo.ticketTitle  // IMPORTANT
                },

                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            });

            res.send({ url: session.url });
        });



        // VERIFY payment and update booking status + SAVE history
        app.post("/payment/success", async (req, res) => {
            try {
                const { sessionId } = req.body;

                // Load Stripe session
                const session = await stripe.checkout.sessions.retrieve(sessionId);

                const bookingId = session.metadata.bookingId;
                const ticketTitle = session.metadata.ticketTitle;

                // 1. Update Booking Status
                await bookingsCollection.updateOne(
                    { _id: new ObjectId(bookingId) },
                    { $set: { status: "paid" } }
                );

                // 2. Save Transaction History
                const paymentData = {
                    transactionId: session.payment_intent,
                    amount: session.amount_total / 100,
                    userEmail: session.customer_email,
                    ticketTitle: ticketTitle,
                    date: new Date()
                };
                // --- Prevent duplicate transaction entry ---
                const existing = await paymentsCollection.findOne({
                    transactionId: session.payment_intent
                });

                if (existing) {
                    return res.json({ success: true, message: "Already processed" });
                }

                await paymentsCollection.insertOne(paymentData);

                res.json({ success: true, message: "Payment saved & booking updated" });

            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });


        app.get("/payments", verifyFBToken, async (req, res) => {
            const { email } = req.query;

            // 1️⃣ Must include email
            if (!email) {
                return res.status(400).json({ message: "email is required" });
            }

            // 2️⃣ Must match Firebase decoded email
            if (email !== req.decoded_email) {
                return res.status(403).send({ message: "forbidden access" });
            }

            try {
                // 3️⃣ Fetch only current user payments
                const payments = await paymentsCollection
                    .find({ userEmail: email })
                    .sort({ date: -1 })
                    .toArray();

                res.json(payments);

            } catch (error) {
                res.status(500).json({ message: "Failed to fetch payments", error: error.message });
            }
        });






        // FTWgCKOuqsDWy9Af
        // ticket_bari_user
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Ticket Bari!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
