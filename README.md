<div align="center">
  <img width="150" height="150" alt="Pinpointerfinallogo" src="https://github.com/user-attachments/assets/ae29e1af-6a19-4ac9-9a2e-f235f9febb9b" />


  # PinPointer
  
  **A Privacy-First, Offline Search Engine & Intelligent Media Organizer**<br>
  <sub>Maintained by <strong>Northern Blades</strong></sub>
  
  
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
  ![React Native](https://img.shields.io/badge/React%20Native-61DAFB?style=for-the-badge&logo=react&logoColor=black)
  ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
  ![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)
  
</div>

---

## 🎯 Core Vision

PinPointer is a **high-performance, Local-First Knowledge Graph** natively developed for Android using React Native. It transforms how users interact with their personal media by enabling intelligent, privacy-preserving search and retrieval of text trapped in screenshots, images, and PDFs—all without compromising privacy or relying on costly, latency-heavy cloud APIs.

---

## 🔴 The Problem It Solves: "Dark Data"

### The Challenge
Millions of sensitive documents live in your device's storage as "Dark Data"—text imprisoned inside:
- 📸 **Screenshots** of important information
- 🖼️ **Images** containing handwritten notes, receipts, IDs
- 📄 **PDFs** (both digital and scanned documents)

Users can't search this data. Finding a specific invoice, medical prescription, or identification document means **manually scrolling through thousands of files**.

### Why Existing Solutions Fail
- ☁️ **Cloud-Based APIs** = Privacy nightmare. Your sensitive documents (PAN cards, Aadhaar, medical records) uploaded to third-party servers
- 🔋 **Offline ML Models** = Battery drain. Running heavy AI on every image consumes massive processing power
- 💰 **Premium Services** = Expensive and latency-heavy with recurring costs
- ❌ **No Multilingual Support** = English-only solutions ignore Indian users with Hindi/local language documents

### ✨ How PinPointer Solves It

**Internet-Zero Architecture**: Everything runs locally on your device. Your data never leaves your phone.

**Battery-Efficient Intelligence**: Sequential, early-exit optimization bypasses unnecessary ML models to maximize battery life.

**True Multilingual Search**: English, Hindi, and regional language document support out-of-the-box.

**Instant Document Retrieval**: Type what you're looking for and get results in milliseconds—no cloud latency, no API fees.

**Military-Grade Privacy**: Sensitive data (Aadhaar, PAN, medical info) is automatically masked in the search index itself.

---

## 🏗️ Technical Architecture: "Internet-Zero" Design

### 🧠 **Intelligent Vision Pipeline** (`VisionPipeline.ts`)

Maximizes battery efficiency through sequential, early-exit optimization:


**Why This Matters**: By detecting text first and halting immediately, PinPointer avoids running resource-heavy Object Detection on 90% of images.

---

### 📚 **Smart Document Vault** (`DocumentPipeline.ts`)

A sophisticated 5-phase hybrid parser engineered for PDF mastery:

| Phase | What It Does | Performance |
|-------|-------------|-------------|
| **1. Native Byte-Stream Extraction** | Uses custom Android module to pull embedded text directly | ~50ms per page |
| **2. Digital Text Check** | Detects if PDF has embedded text; extracts instantly | ✅ No AI needed |
| **3. AI-Driven Rasterization** | For scanned documents, converts pages to JPEGs for OCR | Fallback only |
| **4. On-Device Enrichment** | Local NLP classifies document type ("Electricity Bill", "Flight Ticket") & generates "Smart Titles" | Zero-cost NLP |
| **5. Security Masking** | `DataMasking.ts` scrubs PII (Aadhaar: `XXXX-XXXX-1234`, PAN: `XXXX-XXXX-5678`) | Secure at rest |

---

### ⚡ **High-Performance Hybrid Search** (`Database.ts`)

Lightning-fast, fully offline search engine:


**Result**: Queries return in **<100ms** on a dataset of 50,000+ documents.

---

### 🎙️ **Voice Intelligence**

- 🗣️ **Speech-to-Text**: Local on-device transcription (no internet required)
- 🔊 **Text-to-Speech**: Read search results aloud
- 🧠 Powered by RunAnywhere SDK with ONNX models
- ✅ Fully offline, hands-free search

---

## 🔐 Privacy & Security Guarantees

| Feature | How It Works |
|---------|-------------|
| **Zero Cloud Upload** | 100% local processing—data never leaves your device |
| **PII Masking** | Sensitive info masked in the index itself (`XXXX-XXXX-1234`) |
| **Encrypted Local Storage** | All data stored securely on device |
| **No Tracking** | Zero telemetry, analytics, or user profiling |
| **Verifiable Privacy** | 100% on-device architecture with zero data exposure |

---

## 🚀 Key Features

✅ **Instant Full-Text Search** across images, screenshots, and PDFs  
✅ **Multilingual OCR** (English + Hindi + Regional Languages)  
✅ **Voice Search & Voice Results** — hands-free interaction  
✅ **Automatic Document Classification** — "Invoice", "ID Proof", "Receipt"  
✅ **Smart Phonetic Matching** — typo-tolerant search  
✅ **Battery-Optimized** — sequential early-exit ML pipeline  
✅ **Zero Cloud Dependency** — works offline, always  
✅ **Lightning-Fast** — <100ms search on 50K+ documents  

---

## 💻 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React Native, TypeScript, JavaScript |
| **Backend** | Native Android Modules (Kotlin, Java) |
| **Database** | SQLite + FTS5 |
| **ML/AI** | Google ML Kit, ONNX Models (RunAnywhere SDK) |
| **OCR** | ML Kit Latin + Devanagari |
| **Search** | Full-Text Search (FTS5) + Soundex Phonetics |
| **Speech** | On-device STT/TTS via RunAnywhere |

---

## 📦 Installation

### Prerequisites
- Node.js 16+ installed
- React Native CLI installed globally
- Android SDK configured
- Java 11+ installed

### Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ScRocXx/react-native-starter-app.git
   cd react-native-starter-app

2. **Install dependencies:**
    ```bash
    npm install
    
3. **Run the app:**
    ```bash
    npx react-native run-android

4. **Run on iOS:**
    ```bash
    npx react-native run-ios

--- 

## 🛠️ Development

### Project Structure

src/<br>
├── components/        # React components<br>
├── screens/          # Screen components<br>
├── services/<br>
│   ├── VisionPipeline.ts      # ML vision processing<br>
│   ├── DocumentPipeline.ts    # PDF processing<br>
│   ├── Database.ts            # SQLite search engine <br>
│   └── DataMasking.ts         # PII protection<br>
├── native/           # Native Android modules<br>
│   ├── NativePdfModule.kt     # PDF rasterization<br>
│   └── VisionModule.kt        # Vision API wrapper<br>
└── utils/            # Helper utilities<br>

---
## Running in Development 

npm start                    # Start Metro bundler<br>
react-native run-android    # In another terminal

## 📊 Performance Metrics
| Operation | Time |
|--|--|
|Image OCR (1024px)|~150-200ms|
|PDF Native Text Extraction|~50ms per page|
|PDF Rasterization + OCR|~500-800ms per page|
|Full-Text Search (50K docs)|<100ms|
|Voice Search Transcription|Real-time|

## 🛠 Core Contributors & Architecture

This project was ideated, architected, and engineered from the ground up by the following core developers. The complex logic for the privacy-first, on-device AI search and indexing system is the exclusive intellectual property of this team:

* **Sawant** – Product Design, UI/UX Architecture, Interaction Design, User Experience Strategy
* **Nishant** – Backend Architecture, On-Device AI Pipeline, ML/OCR Integration
* **Prem** – Frontend Engineering, React Native Implementation, System Integration

---

## ⚖️ Copyright & Proprietary Notice

**© 2026 Northern Blades / ScRocXx. All Rights Reserved.**

**PROPRIETARY & CONFIDENTIAL — NOT OPEN SOURCE**

This repository and its entire codebase are strictly proprietary and confidential. No license (open-source or otherwise) is granted to any individual or entity.

Unauthorized copying, reproduction, distribution, modification, reverse engineering, creating derivative works, or commercial exploitation of any part of this software, via any medium, is strictly prohibited without prior explicit written permission from the copyright owners.

---
<div align="center"> <p> <strong>Built with ❤️ for Privacy-First, Offline-First Android Development</strong> </p> <p> ⭐ If you find this helpful, please star the repository! </p> </div> 

---
