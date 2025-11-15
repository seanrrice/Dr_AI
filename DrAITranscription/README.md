# create env, activate, install minimal deps
python -m venv venv_min
.\venv_min\Scripts\Activate.ps1
python -m pip install -U pip setuptools wheel
pip install -r requirements.txt

# run
python AudioTranscribe.py