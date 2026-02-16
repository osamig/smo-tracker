/**
 * ============================================================
 * Lateration Module
 * ============================================================
 * Implements distance-based position estimation using lateration.
 * 
 * ALGORITHM OVERVIEW:
 * ==================
 * Lateration (also called trilateration for 3 points) determines
 * an unknown position from distance measurements to known points.
 * 
 * Given N sensors at positions (x_i, y_i) with measured distances d_i,
 * we find position (x, y) that best satisfies:
 *   (x - x_i)² + (y - y_i)² = d_i²  for all i
 * 
 * IMPLEMENTATION:
 * - ≥3 sensors: Weighted least squares trilateration (HIGH quality - green)
 * - 2 sensors: Weighted midpoint along connecting line (MEDIUM quality - yellow)
 * - 1 sensor: Position placed at sensor location (LOW quality - red)
 * - 0 sensors: Position cannot be determined
 * 
 * QUALITY LEVELS (based purely on sensor count):
 * - HIGH (green):   ≥3 sensors - true lateration
 * - MEDIUM (yellow): exactly 2 sensors - estimated midpoint/weighted solution
 * - LOW (red):       1 sensor - device shown at sensor position
 */

const Lateration = (function () {

    // Cache for lateration results
    const resultCache = new Map();

    // Kalman filter enabled state
    let kalmanEnabled = true;

    /**
     * Convert GPS coordinates to local Cartesian coordinates (meters)
     * Uses simple equirectangular projection suitable for small areas
     * 
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude  
     * @param {number} refLat - Reference latitude (center of area)
     * @param {number} refLng - Reference longitude (center of area)
     * @returns {object} { x, y } in meters
     */
    function gpsToMeters(lat, lng, refLat, refLng) {
        const earthRadius = 6371000; // meters
        const latRad = refLat * Math.PI / 180;

        const x = (lng - refLng) * Math.PI / 180 * earthRadius * Math.cos(latRad);
        const y = (lat - refLat) * Math.PI / 180 * earthRadius;

        return { x, y };
    }

    /**
     * Convert local Cartesian coordinates back to GPS
     * 
     * @param {number} x - X coordinate in meters
     * @param {number} y - Y coordinate in meters
     * @param {number} refLat - Reference latitude
     * @param {number} refLng - Reference longitude
     * @returns {object} { lat, lng }
     */
    function metersToGps(x, y, refLat, refLng) {
        const earthRadius = 6371000;
        const latRad = refLat * Math.PI / 180;

        const lat = refLat + (y / earthRadius) * (180 / Math.PI);
        const lng = refLng + (x / (earthRadius * Math.cos(latRad))) * (180 / Math.PI);

        return { lat, lng };
    }

    /**
     * Calculate Euclidean distance between two points
     * @param {object} p1 - { x, y }
     * @param {object} p2 - { x, y }
     * @returns {number} Distance
     */
    function distance(p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    }

    /**
     * Main lateration function - estimates device position from sensor readings
     * 
     * @param {array} observations - Array of { sensor_id, sensor_lat, sensor_lng, distance, rssi }
     * @returns {object} { 
     *   lat, lng,           // Estimated position
     *   quality,            // Quality score (lower = better)
     *   qualityLevel,       // 'high', 'medium', 'low'
     *   sensorCount,        // Number of sensors used
     *   observations,       // Original observations (for debug display)
     *   confidence          // 0-1 confidence value
     * }
     */
    function trilaterate(observations) {
        // Filter valid observations (positive distance)
        const validObs = observations.filter(o => o.distance > 0 && o.distance < 200);

        if (validObs.length < 1) {
            return null; // No sensors - cannot show device
        }

        // Calculate reference point (centroid of sensors)
        const refLat = validObs.reduce((sum, o) => sum + o.sensor_lat, 0) / validObs.length;
        const refLng = validObs.reduce((sum, o) => sum + o.sensor_lng, 0) / validObs.length;

        // Convert to local coordinates
        const points = validObs.map(o => ({
            ...o,
            pos: gpsToMeters(o.sensor_lat, o.sensor_lng, refLat, refLng)
        }));

        let estimatedPos;
        let gpsResult;

        if (validObs.length === 1) {
            // ONE SENSOR: Position device at measured distance from sensor (LOW quality - red)
            // Previously placed at sensor location which made it invisible under the blue sensor marker
            // Now: offset by the measured distance in a deterministic direction based on device hash

            const sensor = validObs[0];
            const distanceMeters = sensor.distance;

            // Use a deterministic angle based on device MAC hash (so same device always appears in same direction)
            // This creates a consistent visual without random jumps
            let angle = 0;
            if (sensor.mac_hashed) {
                // Generate angle from hash (0 to 2π)
                let hash = 0;
                for (let i = 0; i < sensor.mac_hashed.length; i++) {
                    hash = ((hash << 5) - hash) + sensor.mac_hashed.charCodeAt(i);
                    hash = hash & hash; // Convert to 32bit integer
                }
                angle = (Math.abs(hash) % 360) * Math.PI / 180;
            }

            // Convert distance offset to GPS coordinates
            const earthRadius = 6371000; // meters
            const latOffset = (distanceMeters * Math.cos(angle) / earthRadius) * (180 / Math.PI);
            const lngOffset = (distanceMeters * Math.sin(angle) / (earthRadius * Math.cos(sensor.sensor_lat * Math.PI / 180))) * (180 / Math.PI);

            gpsResult = {
                lat: sensor.sensor_lat + latOffset,
                lng: sensor.sensor_lng + lngOffset
            };
            estimatedPos = { x: distanceMeters * Math.sin(angle), y: distanceMeters * Math.cos(angle), variance: distanceMeters };
        } else if (validObs.length === 2) {
            // TWO SENSORS: Weighted midpoint (MEDIUM quality - yellow)
            estimatedPos = estimateTwoSensorPosition(points);
            gpsResult = metersToGps(estimatedPos.x, estimatedPos.y, refLat, refLng);
        } else {
            // THREE OR MORE SENSORS: True lateration (HIGH quality - green)
            estimatedPos = estimateMultiSensorPosition(points);
            gpsResult = metersToGps(estimatedPos.x, estimatedPos.y, refLat, refLng);
        }

        // Quality level is purely based on sensor count
        const qualityLevel = getQualityLevel(validObs.length);
        // Calculate residual for variance (informational only)
        const residual = validObs.length > 1 ? calculateResidual(estimatedPos, points) : validObs[0].distance;
        // Confidence based on sensor count
        const confidence = getConfidenceFromSensorCount(validObs.length);

        return {
            lat: gpsResult.lat,
            lng: gpsResult.lng,
            qualityLevel: qualityLevel,
            sensorCount: validObs.length,
            observations: validObs,
            confidence: confidence,
            variance: estimatedPos.variance || residual
        };
    }

    /**
     * Estimate position from exactly 2 sensors
     * Uses weighted position along the line between sensors
     * 
     * @param {array} points - Two sensor observations with pos field
     * @returns {object} { x, y }
     */
    function estimateTwoSensorPosition(points) {
        const p1 = points[0];
        const p2 = points[1];

        // Vector from sensor 1 to sensor 2
        const dx = p2.pos.x - p1.pos.x;
        const dy = p2.pos.y - p1.pos.y;
        const sensorDist = Math.sqrt(dx * dx + dy * dy);

        if (sensorDist === 0) {
            // Sensors at same location, return that point
            return { x: p1.pos.x, y: p1.pos.y };
        }

        // Calculate position along the line
        // d1 = distance from sensor 1 to device
        // d2 = distance from sensor 2 to device
        // Position where circles would intersect (or closest point)

        const d1 = p1.distance;
        const d2 = p2.distance;

        // Parameter t: 0 = at sensor 1, 1 = at sensor 2
        // Using weighted interpolation based on distances
        let t = (sensorDist * sensorDist + d1 * d1 - d2 * d2) / (2 * sensorDist * sensorDist);

        // Clamp to reasonable range (allow some extrapolation)
        t = Math.max(-0.5, Math.min(1.5, t));

        return {
            x: p1.pos.x + t * dx,
            y: p1.pos.y + t * dy,
            variance: Math.abs(d1 + d2 - sensorDist) // Measure of inconsistency
        };
    }

    /**
     * Estimate position from 3+ sensors using weighted least squares
     * 
     * Math explanation:
     * We minimize: Σ w_i * (√((x-x_i)² + (y-y_i)²) - d_i)²
     * 
     * Linearized approach:
     * From (x-x_i)² + (y-y_i)² = d_i², subtract first equation from others
     * to get linear system: Ax = b
     * 
     * @param {array} points - Sensor observations with pos field
     * @returns {object} { x, y }
     */
    function estimateMultiSensorPosition(points) {
        const n = points.length;

        // Use first point as reference
        const ref = points[0];

        // Build linear system (n-1 equations)
        // 2(x_i - x_1)(x) + 2(y_i - y_1)(y) = d_1² - d_i² + x_i² - x_1² + y_i² - y_1²

        const A = [];
        const b = [];
        const weights = [];

        for (let i = 1; i < n; i++) {
            const pi = points[i];

            A.push([
                2 * (pi.pos.x - ref.pos.x),
                2 * (pi.pos.y - ref.pos.y)
            ]);

            b.push(
                ref.distance * ref.distance - pi.distance * pi.distance +
                pi.pos.x * pi.pos.x - ref.pos.x * ref.pos.x +
                pi.pos.y * pi.pos.y - ref.pos.y * ref.pos.y
            );

            // Weight by inverse distance (closer readings are more reliable)
            // Also weight by RSSI if available (stronger signal = more reliable)
            const distWeight = 1 / (pi.distance + 1);
            const rssiWeight = pi.rssi ? Math.pow(10, (pi.rssi + 100) / 20) : 1;
            weights.push(distWeight * rssiWeight);
        }

        // Solve weighted least squares: (A'WA)x = A'Wb
        const result = solveWeightedLeastSquares(A, b, weights);

        // Calculate variance from residuals
        let sumSqResiduals = 0;
        for (let i = 0; i < points.length; i++) {
            const estDist = distance(result, points[i].pos);
            sumSqResiduals += Math.pow(estDist - points[i].distance, 2);
        }
        result.variance = Math.sqrt(sumSqResiduals / points.length);

        return result;
    }

    /**
     * Solve weighted least squares system
     * @param {array} A - Coefficient matrix (n-1 x 2)
     * @param {array} b - Right-hand side vector (n-1)
     * @param {array} w - Weights (n-1)
     * @returns {object} { x, y }
     */
    function solveWeightedLeastSquares(A, b, w) {
        const n = A.length;

        // Compute A'WA (2x2 matrix) and A'Wb (2x1 vector)
        let ata00 = 0, ata01 = 0, ata10 = 0, ata11 = 0;
        let atb0 = 0, atb1 = 0;

        for (let i = 0; i < n; i++) {
            const wi = w[i];
            ata00 += wi * A[i][0] * A[i][0];
            ata01 += wi * A[i][0] * A[i][1];
            ata10 += wi * A[i][1] * A[i][0];
            ata11 += wi * A[i][1] * A[i][1];
            atb0 += wi * A[i][0] * b[i];
            atb1 += wi * A[i][1] * b[i];
        }

        // Solve 2x2 system using direct formula
        const det = ata00 * ata11 - ata01 * ata10;

        if (Math.abs(det) < 1e-10) {
            // Singular matrix - return centroid
            let cx = 0, cy = 0;
            for (let i = 0; i < n; i++) {
                cx += A[i][0];
                cy += A[i][1];
            }
            return { x: cx / n, y: cy / n };
        }

        return {
            x: (ata11 * atb0 - ata01 * atb1) / det,
            y: (ata00 * atb1 - ata10 * atb0) / det
        };
    }

    /**
     * Calculate residual (average error) for estimated position
     * Used for variance calculation only, not for quality level
     * 
     * @param {object} estimatedPos - { x, y } estimated position
     * @param {array} points - Sensor observations with pos field
     * @returns {number} Average residual in meters
     */
    function calculateResidual(estimatedPos, points) {
        let totalError = 0;

        for (const point of points) {
            const estDist = distance(estimatedPos, point.pos);
            totalError += Math.abs(estDist - point.distance);
        }

        return totalError / points.length;
    }

    /**
     * Determine quality level based purely on sensor count
     * @param {number} sensorCount - Number of sensors used
     * @returns {string} 'high', 'medium', or 'low'
     */
    function getQualityLevel(sensorCount) {
        if (sensorCount >= 3) {
            // True lateration with 3+ sensors
            return 'high';
        } else if (sensorCount === 2) {
            // Estimated midpoint/weighted solution
            return 'medium';
        } else {
            // 1 sensor - device shown at sensor position
            return 'low';
        }
    }

    /**
     * Get confidence value based on sensor count
     * @param {number} sensorCount - Number of sensors
     * @returns {number} Confidence between 0 and 1
     */
    function getConfidenceFromSensorCount(sensorCount) {
        if (sensorCount >= 3) {
            return 1.0;  // High confidence with true lateration
        } else if (sensorCount === 2) {
            return 0.5;  // Medium confidence with 2 sensors
        } else {
            return 0.2;  // Low confidence with single sensor
        }
    }

    /**
     * Get cache key for a set of observations
     * @param {string} timestamp - Timestamp string
     * @param {string} macHashed - Device MAC hash
     * @returns {string} Cache key
     */
    function getCacheKey(timestamp, macHashed) {
        return `${timestamp}:${macHashed}`;
    }

    /**
     * Get cached result or compute new one
     * @param {string} timestamp - Timestamp
     * @param {string} macHashed - Device MAC hash
     * @param {array} observations - Sensor observations
     * @returns {object|null} Lateration result
     */
    function getCachedOrCompute(timestamp, macHashed, observations) {
        const key = getCacheKey(timestamp, macHashed);

        if (resultCache.has(key)) {
            return resultCache.get(key);
        }

        const result = trilaterate(observations);
        resultCache.set(key, result);

        return result;
    }

    /**
     * Clear the result cache
     */
    function clearCache() {
        resultCache.clear();
        // Also clear Kalman filter states when cache is cleared
        kalmanStates.clear();
    }

    // ============================================================
    // KALMAN FILTER IMPLEMENTATION
    // ============================================================
    // 
    // The Kalman filter smooths position estimates over time by
    // combining predictions based on previous state with new
    // measurements. This reduces noise and provides smoother tracking.
    //
    // State vector: [x, y, vx, vy] (position and velocity)
    // Measurement: [x, y] (position only)
    //
    // References:
    // - https://www.wouterbulten.nl/posts/kalman-filters-explained-removing-noise-from-rssi-signals/
    // ============================================================

    // Store Kalman filter state per device
    const kalmanStates = new Map();

    // Kalman filter parameters
    const KALMAN_CONFIG = {
        // Process noise - how much we expect position to change between measurements
        // Higher = more responsive to changes, lower = smoother but slower
        processNoise: 0.5,

        // Measurement noise - how noisy our lateration measurements are
        // Higher = trust previous state more, lower = trust measurements more
        measurementNoise: 2.0,

        // Time step between measurements (in arbitrary units, normalized)
        dt: 1.0
    };

    /**
     * Create initial Kalman filter state for a device
     * @param {number} x - Initial x position
     * @param {number} y - Initial y position
     * @returns {object} Kalman state
     */
    function createKalmanState(x, y) {
        return {
            // State vector [x, y, vx, vy]
            x: [x, y, 0, 0],

            // State covariance matrix (4x4)
            // Start with high uncertainty
            P: [
                [100, 0, 0, 0],
                [0, 100, 0, 0],
                [0, 0, 10, 0],
                [0, 0, 0, 10]
            ],

            // Last update timestamp
            lastUpdate: Date.now()
        };
    }

    /**
     * Kalman filter predict step
     * Predicts the next state based on motion model
     * @param {object} state - Current Kalman state
     * @param {number} dt - Time step
     * @returns {object} Predicted state
     */
    function kalmanPredict(state, dt) {
        const { x, P } = state;
        const q = KALMAN_CONFIG.processNoise;

        // State transition matrix F (constant velocity model)
        // [1, 0, dt, 0 ]
        // [0, 1, 0,  dt]
        // [0, 0, 1,  0 ]
        // [0, 0, 0,  1 ]

        // Predicted state: x_pred = F * x
        const x_pred = [
            x[0] + x[2] * dt,  // x + vx * dt
            x[1] + x[3] * dt,  // y + vy * dt
            x[2],              // vx (constant)
            x[3]               // vy (constant)
        ];

        // Predicted covariance: P_pred = F * P * F' + Q
        // Simplified computation for our specific F matrix
        const P_pred = [
            [P[0][0] + 2 * dt * P[0][2] + dt * dt * P[2][2] + q, P[0][1] + dt * P[0][3] + dt * P[2][1] + dt * dt * P[2][3], P[0][2] + dt * P[2][2], P[0][3] + dt * P[2][3]],
            [P[1][0] + dt * P[1][2] + dt * P[3][0] + dt * dt * P[3][2], P[1][1] + 2 * dt * P[1][3] + dt * dt * P[3][3] + q, P[1][2] + dt * P[3][2], P[1][3] + dt * P[3][3]],
            [P[2][0] + dt * P[2][2], P[2][1] + dt * P[2][3], P[2][2] + q, P[2][3]],
            [P[3][0] + dt * P[3][2], P[3][1] + dt * P[3][3], P[3][2], P[3][3] + q]
        ];

        return { x: x_pred, P: P_pred };
    }

    /**
     * Kalman filter update step
     * Updates state based on new measurement
     * @param {object} predicted - Predicted state from predict step
     * @param {number} mx - Measured x position
     * @param {number} my - Measured y position
     * @param {number} measurementNoise - Measurement noise (based on quality)
     * @returns {object} Updated state
     */
    function kalmanUpdate(predicted, mx, my, measurementNoise) {
        const { x, P } = predicted;
        const r = measurementNoise;

        // Measurement matrix H = [1, 0, 0, 0; 0, 1, 0, 0]
        // We only measure position, not velocity

        // Innovation (measurement residual): y = z - H * x
        const y = [mx - x[0], my - x[1]];

        // Innovation covariance: S = H * P * H' + R
        const S = [
            [P[0][0] + r, P[0][1]],
            [P[1][0], P[1][1] + r]
        ];

        // Kalman gain: K = P * H' * S^(-1)
        // S is 2x2, compute inverse
        const det = S[0][0] * S[1][1] - S[0][1] * S[1][0];
        if (Math.abs(det) < 1e-10) {
            // Singular, return prediction
            return predicted;
        }

        const S_inv = [
            [S[1][1] / det, -S[0][1] / det],
            [-S[1][0] / det, S[0][0] / det]
        ];

        // K = P * H' * S_inv (4x2 matrix)
        const K = [
            [P[0][0] * S_inv[0][0] + P[0][1] * S_inv[1][0], P[0][0] * S_inv[0][1] + P[0][1] * S_inv[1][1]],
            [P[1][0] * S_inv[0][0] + P[1][1] * S_inv[1][0], P[1][0] * S_inv[0][1] + P[1][1] * S_inv[1][1]],
            [P[2][0] * S_inv[0][0] + P[2][1] * S_inv[1][0], P[2][0] * S_inv[0][1] + P[2][1] * S_inv[1][1]],
            [P[3][0] * S_inv[0][0] + P[3][1] * S_inv[1][0], P[3][0] * S_inv[0][1] + P[3][1] * S_inv[1][1]]
        ];

        // Updated state: x_new = x + K * y
        const x_new = [
            x[0] + K[0][0] * y[0] + K[0][1] * y[1],
            x[1] + K[1][0] * y[0] + K[1][1] * y[1],
            x[2] + K[2][0] * y[0] + K[2][1] * y[1],
            x[3] + K[3][0] * y[0] + K[3][1] * y[1]
        ];

        // Updated covariance: P_new = (I - K * H) * P
        const P_new = [
            [(1 - K[0][0]) * P[0][0] - K[0][1] * P[1][0], (1 - K[0][0]) * P[0][1] - K[0][1] * P[1][1], P[0][2] - K[0][0] * P[0][2] - K[0][1] * P[1][2], P[0][3] - K[0][0] * P[0][3] - K[0][1] * P[1][3]],
            [-K[1][0] * P[0][0] + (1 - K[1][1]) * P[1][0], -K[1][0] * P[0][1] + (1 - K[1][1]) * P[1][1], P[1][2] - K[1][0] * P[0][2] - K[1][1] * P[1][2], P[1][3] - K[1][0] * P[0][3] - K[1][1] * P[1][3]],
            [-K[2][0] * P[0][0] - K[2][1] * P[1][0] + P[2][0], -K[2][0] * P[0][1] - K[2][1] * P[1][1] + P[2][1], P[2][2] - K[2][0] * P[0][2] - K[2][1] * P[1][2], P[2][3] - K[2][0] * P[0][3] - K[2][1] * P[1][3]],
            [-K[3][0] * P[0][0] - K[3][1] * P[1][0] + P[3][0], -K[3][0] * P[0][1] - K[3][1] * P[1][1] + P[3][1], P[3][2] - K[3][0] * P[0][2] - K[3][1] * P[1][2], P[3][3] - K[3][0] * P[0][3] - K[3][1] * P[1][3]]
        ];

        return { x: x_new, P: P_new };
    }

    /**
     * Apply Kalman filter to smooth a position estimate
     * @param {string} deviceId - Device identifier (mac_hashed)
     * @param {number} measuredLat - Measured latitude
     * @param {number} measuredLng - Measured longitude
     * @param {number} quality - Quality score (lower = better = trust more)
     * @returns {object} { lat, lng } smoothed position
     */
    function applyKalmanFilter(deviceId, measuredLat, measuredLng, quality) {
        // Convert GPS to local meters for filtering
        const refLat = measuredLat;
        const refLng = measuredLng;
        const measured = gpsToMeters(measuredLat, measuredLng, refLat, refLng);

        // Get or create Kalman state for this device
        let state = kalmanStates.get(deviceId);

        if (!state) {
            // First measurement - initialize
            state = createKalmanState(measured.x, measured.y);
            state.refLat = refLat;
            state.refLng = refLng;
            kalmanStates.set(deviceId, state);
            return { lat: measuredLat, lng: measuredLng };
        }

        // Convert measurement to same coordinate system as state
        const measInState = gpsToMeters(measuredLat, measuredLng, state.refLat, state.refLng);

        // Calculate time delta (normalized)
        const dt = KALMAN_CONFIG.dt;

        // Measurement noise based on quality (higher quality = lower noise)
        const measurementNoise = KALMAN_CONFIG.measurementNoise * (1 + quality / 10);

        // Predict step
        const predicted = kalmanPredict(state, dt);

        // Update step with measurement
        const updated = kalmanUpdate(predicted, measInState.x, measInState.y, measurementNoise);

        // Save updated state
        state.x = updated.x;
        state.P = updated.P;
        state.lastUpdate = Date.now();
        kalmanStates.set(deviceId, state);

        // Convert back to GPS
        const smoothed = metersToGps(updated.x[0], updated.x[1], state.refLat, state.refLng);

        return { lat: smoothed.lat, lng: smoothed.lng };
    }

    /**
     * Compute positions for all devices at a given timestamp
     * Now includes Kalman filtering for smooth tracking
     * 
     * IMPORTANT: Uses time window synchronization!
     * Sensor readings within TIME_WINDOW_MS (default 15s) are aggregated
     * to solve the async sensor reporting problem.
     * 
     * @param {string} timestamp - Target timestamp
     * @returns {array} Array of device position objects
     */
    function computeAllPositions(timestamp) {
        // Use time window aggregation to sync async sensor readings
        // This solves: Sensor A at 12:00:01, Sensor B at 12:00:10 -> treated as "now"
        const devices = DataHandler.getDevicesInTimeWindow(timestamp);
        const results = [];

        devices.forEach((observations, macHashed) => {
            const result = getCachedOrCompute(timestamp, macHashed, observations);

            if (result && !isNaN(result.lat) && !isNaN(result.lng)) {
                // Apply Kalman filter only if enabled
                let finalLat = result.lat;
                let finalLng = result.lng;
                let isSmoothed = false;

                if (kalmanEnabled) {
                    // Apply Kalman filter to smooth the position
                    // Use variance as the quality metric for the filter
                    const smoothed = applyKalmanFilter(
                        macHashed,
                        result.lat,
                        result.lng,
                        result.variance || 5  // Use variance, fallback to 5m if undefined
                    );

                    // Validate smoothed coordinates
                    if (!isNaN(smoothed.lat) && !isNaN(smoothed.lng)) {
                        finalLat = smoothed.lat;
                        finalLng = smoothed.lng;
                        isSmoothed = true;
                    }
                }

                results.push({
                    macHashed: macHashed,
                    ...result,
                    // Use final position (smoothed or raw)
                    lat: finalLat,
                    lng: finalLng,
                    // Keep raw position for reference
                    rawLat: result.lat,
                    rawLng: result.lng,
                    isSmoothed: isSmoothed
                });
            }
        });

        return results;
    }

    /**
     * Reset Kalman filter states (e.g., when loading new data)
     */
    function resetKalmanFilters() {
        kalmanStates.clear();
    }

    /**
     * Enable or disable Kalman filtering
     * @param {boolean} enabled - true to enable, false to disable
     */
    function setKalmanEnabled(enabled) {
        kalmanEnabled = enabled;
        console.log(`[Kalman] Filter ${enabled ? 'enabled' : 'disabled'}`);
        // Reset states when toggling to get fresh start
        if (enabled) {
            resetKalmanFilters();
        }
    }

    /**
     * Check if Kalman filter is enabled
     * @returns {boolean}
     */
    function isKalmanEnabled() {
        return kalmanEnabled;
    }

    // Public API
    return {
        trilaterate,
        computeAllPositions,
        clearCache,
        resetKalmanFilters,
        setKalmanEnabled,
        isKalmanEnabled,
        gpsToMeters,
        metersToGps,
        KALMAN_CONFIG
    };
})();
