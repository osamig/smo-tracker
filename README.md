# 📡 Multi-Sensor Bluetooth Device Tracking

Eine webbasierte Plattform zur Echtzeit-Verfolgung und Visualisierung von Bluetooth-Geräten mittels BLE-Sensoren (Raspberry Pi / ESP32), Trilateration und Kalman-Filterung.

**Modul:** Data Processing — WS 2025/26  
**Team BT Data Processing**

---

## 🚀 Features

- **Echtzeit-Tracking** über MQTT-Broker (Mosquitto / VCR)
- **Offline-Analyse** historischer Daten (JSON-Import mit Drag & Drop)
- **Trilateration** mit 1–N Sensoren und Qualitätsanzeige (🟢 High / 🟡 Medium / 🔴 Low)
- **Kalman-Filter** zur Glättung der Positionsschätzungen (ein-/ausschaltbar)
- **Interaktive Karte** (Leaflet.js) mit Dark/Light Theme
- **Zonen-Management** — Geofencing mit Device-Counting (GeoJSON Import/Export)
- **Heatmap-Overlay** zur Dichteanalyse
- **Zeitnavigation** — Playback historischer Daten mit variabler Geschwindigkeit
- **GPS-Speicherung** — Sensorkoordinaten persistent im LocalStorage

---

## 📋 Voraussetzungen

- **Node.js** (v16 oder höher) — nur für den MQTT-Proxy-Server benötigt
- **Moderner Browser** (Chrome, Firefox, Edge)
- Internetzugang (für Kartenkacheln von OpenStreetMap/CartoDB)

---

## ⚡ Schnellstart

### 1. Repository klonen

```bash
git clone https://github.com/osamig/smo-tracker.git
cd smo-tracker
```

### 2. MQTT-Proxy-Server installieren & starten

Der Proxy-Server wird nur benötigt, wenn Echtzeit-Daten über den Mosquitto-Broker empfangen werden sollen.

```bash
cd mqtt-proxy
npm install
npm start
```

Der Server startet unter `ws://localhost:3001` und verbindet sich automatisch mit dem MQTT-Broker (`mqtt://139.6.19.20:1883`).

### 3. Webanwendung öffnen

Öffne die Datei `index.html` direkt im Browser:

```
# Unter Windows:
start index.html

# Oder einfach die Datei per Doppelklick öffnen
```

> **Hinweis:** Es wird kein lokaler Webserver benötigt — die Anwendung läuft komplett im Browser.

---

## 📖 Nutzung

### Modus 1: Offline-Analyse (JSON-Upload)

1. Öffne `index.html` im Browser
2. Lade eine JSON-Datei per **Drag & Drop** oder über den **Datei-Dialog** hoch
3. Falls die Sensoren keine GPS-Koordinaten enthalten, wirst du aufgefordert, diese einzugeben
4. Nutze die **Zeitsteuerung** (Slider, Play/Pause), um durch die Daten zu navigieren

### Modus 2: Echtzeit-Tracking (MQTT)

1. Starte den **MQTT-Proxy-Server** (siehe Schnellstart Schritt 2)
2. Öffne `index.html` im Browser
3. Klicke im Panel auf **„Connect (VCR Proxy)"** oder **„Connect (Direct)"**
4. Eingehende Sensordaten werden automatisch auf der Karte visualisiert

---

## 🧪 Testdaten

Im Ordner `test files/` befinden sich Testdaten vom letzten Test mit den Raspberry Pis an der TH Köln:

| Datei | Beschreibung |
|---|---|
| `sensor_gps_coordinates (1).json` | GPS-Koordinaten der 6 Raspberry-Pi-Sensoren (thkoeln-piz2w-1 bis -8) am Campus |
| `converted-1769824729316.json` | Aufgezeichnete Sensordaten (Distanzmessungen, MAC-Adressen) vom Live-Test |

### Testdaten laden

1. Öffne `index.html`
2. Ziehe die Datei `converted-1769824729316.json` per Drag & Drop auf die Karte
3. Die GPS-Koordinaten der Sensoren werden automatisch aus dem LocalStorage geladen, falls vorhanden — andernfalls importiere `sensor_gps_coordinates (1).json` über die GPS-Verwaltung

---

## 📁 Projektstruktur

```
smo-tracker/
├── index.html                  # Hauptseite der Webanwendung
├── css/
│   └── styles.css              # Styling (Dark/Light Theme, responsive)
├── js/
│   ├── app.js                  # Hauptmodul — Orchestrierung aller Module
│   ├── dataHandler.js          # Datenvalidierung & Multi-Format-Parsing
│   ├── lateration.js           # Trilateration & Kalman-Filter
│   ├── mqttHandler.js          # MQTT-Verbindung (WebSocket & Proxy)
│   ├── mapLayers.js            # Leaflet-Kartenvisualisierung
│   ├── timeControls.js         # Zeitnavigation & Playback
│   ├── zoneManager.js          # Geofencing & Zonenanalyse
│   ├── gpsStorage.js           # GPS-Koordinaten (LocalStorage)
│   └── uiController.js         # UI-Interaktionen & Theme-Switching
├── mqtt-proxy/
│   ├── server.js               # MQTT → WebSocket Proxy-Server (Node.js)
│   └── package.json            # Node.js-Abhängigkeiten
├── test files/
│   ├── sensor_gps_coordinates (1).json   # GPS der Raspberry-Pi-Sensoren
│   └── converted-1769824729316.json      # Aufgezeichnete Sensordaten
├── projektbericht.md           # Ausführlicher Projektbericht
└── README.md                   # Diese Datei
```

---

## 🛠 Technologie-Stack

| Technologie | Zweck |
|---|---|
| **JavaScript (ES6+)** | Anwendungslogik (Vanilla JS, IIFE Module Pattern) |
| **Leaflet.js** | Interaktive Kartenvisualisierung |
| **Paho MQTT** | WebSocket-basierter MQTT-Client im Browser |
| **Node.js + Express** | MQTT-Proxy-Server (TCP → WebSocket Bridge) |
| **MQTT (Mosquitto)** | IoT-Nachrichtenprotokoll |
| **HTML5 / CSS3** | Responsive UI mit Dark/Light Theme |

---

## 👥 Team

| Teammitglied | Schwerpunkt |
|---|---|
| Omar Samig | Technische Leitung, Lateration & Kalman-Filter, App-Architektur |
| Bilal Al Chami | MQTT-Integration, Proxy-Server, Echtzeit-Datenverarbeitung |
| Soufian El Berkani | Datenformate & Parsing, DataHandler-Modul, JSON-Validierung |
| Abdulkarim Darwish | Kartenvisualisierung, MapLayers, Heatmap, UI/UX-Design |
| Ziad Belhaou | Zonen-Management, GeoJSON Import/Export, GPS-Speicherung |
| Cyntia Pola | Zeitsteuerung, Playback-System, Testing & Dokumentation |
