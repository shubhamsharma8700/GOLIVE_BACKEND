import { dynamoDB, eventBridge } from "../config/awsClients.js";
import { v4 as uuidv4 } from "uuid";

export default class EventController {

  // CREATE EVENT
  static async createEvent(req, res) {
    try {
      const {
        title,
        description,
        startTime,
        endTime,
        accessMode,
        password,
        paymentAmount,
      } = req.body;

      if (!title || !description || !startTime || !accessMode) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (accessMode === "password" && !password) {
        return res.status(400).json({ message: "Password required for password mode" });
      }

      if (accessMode === "payment" && !paymentAmount) {
        return res.status(400).json({ message: "Payment amount required for payment mode" });
      }

      const eventId = uuidv4();

      const params = {
        TableName: process.env.EVENTS_TABLE_NAME,
        Item: {
          eventId,
          title,
          description,
          startTime,
          endTime: endTime || null,
          accessMode,
          password: accessMode === "password" ? password : null,
          paymentAmount: accessMode === "payment" ? Number(paymentAmount) : null,
          status: "scheduled",
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

  // LIST EVENTS
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

  // UPDATE EVENT
  static async updateEvent(req, res) {
    try {
      const { eventId } = req.params;
      const {
        title,
        description,
        startTime,
        endTime,
        accessMode,
        password,
        paymentAmount,
      } = req.body;

      if (!eventId) {
        return res.status(400).json({ message: "Missing eventId" });
      }

      if (!title || !description || !startTime || !accessMode) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (accessMode === "password" && !password) {
        return res.status(400).json({ message: "Password required for password mode" });
      }

      if (accessMode === "payment" && !paymentAmount) {
        return res.status(400).json({ message: "Payment amount required for payment mode" });
      }

      const updateParams = {
        TableName: process.env.EVENTS_TABLE_NAME,
        Item: {
          eventId,
          title,
          description,
          startTime,
          endTime: endTime || null,
          accessMode,
          password: accessMode === "password" ? password : null,
          paymentAmount: accessMode === "payment" ? Number(paymentAmount) : null,
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

  // DELETE EVENT
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

  // GET EVENT BY ID
  static async getEventById(req, res) {
    try {
      const { eventId } = req.params;

      if (!eventId) {
        return res.status(400).json({ message: "Missing eventId" });
      }

      const params = {
        TableName: process.env.EVENTS_TABLE_NAME,
        Key: { eventId },
      };

      const result = await dynamoDB.get(params).promise();

      if (!result.Item) {
        return res.status(404).json({
          success: false,
          message: "Event not found",
        });
      }

      return res.status(200).json({
        success: true,
        event: result.Item,
      });

    } catch (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Unable to fetch event details",
      });
    }
  }
}
