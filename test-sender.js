const mqtt = require('mqtt');

// Connect to the broker
const client = mqtt.connect('mqtt://broker.hivemq.com:1883');

client.on('connect', () => {
    // 1. Create a perfectly formatted JavaScript object
    const potholeData = {
        latitude: 25.5500,
        longitude: 73.8900,
        severity: 3,
        reported_id: 1
    };

    // 2. Convert it safely to a JSON string
    const payload = JSON.stringify(potholeData);

    console.log("Sending payload:", payload);

    // 3. Publish it to the topic!
    client.publish('city/potholes/reported', payload, () => {
        console.log("✅ Fake hardware message sent successfully!");
        client.end(); // Close the connection so the script exits
    });
});