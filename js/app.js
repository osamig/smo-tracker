/**
 * ============================================================
 * Main Application Module
 * ============================================================
 * Orchestrates all modules and handles data flow.
 */

const App = (function () {
    let map = null;
    let currentDevices = [];
    let pendingSensors = []; // Sensors waiting for GPS input

    /**
     * Initialize the application
     */
    function init() {
        // Initialize Leaflet map
        map = L.map('map', {
            center: [52.52, 13.405], // Default to Berlin
            zoom: 17,
            zoomControl: true
        });

        // Move zoom control to bottom right
        map.zoomControl.setPosition('bottomright');

        // Initialize all modules
        MapLayers.init(map);
        TimeControls.init(handleTimestampChange);
        ZoneManager.init(map, handleZoneChange);
        UIController.init(map);

        // Setup file input handler
        document.getElementById('file-input').addEventListener('change', function (e) {
            if (e.target.files.length > 0) {
                loadFile(e.target.files[0]);
            }
        });

        // Setup sample data button
        document.getElementById('load-sample').addEventListener('click', loadSampleData);

        // Setup GPS Modal handlers
        initGpsModal();

        // Setup MQTT handlers
        initMqtt();

        // Setup Kalman filter toggle
        const kalmanToggle = document.getElementById('toggle-kalman');
        if (kalmanToggle) {
            kalmanToggle.addEventListener('change', function (e) {
                Lateration.setKalmanEnabled(e.target.checked);
                // Refresh current display if data is loaded
                const timestamps = DataHandler.getTimestamps();
                if (timestamps.length > 0) {
                    const currentTimestamp = TimeControls.getCurrentTimestamp();
                    if (currentTimestamp) {
                        handleTimestampChange(currentTimestamp);
                    }
                }
            });
        }

        // Setup GPS management
        initGpsManagement();

        console.log('[App] Multi-Sensor Tracking Visualization initialized');
    }

    /**
     * Initialize GPS management handlers
     */
    function initGpsManagement() {
        const manageBtn = document.getElementById('btn-manage-gps');
        const exportBtn = document.getElementById('btn-export-gps');
        const importBtn = document.getElementById('btn-import-gps');
        const importInput = document.getElementById('gps-import-input');

        // Update stored GPS count display
        updateStoredGpsCount();

        // Manage button - show all stored GPS coordinates
        manageBtn.addEventListener('click', () => {
            const storedGps = GpsStorage.loadAll();
            const sensorIds = Object.keys(storedGps);

            if (sensorIds.length === 0) {
                UIController.showError('No stored GPS coordinates available');
                return;
            }

            showGpsModal(sensorIds, false, true); // editing mode
        });

        // Export button - download GPS coordinates as JSON
        exportBtn.addEventListener('click', () => {
            const json = GpsStorage.exportAsJson();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'sensor_gps_coordinates.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            UIController.showSuccess('GPS coordinates exported');
        });

        // Import button - trigger file input
        importBtn.addEventListener('click', () => {
            importInput.click();
        });

        // Import file input handler
        importInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                const reader = new FileReader();

                reader.onload = (event) => {
                    const result = GpsStorage.importFromJson(event.target.result, true);
                    if (result.success) {
                        updateStoredGpsCount();
                        UIController.showSuccess(`${result.count} GPS coordinates imported`);
                    } else {
                        UIController.showError('Import failed: ' + result.error);
                    }
                };

                reader.readAsText(file);
                e.target.value = ''; // Reset input
            }
        });
    }

    /**
     * Update the stored GPS count display
     */
    function updateStoredGpsCount() {
        const countSpan = document.getElementById('stored-gps-count');
        if (countSpan) {
            const count = GpsStorage.getSensorIds().length;
            countSpan.textContent = count;
        }
    }

    /**
     * Initialize MQTT connection and event handlers
     */
    function initMqtt() {
        const connectBtn = document.getElementById('mqtt-connect');
        const proxyConnectBtn = document.getElementById('mqtt-proxy-connect');
        const disconnectBtn = document.getElementById('mqtt-disconnect');
        const brokerInput = document.getElementById('mqtt-broker');
        const topicInput = document.getElementById('mqtt-topic');
        const assignGpsBtn = document.getElementById('mqtt-assign-gps');

        // Connect button (direct MQTT via WebSocket)
        connectBtn.addEventListener('click', async () => {
            const broker = brokerInput.value.trim();
            const topic = topicInput.value.trim();

            if (!broker || !topic) {
                UIController.showError('Please enter broker URL and topic');
                return;
            }

            try {
                connectBtn.disabled = true;
                connectBtn.textContent = 'Connecting...';

                await MqttHandler.connect(broker, topic);

            } catch (error) {
                UIController.showError('Connection failed: ' + error.message);
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect';
            }
        });

        // VCR Proxy connect button (for rabbit.vcr broker via local Node.js proxy)
        proxyConnectBtn.addEventListener('click', async () => {
            try {
                proxyConnectBtn.disabled = true;
                proxyConnectBtn.textContent = 'Connecting...';
                connectBtn.disabled = true;

                // Connect via local proxy server
                await MqttHandler.connectViaProxy('ws://localhost:3001');

                UIController.showSuccess('Connected to VCR Broker via Proxy');

            } catch (error) {
                UIController.showError('Proxy connection failed: ' + error.message + '\n\nMake sure the proxy server is running (npm start in mqtt-proxy folder)');
                proxyConnectBtn.disabled = false;
                proxyConnectBtn.textContent = 'VCR Proxy';
                connectBtn.disabled = false;
            }
        });

        // Disconnect button
        disconnectBtn.addEventListener('click', () => {
            MqttHandler.disconnect();
        });

        // Assign GPS button (for pending sensors)
        assignGpsBtn.addEventListener('click', () => {
            const unassigned = MqttHandler.getUnassignedSensors();
            if (unassigned.length > 0) {
                showGpsModal(unassigned, true); // true = MQTT mode
            }
        });

        // Connection status callback
        MqttHandler.onConnectionChange((connected) => {
            updateMqttStatus(connected);

            if (connected) {
                connectBtn.disabled = true;
                proxyConnectBtn.disabled = true;
                proxyConnectBtn.textContent = 'Connected';
                connectBtn.textContent = 'Connected';
                disconnectBtn.disabled = false;
                brokerInput.disabled = true;
                topicInput.disabled = true;
            } else {
                connectBtn.disabled = false;
                proxyConnectBtn.disabled = false;
                proxyConnectBtn.textContent = 'VCR Proxy';
                connectBtn.textContent = 'Connect';
                disconnectBtn.disabled = true;
                brokerInput.disabled = false;
                topicInput.disabled = false;
            }
        });

        // New sensor discovered callback
        MqttHandler.onSensorDiscovered((sensorId, allUnassigned) => {
            console.log('[MQTT] New sensor needs GPS:', sensorId);
            showPendingSensorsNotification(allUnassigned.length);
        });

        // Incoming message callback (only called when sensor has GPS)
        MqttHandler.onMessage((entry) => {
            handleRealtimeMessage(entry);
        });
    }

    /**
     * Update MQTT connection status UI
     */
    function updateMqttStatus(connected) {
        const statusDot = document.querySelector('#mqtt-status .status-dot');
        const statusText = document.querySelector('#mqtt-status .status-text');

        if (connected) {
            statusDot.classList.remove('disconnected');
            statusDot.classList.add('connected');
            statusText.textContent = 'Connected to ' + MqttHandler.getTopic();
        } else {
            statusDot.classList.remove('connected');
            statusDot.classList.add('disconnected');
            statusText.textContent = 'Not connected';
        }
    }

    /**
     * Show notification for pending sensors
     */
    function showPendingSensorsNotification(count) {
        const pendingDiv = document.getElementById('mqtt-sensors-pending');
        const badge = pendingDiv.querySelector('.pending-badge');

        if (count > 0) {
            pendingDiv.style.display = 'flex';
            badge.textContent = count;
        } else {
            pendingDiv.style.display = 'none';
        }
    }

    // ============================================================
    // Real-time Reading Buffer for Multi-Sensor Lateration
    // ============================================================
    // Stores readings from multiple sensors within a time window
    // Key: mac_hashed, Value: array of { sensor_id, distance, rssi, sensor_lat, sensor_lng, timestamp }
    const realtimeReadingsBuffer = new Map();
    const REALTIME_TIME_WINDOW_MS = 15000; // 15 seconds aggregation window
    let realtimeUpdateTimer = null;

    /**
     * Handle real-time MQTT message
     * Buffers readings and aggregates from multiple sensors
     */
    function handleRealtimeMessage(entry) {
        console.log('[Data] Processing real-time entry:', entry);

        // Add sensor to map if not already there
        const sensors = DataHandler.getSensors();
        if (!sensors.has(entry.device_key)) {
            const sensorData = {
                id: entry.device_key,
                lat: entry.gps[0],
                lng: entry.gps[1]
            };
            sensors.set(entry.device_key, sensorData);
            MapLayers.renderSensors(sensors);
            UIController.updateSensorCount(sensors.size);

            // Fit map to include new sensor
            const bounds = MapLayers.getSensorBounds();
            if (bounds) {
                map.fitBounds(bounds.pad(0.2));
            }
        }

        // Buffer device readings from this message
        if (entry.devices && entry.devices.length > 0) {
            const now = Date.now();

            entry.devices.forEach(device => {
                const macHashed = device.mac_hashed;
                if (!macHashed) return;

                // Initialize buffer for this device if needed
                if (!realtimeReadingsBuffer.has(macHashed)) {
                    realtimeReadingsBuffer.set(macHashed, []);
                }

                // Add reading to buffer
                realtimeReadingsBuffer.get(macHashed).push({
                    sensor_id: entry.device_key,
                    distance: device.distance || device.distance_m || 0,
                    rssi: device.rssi || -100,
                    sensor_lat: entry.gps[0],
                    sensor_lng: entry.gps[1],
                    timestamp: now
                });
            });

            // Trigger position computation (debounced)
            schedulePositionComputation();
        }
    }

    /**
     * Schedule position computation (debounced to avoid too frequent updates)
     */
    function schedulePositionComputation() {
        // Clear any pending timer
        if (realtimeUpdateTimer) {
            clearTimeout(realtimeUpdateTimer);
        }

        // Schedule computation after a short delay (allows more readings to arrive)
        realtimeUpdateTimer = setTimeout(() => {
            computeRealtimePositions();
        }, 500); // 500ms debounce
    }

    /**
     * Compute positions from buffered readings
     * Uses time window aggregation like historical data
     */
    function computeRealtimePositions() {
        const now = Date.now();
        const cutoffTime = now - REALTIME_TIME_WINDOW_MS;
        const newDevices = [];

        // Process each device in the buffer
        realtimeReadingsBuffer.forEach((readings, macHashed) => {
            // Filter to readings within time window
            const recentReadings = readings.filter(r => r.timestamp >= cutoffTime);

            // Update buffer to only keep recent readings
            realtimeReadingsBuffer.set(macHashed, recentReadings);

            if (recentReadings.length === 0) {
                realtimeReadingsBuffer.delete(macHashed);
                return;
            }

            // Group readings by sensor (take latest per sensor)
            const bySensor = new Map();
            recentReadings.forEach(reading => {
                const existing = bySensor.get(reading.sensor_id);
                if (!existing || reading.timestamp > existing.timestamp) {
                    bySensor.set(reading.sensor_id, reading);
                }
            });

            // Convert to observations array for lateration
            const observations = Array.from(bySensor.values()).map(r => ({
                sensor_id: r.sensor_id,
                distance: r.distance,
                rssi: r.rssi,
                sensor_lat: r.sensor_lat,
                sensor_lng: r.sensor_lng
            }));

            console.log(`[Lateration] Device ${macHashed.substring(0, 8)}... has ${observations.length} sensor(s) in time window`);

            // Compute position using lateration
            const result = Lateration.trilaterate(observations);
            if (result && !isNaN(result.lat) && !isNaN(result.lng)) {
                newDevices.push({
                    macHashed: macHashed,
                    ...result,
                    sensorCount: observations.length
                });
            }
        });

        // Update map with computed positions
        if (newDevices.length > 0) {
            console.log(`[OK] Computed ${newDevices.length} realtime device positions`);
            currentDevices = newDevices;
            MapLayers.renderDevices(currentDevices);
            MapLayers.updateHeatmap(map, currentDevices);
            ZoneManager.updateDeviceCounts(currentDevices);
        }
    }

    /**
     * Initialize GPS Modal event handlers
     */
    function initGpsModal() {
        const modal = document.getElementById('gps-modal');
        const saveBtn = document.getElementById('save-gps-coords');
        const cancelBtn = document.getElementById('cancel-gps');

        // Save GPS coordinates
        saveBtn.addEventListener('click', saveGpsCoordinates);

        // Cancel and close modal
        cancelBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            pendingSensors = [];
        });
    }

    /**
     * Show GPS input modal
     * @param {array} sensors - Array of sensor IDs requiring GPS
     * @param {boolean} isMqttMode - If true, assign GPS via MqttHandler
     * @param {boolean} isEditingMode - If true, editing existing stored coordinates
     */
    let gpsModalIsMqttMode = false;
    let gpsModalIsEditingMode = false;

    function showGpsModal(sensors, isMqttMode = false, isEditingMode = false) {
        pendingSensors = sensors;
        gpsModalIsMqttMode = isMqttMode;
        gpsModalIsEditingMode = isEditingMode;

        const modal = document.getElementById('gps-modal');
        const container = document.getElementById('sensor-gps-inputs');
        const modalTitle = modal.querySelector('.modal-header h3');

        // Update modal title based on mode
        if (isEditingMode) {
            modalTitle.textContent = 'Edit GPS Coordinates';
        } else {
            modalTitle.textContent = 'Enter Sensor GPS Coordinates';
        }

        // Clear previous inputs
        container.innerHTML = '';

        // Load stored coordinates
        const storedGps = GpsStorage.loadAll();

        // Create input fields for each sensor
        sensors.forEach((sensorId, index) => {
            const stored = storedGps[sensorId];
            const latValue = stored ? stored.lat : '';
            const lngValue = stored ? stored.lng : '';

            const item = document.createElement('div');
            item.className = 'sensor-gps-item';
            item.innerHTML = `
                <div class="sensor-gps-header">
                    <div class="sensor-icon-small"></div>
                    <span>${sensorId}</span>
                </div>
                <div class="sensor-gps-inputs">
                    <div class="input-group">
                        <label>Latitude</label>
                        <input type="number" 
                               step="0.000001" 
                               placeholder="e.g. 50.937500"
                               value="${latValue}"
                               data-sensor="${sensorId}"
                               data-coord="lat">
                    </div>
                    <div class="input-group">
                        <label>Longitude</label>
                        <input type="number" 
                               step="0.000001" 
                               placeholder="e.g. 6.960300"
                               value="${lngValue}"
                               data-sensor="${sensorId}"
                               data-coord="lng">
                    </div>
                </div>
            `;
            container.appendChild(item);
        });

        // Show modal
        modal.style.display = 'flex';
    }

    /**
     * Save GPS coordinates from modal inputs
     */
    function saveGpsCoordinates() {
        const gpsMap = {};
        let valid = true;

        pendingSensors.forEach(sensorId => {
            const latInput = document.querySelector(`input[data-sensor="${sensorId}"][data-coord="lat"]`);
            const lngInput = document.querySelector(`input[data-sensor="${sensorId}"][data-coord="lng"]`);

            if (latInput && lngInput) {
                const lat = parseFloat(latInput.value);
                const lng = parseFloat(lngInput.value);

                if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    gpsMap[sensorId] = { lat, lng };
                } else {
                    valid = false;
                    latInput.style.borderColor = 'var(--danger)';
                    lngInput.style.borderColor = 'var(--danger)';
                }
            }
        });

        if (!valid) {
            UIController.showError('Please enter valid GPS coordinates');
            return;
        }

        // Always save to persistent storage
        GpsStorage.setMultiple(gpsMap);
        updateStoredGpsCount();

        // Hide modal
        document.getElementById('gps-modal').style.display = 'none';

        if (gpsModalIsEditingMode) {
            // Editing mode: just save and update current sensors on map if any
            const sensors = DataHandler.getSensors();
            for (const [sensorId, coords] of Object.entries(gpsMap)) {
                if (sensors.has(sensorId)) {
                    const sensorData = sensors.get(sensorId);
                    sensorData.lat = coords.lat;
                    sensorData.lng = coords.lng;
                }
            }
            // Re-render sensors if there are any
            if (sensors.size > 0) {
                MapLayers.renderSensors(sensors);
            }
            UIController.showSuccess(`GPS saved for ${Object.keys(gpsMap).length} sensors`);

        } else if (gpsModalIsMqttMode) {
            // MQTT Mode: Assign GPS via MqttHandler
            let processedCount = 0;
            for (const [sensorId, coords] of Object.entries(gpsMap)) {
                processedCount += MqttHandler.assignSensorGps(sensorId, coords.lat, coords.lng);
            }

            // Hide pending notification if all sensors assigned
            const remaining = MqttHandler.getUnassignedSensors().length;
            showPendingSensorsNotification(remaining);

            UIController.showSuccess(`GPS assigned for ${Object.keys(gpsMap).length} sensors`);
            console.log('[GPS] Assigned for MQTT sensors, processed queued messages:', processedCount);

        } else {
            // File Mode: Set coordinates via DataHandler
            DataHandler.setSensorGpsCoordinates(gpsMap);
            const result = DataHandler.completePendingData();

            if (result.success) {
                console.log('[GPS] Coordinates saved and data processed:', result);
                onDataLoaded();
                UIController.showSuccess(`Data loaded: ${result.sensors} sensors, ${result.timestamps} timestamps`);
            } else {
                UIController.showError(result.error || 'Error processing data');
            }
        }

        pendingSensors = [];
        gpsModalIsMqttMode = false;
        gpsModalIsEditingMode = false;
    }

    /**
     * Load data from file
     * @param {File} file - File object
     */
    function loadFile(file) {
        UIController.showLoading();

        DataHandler.loadFromFile(file)
            .then(result => {
                console.log('[Data] Loaded:', result);
                UIController.hideLoading();

                // Check if new format needs GPS input
                if (result.needsGps) {
                    console.log('[GPS] New format detected - GPS input required for sensors:', result.sensors);
                    showGpsModal(result.sensors);
                } else {
                    // Old format with GPS - proceed normally
                    onDataLoaded();
                }
            })
            .catch(error => {
                UIController.hideLoading();
                UIController.showError(error.message);
            });
    }

    /**
     * Load sample data from the same directory
     */
    function loadSampleData() {
        UIController.showLoading();

        DataHandler.loadFromUrl('large_sensor_data.json')
            .then(result => {
                console.log('[Data] Sample data loaded:', result);
                onDataLoaded();
                UIController.hideLoading();
            })
            .catch(error => {
                UIController.hideLoading();
                UIController.showError('Failed to load sample data: ' + error.message);
            });
    }

    /**
     * Handle data loaded event
     */
    function onDataLoaded() {
        // Clear previous data
        MapLayers.clearAll();
        Lateration.clearCache();

        // Render sensors
        const sensors = DataHandler.getSensors();
        MapLayers.renderSensors(sensors);
        UIController.updateSensorCount(sensors.size);

        // Setup time controls
        const timestamps = DataHandler.getTimestamps();
        TimeControls.setTimestamps(timestamps);

        // Fit map to sensor bounds
        const bounds = MapLayers.getSensorBounds();
        if (bounds) {
            map.fitBounds(bounds.pad(0.2));
        }

        // Initial render for first timestamp
        if (timestamps.length > 0) {
            handleTimestampChange(timestamps[0]);
        }

        UIController.showSuccess('Data loaded successfully');
    }

    /**
     * Handle timestamp change from time controls
     * @param {string} timestamp - Current timestamp
     */
    function handleTimestampChange(timestamp) {
        if (!timestamp) return;

        // Compute device positions
        currentDevices = Lateration.computeAllPositions(timestamp);

        // Render devices
        MapLayers.renderDevices(currentDevices);

        // Update heatmap
        MapLayers.updateHeatmap(map, currentDevices);

        // Update debug circles if debug mode is on
        if (document.getElementById('layer-debug').checked) {
            MapLayers.renderDebugCircles(currentDevices);
        }

        // Update zone device counts
        ZoneManager.updateDeviceCounts(currentDevices);
    }

    /**
     * Handle zone change event
     */
    function handleZoneChange() {
        // Recalculate device counts for zones
        ZoneManager.updateDeviceCounts(currentDevices);
    }

    /**
     * Get current map instance
     * @returns {L.Map}
     */
    function getMap() {
        return map;
    }

    /**
     * Get currently displayed devices
     * @returns {array}
     */
    function getCurrentDevices() {
        return currentDevices;
    }

    // Public API
    return {
        init,
        loadFile,
        loadSampleData,
        getMap,
        getCurrentDevices,
        showGpsModal
    };
})();

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', App.init);
