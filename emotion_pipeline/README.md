# 📘 Emotion Analysis Pipeline (ResNet-18 + Mediapipe + Visit Logging)

This folder contains the **facial emotion recognition subsystem** of the Doctor AI project.
It includes:

* A training workflow for FER-2013
* A **real-time Mediapipe + ResNet-18 webcam classifier**
* A **patient-aware emotion logging system**
* **Serial trend analysis + visualization tools** (Jupyter notebooks & CLI scripts)

This subsystem is part of the *Doctor AI* system, which also includes frontend components, audio NLP modules, and multimodal clinical integration.

---

# 📂 Contents

```
emotion_pipeline/
│
├── fer2013_v2.ipynb                # Training, evaluation, and model export
├── webcam_emotion_mediapipe.py     # Real-time webcam classifier + visit logging
├── emotion_logger.py               # Reusable patient-aware CSV logging utility
├── analysis/
│   ├── emotion_trend_analysis.ipynb  # Visualization + serial trend notebook
│   └── analyze_emotions.py           # (optional) CLI-based trend analysis tool
│
├── emotion_logs/                   # Auto-generated per-visit emotion histories
├── model_weights/                  # (ignored) store best_model.pth here
└── requirements.txt                # Python dependencies
```

---

# 🔧 Environment Setup

### 1. Create and activate a virtual environment

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

### 2. Install dependencies

```powershell
pip install -r requirements.txt
```

Python recommended: **3.11–3.12**
(PyTorch wheels may not yet support Python **3.13+**)

---

# 🧠 FER-2013 Training Notebook (`fer2013_v2.ipynb`)

The notebook covers:

* FER-2013 dataset loading
* Torch `Dataset` / transforms
* ResNet-18 model construction
* Training loop, validation loop
* Accuracy/loss curves
* Confusion matrix visualization
* Saving `best_model.pth` (weights only)

Place FER-2013 under:

```
emotion_pipeline/data/fer2013/
```

(You may need to update the notebook paths.)

---

# 🎥 Real-Time Emotion Detection

`webcam_emotion_mediapipe.py`

This script performs **real-time emotion recognition** using:

* **Mediapipe Face Detection**
* A trained **ResNet-18 emotion classifier**
* **OpenCV** for webcam access
* **Torch inference**
* **EmotionVisitLogger** for per-visit logging

### Running:

```powershell
python webcam_emotion_mediapipe.py
```

### Features:

✔ Real-time face detection
✔ ResNet-18 classification
✔ Smoothed predictions (optional)
✔ Logs emotion counts & percentages
✔ **Patient ID input at start of visit**
✔ Generates a row in:

```
emotion_logs/visit_emotions.csv
```

### CSV Includes:

* patient_id
* visit_label
* visit_id (auto-generated)
* timestamp
* total_samples logged
* angry_count, disgust_count, …
* angry_pct, disgust_pct, …

Perfect for **serial trend analysis**.

---

# 🧾 Visit Logging

`emotion_logger.py`

This class provides:

✔ Automatic creation of `emotion_logs/`
✔ Automatic header creation
✔ Logging per-visit counts & percentages
✔ Metadata fields (e.g., patient_id, visit_label)
✔ Easily extendable for future doctor-facing metrics

Example usage (inside webcam script):

```python
logger = EmotionVisitLogger(
    emotion_labels=['angry','disgust','fear','happy','sad','surprise','neutral'],
    metadata_fields=['patient_id', 'visit_label']
)
logger.log_visit(emotion_counts, total_samples, meta={"patient_id": id, "visit_label": label})
```

---

# 📊 Serial Trend Analysis

`analysis/emotion_trend_analysis.ipynb`

This Jupyter notebook allows clinicians & researchers to visualize:

## End-of-Visit Report

* Pie chart (emotion percentage distribution)
* Bar chart (emotion intensity comparison)
* Count and percentage tables

## Longitudinal (Serial) Trend Analysis

* Emotion percent trajectories across visits
* Dominant emotion per visit
* Visit numbering (chronologically)
* Patient filtering
* Data exploration via Pandas

Ideal for evaluating changes in affect across multiple clinical encounters.

---

# 🔍 Optional CLI Tool

`analysis/analyze_emotions.py` *(optional)*

A command-line interface for quick analysis:

```powershell
python analyze_emotions.py --patient Tony --show
python analyze_emotions.py --patient Tony --export-pdf
```

Enables batch analysis, automated reporting, or backend integration.

---

# 💾 Model Weights

Model weights (`best_model.pth`) are **not stored in the repo**.

Place your trained model here:

```
emotion_pipeline/model_weights/best_model.pth
```

Update the path in `webcam_emotion_mediapipe.py` accordingly.

