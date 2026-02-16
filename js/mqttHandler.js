/**
 * ============================================================
 * MQTT Handler Module
 * ============================================================
 * Handles WebSocket MQTT connections for real-time sensor data.
 * Supports two modes:
 * 1. Direct MQTT via Paho (for WebSocket-enabled brokers)
 * 2. Proxy mode via local Node.js server (for TCP-only brokers like VCR)
 */

const MqttHandler = (function () {
    // Connection state
    let client = null;           // Paho client for direct MQTT
    let proxySocket = null;      // WebSocket for proxy mode
    let isConnectedState = false;
    let currentTopic = '';
    let connectionMode = 'direct'; // 'direct' or 'proxy'

    // Sensor tracking
    let knownSensors = new Map();      // sensorId -> { lat, lng } or null
    let unassignedSensors = new Set(); // Sensors without GPS
    let dataQueue = [];                 // Queue messages until GPS assigned

    // Callbacks
    let onMessageCallback = null;
    let onSensorDiscoveredCallback = null;
    let onConnectionChangeCallback = null;

    // Default proxy URL
    const DEFAULT_PROXY_URL = 'ws://localhost:3001';

    /**
     * Connect via local proxy server (for VCR broker)
     * @param {string} proxyUrl - WebSocket URL to proxy (default: ws://localhost:3001)
     * @param {string} topic - Optional topic to request from proxy
     * @returns {Promise}
     */
    function connectViaProxy(proxyUrl = DEFAULT_PROXY_URL, topic = '') {
        return new Promise((resolve, reject) => {
            if (isConnectedState) {
                disconnect();
            }

            connectionMode = 'proxy';
            console.log(`ðŸ”Œ Connecting to MQTT proxy: ${proxyUrl}`);

            try {
                proxySocket = new WebSocket(proxyUrl);

                proxySocket.onopen = () => {
                    console.log('[OK] Connected to MQTT proxy server');
                    isConnectedState = true;

                    // Request specific topic if provided
                    if (topic) {
                        proxySocket.send(JSON.stringify({
                            command: 'subscribe',
                            topic: topic
                        }));
                        currentTopic = topic;
                    }

                    if (onConnectionChangeCallback) {
                        onConnectionChangeCallback(true);
                    }
                    resolve({ success: true, mode: 'proxy' });
                };

                proxySocket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);

                        if (message.type === 'status') {
                            console.log(`ðŸ“¡ Proxy status: ${message.status}`, message.topic || '');
                            if (message.topic) {
                                currentTopic = message.topic;
                            }
                        } else if (message.type === 'message') {
                            // Process the MQTT message from proxy
                            onProxyMessageReceived(message);
                        } else if (message.type === 'error') {
                            console.error('âŒ Proxy error:', message.error);
                        }
                    } catch (error) {
                        console.error('Error parsing proxy message:', error);
                    }
                };

                proxySocket.onclose = () => {
                    console.log('ðŸ”Œ Proxy connection closed');
                    isConnectedState = false;
                    proxySocket = null;
                    if (onConnectionChangeCallback) {
                        onConnectionChangeCallback(false);
                    }
                };

                proxySocket.onerror = (error) => {
                    console.error('âŒ Proxy WebSocket error:', error);
                    isConnectedState = false;
                    if (onConnectionChangeCallback) {
                        onConnectionChangeCallback(false);
                    }
                    reject(new Error('Failed to connect to proxy server. Is it running?'));
                };

            } catch (error) {
                console.error('Proxy connection error:', error);
                reject(error);
            }
        });
    }

    /**
     * Handle message received from proxy server
     */
    function onProxyMessageReceived(message) {
        try {
            const data = message.data;
            const topic = message.topic;

            console.log('ðŸ“¨ Proxy message received:', topic, data);

            // Check if this is Raspberry Pi format (raw type with payload)
            if (data && data.type === 'raw' && data.payload && data.topic) {
                handleRaspberryMessage(data);
                return;
            }

            // Extract sensor ID from topic or data
            // Topic formats supported:
            // - bt-tracker/<sensor-id>/... (Mosquitto broker)
            // - deviceValue/bttracker/<sensor-id>/scan (VCR broker)
            let sensorId = data.deviceKey || data.device_key;
            if (!sensorId && topic) {
                const parts = topic.split('/');
                // Try to find sensor ID from topic structure
                if (parts[0] === 'bt-tracker' && parts.length >= 2) {
                    sensorId = parts[1]; // bt-tracker/<sensor-id>
                } else if (parts.length >= 3) {
                    sensorId = parts[2]; // deviceValue/bttracker/<sensor-id>/scan
                }
            }

            if (!sensorId) {
                console.warn('Message missing sensor ID');
                return;
            }

            // Check if this is a new sensor
            if (!knownSensors.has(sensorId)) {
                console.log(`ðŸ†• New sensor discovered: ${sensorId}`);
                knownSensors.set(sensorId, null);
                unassignedSensors.add(sensorId);

                if (onSensorDiscoveredCallback) {
                    onSensorDiscoveredCallback(sensorId, Array.from(unassignedSensors));
                }
            }

            // Parse the message into internal format
            const parsedEntry = parseMessage(data, sensorId);

            // If sensor has GPS, process immediately
            const sensorGps = knownSensors.get(sensorId);
            if (sensorGps) {
                parsedEntry.gps = [sensorGps.lat, sensorGps.lng];

                if (onMessageCallback) {
                    onMessageCallback(parsedEntry);
                }
            } else {
                // Queue for later processing
                dataQueue.push({ sensorId, entry: parsedEntry });
            }

        } catch (error) {
            console.error('Error processing proxy message:', error);
        }
    }

    /**
     * Handle Raspberry Pi format message
     * Format: { timestamp, topic, type: "raw", payload: "{\"mac\":\"...\", \"time\":..., \"distance\":...}" }
     */
    function handleRaspberryMessage(data) {
        try {
            // Extract sensor ID from topic path
            // Format: bt-tracker/raspberry/<sensor-id>/<sensor-id>/messages/events/distance
            const topic = data.topic || '';
            const topicParts = topic.split('/');
            let sensorId = null;

            // Find sensor ID in topic (look for raspberry path)
            if (topicParts.includes('raspberry') && topicParts.length >= 3) {
                const raspberryIndex = topicParts.indexOf('raspberry');
                if (raspberryIndex + 1 < topicParts.length) {
                    sensorId = topicParts[raspberryIndex + 1];
                }
            }

            if (!sensorId) {
                console.warn('ðŸ“ Could not extract sensor ID from topic:', topic);
                return;
            }

            // Parse payload (JSON string, may have null character at end)
            let payloadData;
            try {
                const payloadStr = (data.payload || '').replace(/\u0000/g, '').trim();
                payloadData = JSON.parse(payloadStr);
            } catch (e) {
                console.warn('ðŸ“ Failed to parse payload:', data.payload, e);
                return;
            }

            // Extract device data from payload
            const mac = payloadData.mac;
            const distance = payloadData.distance;
            const time = payloadData.time;

            if (!mac || typeof distance !== 'number') {
                console.warn('ðŸ“ Invalid payload data:', payloadData);
                return;
            }

            console.log(`ðŸ“ Raspberry Pi: Device ${mac.substring(0, 8)}... at ${distance.toFixed(2)}m from ${sensorId}`);

            // Check if this is a new sensor
            if (!knownSensors.has(sensorId)) {
                console.log(`ðŸ†• New Raspberry Pi sensor discovered: ${sensorId}`);
                knownSensors.set(sensorId, null);
                unassignedSensors.add(sensorId);

                if (onSensorDiscoveredCallback) {
                    onSensorDiscoveredCallback(sensorId, Array.from(unassignedSensors));
                }
            }

            // Create device reading
            const deviceReading = {
                mac_hashed: mac,
                mac: mac,
                distance: distance,
                rssi: payloadData.rssi || -70
            };

            // Use entry timestamp or convert Unix time
            let timestamp = data.timestamp;
            if (!timestamp && time) {
                timestamp = new Date(time * 1000).toISOString();
            }

            // Create parsed entry
            const parsedEntry = {
                device_key: sensorId,
                timestamp: timestamp || new Date().toISOString(),
                devices: [deviceReading],
                gps: null
            };

            // If sensor has GPS, process immediately
            const sensorGps = knownSensors.get(sensorId);
            if (sensorGps) {
                parsedEntry.gps = [sensorGps.lat, sensorGps.lng];

                if (onMessageCallback) {
                    onMessageCallback(parsedEntry);
                }
            } else {
                // Queue for later processing
                dataQueue.push({ sensorId, entry: parsedEntry });
            }

        } catch (error) {
            console.error('ðŸ“ Error processing Raspberry Pi message:', error);
        }
    }

    /**
     * Connect to MQTT broker via WebSocket (direct mode)
     * @param {string} brokerUrl - WebSocket URL (ws:// or wss://)
     * @param {string} topic - Topic to subscribe to
     * @param {object} options - { username, password, clientId }
     * @returns {Promise}
     */
    function connect(brokerUrl, topic, options = {}) {
        return new Promise((resolve, reject) => {
            if (isConnectedState) {
                disconnect();
            }

            connectionMode = 'direct';

            try {
                // Parse broker URL
                const url = new URL(brokerUrl);
                const host = url.hostname;
                const port = parseInt(url.port) || (url.protocol === 'wss:' ? 443 : 80);
                const path = url.pathname || '/mqtt';
                const useSSL = url.protocol === 'wss:';

                // Generate client ID
                const clientId = options.clientId || 'smo_web_' + Math.random().toString(16).substr(2, 8);

                console.log(`ðŸ”Œ Connecting to MQTT broker: ${host}:${port}${path}`);

                // Create Paho client
                client = new Paho.MQTT.Client(host, port, path, clientId);

                // Set callbacks
                client.onConnectionLost = onConnectionLost;
                client.onMessageArrived = onMessageArrived;

                // Connect options
                const connectOptions = {
                    onSuccess: () => {
                        isConnectedState = true;
                        currentTopic = topic;

                        // Subscribe to topic
                        client.subscribe(topic, {
                            onSuccess: () => {
                                console.log(`[OK] Connected and subscribed to: ${topic}`);
                                if (onConnectionChangeCallback) {
                                    onConnectionChangeCallback(true);
                                }
                                resolve({ success: true });
                            },
                            onFailure: (err) => {
                                console.error('Subscribe failed:', err);
                                reject(new Error('Failed to subscribe to topic'));
                            }
                        });
                    },
                    onFailure: (err) => {
                        console.error('Connection failed:', err);
                        isConnectedState = false;
                        if (onConnectionChangeCallback) {
                            onConnectionChangeCallback(false);
                        }
                        reject(new Error(err.errorMessage || 'Connection failed'));
                    },
                    useSSL: useSSL,
                    timeout: 10
                };

                // Add credentials if provided
                if (options.username) {
                    connectOptions.userName = options.username;
                }
                if (options.password) {
                    connectOptions.password = options.password;
                }

                client.connect(connectOptions);

            } catch (error) {
                console.error('MQTT setup error:', error);
                reject(error);
            }
        });
    }

    /**
     * Disconnect from broker or proxy
     */
    function disconnect() {
        // Disconnect from direct MQTT
        if (client && connectionMode === 'direct') {
            try {
                client.disconnect();
            } catch (e) {
                console.warn('Disconnect error:', e);
            }
            client = null;
        }

        // Disconnect from proxy
        if (proxySocket && connectionMode === 'proxy') {
            try {
                proxySocket.close();
            } catch (e) {
                console.warn('Proxy disconnect error:', e);
            }
            proxySocket = null;
        }

        isConnectedState = false;
        console.log('ðŸ”Œ Disconnected from MQTT');

        if (onConnectionChangeCallback) {
            onConnectionChangeCallback(false);
        }
    }

    /**
     * Handle connection lost
     */
    function onConnectionLost(responseObject) {
        isConnectedState = false;
        console.warn('âš ï¸ MQTT connection lost:', responseObject.errorMessage);

        if (onConnectionChangeCallback) {
            onConnectionChangeCallback(false);
        }
    }

    /**
     * Handle incoming message (direct MQTT)
     */
    function onMessageArrived(message) {
        try {
            const payload = message.payloadString;
            const topic = message.destinationName || '';
            const data = JSON.parse(payload);

            console.log('ðŸ“¨ MQTT message received:', topic, data);

            // Check if this is Raspberry Pi format (raw type with payload)
            if (data && data.type === 'raw' && data.payload && data.topic) {
                handleRaspberryMessage(data);
                return;
            }

            // Extract sensor ID from data or topic
            let sensorId = data.deviceKey || data.device_key;

            // Try to extract from topic if not in data
            if (!sensorId && topic) {
                const parts = topic.split('/');
                // Check for Raspberry Pi topic format
                if (parts.includes('raspberry') && parts.length >= 3) {
                    const raspberryIndex = parts.indexOf('raspberry');
                    if (raspberryIndex + 1 < parts.length) {
                        sensorId = parts[raspberryIndex + 1];
                    }
                } else if (parts[0] === 'bt-tracker' && parts.length >= 2) {
                    sensorId = parts[1];
                }
            }

            if (!sensorId) {
                console.warn('Message missing sensor ID');
                return;
            }

            // Check if this is a new sensor
            if (!knownSensors.has(sensorId)) {
                console.log(`ðŸ†• New sensor discovered: ${sensorId}`);
                knownSensors.set(sensorId, null);
                unassignedSensors.add(sensorId);

                // Notify about new sensor
                if (onSensorDiscoveredCallback) {
                    onSensorDiscoveredCallback(sensorId, Array.from(unassignedSensors));
                }
            }

            // Parse the message into internal format
            const parsedEntry = parseMessage(data, sensorId);

            // If sensor has GPS, process immediately
            const sensorGps = knownSensors.get(sensorId);
            if (sensorGps) {
                parsedEntry.gps = [sensorGps.lat, sensorGps.lng];

                if (onMessageCallback) {
                    onMessageCallback(parsedEntry);
                }
            } else {
                // Queue for later processing
                dataQueue.push({ sensorId, entry: parsedEntry });
            }

        } catch (error) {
            console.error('Error parsing MQTT message:', error);
        }
    }

    /**
     * Parse MQTT message to internal format
     * Supports:
     * - VCR SIMPlexMQ bttracker format (single device per message)
     * - Original SMO format (array of devices per message)
     */
    function parseMessage(data, overrideSensorId = null) {
        const deviceKey = overrideSensorId || data.deviceKey || data.device_key;
        const timestamp = data.timestamp || data.time || new Date().toISOString();
        const value = data.value || data;

        let validDevices = [];

        // Check for VCR bttracker format (single device in value)
        if (value && value.mac && typeof value.distance === 'number') {
            // VCR SIMPlexMQ bttracker distance format
            // { "value": { "mac": "hashed_mac", "distance": 2.659, "deviceName": "..." } }
            // Note: MACs are now received already hashed from the broker
            validDevices.push({
                mac_hashed: value.mac,
                mac: value.mac,
                deviceName: value.deviceName || null,
                rssi: typeof value.rssi === 'number' ? value.rssi : -70,
                distance: value.distance
            });
            console.log(`ðŸ“¡ VCR bttracker: Device ${value.mac.substring(0, 8)}... at ${value.distance.toFixed(2)}m`);
        }
        // Check for original format with devices array
        else if (value.devices && Array.isArray(value.devices)) {
            // Note: MACs are now received already hashed from the broker
            validDevices = value.devices
                .filter(d => d && (d.mac_hashed || d.mac))
                .map(d => ({
                    mac_hashed: d.mac_hashed || d.mac,
                    mac: d.mac || null,
                    rssi: typeof d.rssi === 'number' ? d.rssi : -100,
                    distance: d.distance_m || d.distance || 0
                }));
        }

        return {
            device_key: deviceKey,
            timestamp: timestamp,
            devices: validDevices,
            gps: null  // Will be assigned later
        };
    }

    // Note: hashMac function removed - MACs are now received pre-hashed from broker

    /**
     * Assign GPS coordinates to a sensor
     * @param {string} sensorId - Sensor identifier
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     */
    function assignSensorGps(sensorId, lat, lng) {
        knownSensors.set(sensorId, { lat, lng });
        unassignedSensors.delete(sensorId);

        console.log(`ðŸ“ GPS assigned to ${sensorId}: ${lat}, ${lng}`);

        // Process queued messages for this sensor
        const pendingMessages = dataQueue.filter(q => q.sensorId === sensorId);
        dataQueue = dataQueue.filter(q => q.sensorId !== sensorId);

        pendingMessages.forEach(({ entry }) => {
            entry.gps = [lat, lng];
            if (onMessageCallback) {
                onMessageCallback(entry);
            }
        });

        return pendingMessages.length;
    }

    /**
     * Check connection status
     * @returns {boolean}
     */
    function isConnected() {
        return isConnectedState;
    }

    /**
     * Get list of sensors without GPS
     * @returns {array}
     */
    function getUnassignedSensors() {
        return Array.from(unassignedSensors);
    }

    /**
     * Get all known sensors
     * @returns {Map}
     */
    function getKnownSensors() {
        return knownSensors;
    }

    /**
     * Set message callback
     * @param {function} callback - Called with parsed entry
     */
    function onMessage(callback) {
        onMessageCallback = callback;
    }

    /**
     * Set sensor discovery callback
     * @param {function} callback - Called with (sensorId, allUnassigned)
     */
    function onSensorDiscovered(callback) {
        onSensorDiscoveredCallback = callback;
    }

    /**
     * Set connection change callback
     * @param {function} callback - Called with (isConnected)
     */
    function onConnectionChange(callback) {
        onConnectionChangeCallback = callback;
    }

    /**
     * Clear all sensor data
     */
    function clearSensors() {
        knownSensors.clear();
        unassignedSensors.clear();
        dataQueue = [];
    }

    /**
     * Get current topic
     * @returns {string}
     */
    function getTopic() {
        return currentTopic;
    }

    /**
     * Get connection mode
     * @returns {string} 'direct' or 'proxy'
     */
    function getConnectionMode() {
        return connectionMode;
    }

    // Public API
    return {
        connect,
        connectViaProxy,
        disconnect,
        isConnected,
        getConnectionMode,
        getUnassignedSensors,
        getKnownSensors,
        assignSensorGps,
        onMessage,
        onSensorDiscovered,
        onConnectionChange,
        clearSensors,
        getTopic
    };
})();

