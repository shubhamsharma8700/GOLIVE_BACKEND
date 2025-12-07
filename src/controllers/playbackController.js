import {
  ddbDocClient,
  GetCommand
} from "../config/awsClients.js";

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

      // ---- Fetch event ----
      const eventResult = await ddbDocClient.send(
        new GetCommand({
          TableName: EVENTS_TABLE,
          Key: { eventId }
        })
      );

      if (!eventResult.Item) {
        return res.status(404).json({ success: false, message: "Event not found" });
      }

      const event = eventResult.Item;

      // ---- Access checks ----
      if (event.accessMode === "paidAccess" && !viewer.isPaidViewer) {
        return res.status(402).json({
          success: false,
          message: "Payment required for this event"
        });
      }

      // ---- Stream URL ----
      const streamUrl = event.liveUrl || event.vodUrl || null;

      if (!streamUrl) {
        return res.status(503).json({
          success: false,
          message: "Stream URL not configured"
        });
      }

      return res.status(200).json({
        success: true,
        eventId,
        viewerId: viewer.viewerId,
        accessMode: viewer.accessMode,
        isPaidViewer: viewer.isPaidViewer,
        streamUrl
      });

    } catch (error) {
      console.error("getStream error", error);
      return res.status(500).json({ success: false, message: "Unable to fetch stream" });
    }
  }
}

export default PlaybackController;
