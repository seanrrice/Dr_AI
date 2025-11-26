

\# 📘 Emotion Analysis Pipeline (ResNet-18 + Mediapipe)



This folder contains the \*\*facial emotion recognition subsystem\*\* of the Doctor AI project.  

It includes tools for training a deep learning model on the FER-2013 dataset and running a \*\*real-time webcam emotion classifier\*\* using Mediapipe.



This subsystem is developed as part of the \*current team’s broader Doctor AI system\*, which also includes frontend components and sentiment analysis modules located elsewhere in the repository.



---



\## 📂 Contents



```



emotion\_pipeline/

│

├── fer2013\_v2.ipynb              # Jupyter notebook for training, evaluation, and analysis

├── webcam\_emotion\_mediapipe.py   # Real-time webcam emotion classifier

├── requirements.txt              # Python dependencies for this subsystem

└── (model weights not included in repo)



````



---



\## 🔧 Environment Setup



\### 1. Create a virtual environment



```powershell

python -m venv .venv

````



\### Activate it:



```powershell

.venv\\Scripts\\Activate.ps1

```



---



\### 2. Install Dependencies



```powershell

pip install -r requirements.txt

```



Python version recommended: \*\*3.11 – 3.12\*\*

(PyTorch wheels may not yet support Python \*\*3.13+\*\*)



---



\## 🧠 FER-2013 Training Notebook (`fer2013\_v2.ipynb`)



The notebook includes:



\* Data loading and preprocessing for FER-2013

\* ResNet-18 model setup

\* Training and validation loop

\* Accuracy/Loss curves

\* Confusion matrix visualization

\* Saving best-performing checkpoints



\### Dataset not included



The FER-2013 dataset cannot be committed to this repository due to size and licensing constraints.



Place the dataset under:



```

emotion\_pipeline/data/fer2013/

```



> ⚠️ \*\*Note:\*\* You will likely need to update dataset paths inside the notebook.



---



\## 🎥 Real-Time Emotion Detection (`webcam\_emotion\_mediapipe.py`)



This script uses:



\* Mediapipe Face Mesh for face detection \& alignment

\* A trained ResNet-18 emotion classifier

\* OpenCV for webcam access



\### Running the script:



```powershell

python webcam\_emotion\_mediapipe.py

```



The webcam window will display:



\* Real-time video

\* Detected facial emotion label

\* Optional confidence or smoothing



---



\## 💾 Model Weights



Model checkpoints (`.pth` files) are \*\*ignored by `.gitignore`\*\* and not stored in the repo.



Place your model file here:



```

emotion\_pipeline/model\_weights/best\_model.pth

```



Then update the script’s model-loading path accordingly.



---



```



---



\# 🔥 Notes



✔ All markdown fences fixed  

✔ Code blocks render correctly  

✔ Directory tree renders properly  

✔ PowerShell syntax is correct  

✔ Subsystem description is precise  

✔ No stray characters, no broken formatting  

✔ Looks professional on GitHub



---



If you want, I can also help:



\- Add a \*\*top-level README\*\* for the whole project  

\- Add a \*\*model\_weights/README.md\*\*  

\- Create a visual architecture diagram for the Doctor AI system  

\- Link this pipeline into your team’s documentation



Just tell me!

```



