/**
 * ============================================================
 * UI Controller Module
 * ============================================================
 * Handles UI interactions, layer toggles, theme switching,
 * and modal management.
 */

const UIController = (function () {
    let map = null;

    /**
     * Initialize UI controller
     * @param {L.Map} mapInstance - Leaflet map instance
     */
    function init(mapInstance) {
        map = mapInstance;

        setupLayerToggles();
        setupThemeToggle();
        setupPanelToggle();
        setupModals();
        setupDragDrop();
    }

    /**
     * Setup layer toggle checkboxes
     */
    function setupLayerToggles() {
        document.getElementById('layer-sensors').addEventListener('change', function () {
            MapLayers.toggleLayer(map, 'sensors', this.checked);
        });

        document.getElementById('layer-devices').addEventListener('change', function () {
            MapLayers.toggleLayer(map, 'devices', this.checked);
        });

        document.getElementById('layer-heatmap').addEventListener('change', function () {
            MapLayers.toggleLayer(map, 'heatmap', this.checked);
        });

        document.getElementById('layer-zones').addEventListener('change', function () {
            ZoneManager.toggleVisibility(map, this.checked);
        });

        document.getElementById('layer-debug').addEventListener('change', function () {
            MapLayers.toggleLayer(map, 'debug', this.checked);

            // If turning off debug, close device modal
            if (!this.checked) {
                closeDeviceModal();
                MapLayers.clearConnections();
            }
        });
    }

    /**
     * Setup theme toggle buttons
     */
    function setupThemeToggle() {
        const darkBtn = document.getElementById('style-dark');
        const lightBtn = document.getElementById('style-light');

        // Tile layers
        const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        });

        const lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        });

        // Add dark tiles by default
        darkTiles.addTo(map);
        let currentTiles = darkTiles;

        darkBtn.addEventListener('click', function () {
            if (currentTiles !== darkTiles) {
                map.removeLayer(currentTiles);
                darkTiles.addTo(map);
                currentTiles = darkTiles;
                darkBtn.classList.add('active');
                lightBtn.classList.remove('active');
                document.body.classList.remove('light-theme');
            }
        });

        lightBtn.addEventListener('click', function () {
            if (currentTiles !== lightTiles) {
                map.removeLayer(currentTiles);
                lightTiles.addTo(map);
                currentTiles = lightTiles;
                lightBtn.classList.add('active');
                darkBtn.classList.remove('active');
                document.body.classList.add('light-theme');
            }
        });
    }

    /**
     * Setup panel minimize toggle
     */
    function setupPanelToggle() {
        const panel = document.getElementById('control-panel');
        const toggleBtn = document.getElementById('toggle-panel');

        toggleBtn.addEventListener('click', function () {
            panel.classList.toggle('minimized');
            this.textContent = panel.classList.contains('minimized') ? '+' : '−';
        });
    }

    /**
     * Setup modal close handlers
     */
    function setupModals() {
        // Device modal
        const deviceModal = document.getElementById('device-modal');
        const closeModalBtn = document.getElementById('close-modal');

        closeModalBtn.addEventListener('click', closeDeviceModal);

        // Close on background click
        deviceModal.addEventListener('click', function (e) {
            if (e.target === deviceModal) {
                closeDeviceModal();
            }
        });

        // Zone modal handled in ZoneManager
    }

    /**
     * Close device detail modal
     */
    function closeDeviceModal() {
        document.getElementById('device-modal').style.display = 'none';
        MapLayers.clearConnections();
    }

    /**
     * Setup drag and drop for file upload
     */
    function setupDragDrop() {
        const uploadArea = document.getElementById('upload-area');

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, preventDefaults);
            document.body.addEventListener(eventName, preventDefaults);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => {
                uploadArea.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => {
                uploadArea.classList.remove('dragover');
            });
        });

        uploadArea.addEventListener('drop', function (e) {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                App.loadFile(files[0]);
            }
        });
    }

    /**
     * Show loading overlay
     */
    function showLoading() {
        document.getElementById('loading-overlay').style.display = 'flex';
    }

    /**
     * Hide loading overlay
     */
    function hideLoading() {
        document.getElementById('loading-overlay').style.display = 'none';
    }

    /**
     * Update sensor count in statistics
     * @param {number} count - Number of sensors
     */
    function updateSensorCount(count) {
        document.getElementById('stat-sensors').textContent = count;
    }

    /**
     * Show error message
     * @param {string} message - Error message
     */
    function showError(message) {
        alert('Error: ' + message);
    }

    /**
     * Show success message
     * @param {string} message - Success message
     */
    function showSuccess(message) {
        console.log('Success:', message);
        // Could implement a toast notification here
    }

    // Public API
    return {
        init,
        showLoading,
        hideLoading,
        updateSensorCount,
        showError,
        showSuccess,
        closeDeviceModal
    };
})();
