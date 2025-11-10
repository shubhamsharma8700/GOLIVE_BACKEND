import dynamoDB from "../config/dynamoClient.js";
import { v4 as uuidv4 } from "uuid";

export default class EventController {
  // Create a new event
  static async createEvent(req, res) {
    try {
      const { title, description, type, dateTime } = req.body;

      if (!title || !description || !type || !dateTime) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const eventId = uuidv4();
      console.log("Creating event with ID:", eventId);
      const params = {
        TableName: process.env.EVENTS_TABLE_NAME,
        Item: {
          eventId,
          title,
          description,
          type,
          dateTime,
          createdAt: new Date().toISOString(),
        },
      };

      await dynamoDB.put(params).promise();

      return res.status(201).json({
        success: true,
        message: "Event created successfully",
        eventId,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  // List all events
  static async listEvents(req, res) {
    try {
      const params = {
        TableName: process.env.EVENTS_TABLE_NAME,
      };

      const data = await dynamoDB.scan(params).promise();
      const events = data.Items || [];

      return res.status(200).json({
        success: true,
        count: events.length,
        events,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Unable to fetch events",
      });
    }
  }

   // ✅ Update event
  static async updateEvent(req, res) {
    try {
      const { eventId } = req.params;
      const { title, description, type, dateTime, amount } = req.body;

      if (!eventId) {
        return res.status(400).json({ message: "Missing eventId" });
      }

      if (!title || !description || !type || !dateTime) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Get existing event (to ensure it exists)
      const getParams = {
        TableName: process.env.EVENTS_TABLE_NAME,
        Key: { eventId },
      };
      const existing = await dynamoDB.get(getParams).promise();

      if (!existing.Item) {
        return res.status(404).json({ message: "Event not found" });
      }

      // Replace with new data (overwrite)
      const updateParams = {
        TableName: process.env.EVENTS_TABLE_NAME,
        Item: {
          eventId,
          title,
          description,
          type,
          dateTime,
          amount: amount || 0,
          updatedAt: new Date().toISOString(),
        },
      };

      await dynamoDB.put(updateParams).promise();

      return res.status(200).json({
        success: true,
        message: "Event updated successfully",
        eventId,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Unable to update event",
      });
    }
  }

  // ✅ Delete event
  static async deleteEvent(req, res) {
    try {
      const { eventId } = req.params;

      if (!eventId) {
        return res.status(400).json({ message: "Missing eventId" });
      }

      const params = {
        TableName: process.env.EVENTS_TABLE_NAME,
        Key: { eventId },
        ReturnValues: "ALL_OLD",
      };

      const result = await dynamoDB.delete(params).promise();

      if (!result.Attributes) {
        return res.status(404).json({ message: "Event not found" });
      }

      return res.status(200).json({
        success: true,
        message: "Event deleted successfully",
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Unable to delete event",
      });
    }
  }
}
