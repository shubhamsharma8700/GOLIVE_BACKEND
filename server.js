import dotenv from "dotenv";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import app from "./src/app.js";
import adminRoutes from "./src/routes/adminRoutes.js";
import presignRoutes from "./src/routes/presignRoutes.js";


dotenv.config();

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Admin Event API",
      version: "1.0.0",
      description: "API documentation for admin login and event management",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter JWT token as: Bearer <token>"
        }
      }
    },
    servers: [
       {
        url: "http://localhost:5000",
        description: "Local server",
      },
      {
         url: "https://d2wmdj5cojtj0q.cloudfront.net/app",
         description: "Production server",
      },
      {
         url: "https://13.234.235.130:5000",
         description: "EC2 server",
      }

    ],
  },
  apis: ["./src/routes/*.js"],
};


const swaggerDocs = swaggerJsdoc(swaggerOptions);

// Provide options to enable the Authorize button and explorer in Swagger UI
const swaggerUiOptions = {
  explorer: true,
};

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs, swaggerUiOptions));

// Expose Swagger docs as JSON (useful for debugging or advanced UI config)
app.get("/api-docs-json", (req, res) => {
  res.json(swaggerDocs);
});

// PRESIGN ROUTES FROM presignRoutes.js
app.use("/api/presign", presignRoutes);

// ADMIN ROUTES FROM service.js

app.use("/api/admins", adminRoutes);

// GLOBAL ERROR HANDLER from service.js

app.use((err, req, res, next) => {
  console.error("🔥 ERROR:", err);
  res
    .status(err.status || 500)
    .json({ error: err.message || "Internal Server Error" });
});

// HEALTH CHECK

app.get("/health", (req, res) => res.status(200).send("OK"));

// SERVER START

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
