const express = require('express')
const cors = require('cors')
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = process.env.PORT || 3000
// middlewares
app.use(express.json())
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fcejyck.mongodb.net/?appName=Cluster0`;
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
        const ticketsCollection = db.collection('tickets');
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
