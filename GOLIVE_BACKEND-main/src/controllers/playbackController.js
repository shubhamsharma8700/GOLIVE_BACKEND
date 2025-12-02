import { dynamoDB } from "../config/awsClients.js";

const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || "go-live-poc-events";

class PlaybackController {
  static async getStream(req, res) {
    try {
      const { eventId } = req.params;
      const viewer = req.viewer;

      if (!eventId) {
        return res.status(400).json({ success: false, message: "Missing eventId" });
      }

      if (!viewer) {
        return res.status(401).json({ success: false, message: "Unauthenticated viewer" });
      }

      if (viewer.eventId !== eventId) {
        return res.status(403).json({ success: false, message: "Viewer not authorized for this event" });
      }

      const eventResult = await dynamoDB.get({ TableName: EVENTS_TABLE, Key: { eventId } }).promise();
      if (!eventResult.Item) {
        return res.status(404).json({ success: false, message: "Event not found" });
      }

      const event = eventResult.Item;
      const accessMode = event.accessMode;

      if (accessMode === "paidAccess" && !viewer.isPaidViewer) {
        return res.status(402).json({ success: false, message: "Payment required for this event" });
      }

      // For now return a placeholder stream URL from the event; replace with signed URL logic later
      const streamUrl = event.liveUrl || event.vodUrl || null;

      if (!streamUrl) {
        return res.status(503).json({ success: false, message: "Stream URL not configured" });
      }

      return res.status(200).json({
        success: true,
        eventId,
        viewerId: viewer.viewerId,
        accessMode: viewer.accessMode,
        isPaidViewer: viewer.isPaidViewer,
        streamUrl,
      });
    } catch (error) {
      console.error("getStream error", error);
      return res.status(500).json({ success: false, message: "Unable to fetch stream" });
    }
  }
}

export default PlaybackController;
