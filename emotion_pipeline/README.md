# 📘 Emotion Analysis Pipeline  
**(ResNet-34 / ResNet-18 + MediaPipe + Visit Logging)**

This directory contains the **facial emotion recognition subsystem** of the *Doctor AI* project.

The subsystem supports **multiple emotion-model pipelines**, real-time inference, structured visit logging, and longitudinal affect analysis.

---

# 📂 Project Structure (Current)

emotion_pipeline/
│
├── .venv311/ # Runtime environment (CPU / inference)
├── .venv_gpu/ # Training environment (GPU / CUDA)
│
├── analysis/
│ └── emotion_trend_analysis.ipynb
│
├── emotion_logs/ # Auto-generated visit emotion CSVs
│
├── master_dataset/ # Unified, curated dataset (non-FER2013)
│
├── matlockDatasetPipeline.ipynb # ResNet-34 training on master_dataset
├── fer2013_v2.ipynb # ResNet-18 training on FER-2013
│
├── webcam_emotion_mediapipe.py # Real-time inference + visit logging
├── emotion_logger.py # Patient-aware CSV logging utility
│
├── best_model.pth
├── confusion_matrix.png
├── training_history.png
│
├── requirements-train.txt
├── requirements-runtime.txt
└── README.md


---

# 🔧 Environment Setup

Two **separate virtual environments** are used to isolate training and runtime concerns.

> ⚠️ Virtual environments and Jupyter kernels are **path-dependent**.  
> If this directory is renamed or moved, reinstall Jupyter and re-register kernels.

---

## 🧠 Training Environment (GPU)

Used for **all model training and dataset pipelines**.

```powershell
python -m venv .venv_gpu
.\.venv_gpu\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-train.txt
(Optional) Register kernel:

python -m ipykernel install --user --name emotion_train --display-name "Python (emotion_train)"
🎥 Runtime Environment (Inference)
Used for webcam inference, logging, and analysis.

python -m venv .venv311
.\.venv311\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-runtime.txt
Register kernel:

python -m ipykernel install --user --name emotion_runtime --display-name "Python (emotion_runtime)"
Launch Jupyter safely:

python -m notebook
🧠 Model Training Pipelines
This repository contains two independent training pipelines, serving different experimental and deployment goals.

🔬 Pipeline 1 — Master Dataset + ResNet-34
matlockDatasetPipeline.ipynb

Primary research and deployment pipeline.

Uses a custom curated dataset:

master_dataset/
Trains a ResNet-34 backbone

Higher model capacity and generalization

Intended for final Doctor AI deployment models

Responsibilities:

Dataset preprocessing and splits

ResNet-34 model definition

Training and evaluation

Confusion matrix + metrics

Saving trained weights (best_model.pth)

🧪 Pipeline 2 — FER-2013 + ResNet-18
fer2013_v2.ipynb

Secondary / comparative pipeline.

Uses the FER-2013 dataset

Trains a ResNet-18 backbone

Lightweight and fast to train

Used for benchmarking, ablation studies, and reproducibility

Dataset location:

fer2013_dataset/
This pipeline is not deprecated and remains useful for controlled experiments.

🎥 Real-Time Emotion Detection
webcam_emotion_mediapipe.py

Performs real-time facial emotion recognition using:

MediaPipe face detection

A trained ResNet model (from either pipeline)

OpenCV webcam capture

Torch inference

Structured per-visit emotion logging

Run:

python webcam_emotion_mediapipe.py
The model path can be swapped to evaluate ResNet-18 vs ResNet-34.

🧾 Emotion Visit Logging
emotion_logger.py

Provides:

Automatic creation of emotion_logs/

Visit-level aggregation

Emotion counts and percentages

Patient and visit metadata

Example:

logger = EmotionVisitLogger(
    emotion_labels=['angry','disgust','fear','happy','sad'],
    metadata_fields=['patient_id', 'visit_label']
)

logger.log_visit(
    emotion_counts,
    total_samples,
    meta={"patient_id": pid, "visit_label": label}
)
📊 Longitudinal Trend Analysis
analysis/emotion_trend_analysis.ipynb

Supports:

End-of-visit summaries

Emotion percentage trajectories across visits

Dominant emotion analysis

Patient-level filtering

Chronological visit indexing

📌 Notebook assumes it is launched from the project root.

📦 Requirements Files
File	Purpose
requirements-train.txt	GPU training, PyTorch, torchvision, matplotlib
requirements-runtime.txt	MediaPipe, OpenCV, lightweight inference
🧼 Notes & Best Practices
.venv311/, .venv_gpu/, master_dataset/, and emotion_logs/ should be gitignored

Always launch Jupyter with:

python -m notebook
Two pipelines ≠ duplication — they serve different scientific purposes

Prefer relative paths anchored to project root


---

## ✅ Option 2: Create it from PowerShell (no editor needed)

From the repo root:
```powershell
notepad README.md
