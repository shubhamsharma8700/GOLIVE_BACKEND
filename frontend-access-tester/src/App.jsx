import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import EventViewer from "./pages/EventViewer.jsx";

function App() {
  return (
    <Routes>
      <Route path="/viewer/:eventId" element={<EventViewer />} />
      <Route path="/" element={<Navigate to="/viewer/example-event-id" replace />} />
      <Route path="*" element={<div style={{ padding: 16 }}>Not found</div>} />
    </Routes>
  );
}

export default App;
