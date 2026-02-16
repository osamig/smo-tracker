/**
 * ============================================================
 * GPS Storage Module
 * ============================================================
 * Handles persistent storage of sensor GPS coordinates using localStorage.
 * Allows saving, loading, and editing of GPS coordinates for sensors.
 */

const GpsStorage = (function () {
    const STORAGE_KEY = 'smo_sensor_gps_coordinates';

    /**
     * Load all stored GPS coordinates
     * @returns {object} Map of sensor_id -> { lat, lng }
     */
    function loadAll() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                console.log('[GPS] Loaded coordinates for', Object.keys(data).length, 'sensors');
                return data;
            }
        } catch (e) {
            console.warn('Failed to load GPS coordinates:', e);
        }
        return {};
    }

    /**
     * Save all GPS coordinates
     * @param {object} gpsMap - Map of sensor_id -> { lat, lng }
     */
    function saveAll(gpsMap) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(gpsMap));
            console.log('[GPS] Saved coordinates for', Object.keys(gpsMap).length, 'sensors');
        } catch (e) {
            console.error('Failed to save GPS coordinates:', e);
        }
    }

    /**
     * Get GPS coordinates for a specific sensor
     * @param {string} sensorId - Sensor identifier
     * @returns {object|null} { lat, lng } or null if not found
     */
    function get(sensorId) {
        const all = loadAll();
        return all[sensorId] || null;
    }

    /**
     * Set GPS coordinates for a specific sensor
     * @param {string} sensorId - Sensor identifier
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     */
    function set(sensorId, lat, lng) {
        const all = loadAll();
        all[sensorId] = { lat, lng };
        saveAll(all);
    }

    /**
     * Set GPS coordinates for multiple sensors
     * @param {object} gpsMap - Map of sensor_id -> { lat, lng }
     */
    function setMultiple(gpsMap) {
        const all = loadAll();
        for (const [sensorId, coords] of Object.entries(gpsMap)) {
            all[sensorId] = coords;
        }
        saveAll(all);
    }

    /**
     * Remove GPS coordinates for a sensor
     * @param {string} sensorId - Sensor identifier
     */
    function remove(sensorId) {
        const all = loadAll();
        delete all[sensorId];
        saveAll(all);
    }

    /**
     * Clear all stored GPS coordinates
     */
    function clearAll() {
        try {
            localStorage.removeItem(STORAGE_KEY);
            console.log('[GPS] Cleared all stored coordinates');
        } catch (e) {
            console.error('Failed to clear GPS coordinates:', e);
        }
    }

    /**
     * Check if GPS coordinates exist for a sensor
     * @param {string} sensorId - Sensor identifier
     * @returns {boolean}
     */
    function has(sensorId) {
        const all = loadAll();
        return sensorId in all;
    }

    /**
     * Get list of all stored sensor IDs
     * @returns {array}
     */
    function getSensorIds() {
        const all = loadAll();
        return Object.keys(all);
    }

    /**
     * Export all GPS coordinates as JSON
     * @returns {string} JSON string
     */
    function exportAsJson() {
        const all = loadAll();
        return JSON.stringify(all, null, 2);
    }

    /**
     * Import GPS coordinates from JSON
     * @param {string} jsonString - JSON string
     * @param {boolean} merge - If true, merge with existing; if false, replace
     * @returns {object} { success, count, error }
     */
    function importFromJson(jsonString, merge = true) {
        try {
            const imported = JSON.parse(jsonString);

            // Validate structure
            for (const [sensorId, coords] of Object.entries(imported)) {
                if (typeof coords.lat !== 'number' || typeof coords.lng !== 'number') {
                    return { success: false, error: `Invalid coordinates for sensor ${sensorId}` };
                }
            }

            if (merge) {
                setMultiple(imported);
            } else {
                saveAll(imported);
            }

            return { success: true, count: Object.keys(imported).length };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    // Public API
    return {
        loadAll,
        saveAll,
        get,
        set,
        setMultiple,
        remove,
        clearAll,
        has,
        getSensorIds,
        exportAsJson,
        importFromJson
    };
})();
