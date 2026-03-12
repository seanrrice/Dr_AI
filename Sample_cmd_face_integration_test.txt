python .\integration\orchestrator\orchestrator.py --visit_id V001 --patient_id SeanTest --visit_label 2026-03-11

python .\emotion_pipeline\webcam_mediapipe_ORCHESTRATOR.py --visit_id V001 --patient_id SeanTest --visit_label 2026-03-11 --runs_dir runs

python .\integration\integrator\integrator.py --visit_dir .\runs\visit_V001