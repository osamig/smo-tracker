/**
 * ============================================================
 * Map Layers Module
 * ============================================================
 * Manages all Leaflet map layers including sensors, devices,
 * debug overlays, and heatmap visualization.
 */

const MapLayers = (function () {
    // Layer references
    let sensorLayer = null;
    let deviceLayer = null;
    let debugLayer = null;
    let heatmapLayer = null;
    let connectionLines = null;

    // Marker collections
    let sensorMarkers = new Map();
    let deviceMarkers = new Map();
    let debugCircles = [];

    // Selected device for debug view
    let selectedDevice = null;

    // Custom icons
    const sensorIcon = L.divIcon({
        className: 'sensor-icon',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    /**
     * Initialize all layers on the map
     * @param {L.Map} map - Leaflet map instance
     */
    function init(map) {
        // Create layer groups
        sensorLayer = L.layerGroup().addTo(map);
        deviceLayer = L.layerGroup().addTo(map);
        debugLayer = L.layerGroup();
        connectionLines = L.layerGroup();

        // Heatmap will be created when needed
        heatmapLayer = null;
    }

    /**
     * Render sensors on the map
     * @param {Map} sensors - Map of sensor_id -> { id, lat, lng }
     */
    function renderSensors(sensors) {
        sensorLayer.clearLayers();
        sensorMarkers.clear();

        sensors.forEach((sensor, id) => {
            const marker = L.marker([sensor.lat, sensor.lng], {
                icon: sensorIcon,
                zIndexOffset: 1000
            });

            // Tooltip content
            const tooltipContent = `
                <div class="sensor-popup-title">[MQTT] ${id}</div>
                <div class="popup-row">
                    <span class="popup-label">Lat:</span>
                    <span>${sensor.lat.toFixed(6)}</span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">Lng:</span>
                    <span>${sensor.lng.toFixed(6)}</span>
                </div>
            `;

            marker.bindTooltip(tooltipContent, {
                direction: 'top',
                offset: [0, -10]
            });

            marker.sensorId = id;
            sensorMarkers.set(id, marker);
            sensorLayer.addLayer(marker);
        });
    }

    /**
     * Get color based on quality level
     * @param {string} qualityLevel - 'high', 'medium', 'low'
     * @returns {string} CSS color
     */
    function getQualityColor(qualityLevel) {
        switch (qualityLevel) {
            case 'high': return '#10b981';
            case 'medium': return '#f59e0b';
            case 'low': return '#ef4444';
            default: return '#ef4444';
        }
    }

    /**
     * Get marker radius based on RSSI
     * Stronger signal (less negative RSSI) = larger marker
     * @param {number} rssi - RSSI value (typically -30 to -100)
     * @returns {number} Radius in pixels
     */
    function getRadiusFromRSSI(rssi) {
        // Normalize RSSI: -30 (strong) to -100 (weak)
        // Map to radius: 12 (strong) to 6 (weak)
        const normalized = Math.max(0, Math.min(1, (rssi + 100) / 70));
        return 6 + normalized * 8;
    }

    /**
     * Get marker radius based on quality/variance
     * @param {number} variance - Position variance in meters
     * @returns {number} Radius in pixels
     */
    function getRadiusFromVariance(variance) {
        // Lower variance = smaller, tighter marker
        // Higher variance = larger, indicating uncertainty
        const clamped = Math.max(1, Math.min(30, variance));
        return 6 + (clamped / 30) * 10;
    }

    /**
     * Render device positions on the map
     * @param {array} devices - Array of device position objects from Lateration
     */
    function renderDevices(devices) {
        deviceLayer.clearLayers();
        deviceMarkers.clear();

        devices.forEach(device => {
            const color = getQualityColor(device.qualityLevel);

            // Fixed radius for all devices - uniform size
            const radius = 10;

            const marker = L.circleMarker([device.lat, device.lng], {
                radius: radius,
                fillColor: color,
                fillOpacity: 0.8,
                color: 'white',
                weight: 2
            });

            // Tooltip content - show sensor-based quality level
            const qualityClass = `quality-${device.qualityLevel}`;
            const qualityText = device.sensorCount >= 3 ? 'High (≥3 sensors)' :
                device.sensorCount === 2 ? 'Medium (2 sensors)' :
                    'Low (1 sensor)';
            const tooltipContent = `
                <div class="device-popup-title">📱 Device</div>
                <div class="popup-row">
                    <span class="popup-label">MAC:</span>
                    <span>${device.macHashed.substring(0, 12)}...</span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">Position:</span>
                    <span>${device.lat.toFixed(6)}, ${device.lng.toFixed(6)}</span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">Sensors:</span>
                    <span>${device.sensorCount}</span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">Quality:</span>
                    <span class="${qualityClass}">${qualityText}</span>
                </div>
            `;

            marker.bindTooltip(tooltipContent, {
                direction: 'top',
                offset: [0, -10]
            });

            // Click handler for debug mode
            marker.on('click', function () {
                showDeviceDetail(device);
            });

            marker.deviceData = device;
            deviceMarkers.set(device.macHashed, marker);
            deviceLayer.addLayer(marker);
        });

        // Update statistics
        updateStatistics(devices);
    }

    /**
     * Update statistics panel with device counts
     * @param {array} devices - Device position array
     */
    function updateStatistics(devices) {
        const stats = {
            total: devices.length,
            high: devices.filter(d => d.qualityLevel === 'high').length,
            medium: devices.filter(d => d.qualityLevel === 'medium').length,
            low: devices.filter(d => d.qualityLevel === 'low').length
        };

        document.getElementById('stat-devices').textContent = stats.total;
        document.getElementById('stat-high').textContent = stats.high;
        document.getElementById('stat-medium').textContent = stats.medium;
        document.getElementById('stat-low').textContent = stats.low;
    }

    /**
     * Show device detail modal with debug information
     * @param {object} device - Device position object
     */
    function showDeviceDetail(device) {
        selectedDevice = device;

        const modal = document.getElementById('device-modal');
        const body = document.getElementById('modal-body');

        // Build sensor contribution list
        let contributionHTML = '';
        device.observations.forEach(obs => {
            contributionHTML += `
                <div class="contribution-item">
                    <div><strong>${obs.sensor_id}</strong></div>
                    <div>Distance: ${obs.distance.toFixed(1)}m</div>
                    <div>RSSI: ${obs.rssi} dBm</div>
                </div>
            `;
        });

        // Quality text based on sensor count
        const qualityText = device.sensorCount >= 3 ? 'HIGH (≥3 sensors - true lateration)' :
            device.sensorCount === 2 ? 'MEDIUM (2 sensors - estimated midpoint)' :
                'LOW (1 sensor - at sensor position)';

        body.innerHTML = `
            <div class="device-info">
                <div class="device-info-row">
                    <span class="device-info-label">MAC Hash:</span>
                    <span class="device-info-value">${device.macHashed}</span>
                </div>
                <div class="device-info-row">
                    <span class="device-info-label">Estimated Position:</span>
                    <span class="device-info-value">${device.lat.toFixed(6)}, ${device.lng.toFixed(6)}</span>
                </div>
                <div class="device-info-row">
                    <span class="device-info-label">Sensors Used:</span>
                    <span class="device-info-value">${device.sensorCount}</span>
                </div>
                <div class="device-info-row">
                    <span class="device-info-label">Quality:</span>
                    <span class="device-info-value quality-${device.qualityLevel}">${qualityText}</span>
                </div>
            </div>
            <div class="sensor-contributions">
                <h4>[MQTT] Sensor Contributions</h4>
                ${contributionHTML}
            </div>
        `;

        modal.style.display = 'flex';

        // Draw connection lines if debug mode is on
        if (document.getElementById('layer-debug').checked) {
            drawDeviceConnections(device);
        }
    }

    /**
     * Draw lines from device to contributing sensors
     * @param {object} device - Device position object
     */
    function drawDeviceConnections(device) {
        connectionLines.clearLayers();

        device.observations.forEach(obs => {
            const line = L.polyline(
                [[device.lat, device.lng], [obs.sensor_lat, obs.sensor_lng]],
                {
                    color: '#f59e0b',
                    weight: 2,
                    dashArray: '6, 4',
                    opacity: 0.8
                }
            );

            // Distance label at midpoint
            const midLat = (device.lat + obs.sensor_lat) / 2;
            const midLng = (device.lng + obs.sensor_lng) / 2;

            const label = L.marker([midLat, midLng], {
                icon: L.divIcon({
                    className: 'distance-label',
                    html: `<span style="background: rgba(0,0,0,0.7); color: #f59e0b; padding: 2px 6px; border-radius: 4px; font-size: 11px;">${obs.distance.toFixed(1)}m</span>`,
                    iconSize: [60, 20],
                    iconAnchor: [30, 10]
                })
            });

            connectionLines.addLayer(line);
            connectionLines.addLayer(label);
        });
    }

    /**
     * Clear connection lines
     */
    function clearConnections() {
        connectionLines.clearLayers();
        selectedDevice = null;
    }

    /**
     * Render debug circles around sensors showing measured distances
     * @param {array} devices - Device position array
     */
    function renderDebugCircles(devices) {
        debugLayer.clearLayers();
        debugCircles = [];

        // Collect all sensor-distance pairs
        const sensorDistances = new Map();

        devices.forEach(device => {
            device.observations.forEach(obs => {
                if (!sensorDistances.has(obs.sensor_id)) {
                    sensorDistances.set(obs.sensor_id, []);
                }
                sensorDistances.get(obs.sensor_id).push({
                    distance: obs.distance,
                    macHashed: device.macHashed
                });
            });
        });

        // Draw circles for each sensor
        sensorDistances.forEach((distances, sensorId) => {
            const sensor = DataHandler.getSensorById(sensorId);
            if (!sensor) return;

            distances.forEach(({ distance }) => {
                const circle = L.circle([sensor.lat, sensor.lng], {
                    radius: distance,
                    color: '#ef4444',
                    weight: 2,
                    fillColor: 'rgba(239, 68, 68, 0.08)',
                    fillOpacity: 0.3,
                    dashArray: '8, 4',
                    interactive: false
                });

                debugCircles.push(circle);
                debugLayer.addLayer(circle);
            });
        });
    }

    /**
     * Update heatmap layer with device positions
     * @param {L.Map} map - Leaflet map instance  
     * @param {array} devices - Device position array
     */
    function updateHeatmap(map, devices) {
        // Remove existing heatmap
        if (heatmapLayer) {
            map.removeLayer(heatmapLayer);
        }

        if (devices.length === 0) return;

        // Create heat data points
        // Format: [lat, lng, intensity]
        const heatData = devices.map(device => {
            // Intensity based on confidence
            const intensity = device.confidence * 0.8 + 0.2;
            return [device.lat, device.lng, intensity];
        });

        // Create heatmap layer
        heatmapLayer = L.heatLayer(heatData, {
            radius: 25,
            blur: 15,
            maxZoom: 18,
            max: 1.0,
            gradient: {
                0.0: '#10b981',
                0.5: '#f59e0b',
                1.0: '#ef4444'
            }
        });

        // Add to map if toggle is on
        if (document.getElementById('layer-heatmap').checked) {
            heatmapLayer.addTo(map);
        }
    }

    /**
     * Toggle layer visibility
     * @param {L.Map} map - Leaflet map
     * @param {string} layerType - 'sensors', 'devices', 'debug', 'heatmap'
     * @param {boolean} visible - Whether to show the layer
     */
    function toggleLayer(map, layerType, visible) {
        switch (layerType) {
            case 'sensors':
                if (visible) {
                    map.addLayer(sensorLayer);
                } else {
                    map.removeLayer(sensorLayer);
                }
                break;

            case 'devices':
                if (visible) {
                    map.addLayer(deviceLayer);
                } else {
                    map.removeLayer(deviceLayer);
                }
                break;

            case 'debug':
                if (visible) {
                    map.addLayer(debugLayer);
                    map.addLayer(connectionLines);
                } else {
                    map.removeLayer(debugLayer);
                    map.removeLayer(connectionLines);
                    clearConnections();
                }
                break;

            case 'heatmap':
                if (heatmapLayer) {
                    if (visible) {
                        map.addLayer(heatmapLayer);
                    } else {
                        map.removeLayer(heatmapLayer);
                    }
                }
                break;
        }
    }

    /**
     * Clear all layers
     */
    function clearAll() {
        sensorLayer.clearLayers();
        deviceLayer.clearLayers();
        debugLayer.clearLayers();
        connectionLines.clearLayers();

        if (heatmapLayer) {
            heatmapLayer.setLatLngs([]);
        }

        sensorMarkers.clear();
        deviceMarkers.clear();
        debugCircles = [];
        selectedDevice = null;
    }

    /**
     * Get bounds of all sensors
     * @returns {L.LatLngBounds|null}
     */
    function getSensorBounds() {
        if (sensorMarkers.size === 0) return null;

        const bounds = L.latLngBounds([]);
        sensorMarkers.forEach(marker => {
            bounds.extend(marker.getLatLng());
        });

        return bounds;
    }

    // Public API
    return {
        init,
        renderSensors,
        renderDevices,
        renderDebugCircles,
        updateHeatmap,
        toggleLayer,
        clearAll,
        getSensorBounds,
        showDeviceDetail,
        drawDeviceConnections,
        clearConnections,
        getQualityColor
    };
})();
