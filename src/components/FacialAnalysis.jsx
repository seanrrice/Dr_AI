import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity } from "lucide-react";

const FACIAL_BASE = "http://localhost:5002";

export default function FacialAnalysis({ visitId, patientId }) {
  const [isRunning, setIsRunning] = useState(false);
  const [emotion, setEmotion] = useState("Idle");
  const [counts, setCounts] = useState({});
  const [streamKey, setStreamKey] = useState(Date.now());

  const streamUrl = useMemo(
    () => `${FACIAL_BASE}/api/facial/live?t=${streamKey}`,
    [streamKey]
  );

  useEffect(() => {
    const poll = async () => {
      try {
        const [statusRes, emotionRes, historyRes] = await Promise.all([
          fetch(`${FACIAL_BASE}/api/facial/status`),
          fetch(`${FACIAL_BASE}/api/facial/emotion`),
          fetch(`${FACIAL_BASE}/api/facial/history`)
        ]);

        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setIsRunning(!!statusData.running);
        }

        if (emotionRes.ok) {
          const emotionData = await emotionRes.json();
          setEmotion(emotionData.emotion || "Idle");
        }

        if (historyRes.ok) {
          const historyData = await historyRes.json();
          setCounts(historyData.counts || {});
        }
      } catch (err) {
        console.error("Facial polling failed:", err);
        setIsRunning(false);
      }
    };

    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, []);

  const handleStart = async () => {
    if (!visitId || !patientId) {
      alert("Please select a patient first.");
      return;
    }

    try {
      const res = await fetch(`${FACIAL_BASE}/api/facial/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visit_id: visitId,
          patient_id: patientId
        })
      });

      const data = await res.json();
      console.log("Facial start:", data);

      if (data.status === "started" || data.status === "already running") {
        setIsRunning(true);
        setStreamKey(Date.now());
      }
    } catch (err) {
      console.error("Failed to start facial analysis:", err);
    }
  };

  const handleStop = async () => {
    try {
      const res = await fetch(`${FACIAL_BASE}/api/facial/stop`, {
        method: "POST"
      });

      const data = await res.json();
      console.log("Facial stop:", data);

      setIsRunning(false);
      setEmotion("Stopped");
      setStreamKey(Date.now());

      if (visitId) {
        await fetch(`http://localhost:5000/api/visits/${visitId}/integrate`, {
          method: "POST"
        });
      }
    } catch (err) {
      console.error("Failed to stop facial analysis:", err);
    }
  };

  return (
    <Card className="border-teal-200 bg-white/80 backdrop-blur">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <Activity className="w-4 h-4" />
            Facial Analysis
          </CardTitle>

          <div className="flex gap-2">
            {!isRunning ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStart}
                className="border-teal-200"
              >
                Start Facial
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleStop}
              >
                Stop Facial
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div
          className="relative bg-black rounded overflow-hidden"
          style={{ aspectRatio: "4/3" }}
        >
          {isRunning ? (
            <img
              src={streamUrl}
              alt="Facial live stream"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm text-white/80">
              Facial camera is idle
            </div>
          )}
        </div>

        <div className="text-xs text-slate-700 bg-slate-50 rounded p-3 space-y-1">
          <div><strong>Status:</strong> {isRunning ? "Running" : "Idle"}</div>
          <div><strong>Current emotion:</strong> {emotion}</div>
          <div>
            <strong>History:</strong>{" "}
            {Object.keys(counts).length === 0
              ? "No data yet"
              : Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ")
            }
          </div>
        </div>
      </CardContent>
    </Card>
  );
}