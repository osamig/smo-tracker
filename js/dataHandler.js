/**
 * ============================================================
 * Data Handler Module
 * ============================================================
 * Handles JSON file upload, validation, and data normalization.
 * Converts raw sensor data to internal GeoJSON format for processing.
 */

const DataHandler = (function () {
    // ============================================================
    // Configuration: Time Window for Sensor Synchronization
    // ============================================================
    // Problem: Sensors report asynchronously - Device may be seen by 
    // Sensor A at 12:00:01 and Sensor B at 12:00:10.
    // Solution: All readings within TIME_WINDOW_MS are considered "simultaneous"
    let TIME_WINDOW_MS = 15000; // Default: 15 seconds

    // Internal state
    let rawData = [];
    let normalizedData = null;
    let sensorMap = new Map();
    let timestamps = [];
    let dataByTimestamp = new Map();
    let aggregatedTimestamps = []; // Aggregated time buckets

    // Pending data waiting for GPS coordinates
    let pendingNewFormatData = null;
    let sensorGpsCoordinates = new Map(); // User-provided GPS coordinates

    /**
     * Detect data format type
     * @param {object} data - Parsed JSON data
     * @returns {string} 'old' for format with GPS, 'new' for format without GPS, 'raspberry' for Raspberry Pi format
     */
    function detectFormat(data) {
        if (Array.isArray(data)) {
            // Old format: array of entries with gps field
            if (data.length > 0 && data[0].gps) {
                return 'old';
            }
            // Raspberry Pi format: array with topic, type, payload
            if (data.length > 0 && data[0].topic && data[0].type === 'raw' && data[0].payload) {
                return 'raspberry';
            }
            // New format: array of entries with deviceKey (no GPS)
            if (data.length > 0 && (data[0].deviceKey || data[0].value)) {
                return 'new';
            }
        }
        // Single object - Raspberry Pi format
        if (data && data.topic && data.type === 'raw' && data.payload) {
            return 'raspberry';
        }
        // Single object - new format
        if (data && (data.deviceKey || data.value)) {
            return 'new';
        }
        return 'old';
    }

    /**
     * Parse and validate uploaded JSON data
     * Supports old format (with GPS), new format (without GPS), and Raspberry Pi format
     * @param {string|object} jsonData - Raw JSON string or parsed object
     * @returns {object} Validation result { valid: boolean, error?: string, data?: array, needsGps?: boolean, sensors?: array }
     */
    function parseAndValidate(jsonData) {
        try {
            // Parse if string - handle NDJSON (newline-delimited JSON)
            let data;
            if (typeof jsonData === 'string') {
                // Try parsing as regular JSON first
                try {
                    data = JSON.parse(jsonData);
                } catch (e) {
                    // Try parsing as NDJSON (newline-delimited JSON)
                    const lines = jsonData.split('\n').filter(line => line.trim());
                    if (lines.length > 1) {
                        data = lines.map(line => JSON.parse(line));
                    } else {
                        throw e; // Re-throw if not NDJSON
                    }
                }
            } else {
                data = jsonData;
            }

            // Detect format
            const format = detectFormat(data);
            console.log(`[Data] Detected format: ${format}`);

            if (format === 'raspberry') {
                return parseRaspberryFormat(data);
            } else if (format === 'new') {
                return parseNewFormat(data);
            } else {
                return parseOldFormat(data);
            }

        } catch (e) {
            return { valid: false, error: 'Invalid JSON format: ' + e.message };
        }
    }

    /**
     * Parse old format (with GPS coordinates)
     */
    function parseOldFormat(data) {
        // Must be an array
        if (!Array.isArray(data)) {
            return { valid: false, error: 'Data must be an array of sensor readings' };
        }

        if (data.length === 0) {
            return { valid: false, error: 'Data array is empty' };
        }

        // Validate each sensor entry
        const validatedData = [];
        const errors = [];

        for (let i = 0; i < data.length; i++) {
            const entry = data[i];
            const result = validateOldFormatEntry(entry, i);

            if (result.valid) {
                validatedData.push(result.data);
            } else {
                errors.push(`Entry ${i}: ${result.error}`);
            }
        }

        if (validatedData.length === 0) {
            return { valid: false, error: 'No valid sensor entries found. ' + errors.join('; ') };
        }

        // Log warnings for skipped entries
        if (errors.length > 0) {
            console.warn('Some entries were skipped:', errors);
        }

        return { valid: true, data: validatedData, needsGps: false };
    }

    /**
     * Parse new format (without GPS coordinates)
     * Returns sensors list so user can input GPS coordinates
     */
    function parseNewFormat(data) {
        // Convert single object to array
        let entries = Array.isArray(data) ? data : [data];

        if (entries.length === 0) {
            return { valid: false, error: 'Data array is empty' };
        }

        // Extract unique sensors
        const sensorsSet = new Set();
        const parsedEntries = [];

        for (const entry of entries) {
            const deviceKey = entry.deviceKey || entry.device_key;
            const timestamp = entry.timestamp;
            const value = entry.value || entry;
            const devices = value.devices || [];

            if (deviceKey) {
                sensorsSet.add(deviceKey);
            }

            // Parse devices from new format
            const validDevices = devices
                .filter(d => d && d.mac_hashed)
                .map(d => ({
                    mac_hashed: d.mac_hashed,
                    mac: d.mac || null,
                    rssi: typeof d.rssi === 'number' ? d.rssi : -100,
                    distance: d.distance_m || d.distance || 0  // Support both distance_m and distance
                }));

            parsedEntries.push({
                device_key: deviceKey,
                timestamp: timestamp || new Date().toISOString(),
                devices: validDevices,
                gps: null  // Will be filled in by user
            });
        }

        // Store pending data
        pendingNewFormatData = parsedEntries;

        const sensors = Array.from(sensorsSet);
        console.log(`ðŸ“¡ Found ${sensors.length} sensors requiring GPS coordinates:`, sensors);

        return {
            valid: true,
            needsGps: true,
            sensors: sensors,
            entryCount: parsedEntries.length
        };
    }

    /**
     * Parse Raspberry Pi format
     * Format: { timestamp, topic, type: "raw", payload: "{\"mac\":\"...\", \"time\":..., \"distance\":...}" }
     * Topic example: "bt-tracker/raspberry/thkoeln-piz2w-7-nixos/thkoeln-piz2w-7-nixos/messages/events/distance"
     * @param {array|object} data - Raw data entries
     * @returns {object} Validation result
     */
    function parseRaspberryFormat(data) {
        // Convert single object to array
        let entries = Array.isArray(data) ? data : [data];

        if (entries.length === 0) {
            return { valid: false, error: 'Data array is empty' };
        }

        // Extract unique sensors and group readings by sensor
        const sensorsSet = new Set();
        const sensorReadings = new Map(); // sensor_id -> array of { timestamp, device }

        for (const entry of entries) {
            // Extract sensor ID from topic path
            // Format: bt-tracker/raspberry/<sensor-id>/<sensor-id>/messages/events/distance
            const topic = entry.topic || '';
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
                console.warn('Could not extract sensor ID from topic:', topic);
                continue;
            }

            sensorsSet.add(sensorId);

            // Parse payload (JSON string, may have null character at end)
            let payloadData;
            try {
                const payloadStr = (entry.payload || '').replace(/\u0000/g, '').trim();
                payloadData = JSON.parse(payloadStr);
            } catch (e) {
                console.warn('Failed to parse payload:', entry.payload, e);
                continue;
            }

            // Extract device data from payload
            const mac = payloadData.mac;
            const distance = payloadData.distance;
            const time = payloadData.time;

            if (!mac || typeof distance !== 'number') {
                console.warn('Invalid payload data:', payloadData);
                continue;
            }

            // Create device reading
            const deviceReading = {
                mac_hashed: mac,
                mac: mac,
                distance: distance,
                rssi: payloadData.rssi || -70 // Default RSSI if not provided
            };

            // Use entry timestamp or convert Unix time
            let timestamp = entry.timestamp;
            if (!timestamp && time) {
                timestamp = new Date(time * 1000).toISOString();
            }

            // Group by sensor
            if (!sensorReadings.has(sensorId)) {
                sensorReadings.set(sensorId, []);
            }
            sensorReadings.get(sensorId).push({
                timestamp: timestamp || new Date().toISOString(),
                device: deviceReading
            });
        }

        // Convert to internal format (group readings by timestamp for each sensor)
        const parsedEntries = [];
        const timestampGroups = new Map(); // timestamp -> { sensor_id -> devices[] }

        sensorReadings.forEach((readings, sensorId) => {
            readings.forEach(({ timestamp, device }) => {
                const key = `${timestamp}_${sensorId}`;
                if (!timestampGroups.has(key)) {
                    timestampGroups.set(key, {
                        device_key: sensorId,
                        timestamp: timestamp,
                        devices: [],
                        gps: null
                    });
                }
                timestampGroups.get(key).devices.push(device);
            });
        });

        // Convert to array
        timestampGroups.forEach(entry => {
            parsedEntries.push(entry);
        });

        // Store pending data
        pendingNewFormatData = parsedEntries;

        const sensors = Array.from(sensorsSet);
        console.log(`ðŸ“ Raspberry Pi format: Found ${sensors.length} sensors, ${parsedEntries.length} entries`);
        console.log(`ðŸ“¡ Sensors requiring GPS coordinates:`, sensors);

        return {
            valid: true,
            needsGps: true,
            sensors: sensors,
            entryCount: parsedEntries.length
        };
    }

    /**
     * Set GPS coordinates for sensors (new format)
     * @param {Map|Object} gpsMap - Map of sensor_id -> { lat, lng }
     */
    function setSensorGpsCoordinates(gpsMap) {
        sensorGpsCoordinates.clear();

        if (gpsMap instanceof Map) {
            gpsMap.forEach((coords, sensorId) => {
                sensorGpsCoordinates.set(sensorId, coords);
            });
        } else {
            // Object format
            for (const [sensorId, coords] of Object.entries(gpsMap)) {
                sensorGpsCoordinates.set(sensorId, coords);
            }
        }

        console.log('ðŸ“ GPS coordinates set for sensors:', sensorGpsCoordinates);
    }

    /**
     * Complete processing after GPS coordinates are provided
     * @returns {object} { success: boolean, error?: string }
     */
    function completePendingData() {
        if (!pendingNewFormatData) {
            return { success: false, error: 'No pending data to process' };
        }

        const validatedData = [];

        for (const entry of pendingNewFormatData) {
            const gps = sensorGpsCoordinates.get(entry.device_key);

            if (gps && typeof gps.lat === 'number' && typeof gps.lng === 'number') {
                validatedData.push({
                    ...entry,
                    gps: [gps.lat, gps.lng]
                });
            } else {
                console.warn(`âš ï¸ No GPS coordinates for sensor: ${entry.device_key}`);
            }
        }

        if (validatedData.length === 0) {
            return { success: false, error: 'No entries with valid GPS coordinates' };
        }

        // Process the data
        processData(validatedData);
        pendingNewFormatData = null;

        return {
            success: true,
            sensors: sensorMap.size,
            timestamps: timestamps.length,
            totalEntries: rawData.length
        };
    }

    /**
     * Validate a single sensor entry (old format with GPS)
     */
    function validateOldFormatEntry(entry, index) {
        // Required fields - support both device_key and deviceKey
        const deviceKey = entry.device_key || entry.deviceKey;
        if (!deviceKey || typeof deviceKey !== 'string') {
            return { valid: false, error: 'Missing or invalid device_key' };
        }

        // GPS coordinates - must be array of [lat, lng]
        if (!entry.gps || !Array.isArray(entry.gps) || entry.gps.length < 2) {
            return { valid: false, error: 'Missing or invalid GPS coordinates' };
        }

        const lat = parseFloat(entry.gps[0]);
        const lng = parseFloat(entry.gps[1]);

        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return { valid: false, error: 'Invalid GPS coordinate values' };
        }

        // Timestamp - try to parse
        let timestamp = entry.timestamp;
        if (!timestamp) {
            timestamp = new Date().toISOString();
        }

        // Devices array - can be empty but should be array
        let devices = entry.devices || [];
        if (!Array.isArray(devices)) {
            devices = [];
        }

        // Validate and clean devices - support both distance and distance_m
        const validDevices = devices
            .filter(d => d && d.mac_hashed && (typeof d.distance === 'number' || typeof d.distance_m === 'number'))
            .map(d => ({
                mac_hashed: d.mac_hashed,
                mac: d.mac || null,
                rssi: typeof d.rssi === 'number' ? d.rssi : -100,
                distance: d.distance_m || d.distance || 0
            }))
            .filter(d => d.distance >= 0);

        return {
            valid: true,
            data: {
                device_key: deviceKey,
                gps: [lat, lng],
                timestamp: timestamp,
                devices: validDevices
            }
        };
    }

    /**
     * Process validated data into internal structures
     * @param {array} data - Validated sensor data array
     */
    function processData(data) {
        rawData = data;
        sensorMap.clear();
        timestamps = [];
        dataByTimestamp.clear();

        // Extract unique sensors
        data.forEach(entry => {
            if (!sensorMap.has(entry.device_key)) {
                sensorMap.set(entry.device_key, {
                    id: entry.device_key,
                    lat: entry.gps[0],
                    lng: entry.gps[1]
                });
            }
        });

        // Extract and sort unique timestamps
        const timestampSet = new Set(data.map(e => e.timestamp));
        timestamps = Array.from(timestampSet).sort();

        // Group data by timestamp
        timestamps.forEach(ts => {
            const entries = data.filter(e => e.timestamp === ts);
            dataByTimestamp.set(ts, entries);
        });

        // Create normalized GeoJSON representation
        normalizedData = createGeoJSON();
    }

    /**
     * Create GeoJSON FeatureCollection from processed data
     * @returns {object} GeoJSON FeatureCollection
     */
    function createGeoJSON() {
        const features = [];

        // Add sensor features
        sensorMap.forEach((sensor, id) => {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [sensor.lng, sensor.lat]
                },
                properties: {
                    type: 'sensor',
                    id: id,
                    name: id
                }
            });
        });

        return {
            type: 'FeatureCollection',
            features: features
        };
    }

    /**
     * Get all unique sensors
     * @returns {Map} Map of sensor_id -> { id, lat, lng }
     */
    function getSensors() {
        return sensorMap;
    }

    /**
     * Get sorted list of timestamps
     * @returns {array} Array of timestamp strings
     */
    function getTimestamps() {
        return timestamps;
    }

    /**
     * Get all device readings for a specific timestamp
     * @param {string} timestamp - Target timestamp
     * @returns {Map} Map of mac_hashed -> array of { sensor_id, distance, rssi }
     */
    function getDevicesAt(timestamp) {
        const deviceMap = new Map();
        const entries = dataByTimestamp.get(timestamp) || [];

        entries.forEach(entry => {
            entry.devices.forEach(device => {
                if (!deviceMap.has(device.mac_hashed)) {
                    deviceMap.set(device.mac_hashed, []);
                }
                deviceMap.get(device.mac_hashed).push({
                    sensor_id: entry.device_key,
                    distance: device.distance,
                    rssi: device.rssi,
                    sensor_lat: entry.gps[0],
                    sensor_lng: entry.gps[1]
                });
            });
        });

        return deviceMap;
    }

    /**
     * ============================================================
     * Get all device readings within time window (SYNCHRONIZED)
     * ============================================================
     * Solves the async sensor problem: If Sensor A reports at 12:00:01
     * and Sensor B reports at 12:00:10, both readings are collected
     * when the time window is >= 15 seconds.
     * 
     * @param {string} timestamp - Center timestamp for the window
     * @returns {Map} Map of mac_hashed -> array of { sensor_id, distance, rssi, timestamp }
     */
    function getDevicesInTimeWindow(timestamp) {
        const deviceMap = new Map();
        const centerTime = new Date(timestamp).getTime();

        // Find all timestamps within window: [centerTime - window, centerTime + window]
        const windowStart = centerTime - TIME_WINDOW_MS;
        const windowEnd = centerTime + TIME_WINDOW_MS;

        // Track which sensor-device combinations we've already processed
        // to avoid duplicate readings from the same sensor
        const processedReadings = new Set();

        // Iterate through all timestamps and find those in our window
        timestamps.forEach(ts => {
            const tsTime = new Date(ts).getTime();

            if (tsTime >= windowStart && tsTime <= windowEnd) {
                const entries = dataByTimestamp.get(ts) || [];

                entries.forEach(entry => {
                    entry.devices.forEach(device => {
                        // Create unique key for sensor-device combination
                        const readingKey = `${entry.device_key}_${device.mac_hashed}`;

                        if (!processedReadings.has(readingKey)) {
                            processedReadings.add(readingKey);

                            if (!deviceMap.has(device.mac_hashed)) {
                                deviceMap.set(device.mac_hashed, []);
                            }

                            deviceMap.get(device.mac_hashed).push({
                                sensor_id: entry.device_key,
                                distance: device.distance,
                                rssi: device.rssi,
                                sensor_lat: entry.gps[0],
                                sensor_lng: entry.gps[1],
                                original_timestamp: ts,
                                time_offset_ms: tsTime - centerTime
                            });
                        }
                    });
                });
            }
        });

        return deviceMap;
    }

    /**
     * Set the time synchronization window
     * @param {number} windowMs - Time window in milliseconds
     */
    function setTimeWindow(windowMs) {
        TIME_WINDOW_MS = Math.max(0, windowMs);
        console.log(`â±ï¸ Time sync window set to ${TIME_WINDOW_MS}ms (${TIME_WINDOW_MS / 1000}s)`);
    }

    /**
     * Get current time window setting
     * @returns {number} Time window in milliseconds
     */
    function getTimeWindow() {
        return TIME_WINDOW_MS;
    }

    /**
     * Get sensor data by ID
     * @param {string} sensorId - Sensor identifier
     * @returns {object|null} Sensor data or null if not found
     */
    function getSensorById(sensorId) {
        return sensorMap.get(sensorId) || null;
    }

    /**
     * Get raw data array
     * @returns {array} Original processed data
     */
    function getRawData() {
        return rawData;
    }

    /**
     * Check if data is loaded
     * @returns {boolean}
     */
    function hasData() {
        return rawData.length > 0;
    }

    /**
     * Clear all loaded data
     */
    function clear() {
        rawData = [];
        normalizedData = null;
        sensorMap.clear();
        timestamps = [];
        dataByTimestamp.clear();
    }

    /**
     * Load data from file input
     * @param {File} file - File object from input
     * @returns {Promise} Resolves with success/error result
     */
    function loadFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = function (e) {
                const result = parseAndValidate(e.target.result);

                if (result.valid) {
                    // Check if new format needs GPS coordinates
                    if (result.needsGps) {
                        resolve({
                            success: true,
                            needsGps: true,
                            sensors: result.sensors,
                            entryCount: result.entryCount
                        });
                    } else {
                        // Old format with GPS - process immediately
                        processData(result.data);
                        resolve({
                            success: true,
                            needsGps: false,
                            sensors: sensorMap.size,
                            timestamps: timestamps.length,
                            totalEntries: rawData.length
                        });
                    }
                } else {
                    reject(new Error(result.error));
                }
            };

            reader.onerror = function () {
                reject(new Error('Failed to read file'));
            };

            reader.readAsText(file);
        });
    }

    /**
     * Load data from URL (for sample data)
     * @param {string} url - URL to fetch JSON from
     * @returns {Promise}
     */
    function loadFromUrl(url) {
        return fetch(url)
            .then(response => {
                if (!response.ok) throw new Error('Failed to fetch data');
                return response.json();
            })
            .then(data => {
                const result = parseAndValidate(data);

                if (result.valid) {
                    processData(result.data);
                    return {
                        success: true,
                        sensors: sensorMap.size,
                        timestamps: timestamps.length,
                        totalEntries: rawData.length
                    };
                } else {
                    throw new Error(result.error);
                }
            });
    }

    // Public API
    return {
        parseAndValidate,
        loadFromFile,
        loadFromUrl,
        getSensors,
        getTimestamps,
        getDevicesAt,
        getDevicesInTimeWindow,  // Synchronized sensor readings
        setTimeWindow,           // Configure sync window (default 15s)
        getTimeWindow,           // Get current sync window
        setSensorGpsCoordinates, // NEW: Set GPS for sensors (new format)
        completePendingData,     // NEW: Complete processing after GPS input
        getSensorById,
        getRawData,
        hasData,
        clear
    };
})();

