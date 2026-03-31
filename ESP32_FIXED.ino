#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <MPU6050.h>
#include <TinyGPS++.h>
#include <HardwareSerial.h>

// -------- WIFI --------
const char* ssid = "Google_Pixel_9a";
const char* password = "youisgay";

// -------- MQTT --------
const char* mqtt_server = "broker.hivemq.com";
const char* mqtt_topic = "city/potholes/reported";  // ✅ CORRECT TOPIC
WiFiClient espClient;
PubSubClient client(espClient);

// -------- SENSORS --------
MPU6050 mpu;
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// Pins
#define TRIG 5
#define ECHO 18

#define LED_NORMAL 25
#define LED_LOW 26
#define LED_MEDIUM 27
#define LED_HIGH 14

float baseline = 2.5;   // 🔥 IMPORTANT: calibrate this
unsigned long lastSend = 0;
int device_id = 1;      // ✅ Device ID (1, 2, 3, etc.)

// -------- DISTANCE --------
float getDistance() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);

  long duration = pulseIn(ECHO, HIGH, 30000);
  float distance = duration * 0.034 / 2;
  return distance;
}

// -------- WIFI --------
void setupWiFi() {
  Serial.print("Connecting WiFi...");
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println("\nWiFi Connected!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

// -------- MQTT --------
void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("Connecting MQTT...");

    String clientId = "ESP32_" + String(random(0xffff), HEX);

    if (client.connect(clientId.c_str())) {
      Serial.println("✅ MQTT Connected!");
    } else {
      Serial.print("❌ Failed (rc=");
      Serial.print(client.state());
      Serial.println(") retrying in 5s...");
      delay(5000);
    }
  }
}

// -------- SETUP --------
void setup() {
  Serial.begin(115200);

  Wire.begin();
  mpu.initialize();

  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);

  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);

  pinMode(LED_NORMAL, OUTPUT);
  pinMode(LED_LOW, OUTPUT);
  pinMode(LED_MEDIUM, OUTPUT);
  pinMode(LED_HIGH, OUTPUT);

  setupWiFi();
  client.setServer(mqtt_server, 1883);

  Serial.println("✅ SYSTEM READY");
}

// -------- LOOP --------
void loop() {

  if (!client.connected()) reconnectMQTT();
  client.loop();

  float distance = getDistance();
  float depth = distance - baseline;

  // MPU
  int16_t ax, ay, az;
  mpu.getAcceleration(&ax, &ay, &az);
  float zAcc = az / 16384.0;
  bool vibration = abs(zAcc) > 1.3;

  // GPS
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }

  // Reset LEDs
  digitalWrite(LED_NORMAL, LOW);
  digitalWrite(LED_LOW, LOW);
  digitalWrite(LED_MEDIUM, LOW);
  digitalWrite(LED_HIGH, LOW);

  Serial.println("\n----------------------");
  Serial.print("Distance: "); Serial.print(distance);
  Serial.print(" | Depth: "); Serial.println(depth);

  // -------- NORMAL --------
  if (depth < 3) {
    Serial.println("✅ NORMAL ROAD");
    digitalWrite(LED_NORMAL, HIGH);
  }

  // -------- POTHOLE DETECTED --------
  else {

    int severity_number;  // ✅ Use NUMBER instead of string
    String severity_label;

    if (depth < 8) {
      severity_number = 1;
      severity_label = "LOW";
      digitalWrite(LED_LOW, HIGH);
    }
    else if (depth < 15) {
      severity_number = 2;
      severity_label = "MEDIUM";
      digitalWrite(LED_MEDIUM, HIGH);
    }
    else {
      severity_number = 3;
      severity_label = "HIGH";
      digitalWrite(LED_HIGH, HIGH);
    }

    Serial.print("⚠️  POTHOLE DETECTED → Level ");
    Serial.println(severity_number);
    Serial.print("    (");
    Serial.print(severity_label);
    Serial.println(")");

    if (vibration) {
      Serial.println("    ✔ Confirmed by MPU6050");
    } else {
      Serial.println("    ⚠ Detected (no strong vibration)");
    }

    // -------- MQTT SEND --------
    if (millis() - lastSend > 5000) {

      StaticJsonDocument<200> doc;

      // Get GPS data
      if (gps.location.isValid()) {
        doc["latitude"] = gps.location.lat();
        doc["longitude"] = gps.location.lng();
        Serial.print("📍 GPS: ");
        Serial.print(gps.location.lat(), 6);
        Serial.print(", ");
        Serial.println(gps.location.lng(), 6);
      } else {
        // Default to Pune center if no GPS
        doc["latitude"] = 18.5236;
        doc["longitude"] = 73.8338;
        Serial.println("📍 GPS waiting... using default location");
      }

      // ✅ FIXED: Send as NUMBERS not strings
      doc["severity"] = severity_number;      // 1, 2, or 3
      doc["status"] = "reported";
      doc["reported_id"] = device_id;         // 1, 2, 3, etc.

      char buffer[256];
      serializeJson(doc, buffer);

      // ✅ FIXED: Publish to CORRECT topic
      if (client.publish(mqtt_topic, buffer)) {
        Serial.print("📤 Published: ");
        Serial.println(buffer);
      } else {
        Serial.println("❌ Failed to publish!");
      }

      lastSend = millis();
    }
  }

  delay(200);
}
