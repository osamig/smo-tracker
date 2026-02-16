/**
 * ============================================================
 * Time Controls Module
 * ============================================================
 * Handles time-based navigation through sensor data,
 * including slider, playback, and animation.
 */

const TimeControls = (function () {
    // State
    let timestamps = [];
    let currentIndex = 0;
    let isPlaying = false;
    let playbackSpeed = 1;
    let animationFrameId = null;
    let lastFrameTime = 0;
    let updateCallback = null;

    // DOM Elements
    let slider = null;
    let timeDisplay = null;
    let indexDisplay = null;
    let playButton = null;
    let speedSelect = null;
    let timeSection = null;

    /**
     * Initialize time controls
     * @param {function} onUpdate - Callback when timestamp changes
     */
    function init(onUpdate) {
        updateCallback = onUpdate;

        // Get DOM elements
        slider = document.getElementById('time-slider');
        timeDisplay = document.getElementById('current-time');
        indexDisplay = document.getElementById('timestamp-index');
        playButton = document.getElementById('btn-play');
        speedSelect = document.getElementById('playback-speed');
        timeSection = document.getElementById('time-section');

        // Event listeners
        slider.addEventListener('input', handleSliderChange);
        playButton.addEventListener('click', togglePlayback);
        speedSelect.addEventListener('change', handleSpeedChange);

        document.getElementById('btn-prev').addEventListener('click', () => step(-1));
        document.getElementById('btn-next').addEventListener('click', () => step(1));
    }

    /**
     * Set timestamps from data
     * @param {array} ts - Array of timestamp strings
     */
    function setTimestamps(ts) {
        timestamps = ts;
        currentIndex = 0;

        if (timestamps.length > 0) {
            // Show time section
            timeSection.style.display = 'block';

            // Configure slider
            slider.min = 0;
            slider.max = timestamps.length - 1;
            slider.value = 0;

            // Update display
            updateDisplay();

            // Trigger initial callback
            if (updateCallback) {
                updateCallback(timestamps[currentIndex]);
            }
        } else {
            timeSection.style.display = 'none';
        }
    }

    /**
     * Handle slider input change
     */
    function handleSliderChange() {
        const newIndex = parseInt(slider.value, 10);
        if (newIndex !== currentIndex) {
            currentIndex = newIndex;
            updateDisplay();

            if (updateCallback) {
                updateCallback(timestamps[currentIndex]);
            }
        }
    }

    /**
     * Handle speed selection change
     */
    function handleSpeedChange() {
        playbackSpeed = parseFloat(speedSelect.value);
    }

    /**
     * Step forward or backward
     * @param {number} delta - +1 or -1
     */
    function step(delta) {
        const newIndex = currentIndex + delta;

        if (newIndex >= 0 && newIndex < timestamps.length) {
            currentIndex = newIndex;
            slider.value = currentIndex;
            updateDisplay();

            if (updateCallback) {
                updateCallback(timestamps[currentIndex]);
            }
        }
    }

    /**
     * Toggle playback on/off
     */
    function togglePlayback() {
        if (isPlaying) {
            pause();
        } else {
            play();
        }
    }

    /**
     * Start playback
     */
    function play() {
        if (timestamps.length === 0) return;

        isPlaying = true;
        playButton.textContent = '⏸';
        playButton.title = 'Pause';

        lastFrameTime = performance.now();
        animationFrameId = requestAnimationFrame(animationLoop);
    }

    /**
     * Pause playback
     */
    function pause() {
        isPlaying = false;
        playButton.textContent = '▶';
        playButton.title = 'Play';

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }

    /**
     * Animation loop for playback
     * @param {number} currentTime - Current timestamp from requestAnimationFrame
     */
    function animationLoop(currentTime) {
        if (!isPlaying) return;

        // Calculate time elapsed
        const elapsed = currentTime - lastFrameTime;

        // Base interval: 1 second between frames at 1x speed
        const interval = 1000 / playbackSpeed;

        if (elapsed >= interval) {
            lastFrameTime = currentTime;

            // Advance to next timestamp
            currentIndex++;

            if (currentIndex >= timestamps.length) {
                // Loop back to start
                currentIndex = 0;
            }

            slider.value = currentIndex;
            updateDisplay();

            if (updateCallback) {
                updateCallback(timestamps[currentIndex]);
            }
        }

        animationFrameId = requestAnimationFrame(animationLoop);
    }

    /**
     * Update the time display
     */
    function updateDisplay() {
        if (timestamps.length === 0) {
            timeDisplay.textContent = '--:--:--';
            indexDisplay.textContent = '0 / 0';
            return;
        }

        const timestamp = timestamps[currentIndex];

        // Parse and format timestamp
        try {
            const date = new Date(timestamp);
            const timeStr = date.toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            timeDisplay.textContent = timeStr;
        } catch (e) {
            // Fallback: show raw timestamp
            timeDisplay.textContent = timestamp.substring(11, 19);
        }

        indexDisplay.textContent = `${currentIndex + 1} / ${timestamps.length}`;
    }

    /**
     * Get current timestamp
     * @returns {string|null}
     */
    function getCurrentTimestamp() {
        if (timestamps.length === 0) return null;
        return timestamps[currentIndex];
    }

    /**
     * Get current index
     * @returns {number}
     */
    function getCurrentIndex() {
        return currentIndex;
    }

    /**
     * Set to specific timestamp
     * @param {string} timestamp - Target timestamp
     */
    function setTimestamp(timestamp) {
        const index = timestamps.indexOf(timestamp);
        if (index >= 0) {
            currentIndex = index;
            slider.value = currentIndex;
            updateDisplay();
        }
    }

    /**
     * Reset to initial state
     */
    function reset() {
        pause();
        timestamps = [];
        currentIndex = 0;
        timeSection.style.display = 'none';
        updateDisplay();
    }

    // Public API
    return {
        init,
        setTimestamps,
        getCurrentTimestamp,
        getCurrentIndex,
        setTimestamp,
        play,
        pause,
        step,
        reset
    };
})();
