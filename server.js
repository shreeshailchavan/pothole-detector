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

// --- REGION-BASED POTHOLES ---
app.get('/api/potholes/region/:region', async (req, res) => {
    try {
        const { region } = req.params;
        const regionBounds = {
            'hinjewadi': { minLat: 18.59, maxLat: 18.61, minLng: 73.75, maxLng: 73.77 },
            'baner': { minLat: 18.55, maxLat: 18.57, minLng: 73.79, maxLng: 73.82 },
            'viman-nagar': { minLat: 18.56, maxLat: 18.58, minLng: 73.90, maxLng: 73.93 },
            'aundh': { minLat: 18.57, maxLat: 18.59, minLng: 73.82, maxLng: 73.85 },
            'pimpri-chinchwad': { minLat: 18.62, maxLat: 18.65, minLng: 73.79, maxLng: 73.82 },
            'downtown': { minLat: 18.51, maxLat: 18.54, minLng: 73.84, maxLng: 73.87 },
        };

        const bounds = regionBounds[region.toLowerCase()];
        if (!bounds) {
            return res.status(400).json({ error: 'Region not found' });
        }

        const query = `
            SELECT * FROM potholes 
            WHERE latitude >= $1 AND latitude <= $2 
            AND longitude >= $3 AND longitude <= $4 
            ORDER BY created_at DESC
        `;
        
        const result = await dbClient.query(query, [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng]);
        console.log(`✅ Fetched ${result.rows.length} potholes from ${region}`);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching region potholes:', error);
        res.status(500).json({ error: 'Failed to fetch region data' });
    }
});

// --- GET ALL REGIONS ---
app.get('/api/regions', async (req, res) => {
    try {
        const regions = [
            { name: 'Hinjewadi', value: 'hinjewadi', color: '#FF6B6B' },
            { name: 'Baner', value: 'baner', color: '#4ECDC4' },
            { name: 'Viman Nagar', value: 'viman-nagar', color: '#45B7D1' },
            { name: 'Aundh', value: 'aundh', color: '#FFA07A' },
            { name: 'Pimpri-Chinchwad', value: 'pimpri-chinchwad', color: '#98D8C8' },
            { name: 'Downtown', value: 'downtown', color: '#F7DC6F' },
        ];
        res.json(regions);
    } catch (error) {
        console.error('Error fetching regions:', error);
        res.status(500).json({ error: 'Failed to fetch regions' });
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