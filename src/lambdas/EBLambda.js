import {
  SchedulerClient,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  GetScheduleCommand
} from "@aws-sdk/client-scheduler";

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const REGION = process.env.AWS_REGION || "ap-south-1";
const schedulerClient = new SchedulerClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });

const TARGET_LAMBDA_ARN = process.env.TARGET_LAMBDA_ARN;
const DELETE_LAMBDA_ARN = process.env.DELETE_LAMBDA_ARN;
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN;
const VOD_CONVERTER_LAMBDA_ARN = process.env.VOD_CONVERTER_LAMBDA_ARN;

const isPastOrNow = (iso) =>
  new Date(iso).getTime() <= Date.now();

const toCron = (iso) => {
  const dt = new Date(iso);
  return `cron(${dt.getUTCMinutes()} ${dt.getUTCHours()} ${dt.getUTCDate()} ${dt.getUTCMonth() + 1
    } ? ${dt.getUTCFullYear()})`;
};

export const handler = async (event) => {
  console.log("Received DynamoDB Event:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const newImage = record.dynamodb.NewImage || {};
    const oldImage = record.dynamodb.OldImage || {};

    const eventId = newImage.eventId?.S;
    const eventType = newImage.eventType?.S;
    const title = newImage.title?.S || "Untitled Stream";
    const description = newImage.description?.S || "";
    const createdAt = newImage.createdAt?.S || new Date().toISOString();

    const startTime = newImage.startTime?.S || newImage.dateTime?.S;
    const endTime = newImage.endTime?.S || newImage.deleteTime?.S;

    const oldStartTime = oldImage.startTime?.S;
    const oldEndTime = oldImage.endTime?.S;

    const channelState = newImage.channelState?.S;
    const originalStart = oldImage.startTime?.S;


    if (!eventId) continue;

    const startScheduleName = `schedule-start-${eventId}`;
    const deleteScheduleName = `schedule-delete-${eventId}`;

    if (
      eventType === "scheduled" &&
      (
        // time-based lock
        (originalStart && new Date(originalStart).getTime() <= Date.now()) ||

        // state-based lock (stronger)
        (channelState && channelState !== "IDLE")
      )
    ) {
      console.log(
        `⛔ Event ${eventId} already started or locked (state=${channelState}). Blocking reschedule.`
      );
      continue;
    }

    // =====================================================
    // VOD FLOW (UNCHANGED)
    // =====================================================
    if (record.eventName === "INSERT" && eventType === "vod") {
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: VOD_CONVERTER_LAMBDA_ARN,
          InvocationType: "Event",
          Payload: JSON.stringify(newImage),
        })
      );
      continue;
    }

    if (!startTime) continue;

    // =====================================================
    // MODIFY FLOW
    // =====================================================
    if (record.eventName === "MODIFY") {
      const oldStart = oldImage.startTime?.S;
      const oldEnd = oldImage.endTime?.S;

      // ---------- START UPDATE (SCHEDULE ONLY) ----------
      if (eventType === "scheduled" && oldStart !== startTime) {
        if (!isPastOrNow(startTime)) {
          await schedulerClient.send(
            new UpdateScheduleCommand({
              Name: startScheduleName,
              ScheduleExpression: toCron(startTime),
              FlexibleTimeWindow: { Mode: "OFF" },
              Target: {
                Arn: TARGET_LAMBDA_ARN,
                RoleArn: SCHEDULER_ROLE_ARN,
                Input: JSON.stringify({
                  eventId,
                  title,
                  description,
                  startTime,
                  action: "START_LIVE_STREAM",
                }),
              },
            })
          );
        }
      }

      // ---------- END UPDATE (LIVE + SCHEDULE) ----------
      // if (oldEnd !== endTime && endTime && !isPastOrNow(endTime)) {
      //   await schedulerClient.send(
      //     new UpdateScheduleCommand({
      //       Name: deleteScheduleName,
      //       ScheduleExpression: toCron(endTime),
      //       FlexibleTimeWindow: { Mode: "OFF" },
      //       Target: {
      //         Arn: DELETE_LAMBDA_ARN,
      //         RoleArn: SCHEDULER_ROLE_ARN,
      //         Input: JSON.stringify({
      //           eventId,
      //           title,
      //           description,
      //           deleteTime: endTime,
      //           action: "DELETE_LIVE_STREAM",
      //         }),
      //       },
      //     })
      //   );
      // }

      if (oldEnd !== endTime && endTime && !isPastOrNow(endTime)) {
        try {
          // 👉 Check if schedule exists
          await schedulerClient.send(
            new GetScheduleCommand({
              Name: deleteScheduleName,
              GroupName: "default",
            })
          );

          // 👉 If exists → UPDATE
          await schedulerClient.send(
            new UpdateScheduleCommand({
              Name: deleteScheduleName,
              ScheduleExpression: toCron(endTime),
              FlexibleTimeWindow: { Mode: "OFF" },
              Target: {
                Arn: DELETE_LAMBDA_ARN,
                RoleArn: SCHEDULER_ROLE_ARN,
                Input: JSON.stringify({
                  eventId,
                  title,
                  description,
                  deleteTime: endTime,
                  action: "DELETE_LIVE_STREAM",
                }),
              },
            })
          );

        } catch (error) {
          console.log("error name====>",error.name)
          if (error.name === "ResourceNotFoundException") {
            // 👉 If NOT exists → CREATE
            await schedulerClient.send(
              new CreateScheduleCommand({
                Name: deleteScheduleName,
                ScheduleGroupName: "default",
                FlexibleTimeWindow: { Mode: "OFF" },
                ScheduleExpression: toCron(endTime),
                Target: {
                  Arn: DELETE_LAMBDA_ARN,
                  RoleArn: SCHEDULER_ROLE_ARN,
                  Input: JSON.stringify({
                    eventId,
                    title,
                    description,
                    deleteTime: endTime,
                    action: "DELETE_LIVE_STREAM",
                  }),
                },
              })
            );
          } else {
            throw error;
          }
        }
      }

      continue;
    }

    // =====================================================
    // INSERT FLOW
    // =====================================================
    if (record.eventName === "INSERT") {

      // ---------- LIVE : START → DIRECT INVOKE ----------
      if (eventType === "live") {
        await lambdaClient.send(
          new InvokeCommand({
            FunctionName: TARGET_LAMBDA_ARN,
            InvocationType: "Event",
            Payload: JSON.stringify({
              eventId,
              title,
              description,
              startTime,
              action: "START_LIVE_STREAM",
            }),
          })
        );
      }

      // ---------- SCHEDULE : START → EVENTBRIDGE ----------
      if (eventType === "scheduled" && !isPastOrNow(startTime)) {
        await schedulerClient.send(
          new CreateScheduleCommand({
            Name: startScheduleName,
            ScheduleGroupName: "default",
            FlexibleTimeWindow: { Mode: "OFF" },
            ScheduleExpression: toCron(startTime),
            Target: {
              Arn: TARGET_LAMBDA_ARN,
              RoleArn: SCHEDULER_ROLE_ARN,
              Input: JSON.stringify({
                eventId,
                title,
                description,
                createdAt,
                startTime,
                action: "START_LIVE_STREAM",
              }),
            },
          })
        );
      }

      // ---------- END (LIVE + SCHEDULE) ----------
      if (endTime && !isPastOrNow(endTime)) {
        await schedulerClient.send(
          new CreateScheduleCommand({
            Name: deleteScheduleName,
            ScheduleGroupName: "default",
            FlexibleTimeWindow: { Mode: "OFF" },
            ScheduleExpression: toCron(endTime),
            Target: {
              Arn: DELETE_LAMBDA_ARN,
              RoleArn: SCHEDULER_ROLE_ARN,
              Input: JSON.stringify({
                eventId,
                title,
                description,
                deleteTime: endTime,
                action: "DELETE_LIVE_STREAM",
              }),
            },
          })
        );
      }
    }
  }

  return { statusCode: 200, body: "Done" };
};
