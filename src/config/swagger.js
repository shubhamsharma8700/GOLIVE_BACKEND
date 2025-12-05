import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "GoLive Admin APIs",
      version: "1.0.0",
      description: "API documentation for Admin Login and Event Management (Express + DynamoDB)",
    },
    components: {
      securitySchemes: {
        // Existing admin/auth scheme can live alongside this.
        viewerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Viewer JWT used by viewerAuth middleware (Authorization: Bearer <token> or x-viewer-token header)",
        },
      },
    },
    servers: [
      {
        url: "http://localhost:5000",
        description: "Local server",
      },
    ],
  },
  apis: ["./src/routes/*.js"], // Path to the API docs
};

const swaggerSpec = swaggerJSDoc(options);

export { swaggerUi, swaggerSpec };
