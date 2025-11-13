import { dynamoDB, eventBridge } from "../config/awsClients.js";
import { v4 as uuidv4 } from "uuid";

export default class EventController {
  // Create a new event
  static async createEvent(req, res) {
    try {
      const { title, description, type, startTime } = req.body;

      if (!title || !description || !type || !startTime) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const eventId = uuidv4();
      console.log("Creating event with ID:", eventId);
      // 1️⃣ Insert the event into DynamoDB
      const params = {
        TableName: process.env.EVENTS_TABLE_NAME,
        Item: {
          eventId,
          title,
          description,
          type,
          startTime,
          status: "Scheduled",
          createdAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        },
      };

      await dynamoDB.put(params).promise();

      // // Schedule Lambda trigger 30 mins before event start
      // const eventTime = new Date(startTime);
      // const triggerTime = new Date(eventTime.getTime() - 30 * 60 * 1000);

      // // 2️⃣ Create an EventBridge rule for scheduled trigger
      // const ruleName = `EventTrigger_${eventId}`;
      // const cronExp = `${triggerTime.getUTCMinutes()} ${triggerTime.getUTCHours()} ${triggerTime.getUTCDate()} ${triggerTime.getUTCMonth() + 1} ? ${triggerTime.getUTCFullYear()}`;

      // await eventBridge.putRule({
      //   Name: ruleName,
      //   ScheduleExpression: `cron(${cronExp})`,
      //   State: "ENABLED",
      // }).promise();

      // // 3️⃣ Add your Lambda as target
      // await eventBridge.putTargets({
      //   Rule: ruleName,
      //   Targets: [
      //     {
      //       Id: `Target_${eventId}`,
      //       Arn: process.env.LIVE_STREAM_LAMBDA_ARN,
      //       Input: JSON.stringify({ eventId }),
      //     },
      //   ],
      // }).promise();

      // console.log(`✅ Scheduled Lambda for ${ruleName}`);

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
      const { title, description, type, startTime, amount } = req.body;

      if (!eventId) {
        return res.status(400).json({ message: "Missing eventId" });
      }

      if (!title || !description || !type || !startTime) {
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
          startTime,
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
