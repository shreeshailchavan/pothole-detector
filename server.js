require('dotenv').config();
const mqtt = require('mqtt');
const { Client } = require('pg');
const express = require('express');
const cors = require('cors');

// --- 1. SETUP EXPRESS API ---
const app = express();
app.use(cors()); // Allows external apps (like Flutter) to fetch data
app.use(express.json());

// --- 2. SETUP DATABASE ---
// Quick safety check to ensure the .env file loaded
if (!process.env.PGPASSWORD) {
    console.error("❌ ERROR: .env file is not loading properly! PGPASSWORD is missing.");
    process.exit(1);
}

const dbClient = new Client({
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
});

dbClient.connect()
    .then(() => console.log('✅ Connected directly to PostgreSQL database (via Pooler).'))
    .catch(err => console.error('Database connection error:', err.stack));

// --- 3. EXPRESS ROUTE: Fetch Historical Potholes ---
app.get('/api/potholes', async (req, res) => {
    try {
        console.log('📱 Flutter app requested historical data...');
        const result = await dbClient.query('SELECT * FROM potholes ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching potholes:', error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// Start the Express Server
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP API running at http://localhost:${PORT}`);
});

// --- 4. SETUP MQTT (HiveMQ) ---
const brokerUrl = 'mqtt://broker.hivemq.com:1883'; 
const mqttClient = mqtt.connect(brokerUrl);

mqttClient.on('connect', () => {
    console.log('✅ Successfully connected to Message Broker.');
    mqttClient.subscribe('city/potholes/reported');
});

mqttClient.on('message', async (topic, message) => {
    // Your custom debugging logs!
    console.log(message);
    console.log(topic);
    
    try {
        const potholeData = JSON.parse(message.toString());
        console.log('📩 Received MQTT message on topic:', topic);
        console.log('Message content:', potholeData);
        console.log('\n==================================');
        console.log('📍 NEW POTHOLE EVENT RECEIVED!');
        console.log(`Location: ${potholeData.latitude}, ${potholeData.longitude}`);
        console.log(`Severity: Level ${potholeData.severity}`); 
        console.log(`Device:   ${potholeData.device_id}`);
        console.log('==================================');

        console.log('⏳ Saving to database...');

        const insertQuery = `
            INSERT INTO potholes (latitude, longitude, severity, status, reporter_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id;
        `;
        
        const values = [
            potholeData.latitude,
            potholeData.longitude,
            potholeData.severity, 
            'reported', 
            potholeData.reported_id // <-- Using your dynamic ID variable!
        ];

        const result = await dbClient.query(insertQuery, values);
        
        console.log(`✅ Successfully saved! Database ID: ${result.rows[0].id}\n`);
        
    } catch (error) {
        console.error('❌ Failed to parse incoming message or save to DB:', error);
    }
});