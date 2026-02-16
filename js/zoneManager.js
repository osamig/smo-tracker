/**
 * ============================================================
 * Zone Manager Module
 * ============================================================
 * Handles geographic zone creation, storage, and export.
 * Zones can be drawn on the map, saved with names, and exported as GeoJSON.
 */

const ZoneManager = (function () {
    // State
    let zones = new Map(); // id -> { name, layer, geojson }
    let zoneIdCounter = 0;
    let drawControl = null;
    let drawnItems = null;
    let pendingLayer = null;
    let updateCallback = null;
    let mapInstance = null;

    // LocalStorage key
    const STORAGE_KEY = 'sensor_tracking_zones';

    // DOM Elements
    let zoneList = null;
    let zoneModal = null;
    let zoneNameInput = null;

    /**
     * Initialize zone manager
     * @param {L.Map} map - Leaflet map instance
     * @param {function} onUpdate - Callback when zones change
     */
    function init(map, onUpdate) {
        updateCallback = onUpdate;
        mapInstance = map;

        // Get DOM elements
        zoneList = document.getElementById('zone-list');
        zoneModal = document.getElementById('zone-modal');
        zoneNameInput = document.getElementById('zone-name-input');

        // Initialize FeatureGroup to store drawn shapes
        drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);

        // Initialize draw control
        drawControl = new L.Control.Draw({
            draw: {
                polygon: {
                    allowIntersection: false,
                    showArea: true,
                    shapeOptions: {
                        color: '#6366f1',
                        fillColor: '#6366f1',
                        fillOpacity: 0.2,
                        weight: 2
                    }
                },
                rectangle: {
                    shapeOptions: {
                        color: '#6366f1',
                        fillColor: '#6366f1',
                        fillOpacity: 0.2,
                        weight: 2
                    }
                },
                circle: false,
                circlemarker: false,
                marker: false,
                polyline: false
            },
            edit: {
                featureGroup: drawnItems,
                remove: false
            }
        });

        // Handle draw events
        map.on(L.Draw.Event.CREATED, handleDrawCreated);

        // Button event listeners
        document.getElementById('btn-draw-zone').addEventListener('click', () => startDrawing(map));
        document.getElementById('btn-import-zone').addEventListener('click', triggerImport);
        document.getElementById('btn-export-zones').addEventListener('click', exportZones);
        document.getElementById('zone-import-input').addEventListener('change', handleImport);

        // Modal event listeners
        document.getElementById('save-zone-name').addEventListener('click', saveZoneWithName);
        document.getElementById('cancel-zone').addEventListener('click', cancelZone);
        document.getElementById('close-zone-modal').addEventListener('click', cancelZone);

        // Load zones from localStorage
        loadFromStorage();
    }

    /**
     * Start drawing mode
     * @param {L.Map} map - Leaflet map
     */
    function startDrawing(map) {
        // Enable polygon drawing
        new L.Draw.Polygon(map, drawControl.options.draw.polygon).enable();
    }

    /**
     * Handle draw created event
     * @param {object} event - Leaflet draw event
     */
    function handleDrawCreated(event) {
        pendingLayer = event.layer;

        // Show name modal
        zoneNameInput.value = '';
        zoneModal.style.display = 'flex';
        zoneNameInput.focus();
    }

    /**
     * Save zone with entered name
     */
    function saveZoneWithName() {
        const name = zoneNameInput.value.trim() || `Zone ${zoneIdCounter + 1}`;

        if (pendingLayer) {
            const id = `zone_${zoneIdCounter++}`;

            // Convert to GeoJSON
            const geojson = pendingLayer.toGeoJSON();
            geojson.properties = {
                id: id,
                name: name
            };

            // Style the layer
            pendingLayer.setStyle({
                color: '#6366f1',
                fillColor: '#6366f1',
                fillOpacity: 0.15,
                weight: 2
            });

            // Add popup
            pendingLayer.bindPopup(`<strong>${name}</strong><br><span id="zone-count-${id}">0 devices</span>`);

            // Add to drawn items
            drawnItems.addLayer(pendingLayer);

            // Store zone
            zones.set(id, {
                name: name,
                layer: pendingLayer,
                geojson: geojson
            });

            pendingLayer = null;

            // Update list and save to localStorage
            updateZoneList();
            saveToStorage();

            // Trigger callback
            if (updateCallback) {
                updateCallback();
            }
        }

        closeZoneModal();
    }

    /**
     * Cancel zone creation
     */
    function cancelZone() {
        pendingLayer = null;
        closeZoneModal();
    }

    /**
     * Close zone name modal
     */
    function closeZoneModal() {
        zoneModal.style.display = 'none';
        zoneNameInput.value = '';
    }

    /**
     * Update zone list in sidebar
     */
    function updateZoneList() {
        if (zones.size === 0) {
            zoneList.innerHTML = '<p class="zone-empty">No zones defined</p>';
            return;
        }

        let html = '';
        zones.forEach((zone, id) => {
            html += `
                <div class="zone-item" data-zone-id="${id}">
                    <div>
                        <div class="zone-name">${zone.name}</div>
                        <div class="zone-count" id="zone-count-display-${id}">0 devices</div>
                    </div>
                    <button class="zone-delete" onclick="ZoneManager.deleteZone('${id}')" title="Delete zone">[Clear]</button>
                </div>
            `;
        });

        zoneList.innerHTML = html;
    }

    /**
     * Delete a zone
     * @param {string} id - Zone ID
     */
    function deleteZone(id) {
        const zone = zones.get(id);
        if (zone) {
            drawnItems.removeLayer(zone.layer);
            zones.delete(id);
            updateZoneList();
            saveToStorage();

            if (updateCallback) {
                updateCallback();
            }
        }
    }

    /**
     * Export all zones as GeoJSON
     */
    function exportZones() {
        if (zones.size === 0) {
            alert('No zones to export');
            return;
        }

        const features = [];
        zones.forEach(zone => {
            features.push(zone.geojson);
        });

        const geojsonCollection = {
            type: 'FeatureCollection',
            features: features
        };

        // Create download
        const blob = new Blob([JSON.stringify(geojsonCollection, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'zones.geojson';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Trigger file import dialog
     */
    function triggerImport() {
        document.getElementById('zone-import-input').click();
    }

    /**
     * Handle GeoJSON file import
     * @param {Event} event - File input change event
     */
    function handleImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const geojson = JSON.parse(e.target.result);
                importGeoJSON(geojson);
            } catch (err) {
                alert('Error parsing GeoJSON: ' + err.message);
            }
        };
        reader.readAsText(file);

        // Reset input
        event.target.value = '';
    }

    /**
     * Import zones from GeoJSON
     * @param {object} geojson - GeoJSON FeatureCollection
     */
    function importGeoJSON(geojson) {
        if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
            alert('Invalid GeoJSON format');
            return;
        }

        let importCount = 0;

        geojson.features.forEach(feature => {
            if (feature.type !== 'Feature') return;
            if (!feature.geometry) return;

            // Only import polygons
            if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return;

            const id = `zone_${zoneIdCounter++}`;
            const name = (feature.properties && feature.properties.name) || `Imported Zone ${importCount + 1}`;

            // Create Leaflet layer from GeoJSON
            const layer = L.geoJSON(feature, {
                style: {
                    color: '#6366f1',
                    fillColor: '#6366f1',
                    fillOpacity: 0.15,
                    weight: 2
                }
            });

            // Get the actual polygon layer
            const polygonLayer = layer.getLayers()[0];
            if (!polygonLayer) return;

            polygonLayer.bindPopup(`<strong>${name}</strong><br><span id="zone-count-${id}">0 devices</span>`);

            // Update feature properties
            feature.properties = feature.properties || {};
            feature.properties.id = id;
            feature.properties.name = name;

            // Store zone
            zones.set(id, {
                name: name,
                layer: polygonLayer,
                geojson: feature
            });

            drawnItems.addLayer(polygonLayer);
            importCount++;
        });

        if (importCount > 0) {
            updateZoneList();
            saveToStorage();
            if (updateCallback) {
                updateCallback();
            }
        }

        alert(`Imported ${importCount} zone(s)`);
    }

    /**
     * Count devices within each zone
     * @param {array} devices - Array of device positions
     */
    function updateDeviceCounts(devices) {
        zones.forEach((zone, id) => {
            let count = 0;

            devices.forEach(device => {
                if (isPointInZone([device.lat, device.lng], zone.layer)) {
                    count++;
                }
            });

            // Update popup
            const popupElement = document.getElementById(`zone-count-${id}`);
            if (popupElement) {
                popupElement.textContent = `${count} device${count !== 1 ? 's' : ''}`;
            }

            // Update sidebar
            const displayElement = document.getElementById(`zone-count-display-${id}`);
            if (displayElement) {
                displayElement.textContent = `${count} device${count !== 1 ? 's' : ''}`;
            }
        });
    }

    /**
     * Check if a point is inside a zone
     * @param {array} latlng - [lat, lng]
     * @param {L.Layer} layer - Zone layer
     * @returns {boolean}
     */
    function isPointInZone(latlng, layer) {
        if (!layer.getBounds) return false;

        // Quick bounds check first
        const bounds = layer.getBounds();
        if (!bounds.contains(latlng)) return false;

        // Detailed point-in-polygon check
        const point = L.latLng(latlng);

        // Use Leaflet's built-in method if available (for polygons)
        if (layer.getLatLngs) {
            const latlngs = layer.getLatLngs();
            return isPointInPolygon(point, latlngs[0] || latlngs);
        }

        return false;
    }

    /**
     * Ray casting algorithm for point in polygon
     * @param {L.LatLng} point - Point to test
     * @param {array} polygon - Array of L.LatLng
     * @returns {boolean}
     */
    function isPointInPolygon(point, polygon) {
        if (!polygon || polygon.length < 3) return false;

        let inside = false;
        const x = point.lng;
        const y = point.lat;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].lng;
            const yi = polygon[i].lat;
            const xj = polygon[j].lng;
            const yj = polygon[j].lat;

            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }

        return inside;
    }

    /**
     * Get all zones
     * @returns {Map}
     */
    function getZones() {
        return zones;
    }

    /**
     * Toggle zone visibility
     * @param {L.Map} map - Leaflet map
     * @param {boolean} visible - Whether to show zones
     */
    function toggleVisibility(map, visible) {
        if (visible) {
            map.addLayer(drawnItems);
        } else {
            map.removeLayer(drawnItems);
        }
    }

    /**
     * Clear all zones
     */
    function clearAll() {
        zones.forEach((zone, id) => {
            drawnItems.removeLayer(zone.layer);
        });
        zones.clear();
        zoneIdCounter = 0;
        updateZoneList();
        saveToStorage();
    }

    /**
     * Save zones to localStorage
     */
    function saveToStorage() {
        try {
            const features = [];
            zones.forEach(zone => {
                features.push(zone.geojson);
            });

            const data = {
                type: 'FeatureCollection',
                features: features,
                zoneIdCounter: zoneIdCounter
            };

            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            console.log('Zones saved to localStorage:', zones.size, 'zones');
        } catch (e) {
            console.warn('Failed to save zones to localStorage:', e);
        }
    }

    /**
     * Load zones from localStorage
     */
    function loadFromStorage() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return;

            const data = JSON.parse(stored);
            if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) return;

            // Restore zone ID counter
            if (typeof data.zoneIdCounter === 'number') {
                zoneIdCounter = data.zoneIdCounter;
            }

            // Import zones silently (no alert)
            let importCount = 0;
            data.features.forEach(feature => {
                if (feature.type !== 'Feature') return;
                if (!feature.geometry) return;
                if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return;

                const id = (feature.properties && feature.properties.id) || `zone_${zoneIdCounter++}`;
                const name = (feature.properties && feature.properties.name) || `Zone ${importCount + 1}`;

                // Create Leaflet layer from GeoJSON
                const layer = L.geoJSON(feature, {
                    style: {
                        color: '#6366f1',
                        fillColor: '#6366f1',
                        fillOpacity: 0.15,
                        weight: 2
                    }
                });

                const polygonLayer = layer.getLayers()[0];
                if (!polygonLayer) return;

                polygonLayer.bindPopup(`<strong>${name}</strong><br><span id="zone-count-${id}">0 devices</span>`);

                feature.properties = feature.properties || {};
                feature.properties.id = id;
                feature.properties.name = name;

                zones.set(id, {
                    name: name,
                    layer: polygonLayer,
                    geojson: feature
                });

                drawnItems.addLayer(polygonLayer);
                importCount++;
            });

            if (importCount > 0) {
                updateZoneList();
                console.log('Loaded', importCount, 'zones from localStorage');
            }
        } catch (e) {
            console.warn('Failed to load zones from localStorage:', e);
        }
    }

    // Public API
    return {
        init,
        deleteZone,
        exportZones,
        importGeoJSON,
        updateDeviceCounts,
        getZones,
        toggleVisibility,
        clearAll,
        saveToStorage,
        loadFromStorage
    };
})();
