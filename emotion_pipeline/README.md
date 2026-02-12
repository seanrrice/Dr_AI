# Emotion Analysis Pipeline
(ResNet-34 / ResNet-18 + MediaPipe + Visit Logging)

This directory contains the facial emotion recognition subsystem of the Doctor AI project.

The subsystem supports:
- Multiple emotion-model training pipelines
- Real-time webcam inference
- Structured visit-level emotion logging
- Longitudinal (serial) trend analysis

---

## Project Structure

emotion_pipeline/
│
├── .venv311/                 Runtime environment (CPU / inference)
├── .venv_gpu/                Training environment (GPU / CUDA)
│
├── analysis/
│   └── emotion_trend_analysis.ipynb
│
├── emotion_logs/              Auto-generated visit emotion CSVs
│
├── master_dataset/            Curated dataset for primary training
│
├── matlockDatasetPipeline.ipynb   ResNet-34 training on master_dataset
├── fer2013_v2.ipynb               ResNet-18 training on FER-2013
│
├── webcam_emotion_mediapipe.py    Real-time inference + visit logging
├── emotion_logger.py              Patient-aware logging utility
│
├── best_model.pth
├── confusion_matrix.png
├── training_history.png
│
├── requirements-train.txt
├── requirements-runtime.txt
└── README.md

---

## Environment Setup

Two separate virtual environments are used to isolate training and runtime concerns.

IMPORTANT:
Virtual environments and Jupyter kernels are path-dependent.
If this directory is renamed or moved, reinstall Jupyter and re-register kernels.

---

### Training Environment (GPU)

Used for all model training and dataset pipelines.

powershell:
python -m venv .venv_gpu
.\\.venv_gpu\\Scripts\\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-train.txt

Optional kernel registration:
python -m ipykernel install --user --name emotion_train --display-name "Python (emotion_train)"

---

### Runtime Environment (Inference)

Used for webcam inference, logging, and analysis.

powershell:
python -m venv .venv311
.\\.venv311\\Scripts\\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-runtime.txt

Register kernel:
python -m ipykernel install --user --name emotion_runtime --display-name "Python (emotion_runtime)"

Launch Jupyter safely:
python -m notebook

---

## Model Training Pipelines

This repository contains two independent training pipelines.

---

### Pipeline 1 — Master Dataset + ResNet-34

File:
matlockDatasetPipeline.ipynb

This is the primary research and deployment pipeline.

- Uses master_dataset/
- Trains a ResNet-34 backbone
- Higher model capacity and generalization
- Intended for Doctor AI deployment models

Responsibilities:
- Dataset preprocessing
- Train/validation/test splits
- Model training and evaluation
- Confusion matrix generation
- Saving trained weights (best_model.pth)

---

### Pipeline 2 — FER-2013 + ResNet-18

File:
fer2013_v2.ipynb

This is a secondary and comparative pipeline.

- Uses the FER-2013 dataset
- Trains a ResNet-18 backbone
- Lightweight and fast to train
- Used for benchmarking and ablation studies

Dataset location:
fer2013_dataset/

This pipeline is not deprecated.

---

## Real-Time Emotion Detection

File:
webcam_emotion_mediapipe.py

Performs real-time facial emotion recognition using:
- MediaPipe face detection
- Trained ResNet model (either pipeline)
- OpenCV webcam capture
- Torch inference
- Structured per-visit logging

Run:
python webcam_emotion_mediapipe.py

The model path can be swapped to compare ResNet-18 vs ResNet-34.

---

## Emotion Visit Logging

File:
emotion_logger.py

Provides:
- Automatic creation of emotion_logs/
- Visit-level aggregation
- Emotion counts and percentages
- Patient and visit metadata

---

## Longitudinal Trend Analysis

File:
analysis/emotion_trend_analysis.ipynb

Supports:
- End-of-visit summaries
- Emotion trajectories across visits
- Dominant emotion analysis
- Patient-level filtering
- Chronological visit indexing

NOTE:
Notebook should be launched from the project root so relative paths resolve correctly.

---

## Requirements Files

requirements-train.txt  
- GPU training
- PyTorch / torchvision
- Matplotlib and analysis tools

requirements-runtime.txt  
- MediaPipe
- OpenCV
- Lightweight inference dependencies

---

## Notes and Best Practices

- .venv311/, .venv_gpu/, master_dataset/, and emotion_logs/ should be gitignored
- Always launch Jupyter using: python -m notebook
- Two pipelines serve different scientific purposes
- Prefer relative paths anchored to project root
