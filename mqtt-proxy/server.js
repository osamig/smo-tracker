/**
 * ============================================================
 * MQTT to WebSocket Proxy Server
 * ============================================================
 * Bridges the browser (WebSocket) with the MQTT broker (TCP).
 * 
 * Usage: npm start
 * The server runs on http://localhost:3001
 */

const mqtt = require('mqtt');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const http = require('http');

// ============================================================
// CONFIGURATION - Mosquitto Broker Settings
// ============================================================
const CONFIG = {
    // MQTT Broker (TCP connection)
    MQTT_BROKER: 'mqtt://139.6.19.20',
    MQTT_PORT: 1883,
    MQTT_USERNAME: 'lkleefisch',
    MQTT_PASSWORD: 'jr9csado9j9uytxhs2l7v4j3fezo1ttl',

    // Default topic to subscribe
    DEFAULT_TOPIC: 'bt-tracker/#',

    // WebSocket server port for browser clients
    WS_PORT: 3001
};

// ============================================================
// Express app for health check & CORS
// ============================================================
const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.json({
        status: 'running',
        mqtt_broker: CONFIG.MQTT_BROKER,
        connected_clients: wss ? wss.clients.size : 0,
        mqtt_connected: mqttClient ? mqttClient.connected : false
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// HTTP & WebSocket Server
// ============================================================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ============================================================
// MQTT Client
// ============================================================
let mqttClient = null;
let currentTopic = CONFIG.DEFAULT_TOPIC;

function connectMqtt(topic = CONFIG.DEFAULT_TOPIC) {
    if (mqttClient) {
        mqttClient.end();
    }

    currentTopic = topic;

    console.log(`🔌 Connecting to MQTT broker: ${CONFIG.MQTT_BROKER}`);
    console.log(`📡 Topic: ${topic}`);

    mqttClient = mqtt.connect(CONFIG.MQTT_BROKER, {
        port: CONFIG.MQTT_PORT,
        username: CONFIG.MQTT_USERNAME,
        password: CONFIG.MQTT_PASSWORD,
        clientId: 'smo_proxy_' + Math.random().toString(16).substr(2, 8),
        reconnectPeriod: 5000,
        connectTimeout: 10000
    });

    mqttClient.on('connect', () => {
        console.log('✅ Connected to MQTT broker');

        mqttClient.subscribe(topic, (err) => {
            if (err) {
                console.error('❌ Subscribe error:', err);
            } else {
                console.log(`📡 Subscribed to: ${topic}`);
                broadcastToClients({
                    type: 'status',
                    status: 'connected',
                    topic: topic
                });
            }
        });
    });

    mqttClient.on('message', (topic, message) => {
        try {
            const payload = message.toString();
            console.log(`📨 Message on ${topic}`);

            // Parse and forward to all WebSocket clients
            let data;
            try {
                data = JSON.parse(payload);
            } catch {
                // For raw payloads (like Raspberry Pi format), wrap in structure
                data = { raw: payload };
            }

            // For Raspberry Pi format (bt-tracker/raspberry/...), include topic in data
            // This allows the client to identify the format and extract sensor ID
            if (topic.includes('/raspberry/') && topic.includes('/distance')) {
                // Create Raspberry Pi format structure
                data = {
                    timestamp: new Date().toISOString(),
                    topic: topic,
                    type: 'raw',
                    payload: typeof data === 'object' && data.raw ? data.raw : payload
                };
            }

            broadcastToClients({
                type: 'message',
                topic: topic,
                data: data,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    mqttClient.on('error', (err) => {
        console.error('❌ MQTT Error:', err.message);
        broadcastToClients({
            type: 'error',
            error: err.message
        });
    });

    mqttClient.on('close', () => {
        console.log('🔌 MQTT connection closed');
        broadcastToClients({
            type: 'status',
            status: 'disconnected'
        });
    });

    mqttClient.on('reconnect', () => {
        console.log('🔄 Reconnecting to MQTT broker...');
    });
}

// ============================================================
// WebSocket Handlers
// ============================================================
function broadcastToClients(message) {
    const payload = JSON.stringify(message);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

wss.on('connection', (ws) => {
    console.log('🌐 New WebSocket client connected');
    console.log(`   Total clients: ${wss.clients.size}`);

    // Send current status
    ws.send(JSON.stringify({
        type: 'status',
        status: mqttClient && mqttClient.connected ? 'connected' : 'disconnected',
        topic: currentTopic,
        broker: CONFIG.MQTT_BROKER
    }));

    // Handle messages from browser
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log('📥 Command from client:', data);

            if (data.command === 'subscribe') {
                // Change topic subscription
                const newTopic = data.topic || CONFIG.DEFAULT_TOPIC;
                console.log(`🔄 Changing topic to: ${newTopic}`);

                if (mqttClient && mqttClient.connected) {
                    mqttClient.unsubscribe(currentTopic);
                    currentTopic = newTopic;
                    mqttClient.subscribe(newTopic, (err) => {
                        if (!err) {
                            console.log(`✅ Now subscribed to: ${newTopic}`);
                            broadcastToClients({
                                type: 'status',
                                status: 'subscribed',
                                topic: newTopic
                            });
                        }
                    });
                }
            } else if (data.command === 'reconnect') {
                connectMqtt(data.topic || currentTopic);
            }

        } catch (error) {
            console.error('Error handling client message:', error);
        }
    });

    ws.on('close', () => {
        console.log('🌐 WebSocket client disconnected');
        console.log(`   Remaining clients: ${wss.clients.size}`);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// ============================================================
// Start Server
// ============================================================
server.listen(CONFIG.WS_PORT, () => {
    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log('   MQTT to WebSocket Proxy Server');
    console.log('═══════════════════════════════════════════════');
    console.log(`   WebSocket URL: ws://localhost:${CONFIG.WS_PORT}`);
    console.log(`   Health Check:  http://localhost:${CONFIG.WS_PORT}/health`);
    console.log(`   MQTT Broker:   ${CONFIG.MQTT_BROKER}`);
    console.log(`   Default Topic: ${CONFIG.DEFAULT_TOPIC}`);
    console.log('═══════════════════════════════════════════════');
    console.log('');

    // Connect to MQTT broker
    connectMqtt();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    if (mqttClient) mqttClient.end();
    wss.close();
    server.close();
    process.exit(0);
});
