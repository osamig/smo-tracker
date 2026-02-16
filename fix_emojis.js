// Fix emoji encoding in JavaScript files
const fs = require('fs');
const path = require('path');

const jsDir = 'c:/Users/omar samig/Downloads/smo V2/smo V2/tracker/js';
const files = ['dataHandler.js', 'mqttHandler.js', 'uiController.js', 'zoneManager.js', 'mapLayers.js', 'timeControls.js'];

// Common emoji replacements (both proper UTF-8 and garbled versions)
const replacements = [
    // Garbled UTF-8 sequences
    [/ðŸ›°ï¸/g, '[App]'],
    [/ðŸ"¡/g, '[MQTT]'],
    [/ðŸ"/g, '[GPS]'],
    [/ðŸ"¦/g, '[Data]'],
    [/âœ…/g, '[OK]'],
    [/ðŸ'¾/g, '[Save]'],
    [/ðŸ—'ï¸/g, '[Clear]'],
    [/ðŸ"§/g, '[Config]'],
    [/ðŸ"Š/g, '[Data]'],
    [/ðŸ°/g, '[VCR]'],
    [/ðŸ"Œ/g, '[Conn]'],
    [/â³/g, ''],
    [/âš ï¸/g, '[Warning]'],
    [/â±ï¸/g, '[Time]'],
    // Common emojis in proper form
    [/🛰️/g, '[App]'],
    [/📡/g, '[MQTT]'],
    [/📍/g, '[GPS]'],
    [/📦/g, '[Data]'],
    [/✅/g, '[OK]'],
    [/💾/g, '[Save]'],
    [/🗑️/g, '[Clear]'],
    [/🔧/g, '[Config]'],
    [/📊/g, '[Data]'],
    [/🏰/g, '[VCR]'],
    [/🔌/g, '[Conn]'],
    [/⏳/g, ''],
    [/⚠️/g, '[Warning]'],
    [/⏱️/g, '[Time]'],
];

files.forEach(file => {
    const filePath = path.join(jsDir, file);
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        let modified = false;

        replacements.forEach(([pattern, replacement]) => {
            if (pattern.test(content)) {
                content = content.replace(pattern, replacement);
                modified = true;
            }
        });

        if (modified) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('Fixed:', file);
        } else {
            console.log('No changes:', file);
        }
    } else {
        console.log('Not found:', file);
    }
});

console.log('Done!');
